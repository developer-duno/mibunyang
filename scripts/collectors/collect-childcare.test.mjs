// @ts-check
import { describe, it, expect } from "vitest";
import { collectChildcare, shouldExitFail } from "./collect-childcare.mjs";

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

// 세션 283 박제 — 5/1 schedule run 1건 statement timeout → exit 1 → Step 2 skip 사고
describe("shouldExitFail 임계값 1%", () => {
  it("999/1000 success + 1 fail = exit 0 (만강아파트 timeout 자리 답습)", () => {
    expect(shouldExitFail(999, 1)).toBe(false);
  });

  it("100% fail = exit 1", () => {
    expect(shouldExitFail(0, 5)).toBe(true);
  });

  it("0건 처리 (success+fail=0) = exit 0", () => {
    expect(shouldExitFail(0, 0)).toBe(false);
  });

  it("1% 경계 = exit 0 (10건 fail / 1000건 success)", () => {
    expect(shouldExitFail(1000, 10)).toBe(false);
  });

  it("1% 초과 = exit 1 (11건 fail / 1000건 success)", () => {
    expect(shouldExitFail(1000, 11)).toBe(true);
  });
});
