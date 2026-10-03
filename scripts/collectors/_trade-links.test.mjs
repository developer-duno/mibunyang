// @ts-check
/**
 * `_trade-links.mjs` 시험 — 대조군 픽스처(`__fixtures__/trade-links/`)는 세션590 에 운영 DB 에서 읽은 그대로다:
 *   apartments.json  대조군 10쌍의 우리 단지 18행 + 가짜 지번 표본(봉담 파라곤·봉담자이 라젠느 157) 2행
 *   deals.json       대조군 8개 법정동의 trade_deals 완성 batch(202510~, 179 batch 전부 완성 실측) — 열쇠·종류마다 3행까지
 * 대조군 정의 = 설계서 §5-1 5 · 조사 2차 `.omc/artifacts/session589/scope/research2/report-research2.md` :38-47.
 * 메인 승인 변경(세션590): 가짜 지번 정의(가) · 우리만 차수 = 시제품 정의(나) · 지번 경로 연도 C-1 · 입주 무관 두 종류 묶기.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildKeyDictionary, planLinks, matchApartment, findPlaceholderJibunIds, phaseOnlyOneSide, diffLinks,
  evaluateLinkBreaker, parseLinkDecisions, planLines, compareLinkPlanToApproved, presaleKeyOf, normLinkName,
  JIBUN_NAME_MIN, NAME_ONLY_MIN, LINK_BREAKER_MAX_ROWS, resolveDongName, withComputedComplexKeys,
  linkId, regionPrefixWords, stripRegionPrefix,
} from "./_trade-links.mjs";
import { stringSimilarity } from "./_shared.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "trade-links");
const APTS = JSON.parse(readFileSync(path.join(DIR, "apartments.json"), "utf8")).rows;
const DEALS = JSON.parse(readFileSync(path.join(DIR, "deals.json"), "utf8")).rows;
const NOW = new Date("2026-10-03T03:00:00Z");

const FX = (() => {
  const dict = buildKeyDictionary(DEALS);
  const { desired, dropped } = planLinks(APTS, dict, [], { now: NOW });
  return { dict, desired, dropped };
})();
/** @param {string} id */
const linksOf = (id) => FX.desired.filter((l) => l.apartment_id === id);
/** @param {string} key */
const linksTo = (key) => FX.desired.filter((l) => l.link_key === key);

describe("대조군 10쌍(픽스처 — 운영 DB 사본)", () => {
  it("양성: 화성시청역 서희스타힐스 4차 — 거래 지번이 '산96-8'(본번 없음)이라 이름 경로로 active", () => {
    const l = linksOf("ah-2021910001");
    expect(l.map((x) => [x.link_key, x.status, x.method])).toEqual([["41590-2271", "active", "name"]]);
  });

  it("양성: 반정 아이파크 캐슬 5단지·4단지 — 지번 경로 active(우리 202509 ↔ 거래 2022: 우리가 늦은 쪽이라 통과, C-1)", () => {
    expect(linksOf("ah-2025910141").map((x) => [x.link_key, x.status, x.method])).toEqual([["41590-2173", "active", "jibun+name"]]);
    expect(linksOf("ah-2025910140").map((x) => [x.link_key, x.status, x.method])).toEqual([["41590-2172", "active", "jibun+name"]]);
  });

  it("양성: 화성비봉 B2블록 호반써밋 두 행(같은 묶음) — 지번 1841 + 유사도 0.615 → 둘 다 active(형제 아님)", () => {
    for (const id of ["ah-2024910080", "ah-2025910076"]) {
      const l = linksOf(id);
      expect(l.map((x) => [x.link_key, x.status, x.method])).toEqual([["41590-2318", "active", "jibun+name"]]);
      expect(l[0].similarity).toBeGreaterThanOrEqual(JIBUN_NAME_MIN);
    }
  });

  it("양성: 동탄 A106 — 이름 바뀐 같은 단지(아테라 파밀리에 행)가 지번 718 로 active · 옛 이름 행(유사도 0.50)은 안 붙음", () => {
    expect(linksOf("ah-2026910044").map((x) => [x.link_key, x.status, x.method])).toEqual([["41590-4863", "active", "jibun+name"]]);
    expect(linksOf("ah-2023910063")).toEqual([]);
    expect(FX.dropped.some((d) => d.apartment_id === "ah-2023910063" && /유사도 0\.50/.test(d.why))).toBe(true);
  });

  it("양성: 힐스테이트 광교중앙역 퍼스트 두 행 — 전세 1건뿐인 열쇠도 지번 1333 으로 active", () => {
    for (const id of ["ah-2025910046", "ah-2025930011"]) {
      expect(linksOf(id).map((x) => [x.link_key, x.status])).toEqual([["41117-682", "active"]]);
    }
  });

  it("음성: 신동탄포레자이 960 — 옆 단지 e편한세상반월나노시티역 은 어떤 경로로도 안 붙고, 지번 탈락 뒤 이름 경로로 974 신동탄포레자이 가 붙는다", () => {
    expect(linksTo("41590-1568")).toEqual([]);
    expect(linksOf("ah-2022930024").map((x) => [x.link_key, x.status, x.method, x.build_year_gap])).toEqual([["41590-2184", "active", "name", 0]]);
    expect(FX.dropped.some((d) => d.apartment_id === "ah-2022930024" && d.key === "apt_seq:41590-1568" && /지번 960-0/.test(d.why))).toBe(true);
  });

  it("음성: 금강펜테리움 6차 재공급(820) ↔ 7차 센트럴파크 — 붙지 않는다(7차 열쇠엔 7차 행만), 6차 행들은 6차 열쇠로", () => {
    expect(linksTo("41597-2339").map((l) => l.apartment_id)).toEqual(["ah-2023910126"]);
    expect(linksOf("ah-2025930040").map((x) => [x.link_key, x.status])).toEqual([["41597-1", "active"]]);
    expect(linksOf("ah-2023910032").map((x) => [x.link_key, x.status])).toEqual([["41597-1", "active"]]);
  });

  it("보류·애매: 운암자이포레나퍼스티체 — 같은 지번 252 의 분양권 1·2·3단지 중 1단지 행엔 '1단지' 열쇠만, 다른 단지 열쇠가 active 로 새지 않는다", () => {
    const one = linksOf("ap-6026946");
    expect(one.map((x) => [x.link_key, x.status, x.method])).toEqual([["12300|운암동|252|운암자이포레나 퍼스티체 1단지", "active", "jibun+name"]]);
    for (const [id, n] of [["ap-6026946", "1"], ["ap-6027490", "2"], ["ap-6027491", "3"]]) {
      for (const l of linksOf(id).filter((x) => x.status === "active")) expect(l.link_key.endsWith(`${n}단지`)).toBe(true);
    }
  });

  it("보류·애매: 디에이치 퍼스티어 아이파크 660-1 — 분양권 660-1 은 12개월 창에 없고, 매매·전세 660-4 열쇠가 이름 경로로 active", () => {
    expect(linksOf("ah-2024910019").map((x) => [x.link_key, x.status, x.method])).toEqual([["11680-5268", "active", "name"]]);
    expect([...FX.dict.presale.keys()].some((k) => k.startsWith("11680|"))).toBe(false);
  });

  it("보류·애매: 화성 비봉 B-4BL 우미린 ↔ 우미린더퍼스트(유사도 0.32) — 지번 경로 0.6 미달 · 이름 경로 0.85 미달로 안 붙음", () => {
    expect(linksOf("ah-2025910136")).toEqual([]);
    expect(FX.dropped.some((d) => d.apartment_id === "ah-2025910136" && /유사도 0\.32/.test(d.why))).toBe(true);
  });

  it("법정동에 매매가 없으면(봉담 157 — 픽스처에 그 동 거래 없음) '동 이름 모름'으로 버린다(행정동 dong 을 대신 쓰지 않는다)", () => {
    for (const id of ["ah-2022910196", "ah-2022910342"]) {
      expect(linksOf(id)).toEqual([]);
      expect(FX.dropped.some((d) => d.apartment_id === id && /동 이름 모름/.test(d.why))).toBe(true);
    }
  });

  it("대조군 전체에서 hold 0 · 형제 충돌 0(같은 열쇠의 active 묶음은 하나)", () => {
    expect(FX.desired.filter((l) => l.status !== "active")).toEqual([]);
    const aptById = new Map(APTS.map((/** @type {any} */ a) => [a.id, a]));
    /** @type {Map<string, Set<string>>} */
    const bundles = new Map();
    for (const l of FX.desired) {
      const s = bundles.get(l.link_key) ?? new Set();
      s.add(aptById.get(l.apartment_id).complex_key);
      bundles.set(l.link_key, s);
    }
    for (const [k, s] of bundles) expect(s.size, k).toBe(1);
  });
});

// ── 합성 표본 ────────────────────────────────────────────────
/**
 * @param {Partial<import("./_trade-links.mjs").LinkApt> & { id: string; name: string }} o
 * @returns {import("./_trade-links.mjs").LinkApt}
 */
const apt = (o) => ({ region: "경기", gu: "테스트시", dong: "행정1동", bjd_code: "4100010100", lot_main: 100, lot_sub: 0, completion: "202001", coord_shared: null, complex_key: null, presale_type: null, ...o });
/**
 * @param {string} seq @param {string} name @param {string} jibun @param {number | null} by @param {string} [type]
 */
const deal = (seq, name, jibun, by, type = "sale") => {
  const [m, s] = jibun.split("-");
  return {
    trade_type: type, sgg_cd: "41000", umd_cd: type === "sale" ? "10100" : null, umd_nm: "테스트동", jibun,
    jibun_main: /^\d+$/.test(m) ? m : null, jibun_sub: /^\d+$/.test(m) ? (s ?? "0") : null,
    apt_seq: type === "presale" ? null : seq, apt_name: name, build_year: by,
  };
};
/** @param {any[]} apts @param {any[]} deals @param {any[]} [decisions] */
const plan = (apts, deals, decisions = []) => planLinks(apts, buildKeyDictionary(deals), decisions, { now: NOW });

describe("가짜 지번(메인 승인 가) — 같은 단지일 수 없는 이름 둘이 같은 지번이면 지번 경로를 안 쓴다", () => {
  it("픽스처: 봉담 파라곤↔봉담자이 라젠느(157) · 금강 6차↔7차(820) = 가짜 / A106 어울림↔아테라(718, 유사도 0.606) = 아님", () => {
    const ids = findPlaceholderJibunIds(APTS);
    for (const id of ["ah-2022910196", "ah-2022910342", "ah-2025930040", "ah-2023910126"]) expect(ids.has(id), id).toBe(true);
    for (const id of ["ah-2023910063", "ah-2026910044", "ah-2024910080", "ah-2025910076"]) expect(ids.has(id), id).toBe(false);
  });

  it("반대 방향: 이름이 비슷해도 차수가 다른 두 단지(힐스테이트 OO 1단지 / 2단지)가 같은 지번이면 가짜", () => {
    const a = [apt({ id: "a1", name: "힐스테이트 테스트 1단지" }), apt({ id: "a2", name: "힐스테이트 테스트 2단지" })];
    expect([...findPlaceholderJibunIds(a)].sort()).toEqual(["a1", "a2"]);
  });

  it("coord_shared 표시 단지는 혼자여도 가짜", () => {
    expect(findPlaceholderJibunIds([apt({ id: "c1", name: "아무단지", coord_shared: true })]).has("c1")).toBe(true);
  });

  it("가짜면 지번이 맞아도 지번 경로(0.6)를 안 쓴다 — 이름 경로(0.85)에 못 미치면 안 붙음 / 가짜가 아니면 붙음", () => {
    const deals = [deal("S1", "푸른마을한신", "100", 2020)];
    // 우리 "푸른한신마을" ↔ 거래 "푸른마을한신" — 유사도 0.667(0.6 이상 · 0.85 미만), 부분문자열 아님
    const ours = apt({ id: "p1", name: "푸른한신마을" });
    const other = apt({ id: "p2", name: "전혀다른 단지명" }); // 같은 지번을 같은 단지일 수 없는 이름이 함께 씀 → 가짜
    const s = stringSimilarity(normLinkName(ours.name), normLinkName("푸른마을한신"));
    expect(s).toBeGreaterThanOrEqual(JIBUN_NAME_MIN);
    expect(s).toBeLessThan(NAME_ONLY_MIN);
    const withFake = plan([ours, other], deals);
    expect(withFake.desired.filter((l) => l.apartment_id === "p1")).toEqual([]);
    const alone = plan([ours], deals);
    expect(alone.desired.filter((l) => l.apartment_id === "p1").map((l) => l.method)).toEqual(["jibun+name"]);
  });
});

describe("이름 경로 · 연도(C-1) · 우리만 차수", () => {
  it("지번 후보가 이름 검사를 하나도 못 통과하면 이름 경로로 넘어간다", () => {
    const deals = [deal("NB", "옆단지아파트", "100", 2020), deal("ME", "우리단지센트럴", "120", 2020)];
    const r = plan([apt({ id: "x", name: "우리단지 센트럴" })], deals);
    expect(r.desired.map((l) => [l.link_key, l.method])).toEqual([["ME", "name"]]);
  });

  it("지번 경로: 거래 건축년도가 우리보다 3년 이상 뒤면 버림 · 우리가 늦은 쪽(재공고 날짜)은 통과", () => {
    const deals = [deal("S1", "한빛마을", "100", 2024)];
    expect(plan([apt({ id: "late", name: "한빛마을", completion: "202001" })], deals).desired).toEqual([]);
    const ok = plan([apt({ id: "re", name: "한빛마을", completion: "202709" })], deals).desired;
    expect(ok.map((l) => [l.link_key, l.method, l.build_year_gap])).toEqual([["S1", "jibun+name", 3]]);
  });

  it("이름 경로: |차| > 2 는 어느 쪽이든 버림(우리 2025 ↔ 거래 2022)", () => {
    const deals = [deal("S1", "한빛마을", "999", 2022)];
    expect(plan([apt({ id: "n", name: "한빛마을", completion: "202509", lot_main: null })], deals).desired).toEqual([]);
    expect(plan([apt({ id: "n2", name: "한빛마을", completion: "202409", lot_main: null })], deals).desired.length).toBe(1);
  });

  it("phaseOnlyOneSide — 우리만 N차·N단지(괄호·공고 회차 제외)면 참 · 우리 블록은 차수로 안 셈 · 거래에 BL·블록이 있으면 거짓", () => {
    expect(phaseOnlyOneSide("반정 아이파크 캐슬 5단지", "반정아이파크캐슬")).toBe(true);
    expect(phaseOnlyOneSide("서희스타힐스 4차", "서희스타힐스4차")).toBe(false);
    expect(phaseOnlyOneSide("화성비봉 B2블록 호반써밋", "화성비봉호반써밋")).toBe(false);
    expect(phaseOnlyOneSide("평택지제역자이 무순위(사후) 1차", "평택지제역자이")).toBe(false);
    expect(phaseOnlyOneSide("반월자이 더 파크(1차)", "반월자이더파크")).toBe(false);
    expect(phaseOnlyOneSide("동탄 3차 아파트", "동탄 A3BL")).toBe(false);
    expect(phaseOnlyOneSide("동탄 3차 아파트", "동탄 A3블록")).toBe(false);
  });

  it("우리만 차수면 지번이 맞고 유사도가 높아도 버린다", () => {
    const deals = [deal("S1", "새솔마을", "100", 2020)];
    const r = plan([apt({ id: "q", name: "새솔마을 2단지" })], deals);
    expect(r.desired).toEqual([]);
    expect(r.dropped.some((d) => /우리만 차수/.test(d.why))).toBe(true);
  });

  it("이름 경로 부분문자열 — 짧은 이름(5자 미만)은 부분문자열로 안 붙는다", () => {
    const deals = [deal("S1", "개포자이", "999", 2020)];
    expect(plan([apt({ id: "z", name: "개포자이프레지던스", lot_main: null })], deals).desired).toEqual([]);
    const deals2 = [deal("S2", "금강펜테리움6차센트럴파크", "999", 2020)];
    const r = plan([apt({ id: "z2", name: "동탄신도시 금강펜테리움 6차 센트럴파크 불법행위재공급", lot_main: null })], deals2);
    expect(r.desired.map((l) => l.method)).toEqual(["name"]);
  });

  it("상수 = 설계서 값", () => {
    expect([JIBUN_NAME_MIN, NAME_ONLY_MIN, LINK_BREAKER_MAX_ROWS]).toEqual([0.6, 0.85, 30]);
  });
});

describe("hold — 형제(다른 묶음 공유) · 차수(차수 다른 후보 둘)", () => {
  const deals = [deal("S1", "한빛마을", "100", 2020)];

  it("서로 다른 complex_key 두 단지가 같은 열쇠에 붙으면 둘 다 hold(sibling)", () => {
    const r = plan([apt({ id: "a", name: "한빛마을", complex_key: "K1" }), apt({ id: "b", name: "한빛마을", complex_key: "K2", lot_main: 101 })], deals);
    expect(r.desired.map((l) => [l.apartment_id, l.status, l.hold_reason])).toEqual([["a", "hold", "sibling"], ["b", "hold", "sibling"]]);
  });

  it("같은 complex_key 두 행 → 둘 다 active", () => {
    const r = plan([apt({ id: "a", name: "한빛마을", complex_key: "K1" }), apt({ id: "b", name: "한빛마을", complex_key: "K1" })], deals);
    expect(r.desired.map((l) => l.status)).toEqual(["active", "active"]);
  });

  it("열쇠가 빈 행은 자기 id 가 묶음 — 빈 열쇠 둘이면 형제", () => {
    const r = plan([apt({ id: "a", name: "한빛마을" }), apt({ id: "b", name: "한빛마을", lot_main: 101 })], deals);
    expect(r.desired.map((l) => l.status)).toEqual(["hold", "hold"]);
  });

  it("임대 행 + 분양 행(다른 묶음)은 충돌이 아니다(임대는 묶음 셈에서 뺀다)", () => {
    const r = plan([apt({ id: "a", name: "한빛마을", complex_key: "K1" }), apt({ id: "b", name: "한빛마을 국민임대", complex_key: "K2", presale_type: "국민임대" })], deals);
    expect(r.desired.filter((l) => l.link_key === "S1").map((l) => [l.apartment_id, l.status])).toEqual([["a", "active"], ["b", "active"]]);
  });

  it("우리 이름에 차수가 없는데 차수 다른 후보 둘(1단지·2단지)이 지번으로 붙으면 둘 다 hold(phase)", () => {
    const d2 = [deal("P1", "한빛마을1단지", "100", 2020), deal("P2", "한빛마을2단지", "100", 2020)];
    const r = plan([apt({ id: "a", name: "한빛마을" })], d2);
    expect(r.desired.map((l) => [l.link_key, l.status, l.hold_reason])).toEqual([["P1", "hold", "phase"], ["P2", "hold", "phase"]]);
  });

  it("차수 충돌 없는 여러 열쇠(대단지 여러 지번 · 매매 apt_seq + 분양권)는 전부 active", () => {
    const d3 = [deal("A", "한빛마을", "100", 2020), deal("B", "한빛마을", "100-1", 2020), deal("", "한빛마을", "100", null, "presale")];
    const r = plan([apt({ id: "a", name: "한빛마을" })], /** @type {any} */ (d3));
    expect(r.desired.map((l) => [l.link_kind, l.status])).toEqual([["apt_seq", "active"], ["apt_seq", "active"], ["presale", "active"]]);
  });
});

describe("사람 판정 파일(B4)", () => {
  const deals = [deal("S1", "한빛마을", "100", 2020)];
  const sib = [apt({ id: "a", name: "한빛마을", complex_key: "K1" }), apt({ id: "b", name: "한빛마을", complex_key: "K2", lot_main: 101 })];

  it("active 판정 → hold 를 이기고 method manual · rejected → rejected 로 남는다", () => {
    const r = plan(sib, deals, [
      { apartment_id: "a", link_kind: "apt_seq", link_key: "S1", status: "active", verified_by: "사장님", verified_at: "2026-10-05" },
      { apartment_id: "b", link_kind: "apt_seq", link_key: "S1", status: "rejected", verified_by: "사장님" },
    ]);
    expect(r.desired.map((l) => [l.apartment_id, l.status, l.method, l.hold_reason, l.verified_by])).toEqual([
      ["a", "active", "manual", null, "사장님"], ["b", "rejected", "name", null, "사장님"],
    ]);
  });

  it("판정 파일에만 있는 줄도 들어간다(manual)", () => {
    const r = plan([apt({ id: "z", name: "다른이름", lot_main: null })], deals, [{ apartment_id: "z", link_kind: "apt_seq", link_key: "S1", status: "active" }]);
    expect(r.desired.map((l) => [l.apartment_id, l.link_key, l.method, l.trade_apt_name])).toEqual([["z", "S1", "manual", "한빛마을"]]);
  });

  it("parseLinkDecisions — 빈 파일 · 형식 오류 · 같은 줄 두 번은 던진다", () => {
    expect(parseLinkDecisions({ decisions: [] })).toEqual([]);
    expect(parseLinkDecisions(JSON.parse(readFileSync(path.join(DIR, "..", "..", "..", "..", "docs", "audits", "trade-link-decisions.json"), "utf8")))).toEqual([]);
    expect(() => parseLinkDecisions({})).toThrow(/decisions/);
    expect(() => parseLinkDecisions({ decisions: [{ apartment_id: "a", link_kind: "x", link_key: "k", status: "active" }] })).toThrow(/link_kind/);
    expect(() => parseLinkDecisions({ decisions: [{ apartment_id: "a", link_kind: "apt_seq", link_key: "k", status: "hold" }] })).toThrow(/status/);
    const d = { apartment_id: "a", link_kind: "apt_seq", link_key: "k", status: "active" };
    expect(() => parseLinkDecisions({ decisions: [d, { ...d }] })).toThrow(/두 번/);
  });
});

describe("diffLinks · 차단기 · 승인 대조", () => {
  /** @param {string} key @param {any} o */
  const L = (key, o = {}) => ({ apartment_id: "a", link_kind: /** @type {const} */ ("apt_seq"), link_key: key, method: /** @type {const} */ ("name"), similarity: 0.9, build_year_gap: 0, trade_apt_name: "x", trade_jibun: null, status: /** @type {const} */ ("active"), hold_reason: null, verified_at: null, verified_by: null, ...o });

  it("네 갈래 — add · remove · change(status·method·similarity·hold_reason) · unchanged(similarity 글자 '0.900' 도 같음)", () => {
    const current = [{ ...L("K1"), id: 1, similarity: "0.900" }, { ...L("K2"), id: 2 }, { ...L("K3"), id: 3 }];
    const desired = [L("K1"), L("K2", { status: "hold", hold_reason: "sibling" }), L("K4")];
    const d = diffLinks(/** @type {any} */ (current), desired);
    expect(d.add.map((x) => x.link_key)).toEqual(["K4"]);
    expect(d.remove.map((x) => x.link_key)).toEqual(["K3"]);
    expect(d.change.map((c) => [c.id, c.prev.status, c.next.status])).toEqual([[2, "active", "hold"]]);
    expect(d.unchanged).toBe(1);
  });

  it("차단기 경계 — 30줄 통과 · 31줄 막음 / 10% 통과 · 10.1% 막음 / 첫 채우기(넣기 > 지금) 막음", () => {
    expect(evaluateLinkBreaker({ add: 0, remove: 20, change: 10, existing: 1000 }).tripped).toBe(false);
    expect(evaluateLinkBreaker({ add: 0, remove: 21, change: 10, existing: 1000 }).tripped).toBe(true);
    expect(evaluateLinkBreaker({ add: 0, remove: 10, change: 0, existing: 100 }).tripped).toBe(false);
    expect(evaluateLinkBreaker({ add: 0, remove: 10, change: 0, existing: 99 }).tripped).toBe(true);
    expect(evaluateLinkBreaker({ add: 5, remove: 0, change: 0, existing: 0 }).tripped).toBe(true);
    expect(evaluateLinkBreaker({ add: 5, remove: 0, change: 0, existing: 5 }).tripped).toBe(false);
  });

  it("승인 대조는 개수가 아니라 줄 내용 — 같은 개수라도 다른 열쇠면 다름", () => {
    const p1 = planLines({ add: [L("K1")], remove: [], change: [] });
    const p2 = planLines({ add: [L("K2")], remove: [], change: [] });
    expect(compareLinkPlanToApproved(p1, p1).same).toBe(true);
    const c = compareLinkPlanToApproved(p1, p2);
    expect(c.same).toBe(false);
    expect([c.onlyCurrent.length, c.onlyApproved.length]).toEqual([1, 1]);
    expect(() => compareLinkPlanToApproved(p1, 3)).toThrow(/planLines/);
  });
});

describe("열쇠 사전", () => {
  it("분양권 열쇠 = sgg|umd_nm|jibun|정리이름 · 법정동 이름은 매매 행(umd_cd)에서만", () => {
    const d = buildKeyDictionary(/** @type {any} */ ([
      { trade_type: "presale", sgg_cd: "12300", umd_nm: "운암동", jibun: "252", apt_name: "운암자이포레나 퍼스티체 1단지 무순위", jibun_main: "252", jibun_sub: "0" },
      { trade_type: "jeonse", sgg_cd: "12300", umd_cd: null, umd_nm: "운암동", jibun: "1", apt_seq: "J1", apt_name: "전세만", jibun_main: "1", jibun_sub: "0" },
    ]));
    expect([...d.presale.keys()]).toEqual(["12300|운암동|252|운암자이포레나 퍼스티체 1단지"]);
    expect(presaleKeyOf({ sgg_cd: "12300", umd_nm: "운암동", jibun: "252", apt_name: "운암자이포레나 퍼스티체 1단지 무순위" })).toBe("12300|운암동|252|운암자이포레나 퍼스티체 1단지");
    expect(d.umdName.size).toBe(0); // 전세·분양권만 있는 동은 이름을 얻지 못한다
    const m = matchApartment(apt({ id: "u", name: "전세만", bjd_code: "1230010900" }), d, { now: NOW });
    expect(m.dropped[0].why).toMatch(/동 이름 모름/);
  });
});

// ── 보완(세션590 검사관 지적 반영 — 보완 지시서 F1·F2·F5·F6·F7·F9·F11) ──────────────────
describe("보완 픽스처 — 검사관 🟠 사례(운영 사본 apartments-fix.json · deals-fix.json)", () => {
  const AF = JSON.parse(readFileSync(path.join(DIR, "apartments-fix.json"), "utf8")).rows;
  const DF = JSON.parse(readFileSync(path.join(DIR, "deals-fix.json"), "utf8")).rows;
  const R = planLinks(withComputedComplexKeys(AF, {}), buildKeyDictionary(DF), [], { now: NOW });
  /** @param {string} id */
  const of = (id) => R.desired.filter((l) => l.apartment_id === id);

  it("F1-a 에듀파크 4행 — 옆 필지 '연수서해그랑블1단지'(1131-1, 0.667, 부번 와일드카드)는 안 붙고, 같은 지번의 에듀파크 열쇠만", () => {
    for (const id of ["ah-2021910047", "ah-2021910069", "ah-2021910085", "ah-2021910114"]) {
      expect(of(id).map((l) => [l.link_key, l.status, l.method])).toEqual([["28185-864", "active", "jibun+name"]]);
      expect(R.dropped.some((d) => d.apartment_id === id && d.key === "apt_seq:28185-796" && /와일드카드/.test(d.why))).toBe(true);
    }
    expect(R.desired.some((l) => l.link_key === "28185-796")).toBe(false);
  });

  it("F1-c 힐스테이트 대명 센트럴(우리 차수 없음) — 차수 없는 후보만 active, '2차' 후보는 버림(사유 남김)", () => {
    const l = of("ah-2021910018");
    expect(l.length).toBeGreaterThan(0);
    for (const x of l) {
      expect(x.status).toBe("active");
      expect(x.trade_apt_name ?? "").not.toMatch(/2차/);
    }
    expect(R.dropped.filter((d) => d.apartment_id === "ah-2021910018" && /우리 차수 없음·차수 없는 후보 있음/.test(d.why)).length).toBeGreaterThan(0);
  });

  it("F1-b 청라웰카운티19단지(2차) ↔ 청라웰카운티 2차(차 11 · 0.667) — 유사도 0.85 미만이라 비대칭 허용 없이 버림", () => {
    expect(of("ah-2023910083")).toEqual([]);
    expect(R.dropped.some((d) => d.apartment_id === "ah-2023910083" && /연도 차 11/.test(d.why))).toBe(true);
  });

  it("F1-c 래미안그레이튼·마포그랑자이 — 차수 없는 후보가 있으면 (진달래2차)·(2단지) 후보는 버림", () => {
    expect(of("ap-6000020").some((l) => /진달래2차/.test(l.trade_apt_name ?? ""))).toBe(false);
    expect(of("ap-6023234").some((l) => /2단지/.test(l.trade_apt_name ?? ""))).toBe(false);
  });

  it("F2 용인 둔전역 에피트 — 그 법정동(포곡읍 금어리)에 매매 0 이라도 주소로 동 이름을 얻어 분양권 646 에 붙는다(dong_via address)", () => {
    expect(of("ah-2025910017").map((l) => [l.link_kind, l.link_key, l.status])).toEqual([["presale", "41461|포곡읍 금어리|646|용인 둔전역 에피트", "active"]]);
    expect(R.dongVia.get("ah-2025910017")).toBe("address");
  });

  it("F9 대전 둔곡 A3BL 우미린 두 행(같은 묶음) — 연결 0 이던 행도 묶음 전파로 active(method bundle)", () => {
    expect(of("ah-2023930031").map((l) => [l.link_key, l.status, l.method])).toEqual([["30200-739", "active", "jibun+name"]]);
    expect(of("ah-2021910087").map((l) => [l.link_key, l.status, l.method, l.similarity])).toEqual([["30200-739", "active", "bundle", null]]);
  });
});

describe("F1 합성 — 와일드카드 0.85 · 비대칭 연도 0.85 · 차수 두 갈래", () => {
  it("F1-a 정확 일치(100-0)는 0.6 · 우리 부번 0 인데 100-1 에만 맞으면(와일드카드) 0.85 요구", () => {
    const ok = plan([apt({ id: "x", name: "푸른한신마을" })], [deal("S1", "푸른마을한신", "100", 2020)]);
    expect(ok.desired.map((l) => l.method)).toEqual(["jibun+name"]); // 0.667 ≥ 0.6 (정확 일치)
    const wild = plan([apt({ id: "x", name: "푸른한신마을" })], [deal("S1", "푸른마을한신", "100-1", 2020)]);
    expect(wild.desired).toEqual([]);
    expect(wild.dropped.some((d) => /와일드카드/.test(d.why))).toBe(true);
  });

  it("F1-b 지번 경로 비대칭(우리가 늦은 쪽 통과)은 유사도 ≥ 0.85 일 때만 — 0.667 이면 대칭 |차| ≤ 2", () => {
    const hi = plan([apt({ id: "a", name: "한빛마을", completion: "202709" })], [deal("S1", "한빛마을", "100", 2024)]);
    expect(hi.desired.length).toBe(1);
    const lo = plan([apt({ id: "b", name: "푸른한신마을", completion: "202709" })], [deal("S1", "푸른마을한신", "100", 2024)]);
    expect(lo.desired).toEqual([]);
  });

  it("F1-c 우리 차수 없음 + 후보가 차수 있는 것 하나뿐 → hold(phase)", () => {
    const r = plan([apt({ id: "a", name: "한빛마을" })], [deal("P2", "한빛마을2차", "100", 2020)]);
    expect(r.desired.map((l) => [l.link_key, l.status, l.hold_reason])).toEqual([["P2", "hold", "phase"]]);
  });

  it("F1-c 우리 차수 없음 + 차수 없는 후보·차수 있는 후보 섞임 → 차수 있는 것 버림 · 차수 없는 것 active", () => {
    const r = plan([apt({ id: "a", name: "한빛마을" })], [deal("P0", "한빛마을", "100", 2020), deal("P2", "한빛마을2차", "100", 2020)]);
    expect(r.desired.map((l) => [l.link_key, l.status])).toEqual([["P0", "active"]]);
    expect(r.dropped.some((d) => d.key === "apt_seq:P2" && /우리 차수 없음/.test(d.why))).toBe(true);
  });
});

describe("F11 이름 경로 0.85 경계 — 0.84 탈락 · 0.85 통과", () => {
  // 서로 다른 한글 글자로 이름을 만들어 LCS 를 정확히 맞춘다(유사도 = 2·LCS ÷ 두 길이 합)
  const syl = (/** @type {number} */ i) => String.fromCharCode(0xac00 + 28 * 3 * i + 7);
  const word = (/** @type {number} */ from, /** @type {number} */ n) => Array.from({ length: n }, (_, k) => syl(from + k)).join("");
  it("20자 ↔ 앞 17자 같음(0.85) → name 으로 붙음 · 25자 ↔ 앞 21자 같음(0.84) → 안 붙음", () => {
    const a85 = word(0, 20), b85 = word(0, 17) + word(100, 3);
    expect(stringSimilarity(normLinkName(a85), normLinkName(b85))).toBeCloseTo(0.85, 10);
    expect(plan([apt({ id: "a", name: a85, lot_main: null })], [deal("S", b85, "999", 2020)]).desired.map((l) => l.method)).toEqual(["name"]);
    const a84 = word(0, 25), b84 = word(0, 21) + word(100, 4);
    expect(stringSimilarity(normLinkName(a84), normLinkName(b84))).toBeCloseTo(0.84, 10);
    expect(plan([apt({ id: "a", name: a84, lot_main: null })], [deal("S", b84, "999", 2020)]).desired).toEqual([]);
  });
});

describe("F2 법정동 이름 사다리", () => {
  /** @param {string[]} names */
  const dictWith = (names) => buildKeyDictionary(/** @type {any} */ (names.map((n, i) => ({ trade_type: "jeonse", sgg_cd: "41000", umd_nm: n, apt_seq: `J${i}`, apt_name: "x", jibun: "1", jibun_main: "1", jibun_sub: "0" }))));
  it("① 매매 umd_cd 가 있으면 그 이름(umd_cd)", () => {
    const d = buildKeyDictionary(/** @type {any} */ ([{ trade_type: "sale", sgg_cd: "41000", umd_cd: "10100", umd_nm: "테스트동", apt_seq: "S", apt_name: "x" }]));
    expect(resolveDongName(apt({ id: "a", name: "x" }), d)).toEqual({ name: "테스트동", via: "umd_cd", sggs: ["41000"] });
  });
  it("② 주소에 낱말 경계로 — '중동로' 안의 '중동' 은 안 세고, '중동 12' 는 센다 · 여럿이면 가장 긴 이름", () => {
    const d = dictWith(["중동", "상동"]);
    expect(resolveDongName(apt({ id: "a", name: "x", address: "경기 부천시 중동로 123", dong: "행정1동" }), d)).toBe(null);
    expect(resolveDongName(apt({ id: "a", name: "x", address: "경기 부천시 중동 12" }), d)).toEqual({ name: "중동", via: "address", sggs: ["41000"] });
    const d2 = dictWith(["금어리", "포곡읍 금어리"]);
    expect(resolveDongName(apt({ id: "a", name: "x", address: "경기 용인시 처인구 포곡읍 금어리 646" }), d2)).toEqual({ name: "포곡읍 금어리", via: "address", sggs: ["41000"] });
  });
  it("③ apartments.dong 이 그 시군구 거래의 법정동 이름이면 그 이름(dong) · 아니면 ④ null", () => {
    const d = dictWith(["역삼동"]);
    expect(resolveDongName(apt({ id: "a", name: "x", address: "서울 강남구 테헤란로 1", dong: "역삼동" }), d)).toEqual({ name: "역삼동", via: "dong", sggs: ["41000"] });
    expect(resolveDongName(apt({ id: "a", name: "x", address: "서울 강남구 테헤란로 1", dong: "역삼1동" }), d)).toBe(null);
  });
  it("G4 ② 가장 긴 이름이 둘 이상 동률이면 ② 포기(상동·중동) · 이름 뒤 숫자 불일치('중앙동2가 10') · '포곡읍 금어리 646' 은 일치", () => {
    expect(resolveDongName(apt({ id: "a", name: "x", address: "경기 부천시 상동 1 중동 2", dong: "행정1동" }), dictWith(["중동", "상동"]))).toBe(null);
    expect(resolveDongName(apt({ id: "a", name: "x", address: "경기 부천시 상동 1 중동 2", dong: "중동" }), dictWith(["중동", "상동"]))).toEqual({ name: "중동", via: "dong", sggs: ["41000"] });
    expect(resolveDongName(apt({ id: "a", name: "x", address: "인천 중구 중앙동2가 10", dong: "행정1동" }), dictWith(["중앙동"]))).toBe(null);
    expect(resolveDongName(apt({ id: "a", name: "x", address: "경기 용인시 처인구 포곡읍 금어리 646" }), dictWith(["포곡읍 금어리"]))?.via).toBe("address");
  });
  it("G7 화성 옛 코드 41590 단지 — 새 4코드(41591~97) 거래를 같은 시군구로 본다(① umd_cd · ② 주소)", () => {
    const hw = buildKeyDictionary(/** @type {any} */ ([
      { trade_type: "sale", sgg_cd: "41593", umd_cd: "25021", umd_nm: "봉담읍 동화리", apt_seq: "H1", apt_name: "x" },
      { trade_type: "jeonse", sgg_cd: "41597", umd_nm: "오산동", apt_seq: "H2", apt_name: "y" },
    ]));
    expect(resolveDongName(apt({ id: "a", name: "x", bjd_code: "4159025021" }), hw)).toEqual({ name: "봉담읍 동화리", via: "umd_cd", sggs: ["41593"] });
    expect(resolveDongName(apt({ id: "a", name: "x", bjd_code: "4159012345", address: "경기 화성시 오산동 900" }), hw)).toEqual({ name: "오산동", via: "address", sggs: ["41597"] });
    expect(resolveDongName(apt({ id: "a", name: "x", bjd_code: "4159112345", address: "경기 화성시 오산동 900" }), hw)).toBe(null); // 새 코드 단지는 자기 코드만
  });
});

describe("G7 동 이름 사다리 ④ — 시군구 안 정확한 이름(동 이름을 끝내 못 얻은 단지만)", () => {
  /** 다른 동(동화리) 거래만 있는 시군구 — 우리 주소의 동(상기리)은 거래에 없다. @param {any[]} extra */
  const dictOf = (extra = []) => buildKeyDictionary(/** @type {any} */ ([
    { trade_type: "sale", sgg_cd: "41593", umd_cd: "25021", umd_nm: "봉담읍 동화리", apt_seq: "B1", apt_name: "봉담자이라젠느", jibun: "700", jibun_main: "700", jibun_sub: "0", build_year: 2024 },
    ...extra,
  ]));
  const ours = (/** @type {any} */ o = {}) => apt({ id: "z", name: "봉담자이 라젠느", bjd_code: "4159025999", address: "경기 화성시 봉담읍 상기리 157", dong: "봉담읍", lot_main: 157, completion: "202403", ...o });
  it("봉담자이 라젠느 꼴 — 주소 동 ≠ 거래 동이어도 같은 시군구 정확한 이름으로 active(name · dong_via sgg_name)", () => {
    const r = planLinks([ours()], dictOf(), [], { now: NOW });
    expect(r.desired.map((l) => [l.link_key, l.status, l.method])).toEqual([["B1", "active", "name"]]);
    expect(r.dongVia.get("z")).toBe("sgg_name");
  });
  it("같은 이름이 두 동에 있으면 안 붙는다(사유 '여러 동')", () => {
    const r = planLinks([ours()], dictOf([{ trade_type: "sale", sgg_cd: "41595", umd_cd: "11111", umd_nm: "반송동", apt_seq: "B2", apt_name: "봉담자이 라젠느", build_year: 2024 }]), [], { now: NOW });
    expect(r.desired).toEqual([]);
    expect(r.dropped.some((d) => d.apartment_id === "z" && /여러 동/.test(d.why))).toBe(true);
  });
  it("우리 정리 이름 5글자 → ④ 안 씀 · 연도 차 3 → 버림", () => {
    const short = buildKeyDictionary(/** @type {any} */ ([{ trade_type: "sale", sgg_cd: "41593", umd_cd: "25021", umd_nm: "봉담읍 동화리", apt_seq: "S5", apt_name: "봉담한빛자", build_year: 2024 }]));
    expect(planLinks([ours({ name: "봉담한빛자" })], short, [], { now: NOW }).desired).toEqual([]);
    const far = planLinks([ours({ completion: "202103" })], dictOf(), [], { now: NOW });
    expect(far.desired).toEqual([]);
    expect(far.dropped.some((d) => d.apartment_id === "z" && /시군구 이름 일치 후보 .*연도 차 3/.test(d.why))).toBe(true);
  });
  it("G7-b 지역 접두 — 「화성 봉담자이 라젠느(…)」(gu 화성시) ↔ 「봉담자이라젠느」 → active · prefixStripped 표시", () => {
    const r = planLinks([ours({ name: "화성 봉담자이 라젠느(청약전 반드시 대표번호 문의)", gu: "화성시" })], dictOf(), [], { now: NOW });
    expect(r.desired.map((l) => [l.link_key, l.status, l.method])).toEqual([["B1", "active", "name"]]);
    expect([...r.prefixStripped]).toEqual([linkId({ apartment_id: "z", link_kind: "apt_seq", link_key: "B1" })]);
    // 원래 이름이 같은 짝은 접두 떼기 표시 없음
    expect(planLinks([ours({ gu: "화성시" })], dictOf(), [], { now: NOW }).prefixStripped.size).toBe(0);
  });
  it("G7-b 반대 꼴(거래 쪽에만 접두 「경기화성봉담자이라젠느」) → active", () => {
    const d = buildKeyDictionary(/** @type {any} */ ([{ trade_type: "sale", sgg_cd: "41593", umd_cd: "25021", umd_nm: "봉담읍 동화리", apt_seq: "B3", apt_name: "경기화성봉담자이라젠느", build_year: 2024 }]));
    expect(planLinks([ours({ gu: "화성시" })], d, [], { now: NOW }).desired.map((l) => [l.link_key, l.status])).toEqual([["B3", "active"]]);
  });
  it("G7-b 접두 뗀 뒤 5글자 → 안 씀 · 「힐스테이트 동탄」 ↔ 「힐스테이트동탄역센트릭」(같은 시군구 남의 단지) → 안 붙음", () => {
    const d5 = buildKeyDictionary(/** @type {any} */ ([{ trade_type: "sale", sgg_cd: "41593", umd_cd: "25021", umd_nm: "봉담읍 동화리", apt_seq: "S5", apt_name: "봉담한빛자", build_year: 2024 }]));
    expect(planLinks([ours({ name: "화성 봉담한빛자", gu: "화성시" })], d5, [], { now: NOW }).desired).toEqual([]);
    const dh = buildKeyDictionary(/** @type {any} */ ([{ trade_type: "sale", sgg_cd: "41593", umd_cd: "25021", umd_nm: "봉담읍 동화리", apt_seq: "H", apt_name: "힐스테이트동탄역센트릭", build_year: 2024 }]));
    expect(planLinks([ours({ name: "힐스테이트 동탄", gu: "화성시" })], dh, [], { now: NOW }).desired).toEqual([]);
  });
  it("regionPrefixWords · stripRegionPrefix — 시/군/구 떼기 · 맨 앞만 · 낱말마다 한 번(연달아 둘 다)", () => {
    expect(regionPrefixWords({ region: "경기", gu: "용인시 처인구" })).toEqual(["경기", "용인", "처인"]);
    expect(stripRegionPrefix("경기화성봉담자이", ["경기", "화성"])).toBe("봉담자이");
    expect(stripRegionPrefix("봉담화성자이", ["경기", "화성"])).toBe("봉담화성자이");
    expect(stripRegionPrefix("화성화성자이", ["화성"])).toBe("화성자이");
  });
});

describe("F5 창 밖 기존 줄 유지 · F6 표에 없는 판정 id · F7 빈 묶음 열쇠", () => {
  const deals = [deal("S1", "한빛마을", "100", 2020)];
  it("F5 사전에 없는 열쇠의 기존 active 줄은 desired 에 그대로 → diff 에서 unchanged(지우지 않음) · rejected 판정은 적용", () => {
    const cur = [{ id: 7, apartment_id: "a", link_kind: "apt_seq", link_key: "OLD", method: "name", similarity: "0.900", status: "active", hold_reason: null }];
    const apts = [apt({ id: "a", name: "한빛마을" })];
    const r = planLinks(apts, buildKeyDictionary(deals), [], { now: NOW, current: cur });
    const d = diffLinks(/** @type {any} */ (cur), r.desired);
    expect([d.remove.length, d.unchanged, d.add.map((x) => x.link_key)]).toEqual([0, 1, ["S1"]]);
    const rj = planLinks(apts, buildKeyDictionary(deals), [{ apartment_id: "a", link_kind: "apt_seq", link_key: "OLD", status: "rejected" }], { now: NOW, current: cur });
    expect(rj.desired.find((l) => l.link_key === "OLD")?.status).toBe("rejected");
  });
  it("F6 판정 파일의 단지 id 가 표에 없으면 건너뛰고 dropped 사유 · 개수", () => {
    const r = planLinks([apt({ id: "a", name: "한빛마을" })], buildKeyDictionary(deals), [{ apartment_id: "gone", link_kind: "apt_seq", link_key: "S1", status: "active" }], { now: NOW });
    expect(r.desired.some((l) => l.apartment_id === "gone")).toBe(false);
    expect(r.skippedDecisions).toBe(1);
    expect(r.dropped.some((d) => d.apartment_id === "gone" && /판정 파일 id 가 표에 없음/.test(d.why))).toBe(true);
  });
  it("F7 묶음 열쇠가 빈 행은 열쇠 규칙 값으로 — 같은 단지 행과 같은 묶음이라 형제 hold 가 안 난다", () => {
    const rows = [
      apt({ id: "a", name: "한빛마을", complex_key: null, lat: 37.5, lng: 127.0 }),
      apt({ id: "b", name: "한빛마을(무순위)", complex_key: null, lat: 37.5, lng: 127.0, lot_main: 101 }),
    ];
    const keyed = withComputedComplexKeys(rows, {});
    expect(keyed[0].complex_key).toBeTruthy();
    expect(keyed[0].complex_key).toBe(keyed[1].complex_key);
    const r = planLinks(keyed, buildKeyDictionary(deals), [], { now: NOW });
    expect(r.desired.map((l) => l.status)).toEqual(["active", "active"]);
    expect(plan(rows, deals).desired.map((l) => l.status)).toEqual(["hold", "hold"]); // 채우지 않으면 자기 id → 형제
  });
});

describe("F9 묶음 전파 — 임대 행은 안 받음 · rejected 는 전파를 이김 · hold 는 전파 안 함", () => {
  const deals = [deal("S1", "한빛마을", "100", 2020)];
  const rows = [
    apt({ id: "a", name: "한빛마을", complex_key: "K" }),
    apt({ id: "b", name: "전혀다른이름", complex_key: "K", lot_main: null }),
    apt({ id: "l", name: "한빛마을 국민임대", complex_key: "K", presale_type: "국민임대", lot_main: null }),
  ];
  it("임대 아닌 b 는 bundle 로 받고, 임대 l 은 자기 매칭만(전파 없음)", () => {
    const r = plan(rows, deals);
    expect(r.desired.filter((x) => x.apartment_id === "b").map((x) => [x.link_key, x.method])).toEqual([["S1", "bundle"]]);
    expect(r.desired.filter((x) => x.apartment_id === "l").map((x) => x.method)).not.toContain("bundle");
  });
  it("rejected 판정은 전파 줄을 이김", () => {
    const r = plan(rows, deals, [{ apartment_id: "b", link_kind: "apt_seq", link_key: "S1", status: "rejected" }]);
    expect(r.desired.find((x) => x.apartment_id === "b")?.status).toBe("rejected");
  });
  it("hold 는 전파 안 함", () => {
    const r = plan([apt({ id: "a", name: "한빛마을", complex_key: "K" }), apt({ id: "b", name: "전혀다른이름", complex_key: "K", lot_main: null })], [deal("P2", "한빛마을2차", "100", 2020)]);
    expect(r.desired.map((x) => [x.apartment_id, x.status])).toEqual([["a", "hold"]]);
  });
});

describe("G1 우리 블록·괄호 번호도 차수로 셈(F1-c) — 후보와 같은 추출", () => {
  /** @param {string} ours @param {string[]} theirs */
  const one = (ours, theirs) => plan([apt({ id: "a", name: ours })], theirs.map((n, i) => deal(`S${i}`, n, "100", 2020)));
  it("우리 1BL ↔ 거래 1BL(띄어쓰기만 다름) · 1BL ↔ 1BL 같은 이름 · 1BL ↔ 1단지 · (2차) ↔ 2단지 → active(hold 아님)", () => {
    for (const [ours, theirs] of [
      ["더샵 지제역 센트럴파크 1BL", "더샵지제역센트럴파크1BL"],
      ["중앙공원롯데캐슬시그니처1BL", "중앙공원롯데캐슬시그니처1BL"],
      ["몬테로이 1BL", "몬테로이1단지"],
      ["신흥역 하늘채 랜더스원(2차)", "신흥역하늘채랜더스원2단지"],
    ]) {
      expect(one(ours, [theirs]).desired.map((l) => [l.status, l.hold_reason])).toEqual([["active", null]]);
    }
  });
  it("우리 (2차) ↔ {무차수, (2단지)} → 둘 다 active(같은 번호 후보를 '섞임'으로 버리지 않음)", () => {
    const r = one("북서울자이 폴라리스(2차)", ["북서울자이폴라리스", "북서울자이폴라리스(2단지)"]);
    expect(r.desired.map((l) => [l.link_key, l.status])).toEqual([["S0", "active"], ["S1", "active"]]);
  });
  it("우리 블록은 phaseOnlyOneSide 에서 여전히 차수 아님(호반써밋 B2블록 ↔ 블록 뗀 거래 이름 = active)", () => {
    expect(one("화성비봉 B2블록 호반써밋", ["화성비봉호반써밋"]).desired.map((l) => l.status)).toEqual(["active"]);
  });
  it("우리 번호 없음 + 차수 후보만 → hold(phase) 그대로 · 무차수 + 2차 같은 kind → 2차 버림 그대로", () => {
    expect(one("한빛마을", ["한빛마을2차"]).desired.map((l) => l.hold_reason)).toEqual(["phase"]);
    expect(one("한빛마을", ["한빛마을", "한빛마을2차"]).desired.map((l) => l.link_key)).toEqual(["S0"]);
  });
});

describe("G6 섞임 버림은 같은 link_kind 안에서만 — 다른 kind 에만 무차수 후보면 차수 후보는 hold", () => {
  it("무차수 분양권 + {1단지, 2단지} apt_seq → 분양권 active · apt_seq 둘 hold(phase)", () => {
    const r = plan([apt({ id: "a", name: "동일하이빌 파크레인" })], /** @type {any} */ ([
      deal("", "동일하이빌파크레인", "100", null, "presale"),
      deal("P1", "동일하이빌파크레인1단지", "100", 2020),
      deal("P2", "동일하이빌파크레인2단지", "100", 2020),
    ]));
    expect(r.desired.map((l) => [l.link_kind, l.link_key, l.status, l.hold_reason])).toEqual([
      ["apt_seq", "P1", "hold", "phase"], ["apt_seq", "P2", "hold", "phase"],
      ["presale", "41000|테스트동|100|동일하이빌파크레인", "active", null],
    ]);
  });
  it("무차수 분양권 + 차수 apt_seq 하나 → 그 apt_seq 도 hold(버리지 않음)", () => {
    const r = plan([apt({ id: "a", name: "동일하이빌 파크레인" })], /** @type {any} */ ([
      deal("", "동일하이빌파크레인", "100", null, "presale"), deal("P1", "동일하이빌파크레인1단지", "100", 2020),
    ]));
    expect(r.desired.find((l) => l.link_key === "P1")?.status).toBe("hold");
  });
});

describe("G9 이름 경로 정확 일치 우선", () => {
  const TRE = "에코델타시티푸르지오트레파크(11BL)";
  const CEN = "에코델타시티푸르지오센터파크";
  it("트레파크(11BL) ↔ {트레파크(11BL), 센터파크 0.857} → 트레파크만 active · 센터파크 dropped · 센터파크 행은 자기 열쇠 active(형제 hold 없음)", () => {
    const r = plan([
      apt({ id: "t", name: "에코델타시티 푸르지오 트레파크(11BL)", lot_main: null, complex_key: "K1" }),
      apt({ id: "c", name: "에코델타시티 푸르지오 센터파크", lot_main: null, complex_key: "K2" }),
    ], [deal("T", TRE, "999", 2020), deal("C", CEN, "998", 2020)]);
    expect(r.desired.map((l) => [l.apartment_id, l.link_key, l.status])).toEqual([["c", "C", "active"], ["t", "T", "active"]]);
    expect(r.dropped.some((d) => d.apartment_id === "t" && d.key === "apt_seq:C" && /정확 일치 후보 있음/.test(d.why))).toBe(true);
  });
  it("정확 일치 후보가 없으면 0.857 후보는 그대로 붙는다(지금 동작)", () => {
    const r = plan([apt({ id: "t", name: "에코델타시티 푸르지오 트레파크(11BL)", lot_main: null })], [deal("C", CEN, "998", 2020)]);
    expect(r.desired.map((l) => [l.link_key, l.method])).toEqual([["C", "name"]]);
  });
  it("부분문자열 후보(한빛마을센트럴 ⊂ 한빛마을센트럴파크, 0.875)는 정확 일치가 있어도 남는다", () => {
    const r = plan([apt({ id: "a", name: "한빛마을센트럴", lot_main: null })], [deal("E", "한빛마을센트럴", "999", 2020), deal("P", "한빛마을센트럴파크", "998", 2020)]);
    expect(r.desired.map((l) => [l.link_key, l.status])).toEqual([["E", "active"], ["P", "active"]]);
  });
});

describe("G2 사람 판정 순서 — rejected 는 후보 단계에서 빠지고 전파를 막는다 · active(manual)는 전파된다", () => {
  const rows = [apt({ id: "a", name: "한빛마을", complex_key: "K" }), apt({ id: "b", name: "전혀다른이름", complex_key: "K", lot_main: null })];
  it("a(지번 일치 S1) · b 같은 묶음 + 「a·S1 rejected」 → b 에 S1 없음 · a 줄은 rejected 로 남음", () => {
    const r = plan(rows, [deal("S1", "한빛마을", "100", 2020)], [{ apartment_id: "a", link_kind: "apt_seq", link_key: "S1", status: "rejected" }]);
    expect(r.desired.map((l) => [l.apartment_id, l.link_key, l.status, l.method])).toEqual([["a", "S1", "rejected", "jibun+name"]]);
  });
  it("「a·P2 active(manual)」(계산은 phase hold) → a active·manual, b 에 P2 bundle", () => {
    const r = plan(rows, [deal("P2", "한빛마을2차", "100", 2020)], [{ apartment_id: "a", link_kind: "apt_seq", link_key: "P2", status: "active" }]);
    expect(r.desired.map((l) => [l.apartment_id, l.status, l.method, l.hold_reason])).toEqual([["a", "active", "manual", null], ["b", "active", "bundle", null]]);
  });
  it("묶음 안 한 행이 rejected 한 열쇠는 다른 행(c)이 스스로 붙어도 나머지 행(d)에 전파하지 않는다", () => {
    const three = [...rows, apt({ id: "c", name: "한빛마을", complex_key: "K" })];
    const r = plan(three, [deal("S1", "한빛마을", "100", 2020)], [{ apartment_id: "a", link_kind: "apt_seq", link_key: "S1", status: "rejected" }]);
    expect(r.desired.map((l) => [l.apartment_id, l.status, l.method])).toEqual([["a", "rejected", "jibun+name"], ["c", "active", "jibun+name"]]);
  });
  it("rejected 쌍은 형제 hold 를 만들지 않는다 — 다른 묶음 a·b 가 S1 공유, a·S1 rejected → b 는 active", () => {
    const sib = [apt({ id: "a", name: "한빛마을", complex_key: "K1" }), apt({ id: "b", name: "한빛마을", complex_key: "K2", lot_main: 101 })];
    const r = plan(sib, [deal("S1", "한빛마을", "100", 2020)], [{ apartment_id: "a", link_kind: "apt_seq", link_key: "S1", status: "rejected" }]);
    expect(r.desired.map((l) => [l.apartment_id, l.status, l.hold_reason])).toEqual([["a", "rejected", null], ["b", "active", null]]);
  });
});

describe("G10 묶음 전파도 이름 충돌 관문", () => {
  it("같은 묶음 「X(2차)」(2단지 열쇠)·「X(3차)」(3단지 열쇠) → 서로의 열쇠는 안 퍼짐(사유 남김) · 차수 없는 「X」 는 둘 다 받음", () => {
    const rows = [
      apt({ id: "a", name: "한빛마을(2차)", complex_key: "K" }),
      apt({ id: "b", name: "한빛마을(3차)", complex_key: "K", lot_main: 101 }),
      apt({ id: "c", name: "한빛마을", complex_key: "K", lot_main: null }),
    ];
    const r = plan(rows, [deal("S2", "한빛마을2단지", "100", 2020), deal("S3", "한빛마을3단지", "101", 2020)]);
    expect(r.desired.map((l) => [l.apartment_id, l.link_key, l.method])).toEqual([
      ["a", "S2", "jibun+name"], ["b", "S3", "jibun+name"], ["c", "S2", "bundle"], ["c", "S3", "bundle"],
    ]);
    expect(r.dropped.filter((d) => /전파 — 차수 충돌/.test(d.why)).map((d) => [d.apartment_id, d.key])).toEqual([["a", "apt_seq:S3"], ["b", "apt_seq:S2"]]);
  });
});

describe("G5 시험 빈칸 — 와일드카드 0.85~1.0 정상 짝 · 창 밖 기존 hold 유지", () => {
  const syl = (/** @type {number} */ i) => String.fromCharCode(0xac00 + 28 * 3 * i + 7);
  const word = (/** @type {number} */ from, /** @type {number} */ n) => Array.from({ length: n }, (_, k) => syl(from + k)).join("");
  it("부번 와일드카드(우리 100 · 거래 100-1)에 유사도 0.9 짝 → jibun+name 으로 붙는다", () => {
    const a = word(0, 20), b = word(0, 18) + word(100, 2);
    expect(stringSimilarity(normLinkName(a), normLinkName(b))).toBeCloseTo(0.9, 10);
    expect(plan([apt({ id: "x", name: a })], [deal("S1", b, "100-1", 2020)]).desired.map((l) => [l.method, l.status])).toEqual([["jibun+name", "active"]]);
  });
  it("사전에 없는 열쇠의 기존 **hold** 줄도 그대로(hold·사유 유지) → diff 에서 unchanged", () => {
    const cur = [{ id: 8, apartment_id: "a", link_kind: "apt_seq", link_key: "OLDH", method: "name", similarity: "0.900", status: "hold", hold_reason: "phase" }];
    const r = planLinks([apt({ id: "a", name: "한빛마을" })], buildKeyDictionary([deal("S1", "한빛마을", "100", 2020)]), [], { now: NOW, current: cur });
    expect(r.desired.filter((l) => l.link_key === "OLDH").map((l) => [l.status, l.hold_reason])).toEqual([["hold", "phase"]]);
    expect(diffLinks(/** @type {any} */ (cur), r.desired).unchanged).toBe(1);
  });
});
