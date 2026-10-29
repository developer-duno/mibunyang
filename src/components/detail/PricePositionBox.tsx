import { Fragment, memo } from "react";
import { C, F } from "@/theme";
import { TRADE_SCOPE_PEER_YEARS, TRADE_SCOPE_PER_M2_TOL_M2 } from "@/constants/scoringTiers";
import { fmtPrice, fmtPriceGap, fmtPriceRange } from "@/lib/format";
import { hasKnownArea } from "@/lib/area";
import { hasRange } from "@/constants/cardChips";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 맨 위 상자 — "이 분양가를 **무엇과** 견줬고, 두 숫자가 얼마나 다른가" (세션589 · 609 라 · 651).
 *
 * 세션651(사장님 결정 — 공공기관 준거): 판정어("저렴/비쌈/적정가 수준")·초록/빨강 색·"적정가 대비 위치"
 *   눈금을 지우고 **비교 대상의 사실**(무엇과 · 중앙값 · 건수 · 기간 · 분양가 · 산술 차이)과 **출처**만 적는다.
 *   "같은 집" 기준은 한국부동산원 실거래가격지수 정의(단지·면적이 같은 아파트)를 따른다.
 *
 * ① 머리 줄 — 어느 범위의 거래와 견줬는지(`cmpScope`)를 그대로 말한다. 점수(`scorePrice.ts`)가 쓴 범위와
 *    **같은 칸**에서 읽으므로 문구와 점수가 어긋나지 않는다. 보조 범위(같은 동 또래 ±N년 · ㎡당 환산)는
 *    부동산원 정의에 없는 우리 기준이라 그 폭을 문장에 그대로 밝힌다(숫자는 상수에서 읽는다).
 *    ⚠️ `cmpScope` 가 `undefined`(옛 정적 JSON·마이그 전)·`null`(trade_stats 행 없음)이면 머리 줄을 안 그린다 —
 *       "거래가 없다"고 말할 근거가 없는 자리다(우리 수집 상태를 손님 문장으로 만들지 않는다).
 *
 * ② 표 — 분양가 · 비교 중앙값(건수·기간) · 차이 · 같은 단지 전세가율(산식). 차이는 점수 캐시의 괴리율
 *    (`priceCat.deviation`)인데, 캐시의 범위(`fairPriceScope`)가 지금 칸과 다르면(재계산 전 옛 캐시) 차이 줄을
 *    비운다 — 서로 다른 기준의 숫자를 한 상자에 나란히 두지 않는다.
 *    세션661: 실거래 최저~최고가 있으면(`hasRange`) 범위 줄(큰 글씨)·막대·가운데 값(작게)·전세 범위로 그린다(`compareRows`·`rangeBar`).
 *
 * ③ 동네 사실 줄 (세션609 · R5) — 같은 동·같은 평수 매매를 **나이 제한 없이** 사실대로(T2·T3 에서만).
 *    ⚠️ 준공 연도 토막은 가격 토막과 **같은 줄·같은 글자 크기**(§8 픽셀 조건).
 *
 * ④ 출처 줄 — 표가 있을 때만.
 */

const S = {
  box: {
    background: C.bg,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  title: { fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8, lineHeight: 1.5 },
  row: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: F.sm, lineHeight: 1.7 },
  rowLabel: { color: C.sub },
  rowValue: { color: C.text, fontWeight: 600, textAlign: "right" },
  // 세션661 「안 가」: 범위 줄이 큰 글씨, 가운데 값은 작게 · 범위 줄 아래 건수·기간 작은 글씨 · 최저~최고 막대
  rowSmall: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: F.xs,
    lineHeight: 1.7,
    color: C.sub,
  },
  rowSub: { fontSize: F.xs, color: C.muted, lineHeight: 1.5, textAlign: "right" },
  barTrack: { position: "relative", height: 6, borderRadius: 3, background: C.track, margin: "6px 4px 8px" },
  barFill: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderRadius: 3, background: C.gridStrong },
  barDot: {
    position: "absolute",
    top: "50%",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: C.amber,
    border: `2px solid ${C.white}`,
    transform: "translate(-50%, -50%)",
  },
  fact: { fontSize: F.sm, color: C.sub, lineHeight: 1.6 },
  source: { fontSize: F.xs, color: C.muted, lineHeight: 1.5, marginTop: 8 },
} as const;

type PriceCatLike =
  | {
      fairPrice?: number | string | null;
      deviation?: string | number | null;
      fairPriceScope?: "complex" | "dong_peer" | "none";
    }
  | null
  | undefined;

type Scope = "complex" | "dong_peer" | "none";

/** 출처 줄 — 표가 있을 때 상자 맨 아래에 찍힌다. 거래 자료 출처는 늘 같다. */
export const PRICE_SOURCE_TEXT = "출처: 국토교통부 아파트 실거래가(공공데이터포털)";
/** "같은 집" 기준 토막 — 부동산원 정의(단지·면적 같음)에 실제로 맞는 비교에만 붙인다. */
export const SAME_HOME_BASIS_TEXT = "같은 집 기준 = 한국부동산원 실거래가격지수 정의(단지·면적 같음)";

/**
 * 출처 줄 (세션651 검사관 보완) — "같은 집 기준 = 부동산원 정의" 는 **같은 단지 · 같은 면적**(범위 complex +
 * `cmpAreaMode === "same_area"`)일 때만 참이다. ㎡당 환산(가까운 면적)·같은 동 또래(다른 단지)는 부동산원
 * 정의에 없는 우리 보조 범위라 그 토막을 붙이면 거짓이 된다 — 국토부 출처만 적는다(범위의 폭은 머리 줄이 밝힌다).
 * 분양권 거래와 견준 경우(`cmpSrc === "presale"`)도 뺀다 — 부동산원 실거래가격지수는 매매 거래 기준이다.
 */
export function priceSourceText(apt: Apt): string {
  const sameHome = effectiveScope(apt) === "complex" && apt.cmpAreaMode === "same_area" && apt.cmpSrc !== "presale";
  return sameHome ? `${PRICE_SOURCE_TEXT} · ${SAME_HOME_BASIS_TEXT}` : PRICE_SOURCE_TEXT;
}

/**
 * 지금 칸이 말하는 범위 — `scorePrice.ts` 와 같은 판정(범위가 complex·dong_peer 여도 비교 중앙값이 0 이하면 비교 없음).
 * `undefined`(칸 없음)·`null`(행 없음)은 `null` — 머리 줄을 그리지 않는다.
 */
export function effectiveScope(apt: Apt): Scope | null {
  const s = apt.cmpScope;
  if (s == null) return null;
  if ((s === "complex" || s === "dong_peer") && Number(apt.cmpFairPrice) > 0) return s;
  return "none";
}

/** 비교한 거래가 무엇인가 — 표의 중앙값 줄 이름. */
function compareLabel(apt: Apt, scope: "complex" | "dong_peer"): string {
  if (scope === "dong_peer") return "같은 동 또래 실거래";
  return apt.cmpSrc === "presale" ? "이 단지 분양권 거래" : "이 단지 실거래";
}

/** 캐시의 괴리율이 지금 칸과 같은 범위에서 나온 값인가 — 아니면 차이 숫자를 쓰지 않는다. */
function devOf(priceCat: PriceCatLike, scope: Scope | null): number | null {
  if (scope == null || scope === "none") return null;
  if (!(Number(priceCat?.fairPrice) > 0) || priceCat?.deviation == null) return null;
  if (priceCat.fairPriceScope !== scope) return null;
  const dev = Number(priceCat.deviation);
  return Number.isFinite(dev) ? dev : null;
}

/**
 * 시세 탭 머리 줄 — 범위(`cmpScope`)와 일치하는 문장. 칸이 없으면 null.
 * 면적을 모르면(`hasKnownArea`) "(전용 N㎡)" 토막을 뺀다. 숫자 폭(±N년·N㎡)은 상수에서 읽는다.
 */
export function scopeHeadText(apt: Apt): string | null {
  const scope = effectiveScope(apt);
  if (scope == null) return null;
  if (scope === "none") return "비교할 실거래가 아직 없어요";
  const perM2 = apt.cmpAreaMode === "per_m2";
  // 면적은 소수 둘째까지(사장님 결정 10/18) — 국토부 실거래 표기·"정확히 같음" 판정(둘째 반올림)과 같은 자릿수. 저장값은 넷째까지일 수 있다
  const areaText = hasKnownArea(apt.area) ? `(전용 ${Math.round(Number(apt.area) * 100) / 100}㎡)` : "";
  const area = `${perM2 ? "비슷한" : "같은"} 평수${areaText}`;
  const who =
    scope === "dong_peer"
      ? `같은 동 비슷한 연식(±${TRADE_SCOPE_PEER_YEARS}년)·${area} 실거래`
      : `이 단지 ${area} ${apt.cmpSrc === "presale" ? "분양권 거래" : "실거래"}`;
  const tail = perM2 ? ` (면적 ${TRADE_SCOPE_PER_M2_TOL_M2}㎡ 이내 ㎡당 환산)` : "";
  return `${who}와 견주면${tail}`;
}

/** 표의 한 줄 — `small` = 가운데 값처럼 작게 · `sub` = 값 아래 작은 글씨(건수·기간). */
export type CompareRow = { key: string; label: string; value: string; small?: boolean; sub?: string };

/**
 * 표의 줄들 — 분양가 · 비교 중앙값 · 차이 · 전세가율. 값이 없는 줄은 빼고 0 으로 적지 않는다.
 * 범위가 complex·dong_peer 가 아니면 가격 줄은 없다(전세가율 줄만 남을 수 있다).
 *
 * 세션661(사장님 결정 ① 「범위 + 가운데 값 작게」): `hasRange(apt)` 가 참이면 중앙값 줄 대신
 *   분양가 · 실거래 범위(큰 글씨 + 건수·기간 작은 글씨 · 막대는 `rangeBar`) · 가운데 값(작게) · 차이 · 전세 범위 · 전세가율.
 *   범위·가운데 값·전세 범위는 수집기가 **같은 거래 집합**에서 낸 값이다(trade_stats cmp_min/max·complex_jeonse_min/max).
 *   거짓(반영 전·옛 캐시·범위 none)이면 지금 줄 구성 그대로.
 */
export function compareRows(apt: Apt, priceCat: PriceCatLike): CompareRow[] {
  const rows: CompareRow[] = [];
  const scope = effectiveScope(apt);
  if (scope === "complex" || scope === "dong_peer") {
    const price = Number(apt.price);
    if (price > 0) rows.push({ key: "price", label: "분양가", value: fmtPrice(price) });
    const n = Number(apt.cmpN ?? 0) || 0;
    const months = Number(apt.cmpMonths ?? 0);
    const counts = [n > 0 ? `${n}건` : null, months > 0 ? `최근 ${months}개월` : null].filter(Boolean).join(" · ");
    const dev = devOf(priceCat, scope);
    if (hasRange(apt)) {
      const sub = [counts || null, apt.cmpAreaMode === "per_m2" ? "㎡당 환산" : null].filter(Boolean).join(" · ");
      rows.push({
        key: "range",
        label: compareLabel(apt, scope),
        value: fmtPriceRange(Number(apt.cmpMin), Number(apt.cmpMax)),
        ...(sub ? { sub } : {}),
      });
      rows.push({ key: "median", label: "가운데 값", value: fmtPrice(Number(apt.cmpFairPrice)), small: true });
      if (dev != null && price > 0) rows.push({ key: "gap", label: "차이", value: fmtPriceGap(dev) });
      const jMin = apt.complexJeonseMin,
        jMax = apt.complexJeonseMax;
      if (Number.isFinite(jMin) && Number.isFinite(jMax)) {
        const jn = Number(apt.complexJeonseN);
        rows.push({
          key: "jeonseRange",
          // 같은 동 또래 상자에서는 위 범위가 다른 단지 거래라 "이 단지" 를 밝힌다
          label: scope === "dong_peer" ? "이 단지 전세" : "전세",
          value: `${fmtPriceRange(Number(jMin), Number(jMax))}${jn > 0 ? ` (${jn}건)` : ""}`,
        });
      }
    } else {
      rows.push({
        key: "median",
        label: `${compareLabel(apt, scope)} 중앙값`,
        value: `${fmtPrice(Number(apt.cmpFairPrice))}${counts ? ` (${counts})` : ""}`,
      });
      if (dev != null && price > 0) rows.push({ key: "gap", label: "차이", value: fmtPriceGap(dev) });
    }
  }
  const jeonse = complexJeonseText(apt);
  if (jeonse) rows.push({ key: "jeonse", label: "전세가율", value: jeonse });
  return rows;
}

/**
 * 범위 줄 아래 막대(세션661 「안 가」) — 최저~최고 가로 막대 위 분양가 자리(주황 점).
 * 그리지 않음(null): 범위 없음(`hasRange` 거짓·범위 none) · 최저 = 최고(0÷0) · 분양가 모름.
 * 분양가가 범위 밖이면 점을 끝에 붙이고(`clamped`) 글자는 쓰지 않는다(사장님 결정 ⑦ — 차이 줄이 숫자로 말한다).
 * `pos` = 0~100(%). `aria` = 보조기기용 문장(화면 글자 아님).
 */
export function rangeBar(apt: Apt): { pos: number; clamped: "low" | "high" | null; aria: string } | null {
  const scope = effectiveScope(apt);
  if ((scope !== "complex" && scope !== "dong_peer") || !hasRange(apt)) return null;
  const min = Number(apt.cmpMin),
    max = Number(apt.cmpMax),
    price = Number(apt.price);
  if (!(max > min) || !(price > 0)) return null;
  const raw = ((price - min) / (max - min)) * 100;
  const clamped = raw < 0 ? "low" : raw > 100 ? "high" : null;
  const pos = Math.min(100, Math.max(0, raw));
  return {
    pos,
    clamped,
    aria: `실거래 최저 ${fmtPrice(min)} ~ 최고 ${fmtPrice(max)}, 분양가 ${fmtPrice(price)}`,
  };
}

/**
 * 동네 사실 줄의 토막들 — T2·T3 이고 같은 동·같은 평수 거래가 1건 이상일 때만. 아니면 null.
 * 토막: 건수 · 가격 범위 · 준공 연도(+ 이 단지와의 연식 차이). 값이 빈 토막은 빼고 0 으로 적지 않는다.
 */
export function dongFactParts(apt: Apt): { count: string; price: string | null; year: string | null } | null {
  const scope = effectiveScope(apt);
  if (scope !== "dong_peer" && scope !== "none") return null;
  const f = apt.dongFact;
  if (!f || !(Number(f.n) > 0)) return null;
  const count = `같은 동·같은 평수 실거래 ${f.n}건`;
  const min = Number(f.min),
    max = Number(f.max);
  // 세션661(사장님 결정 ⑥): 같은 동 또래 상자에 범위 줄이 있으면 동네 가격 토막은 뺀다(건수·연식만) —
  //   또래 범위와 나이 제한 없는 동네 범위 두 개가 한 상자에 나란히 서면 어느 것이 비교 대상인지 흐려진다.
  const dropPrice = scope === "dong_peer" && hasRange(apt);
  const price =
    !dropPrice && min > 0 && max > 0
      ? min === max
        ? fmtPrice(min)
        : `최저 ${fmtPrice(min)} ~ 최고 ${fmtPrice(max)}`
      : null;
  let year: string | null = null;
  if (f.build_year_min != null && f.build_year_max != null) {
    const span =
      f.build_year_min === f.build_year_max ? `${f.build_year_min}년` : `${f.build_year_min}~${f.build_year_max}년`;
    // age_gap_years = 이 단지 연도 − 그 집들 건축년도 중앙값 → 양수면 그 집들이 오래됨, 음수면 더 새 집
    const g = f.age_gap_years == null ? 0 : Math.round(Number(f.age_gap_years));
    const gap = g > 0 ? ` (이 단지보다 약 ${g}년 오래됨)` : g < 0 ? ` (이 단지보다 약 ${-g}년 새 집)` : "";
    year = `${span}에 지은 집${gap}`;
  }
  return { count, price, year };
}

/**
 * 같은 단지 전세가율 값 (세션609 · R3 · 세션651 산식) — 같은 단지 같은 평수 전세 중앙값 ÷ 매매 중앙값.
 * 값이 없으면 null(줄 자체를 안 그린다 — 동·구 값으로 대신하지 않는다). 옛 `jeonseRate`(구 전체)는 읽지 않는다.
 */
export function complexJeonseText(apt: Apt): string | null {
  const r = apt.complexJeonseRate;
  if (r == null || !Number.isFinite(Number(r))) return null;
  const rate = `${Math.round(Number(r) * 10) / 10}%`;
  const jn = Number(apt.complexJeonseN),
    sn = Number(apt.complexSaleN);
  // 세션675 👤 「전세가율 설명 고치기」 — 옛 "(전세 5건 ÷ 매매 9건)"은 건수끼리 나눈 것처럼 읽혔다. 무엇을 나눴는지 + 건수는 따로.
  return jn > 0 && sn > 0 ? `${rate} · 전세 가운데값 ÷ 매매 가운데값 (전세 ${jn}건 · 매매 ${sn}건)` : rate;
}

export const PricePositionBox = memo(function PricePositionBox({
  priceCat,
  apt,
}: {
  /** `res.cats.price` — 비교 중앙값(fairPrice)·괴리율(deviation)·범위(fairPriceScope) */
  priceCat: PriceCatLike;
  apt: Apt;
}) {
  const head = scopeHeadText(apt);
  const rows = compareRows(apt, priceCat);
  const bar = rangeBar(apt);
  const fact = dongFactParts(apt);

  if (!head && rows.length === 0 && !fact) return null;

  const factTokens = fact ? [fact.count, fact.price, fact.year] : [];
  const factKeys = ["count", "price", "year"] as const;

  return (
    <div style={S.box}>
      {head && (
        <div data-testid="price-scope-head" style={S.title}>
          {head}
        </div>
      )}
      {rows.length > 0 && (
        <div data-testid="price-compare-table">
          {rows.map((r) => (
            <Fragment key={r.key}>
              <div
                data-row={r.key}
                data-testid={r.key === "jeonse" ? "complex-jeonse" : undefined}
                style={r.small ? S.rowSmall : S.row}
              >
                <span style={r.small ? undefined : S.rowLabel}>{r.label}</span>
                <span style={r.small ? undefined : S.rowValue}>{r.value}</span>
              </div>
              {r.sub && (
                <div data-row-sub={r.key} style={S.rowSub}>
                  {r.sub}
                </div>
              )}
              {r.key === "range" && bar && (
                <div
                  data-testid="price-range-bar"
                  data-clamped={bar.clamped ?? undefined}
                  role="img"
                  aria-label={bar.aria}
                  style={S.barTrack}
                >
                  <div style={S.barFill} />
                  <div data-part="price-dot" style={{ ...S.barDot, left: `${bar.pos}%` }} />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
      {fact && (
        <div data-testid="dong-fact-line" style={{ ...S.fact, marginTop: rows.length > 0 ? 10 : 0 }}>
          {factTokens.map((t, i) =>
            t == null ? null : (
              <span key={factKeys[i]} data-part={factKeys[i]}>
                {i > 0 && " · "}
                {t}
              </span>
            )
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div data-testid="price-source" style={S.source}>
          {priceSourceText(apt)}
        </div>
      )}
    </div>
  );
});
