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
      Marker: vi.fn(function() { this.getPosition = vi.fn(() => ({ lat: () => 37.5, lng: () => 127.0 })); this.setMap = vi.fn(); this.setPosition = vi.fn(); }),
      Point: vi.fn(function() {}),
      Size: vi.fn(function() {}),
      Event: { addListener: vi.fn(() => ({})), removeListener: vi.fn() },
    },
  };
  // script onload 즉시 발화하도록 createElement 스텁
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
});
