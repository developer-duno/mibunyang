// @ts-check
/**
 * `_trade-scope.mjs` 시험 — 경계값(합성 표본) + 대조군 픽스처 표본 값 고정(T1 매매·T1 ㎡당·T2·T3).
 * 픽스처 = `__fixtures__/trade-links/`(세션590 운영 사본 — 거래는 열쇠·종류마다 3행까지 자른 것이라 값은 실제 통계가 아니라 회귀 닻이다).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as scopeMod from "./_trade-scope.mjs";
import {
  computeScopeStats, median, areaTable, scopeColsEmpty, indexDeals, isValidDeal, isMarketJeonse, sameAreaExact,
  PER_M2_TOL_M2, PEER_YEARS, MIN_DEALS, CMP_MONTHS,
} from "./_trade-scope.mjs";
import { median as tradeStatsMedian } from "./trade-stats.mjs";
import { buildKeyDictionary, planLinks } from "./_trade-links.mjs";
import { buildDealRow } from "./_trade-deals.mjs";

const NOW = new Date("2026-10-03T03:00:00Z");
/** 합성 거래 @param {Partial<import("./_trade-scope.mjs").ScopeDeal>} o */
const D = (o) => ({ trade_type: "sale", area: 84.9, price: 50000, deal_month: "202608", build_year: 2020, cancel_date: null, contract_type: null, sgg_cd: "41000", umd_cd: "10100", ...o });
/** @param {number} n @param {Partial<import("./_trade-scope.mjs").ScopeDeal>} o */
const many = (n, o) => Array.from({ length: n }, (_, i) => D({ price: 50000 + i * 1000, ...o }));
/**
 * @param {{ seq?: any[]; pre?: any[]; dong?: any[] }} r
 * @param {{ area?: number | null; completion?: string | null }} [a]
 */
const run = (r, a = {}) => {
  const links = [];
  /** @type {Map<string, any[]>} */
  const dealsByAptSeq = new Map();
  /** @type {Map<string, any[]>} */
  const dealsByPresaleKey = new Map();
  if (r.seq) { links.push({ link_kind: /** @type {const} */ ("apt_seq"), link_key: "S" }); dealsByAptSeq.set("S", r.seq); }
  if (r.pre) { links.push({ link_kind: /** @type {const} */ ("presale"), link_key: "P" }); dealsByPresaleKey.set("P", r.pre); }
  const saleByUmd = new Map([["4100010100", r.dong ?? []]]);
  return computeScopeStats(
    { id: "x", area: a.area === undefined ? 84.9 : a.area, completion: a.completion === undefined ? "202001" : a.completion, bjd_code: "4100010100" },
    { links, dealsByAptSeq, dealsByPresaleKey, saleByUmd, now: NOW },
  );
};

describe("상수 = 설계서 §5-2 값(보조 범위는 그대로 — 세션651 결정)", () => {
  it("20㎡ 이하 · 10년 이하 · 3건 · 12개월", () => {
    expect([PER_M2_TOL_M2, PEER_YEARS, MIN_DEALS, CMP_MONTHS]).toEqual([20, 10, 3, 12]);
  });
  it("옛 같은 평수 폭 상수(10㎡·3㎡)는 없어졌다 — 같은 면적은 sameAreaExact 하나(세션651)", () => {
    expect(/** @type {any} */ (scopeMod).SAME_AREA_TOL_M2).toBeUndefined();
    expect(/** @type {any} */ (scopeMod).JEONSE_SAME_AREA_TOL_M2).toBeUndefined();
  });
});

// 세션651: 같은 면적 = 부동산원 실거래가격지수 정의("단지, 면적, 동, 층그룹이 같은 아파트를 동일 주택으로 가정") —
//   소수 둘째 반올림해 정확히 같을 때만. 국토부 면적은 소수 둘째, 우리 대표 면적은 셋째·넷째까지 있어 반올림해 맞댄다.
describe("sameAreaExact — 소수 둘째 반올림 정확히 같음(설계서 2026-10-18 §2 A1·A3)", () => {
  it.each([
    [84.92, 84.99, false], // 같은 평형의 소수 차이도 다른 면적(옛 10㎡·3㎡ 폭이면 같음)
    [84.985, 84.99, true], // 셋째 자리 5 는 올림
    [84.9871, 84.99, true], // 우리 대표 면적(넷째) vs 국토부(둘째)
    [84.98, 84.99, false], // 0.01 차이도 다름
    [59.99, 60.0, false],
  ])("%f vs %f → %s", (a, b, want) => {
    expect(sameAreaExact(a, b)).toBe(want);
    expect(sameAreaExact(b, a)).toBe(want); // 순서 무관
  });

  it("적정가 T1 — 84.9871 대표 면적에 84.99 거래 3건 = 같은 면적 · 84.98 거래 3건 = 아님(㎡당으로 넘어감)", () => {
    const hit = run({ seq: many(3, { area: 84.99 }) }, { area: 84.9871 });
    expect([hit.cols.cmp_scope, hit.cols.cmp_area_mode, hit.cols.cmp_n]).toEqual(["complex", "same_area", 3]);
    const miss = run({ seq: many(3, { area: 84.98 }) }, { area: 84.9871 });
    expect([miss.cols.cmp_scope, miss.cols.cmp_area_mode]).toEqual(["complex", "per_m2"]);
  });

  it("적정가 T2(동네 또래) · 동네 사실도 같은 판정 — 84.92 동네 거래는 84.99 단지의 같은 면적이 아니다", () => {
    expect(run({ dong: many(3, { area: 84.99, build_year: 2020 }) }, { area: 84.99 }).cols.cmp_scope).toBe("dong_peer");
    const r = run({ dong: many(3, { area: 84.92, build_year: 2020 }) }, { area: 84.99 });
    expect([r.cols.cmp_scope, r.cols.dong_fact]).toEqual(["none", null]);
  });

  it("전세가율 — 적정가와 같은 판정: 전세·매매 둘 다 84.92 는 84.99 단지에서 빠진다", () => {
    const s99 = many(3, { area: 84.99, price: 100000 });
    const j99 = many(3, { area: 84.99, trade_type: "jeonse", price: 60000 });
    const s92 = many(3, { area: 84.92, price: 70000 }); // 매매 쪽 섞임(sSame 만 폭으로 되돌리는 변이를 잡는다)
    const j92 = many(3, { area: 84.92, trade_type: "jeonse", price: 20000 }); // 전세 쪽 섞임(jSame 만 되돌리는 변이를 잡는다)
    const r = run({ seq: [...s99, ...j99, ...s92, ...j92] }, { area: 84.9871 });
    expect([r.cols.complex_jeonse_rate, r.cols.complex_jeonse_n, r.cols.complex_sale_n]).toEqual([60, 3, 3]);
    expect([r.cols.cmp_scope, r.cols.cmp_area_mode, r.cols.cmp_n, r.cols.cmp_fair_price]).toEqual(["complex", "same_area", 3, 100000]);
    expect(r.diag.sale_same_n).toBe(3); // 진단도 같은 판정 — complex_sale_n 과 같다
  });

  it("저장 반올림(_trade-deals buildDealRow 의 area)과 판정 반올림이 같은 식 — 원문 면적과 저장된 면적이 늘 같은 면적", () => {
    // 한쪽만 바꾸면(예: 판정에만 +1e-9 보정) 셋째 자리가 5 인 원문(20.115 → 저장 20.11)에서 같은 집이 다른 면적이 된다(세션651 보완)
    /** @param {any} it @param {string} tag */
    const getTag = (it, tag) => it[tag] ?? "";
    for (const raw of ["84.9871", "84.985", "20.115", "59.995", "84.995", "1.005", "84.92", "59.9", "135.6745"]) {
      const row = buildDealRow({ excluUseAr: raw, dealAmount: "50,000" }, { type: "sale", region: "경기", gu: "화성시", sggCd: "41590", month: "202608", getTag });
      expect(row, raw).not.toBeNull();
      const stored = /** @type {any} */ (row).area;
      expect(sameAreaExact(Number(raw), stored), `${raw} → 저장 ${stored}`).toBe(true);
      expect(sameAreaExact(stored, stored)).toBe(true);
    }
  });

  it("분양권 진단(presale_n_if_moved_in)도 같은 판정", () => {
    const r = run({ pre: [...many(2, { trade_type: "presale", area: 84.99 }), D({ trade_type: "presale", area: 84.92 })] }, { area: 84.99, completion: "202001" });
    expect(r.diag.presale_n_if_moved_in).toBe(2);
  });
});

// 세션607(다): 점수·화면 문구가 쓰는 짝 상수(src/constants/scoringTiers.ts)가 여기 정본과 같은지 — 한쪽만 바뀌면
//   "같은 동 비슷한 연식(±N년)"·"면적 N㎡ 이내 ㎡당 환산" 문구가 실제 규칙과 어긋난다.
describe("짝 상수 — scoringTiers.ts 의 문구용 숫자 = 이 파일 정본", () => {
  it("TRADE_SCOPE_PEER_YEARS = PEER_YEARS · TRADE_SCOPE_PER_M2_TOL_M2 = PER_M2_TOL_M2", async () => {
    const tiers = await import("../../src/constants/scoringTiers");
    expect(tiers.TRADE_SCOPE_PEER_YEARS).toBe(PEER_YEARS);
    expect(tiers.TRADE_SCOPE_PER_M2_TOL_M2).toBe(PER_M2_TOL_M2);
  });
});

describe("median — trade-stats.mjs 와 같은 정의(순환 import 를 피해 옮겨 둔 사본)", () => {
  it("같은 입력표에 같은 답 · 짝수 개는 두 가운데 평균 반올림", () => {
    const table = [[], [5], [3, 1, 2], [1, 2], [1, 4], [10, 20, 31, 40], [7.5, 2.25], [100, 101, 102, 103, 104, 105]];
    for (const t of table) expect(median(t), JSON.stringify(t)).toBe(tradeStatsMedian(t));
    expect(median([1, 4])).toBe(3); // 2.5 → 3
    expect(median([10, 20, 31, 40])).toBe(26); // 25.5 → 26
  });
});

describe("경계값", () => {
  it("같은 면적 — 소수 둘째 반올림이 같으면 포함(84.904) · 0.01 달라도 제외(84.91)(3건 문턱, 세션651)", () => {
    const base = [D({ area: 84.9 }), D({ area: 84.9 })];
    expect(run({ seq: [...base, D({ area: 84.904 })] }).cols.cmp_area_mode).toBe("same_area");
    const r = run({ seq: [...base, D({ area: 84.91 })] });
    expect(r.cols.cmp_area_mode).toBe("per_m2"); // 같은 면적 2건 → ㎡당(20㎡ 이하 3건)
  });

  it("㎡당 — 면적 차 20.00 포함 · 20.01 제외", () => {
    const two = [D({ area: 84.9, price: 84900 }), D({ area: 84.9, price: 84900 })];
    const ok = run({ seq: [...two, D({ area: 104.9, price: 104900 })] });
    expect([ok.cols.cmp_scope, ok.cols.cmp_area_mode, ok.cols.cmp_fair_price, ok.cols.cmp_n]).toEqual(["complex", "per_m2", 84900, 3]);
    const no = run({ seq: [...two, D({ area: 104.91, price: 104910 })] });
    expect(no.cols.cmp_scope).toBe("none");
  });

  it("문턱 — 3건 포함 · 2건 제외", () => {
    expect(run({ seq: many(3, {}) }).cols.cmp_scope).toBe("complex");
    expect(run({ seq: many(2, {}) }).cols.cmp_scope).toBe("none");
  });

  it("또래 — 준공 차 10년 포함 · 11년 제외(T2) · 건축년도 없으면 또래로 안 셈", () => {
    expect(run({ dong: many(3, { build_year: 2010 }) }).cols.cmp_scope).toBe("dong_peer"); // 우리 2020 − 2010 = 10
    expect(run({ dong: many(3, { build_year: 2009 }) }).cols.cmp_scope).toBe("none");
    expect(run({ dong: many(3, { build_year: null }) }).cols.cmp_scope).toBe("none");
    const r = run({ dong: many(3, { build_year: 2010 }) });
    expect([r.cols.cmp_area_mode, r.cols.cmp_src, r.cols.cmp_n, r.cols.cmp_fair_price]).toEqual(["same_area", "sale", 3, 51000]);
  });

  it("해제 거래 제외 — null·\"\" 은 정상, 날짜가 있으면 뺀다", () => {
    expect(isValidDeal(D({ cancel_date: null }))).toBe(true);
    expect(isValidDeal(D({ cancel_date: "" }))).toBe(true);
    expect(isValidDeal(D({ cancel_date: " " }))).toBe(true);
    expect(isValidDeal(D({ cancel_date: "26.08.15" }))).toBe(false);
    expect(run({ seq: [...many(2, {}), D({ cancel_date: "26.08.15" })] }).cols.cmp_scope).toBe("none");
  });

  it("갱신 전세 제외 · 신규·빈칸 포함(D11)", () => {
    expect(isMarketJeonse(D({ trade_type: "jeonse", contract_type: "갱신" }))).toBe(false);
    expect(isMarketJeonse(D({ trade_type: "jeonse", contract_type: "신규" }))).toBe(true);
    expect(isMarketJeonse(D({ trade_type: "jeonse", contract_type: null }))).toBe(true);
    expect(isMarketJeonse(D({ trade_type: "jeonse", contract_type: "" }))).toBe(true);
  });

  it("입주 전 → 분양권 · 입주 후 → 매매(분양권 3건이 있어도 매매 2건이면 T1 아님 — R2) · 모름 → 매매 우선", () => {
    const pre = many(3, { trade_type: "presale", price: 60000 });
    const sale2 = many(2, {});
    const before = run({ seq: sale2, pre }, { completion: "202812" });
    expect([before.cols.cmp_scope, before.cols.cmp_src]).toEqual(["complex", "presale"]);
    const after = run({ seq: sale2, pre }, { completion: "202001" });
    expect(after.cols.cmp_scope).toBe("none");
    expect(after.diag).toEqual({ presale_n_if_moved_in: 3, sale_same_n: 2, moved_in: true });
    const unknownBoth = run({ seq: many(3, {}), pre }, { completion: null });
    expect(unknownBoth.cols.cmp_src).toBe("sale");
    const unknownPre = run({ pre }, { completion: null });
    expect(unknownPre.cols.cmp_src).toBe("presale");
    expect(before.diag.presale_n_if_moved_in).toBe(null);
  });

  it("면적 미상 → none · 그래도 면적별 표는 채운다", () => {
    const r = run({ seq: [...many(3, {}), ...many(3, { trade_type: "jeonse", price: 30000 })] }, { area: null });
    expect(r.cols.cmp_scope).toBe("none");
    expect(r.cols.complex_table.length).toBe(1);
    expect(r.cols.complex_jeonse_table.length).toBe(1);
    expect([r.cols.complex_jeonse_rate, r.cols.complex_jeonse_n, r.cols.dong_fact]).toEqual([null, null, null]);
  });

  it("전세가율 — 전세·매매 둘 다 같은 평수 3건 이상이어야(분자만·분모만 3이면 null, 건수는 적는다)", () => {
    const sale3 = many(3, { price: 100000 });
    const j3 = many(3, { trade_type: "jeonse", price: 60000 });
    const ok = run({ seq: [...sale3, ...j3] });
    expect([ok.cols.complex_jeonse_rate, ok.cols.complex_jeonse_n, ok.cols.complex_sale_n]).toEqual([60, 3, 3]);
    const fewJ = run({ seq: [...sale3, ...many(2, { trade_type: "jeonse", price: 60000 })] });
    expect([fewJ.cols.complex_jeonse_rate, fewJ.cols.complex_jeonse_n]).toEqual([null, 2]);
    const fewS = run({ seq: [...many(2, { price: 100000 }), ...j3] });
    expect([fewS.cols.complex_jeonse_rate, fewS.cols.complex_sale_n]).toEqual([null, 2]);
    const renew = run({ seq: [...sale3, ...many(3, { trade_type: "jeonse", price: 60000, contract_type: "갱신" })] });
    expect(renew.cols.complex_jeonse_rate).toBe(null);
  });

  it("전세가율 · 적정가 — 다른 평형(올림픽파크 포레온 40㎡ 에 30㎡ 섞임 꼴)은 둘 다 빠진다(세션651 같은 판정)", () => {
    // 대표 40㎡ · 매매 40㎡ 3건(10억대) + 30㎡ 3건(7억대) · 전세 40㎡ 3건(4억) — 폭으로 묶으면 매매 중앙이 내려가 비율이 틀어진다
    const s40 = many(3, { area: 39.95, price: 100000 });
    const s30 = many(3, { area: 30.5, price: 70000 });
    const j40 = many(3, { area: 39.95, trade_type: "jeonse", price: 40000 });
    const j30 = many(3, { area: 30.5, trade_type: "jeonse", price: 20000 });
    const r = run({ seq: [...s40, ...s30, ...j40, ...j30] }, { area: 39.95 });
    expect([r.cols.complex_jeonse_rate, r.cols.complex_jeonse_n, r.cols.complex_sale_n]).toEqual([40, 3, 3]); // 40000 ÷ 100000 (10㎡ 로 묶였다면 매매 중앙 85000 → 47.1)
    expect([r.cols.cmp_scope, r.cols.cmp_area_mode, r.cols.cmp_n]).toEqual(["complex", "same_area", 3]); // 옛 10㎡ 폭이면 6
    expect(r.diag.sale_same_n).toBe(3);
    // 경계: 소수 둘째 반올림이 같으면(40.004 → 40.00) 같은 면적, 0.01 다르면 아니다
    const edge = (/** @type {number} */ a) => run({ seq: [...many(3, { area: a, price: 100000 }), ...many(3, { area: 40, trade_type: "jeonse", price: 40000 })] }, { area: 40 }).cols;
    expect(edge(40.004).complex_jeonse_rate).toBe(40);
    expect([edge(40.01).complex_jeonse_rate, edge(40.01).complex_sale_n]).toEqual([null, 0]);
  });

  it("동네 사실 — 나이 제한 없음 · age_gap 부호(우리 2024 · 그 집들 중앙 2002 → +22) · 또래 수 따로", () => {
    const dong = [D({ build_year: 2001 }), D({ build_year: 2002 }), D({ build_year: 2002 }), D({ build_year: 2003 }), D({ build_year: 2020, price: 90000 })];
    const r = run({ dong }, { completion: "202401" });
    expect(r.cols.dong_fact).toEqual({ n: 5, min: 50000, median: 50000, max: 90000, build_year_min: 2001, build_year_max: 2020, age_gap_years: 22, peer_n: 1, peer_median: 90000 });
    expect(r.cols.cmp_scope).toBe("none"); // 또래 1건뿐 → 판정 없음(사실만)
    expect(run({ dong }, { completion: null }).cols.dong_fact?.age_gap_years).toBe(null);
    expect(run({ dong: [] }).cols.dong_fact).toBe(null);
  });

  it("T1 이 있으면 T2 를 보지 않는다 · 우리 단지 거래를 동네 표본에서 빼지 않는다", () => {
    const seq = many(3, { price: 70000 });
    const r = run({ seq, dong: [...seq, ...many(3, { price: 40000 })] });
    expect([r.cols.cmp_scope, r.cols.cmp_fair_price]).toEqual(["complex", 70000]);
    expect(r.cols.dong_fact?.n).toBe(6);
  });

  it("complex_src(F8) — 입주 전 T2 면 cmp_src=sale(동네 매매)인데 표는 분양권이라 complex_src=presale · 연결 없으면 null", () => {
    const r = run({ pre: many(1, { trade_type: "presale", price: 60000 }), dong: many(3, { build_year: 2027 }) }, { completion: "202812" });
    expect([r.cols.cmp_scope, r.cols.cmp_src, r.cols.complex_src, r.cols.complex_table.length]).toEqual(["dong_peer", "sale", "presale", 1]);
    expect(run({ seq: many(3, {}) }).cols.complex_src).toBe("sale");
    expect(run({ dong: many(3, {}) }).cols.complex_src).toBe(null);
  });

  it("면적별 표 — 소수 둘째 반올림 묶음 · 면적 오름차순 · 마지막 달", () => {
    const t = areaTable([D({ area: 84.994, price: 3, deal_month: "202605" }), D({ area: 84.99, price: 1, deal_month: "202608" }), D({ area: 59.9, price: 2 })]);
    expect(t).toEqual([
      { area: 59.9, n: 1, min: 2, median: 2, max: 2, last_month: "202608" },
      { area: 84.99, n: 2, min: 1, median: 2, max: 3, last_month: "202608" },
    ]);
  });

  it("scopeColsEmpty — 전부 비었을 때만 참", () => {
    expect(scopeColsEmpty(run({}).cols)).toBe(true);
    expect(scopeColsEmpty(run({ dong: [D({})] }).cols)).toBe(false);
    expect(scopeColsEmpty(null)).toBe(true);
  });

  it("complex_area(세션650) — 대표 면적 A 를 소수 넷째 반올림 · A 없으면 null · 전세가율이 없어도 실림", () => {
    expect(run({}, { area: 84.9967 }).cols.complex_area).toBe(84.9967); // 넷째까지는 그대로 — 84/85 표기는 읽는 쪽 몫
    expect(run({}, { area: 59.99449 }).cols.complex_area).toBe(59.9945);
    // 경계: 다섯째가 5 — Math.round(A*1e4)/1e4 는 올리고, Number(A.toFixed(4)) 는 이진 표현 탓에 84.0003 으로 내린다
    expect(run({}, { area: 84.00035 }).cols.complex_area).toBe(84.0004);
    // 칸 NUMERIC(8,4) 상한 9999.9999 — 넘치면 upsert 전체가 실패하므로 null
    expect(run({}, { area: 9999.99994 }).cols.complex_area).toBe(9999.9999);
    expect(run({}, { area: 10000 }).cols.complex_area).toBe(null);
    expect(run({}, { area: null }).cols.complex_area).toBe(null);
    expect(run({}, { area: 0 }).cols.complex_area).toBe(null);
    // 전세가율 문턱 미달(매매 2건)이어도 면적은 실린다 — 대표 면적은 모든 범위 계산의 기준
    const fewS = run({ seq: [...many(2, { price: 100000 }), ...many(3, { trade_type: "jeonse", price: 60000 })] }, { area: 84.9967 });
    expect([fewS.cols.complex_jeonse_rate, fewS.cols.complex_area]).toEqual([null, 84.9967]);
  });

  it("scopeColsEmpty — complex_area 는 보지 않는다(면적만 있고 다른 칸이 다 비면 빈 것 · 행을 새로 만들지 않게)", () => {
    const c = run({}, { area: 84.9967 }).cols;
    expect(c.complex_area).toBe(84.9967);
    expect(scopeColsEmpty(c)).toBe(true);
  });
});

describe("대조군 픽스처 표본 값 고정(T1 매매 · T1 ㎡당 · T2 · T3)", () => {
  const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "trade-links");
  const APTS = JSON.parse(readFileSync(path.join(DIR, "apartments.json"), "utf8")).rows;
  const DEALS = JSON.parse(readFileSync(path.join(DIR, "deals.json"), "utf8")).rows;
  const { desired } = planLinks(APTS, buildKeyDictionary(DEALS), [], { now: NOW });
  const idx = indexDeals(DEALS);
  /** @param {string} id @param {number} area */
  const scope = (id, area) => {
    const a = APTS.find((/** @type {any} */ x) => x.id === id);
    const links = desired.filter((l) => l.apartment_id === id && l.status === "active");
    return computeScopeStats({ id, area, completion: a.completion, bjd_code: a.bjd_code }, { links, ...idx, now: NOW }).cols;
  };

  // 세션651: 같은 면적이 "정확히 같음"이 되면서 대표 면적을 픽스처 거래의 실제 면적으로 준다(옛 84.9 는 10㎡ 폭 시절 근사값).
  it("T1 매매 — 반정 아이파크 캐슬 5단지 84.73㎡", () => {
    const c = scope("ah-2025910141", 84.73);
    expect([c.cmp_scope, c.cmp_src, c.cmp_area_mode, c.cmp_n, c.cmp_fair_price]).toEqual(["complex", "sale", "same_area", 3, 99800]);
    expect(scope("ah-2025910141", 84.9).cmp_area_mode).toBe("per_m2"); // 옛 근사 면적 84.9 는 84.73 거래와 같은 면적이 아니다(㎡당 환산으로)
  });
  it("T1 ㎡당 — 화성비봉 호반써밋 84.94㎡(같은 면적 2건 + 72.92㎡ 1건)", () => {
    const c = scope("ah-2024910080", 84.94);
    expect([c.cmp_scope, c.cmp_area_mode, c.cmp_n, c.cmp_fair_price]).toEqual(["complex", "per_m2", 3, 48000]);
  });
  it("T2 — 화성시청역 서희스타힐스 4차 75.8㎡(같은 단지 매매는 75.89·59.99 와 해제 1건뿐 → 신남리 75.8㎡ 또래)", () => {
    const c = scope("ah-2021910001", 75.8);
    expect([c.cmp_scope, c.cmp_src, c.cmp_n, c.cmp_fair_price]).toEqual(["dong_peer", "sale", 4, 41250]);
    // 옛 닻(84.9㎡ 에 75㎡대 동네 거래 7건이 "같은 평수"로 묶였던 것)은 새 판정에서 성립하지 않는다
    expect(scope("ah-2021910001", 84.9).cmp_scope).toBe("none");
  });
  it("T3 — 금강펜테리움 6차 84.9㎡(같은 단지 전세만 · 신동 84㎡ 매매 없음)", () => {
    const c = scope("ah-2023910032", 84.9);
    expect([c.cmp_scope, c.cmp_fair_price, c.cmp_n, c.dong_fact]).toEqual(["none", null, 0, null]);
    expect(c.complex_jeonse_table.length).toBe(2);
  });
  it("전세가율 100% 초과 0(대조군 전 단지 · 59.9/84.9㎡)", () => {
    for (const a of APTS) for (const area of [59.9, 84.9]) {
      const r = scope(a.id, area).complex_jeonse_rate;
      if (r != null) expect(r).toBeLessThanOrEqual(100);
    }
  });
});
