// @ts-check
/**
 * `air-annual-attach.mjs` 회귀 가드 (세션560).
 *
 * 가장 중요한 것은 `countResults` 다 — 이 가드가 없어서 **거짓 성공 보고**가 실제로 났다.
 * 2,992건이 전부 실패(NOT NULL 위반)했는데 로그와 `collector_runs` 는 "성공 2992 · 실패 0".
 * 보낸 건수를 그대로 더했기 때문이다.
 */
import { describe, it, expect } from "vitest";
import { buildAnnual, needsUpdate, countResults } from "./air-annual-attach.mjs";

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
