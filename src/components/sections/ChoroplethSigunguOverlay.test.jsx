import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { ChoroplethSigunguOverlay } from "./ChoroplethSigunguOverlay";

// 미니멀 시군구 GeoJSON 7건: 강남구 / 창원 5구 / 잘못된 prefix 1
const FAKE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { code: "11680", name: "강남구" }, geometry: { type: "Polygon", coordinates: [[[127.0, 37.5], [127.1, 37.5], [127.1, 37.6], [127.0, 37.5]]] } },
    { type: "Feature", properties: { code: "38111", name: "창원시의창구" }, geometry: { type: "Polygon", coordinates: [[[128.6, 35.2], [128.7, 35.2], [128.7, 35.3], [128.6, 35.2]]] } },
    { type: "Feature", properties: { code: "38112", name: "창원시성산구" }, geometry: { type: "Polygon", coordinates: [[[128.7, 35.2], [128.8, 35.2], [128.8, 35.3], [128.7, 35.2]]] } },
    { type: "Feature", properties: { code: "38113", name: "창원시마산합포구" }, geometry: { type: "Polygon", coordinates: [[[128.5, 35.1], [128.6, 35.1], [128.6, 35.2], [128.5, 35.1]]] } },
    { type: "Feature", properties: { code: "38114", name: "창원시마산회원구" }, geometry: { type: "Polygon", coordinates: [[[128.5, 35.2], [128.6, 35.2], [128.6, 35.3], [128.5, 35.2]]] } },
    { type: "Feature", properties: { code: "38115", name: "창원시진해구" }, geometry: { type: "Polygon", coordinates: [[[128.7, 35.1], [128.8, 35.1], [128.8, 35.2], [128.7, 35.1]]] } },
    { type: "Feature", properties: { code: "99999", name: "외계구" }, geometry: { type: "Polygon", coordinates: [[[120.0, 30.0], [120.1, 30.0], [120.1, 30.1], [120.0, 30.0]]] } },
  ],
};

function setupKakao() {
  const polygons = [];
  const eventListeners = [];

  const PolygonCtor = vi.fn(function (opts) {
    this._opts = { ...opts };
    this.setMap = vi.fn(map => { this._map = map; });
    this.setOptions = vi.fn(o => { this._opts = { ...this._opts, ...o }; });
    polygons.push(this);
  });

  const mapInstance = { setBounds: vi.fn() };

  window.kakao = {
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

describe("ChoroplethSigunguOverlay", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_GEOJSON) }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("fetch 성공 → 매핑되는 폴리곤만 setMap (잘못된 prefix 제외)", async () => {
    const { polygons, mapInstance } = setupKakao();
    render(<ChoroplethSigunguOverlay mapInstance={mapInstance} ready={true} filtered={[]} onGuClick={vi.fn()} />);
    await flushPromises();
    // 강남 1 + 창원 5 = 6 (외계구 99999 prefix 매핑 실패로 제외)
    expect(polygons).toHaveLength(6);
    polygons.forEach(p => expect(p.setMap).toHaveBeenCalledWith(mapInstance));
  });

  it("byGu 빈 객체 → 모든 폴리곤 fillOpacity 0.2 (회색)", async () => {
    const { polygons } = setupKakao();
    render(<ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />);
    await flushPromises();
    polygons.forEach(p => expect(p._opts.fillOpacity).toBe(0.2));
  });

  it("창원 5구 클릭 시 모두 같은 byGu 키 (경남|창원시) 콜백", async () => {
    const { eventListeners } = setupKakao();
    const onGuClick = vi.fn();
    // 경남|창원시 평균 점수 데이터 주입
    const filtered = [{ apt: { region: "경남", gu: "창원시" }, res: { total: 70 } }];
    render(<ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={filtered} onGuClick={onGuClick} />);
    await flushPromises();
    // 창원 5구 = 5 click listener (강남 1 + 99999 0 = 6 polygons → 6 click listeners 중 5건 창원)
    const clickListeners = eventListeners.filter(l => l.type === "click");
    expect(clickListeners.length).toBeGreaterThanOrEqual(6);
    // 창원 5건 (마지막 5개) — 모두 호출 시 같은 키
    clickListeners.slice(1, 6).forEach(l => l.handler());
    expect(onGuClick).toHaveBeenCalledTimes(5);
    onGuClick.mock.calls.forEach(args => expect(args[0]).toBe("경남|창원시"));
  });

  it("폴리곤 click → onGuClick(byGu key) + setBounds", async () => {
    const { eventListeners, mapInstance } = setupKakao();
    const onGuClick = vi.fn();
    render(<ChoroplethSigunguOverlay mapInstance={mapInstance} ready={true} filtered={[]} onGuClick={onGuClick} />);
    await flushPromises();
    const firstClick = eventListeners.find(l => l.type === "click");
    firstClick.handler();
    expect(mapInstance.setBounds).toHaveBeenCalled();
    // 첫 feature = 강남구
    expect(onGuClick).toHaveBeenCalledWith("서울|강남구");
  });

  it("fetch 실패 → role=alert", async () => {
    setupKakao();
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
    const { getByRole } = render(<ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />);
    await flushPromises();
    expect(getByRole("alert")).toHaveTextContent("시군구 데이터를 불러올 수 없습니다");
  });

  it("unmount → 폴리곤 setMap(null) cleanup", async () => {
    const { polygons } = setupKakao();
    const { unmount } = render(<ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />);
    await flushPromises();
    const setMapMocks = polygons.map(p => p.setMap);
    unmount();
    setMapMocks.forEach(m => expect(m).toHaveBeenCalledWith(null));
  });
});
