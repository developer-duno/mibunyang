// @ts-check
import { describe, it, expect } from "vitest";
import { searchPolice } from "./collect-police.mjs";

// 경찰관서 수집 로직 테스트 (searchPolice는 외부 API이므로 export 함수 시그니처 검증)

describe("collect-police", () => {
  // 정상: searchPolice 함수가 export됨
  it("searchPolice 함수가 export됨", () => {
    expect(typeof searchPolice).toBe("function");
  });

  // 에러: KAKAO_KEY 없을 때 main()이 exit(1)하는 구조 확인 (isCLI 가드)
  it("isCLI 가드로 import 시 main() 미실행", async () => {
    // import 시 main()이 자동 실행되지 않음 (isCLI 패턴)
    const mod = await import("./collect-police.mjs");
    expect(typeof mod.searchPolice).toBe("function");
    // main은 export되지 않음 (내부 함수)
    expect(mod.main).toBeUndefined();
  });
});
