/**
 * regulation-seed.mjs 테스트 — 규제지역 순수 함수 검증
 *
 * 대상: buildRegulatedSet, makeRegionKey
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    ROOT: orig.ROOT,
  };
});

const { buildRegulatedSet, makeRegionKey } = await import("./regulation-seed.mjs");

// ── buildRegulatedSet ─────────────────────────────────────────
describe("buildRegulatedSet", () => {
  it("투기과열지구 + 조정대상지역 → 합산 Set", () => {
    const zones = {
      "투기과열지구": ["서울 강남구", "서울 서초구"],
      "조정대상지역": ["경기 수원시", "서울 강남구"], // 중복
    };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(3); // 중복 제거
    expect(result.has("서울 강남구")).toBe(true);
    expect(result.has("경기 수원시")).toBe(true);
  });

  it("빈 zones → 빈 Set", () => {
    const result = buildRegulatedSet({});
    expect(result.size).toBe(0);
  });

  it("한쪽만 있는 경우", () => {
    const zones = { "투기과열지구": ["서울 종로구"] };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(1);
    expect(result.has("서울 종로구")).toBe(true);
  });

  it("null 리스트 → 무시", () => {
    const zones = { "투기과열지구": null, "조정대상지역": ["경기 성남시"] };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(1);
  });
});

// ── makeRegionKey ─────────────────────────────────────────────
describe("makeRegionKey", () => {
  it("region + gu → '서울 강남구'", () => {
    expect(makeRegionKey("서울", "강남구")).toBe("서울 강남구");
  });

  it("gu null → 'region'만", () => {
    expect(makeRegionKey("세종", null)).toBe("세종");
  });

  it("region null → 'gu'만", () => {
    expect(makeRegionKey(null, "강남구")).toBe("강남구");
  });

  it("모두 null → 빈 문자열", () => {
    expect(makeRegionKey(null, null)).toBe("");
  });

  it("undefined 처리 → null과 동일", () => {
    expect(makeRegionKey(undefined, undefined)).toBe("");
  });
});
