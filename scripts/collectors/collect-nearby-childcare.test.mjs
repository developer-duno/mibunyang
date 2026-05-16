// @ts-check
/**
 * collect-nearby-childcare.mjs 테스트 — Haversine 1km 5건 필터 / 70 필드 변환 / 시계열 row 선택 (세션 257 W6-D2)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { toNearbyChildcare, buildRegionFacilityMap, findNearby } = await import("./collect-nearby-childcare.mjs");

describe("toNearbyChildcare", () => {
  it("70 필드 facility — 모든 필드 채움 + detail 객체 보존", () => {
    const fac = {
      crname: "구립참행복한어린이집", la: "37.646", lo: "127.012",
      crtypename: "국공립", crstatusname: "정상", crcapat: 20, crchcnt: 18,
      cctvinstlcnt: 12, datastdrdt: "2026-02-01",
    };
    const r = toNearbyChildcare(fac, 0.32);
    expect(r.name).toBe("구립참행복한어린이집");
    expect(r.distance).toBe(320);
    expect(r.type).toBe("국공립");
    expect(r.cctv).toBe(12);
    expect(r.capacity).toBe(20);
    expect(r.enrolled).toBe(18);
    expect(r.dataStdDate).toBe("2026-02-01");
    expect(r.detail).not.toBeNull();
  });

  it("기초 7 필드만 — 70 필드 미수집 시 type/cctv/enrolled/status null + detail null", () => {
    const fac = { crname: "다솔어린이집", crcapat: 30 };
    const r = toNearbyChildcare(fac, 0.5);
    expect(r.name).toBe("다솔어린이집");
    expect(r.distance).toBe(500);
    expect(r.capacity).toBe(30);
    expect(r.type).toBeNull();
    expect(r.cctv).toBeNull();
    expect(r.enrolled).toBeNull();
    expect(r.status).toBeNull();
    expect(r.dataStdDate).toBeNull();
    expect(r.detail).toBeNull();
  });
});

describe("findNearby", () => {
  const facilities = [
    { crname: "가까운1", la: "37.5810", lo: "127.0040", crtypename: "국공립" }, // ~30m
    { crname: "가까운2", la: "37.5820", lo: "127.0050", crtypename: "민간" },   // ~150m
    { crname: "먼곳", la: "37.6000", lo: "127.0500", crtypename: "가정" },      // 1km 초과
    { crname: "좌표없음", la: null, lo: null, crtypename: "직장" },             // 제외
  ];

  it("1km 이내만, 거리순 정렬", () => {
    const r = findNearby(37.5812, 127.0042, facilities);
    expect(r.length).toBe(2);
    expect(r[0].name).toBe("가까운1");
    expect(r[1].name).toBe("가까운2");
    expect(r[0].distance).toBeLessThan(r[1].distance);
  });

  it("좌표 없는 facility 제외 (Haversine 불가)", () => {
    const r = findNearby(37.5812, 127.0042, facilities);
    expect(r.find(c => c.name === "좌표없음")).toBeUndefined();
  });

  it("최대 5건 슬라이스", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      crname: `시설${i}`, la: String(37.5812 + i * 0.0001), lo: "127.0042", crtypename: "민간",
    }));
    const r = findNearby(37.5812, 127.0042, many);
    expect(r.length).toBe(5);
  });

  it("매칭 0건이면 빈 배열", () => {
    const r = findNearby(35.0, 129.0, facilities);
    expect(r).toEqual([]);
  });
});

describe("buildRegionFacilityMap", () => {
  it("같은 시군구 여러 row 중 좌표 보유 facility 가 가장 많은 row 선택", () => {
    const regions = [
      // 강북구 — 좌표 0건 (오래된 스냅샷)
      { region: "서울", gu: "강북구", childcare: { facilities: [{ crname: "A" }, { crname: "B" }] } },
      // 강북구 — 좌표 2건 (최신 70 필드)
      { region: "서울", gu: "강북구", childcare: { facilities: [{ crname: "A", la: "37.6", lo: "127.0" }, { crname: "B", la: "37.6", lo: "127.0" }] } },
    ];
    const map = buildRegionFacilityMap(regions);
    const facs = map.get("서울|강북구") ?? [];
    expect(facs.length).toBe(2);
    expect(facs[0].la).toBe("37.6"); // 좌표 보유 row 채택
  });

  it("gu 없는 row 는 무시", () => {
    const regions = [
      { region: "서울", gu: null, childcare: { facilities: [{ crname: "X", la: "37.5", lo: "127.0" }] } },
    ];
    const map = buildRegionFacilityMap(regions);
    expect(map.size).toBe(0);
  });
});
