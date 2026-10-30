// @ts-check
// 세션676 PR-C C2 — 카드 시공사(공고 시공사 쪼개기 · 이름 사전 3칸 · VIEW 글자 꼴). 계획서 .omc/artifacts/session676/plan-pr-c-v2.md §1 C2 · §3.
import { describe, it, expect } from "vitest";
import {
  splitConstructor, resolveCardBuilder, cardBuilder, builderCanonRows, builderCanonValuesSql, builderKey, cleanCompanyName,
  CORP_SQL, SEP_SQL, TAIL_SQL, TAIL_N_SQL, BLANK_SQL,
} from "./_card-builder.mjs";
import { BUILDER_CANONICALS } from "./_shared.mjs";
import { BUILDER_CORP_CODES, DART_ALIAS } from "./dart-builders.mjs";

describe("쪼개기 — 구분자 · 꼬리 · & 든 사명", () => {
  it("& 는 구분자가 아니다 — 사명 안 & 4종(유림E&C · 자이S&D · 한미글로벌 E&C · DL e&c)은 한 회사로 남는다", () => {
    expect(resolveCardBuilder("유림E&C")).toEqual({ display: "유림E&C", link: "유림E&C", n: 1 });
    expect(resolveCardBuilder("자이S&D")?.n).toBe(1);
    expect(resolveCardBuilder("주식회사 한미글로벌 E&C")).toEqual({ display: "한미글로벌 E&C", link: "한미글로벌 E&C", n: 1 });
    expect(splitConstructor("현대엔지니어링(주), DL e&c")?.parts).toEqual(["현대엔지니어링(주)", "DL e&c"]);
  });
  it("「외 1개업체」 — 대표 제일건설, n = 1 + 1", () => {
    expect(resolveCardBuilder("제일건설 주식회사 외 1개업체")).toEqual({ display: "제일건설", link: "제일건설", n: 2 });
    expect(cardBuilder("제일건설 주식회사 외 1개업체", "조합").builder).toBe("제일건설 외 1");
  });
  it("「외 N」·「외 N개사」·「외 N사」·붙여 쓴 「외1」 모두 N 을 센다", () => {
    expect(resolveCardBuilder("(주)금강주택 외 2")?.n).toBe(3);
    expect(resolveCardBuilder("현대건설(주) 외 6개사")?.n).toBe(7);
    expect(resolveCardBuilder("금호건설(주) 외 3사")).toEqual({ display: "금호건설", link: "금호건설", n: 4 });
    expect(resolveCardBuilder("한양산업개발 외1")).toEqual({ display: "한양산업개발", link: "한양산업개발", n: 2 });
  });
  it("「등」「컨소시엄」 꼬리는 떼되 회사 수를 늘리지 않는다", () => {
    expect(resolveCardBuilder("지에스건설(주) 등")).toEqual({ display: "GS건설", link: "GS건설", n: 1 });
    expect(resolveCardBuilder("현대건설 주식회사 컨소시엄")).toEqual({ display: "현대건설", link: "현대건설", n: 1 });
    expect(resolveCardBuilder("계룡건설 컨소시엄")?.display).toBe("계룡건설");
  });
  it("쉼표·전각 쉼표·가운뎃점·빗금·모점 — 앞뒤 공백 허용, 첫 조각이 대표사", () => {
    expect(resolveCardBuilder("(주)대우건설, 현대엔지니어링 (주)")).toEqual({ display: "대우건설", link: "대우건설", n: 2 });
    expect(resolveCardBuilder("현대건설(주) , 금호건설(주)")?.n).toBe(2);
    expect(resolveCardBuilder("가나건설，다라건설")?.n).toBe(2);
    expect(resolveCardBuilder("가나건설 · 다라건설 · 마바건설")?.n).toBe(3);
    expect(resolveCardBuilder("가나건설/다라건설")?.n).toBe(2);
    expect(resolveCardBuilder("가나건설、다라건설")?.n).toBe(2);
    expect(cardBuilder("현대건설㈜, HDC현대산업개발㈜, ㈜대우건설", null).builder).toBe("현대건설 외 2");
  });
  it("띄어쓰기로만 이은 3사는 쪼개지 않는다(계획서 — 사람 판정 명단으로) · 원문 법인격만 뗀 한 이름", () => {
    expect(resolveCardBuilder("삼성물산(주) 대림산업(주) 에이치디씨현대산업개발(주)")).toEqual({
      display: "삼성물산 대림산업 에이치디씨현대산업개발", link: "삼성물산 대림산업 에이치디씨현대산업개발", n: 1,
    });
  });
  it("내용 없는 원문(null·빈 글자·공백뿐·구분자뿐)은 null — 원표 builder 로 돌아간다", () => {
    for (const r of [null, undefined, "", "   ", "　", ",", " , "]) expect(resolveCardBuilder(r), String(r)).toBeNull();
    expect(cardBuilder(null, "하남C구역 주택재개발정비사업조합")).toEqual({ builder: "하남C구역 주택재개발정비사업조합", link: "하남C구역 주택재개발정비사업조합" });
    expect(cardBuilder("  ", null)).toEqual({ builder: null, link: null });
  });
});

describe("이름 사전 3칸 — 표시(등급) ≠ 연결(DART)", () => {
  const byKey = new Map(builderCanonRows().map((r) => [r.key, r]));
  it("계룡건설산업 → 표시 「계룡건설」(등급표 키) · 연결 「계룡건설산업」(DART 표 키)", () => {
    expect(resolveCardBuilder("계룡건설산업(주)")).toEqual({ display: "계룡건설", link: "계룡건설산업", n: 1 });
    expect(byKey.get("계룡건설산업")).toEqual({ key: "계룡건설산업", display: "계룡건설", link: "계룡건설산업" });
  });
  it("계획서 별칭 — (주)포스코건설·에스케이에코플랜트·아이파크현대산업개발·(주)한화 계열·금호산업·SK건설·(쥬)디에이건설", () => {
    expect(resolveCardBuilder("(주)포스코건설")).toEqual({ display: "포스코이앤씨", link: "포스코이앤씨", n: 1 });
    expect(resolveCardBuilder("에스케이에코플랜트(주)")).toEqual({ display: "SK에코플랜트", link: "SK에코플랜트", n: 1 });
    expect(resolveCardBuilder("아이파크현대산업개발(주)")?.display).toBe("HDC현대산업개발");
    for (const r of ["(주)한화 건설부문", "(주)한화", "㈜한화", "주식회사 한화"]) expect(resolveCardBuilder(r), r).toEqual({ display: "한화건설", link: "한화건설", n: 1 });
    expect(resolveCardBuilder("금호산업(주)")).toEqual({ display: "금호건설", link: "금호건설", n: 1 });
    expect(resolveCardBuilder("SK건설(주)")).toEqual({ display: "SK에코플랜트", link: "SK에코플랜트", n: 1 });
    expect(resolveCardBuilder("(쥬)디에이건설")).toEqual({ display: "디에이건설", link: "디에이건설", n: 1 });
  });
  it("DART 쪽에만 있는 표기는 표시 칸이 NULL — 원문 정리 이름으로 보이고 연결만 DART 이름(대림건설 → 대림산업)", () => {
    expect(byKey.get("대림건설")).toEqual({ key: "대림건설", display: null, link: "대림산업" });
    expect(resolveCardBuilder("대림건설")).toEqual({ display: "대림건설", link: "대림산업", n: 1 });
    expect(resolveCardBuilder("코오롱 글로벌(주)")).toEqual({ display: "코오롱 글로벌", link: "코오롱글로벌", n: 1 });
  });
  it("사전에 없는 회사 — 표시 = 법인격만 뗀 원문(공백 하나로·앞뒤 자름, 전각 포함) · 연결 = 그 표시", () => {
    expect(resolveCardBuilder("(주) 서희건설")).toEqual({ display: "서희건설", link: "서희건설", n: 1 });
    expect(resolveCardBuilder("　(주)에이치제이중공업  건설부문　")).toEqual({ display: "에이치제이중공업 건설부문", link: "에이치제이중공업 건설부문", n: 1 });
    expect(cleanCompanyName("현대엔지니어링 (주)")).toBe("현대엔지니어링");
  });
  it("등급표 정식 이름 16곳은 전부 사전에 자기 이름으로 · DART 정식 키 43곳은 전부 연결이 자기 이름", () => {
    for (const c of BUILDER_CANONICALS) expect(byKey.get(builderKey(c))?.display, c).toBe(c);
    for (const c of Object.keys(BUILDER_CORP_CODES)) expect(byKey.get(builderKey(c))?.link, c).toBe(c);
    for (const [a, c] of Object.entries(DART_ALIAS)) expect(byKey.get(builderKey(a))?.link, a).toBe(c);
  });
  it("키는 겹치지 않고 빈 키가 없다", () => {
    const keys = builderCanonRows().map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.length > 0)).toBe(true);
  });
});

describe("SQL 사전 글자 — builderCanonValuesSql", () => {
  const sql = builderCanonValuesSql();
  it("VALUES (키, 표시|NULL, 연결) 한 줄씩 · 사전 행 수만큼", () => {
    expect(sql.startsWith("(VALUES")).toBe(true);
    expect(sql.endsWith(") AS d(key, display, link)")).toBe(true);
    expect(sql).toContain("('계룡건설산업', '계룡건설', '계룡건설산업')");
    expect(sql).toContain("('대림건설', NULL, '대림산업')");
    expect(sql.split("\n").filter((l) => l.startsWith("    (")).length).toBe(builderCanonRows().length);
  });
});

describe("SQL 패턴 문자열 — ARE·JS 공통 문법만", () => {
  const ALL = [CORP_SQL, SEP_SQL, TAIL_SQL, TAIL_N_SQL, BLANK_SQL];
  it("역슬래시 s·d 없음 · 뒤돌아보기 없음", () => {
    for (const s of ALL) {
      expect(s.includes(String.raw`\s`), s).toBe(false);
      expect(s.includes(String.raw`\d`), s).toBe(false);
      expect(/\(\?<|\(\?=|\(\?!/.test(s), s).toBe(false);
    }
  });
  it("TAIL_N 의 첫 괄호 묶음이 숫자(PG substring … from 이 첫 괄호 묶음을 돌려준다)", () => {
    expect(TAIL_N_SQL.indexOf("([0-9]+)")).toBe(TAIL_N_SQL.indexOf("("));
  });
});
