import { memo, useState } from "react";
import { C } from "@/theme";
import { fmtPrice } from "@/lib/format";
import { thStyle, tdStyle } from "./tableStyles";
import { useLoanRates } from "@/hooks/useLoanRates";
import { LOAN_GROUPS, DEFAULT_GROUP } from "@/constants/loanGroups";

export const LoanRatesSection = memo(function LoanRatesSection({ apt }) {
  const [showRates, setShowRates] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(DEFAULT_GROUP);
  const { rates: loanRates, loading: ratesLoading, error: ratesError } = useLoanRates(selectedGroup);

  const ltvBase = apt._ltvBase ?? 0;

  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
      <div
        onClick={() => setShowRates(v => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={showRates}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowRates(v => !v); } }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>은행별 금리 비교</span>
        <span style={{ fontSize: 12, color: C.muted, transition: "transform .2s", transform: showRates ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
      </div>
      {showRates && (
        <div style={{ marginTop: 8 }}>
          {/* 금융권역 탭 */}
          <div role="tablist" style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {LOAN_GROUPS.map(g => (
              <button
                key={g.code}
                role="tab"
                aria-selected={selectedGroup === g.code}
                onClick={() => setSelectedGroup(g.code)}
                style={{
                  flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, cursor: "pointer",
                  background: selectedGroup === g.code ? C.blue : "#f1f5f9",
                  color: selectedGroup === g.code ? "#fff" : C.muted,
                }}
              >
                {g.label}
              </button>
            ))}
          </div>

          {ratesLoading && <div style={{ fontSize: 11, color: C.muted, padding: "12px 0", textAlign: "center" }}>금리 정보를 불러오는 중...</div>}
          {ratesError && <div style={{ fontSize: 11, color: C.red, padding: "12px 0", textAlign: "center" }}>금리 정보를 불러올 수 없습니다</div>}
          {!ratesLoading && !ratesError && loanRates.length === 0 && (
            <div style={{ fontSize: 11, color: C.muted, padding: "12px 0", textAlign: "center" }}>금리 정보가 없습니다</div>
          )}
          {!ratesLoading && loanRates.length > 0 && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={thStyle}>은행</th>
                  <th style={thStyle}>상품</th>
                  <th style={thStyle}>금리(최저)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>금리(최고)</th>
                </tr></thead>
                <tbody>{loanRates.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.bank}</td>
                    <td style={{ ...tdStyle, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.product}>{r.product}</td>
                    <td style={{ ...tdStyle, color: C.blue, fontWeight: 700 }}>{r.rateMin != null ? `${r.rateMin}%` : "-"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.rateMax != null ? `${r.rateMax}%` : "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
              {ltvBase > 0 && loanRates[0]?.rateMin != null && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                  <strong style={{ color: C.text }}>월 상환액 시뮬레이션</strong> (대출 {fmtPrice(ltvBase)}, 30년 원리금균등)
                  <div style={{ marginTop: 4 }}>
                    최저 금리 {loanRates[0].rateMin}% 기준: <strong style={{ color: C.blue }}>{fmtPrice(Math.round(calcMonthlyPayment(ltvBase, loanRates[0].rateMin, 30) / 10000) * 10000)}/월</strong>
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>출처: 금융감독원 금융상품통합비교공시 (1시간 캐싱)</div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

/** 원리금균등 월 상환액 계산 (만원 단위) */
function calcMonthlyPayment(principal, annualRate, years) {
  if (!principal || !annualRate || !years) return 0;
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}
