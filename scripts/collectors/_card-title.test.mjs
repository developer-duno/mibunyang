// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripNoticeWords, isNoticeParen, NOTICE_PAREN_SQL, NOTICE_WORD_RE, cardTitle, trailingRemoved, TRAILING_SQL, TRIM_SQL } from "./_card-title.mjs";

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
  it("조합원 자격상실·제명 안내 괄호도 뗀다(Task 5 보완 — 운영 입력 2건)", () => {
    expect(isNoticeParen("조합원 자격상실 및 제명세대")).toBe(true);
    expect(isNoticeParen("조합원 자격상실세대 3회차")).toBe(true);
    expect(stripNoticeWords("가나 아파트(조합원 자격상실 및 제명세대)")).toBe("가나 아파트");
    expect(stripNoticeWords("가나 아파트 (조합원 자격상실세대 3회차)")).toBe("가나 아파트");
  });
});
describe("SQL 패턴은 JS 패턴과 같은 낱말로 조립된다", () => {
  it("JS 정규식 소스의 낱말이 SQL 문자열에 전부 들어 있다", () => {
    for (const w of ["무순위", "임의공급", "사후", "계약취소주택", "취소후", "조합원", "불법행위", "재공급", "선착순", "청약", "문의", "재당첨", "거주자", "무주택", "세대구성원", "자격상실", "제명"]) {
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
// 세션676 PR-C C1 — 괄호 밖 끝 낱말 떼기(cardTitle). 픽스처 `trailing` 이 정본(운영 대표 이름 + 경계 사례).
describe("cardTitle — 끝 회차·공고 종류 낱말 (세션676 C1)", () => {
  /** @type {{ in: string, out: string, removed: string }[]} */
  const cases = fx.trailing;
  it("픽스처 trailing 이 비어 있지 않다(빈 배열끼리 초록 방지)", () => { expect(cases.length).toBeGreaterThanOrEqual(15); });
  it("픽스처 전수 — 결과 제목", () => { for (const c of cases) expect(cardTitle(c.in), c.in).toBe(c.out); });
  it("픽스처 전수 — 떼인 낱말 칸", () => { for (const c of cases) expect(trailingRemoved(c.in), c.in).toBe(c.removed); });
  it("승인 예시 「더샵 하남에디피스 사후」→「더샵 하남에디피스」", () => {
    expect(cardTitle("더샵 하남에디피스 사후")).toBe("더샵 하남에디피스");
  });
  it("공고 종류 낱말 3종(계약취소주택 · 계약취소주택 재공급 · 불법행위재공급)도 끝에서 뗀다(메인 판정 10/31 A안)", () => {
    expect(cardTitle("호반써밋 송도 계약취소주택")).toBe("호반써밋 송도");
    expect(cardTitle("힐스테이트 부평 계약취소주택 재공급")).toBe("힐스테이트 부평");
    expect(cardTitle("새절역 두산위브 트레지움 불법행위재공급")).toBe("새절역 두산위브 트레지움");
    expect(cardTitle("가나 취소후 재공급")).toBe("가나");
    expect(cardTitle("가나 조합원 취소분")).toBe("가나");
  });
  it("끝에 있을 때만 — 가운데 낱말·가운데 차수·맨 끝 맨 숫자 차수는 안 건드린다", () => {
    expect(cardTitle("화성 무순위 아파트")).toBe("화성 무순위 아파트");
    expect(cardTitle("힐스테이트 계약취소주택 부평")).toBe("힐스테이트 계약취소주택 부평");
    expect(cardTitle("금강펜테리움 6차 센트럴파크")).toBe("금강펜테리움 6차 센트럴파크");
    expect(cardTitle("금강펜테리움 6차")).toBe("금강펜테리움 6차");
  });
  it("앞에 공백이 있는 독립 낱말만 — 낱말 끝 글자가 겹쳐도(감사후) 안 뗀다", () => {
    expect(cardTitle("감사후")).toBe("감사후");
    expect(cardTitle("가나추가")).toBe("가나추가");
  });
  it("앞뒤 공백은 전각(U+3000)까지 자른다 · 가운데 전각은 그대로", () => {
    expect(cardTitle("\u3000가나\u3000다라\u3000")).toBe("가나\u3000다라");
    expect(cardTitle("가나 \u3000사후")).toBe("가나");
  });
  it("다 떼어 빈 글자가 되면 원래 이름(빈 결과 안전장치)", () => {
    expect(cardTitle(" 사후")).toBe(" 사후");
    expect(cardTitle(" 무순위 1차")).toBe(" 무순위 1차");
    expect(cardTitle(null)).toBe("");
  });
});
describe("끝 낱말 SQL 문자열 — ARE·JS 공통 문법만 (세션676 C1)", () => {
  it("역슬래시 s·d 를 쓰지 않는다(PG 로캘에 따라 범위가 달라짐) — 공백은 명시 묶음, 숫자는 [0-9]", () => {
    for (const s of [TRAILING_SQL, TRIM_SQL]) {
      expect(s.includes(String.raw`\s`), s).toBe(false);
      expect(s.includes(String.raw`\d`), s).toBe(false);
      expect(s.includes(String.raw`\u3000`), s).toBe(true);
    }
  });
  it("뒤돌아보기·이름 붙은 묶음 등 ARE 에 없는 문법을 쓰지 않는다", () => {
    for (const s of [TRAILING_SQL, TRIM_SQL]) expect(/\(\?<|\(\?=|\(\?!/.test(s), s).toBe(false);
  });
});
