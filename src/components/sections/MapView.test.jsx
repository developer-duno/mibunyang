// @ts-check
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
// 네이버 키 미설정(카카오 패스스루) 전제 — 다른 테스트 파일의 stubEnv 누수와 무관하게 키 비움 명시.
// 동적 import 라야 stub 이 naverMapHelpers 모듈 평가보다 먼저 적용됨(정적 import 는 hoisting 으로 먼저 굳음).
vi.stubEnv("VITE_NAVER_MAP_CLIENT_ID", "");
afterAll(() => vi.unstubAllEnvs());
const { MapView } = await import("./MapView");

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
  const mockClusterer = { clear: vi.fn(), addMarkers: vi.fn(), redraw: vi.fn() };
  /** @type {any} */ (window).kakao = {
    maps: {
      load: vi.fn(cb => cb()),
      // M3: getCenter/getLevel 추가 (idle 콜백이 현재 뷰포트 끌어올림). LatLng(lat,lng) 인자 보존.
      // 세션 417: region-fit 의 과도줌 클램프용 setLevel 추가. getLevel 은 기본 7(클램프 테스트는 인스턴스에서 재설정).
      Map: vi.fn(function() { this.addControl = vi.fn(); this.setBounds = vi.fn(); this.setLevel = vi.fn(); this.setCenter = vi.fn(); this.setZoomable = vi.fn(); this.getCenter = vi.fn(() => ({ getLat: () => 35.1, getLng: () => 129.0 })); this.getLevel = vi.fn(() => 7); }),
      LatLng: vi.fn(function(/** @type {number} */ lat, /** @type {number} */ lng) { this.lat = lat; this.lng = lng; }),
      LatLngBounds: vi.fn(function() { this.extend = vi.fn(); }),
      ZoomControl: vi.fn(function() {}),
      ControlPosition: { RIGHT: 3 },
      // 세션 416: 선택 마커 강조용 setImage/setZIndex 추가 (없으면 강조 effect 가 기존 click 테스트까지 붕괴)
      Marker: vi.fn(function() { this.getPosition = vi.fn(() => ({ getLat: () => 37, getLng: () => 127 })); this.setImage = vi.fn(); this.setZIndex = vi.fn(); this.setMap = vi.fn(); this.setPosition = vi.fn(); }),
      MarkerImage: vi.fn(function() {}),
      Size: vi.fn(function() {}),
      Point: vi.fn(function() {}),
      // 세션 416: 강조 effect 가 clusterer.redraw() 호출 (setImage auto-redraw 미보장)
      MarkerClusterer: vi.fn(function() { this.clear = mockClusterer.clear; this.addMarkers = mockClusterer.addMarkers; this.redraw = mockClusterer.redraw; }),
      // M3: removeListener 추가 (idle cleanup). ChoroplethView 답습 — 옵셔널 가드 통과 검증.
      event: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  return mockClusterer;
}

/** idle 핸들러 추출 — event.addListener mock calls 에서 (map, "idle", handler) */
function getIdleHandlers() {
  return /** @type {any} */ (window).kakao.maps.event.addListener.mock.calls
    .filter((/** @type {any[]} */ c) => c[1] === "idle")
    .map((/** @type {any[]} */ c) => c[2]);
}

/** 마지막 생성된 Map 인스턴스 (setBounds 호출 검증용) */
function lastMapInstance() {
  const results = /** @type {any} */ (window).kakao.maps.Map.mock.results;
  return results[results.length - 1]?.value;
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

  it("fullscreen 시 테두리·라운드 제거, 높이 calc 는 불변 (세션 417 전체화면)", async () => {
    setupKakao();
    const { container } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} fullscreen />);
    await flushPromises();
    const root = /** @type {HTMLElement} */ (container.firstChild);
    // jsdom 은 border:none 을 borderStyle:none 으로 정규화(border shorthand 읽기는 medium)
    expect(root.style.borderStyle).toBe("none"); // 전체화면은 테두리 없음
    expect(root.style.borderRadius).toBe("0px"); // 라운드 제거
    expect(root.style.height).toBe("calc(100dvh - 140px)"); // 높이 calc 는 불변(잘림 방지)
  });

  it("fullscreen 미전달(기본) 시 테두리·라운드 유지", async () => {
    setupKakao();
    const { container } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    const root = /** @type {HTMLElement} */ (container.firstChild);
    expect(root.style.borderRadius).toBe("10px"); // 모바일 기본 라운드
    expect(root.style.borderStyle).not.toBe("none"); // 테두리 있음(solid)
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

  it("핀 클릭 → onDetail(id) 바로 호출 (세션 417 1단계화 — 카드만 뜨던 2단계 제거)", async () => {
    setupKakao();
    const onDetail = vi.fn();
    const item = makeItem({ apt: { id: "click-1" } });
    render(<MapView filtered={[item]} onDetail={onDetail} />);
    await flushPromises();
    await act(async () => { getMarkerClickHandlers()[0](); });
    expect(onDetail).toHaveBeenCalledWith("click-1"); // 마커 클릭 = 바로 상세 진입
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

/* ── M3 신규 prop: getViewport / onViewportChange (세션 413 지도 위치 보존) ── */

describe("MapView 뷰포트 보존 (M3)", () => {
  it("신규 진입(getViewport null) → 첫 마커 fit 1회 setBounds 호출", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} />);
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalledTimes(1);
  });

  it("같은 마운트 내 filtered 재변경 → 첫 fit 후엔 setBounds 추가 호출 0 (B-1 전국 리셋 억제)", async () => {
    setupKakao();
    const item1 = makeItem();
    const { rerender } = render(<MapView filtered={[item1]} onDetail={vi.fn()} getViewport={() => null} />);
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // 첫 마커 fit
    // filtered 를 다른 배열로 변경 → 마커는 갱신되나 didFitRef true 라 fit 생략
    rerender(<MapView filtered={[item1, makeItem({ apt: { id: "t2", lat: 36.5, lng: 127.5 } })]} onDetail={vi.fn()} getViewport={() => null} />);
    await flushPromises();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // 추가 fit 없음 = 사용자 위치 유지
  });

  // ── 세션 417: 지역/시군구 변경 시 클로즈업(region-fit) ──
  it("지역(deferredRegion) 변경 시 그 지역 단지로 setBounds 추가 호출 (클로즈업)", async () => {
    setupKakao();
    const seoul = makeItem({ apt: { id: "s1", region: "서울", gu: "강남구", lat: 37.5, lng: 127.0 } });
    const { rerender } = render(
      <MapView filtered={[seoul]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // 첫 마커 fit
    // "전체" → "대전" 변경 + filtered 가 대전 단지로 교체 → region-fit 발화
    const daejeon = makeItem({ apt: { id: "d1", region: "대전", gu: "유성구", lat: 36.35, lng: 127.38 } });
    rerender(
      <MapView filtered={[daejeon]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="전체" />,
    );
    await flushPromises();
    expect(map.setBounds).toHaveBeenCalledTimes(2); // region-fit 추가 1회
    // padding 인자 동반 (top,right,bottom,left)
    expect(map.setBounds.mock.calls[1].length).toBe(5);
  });

  it("구(deferredGu) 변경 시 그 구 단지로 setBounds 추가 호출 (더 클로즈업)", async () => {
    setupKakao();
    const daejeonAll = makeItem({ apt: { id: "d1", region: "대전", gu: "전체", lat: 36.35, lng: 127.38 } });
    const { rerender } = render(
      <MapView filtered={[daejeonAll]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    const before = map.setBounds.mock.calls.length;
    // "전체" → "유성구" 변경
    const yuseong = makeItem({ apt: { id: "y1", region: "대전", gu: "유성구", lat: 36.36, lng: 127.36 } });
    rerender(
      <MapView filtered={[yuseong]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="유성구" />,
    );
    await flushPromises();
    expect(map.setBounds.mock.calls.length).toBe(before + 1); // gu-fit 발화
  });

  it("지역 미변경(필터-only 변경)이면 region-fit 발화 0 (수동 위치 보존)", async () => {
    setupKakao();
    const item1 = makeItem({ apt: { id: "a1", region: "서울", gu: "강남구" } });
    const { rerender } = render(
      <MapView filtered={[item1]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="서울" deferredGu="강남구" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // 첫 fit
    // region/gu 그대로, filtered 만 다른 배열 (예산 등 필터 변경 시뮬)
    rerender(
      <MapView filtered={[item1, makeItem({ apt: { id: "a2", region: "서울", gu: "강남구", lat: 37.6, lng: 127.1 } })]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="서울" deferredGu="강남구" />,
    );
    await flushPromises();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // region-fit 발화 0 = 위치 유지
  });

  it("지역 → 전체 초기화 시 region-fit 발화 0 (전국 강제 리셋 방지)", async () => {
    setupKakao();
    const seoul = makeItem({ apt: { id: "s1", region: "서울", gu: "강남구" } });
    const { rerender } = render(
      <MapView filtered={[seoul]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="서울" deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalledTimes(1);
    // "서울" → "전체" 되돌림
    rerender(
      <MapView filtered={[seoul, makeItem({ apt: { id: "g1", region: "경기", gu: "전체", lat: 37.4, lng: 127.2 } })]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" deferredGu="전체" />,
    );
    await flushPromises();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // "전체" 는 fit 안 함
  });

  it("region-fit 시 과도 줌인이면 최소 레벨로 setLevel 클램프", async () => {
    setupKakao();
    const seoul = makeItem({ apt: { id: "s1", region: "서울", gu: "강남구", lat: 37.5, lng: 127.0 } });
    const { rerender } = render(
      <MapView filtered={[seoul]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    // setBounds 후 getLevel 이 과도 줌인(2 < REGION_FIT_MIN_LEVEL 8)을 반환하도록 재설정
    map.getLevel = vi.fn(() => 2);
    const daejeon = makeItem({ apt: { id: "d1", region: "대전", gu: "전체", lat: 36.35, lng: 127.38 } });
    rerender(
      <MapView filtered={[daejeon]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="전체" />,
    );
    await flushPromises();
    // 시/도 최소 레벨 8 로 클램프
    expect(map.setLevel).toHaveBeenCalledWith(8);
  });

  it("region-fit 시 이미 충분히 넓으면(level >= minLv) setLevel 안 함 (불필요 축소 방지)", async () => {
    setupKakao();
    const seoul = makeItem({ apt: { id: "s1", region: "서울", gu: "강남구" } });
    const { rerender } = render(
      <MapView filtered={[seoul]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    // setBounds 후 getLevel 이 minLv(8) 이상(10)을 반환 → 클램프 불필요
    map.getLevel = vi.fn(() => 10);
    const daejeon = makeItem({ apt: { id: "d1", region: "대전", gu: "전체", lat: 36.35, lng: 127.38 } });
    rerender(
      <MapView filtered={[daejeon]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="전체" />,
    );
    await flushPromises();
    expect(map.setLevel).not.toHaveBeenCalled(); // 이미 넓으니 강제 축소 안 함
  });

  it("구 fit 과도 줌인 시 GU 최소 레벨 4 로 클램프 (개별 마커 풀림)", async () => {
    setupKakao();
    const daejeonAll = makeItem({ apt: { id: "d1", region: "대전", gu: "전체", lat: 36.35, lng: 127.38 } });
    const { rerender } = render(
      <MapView filtered={[daejeonAll]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    // 구로 좁히면 단지 적어 과도 줌인(2 < 4) → GU_FIT_MIN_LEVEL 4 로 클램프
    map.getLevel = vi.fn(() => 2);
    const yuseong = makeItem({ apt: { id: "y1", region: "대전", gu: "유성구", lat: 36.36, lng: 127.36 } });
    rerender(
      <MapView filtered={[yuseong]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="대전" deferredGu="유성구" />,
    );
    await flushPromises();
    expect(map.setLevel).toHaveBeenCalledWith(4); // 구는 더 클로즈업(클러스터 경계 5보다 아래)
  });

  it("deferredRegion 미전달(undefined)이면 gu 변경에도 region-fit 발화 0 (truthy 가드)", async () => {
    setupKakao();
    const item1 = makeItem({ apt: { id: "a1", region: "서울", gu: "강남구" } });
    // deferredRegion 안 줌(undefined) + deferredGu 만 변경 시뮬 — App 은 항상 둘 다 주지만 가드 방어 검증
    const { rerender } = render(
      <MapView filtered={[item1]} onDetail={vi.fn()} getViewport={() => null} deferredGu="전체" />,
    );
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // 첫 fit
    rerender(
      <MapView filtered={[item1, makeItem({ apt: { id: "a2", region: "서울", gu: "역삼동", lat: 37.5, lng: 127.04 } })]} onDetail={vi.fn()} getViewport={() => null} deferredGu="역삼동" />,
    );
    await flushPromises();
    expect(map.setBounds).toHaveBeenCalledTimes(1); // deferredRegion undefined → region-fit 미발화
  });

  it("viewport 복원 시에도 첫 마커 fit 1회 실행 (맹점4: 빈 화면 방지)", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => ({ lat: 35.1, lng: 129.0, level: 7 })} />);
    await flushPromises();
    const map = lastMapInstance();
    // 초기 center/level 은 복원값이되, 마커 fit 은 실행 → 재마운트 후 필터 바뀌어도 빈 화면 안 생김
    expect(map.setBounds).toHaveBeenCalledTimes(1);
  });

  it("viewport 복원 시 초기 center/level 이 복원값으로 생성", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => ({ lat: 35.1, lng: 129.0, level: 7 })} />);
    await flushPromises();
    // LatLng(35.1, 129.0) 으로 호출 + Map level 7
    const latLngCalls = /** @type {any} */ (window).kakao.maps.LatLng.mock.calls;
    expect(latLngCalls.some((/** @type {any[]} */ c) => c[0] === 35.1 && c[1] === 129.0)).toBe(true);
    const mapOpts = /** @type {any} */ (window).kakao.maps.Map.mock.calls[0][1];
    expect(mapOpts.level).toBe(7);
  });

  it("idle 이벤트 발화 → onViewportChange 가 현재 center/level 끌어올림", async () => {
    setupKakao();
    const onViewportChange = vi.fn();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} onViewportChange={onViewportChange} />);
    await flushPromises();
    const idleHandlers = getIdleHandlers();
    expect(idleHandlers.length).toBe(1);
    await act(async () => { idleHandlers[0](); });
    // mock Map.getCenter = (35.1, 129.0), getLevel = 7
    expect(onViewportChange).toHaveBeenCalledWith({ lat: 35.1, lng: 129.0, level: 7 });
  });

  it("언마운트 시 idle removeListener 옵셔널 호출 (cleanup)", async () => {
    setupKakao();
    const { unmount } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} onViewportChange={vi.fn()} />);
    await flushPromises();
    const removeListener = /** @type {any} */ (window).kakao.maps.event.removeListener;
    unmount();
    // removeListener(map, "idle", handler) 호출
    expect(removeListener.mock.calls.some((/** @type {any[]} */ c) => c[1] === "idle")).toBe(true);
  });

  it("getViewport 인라인 콜백 rerender 에도 마커 재생성 0 (ref 격리 회귀 가드)", async () => {
    const clusterer = setupKakao();
    const filtered = [makeItem()];
    const { rerender } = render(<MapView filtered={filtered} onDetail={vi.fn()} getViewport={() => null} onViewportChange={() => {}} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
    rerender(<MapView filtered={filtered} onDetail={vi.fn()} getViewport={() => null} onViewportChange={() => {}} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
  });
});

/* ── 세션 416: 선택 마커 강조 (setImage 교체 + redraw, 마커 전체 재생성 0) ── */

describe("MapView 선택 마커 강조", () => {
  it("핀 클릭(선택) → setImage 강조 교체 + clusterer.redraw + addMarkers 추가 호출 0", async () => {
    const clusterer = setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
    // 생성된 마커 인스턴스 — setImage 강조 확인
    const markerInst = /** @type {any} */ (window).kakao.maps.Marker.mock.instances[0];
    // 핀 클릭 → setSelected(item) → 강조 effect
    await act(async () => { getMarkerClickHandlers()[0](); });
    expect(markerInst.setImage).toHaveBeenCalled(); // 강조 이미지로 교체
    expect(markerInst.setZIndex).toHaveBeenCalledWith(50);
    expect(clusterer.redraw).toHaveBeenCalled();
    // 마커 전체 재생성 안 함 = addMarkers 여전히 1회
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
  });

  it("선택 해제(카드 닫기) → 강조 마커 일반 이미지 복원", async () => {
    setupKakao();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} />);
    await flushPromises();
    const markerInst = /** @type {any} */ (window).kakao.maps.Marker.mock.instances[0];
    await act(async () => { getMarkerClickHandlers()[0](); });
    const callsAfterSelect = markerInst.setImage.mock.calls.length;
    // 카드 닫기 → setSelected(null) → 복원 setImage 1회 추가
    fireEvent.click(screen.getByLabelText("닫기"));
    await flushPromises();
    expect(markerInst.setImage.mock.calls.length).toBeGreaterThan(callsAfterSelect);
  });

  it("선택 상태에서 filtered 교체 → 마커 재생성(addMarkers 2회) + stale 강조 no-op (크래시 없음)", async () => {
    const clusterer = setupKakao();
    const { rerender } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} />);
    await flushPromises();
    await act(async () => { getMarkerClickHandlers()[0](); });
    // filtered 교체 → 마커 effect 재실행(clear + addMarkers 2회) + markerByIdRef 재채움
    rerender(<MapView filtered={[makeItem({ apt: { id: "t2", lat: 36.5, lng: 127.5 } })]} onDetail={vi.fn()} />);
    await flushPromises();
    expect(clusterer.addMarkers).toHaveBeenCalledTimes(2);
  });
});

// GPS 첫 진입 자동 동네 표시 (세션 435) — 카카오 경로(MapView 키 미설정 → KakaoMapView 패스스루).
describe("MapView GPS 자동 동네 표시", () => {
  /** geolocation mock 설치 — getCurrentPosition 의 success/error 콜백을 직접 잡아 발화 */
  function stubGeo() {
    const captured = /** @type {any} */ ({});
    Object.defineProperty(window.navigator, "geolocation", {
      value: {
        getCurrentPosition: vi.fn((success, error) => { captured.success = success; captured.error = error; }),
      },
      configurable: true,
    });
    return captured;
  }

  it("첫 진입(지역 미선택+뷰포트 없음)에 GPS 성공 → 동네로 setCenter+setLevel", async () => {
    setupKakao();
    const geo = stubGeo();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" />);
    await flushPromises();
    expect(geo.success).toBeTypeOf("function");
    const map = lastMapInstance();
    geo.success({ coords: { latitude: 37.49, longitude: 127.03 } });
    expect(map.setCenter).toHaveBeenCalled();
    expect(map.setLevel).toHaveBeenCalledWith(6); // MY_LOC_LEVEL
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("지역 선택 상태(deferredRegion≠전체)면 GPS 자동 발동 안 함", async () => {
    setupKakao();
    stubGeo();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="서울" />);
    await flushPromises();
    expect(window.navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("복원 뷰포트 있으면(탭 재진입) GPS 자동 발동 안 함", async () => {
    setupKakao();
    stubGeo();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => ({ lat: 35.1, lng: 129.0, level: 7 })} deferredRegion="전체" />);
    await flushPromises();
    expect(window.navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("GPS 거부 시 크래시 없이 기존 전국 fit 유지 (폴백)", async () => {
    setupKakao();
    const geo = stubGeo();
    render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" />);
    await flushPromises();
    const map = lastMapInstance();
    expect(map.setBounds).toHaveBeenCalled(); // 마커 effect 가 먼저 전국 fit
    expect(() => geo.error({ code: 1 })).not.toThrow(); // 거부 콜백 — no-op
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("자동 발동은 1회만 (재렌더해도 getCurrentPosition 추가 호출 0)", async () => {
    setupKakao();
    stubGeo();
    const { rerender } = render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" />);
    await flushPromises();
    rerender(<MapView filtered={[makeItem({ apt: { id: "t2" } })]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" />);
    await flushPromises();
    expect(window.navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("geolocation 미지원이면 자동 발동 안 함 (크래시 0)", async () => {
    setupKakao();
    delete (/** @type {any} */ (window.navigator).geolocation);
    expect(() => render(<MapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" />)).not.toThrow();
    await flushPromises();
  });
});
