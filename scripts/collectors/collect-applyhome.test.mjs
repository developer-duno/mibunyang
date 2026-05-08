// @ts-check
import { describe, it, expect, vi } from "vitest";

// collect-applyhome.mjs의 aggregateByApartment 테스트
// 이 테스트가 검증하는 것: HOUSE_MANAGE_NO별 가중평균 경쟁률 계산의 정확성

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    selectAll: vi.fn(),
    upsertBatch: vi.fn(async (_t, rows) => rows.length),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});

const { aggregateByApartment, buildEventsFromAggregated } = await import("./collect-applyhome.mjs");

// 팩토리 함수: 청약 데이터 행 생성
function makeRow(overrides = {}) {
  return {
    HOUSE_MANAGE_NO: "2024000001",
    SUPLY_HSHLDCO: "100",
    REQ_CNT: "300",
    ...overrides,
  };
}

describe("aggregateByApartment — 가중평균 경쟁률 계산", () => {
  it("단일 아파트 단일 행 → 정상 계산", () => {
    const rows = [makeRow({ SUPLY_HSHLDCO: "100", REQ_CNT: "500" })];
    const result = aggregateByApartment(rows);
    expect(result["2024000001"]).toEqual({ rate: 5, supply: 100, applicants: 500 });
  });

  it("단일 아파트 복수 행 → 가중평균", () => {
    // 아파트 하나에 타입별 2개 행
    const rows = [
      makeRow({ SUPLY_HSHLDCO: "50", REQ_CNT: "200" }),
      makeRow({ SUPLY_HSHLDCO: "50", REQ_CNT: "100" }),
    ];
    const result = aggregateByApartment(rows);
    // (200+100) / (50+50) = 3.0
    expect(result["2024000001"].rate).toBe(3);
    expect(result["2024000001"].supply).toBe(100);
    expect(result["2024000001"].applicants).toBe(300);
  });

  it("복수 아파트 → 개별 집계", () => {
    const rows = [
      makeRow({ HOUSE_MANAGE_NO: "A", SUPLY_HSHLDCO: "100", REQ_CNT: "500" }),
      makeRow({ HOUSE_MANAGE_NO: "B", SUPLY_HSHLDCO: "200", REQ_CNT: "100" }),
    ];
    const result = aggregateByApartment(rows);
    expect(result["A"].rate).toBe(5);      // 500/100
    expect(result["B"].rate).toBe(0.5);    // 100/200
  });

  it("공급 0 → rate null", () => {
    const rows = [makeRow({ SUPLY_HSHLDCO: "0", REQ_CNT: "100" })];
    const result = aggregateByApartment(rows);
    expect(result["2024000001"].rate).toBeNull();
  });

  it("HOUSE_MANAGE_NO null/빈값 → 무시", () => {
    const rows = [
      makeRow({ HOUSE_MANAGE_NO: null }),
      makeRow({ HOUSE_MANAGE_NO: "" }),
      makeRow({ HOUSE_MANAGE_NO: "A", SUPLY_HSHLDCO: "10", REQ_CNT: "30" }),
    ];
    const result = aggregateByApartment(rows);
    expect(Object.keys(result)).toEqual(["A"]);
  });

  it("빈 배열 → 빈 객체", () => {
    expect(aggregateByApartment([])).toEqual({});
  });

  it("문자열 숫자 → 정상 변환 (Number() 사용)", () => {
    const rows = [makeRow({ SUPLY_HSHLDCO: "50", REQ_CNT: "123" })];
    const result = aggregateByApartment(rows);
    expect(result["2024000001"].rate).toBe(2.46); // 123/50 = 2.46
    expect(result["2024000001"].supply).toBe(50);
    expect(result["2024000001"].applicants).toBe(123);
  });

  it("미달(신청 < 공급) → rate < 1", () => {
    const rows = [makeRow({ SUPLY_HSHLDCO: "100", REQ_CNT: "30" })];
    const result = aggregateByApartment(rows);
    expect(result["2024000001"].rate).toBe(0.3); // 30/100
    expect(result["2024000001"].rate).toBeLessThan(1);
  });
});

describe("buildEventsFromAggregated — events 객체 빌드", () => {
  it("매칭된 단지만 events 반환 (apartment_id 형식 ah-{no})", () => {
    const aggregated = {
      "2024A": { rate: 5, supply: 100, applicants: 500 },
      "2024B": { rate: 3, supply: 50, applicants: 150 },
      "2024X": { rate: 1, supply: 30, applicants: 30 }, // 매칭 안 됨
    };
    const apartments = [{ id: "ah-2024A" }, { id: "ah-2024B" }];
    const result = buildEventsFromAggregated(aggregated, apartments, "2026-05-02");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      apartment_id: "ah-2024A",
      house_manage_no: "2024A",
      supply: 100,
      applicants: 500,
      rate: 5,
      recorded_at: "2026-05-02",
    });
    expect(result[1].apartment_id).toBe("ah-2024B");
  });

  it("빈 입력 처리", () => {
    expect(buildEventsFromAggregated({}, [], "2026-05-02")).toEqual([]);
    expect(buildEventsFromAggregated({}, [{ id: "ah-X" }], "2026-05-02")).toEqual([]);
    expect(buildEventsFromAggregated({ "X": { supply: 1, applicants: 1, rate: 1 } }, [], "2026-05-02")).toEqual([]);
  });

  it("필드 매핑 정확성 (supply/applicants/rate/recorded_at 모두 정확히 들어감)", () => {
    const aggregated = { "Y": { supply: 7, applicants: 13, rate: 1.857 } };
    const apartments = [{ id: "ah-Y" }];
    const result = buildEventsFromAggregated(aggregated, apartments, "2026-12-31");

    expect(result).toEqual([{
      apartment_id: "ah-Y",
      house_manage_no: "Y",
      supply: 7,
      applicants: 13,
      rate: 1.857,
      recorded_at: "2026-12-31",
    }]);
  });
});
