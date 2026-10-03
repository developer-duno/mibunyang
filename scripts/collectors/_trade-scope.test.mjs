// @ts-check
/**
 * `_trade-scope.mjs` 시험 — 경계값(합성 표본) + 대조군 픽스처 표본 값 고정(T1 매매·T1 ㎡당·T2·T3).
 * 픽스처 = `__fixtures__/trade-links/`(세션590 운영 사본 — 거래는 열쇠·종류마다 3행까지 자른 것이라 값은 실제 통계가 아니라 회귀 닻이다).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeScopeStats, median, areaTable, scopeColsEmpty, indexDeals, isValidDeal, isMarketJeonse,
  SAME_AREA_TOL_M2, PER_M2_TOL_M2, PEER_YEARS, MIN_DEALS, CMP_MONTHS,
} from "./_trade-scope.mjs";
import { median as tradeStatsMedian } from "./trade-stats.mjs";
import { buildKeyDictionary, planLinks } from "./_trade-links.mjs";

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

describe("상수 = 설계서 §5-2 값", () => {
  it("10㎡ 미만 · 20㎡ 이하 · 10년 이하 · 3건 · 12개월", () => {
    expect([SAME_AREA_TOL_M2, PER_M2_TOL_M2, PEER_YEARS, MIN_DEALS, CMP_MONTHS]).toEqual([10, 20, 10, 3, 12]);
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
  it("같은 평수 — 차 9.99 포함 · 10.00 제외(3건 문턱)", () => {
    const base = [D({ area: 84.9 }), D({ area: 84.9 })];
    expect(run({ seq: [...base, D({ area: 84.9 + 9.99 })] }).cols.cmp_area_mode).toBe("same_area");
    const r = run({ seq: [...base, D({ area: 84.9 + 10 })] });
    expect(r.cols.cmp_area_mode).toBe("per_m2"); // 같은 평수 2건 → ㎡당(20㎡ 이하 3건)
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
    expect(after.diag).toEqual({ presale_n_if_moved_in: 3, moved_in: true });
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

  it("T1 매매 — 반정 아이파크 캐슬 5단지 84.9㎡", () => {
    const c = scope("ah-2025910141", 84.9);
    expect([c.cmp_scope, c.cmp_src, c.cmp_area_mode, c.cmp_n, c.cmp_fair_price]).toEqual(["complex", "sale", "same_area", 3, 99800]);
  });
  it("T1 ㎡당 — 화성비봉 호반써밋 84.9㎡(같은 평수 2건 + 72.92㎡ 1건)", () => {
    const c = scope("ah-2024910080", 84.9);
    expect([c.cmp_scope, c.cmp_area_mode, c.cmp_n, c.cmp_fair_price]).toEqual(["complex", "per_m2", 3, 47977]);
  });
  it("T2 — 화성시청역 서희스타힐스 4차 84.9㎡(같은 단지 84㎡ 매매 없음 → 신남리 또래)", () => {
    const c = scope("ah-2021910001", 84.9);
    expect([c.cmp_scope, c.cmp_src, c.cmp_n, c.cmp_fair_price]).toEqual(["dong_peer", "sale", 7, 40000]);
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
