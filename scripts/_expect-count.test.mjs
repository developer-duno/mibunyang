// @ts-check
import { describe, it, expect } from "vitest";
// collect-data.mjs 는 @ts-check 밖이라(tsconfig.scripts exclude) 이 시험이 그 파일을 import 하면 tsc 가 끌어와
// 오류 213건이 난다(세션635 실측) — 순수 함수는 _count-guard.mjs 에 있고 collect-data.mjs 가 그것을 import 한다.
import { evaluateCountGuard } from "./_count-guard.mjs";

describe("evaluateCountGuard — 전환일 1회용 승인 장수(세션635)", () => {
  it("감소가 임계 안이면 미발동", () => {
    expect(evaluateCountGuard({ count: 1900, prevCount: 1933, expectCount: null }).fired).toBe(false);
  });
  it("감소가 임계를 넘으면 발동(임계 = max(150, 12%))", () => {
    const r = evaluateCountGuard({ count: 1600, prevCount: 1933, expectCount: null });
    expect(r.fired).toBe(true);
    expect(r.threshold).toBe(192);
  });
  it("승인 장수와 정확히 같으면 통과", () => {
    expect(evaluateCountGuard({ count: 1600, prevCount: 1933, expectCount: 1600 }).fired).toBe(false);
  });
  it("승인 장수와 다르면 발동", () => {
    expect(evaluateCountGuard({ count: 1601, prevCount: 1933, expectCount: 1600 }).fired).toBe(true);
  });
});
