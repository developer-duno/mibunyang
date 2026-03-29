/**
 * collect-unsold-kosis.mjs 테스트 — KOSIS 미분양 순수 함수 검증
 *
 * 대상: parseKosisRows, aggregateRegionTotals, calcProportionalUnsold
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
  };
});

const { parseKosisRows, aggregateRegionTotals, calcProportionalUnsold } =
  await import("./collect-unsold-kosis.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** KOSIS 행 팩토리 */
function makeRow(c1, c2, period, value) {
  return { C1_NM: c1, C2_NM: c2, PRD_DE: period, DT: String(value) };
}

// ── parseKosisRows ────────────────────────────────────────────
describe("parseKosisRows", () => {
  it("빈 배열 → 빈 객체", () => {
    expect(parseKosisRows([])).toEqual({});
  });

  it("단일 시군구 행 → 올바른 매핑", () => {
    const rows = [makeRow("서울", "강남구", "202601", 150)];
    const result = parseKosisRows(rows);
    expect(result["서울"]["강남구"]).toBe(150);
  });

  it("'계' 행 → '_total' 키로 매핑", () => {
    const rows = [makeRow("서울", "계", "202601", 500)];
    const result = parseKosisRows(rows);
    expect(result["서울"]["_total"]).toBe(500);
  });

  it("같은 키의 이전 월 데이터 → 최신 월로 덮어씀", () => {
    const rows = [
      makeRow("서울", "강남구", "202601", 100),
      makeRow("서울", "강남구", "202602", 200), // 최신
    ];
    const result = parseKosisRows(rows);
    expect(result["서울"]["강남구"]).toBe(200);
  });

  it("알 수 없는 시도명 → 무시", () => {
    const rows = [makeRow("미국", "뉴욕", "202601", 100)];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("DT가 숫자 아님 → 무시", () => {
    const rows = [makeRow("서울", "강남구", "202601", "abc")];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("정식명 '서울특별시' → '서울' 매핑", () => {
    const rows = [makeRow("서울특별시", "종로구", "202601", 50)];
    const result = parseKosisRows(rows);
    expect(result["서울"]["종로구"]).toBe(50);
  });
});

// ── aggregateRegionTotals ─────────────────────────────────────
describe("aggregateRegionTotals", () => {
  it("빈 객체 → 빈 객체", () => {
    expect(aggregateRegionTotals({})).toEqual({});
  });

  it("'_total' 키 있으면 그대로 사용", () => {
    const result = aggregateRegionTotals({ "서울": { "_total": 500, "강남구": 150 } });
    expect(result["서울"]).toBe(500);
  });

  it("'소계' 키 있으면 우선 사용", () => {
    const result = aggregateRegionTotals({ "경기": { "소계": 1000, "수원시": 200 } });
    expect(result["경기"]).toBe(1000);
  });

  it("합계 키 없으면 시군구 합산", () => {
    const result = aggregateRegionTotals({ "부산": { "해운대구": 100, "남구": 200 } });
    expect(result["부산"]).toBe(300);
  });
});

// ── calcProportionalUnsold ────────────────────────────────────
describe("calcProportionalUnsold", () => {
  it("정상 비례배분 계산", () => {
    // 구 미분양 50, 단지 200세대, 구 전체 1000세대 → 10세대, 5%
    const result = calcProportionalUnsold(50, 200, 1000);
    expect(result.estimated).toBe(10);
    expect(result.unsoldRate).toBe(5.0);
  });

  it("비정상 unsoldRate > 100% → null", () => {
    // 구 미분양 1000, 단지 100세대, 구 전체 500세대 → 200세대, 200% → null
    const result = calcProportionalUnsold(1000, 100, 500);
    expect(result).toBeNull();
  });

  it("정상 범위 내 unsoldRate", () => {
    // 구 미분양 50, 단지 500세대, 구 전체 1000세대 → 25세대, 5%
    const result = calcProportionalUnsold(50, 500, 1000);
    expect(result.estimated).toBe(25);
    expect(result.unsoldRate).toBe(5.0);
  });

  it("guUnsold 0 → null", () => {
    expect(calcProportionalUnsold(0, 100, 500)).toBeNull();
  });

  it("aptUnits 0 → null", () => {
    expect(calcProportionalUnsold(100, 0, 500)).toBeNull();
  });

  it("totalUnitsInGu 0 → null", () => {
    expect(calcProportionalUnsold(100, 50, 0)).toBeNull();
  });

  it("null 입력 → null", () => {
    expect(calcProportionalUnsold(null, 100, 500)).toBeNull();
  });

  it("경계값: unsoldRate 정확히 100.0% → 허용 (> 100 조건)", () => {
    // guUnsold=100, aptUnits=100, totalUnitsInGu=100 → estimated=100, unsoldRate=100.0
    const result = calcProportionalUnsold(100, 100, 100);
    expect(result).not.toBeNull();
    expect(result.unsoldRate).toBe(100.0);
  });

  it("경계값: unsoldRate 100.1% → null", () => {
    // guUnsold=1001, aptUnits=100, totalUnitsInGu=1000 → estimated=100, unsoldRate=100.0 (반올림)
    // 직접 100 초과 케이스: guUnsold=101, aptUnits=100, totalUnitsInGu=100 → 101, 101%
    const result = calcProportionalUnsold(101, 100, 100);
    expect(result).toBeNull();
  });
});
