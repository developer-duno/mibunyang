// @ts-check
/**
 * `air-annual-attach.mjs` 회귀 가드 (세션560).
 *
 * 가장 중요한 것은 `countResults` 다 — 이 가드가 없어서 **거짓 성공 보고**가 실제로 났다.
 * 2,992건이 전부 실패(NOT NULL 위반)했는데 로그와 `collector_runs` 는 "성공 2992 · 실패 0".
 * 보낸 건수를 그대로 더했기 때문이다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildAnnual,
  needsUpdate,
  countResults,
  shouldClearAnnual,
  clearAllowed,
  planClearWrite,
  attachRunRecord,
  CLEAR_LIMIT,
} from "./air-annual-attach.mjs";

/** @type {Map<string, { pm25: number | null; pm10: number | null; o3: number | null; years: string | null }>} */
const TABLE = new Map([
  ["강서구", { pm25: 18.27, pm10: 37.32, o3: 0.0319, years: "2022,2023,2024" }],
  ["pm25없음", { pm25: null, pm10: 30, o3: 0.03, years: "2022,2023,2024" }],
]);

describe("countResults — 보낸 수가 아니라 돌아온 결과를 센다", () => {
  it("전부 실패하면 ok=0 (세션560 실사고: 여기서 2992 를 보고했다)", () => {
    const results = Array.from({ length: 500 }, () => ({
      error: { message: 'null value in column "name" violates not-null constraint' },
    }));
    const t = countResults(results);
    expect(t.ok).toBe(0);
    expect(t.fail).toBe(500);
    expect(t.firstError).toContain("not-null");
  });
  it("전부 성공하면 fail=0", () => {
    const t = countResults(Array.from({ length: 7 }, () => ({ error: null })));
    expect(t).toEqual({ ok: 7, fail: 0, firstError: null });
  });
  it("섞이면 양쪽 다 센다 — 합이 보낸 건수와 같다", () => {
    const results = [{ error: null }, { error: { message: "boom" } }, { error: null }];
    const t = countResults(results);
    expect(t.ok).toBe(2);
    expect(t.fail).toBe(1);
    expect(t.ok + t.fail).toBe(results.length);
    expect(t.firstError).toBe("boom");
  });
  it("빈 배열은 0/0", () => {
    expect(countResults([])).toEqual({ ok: 0, fail: 0, firstError: null });
  });
});

describe("buildAnnual — 못 찾으면 null(=중립 폴백으로 보낸다)", () => {
  it("측정소가 표에 있으면 세 항목 + years 를 돌려준다", () => {
    expect(buildAnnual({ station: "강서구" }, TABLE)).toEqual({
      pm25: 18.27,
      pm10: 37.32,
      o3: 0.0319,
      years: "2022,2023,2024",
    });
  });
  it("표에 없는 측정소는 null — 억지로 채우지 않는다", () => {
    expect(buildAnnual({ station: "없는측정소" }, TABLE)).toBeNull();
  });
  it("pm25 가 없으면 null — 채점에 못 쓰는 값은 붙이지 않는다", () => {
    expect(buildAnnual({ station: "pm25없음" }, TABLE)).toBeNull();
  });
  it("station 키 자체가 없거나 빈 문자열이면 null", () => {
    expect(buildAnnual({}, TABLE)).toBeNull();
    expect(buildAnnual({ station: "" }, TABLE)).toBeNull();
    expect(buildAnnual(null, TABLE)).toBeNull();
  });
});

describe("needsUpdate — 멱등(같은 값이면 다시 쓰지 않는다)", () => {
  const next = { pm25: 18.27, pm10: 37.32, o3: 0.0319, years: "2022,2023,2024" };
  it("기존이 없으면 갱신 필요", () => {
    expect(needsUpdate(null, next)).toBe(true);
    expect(needsUpdate(undefined, next)).toBe(true);
  });
  it("네 칸이 모두 같으면 갱신 불필요", () => {
    expect(needsUpdate({ ...next }, next)).toBe(false);
  });
  it("한 칸이라도 다르면 갱신 필요", () => {
    expect(needsUpdate({ ...next, pm25: 18.28 }, next)).toBe(true);
    expect(needsUpdate({ ...next, years: "2021,2022,2023" }, next)).toBe(true);
  });
});

describe("shouldClearAnnual — 측정소가 표에서 빠지면 옛 annual 을 비운다(사장님 결정 2026-10-07)", () => {
  const old = { pm25: 18.27, pm10: 37.32, o3: 0.0319, years: "2022,2023,2024" };
  it("표에 없는 측정소 + 옛 annual 있음 → 비움(중립 14점으로)", () => {
    const aq = { station: "폐쇄측정소", annual: old };
    expect(shouldClearAnnual(aq, buildAnnual(aq, TABLE))).toBe(true);
  });
  it("이미 비어 있으면(null·없음) 다시 쓰지 않는다 — 멱등", () => {
    expect(shouldClearAnnual({ station: "폐쇄측정소", annual: null }, null)).toBe(false);
    expect(shouldClearAnnual({ station: "폐쇄측정소" }, null)).toBe(false);
  });
  it("새 평균을 만들 수 있으면 비우지 않는다", () => {
    const aq = { station: "강서구", annual: old };
    expect(shouldClearAnnual(aq, buildAnnual(aq, TABLE))).toBe(false);
  });
});

describe("clearAllowed — 비움 차단기(30곳 초과면 비움 안 씀, --expect-clear=N 정확 일치만 우회)", () => {
  it("30곳까지는 진행 · 31곳은 차단", () => {
    expect(clearAllowed(30, null)).toBe(true);
    expect(clearAllowed(31, null)).toBe(false);
  });
  it("--expect-clear=31 이면 31곳 진행, 값이 다르면 차단", () => {
    expect(clearAllowed(31, 31)).toBe(true);
    expect(clearAllowed(31, 30)).toBe(false);
    expect(clearAllowed(3000, 31)).toBe(false);
  });
});

describe("planClearWrite · attachRunRecord — 비움 차단의 main 배선(세션611 · 세션606 재검사관 C ③b)", () => {
  /** @param {number} n @param {string} tag */
  const rows = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, air_quality: { annual: null } }));
  it("비움이 상한 안이면 붙이기 + 비움을 쓴다 · 넘으면 붙이기만 쓰고 차단 표시", () => {
    const ok = planClearWrite(rows(2, "u"), rows(CLEAR_LIMIT, "c"), null);
    expect(ok.clearBlocked).toBe(false);
    expect(ok.rows).toHaveLength(2 + CLEAR_LIMIT);
    const blocked = planClearWrite(rows(2, "u"), rows(CLEAR_LIMIT + 1, "c"), null);
    expect(blocked.clearBlocked).toBe(true);
    expect(blocked.rows.map((r) => r.id)).toEqual(["u0", "u1"]);
  });
  it("--expect-clear=N 이 정확히 맞으면 상한을 넘어도 쓴다", () => {
    const p = planClearWrite(rows(1, "u"), rows(31, "c"), 31);
    expect(p.clearBlocked).toBe(false);
    expect(p.rows).toHaveLength(32);
  });
  it("차단된 회차는 붙이기가 다 돼도 failure 로 남긴다 · 아니면 결과 그대로", () => {
    const result = { ok: 5, fail: 0, skip: 0, elapsed: "1.0", status: "success" };
    expect(attachRunRecord(result, true, 31)).toEqual({
      ...result,
      status: "failure",
      errorMessage: `옛 annual 비움 31곳 > ${CLEAR_LIMIT} 차단(--expect-clear 필요)`,
    });
    expect(attachRunRecord(result, false, 31)).toBe(result);
  });
  it("main 은 planClearWrite 의 rows 만 쓰고, 기록은 attachRunRecord 로 남긴다(소스 배선)", () => {
    const src = readFileSync(new URL("./air-annual-attach.mjs", import.meta.url), "utf8");
    const start = src.indexOf("async function main()");
    expect(start).toBeGreaterThan(0);
    // main 본문만 · 줄 주석 걷어냄(주석 처리된 배선이 "있음"으로 잡히지 않게)
    const main = src
      .slice(start)
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(main).toMatch(/const\s*\{\s*rows:\s*toWrite\s*,\s*clearBlocked\s*\}\s*=\s*planClearWrite\(\s*updates\s*,\s*clears\s*,\s*expectClear\s*\)/);
    expect(main).toMatch(/const\s+slice\s*=\s*toWrite\.slice\(/);
    expect(main).toMatch(/recordCollectorRun\(\s*PHASE\s*,\s*attachRunRecord\(\s*result\s*,\s*clearBlocked\s*,\s*clears\.length\s*\)\s*\)/);
    expect(main).not.toMatch(/updates\.slice\(|updates\.push\(\s*\.\.\.clears/);
  });
});
