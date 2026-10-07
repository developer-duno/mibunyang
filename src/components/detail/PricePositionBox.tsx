import { memo } from "react";
import { C, F } from "@/theme";
import {
  DEV_FULL_MIN_PCT,
  DEV_ZERO_AT_PCT,
  DEV_NEUTRAL_BAND_PCT,
  TRADE_SCOPE_PEER_YEARS,
  TRADE_SCOPE_PER_M2_TOL_M2,
} from "@/constants/scoringTiers";
import { fmtPrice } from "@/lib/format";
import { PositionGauge, positionPct } from "@/components/charts/PositionGauge";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 맨 위 상자 — "이 분양가를 **무엇과** 견줬고, 그 기준 대비 어디쯤인가" (세션589 · 세션609 라).
 *
 * ① 머리 줄 (세션609 · 설계서 §5-4) — 적정가를 어느 범위의 거래로 잡았는지(`cmpScope`)를 그대로 말한다.
 *    같은 단지 실거래(T1 매매) · 같은 단지 분양권 거래(T1 분양권) · 같은 동 비슷한 연식·같은 평수(T2) ·
 *    비교할 거래 없음(T3). 점수(`scorePrice.ts`)가 쓴 범위와 **같은 칸**에서 읽으므로 문구와 점수가 어긋나지 않는다.
 *    ⚠️ `cmpScope` 가 `undefined`(옛 정적 JSON·마이그 전)·`null`(trade_stats 행 없음)이면 머리 줄을 안 그린다 —
 *       "거래가 없다"고 말할 근거가 없는 자리다(우리 수집 상태를 손님 문장으로 만들지 않는다).
 *    ⚠️ "Y% 저렴/비쌈" 은 점수 캐시의 괴리율(`priceCat.deviation`)과 `DEV_NEUTRAL_BAND_PCT` 로 — 카드 칩
 *       (`constants/cardChips.ts`)과 같은 경계. 캐시의 범위(`fairPriceScope`)가 지금 칸과 다르면(재계산 전 옛 캐시)
 *       분양가 비교 토막과 아래 눈금을 비운다 — 서로 다른 기준의 숫자를 한 상자에 나란히 두지 않는다.
 *
 * ② 적정가 대비 위치 (세션 430 · 세션531) — `scorePrice.ts` 가 낸 **적정가와의 괴리**.
 *    ⚠️ 양 끝 = 점수가 더는 안 움직이는 지점(만점 경계 / 0점 도달 지점). 상수를 바꾸면 눈금이 따라온다.
 *    ⚠️ `fairPrice > 0` 게이트 — 데이터 부재(fairPrice=0 + deviation="0.0")면 줄을 아예 안 그린다(SC1).
 *    색·문구는 ±DEV_NEUTRAL_BAND_PCT 중립대 3분기(SC0).
 *
 * ③ 동네 사실 줄 (세션609 · 설계서 §5-4 · R5) — 같은 동·같은 평수 매매를 **나이 제한 없이** 사실대로:
 *    건수 · 최저~최고 · 그 집들의 준공 연도 범위(+ 이 단지보다 몇 년 오래됐는지). T2·T3 에서만 보인다(T1 은
 *    같은 단지 거래가 이미 기준이라 접어 둔다). ⚠️ 준공 연도 토막은 가격 토막과 **같은 줄·같은 글자 크기** —
 *    "비싸 보이는 이유(오래된 집과 견줬다)"가 작은 글씨로 숨지 않게(§8 픽셀 조건).
 *
 * ④ 같은 단지 전세가율 한 줄 (세션609 · R3) — `complexJeonseRate` 가 있을 때만 "이 단지 전세 N건 ÷ 매매 M건".
 *    없으면 줄 자체를 안 그린다(구·동 값으로 대신하지 않는다).
 *
 * 옛 PSR 줄(구 실거래가 대비 분양가)은 지웠다 — 가격 점수의 PSR 축이 세션607 다) 에서 없어졌다(R4).
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
  subTitle: { fontSize: F.sm, fontWeight: 600, color: C.sub, marginBottom: 4 },
  fact: { fontSize: F.sm, color: C.sub, lineHeight: 1.6 },
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

/**
 * 지금 칸이 말하는 범위 — `scorePrice.ts` 와 같은 판정(범위가 complex·dong_peer 여도 적정가가 0 이하면 비교 없음).
 * `undefined`(칸 없음)·`null`(행 없음)은 `null` — 머리 줄을 그리지 않는다.
 */
export function effectiveScope(apt: Apt): Scope | null {
  const s = apt.cmpScope;
  if (s == null) return null;
  if ((s === "complex" || s === "dong_peer") && Number(apt.cmpFairPrice) > 0) return s;
  return "none";
}

/** 머리 줄 "… 기준" 앞부분 — 건수·기간은 칸에서, 연식 폭·면적 폭은 상수에서 읽는다(문구에 숫자를 손으로 적지 않는다). */
function basisText(apt: Apt, scope: "complex" | "dong_peer"): string {
  const n = Number(apt.cmpN ?? 0) || 0;
  const months = Number(apt.cmpMonths ?? 0);
  const period = months > 0 ? ` (최근 ${months}개월)` : "";
  const base =
    scope === "dong_peer"
      ? `같은 동 비슷한 연식(±${TRADE_SCOPE_PEER_YEARS}년)·같은 평수 실거래 ${n}건 기준`
      : apt.cmpSrc === "presale"
        ? `이 단지 분양권 거래 ${n}건${period} 기준`
        : `이 단지 실거래 ${n}건${period} 기준`;
  // ㎡당 환산이면 그 사실을 붙인다 — 같은 평수 거래가 3건 미만이라 가까운 면적 거래를 ㎡당으로 바꿔 썼다.
  const perM2 = apt.cmpAreaMode === "per_m2" ? ` (면적 ${TRADE_SCOPE_PER_M2_TOL_M2}㎡ 이내 ㎡당 환산)` : "";
  return `${base}${perM2}`;
}

/** 캐시의 괴리율이 지금 칸과 같은 범위에서 나온 값인가 — 아니면 비교 숫자를 쓰지 않는다. */
function devOf(priceCat: PriceCatLike, scope: Scope | null): number | null {
  if (!(Number(priceCat?.fairPrice) > 0) || priceCat?.deviation == null) return null;
  if (scope != null && priceCat.fairPriceScope !== scope) return null;
  const dev = Number(priceCat.deviation);
  return Number.isFinite(dev) ? dev : null;
}

/** 시세 탭 머리 줄 — 범위(`cmpScope`)와 일치하는 문장. 칸이 없으면 null. */
export function scopeHeadText(apt: Apt, priceCat: PriceCatLike): string | null {
  const scope = effectiveScope(apt);
  if (scope == null) return null;
  if (scope === "none") return "비교할 실거래가 아직 없어요";
  const dev = devOf(priceCat, scope);
  const verdict =
    dev == null
      ? ""
      : dev > DEV_NEUTRAL_BAND_PCT
        ? `, 분양가는 ${Math.round(dev)}% 저렴`
        : dev < -DEV_NEUTRAL_BAND_PCT
          ? `, 분양가는 ${Math.abs(Math.round(dev))}% 비쌈`
          : ", 분양가는 적정가 수준";
  return `${basisText(apt, scope)} — 적정가 ${fmtPrice(Number(apt.cmpFairPrice))}${verdict}`;
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
  const price =
    min > 0 && max > 0 ? (min === max ? fmtPrice(min) : `최저 ${fmtPrice(min)} ~ 최고 ${fmtPrice(max)}`) : null;
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
 * 같은 단지 전세가율 한 줄 (세션609 · R3) — 같은 단지 같은 평수 전세 중앙값 ÷ 매매 중앙값.
 * 값이 없으면 null(칸 자체를 안 그린다 — 동·구 값으로 대신하지 않는다). 옛 `jeonseRate`(구 전체)는 읽지 않는다.
 */
export function complexJeonseText(apt: Apt): string | null {
  const r = apt.complexJeonseRate;
  if (r == null || !Number.isFinite(Number(r))) return null;
  const rate = `전세가율 ${Math.round(Number(r) * 10) / 10}%`;
  const jn = Number(apt.complexJeonseN),
    sn = Number(apt.complexSaleN);
  return jn > 0 && sn > 0 ? `${rate} · 이 단지 전세 ${jn}건 ÷ 매매 ${sn}건` : rate;
}

export const PricePositionBox = memo(function PricePositionBox({
  priceCat,
  apt,
}: {
  /** `res.cats.price` — 적정가(fairPrice)·괴리율(deviation)·범위(fairPriceScope) */
  priceCat: PriceCatLike;
  apt: Apt;
}) {
  const scope = effectiveScope(apt);
  const head = scopeHeadText(apt, priceCat);
  const dev = devOf(priceCat, scope);
  const hasDev = dev != null;
  const fact = dongFactParts(apt);
  const jeonse = complexJeonseText(apt);

  if (!head && !hasDev && !fact && !jeonse) return null;

  // ⚠️ 위치(pct) 계산과 색·문구 판정은 따로다 — 위치는 점수 경계, 색·문구는 중립대.
  const d = dev ?? 0;
  const devTone = d > DEV_NEUTRAL_BAND_PCT ? "cheap" : d < -DEV_NEUTRAL_BAND_PCT ? "expensive" : "fair";
  const devColor = devTone === "cheap" ? C.green : devTone === "expensive" ? C.red : C.muted;
  const factTokens = fact ? [fact.count, fact.price, fact.year] : [];
  const factKeys = ["count", "price", "year"] as const;

  return (
    <div style={S.box}>
      {head && (
        <div data-testid="price-scope-head" style={S.title}>
          {head}
        </div>
      )}
      {/* 눈금 제목 — 머리 줄이 있으면(새 칸) 그 아래 작은 제목, 없으면(옛 JSON) 상자 제목 그대로 */}
      {hasDev && <div style={head ? S.subTitle : S.title}>적정가 대비 위치</div>}
      {hasDev && (
        <PositionGauge
          pct={positionPct(d, 0, DEV_FULL_MIN_PCT, -DEV_ZERO_AT_PCT)}
          color={devColor}
          leftLabel={`${DEV_ZERO_AT_PCT}% 비쌈`}
          centerLabel={
            devTone === "cheap"
              ? `+${Math.round(d)}% 저렴`
              : devTone === "expensive"
                ? `${Math.abs(Math.round(d))}% 비쌈`
                : "적정가와 비슷"
          }
          rightLabel={`${DEV_FULL_MIN_PCT}% 저렴`}
        />
      )}
      {fact && (
        <div data-testid="dong-fact-line" style={{ ...S.fact, marginTop: hasDev ? 10 : 0 }}>
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
      {jeonse && (
        <div data-testid="complex-jeonse" style={{ ...S.fact, marginTop: head || hasDev || fact ? 8 : 0 }}>
          {jeonse}
        </div>
      )}
    </div>
  );
});
