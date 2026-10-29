import { memo, useMemo, useState } from "react";
import { C, F } from "@/theme";
import { useLoanRates } from "@/hooks/useLoanRates";
import { LOAN_GROUPS, DEFAULT_GROUP } from "@/constants/loanGroups";
import { SkeletonText } from "@/components/primitives";
import { summarizeRateRange } from "@/lib/loanRates";
import { RateRangeSummary } from "./BankLoanBlocks";

/**
 * 다른 금융권 금리 "더 보기" (세션593 D6) — 은행권은 본문(월 상환액 큰 숫자 · 은행 범위 줄)으로 올라갔고,
 * 이 접힘에는 저축은행·여신전문·보험 권역 탭과 그 권역의 금리 범위만 남는다.
 *
 * ⚠️ 회사 이름·상품 이름·금리 순위는 쓰지 않는다(세션665 사장님 결정 — 옛 "회사·상품·최저·최고 10줄 표"를 뺐다).
 * 은행 블록과 같은 부품(`RateRangeSummary`)으로 "N개 저축은행 최저 ~ 최고" 범위 한 줄만 보여 준다.
 *
 * ⚠️ 처음 펼치기 전에는 금리를 부르지 않는다 — 권역 금리를 부르는 훅은 처음 펼쳐야 마운트되는 `OtherGroupRates`
 * 안에만 있다. 금융 탭 첫 진입 호출 수 = 주담대 은행권 1회(세션675 에 전세 금리 조회를 쓰던 면적별 표를 지웠다).
 * 한 번 펼친 뒤 접으면 숨기기만 한다.
 */

/** 접힘 머리 글자 — 잔금 카드의 금융사 종류별 안내 줄이 이 글자를 그대로 가리킨다(세션675 결정 가) */
export const NONBANK_RATES_TOGGLE = "저축은행 · 여신전문 · 보험 금리 보기";

/** 은행권(본문에 있음)을 뺀 권역 탭 */
const OTHER_GROUPS = LOAN_GROUPS.filter((g) => g.code !== DEFAULT_GROUP);

/** 권역 → 회사 수 뒤 낱말 ("22개 저축은행" · "13개 보험사") */
const GROUP_UNIT: Readonly<Record<string, string>> = {
  "030300": "저축은행",
  "030200": "여신전문사",
  "050000": "보험사",
};

export const LoanRatesSection = memo(function LoanRatesSection() {
  const [showRates, setShowRates] = useState(false);
  // 한 번이라도 펼쳤나 — 펼친 뒤로는 접어도 내용을 내리지 않고 숨기기만 한다(세션593 후속 F2).
  // 내리면 `useLoanRates` 의 권역별 기억이 같이 사라져 다시 펼칠 때마다 우리 API 를 또 부른다.
  const [everOpened, setEverOpened] = useState(false);
  const toggle = () => {
    setShowRates((v) => !v);
    setEverOpened(true);
  };

  return (
    <div
      style={{
        background: C.bg,
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 10,
        border: `1px solid ${C.border}`,
      }}
    >
      <div
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={showRates}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>{NONBANK_RATES_TOGGLE}</span>
        <span
          style={{
            fontSize: F.sm,
            color: C.muted,
            transition: "transform .2s",
            transform: showRates ? "rotate(180deg)" : "rotate(0)",
            display: "inline-block",
          }}
        >
          ▼
        </span>
      </div>
      {everOpened && <OtherGroupRates hidden={!showRates} />}
    </div>
  );
});

/**
 * 처음 펼칠 때 마운트 — 이 안의 `useLoanRates` 가 고른 권역 금리를 부른다.
 * 접으면 `hidden`(화면·화면 읽기 둘 다에서 빠진다)으로 숨기기만 하므로 다시 펼쳐도 같은 권역은 다시 부르지 않는다.
 */
function OtherGroupRates({ hidden }: { hidden: boolean }) {
  const [selectedGroup, setSelectedGroup] = useState(OTHER_GROUPS[0]?.code ?? DEFAULT_GROUP);
  const { rates: loanRates, disclosureMonth, loading: ratesLoading, error: ratesError } = useLoanRates(selectedGroup);
  // 아파트·분할상환 상품이 하나도 없으면(여신전문처럼 응답 0건이거나 다른 상품만) "금리 정보가 없습니다"
  const hasRange = useMemo(() => summarizeRateRange(loanRates) != null, [loanRates]);

  return (
    <div hidden={hidden} style={{ marginTop: 8 }}>
      {/* 금융권역 탭 */}
      <div role="tablist" aria-label="금융권역" style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {OTHER_GROUPS.map((g) => (
          <button
            key={g.code}
            role="tab"
            aria-selected={selectedGroup === g.code}
            onClick={() => setSelectedGroup(g.code)}
            style={{
              flex: 1,
              padding: "5px 0",
              fontSize: F.xs,
              fontWeight: 600,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: selectedGroup === g.code ? C.blue : "#f1f5f9",
              color: selectedGroup === g.code ? "#fff" : C.muted,
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {ratesLoading && <SkeletonText lines={4} width="90%" />}
      {ratesError && (
        <div style={{ fontSize: F.xs, color: C.red, padding: "12px 0", textAlign: "center" }}>
          금리 정보를 불러올 수 없습니다
        </div>
      )}
      {!ratesLoading && !ratesError && !hasRange && (
        <div style={{ fontSize: F.xs, color: C.muted, padding: "12px 0", textAlign: "center" }}>
          금리 정보가 없습니다
        </div>
      )}
      {/* 오류면 그리지 않는다 — 훅은 실패해도 앞 권역 rates 를 남겨, 새 권역 이름표에 옛 숫자가 붙는다(세션665 검사관 🟠) */}
      {!ratesLoading && !ratesError && hasRange && (
        <RateRangeSummary
          rates={loanRates}
          unit={GROUP_UNIT[selectedGroup] ?? "회사"}
          disclosureMonth={disclosureMonth}
          linkText="회사별 금리는 금감원 비교공시에서 보기 →"
          rowTestId="group-rate-row"
        />
      )}
    </div>
  );
}
