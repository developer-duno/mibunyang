/**
 * collect-market-stats.mjs 테스트 — KOSIS 시장통계 순수 함수 검증
 *
 * 대상: extractLatestByRegion, parseAllPeriodsByRegion
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
    logError: vi.fn(),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
    sleep: vi.fn(),
  };
});

const { extractLatestByRegion, parseAllPeriodsByRegion } = await import("./collect-market-stats.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
function makeRow(c1, c2, period, value) {
  return { C1_NM: c1, C2_NM: c2, PRD_DE: period, DT: String(value) };
}

function makeIndicator(parseFn = parseFloat) {
  return { parse: parseFn };
}

// ── extractLatestByRegion ─────────────────────────────────────
describe("extractLatestByRegion", () => {
  it("빈 배열 → 빈 객체", () => {
    expect(extractLatestByRegion([], makeIndicator())).toEqual({});
  });

  it("단일 시도 행 → 올바른 매핑", () => {
    const rows = [makeRow("서울", null, "202601", "105.3")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"]).toEqual({ value: 105.3, period: "202601" });
  });

  it("C2_NM이 '전체'인 행만 사용", () => {
    const rows = [
      makeRow("서울", "전체", "202601", "100.0"),
      makeRow("서울", "강남구", "202601", "120.0"), // 무시됨
    ];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"].value).toBe(100.0);
  });

  it("같은 지역 최신 기간 덮어쓰기", () => {
    const rows = [
      makeRow("경기", null, "202601", "90.0"),
      makeRow("경기", null, "202603", "95.0"), // 최신
    ];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["경기"]).toEqual({ value: 95.0, period: "202603" });
  });

  it("매핑 안 되는 시도명 → 무시", () => {
    const rows = [makeRow("전국", null, "202601", "100.0")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("parseInt 파서 적용", () => {
    const rows = [makeRow("서울", null, "202601", "12345")];
    const result = extractLatestByRegion(rows, makeIndicator(parseInt));
    expect(result["서울"].value).toBe(12345);
  });

  it("DT가 숫자 아님 → 무시", () => {
    const rows = [makeRow("서울", null, "202601", "-")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("C2_NM=null인 행 → 포함 (C2_NM falsy 조건 mutation 방지)", () => {
    const rows = [makeRow("서울", null, "202601", "100.0")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"]).toBeDefined();
  });

  it("C2_NM='강남구' 등 비전체 행 → 제외 (필터 mutation 방지)", () => {
    const rows = [
      makeRow("서울", "전체", "202601", "100.0"),
      makeRow("서울", "강남구", "202601", "150.0"),
      makeRow("서울", "서초구", "202601", "140.0"),
    ];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"].value).toBe(100.0);
    expect(result["서울"].value).not.toBe(150.0);
  });
});

// ── parseAllPeriodsByRegion (시계열 보존) ──────────────────────
describe("parseAllPeriodsByRegion", () => {
  it("월간 3개월치 → 3행 반환 (모든 PRD_DE 보존)", () => {
    const rows = [
      makeRow("서울", null, "202601", "100.0"),
      makeRow("서울", null, "202602", "101.0"),
      makeRow("서울", null, "202603", "102.0"),
    ];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(3);
    expect(result.map(r => r.base_month)).toEqual(["202601", "202602", "202603"]);
    expect(result[0]).toEqual({ region: "서울", gu: null, base_month: "202601", value: 100.0 });
  });

  it("분기 PRD_DE '20261' (5자리) → 허용", () => {
    const rows = [makeRow("서울", null, "20261", "85.5")];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(1);
    expect(result[0].base_month).toBe("20261");
  });

  it("PRD_DE 포맷 위반 ('2026Q1', '20261A', '2026') → 무시", () => {
    const rows = [
      makeRow("서울", null, "2026Q1", "100.0"),
      makeRow("서울", null, "20261A", "100.0"),
      makeRow("서울", null, "2026", "100.0"),
    ];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(0);
  });

  it("REGION_MAP 매핑 실패 (전국) → 무시", () => {
    const rows = [makeRow("전국", null, "202601", "100.0")];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(0);
  });

  it("DT NaN ('-') → 무시", () => {
    const rows = [
      makeRow("서울", null, "202601", "-"),
      makeRow("서울", null, "202602", "100.0"),
    ];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(1);
    expect(result[0].base_month).toBe("202602");
  });
});
