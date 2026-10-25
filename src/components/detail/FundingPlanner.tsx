import { memo, useMemo, useRef, useState } from "react";
import { C, F } from "@/theme";
import { zoneOf } from "@/constants/regulations";
import {
  DEFAULT_PAYMENT_SPLIT,
  DSR_LIMIT_BANK,
  LOAN_RULES_BASIS,
  LOAN_TERM_YEARS,
  STRESS_RATE_LOCAL,
  STRESS_RATE_LOCAL_UNTIL,
  STRESS_RATE_METRO,
  earliestIsoDate,
  isNonHousing,
  isPreSubscription,
  kstYearMonth,
  latestIsoDate,
  moveInStarted,
} from "@/constants/loanRules";
import { fmtPrice } from "@/lib/format";
import { pickMonthlyRate } from "@/lib/loanRates";
import { closestChipIndex, noticeUnitChips, planFunding, splitTotal, type PaymentSplit } from "@/lib/fundingPlan";
import { usePresaleDetail } from "@/hooks/usePresaleDetail";
import { trackEvent } from "@/lib/analytics";
import type { FinlifeRate } from "@/hooks/useFinlifeRates";
import type { Apt } from "@/types/scoring";

/**
 * 「내 조건으로 잔금 계획」 — 금융 탭 대출 막대(LoanStack) 바로 아래 카드(세션659, 사장님 결정 10~17).
 *
 * 손님이 평형·연소득·가진 돈을 넣으면 잔금 때 주담대(지역 한도와 소득 한도 중 작은 값)와 더 필요한 돈을 보여 준다.
 * - 입력값은 이 화면 상태에만 있다 — 서버 전송 0 · 브라우저 저장 0 · 계측 이벤트에도 수치를 싣지 않는다.
 * - 금리는 부모 `LoanAnalysis` 가 이미 받은 은행권 응답을 그대로 받는다(새 호출 0).
 * - 큰 숫자(지역 한도·주담대·월 상환·더 필요한 돈)는 늘 지금 규정 — 위 막대와 같은 `calcLTV`(결정 18).
 *   경과규정(규제지역 지정 전 공고 → 종전 LTV)은 "될 수 있어요 — 그 경우 최대 N" 사실 한 줄로만 알린다(결정 16·18).
 *
 * 금융사로 넘기는 자리는 공시 사이트 두 곳뿐이다. 아래 은행별 금리 표(은행 이름 5개, `BankRateBars`)는 금감원 공시의
 * 전 은행을 금리순으로 나열하고 대가가 없어 정보 제공으로 본다 — 이 카드는 금융사·상품 이름을 쓰지 않는다
 * (대부업법 §9조의2① — 대부업자·여신금융기관이 아니면 대부업 광고를 할 수 없다).
 */

/** 공시 사이트 — 특정 금융사가 아니라 비교 공시(결정 13) */
const LINKS = [
  { href: "https://finlife.fss.or.kr", label: "금감원 금융상품 비교공시" },
  { href: "https://portal.kfb.or.kr", label: "은행연합회 소비자포털" },
] as const;

/**
 * 소득 한도에 걸려 모자랄 때만 보이는 안내 문장(결정 14). 지역 한도(LTV)에 걸린 부족분은 다른 금융사 대출로도
 * 메우기 어렵다 — LTV 는 선순위 채권을 합쳐 재고(은행업감독규정 별표 18 "(담보대출금액 + 선순위채권 + 임차보증금 및
 * 최우선변제 소액임차보증금) ÷ 담보가치" https://www.law.go.kr/LSW//flDownload.do?flSeq=134395615), 수도권·규제지역
 * 6억 한도는 "금융회사가 수도권·규제지역 내에서 취급하는 주택구입목적 주담대" 전부다(금융위 2025-06-27
 * https://www.fsc.go.kr/edu/news/84845). 그래서 소득(DSR) 때문에 생긴 부족분에만 2금융권 DSR 50% 를 알린다.
 */
export const DSR_GAP_NOTICE =
  "은행 DSR 40% 기준으로 계산했어요. 저축은행·여신전문(캐피탈)·보험사는 DSR 50% 를 적용해 한도가 다를 수 있고 금리가 은행보다 높아요. 금융사별 조건은 아래 공시에서 비교해 보세요.";

/** 평형 칩 계측은 한 페이지 세션에 한 번 */
let unitChipTracked = false;
function trackUnitChipOnce(aptId: unknown): void {
  if (unitChipTracked) return;
  unitChipTracked = true;
  trackEvent("funding_planner_unit", { aptId });
}
/** 시험 격리용 */
export function _resetFundingPlannerTracking(): void {
  unitChipTracked = false;
}

const boxStyle = {
  background: C.bg,
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 10,
  border: `1px solid ${C.border}`,
} as const;

const inputStyle = {
  width: "100%",
  minHeight: 36,
  boxSizing: "border-box",
  padding: "6px 8px",
  // 16px 미만이면 아이폰 사파리가 입력할 때 화면을 확대한다
  fontSize: 16,
  border: `1px solid ${C.borderStrong}`,
  borderRadius: 8,
  background: C.white,
  color: C.text,
} as const;

const labelStyle = { display: "block", fontSize: F.xs, color: C.muted, marginBottom: 4 } as const;

/** 숫자만 남긴다(만원 입력 — 최대 7자리 = 999억 9,999만) */
function digitsOnly(v: string, max = 7): string {
  return v
    .replace(/[^\d]/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, max);
}
function toNumber(d: string): number | null {
  return d ? Number(d) : null;
}
/** 0 은 "-" 가 아니라 "0원" — 기존 대출로 소득 한도가 0 이 된 것은 사실이다(fmtPrice 는 0 을 "-" 로 그린다) */
function money(v: number): string {
  return v > 0 ? fmtPrice(v) : "0원";
}
function withCommas(d: string): string {
  return d ? Number(d).toLocaleString("ko-KR") : "";
}

function MoneyInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (_digits: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={withCommas(value)}
          placeholder={placeholder}
          onChange={(e) => onChange(digitsOnly(e.target.value))}
          style={{ ...inputStyle, paddingRight: 44 }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: F.sm,
            color: C.muted,
          }}
        >
          만 원
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", padding: "3px 0" }}
    >
      <span
        style={{ fontSize: F.xs, color: strong ? C.text : C.muted, fontWeight: strong ? 700 : 400, lineHeight: 1.4 }}
      >
        {label}
      </span>
      <span style={{ fontSize: F.base, fontWeight: 700, color: strong ? C.blue : C.text, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

export const FundingPlanner = memo(function FundingPlanner({
  apt,
  rates,
}: {
  apt: Apt;
  /** 부모가 받은 주담대 은행권 금리 응답(`useLoanRates(DEFAULT_GROUP)`) */
  rates: readonly FinlifeRate[];
}) {
  const aptPrice = Number(apt.price ?? 0);
  const hasPrice = Number.isFinite(aptPrice) && aptPrice > 0;
  // 분양가가 없으면 그리지 않으니 평형표도 부르지 않는다
  const { schedule, units, firstRecruitDate } = usePresaleDetail(hasPrice ? String(apt.id) : null);

  const [chipSel, setChipSel] = useState<number | null>(null);
  const [income, setIncome] = useState("");
  const [cash, setCash] = useState("");
  const [debt, setDebt] = useState("");
  const [split, setSplit] = useState<Record<keyof PaymentSplit, string>>({
    contract: String(DEFAULT_PAYMENT_SPLIT.contract),
    interim: String(DEFAULT_PAYMENT_SPLIT.interim),
    balance: String(DEFAULT_PAYMENT_SPLIT.balance),
  });
  const [open, setOpen] = useState(false);
  const usedRef = useRef(false);

  const chips = useMemo(() => noticeUnitChips(units), [units]);
  const defaultChip = closestChipIndex(chips, aptPrice);
  const chipIdx = chipSel != null && chipSel < chips.length ? chipSel : defaultChip;
  const price = chipIdx >= 0 ? chips[chipIdx].price : aptPrice;

  const zone = zoneOf({
    isRegulated: apt.isRegulated as boolean | null | undefined,
    region: apt.region,
    gu: apt.gu,
  });
  // 첫 공고일 = 카드 공고일과 묶음 첫 공고일 중 이른 쪽 — "묶음 = 한 사업장" 전제(경과규정은 사업장 단위)다.
  // 큰 숫자는 지금 규정이라 이 날짜가 숫자를 부풀리지 않고, 종전 줄은 "될 수 있어요" 사실 안내다(결정 18).
  const firstDate = earliestIsoDate(apt.presaleRecruitDate, firstRecruitDate);
  const latestDate = latestIsoDate(apt.presaleRecruitDate, schedule?.recruit_date, firstRecruitDate);
  const bankRate = useMemo(() => pickMonthlyRate(rates), [rates]);
  const splitNum: PaymentSplit = {
    contract: Number(split.contract || 0),
    interim: Number(split.interim || 0),
    balance: Number(split.balance || 0),
  };

  const plan = planFunding({
    price,
    zone,
    region: apt.region,
    gu: apt.gu,
    firstDate,
    latestDate,
    income: toNumber(income),
    cash: toNumber(cash),
    existingMonthly: toNumber(debt),
    split: splitNum,
    bankRate,
  });

  if (!hasPrice) return null;

  const markUsed = (d: string) => {
    if (d && !usedRef.current) {
      usedRef.current = true;
      trackEvent("funding_planner_use", { aptId: apt.id });
    }
  };
  const onChip = (i: number) => {
    setChipSel(i);
    trackUnitChipOnce(apt.id);
  };

  const cur = plan?.ltv.current;
  const ltvPct = cur ? Math.round(cur.rate * 100) : 0;
  const ltvCapped = cur ? cur.amount < Math.round(price * cur.rate) : false;
  // 종전 규정 사실 줄 — 종전 값이 지금보다 클 때만. 주택이 아닌 유형(비주택 담보)·입주가 이미 시작된 단지(개인 주담대)는
  // 집단대출 경과규정 대상이 아니라 숨긴다(부풀림 0 · 세션659 검사관 🔴·🟠). 입주월 형식을 모르면 숨기지 않는다.
  // 사전청약 단지도 숨긴다 — 첫 공고가 사전당첨자모집공고라 경과규정의 "입주자모집공고"가 아니다(세션660 사장님 결정).
  const gf = plan?.ltv.grandfathered ?? null;
  const showGrandfather =
    gf != null &&
    cur != null &&
    gf.amount > cur.amount &&
    !isNonHousing(apt.presaleHousingType as string | null | undefined, apt.name as string | null | undefined) &&
    !isPreSubscription(apt.name as string | null | undefined) &&
    !moveInStarted([apt.presaleMoveIn, schedule?.move_in_ym], kstYearMonth());
  const cashNum = toNumber(cash);
  const metroOrRegulated = plan ? plan.stressAdd === STRESS_RATE_METRO : false;

  return (
    <div data-testid="funding-planner" style={boxStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>내 조건으로 잔금 계획</span>
        <span
          style={{
            fontSize: F.xs,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            background: C.blueLight,
            color: C.blue,
          }}
        >
          선택한 평형 기준
        </span>
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
        입력한 값은 이 화면에서만 계산하고 저장하지 않아요. 위 막대와 아래 &apos;한 달에 갚을 돈&apos;은 소득을 모르고
        낸 값이에요. 이 카드는 입력한 소득 기준이에요.
      </div>
      <div data-testid="fp-homeless" style={{ fontSize: F.xs, color: C.text, marginTop: 4, fontWeight: 600 }}>
        무주택자 기준이에요(1주택자·생애최초는 한도가 달라요).
      </div>

      {/* 평형 (결정 11) — 청약홈 최신 공고 주택형별 최고 분양가. 없으면 대표 분양가 한 줄 */}
      <div style={{ marginTop: 10 }}>
        {chips.length > 0 ? (
          <>
            <div style={labelStyle}>평형 (청약홈 공고 기준)</div>
            <div role="group" aria-label="평형 고르기" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {chips.map((c, i) => {
                const on = i === chipIdx;
                return (
                  <button
                    key={`${c.label}-${i}`}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChip(i)}
                    style={{
                      minHeight: 36,
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: `1px solid ${on ? C.blue : C.borderStrong}`,
                      background: on ? C.blueLight : C.white,
                      color: on ? C.blue : C.text,
                      fontSize: F.sm,
                      fontWeight: on ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {`${c.label} · ${fmtPrice(c.price)}`}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: F.xs, color: C.muted }}>
            분양가 <strong style={{ color: C.text }}>{fmtPrice(aptPrice)}</strong> (대표 분양가)
          </div>
        )}
      </div>

      {/* 입력 (결정 11) — 첫눈 2칸, 나머지는 "더 자세히" 안. 휴대폰 2칸 · 데스크톱 4칸 한 줄 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
          marginTop: 10,
        }}
      >
        <MoneyInput
          id="fp-income"
          label="연소득 (세전, 선택)"
          value={income}
          placeholder="예: 4,800"
          onChange={(d) => {
            setIncome(d);
            markUsed(d);
          }}
        />
        <MoneyInput
          id="fp-cash"
          label="지금 가진 돈 (선택)"
          value={cash}
          placeholder="예: 8,000"
          onChange={(d) => {
            setCash(d);
            markUsed(d);
          }}
        />
        {open && (
          <MoneyInput
            id="fp-debt"
            label="기존 대출 월 상환 (선택)"
            value={debt}
            placeholder="없음"
            onChange={setDebt}
          />
        )}
        {open && (
          <div>
            <div style={labelStyle}>계약·중도·잔금 비율 (%)</div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["contract", "interim", "balance"] as const).map((k) => (
                <input
                  key={k}
                  id={`fp-split-${k}`}
                  aria-label={{ contract: "계약금 비율", interim: "중도금 비율", balance: "잔금 비율" }[k]}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={split[k]}
                  onChange={(e) => setSplit((s) => ({ ...s, [k]: digitsOnly(e.target.value, 3) }))}
                  style={{ ...inputStyle, textAlign: "center", padding: "6px 4px" }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{
          marginTop: 8,
          minHeight: 36,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          fontSize: F.xs,
          color: C.blue,
          fontWeight: 600,
        }}
      >
        <span
          aria-hidden
          style={{ display: "inline-block", transition: "transform .2s", transform: open ? "rotate(90deg)" : "none" }}
        >
          ▸
        </span>
        더 자세히 (기존 대출 · 계약금/중도금 비율 · 단계별 금액)
      </div>

      {plan == null && (
        <div
          data-testid="fp-split-error"
          role="alert"
          style={{ marginTop: 6, fontSize: F.xs, color: C.red, fontWeight: 600 }}
        >
          계약·중도·잔금 비율을 더해 100%가 되어야 계산해요 (지금 {splitTotal(splitNum)}%).
        </div>
      )}

      {plan && open && (
        <div style={{ marginTop: 4, padding: "6px 8px", background: C.white, borderRadius: 8 }}>
          <Row label={`계약금 ${splitNum.contract}% · 계약 때`} value={fmtPrice(plan.stages.contract)} />
          <Row
            label={`중도금 ${splitNum.interim}% · 보통 집단대출 · 공고문 확인`}
            value={fmtPrice(plan.stages.interim)}
          />
          <Row label={`잔금 ${splitNum.balance}% · 입주 때`} value={fmtPrice(plan.stages.balance)} />
        </div>
      )}

      {plan && (
        <div style={{ marginTop: 10 }}>
          <Row
            testId="fp-region-limit"
            label={`지역 규칙(LTV ${ltvPct}%${ltvCapped ? " · 금액 한도 적용" : ""})으로 빌릴 수 있는 최대`}
            value={fmtPrice(plan.ltv.current.amount)}
          />
          <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.5 }}>
            분양가 기준이에요(입주 때 감정가가 더 낮으면 줄어요).
          </div>
          {showGrandfather && gf && (
            <div
              data-testid="fp-grandfather"
              style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.5, margin: "4px 0 6px" }}
            >
              {`첫 모집공고 ${gf.firstDate}${gf.latestDate !== gf.firstDate ? ` (최근 공고 ${gf.latestDate})` : ""} — ${gf.eventLabel}(${gf.effectiveDate}) 전 공고라 금융사 심사에 따라 종전 규정(LTV ${Math.round(gf.rate * 100)}%)이 적용될 수 있어요. 그 경우 최대 ${fmtPrice(gf.amount)}이에요. ${gf.effectiveDate} 이후 전매로 산 분양권은 제외예요.`}
            </div>
          )}
          {plan.incomeLimit != null ? (
            <Row
              testId="fp-income-limit"
              label={`소득 기준(DSR ${Math.round(DSR_LIMIT_BANK * 100)}% · 스트레스 금리 ${plan.stressRate?.toFixed(2)}%, 은행 최저 금리 기준)으로 빌릴 수 있는 최대`}
              value={money(plan.incomeLimit)}
            />
          ) : plan.incomeSkip === "no-rate" &&
            plan.shortfall <= 0 ? null /* 아래 상자가 같은 금리 문장을 띄운다 — 두 번 안 보이게(세션660) */ : (
            <div data-testid="fp-income-skip" style={{ fontSize: F.xs, color: C.muted, padding: "3px 0" }}>
              {plan.incomeSkip === "no-rate"
                ? "금리를 아직 못 받아 소득 기준은 계산하지 않았어요"
                : "연소득을 넣으면 소득 기준 한도도 계산해요"}
            </div>
          )}
          <Row
            testId="fp-loan"
            strong
            label={
              plan.incomeLimit != null
                ? "둘 중 작은 값 = 잔금 때 주담대 예상액"
                : "잔금 때 주담대 예상액 (지역 한도 기준)"
            }
            value={money(plan.loan)}
          />
          {plan.monthly != null && bankRate != null && (
            <Row
              testId="fp-monthly"
              label={`월 상환액 (${LOAN_TERM_YEARS}년 원리금균등 · 은행 최저 금리 ${bankRate.toFixed(2)}%)`}
              value={`${fmtPrice(plan.monthly)} 원`}
            />
          )}

          <div style={{ marginTop: 8, padding: "8px 10px", background: C.white, borderRadius: 8 }}>
            {plan.shortfall > 0 ? (
              <>
                <div style={{ fontSize: F.xs, color: C.muted }}>
                  {`분양가 ${fmtPrice(price)} − 주담대 ${money(plan.loan)}${cashNum ? ` − 가진 돈 ${fmtPrice(cashNum)}` : ""} =`}
                </div>
                <div data-testid="fp-shortfall" style={{ fontSize: 20, fontWeight: 800, color: C.amber, marginTop: 2 }}>
                  더 필요한 돈 {fmtPrice(plan.shortfall)}
                </div>
              </>
            ) : plan.incomeLimit != null ? (
              <div data-testid="fp-enough" style={{ fontSize: F.base, fontWeight: 700, color: C.green }}>
                지금 가진 돈과 주담대로 분양가를 맞출 수 있어요
              </div>
            ) : plan.incomeSkip === "no-rate" ? (
              <div data-testid="fp-enough-norate" style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>
                금리를 아직 못 받아 소득 기준은 계산하지 않았어요.
              </div>
            ) : (
              <div data-testid="fp-enough-region" style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>
                지역 한도 기준이에요. 연소득을 넣으면 소득 기준 한도까지 볼 수 있어요
              </div>
            )}
            <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4 }}>취득세·등기비 등은 빼고 계산했어요</div>
          </div>

          {plan.incomeLimit != null && plan.incomeLimit < plan.ltv.current.amount && plan.shortfall > 0 && (
            <div data-testid="fp-dsr-notice" style={{ fontSize: F.xs, color: C.text, lineHeight: 1.6, marginTop: 8 }}>
              {DSR_GAP_NOTICE}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              minHeight: 36,
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: 7,
              border: `1px solid ${C.blueBorder}`,
              background: C.white,
              color: C.blue,
              fontSize: F.sm,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {l.label} ↗
          </a>
        ))}
      </div>

      <div data-testid="fp-transfer" style={{ fontSize: F.micro, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
        중도금 대출을 늘리지 않고 잔금대출로 바꾸면 중도금을 받을 때의 기준이 적용될 수 있어요(금융위 FAQ).
      </div>
      <div data-testid="fp-basis" style={{ fontSize: F.micro, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
        {`${LOAN_RULES_BASIS} 기준 · 금융위 10·15 대책 · 스트레스 DSR 3단계(${
          metroOrRegulated
            ? `수도권·규제지역 가산 ${STRESS_RATE_METRO.toFixed(1)}%p`
            : `지방 ${STRESS_RATE_LOCAL}%p(${STRESS_RATE_LOCAL_UNTIL}까지)`
        }) · 실제 한도는 금융사 심사로 정해져요`}
      </div>
    </div>
  );
});
