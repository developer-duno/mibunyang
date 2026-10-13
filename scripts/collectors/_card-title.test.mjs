// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripNoticeWords, isNoticeParen, NOTICE_PAREN_SQL, NOTICE_WORD_RE } from "./_card-title.mjs";

const fx = JSON.parse(readFileSync(new URL("../../docs/audits/card-title-paren-fixture.json", import.meta.url), "utf8"));
const input = JSON.parse(readFileSync(new URL("../../docs/audits/card-title-paren-input.json", import.meta.url), "utf8"));

describe("픽스처 자체", () => {
  it("입력의 모든 괄호 문구가 strip/keep 정확히 한쪽에 있다", () => {
    const strip = new Set(fx.strip), keep = new Set(fx.keep);
    for (const k of Object.keys(input)) expect(strip.has(k) !== keep.has(k), k).toBe(true);
  });
});
describe("isNoticeParen — 픽스처 전수", () => {
  it("strip 은 전부 true", () => { for (const s of fx.strip) expect(isNoticeParen(s), s).toBe(true); });
  it("keep 은 전부 false", () => { for (const s of fx.keep) expect(isNoticeParen(s), s).toBe(false); });
  it("빈 괄호 안쪽은 false", () => { expect(isNoticeParen("")).toBe(false); });
});
describe("stripNoticeWords", () => {
  it("회차 괄호를 떼고 공백을 정리한다", () => {
    expect(stripNoticeWords("올림픽파크 포레온(무순위 2차)")).toBe("올림픽파크 포레온");
    expect(stripNoticeWords("천왕역 모아엘가 트레뷰 (9차)")).toBe("천왕역 모아엘가 트레뷰");
    expect(stripNoticeWords("이안 시그니처 역곡(임의공급 4차)")).toBe("이안 시그니처 역곡");
  });
  it("이중 괄호(회차 + 안내문)를 둘 다 뗀다", () => {
    expect(stripNoticeWords("천왕역 모아엘가 트레뷰(2차)(청약전 반드시 대표전화 문의, 재당첨제한 10년, 서울거주자/무주택세대구성원만 해당)")).toBe("천왕역 모아엘가 트레뷰");
  });
  it("블록·단지·유형·(오)는 남긴다", () => {
    expect(stripNoticeWords("고양덕은 DMC리버파크자이(A4BL)")).toBe("고양덕은 DMC리버파크자이(A4BL)");
    expect(stripNoticeWords("수원 아이파크 시티 10단지(2차)(재당첨제한 10년 / 수원시거주, 무주택세대구성원만 가능)")).toBe("수원 아이파크 시티 10단지");
    expect(stripNoticeWords("송도 그란테르(오)")).toBe("송도 그란테르(오)");
    expect(stripNoticeWords("영통 푸르지오 파인베르(A2BL)(불법행위 재공급)")).toBe("영통 푸르지오 파인베르(A2BL)");
  });
  it("뗄 것이 없으면 원문 그대로(공백 포함)", () => {
    expect(stripNoticeWords("문수로 푸르지오 어반피스")).toBe("문수로 푸르지오 어반피스");
    expect(stripNoticeWords("  앞뒤 공백  ")).toBe("  앞뒤 공백  ");
    expect(stripNoticeWords(null)).toBe("");
  });
  it("가운데 괄호를 떼도 좌우가 붙지 않는다", () => {
    expect(stripNoticeWords("A(1차) B")).toBe("A B");
  });
});
describe("SQL 패턴은 JS 패턴과 같은 낱말로 조립된다", () => {
  it("JS 정규식 소스의 낱말이 SQL 문자열에 전부 들어 있다", () => {
    for (const w of ["무순위", "임의공급", "사후", "계약취소주택", "취소후", "조합원", "불법행위", "재공급", "선착순", "청약", "문의", "재당첨", "거주자", "무주택", "세대구성원"]) {
      expect(NOTICE_WORD_RE.source.includes(w), w).toBe(true);
      expect(NOTICE_PAREN_SQL.includes(w), w).toBe(true);
    }
  });
  it("SQL 패턴을 JS 정규식으로 그대로 돌려도(ARE 와 JS 가 공유하는 문법만 썼다) 픽스처 전수가 같은 판정이다 — 괄호째 매치 여부 = isNoticeParen", () => {
    const re = new RegExp(NOTICE_PAREN_SQL, "u");
    for (const s of [...fx.strip, ...fx.keep]) expect(re.test(`(${s})`), s).toBe(fx.strip.includes(s));
  });
  it("빈 괄호·공백만 든 괄호는 SQL 패턴도 안 뗀다", () => {
    const re = new RegExp(NOTICE_PAREN_SQL, "u");
    expect(re.test("()")).toBe(false);
    expect(re.test("( )")).toBe(false);
  });
});
