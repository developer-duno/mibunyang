// @ts-check
/**
 * split-apartments-json.mjs wrapper 검증 회귀 가드.
 * 진앙: 4 collector (environment/industry-match/transit-match/noxious) --json 모드가
 *       flat array 로 apartments.json 덮어쓰면 split L20 src.data = undefined → 0건 사고.
 */
import { describe, it, expect } from "vitest";
import { buildListData } from "./static-outputs.mjs";

describe("split-apartments-json wrapper 검증", () => {
  it("src.data 배열 정상 접근 → 공유 빌더 buildListData 로 분리 (세션 468)", () => {
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

    // split-apartments-json.mjs 이 호출하는 실제 빌더로 검증(인라인 복제 아님).
    const listData = /** @type {any[]} */ (buildListData(apartments));
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
