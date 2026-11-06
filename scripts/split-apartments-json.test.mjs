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

  // 세션698 A10 — 운영 빌드 길 = Vercel prebuild 가 커밋된 apartments.json 을 이 스크립트로 쪼갠다(prebuild.mjs:8~13).
  //   이 길에서 createdAt 이 빠지면 운영 postbuild 는 칸이 없어 새 단지를 못 세고(옛 단지로 셈) 시험만 초록이 된다.
  it("A10: apartments.json 행의 createdAt 이 쪼갠 목록에 남고(버킷엔 없음) → 그 목록으로 planThin 이 새 단지를 센다", async () => {
    const { buildDetailBuckets } = await import("./static-outputs.mjs");
    const { excludeLeaseUnits } = await import("../src/constants/leaseTypes.mjs");
    const { planThin } = await import("./postbuild-prerender.mjs");
    const thinRow = (/** @type {string} */ id, /** @type {string | null} */ createdAt) =>
      ({ id, name: `단지${id}`, nearbyMedian: null, hospital: null, price: 50000, priceByArea: null, createdAt });
    const wrapper = {
      ok: true,
      fetchedAt: "2026-11-05T18:10:16.443Z",
      data: [
        ...Array.from({ length: 19 }, (_, i) => thinRow(`n${i}`, "2026-11-05T03:00:00.000Z")),
        thinRow("o1", "2026-01-01T00:00:00.000Z"),
        thinRow("o2", null),
      ],
    };
    // split 과 같은 순서: 파일 글자 → JSON.parse → excludeLeaseUnits → buildListData
    const src = JSON.parse(JSON.stringify(wrapper));
    const visible = excludeLeaseUnits(src.data);
    const listData = /** @type {any[]} */ (buildListData(visible));
    expect(listData.find((r) => r.id === "n0").createdAt).toBe("2026-11-05T03:00:00.000Z");
    expect(listData.find((r) => r.id === "o2").createdAt).toBeNull();
    for (const b of buildDetailBuckets(visible)) for (const r of b.data) expect("createdAt" in r).toBe(false);
    // 쪼갠 목록 그대로 → 21곳 얇음 · 새 단지 19 → 옛 2 ≤ 15 → applied
    expect(planThin(listData, new Date("2026-11-06T11:00:00Z"))).toMatchObject({ count: 21, newCount: 19, applied: true });
  });

  it("A10 배선: split 스크립트는 excludeLeaseUnits → buildListData(visible) 결과를 그대로 목록 파일에 쓴다", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync(new URL("./split-apartments-json.mjs", import.meta.url), "utf-8");
    expect(s).toMatch(/const visible = excludeLeaseUnits\(apartments\);/);
    expect(s).toMatch(/const listData = buildListData\(visible\);/);
    expect(s).toMatch(/writeFileSync\(resolve\(DATA_DIR, "apartments-list\.json"\), JSON\.stringify\(\{ ok: true, data: listData,/);
  });
});
