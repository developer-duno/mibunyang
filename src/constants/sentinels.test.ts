// @vitest-environment node
// ↑ 이 파일은 DOM 이 아니라 **디스크의 다른 파일**을 읽어 대조한다. jsdom 환경에서는
//   `import.meta.url` 이 http:// 스킴이라 readFileSync 가 못 읽는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SENTINEL, isSentinel } from "./sentinels";

// `process.cwd()` 는 src/ ESLint 설정에 Node 전역이 없어 못 쓴다.
// `import.meta.url` 은 표준 ESM 이라 그대로 통과하고, 실행 위치와 무관해 더 견고하다.
const DATA_AUDIT_PATH = new URL("../../scripts/collectors/data-audit.mjs", import.meta.url);

describe("SENTINEL — data-audit.mjs 와 값 동기", () => {
  /**
   * 이 테스트가 이 파일의 존재 이유다.
   *
   * 화면(`sentinels.ts`)과 채움률 감사(`scripts/collectors/data-audit.mjs`)가
   * 서로 다른 값을 쓰면, 감사는 "미수집 0%"라 하는데 화면은 막대를 그리는
   * (또는 그 반대의) 어긋남이 조용히 생긴다. 한쪽만 고치면 여기서 red 가 된다.
   */
  it("MASKED_DEFAULTS 와 키·값이 완전히 같다", () => {
    const src = readFileSync(DATA_AUDIT_PATH, "utf8");
    const m = src.match(/const\s+MASKED_DEFAULTS\s*=\s*\{([^}]*)\}/);
    expect(m, "data-audit.mjs 에서 MASKED_DEFAULTS 선언을 찾지 못했습니다").not.toBeNull();

    const parsed: Record<string, number> = {};
    for (const [, key, val] of (m?.[1] ?? "").matchAll(/(\w+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) {
      parsed[key] = Number(val);
    }

    expect(Object.keys(parsed).length, "MASKED_DEFAULTS 파싱 결과가 비었습니다").toBeGreaterThan(0);
    expect(parsed).toEqual({ ...SENTINEL });
  });
});

describe("isSentinel", () => {
  it("마스킹 값과 같으면 센티널", () => {
    expect(isSentinel("subwayDist", 9999)).toBe(true);
    expect(isSentinel("icDist", 99)).toBe(true);
    expect(isSentinel("ktxDist", 99)).toBe(true);
  });

  it("마스킹 값보다 크면 센티널 — 9999m 와 10500m 를 구분할 이유가 없다", () => {
    expect(isSentinel("subwayDist", 10500)).toBe(true);
    expect(isSentinel("ktxDist", 150)).toBe(true);
  });

  it("마스킹 값보다 작으면 진짜 값", () => {
    expect(isSentinel("subwayDist", 340)).toBe(false);
    expect(isSentinel("subwayDist", 9998)).toBe(false);
    expect(isSentinel("icDist", 98.9)).toBe(false);
  });

  it("센티널 개념이 없는 필드는 항상 false — 큰 값이어도", () => {
    expect(isSentinel("price", 99)).toBe(false);
    expect(isSentinel("price", 9999999)).toBe(false);
    expect(isSentinel("unsoldRate", 9999)).toBe(false);
  });

  it("null·undefined·숫자 아님은 false (미수집 판정은 호출처 몫)", () => {
    expect(isSentinel("subwayDist", null)).toBe(false);
    expect(isSentinel("subwayDist", undefined)).toBe(false);
    expect(isSentinel("subwayDist", "가까움")).toBe(false);
    expect(isSentinel("subwayDist", NaN)).toBe(false);
  });

  it("숫자 문자열은 숫자로 본다 (JSON 파싱 편차 방어)", () => {
    expect(isSentinel("subwayDist", "9999")).toBe(true);
    expect(isSentinel("subwayDist", "340")).toBe(false);
  });
});
