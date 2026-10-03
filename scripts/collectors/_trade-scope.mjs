// @ts-check
/**
 * 단지 하나의 시세 비교 범위 판정 — **순수 함수 모음** (시세 비교 범위 좁히기 나, 세션590)
 *
 * 설계서: docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md §4-3 · §5-2 (R1·R2·R3·R5 · D7~D11)
 * 계획서: docs/superpowers/plans/2026-10-03-trade-scope-b-links-stats.md Task 4
 * 호출: trade-stats.mjs 가 재료(연결 표 active · trade_deals 12개월 완성 batch)를 읽어 단지마다 부르고, 결과를 trade_stats 새 칸에 펼친다.
 *
 * ## 규칙 (상수는 아래 한 곳)
 * - 거래 거름(공통): 해제 거래(cancel_date 가 null·"" 아님) 제외 · 금액·면적 > 0 · 기간 12개월(재료가 이미 12개월)
 * - 판정 종류: 입주 후 → 매매(sale) / 입주 전 → 분양권(presale, R2) / 완공월 모름 → 거래가 있는 쪽(둘 다면 매매).
 *   입주 후 단지가 매매 3건 미만이어도 분양권으로 넘어가지 않는다(T2 로 — R2 그대로, 메인 확인 2026-10-03)
 * - T1 같은 단지: 연결 표 active 열쇠의 그 종류 거래 중 같은 평수(전용 차 < SAME_AREA_TOL_M2) ≥ MIN_DEALS → 중앙값(same_area).
 *   아니면 면적 차 ≤ PER_M2_TOL_M2 거래 ≥ MIN_DEALS 의 ㎡당 중앙값 × 우리 면적(per_m2). 아니면 T2.
 * - T2 같은 동 또래: 같은 법정동(bjd_code 10자리 ↔ sgg_cd+umd_cd, 매매만) · 같은 평수 · 또래(준공 차 ≤ PEER_YEARS, 둘 다 있을 때만) ≥ MIN_DEALS
 *   → 중앙값(dong_peer, same_area). 계수 없음(R5)
 * - T3: none · 적정가 null · 건수 0. 우리 면적을 모르면 T1·T2 를 건너뛰어 none(면적별 표는 채운다)
 * - 같은 단지 전세가율(R3·D11): apt_seq 열쇠의 같은 평수 전세(갱신 제외) ≥ 3 그리고 같은 평수 매매 ≥ 3 → 전세 중앙 ÷ 매매 중앙 × 100
 * - 면적별 표: 연결 열쇠의 그 종류 거래 · 전세(갱신 제외)를 면적(소수 둘째 반올림)별로
 * - 동네 사실: 같은 법정동·같은 평수 매매(나이 제한 없음) ≥ 1 이면 저장 · age_gap_years = 우리 연도 − 그 집들 건축년도 중앙값(양수 = 그 집들이 오래됨)
 * - 우리 단지 거래를 동네 표본에서 빼지 않는다(사실대로)
 *
 * ⚠️ `_` 접두 = 라이브러리(DB 접근 0). 시각은 인자(`now`)로 받는다.
 */
import { isMovedIn, completionMonthIndex } from "./_match-gates.mjs";
import { presaleKeyOf } from "./_trade-links.mjs";

/** 같은 평수 = 전용면적 차 이 값 **미만**(㎡). */
export const SAME_AREA_TOL_M2 = 10;
/** ㎡당 환산에 쓰는 같은 단지 거래 = 면적 차 이 값 **이하**(㎡, D9). */
export const PER_M2_TOL_M2 = 20;
/** 또래 = 준공연도 차 이 값 **이하**(년, R5). */
export const PEER_YEARS = 10;
/** 문턱 = 거래 이 건수 **이상**(D7). */
export const MIN_DEALS = 3;
/** 비교 기간(개월) — 재료(trade_deals)를 이 기간으로 읽는다. */
export const CMP_MONTHS = 12;

/**
 * 중앙값 — `trade-stats.mjs median` 과 **같은 정의**(짝수면 두 가운데 평균을 반올림). 그 함수를 import 하지 않는 이유:
 * trade-stats.mjs 가 이 모듈을 import 하므로 거꾸로 import 하면 순환이 된다(세션590 판정). 둘이 같은 값을 내는지는
 * `_trade-scope.test.mjs` 가 같은 입력표로 맞댄다.
 * @param {number[]} arr
 * @returns {number | null}
 */
export function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** 반올림하지 않는 중앙값(㎡당 값처럼 소수가 의미 있는 곳). @param {number[]} arr @returns {number | null} */
function medianRaw(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * @typedef {{ trade_type: string; area: number; price: number; deal_month: string; build_year?: number | null;
 *   cancel_date?: string | null; contract_type?: string | null; sgg_cd?: string; umd_cd?: string | null }} ScopeDeal
 * @typedef {{ link_kind: "apt_seq" | "presale"; link_key: string }} ScopeLink
 * @typedef {{ id: string; area: number | null | undefined; completion: unknown; bjd_code?: string | null }} ScopeApt
 * @typedef {{ links: readonly ScopeLink[]; dealsByAptSeq: Map<string, ScopeDeal[]>; dealsByPresaleKey: Map<string, ScopeDeal[]>;
 *   saleByUmd: Map<string, ScopeDeal[]>; now: Date }} ScopeCtx
 * @typedef {{ area: number; n: number; min: number; median: number | null; max: number; last_month: string }} AreaRow
 * @typedef {{ n: number; min: number; median: number | null; max: number; build_year_min: number | null; build_year_max: number | null;
 *   age_gap_years: number | null; peer_n: number; peer_median: number | null }} DongFact
 * @typedef {{ cmp_scope: "complex" | "dong_peer" | "none"; cmp_fair_price: number | null; cmp_n: number; cmp_months: number;
 *   cmp_area_mode: "same_area" | "per_m2" | null; cmp_src: "sale" | "presale" | null;
 *   complex_jeonse_rate: number | null; complex_jeonse_n: number | null; complex_sale_n: number | null;
 *   complex_table: AreaRow[]; complex_jeonse_table: AreaRow[]; dong_fact: DongFact | null }} ScopeCols
 */

/** 해제되지 않은 정상 거래인가. @param {ScopeDeal} d */
export function isValidDeal(d) {
  const c = d.cancel_date;
  return (c == null || String(c).trim() === "") && Number(d.price) > 0 && Number(d.area) > 0;
}

/** 전세가율·전세 표에 쓰는 전세인가 — 갱신 계약 제외(D11), 신규·빈칸 포함. @param {ScopeDeal} d */
export function isMarketJeonse(d) {
  return d.trade_type === "jeonse" && String(d.contract_type ?? "").trim() !== "갱신";
}

/** @param {number} a @param {number} b */
const sameArea = (a, b) => Math.abs(a - b) < SAME_AREA_TOL_M2;

/**
 * 면적(소수 둘째 반올림)별 표, 면적 오름차순.
 * @param {readonly ScopeDeal[]} deals
 * @returns {AreaRow[]}
 */
export function areaTable(deals) {
  /** @type {Map<number, ScopeDeal[]>} */
  const g = new Map();
  for (const d of deals) {
    const a = Math.round(Number(d.area) * 100) / 100;
    let list = g.get(a);
    if (!list) { list = []; g.set(a, list); }
    list.push(d);
  }
  return [...g.entries()].sort((x, y) => x[0] - y[0]).map(([area, list]) => {
    const prices = list.map((d) => Number(d.price));
    return {
      area, n: list.length, min: Math.min(...prices), median: median(prices), max: Math.max(...prices),
      last_month: list.reduce((m, d) => (d.deal_month > m ? d.deal_month : m), ""),
    };
  });
}

/**
 * 단지 하나의 새 칸 12개 + 진단(칸에는 안 넣음).
 * @param {ScopeApt} apt
 * @param {ScopeCtx} ctx
 * @returns {{ cols: ScopeCols; diag: { presale_n_if_moved_in: number | null; moved_in: boolean } }}
 */
export function computeScopeStats(apt, ctx) {
  const A = Number(apt.area) > 0 ? Number(apt.area) : null;
  const idx = completionMonthIndex(apt.completion);
  const ourYear = idx == null ? null : Math.floor(idx / 12);
  const movedIn = isMovedIn(apt.completion, ctx.now);

  /** @type {ScopeDeal[]} */
  const seqDeals = [];
  /** @type {ScopeDeal[]} */
  const preDeals = [];
  for (const l of ctx.links) {
    if (l.link_kind === "apt_seq") seqDeals.push(...(ctx.dealsByAptSeq.get(l.link_key) ?? []));
    else if (l.link_kind === "presale") preDeals.push(...(ctx.dealsByPresaleKey.get(l.link_key) ?? []));
  }
  const sale = seqDeals.filter((d) => d.trade_type === "sale" && isValidDeal(d));
  const jeonse = seqDeals.filter((d) => isMarketJeonse(d) && isValidDeal(d));
  const presale = preDeals.filter((d) => d.trade_type === "presale" && isValidDeal(d));

  /** @type {"sale" | "presale"} */
  let srcKind;
  if (movedIn) srcKind = "sale";
  else if (idx != null) srcKind = "presale";
  else srcKind = sale.length > 0 ? "sale" : presale.length > 0 ? "presale" : "sale";
  const src = srcKind === "sale" ? sale : presale;

  /** @type {ScopeCols} */
  const cols = {
    cmp_scope: "none", cmp_fair_price: null, cmp_n: 0, cmp_months: CMP_MONTHS, cmp_area_mode: null, cmp_src: null,
    complex_jeonse_rate: null, complex_jeonse_n: null, complex_sale_n: null,
    complex_table: areaTable(src), complex_jeonse_table: areaTable(jeonse), dong_fact: null,
  };

  if (A != null) {
    // T1 — 같은 단지
    const same = src.filter((d) => sameArea(Number(d.area), A));
    const near = src.filter((d) => Math.abs(Number(d.area) - A) <= PER_M2_TOL_M2);
    if (same.length >= MIN_DEALS) {
      Object.assign(cols, { cmp_scope: "complex", cmp_fair_price: median(same.map((d) => Number(d.price))), cmp_n: same.length, cmp_area_mode: "same_area", cmp_src: srcKind });
    } else if (near.length >= MIN_DEALS) {
      const perM2 = medianRaw(near.map((d) => Number(d.price) / Number(d.area)));
      Object.assign(cols, { cmp_scope: "complex", cmp_fair_price: perM2 == null ? null : Math.round(perM2 * A), cmp_n: near.length, cmp_area_mode: "per_m2", cmp_src: srcKind });
    }
    // 동네 재료(T2 · 동네 사실) — 같은 법정동 매매 · 같은 평수
    const bjd = String(apt.bjd_code ?? "");
    const dongSame = /^\d{10}$/.test(bjd)
      ? (ctx.saleByUmd.get(bjd) ?? []).filter((d) => d.trade_type === "sale" && isValidDeal(d) && sameArea(Number(d.area), A))
      : [];
    const peer = dongSame.filter((d) => ourYear != null && d.build_year != null && Math.abs(Number(d.build_year) - ourYear) <= PEER_YEARS);
    if (cols.cmp_scope === "none" && peer.length >= MIN_DEALS) {
      Object.assign(cols, { cmp_scope: "dong_peer", cmp_fair_price: median(peer.map((d) => Number(d.price))), cmp_n: peer.length, cmp_area_mode: "same_area", cmp_src: "sale" });
    }
    if (dongSame.length >= 1) {
      const prices = dongSame.map((d) => Number(d.price));
      const years = dongSame.map((d) => d.build_year).filter((y) => y != null).map(Number);
      const yMed = median(years);
      cols.dong_fact = {
        n: dongSame.length, min: Math.min(...prices), median: median(prices), max: Math.max(...prices),
        build_year_min: years.length ? Math.min(...years) : null, build_year_max: years.length ? Math.max(...years) : null,
        age_gap_years: ourYear != null && yMed != null ? ourYear - yMed : null,
        peer_n: peer.length, peer_median: median(peer.map((d) => Number(d.price))),
      };
    }
    // 같은 단지 전세가율 — 같은 평수 전세(갱신 제외) ≥ 3 그리고 같은 평수 매매 ≥ 3
    const jSame = jeonse.filter((d) => sameArea(Number(d.area), A));
    const sSame = sale.filter((d) => sameArea(Number(d.area), A));
    cols.complex_jeonse_n = jSame.length;
    cols.complex_sale_n = sSame.length;
    if (jSame.length >= MIN_DEALS && sSame.length >= MIN_DEALS) {
      const jm = median(jSame.map((d) => Number(d.price)));
      const sm = median(sSame.map((d) => Number(d.price)));
      if (jm != null && sm != null && sm > 0) cols.complex_jeonse_rate = Math.round((jm / sm) * 1000) / 10;
    }
  }

  const presaleSame = A != null ? presale.filter((d) => sameArea(Number(d.area), A)).length : null;
  return { cols, diag: { presale_n_if_moved_in: movedIn ? presaleSame : null, moved_in: movedIn } };
}

/**
 * 새 칸이 전부 비었는가 — trade-stats 의 "모든 값 null 이면 건너뜀" 에 AND 로 덧붙인다(계획서 허용 ③).
 * @param {ScopeCols | null | undefined} cols
 * @returns {boolean}
 */
export function scopeColsEmpty(cols) {
  if (!cols) return true;
  return (cols.cmp_scope == null || cols.cmp_scope === "none")
    && cols.dong_fact == null
    && (!cols.complex_table || cols.complex_table.length === 0)
    && (!cols.complex_jeonse_table || cols.complex_jeonse_table.length === 0)
    && cols.complex_jeonse_rate == null;
}

/**
 * trade_deals 행 → 계산용 지도 셋. 분양권 열쇠는 묶기와 **같은 함수**(`_trade-links.mjs presaleKeyOf`)로 만든다.
 * @param {readonly any[]} deals
 * @returns {{ dealsByAptSeq: Map<string, ScopeDeal[]>; dealsByPresaleKey: Map<string, ScopeDeal[]>; saleByUmd: Map<string, ScopeDeal[]> }}
 */
export function indexDeals(deals) {
  /** @type {Map<string, ScopeDeal[]>} */
  const dealsByAptSeq = new Map();
  /** @type {Map<string, ScopeDeal[]>} */
  const dealsByPresaleKey = new Map();
  /** @type {Map<string, ScopeDeal[]>} */
  const saleByUmd = new Map();
  /** @param {Map<string, ScopeDeal[]>} m @param {string} k @param {ScopeDeal} d */
  const push = (m, k, d) => { const l = m.get(k); if (l) l.push(d); else m.set(k, [d]); };
  for (const d of deals) {
    if ((d.trade_type === "sale" || d.trade_type === "jeonse") && d.apt_seq) push(dealsByAptSeq, d.apt_seq, d);
    if (d.trade_type === "presale") push(dealsByPresaleKey, presaleKeyOf(d), d);
    if (d.trade_type === "sale" && d.sgg_cd && d.umd_cd) push(saleByUmd, `${d.sgg_cd}${d.umd_cd}`, d);
  }
  return { dealsByAptSeq, dealsByPresaleKey, saleByUmd };
}
