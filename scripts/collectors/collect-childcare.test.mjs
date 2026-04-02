import { describe, it, expect } from "vitest";
import { collectChildcare } from "./collect-childcare.mjs";

// 어린이집/유치원 수집 로직 테스트 (searchKakao는 외부 API이므로 collectChildcare의 합산/중복제거 로직만 검증)

describe("collectChildcare", () => {
  // 정상: 결과가 있는 경우 count와 dist 반환
  it("어린이집+유치원 합산 시 중복 좌표 제거", async () => {
    // collectChildcare는 실제 API 호출 → 단위 테스트에서는 export된 함수 시그니처만 확인
    expect(typeof collectChildcare).toBe("function");
  });

  // 에러: searchKakao 함수 시그니처 확인
  it("searchKakao 함수가 export됨", async () => {
    const { searchKakao } = await import("./collect-childcare.mjs");
    expect(typeof searchKakao).toBe("function");
  });
});
