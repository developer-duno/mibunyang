import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { fmtPrice } from "@/lib/format";
import {
  pickMonthlyRate,
  calcMonthlyPayment,
  groupBankRanges,
  displayBankName,
  fmtDisclosureMonth,
} from "@/lib/loanRates";
import { RangeBarRow } from "@/components/charts/RangeBarRow";
import type { FinlifeRate } from "@/hooks/useFinlifeRates";

/**
 * 금융 탭 본문의 은행권 금리 두 블록 (세션593 D2·D3) — 옛 "은행별 금리 비교" 접힘 안에 숨어 있던
 * 월 상환액 시뮬레이션과 은행 표를 본문으로 올렸다.
 *
 * 두 블록은 **같은 주담대 은행권 응답 하나**를 받는다(부모 `LoanAnalysis` 가 한 번 부른다) —
 * 우리 API 호출 수가 옛날(전세·주담대 은행권 2회)보다 늘지 않는다.
 * 상품 거름(아파트 담보 + 분할상환)은 `src/lib/loanRates.ts` 한 곳에서 같이 쓴다.
 */

/** 월 상환액 계산 기간 — 옛 시뮬레이션과 같은 30년 원리금균등 */
const LOAN_YEARS = 30;

/** 은행 이름 칸 폭 — "아이엠뱅크"·"중소기업은행"(12px 글자 6자)이 한 줄에 들어가는 폭 */
const BANK_LABEL_W = 72;

const boxStyle = {
  background: C.bg,
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 10,
  border: `1px solid ${C.border}`,
} as const;

/**
 * "한 달에 갚을 돈" — 대출액(`loan`, 막대의 대출액과 같은 값) × 아파트·분할상환 최저 금리 × 30년.
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
  const rate = useMemo(() => pickMonthlyRate(rates), [rates]);
  if (!(loan > 0) || rate == null) return null;
  const pay = Math.round(calcMonthlyPayment(loan, rate, LOAN_YEARS));
  if (!(pay > 0)) return null;
  const month = fmtDisclosureMonth(disclosureMonth);
  return (
    <div data-testid="monthly-payment" style={boxStyle}>
      <div style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>한 달에 갚을 돈</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.blue, marginTop: 2 }}>{fmtPrice(pay)} 원/월</div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
        {`대출 ${fmtPrice(loan)} · ${LOAN_YEARS}년 · 아파트·분할상환 최저 금리 ${rate}% 기준`}
        {month && ` · ${month}`}
      </div>
    </div>
  );
});

/**
 * 은행별 금리 범위 막대 — 아파트·분할상환 상품만 은행별로 묶어 최저~최고 한 줄씩, 최저 낮은 순 5줄.
 * 평균 선은 그리지 않는다(응답에 은행 평균이 없다 — 최저~최고 중간값을 평균으로 그리지 않는다).
 * 0줄이면 블록을 그리지 않는다.
 */
export const BankRateBars = memo(function BankRateBars({
  rates,
  disclosureMonth,
}: {
  rates: readonly FinlifeRate[];
  disclosureMonth: string | null;
}) {
  const ranges = useMemo(() => groupBankRanges(rates), [rates]);
  if (ranges.length === 0) return null;
  // 눈금 = 5줄 최저 내림 ~ 최고 올림(정수 %). 같은 묶음의 모든 줄이 같은 눈금을 받는다.
  const scaleMin = Math.floor(Math.min(...ranges.map((r) => r.min)));
  const ceilMax = Math.ceil(Math.max(...ranges.map((r) => r.max)));
  const scaleMax = ceilMax > scaleMin ? ceilMax : scaleMin + 1;
  const month = fmtDisclosureMonth(disclosureMonth);
  return (
    <div data-testid="bank-rate-bars" style={boxStyle}>
      <div style={{ fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 6 }}>은행별 금리</div>
      <div role="list" aria-label="은행별 주택담보대출 금리">
        {ranges.map((r) => {
          const name = displayBankName(r.bank);
          const minText = `${r.min.toFixed(2)}%`;
          const maxText = `${r.max.toFixed(2)}%`;
          return (
            <RangeBarRow
              key={r.bank}
              label={name}
              labelWidth={BANK_LABEL_W}
              bands={[
                { key: "rate", min: r.min, max: r.max, minText, maxText, color: C.blue, bandColor: C.blueBorder },
              ]}
              scaleMin={scaleMin}
              scaleMax={scaleMax}
              ariaLabel={`${name} ${minText} ~ ${maxText}`}
              testId="bank-rate-row"
            />
          );
        })}
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
        {"아파트·분할상환 상품"}
        {month && ` · ${month}`}
        {" · 출처: 금융감독원 금융상품통합비교공시"}
      </div>
    </div>
  );
});
