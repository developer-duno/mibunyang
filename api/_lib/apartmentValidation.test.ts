import { describe, it, expect } from "vitest";
import { parseApartmentIds, ID_PATTERN } from "./apartmentValidation.js";

describe("ID_PATTERN", () => {
  it("유효 패턴 통과", () => {
    expect(ID_PATTERN.test("ah-1")).toBe(true);
    expect(ID_PATTERN.test("ah-12345")).toBe(true);
    expect(ID_PATTERN.test("ah-0")).toBe(true);
  });

  it("무효 패턴 거부", () => {
    expect(ID_PATTERN.test("")).toBe(false);
    expect(ID_PATTERN.test("ah-")).toBe(false);
    expect(ID_PATTERN.test("ah-abc")).toBe(false);
    expect(ID_PATTERN.test("1234")).toBe(false);
    expect(ID_PATTERN.test("DROP TABLE")).toBe(false);
    expect(ID_PATTERN.test("ah-1; DROP TABLE")).toBe(false);
    expect(ID_PATTERN.test(" ah-1")).toBe(false);
  });

  // ap- 접두 허용 (네이버 분양 단지 id) — D3, 세션574
  it("ap- 접두 유효 패턴 통과", () => {
    expect(ID_PATTERN.test("ap-6028351")).toBe(true);
    expect(ID_PATTERN.test("ah-2026910133")).toBe(true);
    expect(ID_PATTERN.test("ap-0")).toBe(true);
  });

  it("ah-/ap- 두 접두 밖은 거부", () => {
    expect(ID_PATTERN.test("ab-1")).toBe(false);
    expect(ID_PATTERN.test("ahp-1")).toBe(false);
    expect(ID_PATTERN.test("AP-1")).toBe(false);
    expect(ID_PATTERN.test("ap-")).toBe(false);
    expect(ID_PATTERN.test("ap")).toBe(false);
    expect(ID_PATTERN.test("-6028351")).toBe(false);
    expect(ID_PATTERN.test("ap-1; DROP TABLE")).toBe(false);
    expect(ID_PATTERN.test(" ap-1")).toBe(false);
    expect(ID_PATTERN.test("ah-ap-1")).toBe(false);
  });
});

describe("parseApartmentIds", () => {
  // 정상: 단일 ID
  it("단일 apartment_id → { id }", () => {
    const result = parseApartmentIds({ apartment_id: "ah-123" });
    expect(result).toEqual({ id: "ah-123" });
  });

  // 정상: 복수 IDs
  it("복수 apartment_ids → { ids }", () => {
    const result = parseApartmentIds({ apartment_ids: "ah-1,ah-2,ah-3" });
    expect(result).toEqual({ ids: ["ah-1", "ah-2", "ah-3"] });
  });

  // 정상: 공백 포함 IDs (trim 처리)
  it("공백 포함 IDs → trim 후 정상 처리", () => {
    const result = parseApartmentIds({ apartment_ids: " ah-1 , ah-2 " });
    expect(result).toEqual({ ids: ["ah-1", "ah-2"] });
  });

  // apartment_ids 우선
  it("둘 다 있으면 apartment_ids 우선", () => {
    const result = parseApartmentIds({ apartment_ids: "ah-1", apartment_id: "ah-2" });
    expect(result).toEqual({ ids: ["ah-1"] });
  });

  // 에러: 빈 파라미터
  it("파라미터 없으면 에러", () => {
    const result = parseApartmentIds({}) as any;
    expect(result.error).toBe("apartment_id 또는 apartment_ids 파라미터가 필요합니다");
    expect(result.status).toBe(400);
  });

  // 에러: 빈 문자열
  it("빈 문자열 → 에러", () => {
    const result = parseApartmentIds({ apartment_id: "", apartment_ids: "" }) as any;
    expect(result.error).toBeDefined();
    expect(result.status).toBe(400);
  });

  // 에러: 21개 초과
  it("21개 초과 IDs → 에러", () => {
    const ids = Array.from({ length: 21 }, (_, i) => `ah-${i}`).join(",");
    const result = parseApartmentIds({ apartment_ids: ids }) as any;
    expect(result.error).toBe("apartment_ids는 1~20개 사이여야 합니다");
    expect(result.status).toBe(400);
  });

  // 에러: 잘못된 형식
  it("잘못된 ID 형식 → 에러", () => {
    const result = parseApartmentIds({ apartment_id: "invalid" }) as any;
    expect(result.error).toBe("잘못된 apartment_id 형식입니다");
  });

  // 에러: 복수 중 하나라도 잘못된 형식
  it("복수 IDs 중 잘못된 형식 → 에러", () => {
    const result = parseApartmentIds({ apartment_ids: "ah-1,INVALID,ah-3" }) as any;
    expect(result.error).toBe("잘못된 apartment_id 형식입니다");
  });

  // 에러: SQL injection 시도
  it("SQL injection 시도 거부", () => {
    const result = parseApartmentIds({ apartment_id: "ah-1; DROP TABLE apartments" }) as any;
    expect(result.error).toBeDefined();
    expect(result.status).toBe(400);
  });

  // 경계: 20개 정확히 → 통과
  it("20개 IDs → 정상 통과", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `ah-${i}`).join(",");
    const result = parseApartmentIds({ apartment_ids: ids }) as any;
    expect(result.ids).toHaveLength(20);
  });

  // ap- 접두 혼합 (D3, 세션574)
  it("ah-/ap- 접두 혼합 배열 → 통과", () => {
    const result = parseApartmentIds({ apartment_ids: "ah-1,ap-2" });
    expect(result).toEqual({ ids: ["ah-1", "ap-2"] });
  });

  it("단일 ap- apartment_id → { id }", () => {
    const result = parseApartmentIds({ apartment_id: "ap-6028351" });
    expect(result).toEqual({ id: "ap-6028351" });
  });

  it("ap- 포함 배열 중 하나라도 잘못된 형식 → 에러", () => {
    const result = parseApartmentIds({ apartment_ids: "ap-1,INVALID" }) as any;
    expect(result.error).toBe("잘못된 apartment_id 형식입니다");
    expect(result.status).toBe(400);
  });
});
