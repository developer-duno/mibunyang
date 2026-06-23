// @ts-check
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen, act } from "@testing-library/react";

// 네이버 키를 mock — naverMapHelpers 가 import.meta.env 읽기 전에 설정 (NaverMapView import 보다 먼저).
vi.stubEnv("VITE_NAVER_MAP_CLIENT_ID", "test-naver-key");
// 파일 경계 누수 방지 — 정리 안 하면 같은 worker 의 MapView.test 가 키 설정 상태로 보여 토글 래퍼가 생김.
afterAll(() => vi.unstubAllEnvs());

const { NaverMapView } = await import("./NaverMapView");

/** @returns {any} */
function makeItem(/** @type {any} */ overrides = {}) {
  return {
    apt: { id: "test-1", name: "테스트아파트", region: "서울", gu: "강남구", lat: 37.5, lng: 127.0, price: 50000, ...overrides.apt },
    res: { total: 75, cats: {}, weights: {} },
  };
}

/* ── Naver Maps SDK 모킹 — script onload 즉시 사용(load 콜백 없음) ── */
function setupNaver() {
  /** @type {any} */ (window).naver = {
    maps: {
      Map: vi.fn(function() {
        this.fitBounds = vi.fn(); this.setZoom = vi.fn(); this.getZoom = vi.fn(() => 8);
        this.setCenter = vi.fn(); this.getCenter = vi.fn(() => ({ lat: () => 37.5, lng: () => 127.0 }));
        this.destroy = vi.fn();
      }),
      LatLng: vi.fn(function(/** @type {number} */ lat, /** @type {number} */ lng) { this.lat = () => lat; this.lng = () => lng; }),
      LatLngBounds: vi.fn(function() { this.extend = vi.fn(); }),
      // 세션 438: 선택 마커 강조용 setIcon/setZIndex 추가 (없으면 강조 effect 가 기존 click 테스트까지 붕괴 — 카카오 세션 416 박제)
      Marker: vi.fn(function() { this.getPosition = vi.fn(() => ({ lat: () => 37.5, lng: () => 127.0 })); this.setMap = vi.fn(); this.setPosition = vi.fn(); this.setIcon = vi.fn(); this.setZIndex = vi.fn(); }),
      Point: vi.fn(function() {}),
      Size: vi.fn(function() {}),
      Event: { addListener: vi.fn(() => ({})), removeListener: vi.fn() },
    },
  };
  // MarkerClustering 전역 mock — 클러스터 경로 검증(setMarkers 호출). 실제 라이브러리는 public/vendor 로드.
  /** @type {any} */ (window).MarkerClustering = vi.fn(function() { this.setMarkers = vi.fn(); this.setMap = vi.fn(); });
  // script onload 즉시 발화하도록 createElement 스텁 (SDK·클러스터 둘 다)
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((/** @type {any} */ tag) => {
    const el = origCreate(tag);
    if (tag === "script") {
      Object.defineProperty(el, "src", { set() { setTimeout(() => el.onload?.(/** @type {any} */ ({})), 0); }, get() { return ""; }, configurable: true });
    }
    return el;
  });
}

async function flushPromises() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

beforeEach(() => {
  delete (/** @type {any} */ (window).naver);
  delete (/** @type {any} */ (window).MarkerClustering);
  vi.restoreAllMocks();
});

describe("NaverMapView", () => {
  it("마커가 단지 수만큼 생성됨 (개별 마커)", async () => {
    setupNaver();
    render(<NaverMapView filtered={[makeItem(), makeItem({ apt: { id: "t2" } })]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(/** @type {any} */ (window).naver.maps.Marker).toHaveBeenCalledTimes(2);
  });

  it("lat/lng null 단지는 마커 제외", async () => {
    setupNaver();
    render(<NaverMapView filtered={[makeItem({ apt: { lat: null, lng: null } }), makeItem({ apt: { id: "t2" } })]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(/** @type {any} */ (window).naver.maps.Marker).toHaveBeenCalledTimes(1);
  });

  it("마커 클릭 시 onDetail 호출 (단지 id)", async () => {
    setupNaver();
    const onDetail = vi.fn();
    render(<NaverMapView filtered={[makeItem()]} onDetail={onDetail} isPC={false} />);
    await flushPromises();
    // Event.addListener 의 click 핸들러 추출 → 실행
    const calls = /** @type {any} */ (window).naver.maps.Event.addListener.mock.calls;
    const clickHandler = calls.find((/** @type {any[]} */ c) => c[1] === "click")?.[2];
    expect(clickHandler).toBeTypeOf("function");
    clickHandler();
    expect(onDetail).toHaveBeenCalledWith("test-1");
  });

  it("결과 수 오버레이 렌더", async () => {
    setupNaver();
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });

  it("SDK 미로드(naver 부재) 시 크래시 없이 에러 표시", async () => {
    // window.naver 미설정 + script onload 안 됨 → 로드 실패 catch
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((/** @type {any} */ tag) => {
      const el = origCreate(tag);
      if (tag === "script") {
        Object.defineProperty(el, "src", { set() { setTimeout(() => el.onerror?.(/** @type {any} */ ({})), 0); }, get() { return ""; }, configurable: true });
      }
      return el;
    });
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByText("지도를 불러올 수 없습니다")).toBeInTheDocument();
  });

  it("현위치 버튼 렌더 / compact 시 미렌더", async () => {
    setupNaver();
    Object.defineProperty(window.navigator, "geolocation", { value: { getCurrentPosition: vi.fn() }, configurable: true });
    const { rerender } = render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    expect(screen.getByLabelText("현위치")).toBeInTheDocument();
    rerender(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} compact />);
    expect(screen.queryByLabelText("현위치")).toBeNull();
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  // GPS 첫 진입 자동 동네 표시 (세션 435) — 카카오와 동일 조건.
  it("첫 진입(지역 미선택+뷰포트 없음)에 GPS 성공 → setCenter+setZoom", async () => {
    setupNaver();
    const captured = /** @type {any} */ ({});
    Object.defineProperty(window.navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn((s) => { captured.success = s; }) }, configurable: true,
    });
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="전체" />);
    await flushPromises();
    expect(captured.success).toBeTypeOf("function");
    const inst = /** @type {any} */ (window).naver.maps.Map.mock.results.at(-1).value;
    captured.success({ coords: { latitude: 37.49, longitude: 127.03 } });
    expect(inst.setCenter).toHaveBeenCalled();
    expect(inst.setZoom).toHaveBeenCalledWith(15); // NAVER_MY_LOC_ZOOM
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("지역 선택 상태면 GPS 자동 발동 안 함", async () => {
    setupNaver();
    Object.defineProperty(window.navigator, "geolocation", { value: { getCurrentPosition: vi.fn() }, configurable: true });
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => null} deferredRegion="서울" />);
    await flushPromises();
    expect(window.navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  it("복원 뷰포트 있으면 GPS 자동 발동 안 함", async () => {
    setupNaver();
    Object.defineProperty(window.navigator, "geolocation", { value: { getCurrentPosition: vi.fn() }, configurable: true });
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} getViewport={() => ({ lat: 35.1, lng: 129.0, level: 7 })} deferredRegion="전체" />);
    await flushPromises();
    expect(window.navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    delete (/** @type {any} */ (window.navigator).geolocation);
  });

  // 클러스터 (세션 435 — 카카오 동등 숫자 묶기)
  it("클러스터러 로드 시 마커를 setMarkers 로 넘김 (개별 map 부착 안 함)", async () => {
    setupNaver();
    render(<NaverMapView filtered={[makeItem(), makeItem({ apt: { id: "t2" } })]} onDetail={vi.fn()} />);
    await flushPromises();
    // MarkerClustering 인스턴스의 setMarkers 가 마커 배열로 호출됨
    const inst = /** @type {any} */ (window).MarkerClustering.mock.results.at(-1).value;
    expect(inst.setMarkers).toHaveBeenCalled();
    expect(inst.setMarkers.mock.calls.at(-1)[0]).toHaveLength(2);
  });

  it("클러스터러 로드 실패 시 개별 마커 폴백 (setMap 으로 직접 부착)", async () => {
    // MarkerClustering 전역을 비워 로드돼도 생성자 없음 → clustererRef null → 폴백
    setupNaver();
    delete (/** @type {any} */ (window).MarkerClustering);
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} />);
    await flushPromises();
    await flushPromises(); // SDK 로드 → 클러스터 로드(실패) → finally setReady 체인 2단계 대기
    // 폴백: Marker 가 생성되고 (개별 map 부착) 크래시 0
    expect(/** @type {any} */ (window).naver.maps.Marker).toHaveBeenCalled();
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });

  /* ── 세션 438: 선택 마커 강조 (setIcon 교체, 마커 전체 재생성 0 — 카카오 MapView.test 답습) ── */

  // 마커 click 핸들러 추출 헬퍼 (위 click 테스트 답습)
  function getClickHandler() {
    const calls = /** @type {any} */ (window).naver.maps.Event.addListener.mock.calls;
    return calls.find((/** @type {any[]} */ c) => c[1] === "click")?.[2];
  }

  it("마커 click(선택) → setIcon 강조 교체 + setZIndex(50)", async () => {
    setupNaver();
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    const markerInst = /** @type {any} */ (window).naver.maps.Marker.mock.results.at(-1).value;
    const clickHandler = getClickHandler();
    expect(clickHandler).toBeTypeOf("function");
    act(() => clickHandler());
    expect(markerInst.setIcon).toHaveBeenCalled();        // 강조 아이콘으로 교체
    expect(markerInst.setZIndex).toHaveBeenCalledWith(50);
  });

  it("선택 해제(카드 닫기) → 강조 마커 일반 아이콘 복원", async () => {
    setupNaver();
    render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    const markerInst = /** @type {any} */ (window).naver.maps.Marker.mock.results.at(-1).value;
    const clickHandler = getClickHandler();
    act(() => clickHandler());                              // 선택 → 강조 setIcon
    const callsAfterSelect = markerInst.setIcon.mock.calls.length;
    // SelectedAptCard 닫기 버튼 → onClose → setSelected(null) → 복원 setIcon 1회 추가
    act(() => { screen.getByLabelText("닫기").click(); });
    expect(markerInst.setIcon.mock.calls.length).toBeGreaterThan(callsAfterSelect);
  });

  it("선택 상태에서 filtered 교체 → 마커 재생성 + stale 강조 no-op (크래시 0)", async () => {
    setupNaver();
    const { rerender } = render(<NaverMapView filtered={[makeItem()]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    const clickHandler = getClickHandler();
    act(() => clickHandler());                              // 단지 선택(강조)
    // filtered 를 다른 단지로 교체 — 옛 선택 단지는 사라짐. 강조 effect 가 stale 마커 못 찾아도 크래시 0.
    rerender(<NaverMapView filtered={[makeItem({ apt: { id: "t99" } })]} onDetail={vi.fn()} isPC={false} />);
    await flushPromises();
    // 새 단지 마커가 그려지고 결과수 정상 = 크래시 없이 진행됨
    expect(screen.getByText("1개 단지")).toBeInTheDocument();
  });
});
