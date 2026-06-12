// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MapView } from "./MapView";

// 색칠 모드 lazy chunk fetch 무력화 (테스트 환경에서 ChoroplethView lazy import 막음)
beforeEach(() => {
  globalThis.fetch = /** @type {any} */ (vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [] }) })));
});

/* ── 테스트 데이터 팩토리 ── */
/** @returns {any} */
function makeItem(/** @type {any} */ overrides = {}) {
  return {
    apt: { id: "test-1", name: "테스트아파트", region: "서울", gu: "강남구", lat: 37.5, lng: 127.0, price: 50000, ...overrides.apt },
    res: { total: 75, cats: {}, weights: {}, ...overrides.res },
  };
}

/* ── Kakao Maps SDK 모킹 헬퍼 ── */
function setupKakao() {
  const mockClusterer = { clear: vi.fn(), addMarkers: vi.fn() };
  /** @type {any} */ (window).kakao = {
    maps: {
      load: vi.fn(cb => cb()),
      Map: vi.fn(function() { this.addControl = vi.fn(); this.setBounds = vi.fn(); this.setZoomable = vi.fn(); }),
      LatLng: vi.fn(function() {}),
      LatLngBounds: vi.fn(function() { this.extend = vi.fn(); }),
      ZoomControl: vi.fn(function() {}),
      ControlPosition: { RIGHT: 3 },
      Marker: vi.fn(function() { this.getPosition = vi.fn(() => ({ getLat: () => 37, getLng: () => 127 })); }),
      MarkerImage: vi.fn(function() {}),
      Size: vi.fn(function() {}),
      Point: vi.fn(function() {}),
      MarkerClusterer: vi.fn(function() { this.clear = mockClusterer.clear; this.addMarkers = mockClusterer.addMarkers; }),
      event: { addListener: vi.fn() },
    },
  };
  return mockClusterer;
}

/** Promise microtask를 flush하여 비동기 SDK 로드 완료 대기 */
async function flushPromises() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe("MapView", () => {
  // 정상: 결과 수 오버레이 렌더링
  it("결과 수 오버레이가 렌더링됨", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });

  // 빈 배열: 크래시 없이 0개 표시
  it("빈 배열이면 0개 단지 표시", async () => {
    setupKakao();
    render(<MapView filtered={[]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByText("0개 단지")).toBeInTheDocument();
  });

  // lat/lng null → 마커 제외
  it("lat/lng null인 아파트는 마커에서 제외", async () => {
    const clusterer = setupKakao();
    const items = [makeItem({ apt: { lat: null, lng: null } }), makeItem({ apt: { id: "t2", lat: 37.5, lng: 127.0 } })];
    render(<MapView filtered={items} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalled();
    expect(clusterer.addMarkers.mock.calls[0][0]).toHaveLength(1);
  });

  // SDK 미로드 시 크래시 없음
  it("kakao SDK 없어도 크래시 없이 렌더링", async () => {
    delete (/** @type {any} */ (window)).kakao;
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    // SDK 없으면 markerCount=null → filtered.length만 표시
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });

  // 색칠 모드 토글 — 기본은 점 보기, 버튼 클릭 시 색칠로 전환
  it("토글 버튼 기본 라벨은 '🎨 색칠'", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByLabelText("지도 모드 토글")).toHaveTextContent("🎨 색칠");
  });

  it("토글 클릭 → 라벨이 '📍 점' 으로 바뀌고 aria-pressed=true", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    const btn = screen.getByLabelText("지도 모드 토글");
    fireEvent.click(btn);
    await flushPromises();
    expect(btn).toHaveTextContent("📍 점");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("색칠 모드 시 마커 useEffect 가드 → addMarkers 호출 0", async () => {
    const clusterer = setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    // 점 모드: addMarkers 1회
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
    // 색칠 토글 클릭
    fireEvent.click(screen.getByLabelText("지도 모드 토글"));
    await flushPromises();
    // 색칠 모드 진입 후 addMarkers 호출 안 늘어남 (clear 만 호출)
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
    expect(clusterer.clear.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("색칠 모드 결과수 표기는 'N개 단지' (markerCount 의존 분기 우회)", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem(), makeItem({ apt: { id: "t2" } })]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    fireEvent.click(screen.getByLabelText("지도 모드 토글"));
    await flushPromises();
    expect(screen.getByText("2개 단지")).toBeInTheDocument();
  });
});

/* ── M2 신규 prop: compact / height / onSelect (plan 406 Phase 1) ── */

/** 마커 click 핸들러 추출 — setupKakao 의 event.addListener mock calls 에서 */
function getMarkerClickHandlers() {
  return /** @type {any} */ (window).kakao.maps.event.addListener.mock.calls
    .filter((/** @type {any[]} */ c) => c[1] === "click")
    .map((/** @type {any[]} */ c) => c[2]);
}

describe("MapView compact (위젯 모드)", () => {
  it("compact: 모드토글·인프라 오버레이 미렌더 + 결과수 badge 유지 + 휠 줌 차단", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} compact />);
    await flushPromises();
    expect(screen.queryByLabelText("지도 모드 토글")).toBeNull();
    expect(screen.queryByTitle("지하철")).toBeNull();
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
    // 휠 줌 차단 + ZoomControl 미부착
    const mapInst = /** @type {any} */ (window).kakao.maps.Map.mock.instances[0];
    expect(mapInst.setZoomable).toHaveBeenCalledWith(false);
    expect(mapInst.addControl).not.toHaveBeenCalled();
  });

  it("현위치 버튼: geolocation 스텁 시 기본 렌더 / compact 미렌더 (양면 단언)", async () => {
    Object.defineProperty(window.navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn() }, configurable: true,
    });
    try {
      setupKakao();
      const { unmount } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} />);
      await flushPromises();
      expect(screen.getByLabelText("현위치")).toBeInTheDocument();
      unmount();

      setupKakao();
      render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} compact />);
      await flushPromises();
      expect(screen.queryByLabelText("현위치")).toBeNull();
    } finally {
      delete (/** @type {any} */ (window.navigator).geolocation);
    }
  });

  it("compact 미전달: ZoomControl 부착 + setZoomable 미호출 (기본값 회귀)", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} />);
    await flushPromises();
    const mapInst = /** @type {any} */ (window).kakao.maps.Map.mock.instances[0];
    expect(mapInst.addControl).toHaveBeenCalledTimes(1);
    expect(mapInst.setZoomable).not.toHaveBeenCalled();
  });
});

describe("MapView height prop", () => {
  it("height='280px' 전달 시 루트 높이 반영", async () => {
    setupKakao();
    const { container } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} height="280px" />);
    await flushPromises();
    expect(/** @type {HTMLElement} */ (container.firstChild).style.height).toBe("280px");
  });

  it("height 미전달 시 현행 뷰포트 3분기 calc 유지", async () => {
    setupKakao();
    const { container } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(/** @type {HTMLElement} */ (container.firstChild).style.height).toBe("calc(100dvh - 140px)");
  });
});

describe("MapView onSelect (선택 미러)", () => {
  it("mount 시 onSelect(null) 1회 발화", async () => {
    setupKakao();
    const onSelect = vi.fn();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} onSelect={onSelect} />);
    await flushPromises();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("핀 클릭 → onSelect(item) 발화", async () => {
    setupKakao();
    const onSelect = vi.fn();
    const item = makeItem();
    render(<MapView filtered={[item]} onDetail={vi.fn()} onSelect={onSelect} />);
    await flushPromises();
    await act(async () => { getMarkerClickHandlers()[0](); });
    // 순서 단언: [mount null, 핀클릭 item]
    expect(onSelect.mock.calls.map(c => c[0])).toEqual([null, item]);
  });

  it("핀 클릭 후 filtered 교체 → onSelect(null) 전파", async () => {
    setupKakao();
    const onSelect = vi.fn();
    const item = makeItem();
    const { rerender } = render(<MapView filtered={[item]} onDetail={vi.fn()} onSelect={onSelect} />);
    await flushPromises();
    await act(async () => { getMarkerClickHandlers()[0](); });
    rerender(<MapView filtered={[makeItem({ apt: { id: "t2" } })]} onDetail={vi.fn()} onSelect={onSelect} />);
    await flushPromises();
    expect(onSelect.mock.calls.map(c => c[0])).toEqual([null, item, null]);
  });

  it("핀 클릭 후 모드토글(point→choropleth) → onSelect(null) 전파", async () => {
    setupKakao();
    const onSelect = vi.fn();
    const item = makeItem();
    render(<MapView filtered={[item]} onDetail={vi.fn()} onSelect={onSelect} />);
    await flushPromises();
    await act(async () => { getMarkerClickHandlers()[0](); });
    fireEvent.click(screen.getByLabelText("지도 모드 토글"));
    await flushPromises();
    expect(onSelect.mock.calls.map(c => c[0])).toEqual([null, item, null]);
  });

  it("핀 클릭 후 SelectedAptCard 닫기 → onSelect(null) 전파", async () => {
    setupKakao();
    const onSelect = vi.fn();
    const item = makeItem();
    render(<MapView filtered={[item]} onDetail={vi.fn()} onSelect={onSelect} />);
    await flushPromises();
    await act(async () => { getMarkerClickHandlers()[0](); });
    fireEvent.click(screen.getByLabelText("닫기"));
    await flushPromises();
    expect(onSelect.mock.calls.map(c => c[0])).toEqual([null, item, null]);
  });

  it("인라인 onSelect 콜백 rerender 에도 마커 재생성 0 (ref 격리 회귀 가드)", async () => {
    const clusterer = setupKakao();
    const filtered = [makeItem()]; // 동일 참조 유지 — deps 불변 전제
    const { rerender } = render(<MapView filtered={filtered} onDetail={vi.fn()} onSelect={() => {}} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
    rerender(<MapView filtered={filtered} onDetail={vi.fn()} onSelect={() => {}} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
  });
});
