import { describe, it, expect, vi } from "vitest";
import { geoJsonFeatureToKakaoPaths } from "./geoJsonToKakaoPaths";

// kakao.LatLng fake — 인자 그대로 보존해서 좌표 뒤집기 검증 가능
function makeKakao() {
  return {
    LatLng: vi.fn(function (lat, lng) { this.lat = lat; this.lng = lng; }),
  };
}

describe("geoJsonFeatureToKakaoPaths", () => {
  it("Polygon 1개 → 외곽 ring 1 path", () => {
    const kakao = makeKakao();
    const feature = {
      geometry: {
        type: "Polygon",
        coordinates: [
          [[127.0, 37.5], [127.1, 37.5], [127.1, 37.6], [127.0, 37.5]],
        ],
      },
    };
    const paths = geoJsonFeatureToKakaoPaths(feature, kakao);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(4);
    // [lng, lat] → LatLng(lat, lng) 뒤집기 검증
    expect(paths[0][0].lat).toBe(37.5);
    expect(paths[0][0].lng).toBe(127.0);
  });

  it("MultiPolygon 2개 → 2 path (외곽 ring 만)", () => {
    const kakao = makeKakao();
    const feature = {
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[127.0, 37.5], [127.1, 37.5], [127.1, 37.6]]],
          [[[126.5, 33.5], [126.6, 33.5], [126.6, 33.6]]],
        ],
      },
    };
    const paths = geoJsonFeatureToKakaoPaths(feature, kakao);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveLength(3);
    expect(paths[1]).toHaveLength(3);
  });

  it("빈 coordinates → 빈 배열", () => {
    const kakao = makeKakao();
    const empty = geoJsonFeatureToKakaoPaths({ geometry: { type: "Polygon", coordinates: [] } }, kakao);
    expect(empty).toEqual([]);
  });

  it("null/잘못된 geometry → 빈 배열", () => {
    const kakao = makeKakao();
    expect(geoJsonFeatureToKakaoPaths({}, kakao)).toEqual([]);
    expect(geoJsonFeatureToKakaoPaths({ geometry: null }, kakao)).toEqual([]);
    expect(geoJsonFeatureToKakaoPaths({ geometry: { type: "Point", coordinates: [127, 37] } }, kakao)).toEqual([]);
    expect(geoJsonFeatureToKakaoPaths(null, kakao)).toEqual([]);
  });
});
