// @ts-check
/**
 * audit-collector-patterns.mjs 순수 함수 테스트
 * 대상: findKaptNameMisuse
 */
import { describe, it, expect } from "vitest";
import { findKaptNameMisuse } from "./audit-collector-patterns.mjs";

describe("findKaptNameMisuse", () => {
  it('guField:"address" 정상 호출은 검출하지 않는다', () => {
    const text = `
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "address", guBonus: 0.15, attachScore: false,
      });
    `;
    expect(findKaptNameMisuse(text)).toEqual([]);
  });

  it('guField 미지정(기본값 address) 호출은 검출하지 않는다', () => {
    const text = `const m = findBestMatch(name, gu, list);`;
    expect(findKaptNameMisuse(text)).toEqual([]);
  });

  it('guField:"kaptName" 호출을 검출한다', () => {
    const text = `
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "kaptName", guBonus: 0.1, attachScore: false,
      });
    `;
    const hits = findKaptNameMisuse(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('guField: "kaptName"');
  });

  it("검출 위치의 줄 번호를 정확히 보고한다", () => {
    const text = `line1\nline2\nconst m = findBestMatch(a, b, c, { guField: "kaptName" });`;
    const hits = findKaptNameMisuse(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it("작은따옴표 guField:'kaptName' 도 검출한다", () => {
    const text = `findBestMatch(a, b, c, { guField: 'kaptName' })`;
    expect(findKaptNameMisuse(text)).toHaveLength(1);
  });

  it("한 파일에 여러 호출이 있어도 misuse 만 골라낸다", () => {
    const text = `
      findBestMatch(a, b, c, { guField: "address" });
      findBestMatch(d, e, f, { guField: "kaptName" });
      findBestMatch(g, h, i, { guField: "address" });
    `;
    expect(findKaptNameMisuse(text)).toHaveLength(1);
  });
});
