import { memo, useState } from "react";
import { C } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE, LTV_RATES } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";
import { thStyle, tdStyle } from "./tableStyles";
import { useLoanRates } from "@/hooks/useLoanRates";

export const LoanAnalysis = memo(function LoanAnalysis({ apt }) {
  const [showLegal, setShowLegal] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const { rates: loanRates, loading: ratesLoading, error: ratesError } = useLoanRates();

  const zone = getZone(apt.region, apt.gu);
  const zoneName = ZONE_TYPE[zone];
  const rates = LTV_RATES[zone];
  const zoneColor = zone === "speculative" ? C.red : zone === "overheated" ? C.amber : C.green;
  const ltvBase = calcLTV(apt.price, zone);
  const needCash = apt.price - ltvBase;
  const allLoan = (apt.priceByArea ?? []);
  const narrowLoan = allLoan.filter(p => Math.abs(p.area - apt.area) <= 10);
  const loanSrc = narrowLoan.length >= 3 ? narrowLoan : allLoan.filter(p => Math.abs(p.area - apt.area) <= 20);
  const hasDetail = loanSrc.length > 0;
  const rows = hasDetail ? loanSrc.map(p => {
    const rent = (apt.rentByArea ?? []).find(r => r.area === p.area);
    const gap = rent ? p.min - rent.avg : null;
    const ltv = calcLTV(p.min, zone);
    return { area: p.area, min: p.min, rentAvg: rent?.avg, gap, ltv };
  }) : [];

  return (
    <>
      <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>매매/대출 분석</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: zone === "normal" ? C.greenLight : zone === "overheated" ? C.amberLight : C.redLight, color: zoneColor }}>{zoneName}</span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>LTV: 9억 이하 {Math.round(rates.under9 * 100)}% / 초과분 {Math.round(rates.over9 * 100)}% (무주택자 기준)</div>
        <div style={{ display: "flex", gap: 8, marginBottom: hasDetail ? 10 : 0 }}>
          <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>분양가</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{fmtPrice(apt.price)}</div>
          </div>
          <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>LTV 대출한도</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.blue }}>{fmtPrice(ltvBase)}</div>
          </div>
          <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>필요 자기자본</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.red }}>{fmtPrice(needCash)}</div>
          </div>
        </div>
        {hasDetail && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={thStyle}>면적</th><th style={thStyle}>최저매매</th><th style={thStyle}>전세평균</th><th style={thStyle}>갭투자액</th><th style={{ ...thStyle, textAlign: "right" }}>LTV한도</th>
            </tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.area}㎡</td>
                <td style={tdStyle}>{fmtPrice(r.min)}</td>
                <td style={tdStyle}>{r.rentAvg ? fmtPrice(r.rentAvg) : "-"}</td>
                <td style={{ ...tdStyle, color: r.gap != null ? (r.gap > 0 ? C.red : C.green) : C.muted }}>{r.gap != null ? (r.gap === 0 ? "0만" : (r.gap > 0 ? "+" : "-") + fmtPrice(Math.abs(r.gap))) : "-"}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.blue }}>{fmtPrice(r.ltv)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
        <div
          onClick={() => setShowLegal(v => !v)}
          role="button"
          tabIndex={0}
          aria-expanded={showLegal}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowLegal(v => !v); } }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>관련 법률/규정 안내</span>
          <span style={{ fontSize: 12, color: C.muted, transition: "transform .2s", transform: showLegal ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
        </div>
        {showLegal && (
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
            <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>LTV (담보인정비율)</strong> — 투기과열지구 40%/20%, 조정대상지역 50%/30%, 비규제지역 70%/60% (9억 초과분 차등 적용)</div>
            <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>DSR (총부채원리금상환비율)</strong> — 전 금융권 40% 적용. 연소득 대비 모든 대출의 원리금 상환액 비율 제한</div>
            <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>디딤돌대출</strong> — 무주택 서민 대상, 연소득 6천만원 이하, 최대 2.5억(생애최초 3억), 금리 2.15~3.00%</div>
            <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>보금자리론</strong> — 무주택자·1주택자, 연소득 7천만원 이하, 최대 3.6억, 고정금리</div>
            <div style={{ color: C.red, fontSize: 11, fontWeight: 600, marginTop: 8 }}>본 정보는 참고용이며 실제 대출 조건은 금융기관에 확인하세요. 규제지역 지정·해제는 수시 변경될 수 있습니다.</div>
          </div>
        )}
      </div>

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
                {apt.price > 0 && loanRates[0]?.rateMin != null && (
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
    </>
  );
});

/** 원리금균등 월 상환액 계산 (만원 단위) */
function calcMonthlyPayment(principal, annualRate, years) {
  if (!principal || !annualRate || !years) return 0;
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}
