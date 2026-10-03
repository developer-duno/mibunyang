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
  JIBUN_NAME_MIN, NAME_ONLY_MIN, LINK_BREAKER_MAX_ROWS,
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
