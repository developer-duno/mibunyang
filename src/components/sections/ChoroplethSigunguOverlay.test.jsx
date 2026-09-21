// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { ChoroplethSigunguOverlay, __resetSigunguGeoCacheForTest } from "./ChoroplethSigunguOverlay";
import { C } from "@/theme";

// 미니멀 시군구 GeoJSON 7건: 강남구 / 창원 5구 / 잘못된 prefix 1
const FAKE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { code: "11680", name: "강남구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [127.0, 37.5],
            [127.1, 37.5],
            [127.1, 37.6],
            [127.0, 37.5],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "38111", name: "창원시의창구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [128.6, 35.2],
            [128.7, 35.2],
            [128.7, 35.3],
            [128.6, 35.2],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "38112", name: "창원시성산구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [128.7, 35.2],
            [128.8, 35.2],
            [128.8, 35.3],
            [128.7, 35.2],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "38113", name: "창원시마산합포구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [128.5, 35.1],
            [128.6, 35.1],
            [128.6, 35.2],
            [128.5, 35.1],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "38114", name: "창원시마산회원구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [128.5, 35.2],
            [128.6, 35.2],
            [128.6, 35.3],
            [128.5, 35.2],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "38115", name: "창원시진해구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [128.7, 35.1],
            [128.8, 35.1],
            [128.8, 35.2],
            [128.7, 35.1],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { code: "99999", name: "외계구" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [120.0, 30.0],
            [120.1, 30.0],
            [120.1, 30.1],
            [120.0, 30.0],
          ],
        ],
      },
    },
  ],
};

function setupKakao() {
  /** @type {any[]} */
  const polygons = [];
  /** @type {any[]} */
  const eventListeners = [];

  const PolygonCtor = vi.fn(
    /** @type {any} */ (
      function (/** @type {any} */ opts) {
        this._opts = { ...opts };
        this.setMap = vi.fn((/** @type {any} */ map) => {
          this._map = map;
        });
        this.setOptions = vi.fn((/** @type {any} */ o) => {
          this._opts = { ...this._opts, ...o };
        });
        polygons.push(this);
      }
    )
  );

  const mapInstance = { setBounds: vi.fn() };

  /** @type {any} */ (window).kakao = {
    maps: {
      Polygon: PolygonCtor,
      LatLng: vi.fn(function (lat, lng) {
        this.lat = lat;
        this.lng = lng;
      }),
      LatLngBounds: vi.fn(function () {
        this.extend = vi.fn();
      }),
      event: {
        addListener: vi.fn((target, type, handler) => {
          eventListeners.push({ target, type, handler });
        }),
      },
    },
  };
  return { polygons, eventListeners, mapInstance };
}

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("ChoroplethSigunguOverlay", () => {
  beforeEach(() => {
    __resetSigunguGeoCacheForTest(); // 모듈 캐시 격리(ChoroplethView.test 와 같은 이유)
    globalThis.fetch = /** @type {any} */ (
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(FAKE_GEOJSON) }))
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetch 성공 → 매핑되는 폴리곤만 setMap (잘못된 prefix 제외)", async () => {
    const { polygons, mapInstance } = setupKakao();
    render(<ChoroplethSigunguOverlay mapInstance={mapInstance} ready={true} filtered={[]} onGuClick={vi.fn()} />);
    await flushPromises();
    // 강남 1 + 창원 5 = 6 (외계구 99999 prefix 매핑 실패로 제외)
    expect(polygons).toHaveLength(6);
    polygons.forEach((p) => expect(p.setMap).toHaveBeenCalledWith(mapInstance));
  });

  it("byGu 빈 객체 → 모든 폴리곤 fillOpacity 0.2 (회색)", async () => {
    const { polygons } = setupKakao();
    render(
      <ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />
    );
    await flushPromises();
    polygons.forEach((p) => expect(p._opts.fillOpacity).toBe(0.2));
  });

  it("창원 5구 클릭 시 모두 같은 byGu 키 (경남|창원시) 콜백", async () => {
    const { eventListeners } = setupKakao();
    const onGuClick = vi.fn();
    // 경남|창원시 평균 점수 데이터 주입
    const filtered = /** @type {any} */ ([{ apt: { region: "경남", gu: "창원시" }, res: { total: 70 } }]);
    render(
      <ChoroplethSigunguOverlay
        mapInstance={{ setBounds: vi.fn() }}
        ready={true}
        filtered={filtered}
        onGuClick={onGuClick}
      />
    );
    await flushPromises();
    // 창원 5구 = 5 click listener (강남 1 + 99999 0 = 6 polygons → 6 click listeners 중 5건 창원)
    const clickListeners = eventListeners.filter((l) => l.type === "click");
    expect(clickListeners.length).toBeGreaterThanOrEqual(6);
    // 창원 5건 (마지막 5개) — 모두 호출 시 같은 키
    clickListeners.slice(1, 6).forEach((l) => l.handler());
    expect(onGuClick).toHaveBeenCalledTimes(5);
    onGuClick.mock.calls.forEach((args) => expect(args[0]).toBe("경남|창원시"));
  });

  it("표본 부족(1곳) → 점선 테두리 / 충분(3곳) → 실선 (표본 가드)", async () => {
    // 시군구 193칸 중 47칸이 단지 3곳 미만이라 이 구분이 대부분의 칸에 걸린다.
    // ⚠️ 채움 진하기는 두 경우가 **같다** — 불확실성은 테두리로만 말한다(세션553 적대검증:
    //    흐리게 칠하면 시군구에서 표본 부족(밝기 0.826~0.880)과 데이터 없음(0.889)이 겹친다).
    const one = /** @type {any} */ ([{ apt: { region: "경남", gu: "창원시" }, res: { total: 70 } }]);
    const { polygons } = setupKakao();
    render(
      <ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={one} onGuClick={vi.fn()} />
    );
    await flushPromises();
    const dashed = polygons.filter((p) => p._opts.strokeStyle === "dashed");
    expect(dashed.length).toBeGreaterThan(0); // 창원 = 1곳뿐 → 점선
    dashed.forEach((p) => {
      expect(p._opts.fillOpacity).toBe(0.55); // 채움은 안 깎는다
      expect(p._opts.strokeColor).toBe(C.muted);
    });

    cleanup();
    const three = /** @type {any} */ (
      Array.from({ length: 3 }, () => ({ apt: { region: "경남", gu: "창원시" }, res: { total: 70 } }))
    );
    const { polygons: p2 } = setupKakao();
    render(
      <ChoroplethSigunguOverlay
        mapInstance={{ setBounds: vi.fn() }}
        ready={true}
        filtered={three}
        onGuClick={vi.fn()}
      />
    );
    await flushPromises();
    // 3곳이면 창원 칸은 점선이 아니다 (데이터 없는 강남 칸은 애초에 점선 대상이 아니다)
    const stillDashed = p2.filter((p) => p._opts.strokeStyle === "dashed");
    expect(stillDashed).toHaveLength(0);
  });

  // 세션554 적대검증 🔴 — 시군구는 인자 1개만 넘겨 표본 경고가 **조용히** 끊겼다.
  // 문턱 3이 가장 많이 걸리는 층이 시군구라 여기가 끊기면 기능의 대부분이 죽는다.
  it("표본 부족 시군구 click → 표본 정보를 함께 넘긴다", async () => {
    const { eventListeners } = setupKakao();
    const onGuClick = vi.fn();
    const one = /** @type {any} */ ([{ apt: { region: "서울", gu: "강남구" }, res: { total: 70 } }]);
    render(
      <ChoroplethSigunguOverlay
        mapInstance={{ setBounds: vi.fn() }}
        ready={true}
        filtered={one}
        onGuClick={onGuClick}
      />
    );
    await flushPromises();
    eventListeners.find((l) => l.type === "click").handler();
    expect(onGuClick).toHaveBeenCalledWith("서울|강남구", { count: 1, enough: false });
  });

  it("데이터 없는 칸은 점선이 아니다 (표본 부족과 구분)", async () => {
    const { polygons } = setupKakao();
    render(
      <ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />
    );
    await flushPromises();
    // 전부 데이터 없음 → 회색 채움이되 점선은 아니다 ("안 쟀다" 와 "적게 쟀다" 는 다른 뜻)
    polygons.forEach((p) => {
      expect(p._opts.strokeStyle).toBeUndefined();
      expect(p._opts.fillOpacity).toBe(0.2);
    });
  });

  it("표본 부족 칸을 hover 해도 점선은 그대로다 (가드가 안 지워진다)", async () => {
    const { eventListeners, polygons } = setupKakao();
    const one = /** @type {any} */ ([{ apt: { region: "경남", gu: "창원시" }, res: { total: 70 } }]);
    render(
      <ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={one} onGuClick={vi.fn()} />
    );
    await flushPromises();
    const dashedIdx = polygons.findIndex((p) => p._opts.strokeStyle === "dashed");
    expect(dashedIdx).toBeGreaterThanOrEqual(0);
    const over = eventListeners.filter((l) => l.type === "mouseover")[dashedIdx];
    over.handler();
    expect(over.target.setOptions).toHaveBeenCalledWith({ fillOpacity: 0.8 });
    expect(polygons[dashedIdx]._opts.strokeStyle).toBe("dashed");
  });

  it("폴리곤 click → onGuClick(byGu key) + setBounds", async () => {
    const { eventListeners, mapInstance } = setupKakao();
    const onGuClick = vi.fn();
    render(<ChoroplethSigunguOverlay mapInstance={mapInstance} ready={true} filtered={[]} onGuClick={onGuClick} />);
    await flushPromises();
    const firstClick = eventListeners.find((l) => l.type === "click");
    firstClick.handler();
    expect(mapInstance.setBounds).toHaveBeenCalled();
    // 첫 feature = 강남구
    // 세션554: 표본 정보를 함께 넘긴다(시군구도 시도와 같은 계약).
    // filtered=[] 이라 그 칸은 데이터 자체가 없다 → count 0 (안내는 buildSampleNote 가 막는다).
    expect(onGuClick).toHaveBeenCalledWith("서울|강남구", { count: 0, enough: false });
  });

  it("fetch 실패 → role=alert", async () => {
    setupKakao();
    globalThis.fetch = /** @type {any} */ (vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    const { getByRole } = render(
      <ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />
    );
    await flushPromises();
    expect(getByRole("alert")).toHaveTextContent("시군구 데이터를 불러올 수 없습니다");
  });

  it("unmount → 폴리곤 setMap(null) cleanup", async () => {
    const { polygons } = setupKakao();
    const { unmount } = render(
      <ChoroplethSigunguOverlay mapInstance={{ setBounds: vi.fn() }} ready={true} filtered={[]} onGuClick={vi.fn()} />
    );
    await flushPromises();
    const setMapMocks = polygons.map((p) => p.setMap);
    unmount();
    setMapMocks.forEach((m) => expect(m).toHaveBeenCalledWith(null));
  });
});
