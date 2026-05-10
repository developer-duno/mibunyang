// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { ChoroplethView } from "./ChoroplethView";

// 미니멀 시도 GeoJSON 3개 (서울/부산/세종) — 매핑 미존재 1개 (테스트섬) 포함
const FAKE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "서울특별시" }, geometry: { type: "Polygon", coordinates: [[[127.0, 37.5], [127.1, 37.5], [127.1, 37.6], [127.0, 37.5]]] } },
    { type: "Feature", properties: { name: "부산광역시" }, geometry: { type: "Polygon", coordinates: [[[129.0, 35.0], [129.1, 35.0], [129.1, 35.1], [129.0, 35.0]]] } },
    { type: "Feature", properties: { name: "테스트섬" }, geometry: { type: "Polygon", coordinates: [[[125.0, 33.0], [125.1, 33.0], [125.1, 33.1], [125.0, 33.0]]] } },
  ],
};

function setupKakao() {
  // Polygon 인스턴스 생성 시 옵션 보존 + setOptions/setMap 추적
  /** @type {any[]} */
  const polygons = [];
  /** @type {any[]} */
  const eventListeners = []; // {target, type, handler}

  const PolygonCtor = vi.fn(/** @type {any} */ (function (/** @type {any} */ opts) {
    this._opts = { ...opts };
    this.setMap = vi.fn((/** @type {any} */ map) => { this._map = map; });
    this.setOptions = vi.fn((/** @type {any} */ o) => { this._opts = { ...this._opts, ...o }; });
    polygons.push(this);
  }));

  const mapInstance = { setBounds: vi.fn() };

  /** @type {any} */ (window).kakao = {
    maps: {
      Polygon: PolygonCtor,
      LatLng: vi.fn(function (lat, lng) { this.lat = lat; this.lng = lng; }),
      LatLngBounds: vi.fn(function () { this.extend = vi.fn(); }),
      event: {
        addListener: vi.fn((target, type, handler) => { eventListeners.push({ target, type, handler }); }),
      },
    },
  };
  return { polygons, eventListeners, mapInstance };
}

async function flushPromises() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe("ChoroplethView", () => {
  beforeEach(() => {
    globalThis.fetch = /** @type {any} */ (vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_GEOJSON) })));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("GeoJSON fetch 성공 → 매핑되는 폴리곤만 setMap 호출 (테스트섬 제외)", async () => {
    const { polygons, mapInstance } = setupKakao();
    render(<ChoroplethView mapInstance={mapInstance} ready={true} filtered={/** @type {any} */ ([{ apt: { region: "서울" }, res: { total: 80 } }])} onSidoClick={vi.fn()} />);
    await flushPromises();
    // 서울 + 부산 = 2 (테스트섬은 매핑 실패로 제외)
    expect(polygons).toHaveLength(2);
    polygons.forEach(p => expect(p.setMap).toHaveBeenCalledWith(mapInstance));
  });

  it("byRegion 빈 객체 → 모든 폴리곤 fillOpacity 0.25", async () => {
    const { polygons } = setupKakao();
    render(<ChoroplethView mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onSidoClick={vi.fn()} />);
    await flushPromises();
    polygons.forEach(p => expect(p._opts.fillOpacity).toBe(0.25));
  });

  it("byRegion 일부만 → 매핑 안 된 시도는 회색 0.25", async () => {
    const { polygons } = setupKakao();
    // 서울만 데이터 있음
    render(<ChoroplethView mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={/** @type {any} */ ([{ apt: { region: "서울" }, res: { total: 90 } }])} onSidoClick={vi.fn()} />);
    await flushPromises();
    // 첫 폴리곤 = 서울 (데이터 있음, 0.65), 둘째 = 부산 (없음, 0.25)
    expect(polygons[0]._opts.fillOpacity).toBe(0.65);
    expect(polygons[1]._opts.fillOpacity).toBe(0.25);
  });

  it("폴리곤 click → onSidoClick + setBounds 호출", async () => {
    const { eventListeners, mapInstance } = setupKakao();
    const onSidoClick = vi.fn();
    render(<ChoroplethView mapInstance={mapInstance} ready={true} filtered={/** @type {any} */ ([{ apt: { region: "서울" }, res: { total: 80 } }])} onSidoClick={onSidoClick} />);
    await flushPromises();
    const clickListener = eventListeners.find(l => l.type === "click");
    expect(clickListener).toBeDefined();
    clickListener.handler();
    expect(mapInstance.setBounds).toHaveBeenCalled();
    expect(onSidoClick).toHaveBeenCalledWith("서울");
  });

  it("폴리곤 mouseover → fillOpacity 0.85", async () => {
    const { eventListeners } = setupKakao();
    render(<ChoroplethView mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={/** @type {any} */ ([{ apt: { region: "서울" }, res: { total: 80 } }])} onSidoClick={vi.fn()} />);
    await flushPromises();
    const overListener = eventListeners.find(l => l.type === "mouseover");
    overListener.handler();
    expect(overListener.target.setOptions).toHaveBeenCalledWith({ fillOpacity: 0.85 });
  });

  it("폴리곤 mouseout → fillOpacity baseOpacity 복귀", async () => {
    const { eventListeners } = setupKakao();
    render(<ChoroplethView mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={/** @type {any} */ ([{ apt: { region: "서울" }, res: { total: 80 } }])} onSidoClick={vi.fn()} />);
    await flushPromises();
    const outListener = eventListeners.find(l => l.type === "mouseout");
    outListener.handler();
    // 서울은 데이터 있음 → 0.65 복귀
    expect(outListener.target.setOptions).toHaveBeenCalledWith({ fillOpacity: 0.65 });
  });

  it("fetch 실패 → role=alert 에러 노출", async () => {
    setupKakao();
    globalThis.fetch = /** @type {any} */ (vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    const { getByRole } = render(<ChoroplethView mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onSidoClick={vi.fn()} />);
    await flushPromises();
    expect(getByRole("alert")).toHaveTextContent("지도 데이터를 불러올 수 없습니다");
  });

  it("unmount → 폴리곤 cleanup (setMap(null))", async () => {
    const { polygons } = setupKakao();
    const { unmount } = render(<ChoroplethView mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onSidoClick={vi.fn()} />);
    await flushPromises();
    const setMapMocks = polygons.map(p => p.setMap);
    unmount();
    setMapMocks.forEach(m => {
      // setMap(map) 1회 + setMap(null) 1회
      expect(m).toHaveBeenCalledWith(null);
    });
  });

  // ─── 단계 D 추가: 줌 감지 + 시군구 자동 전환 ───
  it("level 13 (초기) → 시도 폴리곤만 그려지고 시군구 컴포넌트 미렌더", async () => {
    const { polygons, eventListeners } = setupKakao();
    const mapInstance = { setBounds: vi.fn(), getLevel: vi.fn(() => 13) };
    render(<ChoroplethView mapInstance={mapInstance} ready={true} filtered={[]} onSidoClick={vi.fn()} />);
    await flushPromises();
    // 시도 폴리곤 2개 (서울/부산 매핑) — 시군구 모드 미진입
    expect(polygons.length).toBeGreaterThan(0);
    // zoom_changed 리스너 등록 확인
    const zoomListener = eventListeners.find(l => l.type === "zoom_changed");
    expect(zoomListener).toBeDefined();
  });

  it("level 7 (≤8) zoom_changed → 시도 폴리곤 cleanup (setMap(null))", async () => {
    const { polygons, eventListeners } = setupKakao();
    const mapInstance = { setBounds: vi.fn(), getLevel: vi.fn(() => 13) };
    render(<ChoroplethView mapInstance={mapInstance} ready={true} filtered={[]} onSidoClick={vi.fn()} />);
    await flushPromises();
    // 시도 폴리곤이 그려진 상태
    const initialCount = polygons.length;
    expect(initialCount).toBeGreaterThan(0);
    // 줌 7로 변경
    mapInstance.getLevel = vi.fn(() => 7);
    const zoomHandler = eventListeners.find(l => l.type === "zoom_changed").handler;
    await act(async () => { zoomHandler(); });
    await flushPromises();
    // 시도 폴리곤 모두 setMap(null) 호출됨 (cleanup)
    polygons.slice(0, initialCount).forEach(p => {
      expect(p.setMap).toHaveBeenCalledWith(null);
    });
  });

  it("unmount 시 zoom_changed removeListener 옵셔널 호출", async () => {
    const { eventListeners } = setupKakao();
    const removeListener = vi.fn();
    /** @type {any} */ (window).kakao.maps.event.removeListener = removeListener;
    const mapInstance = { setBounds: vi.fn(), getLevel: vi.fn(() => 13) };
    const { unmount } = render(<ChoroplethView mapInstance={mapInstance} ready={true} filtered={[]} onSidoClick={vi.fn()} />);
    await flushPromises();
    const zoomListener = eventListeners.find(l => l.type === "zoom_changed");
    unmount();
    // removeListener(mapInstance, "zoom_changed", handler) 호출 검증
    expect(removeListener).toHaveBeenCalledWith(mapInstance, "zoom_changed", zoomListener.handler);
  });
});
