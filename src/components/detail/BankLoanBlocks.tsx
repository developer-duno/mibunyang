import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { fmtPrice } from "@/lib/format";
import { calcMonthlyPayment, summarizeRateRange, fmtDisclosureMonth } from "@/lib/loanRates";
import { RangeBarRow } from "@/components/charts/RangeBarRow";
import type { FinlifeRate } from "@/hooks/useFinlifeRates";

/**
 * 금융 탭 본문의 은행권 금리 두 블록 (세션593 D2·D3) — 옛 "은행별 금리 비교" 접힘 안에 숨어 있던
 * 월 상환액 시뮬레이션과 은행 금리를 본문으로 올렸다.
 *
 * ⚠️ 금융 탭에는 금융회사 이름·상품 이름·금리 순위를 쓰지 않는다(세션665 사장님 결정) — 미등록 상태에서
 * "금융사 이름 + 금리"·순위 목록은 금소법상 중개·광고로 볼 위험이 있다. 은행 금리는 "N개 은행 최저 ~ 최고"
 * 범위 한 줄(`RateRangeSummary`)로만 보여 주고, 회사별 금리는 금감원 비교공시로 넘긴다. 2금융 탭도 같은 부품을 쓴다.
 *
 * 두 블록은 **같은 주담대 은행권 응답 하나**를 받는다(부모 `LoanAnalysis` 가 한 번 부른다) —
 * 우리 API 호출 수가 옛날(전세·주담대 은행권 2회)보다 늘지 않는다.
 * 상품 거름(아파트 담보 + 분할상환)은 `src/lib/loanRates.ts` 한 곳에서 같이 쓴다.
 */

/** 월 상환액 계산 기간 — 옛 시뮬레이션과 같은 30년 원리금균등 */
const LOAN_YEARS = 30;

/** 범위 줄 이름 칸 폭 — "22개 저축은행"·"13개 여신전문사"(12px 글자)가 한 줄에 들어가는 폭 */
const RANGE_LABEL_W = 96;

/** 회사별 금리를 보는 곳 — 특정 금융사가 아니라 금감원 비교공시 */
const FINLIFE_URL = "https://finlife.fss.or.kr";

const boxStyle = {
  background: C.bg,
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 10,
  border: `1px solid ${C.border}`,
} as const;

/**
 * "한 달에 갚을 돈" — 대출액(`loan`, 막대의 대출액과 같은 값) × 아파트·분할상환 은행 금리 × 30년.
 * 금리는 가장 낮은 값과 가장 높은 값 두 개(세션675 「한 달 상환에 금리 2개」) — 아래 은행 범위 줄과 같은 거름·같은
 * 최저·최고(`summarizeRateRange`)라 두 블록의 숫자가 어긋나지 않는다. 최저 = 잔금 카드 월 상환 금리(`pickMonthlyRate`)와 같다.
 * 그런 상품이 없거나 응답이 없으면(실패·로딩 중) 그리지 않는다.
 */
export const MonthlyPaymentBlock = memo(function MonthlyPaymentBlock({
  loan,
  rates,
  disclosureMonth,
}: {
  /** 대출액(만원) */
  loan: number;
  rates: readonly FinlifeRate[];
  disclosureMonth: string | null;
}) {
  const range = useMemo(() => summarizeRateRange(rates), [rates]);
  if (!(loan > 0) || range == null) return null;
  const payLow = Math.round(calcMonthlyPayment(loan, range.min, LOAN_YEARS));
  const payHigh = Math.round(calcMonthlyPayment(loan, range.max, LOAN_YEARS));
  if (!(payLow > 0)) return null;
  const one = payHigh <= payLow;
  const month = fmtDisclosureMonth(disclosureMonth);
  // 소수 둘째 자리 — 아래 은행 범위 줄("4.20%")과 같은 자릿수(세션593 후속 F4)
  const minText = `${range.min.toFixed(2)}%`;
  const maxText = `${range.max.toFixed(2)}%`;
  return (
    <div data-testid="monthly-payment" style={boxStyle}>
      <div style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>한 달에 갚을 돈</div>
      <div data-testid="monthly-payment-amount" style={{ fontSize: 22, fontWeight: 800, color: C.blue, marginTop: 2 }}>
        {one ? `${fmtPrice(payLow)} 원/월` : `${fmtPrice(payLow)} ~ ${fmtPrice(payHigh)} 원/월`}
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
        {`대출 ${fmtPrice(loan)} · ${LOAN_YEARS}년 · 아파트·분할상환 은행 금리 ${one ? minText : `${minText} ~ ${maxText}`} 기준`}
        {month && ` · ${month}`}
      </div>
    </div>
  );
});

/**
 * 금리 범위 한 덩어리 — 큰 글자 "최저% ~ 최고%" · 범위 막대 한 줄("N개 은행") · 작은 글자(기준·공시월·출처) · 금감원 비교공시 링크.
 * 은행 블록과 2금융 탭(`LoanRatesSection`)이 이 부품 하나를 같이 쓴다(세션665).
 *
 * ⚠️ 회사 이름·상품 이름은 어디에도 그리지 않는다 — 글자·aria-label·title 전부(이름 0 가드 시험이 본다).
 * 쓸 상품(`isUsableMortgageRate`)이 없으면 null — 빈 자리 문구는 부르는 쪽이 정한다.
 */
export const RateRangeSummary = memo(function RateRangeSummary({
  rates,
  unit,
  disclosureMonth,
  linkText,
  rowTestId,
}: {
  rates: readonly FinlifeRate[];
  /** 회사 수 뒤 낱말 — "은행"·"저축은행"·"여신전문사"·"보험사" */
  unit: string;
  disclosureMonth: string | null;
  /** 금감원 비교공시 링크 글 */
  linkText: string;
  rowTestId?: string;
}) {
  const range = useMemo(() => summarizeRateRange(rates), [rates]);
  if (range == null) return null;
  // 눈금 = 최저 내림 ~ 최고 올림(정수 %). 같으면 +1 — 띠가 눈금 밖으로 나가지 않게.
  const scaleMin = Math.floor(range.min);
  const ceilMax = Math.ceil(range.max);
  const scaleMax = ceilMax > scaleMin ? ceilMax : scaleMin + 1;
  const minText = `${range.min.toFixed(2)}%`;
  const maxText = `${range.max.toFixed(2)}%`;
  const label = `${range.companyCount}개 ${unit}`;
  const month = fmtDisclosureMonth(disclosureMonth);
  return (
    <>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.blue }}>{`${minText} ~ ${maxText}`}</div>
      <div role="list" aria-label={`${unit} 주택담보대출 금리 범위`} style={{ marginTop: 4 }}>
        <RangeBarRow
          label={label}
          labelWidth={RANGE_LABEL_W}
          bands={[
            // 띠 색 = 진한 파랑 — 옛 blueBorder(#C3D6FD)는 트랙(slate100) 대비 1.34:1 로 약했다. C.blue 는 4.72:1(그림 3:1 이상 · 세션675)
            { key: "rate", min: range.min, max: range.max, minText, maxText, color: C.blue, bandColor: C.blue },
          ]}
          scaleMin={scaleMin}
          scaleMax={scaleMax}
          ariaLabel={`${label} ${minText} ~ ${maxText}`}
          testId={rowTestId}
        />
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        {`공시한 ${label}의 가장 낮은 금리 ~ 가장 높은 금리 · 아파트·분할상환 상품`}
        {month && ` · ${month}`}
        {" · 출처: 금융감독원 금융상품통합비교공시"}
      </div>
      <a
        href={FINLIFE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          marginTop: 6,
          fontSize: F.xs,
          fontWeight: 600,
          color: C.blue,
          textDecoration: "none",
        }}
      >
        {linkText}
      </a>
    </>
  );
});

/**
 * 은행 주택담보대출 금리 — 아파트·분할상환 상품 전체의 최저 ~ 최고 범위 한 줄과 공시한 은행 수(세션665).
 * 은행 이름·은행별 줄·순위는 없다(옛 "최저 낮은 순 5줄"은 세션665 에 뺐다). 평균 선도 그리지 않는다(응답에 평균이 없다).
 * 쓸 상품이 0건이면 블록을 그리지 않는다.
 */
export const BankRateBars = memo(function BankRateBars({
  rates,
  disclosureMonth,
}: {
  rates: readonly FinlifeRate[];
  disclosureMonth: string | null;
}) {
  const hasRange = useMemo(() => summarizeRateRange(rates) != null, [rates]);
  if (!hasRange) return null;
  return (
    <div data-testid="bank-rate-bars" style={boxStyle}>
      <div style={{ fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 4 }}>은행 주택담보대출 금리</div>
      <RateRangeSummary
        rates={rates}
        unit="은행"
        disclosureMonth={disclosureMonth}
        linkText="은행별 금리는 금감원 비교공시에서 보기 →"
        rowTestId="bank-rate-row"
      />
    </div>
  );
});
