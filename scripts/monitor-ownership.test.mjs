// @ts-check
/**
 * 감시 ⑲ 공유 DB 소유권 정본 대조 시험 (세션617 · 설계서 §1-2)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkOwnershipColumns, fetchSharedTableColumns, loadOwnershipRegistry, runOwnershipCheck } from "./monitor-collectors.mjs";

const registry = {
  tables: {
    infra: { owner: "shared", columns: { mibunyang: ["apartment_id", "hospital"], "2u": ["crime_score"], clock: ["updated_at"] } },
    apartments: { owner: "mibunyang" },
  },
};
const OK_COLS = ["apartment_id", "hospital", "crime_score", "updated_at"];

describe("checkOwnershipColumns", () => {
  it("DB 칸 = 정본 칸 합집합 → 이상 0", () => {
    expect(checkOwnershipColumns(registry, { infra: OK_COLS })).toEqual([]);
  });

  it("정본에 없는 칸(손 DDL) → ownership-drift 1건, 칸 이름이 상세 줄에", () => {
    const issues = checkOwnershipColumns(registry, { infra: [...OK_COLS, "kakao_updated_at"] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "ownership-drift", collector: "ownership" });
    expect(issues[0].detail).toBe("infra: 정본에 없는 칸 1 · DB 에 없는 칸 0");
    expect(issues[0].lines?.join(" ")).toContain("kakao_updated_at");
  });

  it("정본엔 있는데 DB 에 없는 칸 → 1건", () => {
    const issues = checkOwnershipColumns(registry, { infra: OK_COLS.filter((c) => c !== "crime_score") });
    expect(issues[0].detail).toBe("infra: 정본에 없는 칸 0 · DB 에 없는 칸 1");
    expect(issues[0].lines?.join(" ")).toContain("crime_score");
  });

  it("빈 표(null)·공유가 아닌 표는 판정 안 함", () => {
    expect(checkOwnershipColumns(registry, { infra: null })).toEqual([]);
    expect(checkOwnershipColumns(registry, { infra: OK_COLS, apartments: ["x"] })).toEqual([]);
  });
});

describe("fetchSharedTableColumns(가짜 sb)", () => {
  it("한 행의 키가 칸 목록 · 빈 표는 null · 오류는 throw", async () => {
    const sb = {
      from: (/** @type {string} */ t) => ({
        select: () => ({
          limit: async () =>
            t === "infra" ? { data: [{ apartment_id: "a", hospital: null }], error: null } : t === "empty" ? { data: [], error: null } : { data: null, error: { message: "boom" } },
        }),
      }),
    };
    expect(await fetchSharedTableColumns(["infra", "empty"], sb)).toEqual({ infra: ["apartment_id", "hospital"], empty: null });
    await expect(fetchSharedTableColumns(["bad"], sb)).rejects.toThrow("bad 칸 목록 조회 실패: boom");
  });
});

describe("runOwnershipCheck — fail-open", () => {
  it("조회 실패 → check-failed 1건(감시는 계속)", async () => {
    const issues = await runOwnershipCheck({ loadRegistry: () => registry, fetchColumns: async () => { throw new Error("boom"); } });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("check-failed");
    expect(issues[0].detail).toBe("⑲ 소유권 정본 대조 실행 실패 — boom");
  });

  it("공유 표만 묻는다 · 실제 정본은 공유 4표", async () => {
    /** @type {string[]} */
    let asked = [];
    await runOwnershipCheck({ loadRegistry: () => registry, fetchColumns: async (t) => ((asked = t), { infra: OK_COLS }) });
    expect(asked).toEqual(["infra"]);
    const real = loadOwnershipRegistry();
    expect(Object.keys(real.tables).filter((t) => real.tables[t].owner === "shared").sort()).toEqual(["articles", "complex_price_history", "complexes", "infra"]);
  });
});

describe("main 배선", () => {
  const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
  it("⑲ 는 runDailyGuardedChecks 바로 뒤, KST 월요일(또는 수동 강제)에만", () => {
    expect(src).toMatch(/issues = issues\.concat\(await runDailyGuardedChecks\(\)\);\s*\r?\n(?:\s*\/\/[^\n]*\r?\n)+\s*if \(isKstMonday\(\) \|\| process\.env\.FORCE_DB_PERMISSION_AUDIT === "1"\) \{\s*\r?\n\s*issues = issues\.concat\(await runOwnershipCheck\(\)\);/);
  });
});
