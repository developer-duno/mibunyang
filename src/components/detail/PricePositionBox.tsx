import { memo } from "react";
import { C, F } from "@/theme";
import {
  DEV_FULL_MIN_PCT,
  DEV_ZERO_AT_PCT,
  DEV_NEUTRAL_BAND_PCT,
  PSR_SCORE_TIERS,
  PSR_FULL_AT,
  PSR_ZERO_AT,
} from "@/constants/scoringTiers";
import { PositionGauge, positionPct } from "@/components/charts/PositionGauge";
import { HelpHint } from "@/components/HelpHint";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 맨 위 상자 — "이 분양가가 기준 대비 어디쯤인가" 두 줄.
 *
 * ① 적정가 대비 위치 (세션 430 · 세션531) — `scorePrice.ts` 가 낸 **적정가와의 괴리**.
 *    ⚠️ 옛 이름 "주변 시세 대비"는 거짓이었다 — 주변 단지 비교가 아니다(세션 487).
 *    ⚠️ 양 끝 = 점수가 더는 안 움직이는 지점(만점 경계 / 0점 도달 지점). 손으로 ±30 을 박아 뒀던
 *       시절엔 점수가 이미 만점·최하인 지점과 눈금이 어긋났다(세션531). 상수를 바꾸면 눈금이 따라온다.
 *    ⚠️ `fairPrice > 0` 게이트 — 데이터 부재(fairPrice=0 + deviation="0.0")면 줄을 아예 안 그린다.
 *       그리면 부재가 "적정가와 비슷"(한가운데 마커)으로 둔갑한다(SC1).
 *    색·문구는 부호 단독이 아니라 ±DEV_NEUTRAL_BAND_PCT 중립대 3분기(SC0) — 추정 오차보다 작은
 *    차이로 "저렴/비쌈"을 단정하지 않는다(catVerdict.ts·cardChips.ts 와 같은 상수).
 *
 * ② 구 실거래가 대비 분양가 (세션589) — PSR. 옛 접힘 "이 동네 거래 시세" 안의 `0.38` 을 같은 눈금
 *    한 줄로 올렸다(표기는 % — 점수 탭과 통일). 가운데 = 100%(구 실거래가와 같음), 양 끝 = PSR
 *    점수가 만점·0점이 되는 지점, 색 = 저평가 경계 미만 초록 / 그 위 100% 까지 중립 / 100% 초과 빨강 —
 *    전부 `PSR_SCORE_TIERS` 에서 읽는다.
 *    ⚠️ **점수가 아니라 값(`apt.psr`)** 을 그린다 — 비로그인에게도 공개다(적정가 괴리와 같다).
 *       점수(`catsCache` 서브 점수)를 여기서 읽으면 `blind` 분기가 필요해진다.
 *    ⚠️ 값이 없으면(null·숫자 아님·0 이하) 줄을 안 그린다. `scoring/engine.ts` 의 `sanitize` 는
 *       psr 을 다른 값으로 누르지 않는다(`num(apt.psr, null)`) — 없는 값을 가운데 점으로 그리지 않는다.
 */

const PSR_LABEL = "구 실거래가 대비 분양가(㎡당)";
const PSR_HINT =
  "이 단지 분양가를 ㎡당으로 바꿔, 이 구에서 최근 12개월 동안 실제로 거래된 아파트의 ㎡당 가격 한가운데 값으로 나눈 비율이에요. " +
  "100%면 구 실거래가와 같고, 낮을수록 분양가가 싸다는 뜻이에요. 실거래가 거의 없는 구는 매물로 나온 값으로 대신 셌어요.";

const S = {
  box: {
    background: C.bg,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  title: { fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 },
} as const;

/** 비율(0.38) → 화면 글자("38") — `scorePrice.ts` 의 info 와 같은 식 */
const pctText = (ratio: number) => (ratio * 100).toFixed(0);

type PriceCatLike = { fairPrice?: number | string | null; deviation?: string | number | null } | null | undefined;

export const PricePositionBox = memo(function PricePositionBox({
  priceCat,
  apt,
}: {
  /** `res.cats.price` — 적정가(fairPrice)·괴리율(deviation) */
  priceCat: PriceCatLike;
  apt: Apt;
}) {
  const dev = Number(priceCat?.fairPrice) > 0 && priceCat?.deviation != null ? Number(priceCat.deviation) : NaN;
  const hasDev = Number.isFinite(dev);

  const psrRaw = apt.psr;
  const psr = typeof psrRaw === "number" && Number.isFinite(psrRaw) && psrRaw > 0 ? psrRaw : null;

  if (!hasDev && psr == null) return null;

  // ⚠️ 위치(pct) 계산과 색·문구 판정은 따로다 — 위치는 점수 경계, 색·문구는 중립대.
  const devTone = dev > DEV_NEUTRAL_BAND_PCT ? "cheap" : dev < -DEV_NEUTRAL_BAND_PCT ? "expensive" : "fair";
  const devColor = devTone === "cheap" ? C.green : devTone === "expensive" ? C.red : C.muted;

  const psrColor =
    psr == null
      ? C.muted
      : psr < PSR_SCORE_TIERS.UNDERVALUED_BELOW
        ? C.green
        : psr <= PSR_SCORE_TIERS.PAR_MAX
          ? C.muted
          : C.red;

  return (
    <div style={S.box}>
      {hasDev && (
        <>
          <div style={S.title}>적정가 대비 위치</div>
          <PositionGauge
            pct={positionPct(dev, 0, DEV_FULL_MIN_PCT, -DEV_ZERO_AT_PCT)}
            color={devColor}
            leftLabel={`${DEV_ZERO_AT_PCT}% 비쌈`}
            centerLabel={
              devTone === "cheap"
                ? `+${Math.round(dev)}% 저렴`
                : devTone === "expensive"
                  ? `${Math.abs(Math.round(dev))}% 비쌈`
                  : "적정가와 비슷"
            }
            rightLabel={`${DEV_FULL_MIN_PCT}% 저렴`}
          />
        </>
      )}
      {psr != null && (
        <div data-testid="psr-gauge" style={hasDev ? { marginTop: 12 } : undefined}>
          <div style={{ ...S.title, display: "flex", alignItems: "center" }}>
            {PSR_LABEL}
            <HelpHint text={PSR_HINT} label={PSR_LABEL} />
          </div>
          <PositionGauge
            pct={positionPct(psr, PSR_SCORE_TIERS.PAR_MAX, PSR_FULL_AT, PSR_ZERO_AT)}
            color={psrColor}
            leftLabel={`${pctText(PSR_ZERO_AT)}% 이상`}
            centerLabel={`구 실거래가의 ${pctText(psr)}%`}
            rightLabel={`${pctText(PSR_FULL_AT)}% 이하`}
          />
        </div>
      )}
    </div>
  );
});
