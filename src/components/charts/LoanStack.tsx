import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";
import { zoneOf, calcLTV, isMetroRegion, ZONE_TYPE, METRO_LOAN_CAP } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";

/**
 * 이 집을 사려면 돈이 어떻게 나뉘나 — 대출 가능액 / 내 돈, 두 조각.
 *
 * ## 왜 조각을 둘로만 나누나
 *
 * 분양가 = 대출 + 자기자금. 이 둘은 **밑변이 같아서** 나란히 쌓을 수 있다.
 * 취득세·중도금 같은 걸 조각으로 더하면 밑변이 달라져(분양가를 넘어) 그림이 거짓말을 한다.
 *
 * ## 실측 (1,581단지, 2026-08-03)
 *
 * `price` 94.8% · `dsr40pass` 94.8%(참 16.1% / 거짓 78.7%) · `isRegulated` 100%.
 * 분양가만 있으면 그릴 수 있어 거의 모든 단지에서 나온다.
 *
 * DSR 는 조각이 아니라 **한 줄 안내**로 붙인다. 소득을 모르면 계산할 수 없는 값이라
 * 막대에 섞으면 정확한 금액처럼 보인다.
 *
 * ## 금액은 만원까지 (세션593 D1)
 *
 * 옛 금융 탭은 이 막대 아래에 숫자 3칸(분양가·LTV 대출한도·필요 자기자본)을 따로 두었다. 막대가
 * "2.1억"처럼 반올림한 금액을, 3칸이 "2억 1,208만"을 보여 같은 돈이 두 번 다른 꼴로 나왔다.
 * 3칸을 지우고 막대가 만원까지(`fmtPrice`) 적는다. 분양가는 막대 아래 글에 적는다.
 */

/**
 * 막대 조각 안에 금액 글자를 넣는 최소 비중(%) — "대출 2억 1,208만"(10px 글자 약 85px)이
 * 휴대폰 폭(본문 약 330px)의 조각에 들어가는 자리. 더 좁으면 조각 안은 비우고 아래 줄 금액만 남긴다.
 */
const INNER_LABEL_MIN_PCT = 30;

/** 막대 아래 글의 DSR 문장 — 화면 글자와 화면 읽기 설명(aria)이 같은 글을 쓴다(세션675 검사 F11) */
export const DSR_PASS_TEXT = "소득 대비 상환 부담(DSR) 기준도 통과할 만해요.";
export const DSR_FAIL_TEXT =
  "다만 소득 대비 상환 부담(DSR) 기준에 걸릴 수 있어요. 연소득을 넣으면 아래 카드에서 볼 수 있어요.";
/**
 * 수도권 규제지역(투기과열지구) 꼬리 — 잔금대출은 분양가가 아니라 입주 때 감정가·시세로 잰다(은행업감독업무시행세칙
 * 별표 18 「5. 담보가치 산정」 다목 · 잔금 카드 `REGULATED_BALANCE_BASIS` 와 같은 조건 · 세션675 사장님 결정 1)
 */
export const REGULATED_BALANCE_TAIL = "잔금 때는 감정가·시세로 다시 재요.";

export const LoanStack = memo(function LoanStack({
  price,
  region,
  gu,
  isRegulated,
  dsr40pass,
  basisLabel,
}: {
  /** 계산에 쓸 분양가 — 금융 탭에서 손님이 고른 평수 값(세션675 결정 나 · 단추가 없으면 대표 분양가) */
  price?: number | null;
  region?: string | null;
  gu?: string | null;
  /** DB 규제 표시 — 참/거짓이면 이름 조회보다 먼저 본다(`zoneOf`). 화성시 동탄구는 이름으로 못 가른다. */
  isRegulated?: boolean | null;
  dsr40pass?: boolean | null;
  /** 제목 옆 배지 — "59B 기준"·"대표 분양가 기준". 없으면 배지를 안 그린다 */
  basisLabel?: string | null;
}) {
  const calc = useMemo(() => {
    if (price == null || !Number.isFinite(price) || price <= 0) return null;
    const zone = zoneOf({ isRegulated, region, gu });
    const loan = calcLTV(price, zone, region);
    // 수도권 6억 한도 때문에 깎였나 — 시도를 빼고 잰 값보다 작으면 그 한도가 걸린 것이다.
    // 걸렸는데 "비규제지역 기준 최대 40%" 라고만 쓰면 비규제 규칙이 40% 인 것처럼 읽힌다.
    const metroCapped = loan < calcLTV(price, zone, null);
    const own = Math.max(0, price - loan);
    return { zone, loan, own, metroCapped, loanPct: Math.round((loan / price) * 100) };
  }, [price, region, gu, isRegulated]);

  // 분양가가 없으면 막대를 통째로 그리지 않는다 — 빈 상자·"못 모았어요" 문구 없음(결정 마 원칙 · 세션675 검사 F9)
  if (!calc) return null;
  const regulatedMetro = calc.zone !== "normal" && isMetroRegion(region);

  const aria =
    `분양가 ${fmtPrice(price as number)} 중 대출 가능액 ${fmtPrice(calc.loan)}, 직접 준비할 돈 ${fmtPrice(calc.own)}. ` +
    `대출 비중 ${calc.loanPct} 퍼센트.` +
    (dsr40pass === true ? ` ${DSR_PASS_TEXT}` : "") +
    (dsr40pass === false ? ` ${DSR_FAIL_TEXT}` : "") +
    (regulatedMetro ? ` ${REGULATED_BALANCE_TAIL}` : "");

  return (
    <ChartFrame
      title="집값을 어떻게 마련하나"
      hint={
        "분양가를 '은행에서 빌릴 수 있는 돈'과 '내가 직접 준비할 돈' 둘로 나눈 거예요. " +
        "빌릴 수 있는 한도(LTV)는 지역 규제에 따라 달라져요. 실제 한도는 소득·신용·기존 대출에 " +
        "따라 더 낮아질 수 있어서, 여기 나온 금액은 최대치로 봐 주세요."
      }
      ariaLabel={aria}
      height={106}
      titleAside={
        basisLabel ? (
          <span
            data-testid="loan-stack-basis"
            style={{
              marginLeft: 6,
              fontSize: F.xs,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              background: C.blueLight,
              color: C.blue,
            }}
          >
            {basisLabel}
          </span>
        ) : null
      }
    >
      <div>
        <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden" }} aria-hidden>
          <div
            style={{
              width: `${calc.loanPct}%`,
              background: C.blue,
              color: C.white,
              fontSize: F.micro,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {calc.loanPct >= INNER_LABEL_MIN_PCT ? `대출 ${fmtPrice(calc.loan)}` : ""}
          </div>
          <div
            style={{
              flex: 1,
              // 흰 글자가 올라가므로 진한 주황(흰 글자 대비 5.02:1 · 세션675 「주황 글자 진하게」)
              background: C.amberText,
              color: C.white,
              fontSize: F.micro,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {100 - calc.loanPct >= INNER_LABEL_MIN_PCT ? `내 돈 ${fmtPrice(calc.own)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: F.xs }}>
          <span style={{ color: C.blue, fontWeight: 700 }}>빌릴 수 있는 돈 {fmtPrice(calc.loan)}</span>
          <span style={{ color: C.amberText, fontWeight: 700 }}>직접 준비할 돈 {fmtPrice(calc.own)}</span>
        </div>
        <div style={{ marginTop: 6, fontSize: F.micro, color: C.muted, lineHeight: 1.5 }}>
          {`분양가 ${fmtPrice(price as number)} · `}
          {calc.metroCapped
            ? `${ZONE_TYPE[calc.zone]}이지만 수도권 주택구입 대출은 최대 ${fmtPrice(METRO_LOAN_CAP)}이라 분양가의 ${calc.loanPct}%까지 빌릴 수 있어요.`
            : `${ZONE_TYPE[calc.zone]} 기준 최대 ${calc.loanPct}%까지 빌릴 수 있어요.`}
          {dsr40pass === true && <span style={{ color: C.green }}>{` ${DSR_PASS_TEXT}`}</span>}
          {dsr40pass === false && <span style={{ color: C.amberText }}>{` ${DSR_FAIL_TEXT}`}</span>}
          {regulatedMetro && <span data-testid="loan-stack-regulated">{` ${REGULATED_BALANCE_TAIL}`}</span>}
        </div>
      </div>
    </ChartFrame>
  );
});
