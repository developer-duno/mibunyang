import { memo, useState } from "react";
import { C, F } from "@/theme";
import { thStyle, tdStyle } from "./tableStyles";
import { useLoanRates } from "@/hooks/useLoanRates";
import { LOAN_GROUPS, DEFAULT_GROUP } from "@/constants/loanGroups";
import { SkeletonText } from "@/components/primitives";

/**
 * 다른 금융권 금리 "더 보기" (세션593 D6) — 은행권은 본문(월 상환액 큰 숫자 · 은행 범위 막대)으로 올라갔고,
 * 이 접힘에는 저축은행·여신전문·보험 권역 탭과 상품 표만 남는다.
 *
 * ⚠️ 닫힌 동안 금리를 부르지 않는다 — 권역 금리를 부르는 훅은 펼쳐야 마운트되는 `OtherGroupRates` 안에만
 * 있다. 금융 탭 첫 진입 호출 수 = 전세·주담대 은행권 2회(옛날과 같다).
 */

/** 은행권(본문에 있음)을 뺀 권역 탭 */
const OTHER_GROUPS = LOAN_GROUPS.filter((g) => g.code !== DEFAULT_GROUP);

export const LoanRatesSection = memo(function LoanRatesSection() {
  const [showRates, setShowRates] = useState(false);

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
        onClick={() => setShowRates((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={showRates}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setShowRates((v) => !v);
          }
        }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>저축은행 · 여신전문 · 보험 금리 보기</span>
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
      {showRates && <OtherGroupRates />}
    </div>
  );
});

/** 펼쳤을 때만 마운트 — 이 안의 `useLoanRates` 가 고른 권역 금리를 부른다 */
function OtherGroupRates() {
  const [selectedGroup, setSelectedGroup] = useState(OTHER_GROUPS[0]?.code ?? DEFAULT_GROUP);
  const { rates: loanRates, loading: ratesLoading, error: ratesError } = useLoanRates(selectedGroup);

  return (
    <div style={{ marginTop: 8 }}>
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
      {!ratesLoading && !ratesError && loanRates.length === 0 && (
        <div style={{ fontSize: F.xs, color: C.muted, padding: "12px 0", textAlign: "center" }}>
          금리 정보가 없습니다
        </div>
      )}
      {!ratesLoading && loanRates.length > 0 && (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>은행</th>
                <th style={thStyle}>상품</th>
                <th style={thStyle}>금리(최저)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>금리(최고)</th>
              </tr>
            </thead>
            <tbody>
              {loanRates.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 600,
                      maxWidth: 60,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.bank}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      maxWidth: 80,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={r.product}
                  >
                    {r.product}
                    {[r.mortgageType, r.repayType, r.rateType].filter(Boolean).length > 0 && (
                      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2 }}>
                        {[r.mortgageType, r.repayType, r.rateType].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: C.blue, fontWeight: 700 }}>
                    {r.rateMin != null ? `${r.rateMin}%` : "-"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.rateMax != null ? `${r.rateMax}%` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
            출처: 금융감독원 금융상품통합비교공시 (1시간 캐싱)
          </div>
        </>
      )}
    </div>
  );
}
