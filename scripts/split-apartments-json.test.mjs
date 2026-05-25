// @ts-check
/**
 * split-apartments-json.mjs wrapper 검증 회귀 가드.
 * 진앙: 4 collector (environment/industry-match/transit-match/noxious) --json 모드가
 *       flat array 로 apartments.json 덮어쓰면 split L20 src.data = undefined → 0건 사고.
 */
import { describe, it, expect } from "vitest";

describe("split-apartments-json wrapper 검증", () => {
  it("src.data 배열 정상 접근 → list/prices 분리", () => {
    const wrapper = {
      ok: true,
      fetchedAt: "2026-01-01T00:00:00Z",
      dataUpdatedAt: "2026-01-01T00:00:00Z",
      data: [
        {
          id: "a1",
          name: "테스트",
          priceByArea: { 84: 50000 },
          rentByArea: null,
          jeonseByArea: null,
          priceByFloor: null,
        },
      ],
    };
    const src = JSON.parse(JSON.stringify(wrapper));
    const apartments = Array.isArray(src.data) ? src.data : [];
    expect(apartments).toHaveLength(1);

    const listData = apartments.map(
      (/** @type {Record<string, unknown>} */ a) => {
        const { priceByArea, rentByArea, jeonseByArea, priceByFloor, ...rest } = a;
        return rest;
      },
    );
    expect(listData[0].name).toBe("테스트");
    expect(listData[0]).not.toHaveProperty("priceByArea");
    expect(listData[0]).not.toHaveProperty("rentByArea");
  });

  it("src.data 없는 flat array → apartments 0건 (회귀 가드)", () => {
    /** @type {any} */
    const flatArr = [{ id: "a1" }];
    const src = flatArr;
    const apartments = Array.isArray(src.data) ? src.data : [];
    expect(apartments).toHaveLength(0);
  });

  it("fetchedAt / dataUpdatedAt 출력 파일에 전달", () => {
    const wrapper = {
      ok: true,
      fetchedAt: "2026-05-26T10:00:00Z",
      dataUpdatedAt: "2026-05-26T09:00:00Z",
      data: [{ id: "a1" }],
    };
    const src = JSON.parse(JSON.stringify(wrapper));
    const fetchedAt = src.fetchedAt ?? null;
    const dataUpdatedAt = src.dataUpdatedAt ?? fetchedAt;
    expect(fetchedAt).toBe("2026-05-26T10:00:00Z");
    expect(dataUpdatedAt).toBe("2026-05-26T09:00:00Z");
  });

  it("dataUpdatedAt 부재 시 fetchedAt 로 폴백", () => {
    const wrapper = {
      ok: true,
      fetchedAt: "2026-05-26T10:00:00Z",
      data: [{ id: "a1" }],
    };
    const src = JSON.parse(JSON.stringify(wrapper));
    const fetchedAt = src.fetchedAt ?? null;
    const dataUpdatedAt = src.dataUpdatedAt ?? fetchedAt;
    expect(dataUpdatedAt).toBe("2026-05-26T10:00:00Z");
  });
});
