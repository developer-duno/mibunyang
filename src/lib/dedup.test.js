import { describe, it, expect } from "vitest";
import { dedupApartments } from "./dedup";

// 테스트 데이터 팩토리
function makeApt(overrides = {}) {
  return { id: "ah-001", name: "테스트아파트", region: "서울", gu: "강남구", dong: "역삼동", ...overrides };
}

describe("dedupApartments", () => {
  // #1: 같은 name+region+gu+dong, 다른 ID → 최신(id DESC)만 생존
  it("같은 단지 재공고 → 최신 ID만 유지", () => {
    const input = [
      makeApt({ id: "ah-2022910028" }),
      makeApt({ id: "ah-2022910067" }),
      makeApt({ id: "ah-2022910099" }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ah-2022910099"); // 가장 큰 ID
    // siblingIds에 모든 재공고 ID 포함
    expect(result[0].siblingIds).toHaveLength(3);
    expect(result[0].siblingIds).toEqual(expect.arrayContaining(["ah-2022910028", "ah-2022910067", "ah-2022910099"]));
  });

  // #2: 괄호 접미사 변형 → 병합
  it("괄호 접미사 변형 병합: '리체스트(임의공급)' → '리체스트'와 동일 그룹", () => {
    const input = [
      makeApt({ id: "ah-001", name: "용문역 리체스트" }),
      makeApt({ id: "ah-002", name: "용문역 리체스트(임의공급)" }),
      makeApt({ id: "ah-003", name: "용문역 리체스트(청약전환)" }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ah-003");
  });

  // #3: 다른 이름 → 병합 안 됨
  it("다른 이름의 단지는 병합하지 않음", () => {
    const input = [
      makeApt({ id: "ah-001", name: "래미안" }),
      makeApt({ id: "ah-002", name: "힐스테이트" }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(2);
  });

  // #4: 같은 이름 다른 dong → 병합 안 됨 (핵심)
  it("같은 이름이라도 다른 dong이면 별도 단지", () => {
    const input = [
      makeApt({ id: "ah-001", name: "래미안", dong: "역삼동" }),
      makeApt({ id: "ah-002", name: "래미안", dong: "삼성동" }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(2);
  });

  // #5: NULL gu/dong 처리 → COALESCE 동작
  it("NULL gu/dong도 정상 그룹화", () => {
    const input = [
      makeApt({ id: "ah-001", gu: null, dong: null }),
      makeApt({ id: "ah-002", gu: null, dong: null }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ah-002");
  });

  // 빈 배열 → 빈 배열 반환
  it("빈 배열 입력 → 빈 배열 반환", () => {
    expect(dedupApartments([])).toEqual([]);
  });

  // null/undefined → 빈 배열 반환
  it("null 입력 → 빈 배열 반환", () => {
    expect(dedupApartments(null)).toEqual([]);
    expect(dedupApartments(undefined)).toEqual([]);
  });

  // 중복 없는 데이터 → 변형 없음
  it("중복 없으면 원본 그대로 반환", () => {
    const input = [
      makeApt({ id: "ah-001", name: "A아파트", dong: "가동" }),
      makeApt({ id: "ah-002", name: "B아파트", dong: "나동" }),
      makeApt({ id: "ah-003", name: "C아파트", dong: "다동" }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(3);
  });

  // #9: 단독 공고 siblingIds = [자기 id]
  it("단독 공고의 siblingIds는 자기 ID만 포함", () => {
    const input = [makeApt({ id: "ah-solo-001", name: "솔로아파트" })];
    const result = dedupApartments(input);
    expect(result).toHaveLength(1);
    expect(result[0].siblingIds).toEqual(["ah-solo-001"]);
  });

  // #10: 괄호 변형 병합 시 siblingIds 정합성
  it("괄호 변형 병합 시 siblingIds에 모든 변형 ID 포함", () => {
    const input = [
      makeApt({ id: "ah-010", name: "용문역 리체스트" }),
      makeApt({ id: "ah-020", name: "용문역 리체스트(임의공급)" }),
      makeApt({ id: "ah-030", name: "용문역 리체스트(청약전환)" }),
    ];
    const result = dedupApartments(input);
    expect(result).toHaveLength(1);
    expect(result[0].siblingIds).toEqual(["ah-010", "ah-020", "ah-030"]);
  });

  // #11: siblingIds는 정렬됨
  it("siblingIds는 오름차순 정렬", () => {
    const input = [
      makeApt({ id: "ah-zzz" }),
      makeApt({ id: "ah-aaa" }),
      makeApt({ id: "ah-mmm" }),
    ];
    const result = dedupApartments(input);
    expect(result[0].siblingIds).toEqual(["ah-aaa", "ah-mmm", "ah-zzz"]);
  });
});
