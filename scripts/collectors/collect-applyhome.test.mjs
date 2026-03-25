import { describe, it, expect } from "vitest";

// aggregateByApartment를 직접 import할 수 없으므로 (export 안 됨) 동일 로직으로 테스트
// 이 테스트가 검증하는 것: HOUSE_MANAGE_NO별 가중평균 경쟁률 계산의 정확성

// collect-applyhome.mjs의 aggregateByApartment 로직 재현 (순수 함수)
function aggregateByApartment(rows) {
  const groups = {};
  for (const row of rows) {
    const no = row.HOUSE_MANAGE_NO;
    if (!no) continue;
    if (!groups[no]) groups[no] = [];
    groups[no].push(row);
  }

  const result = {};
  for (const [no, items] of Object.entries(groups)) {
    let totalSupply = 0;
    let totalApplicants = 0;

    for (const item of items) {
      const supply = Number(item.SUPLY_HSHLDCO) || 0;
      const applicants = Number(item.REQ_CNT) || 0;
      totalSupply += supply;
      totalApplicants += applicants;
    }

    const rate = totalSupply > 0
      ? Math.round((totalApplicants / totalSupply) * 100) / 100
      : null;

    result[no] = { rate, supply: totalSupply, applicants: totalApplicants };
  }

  return result;
}

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
