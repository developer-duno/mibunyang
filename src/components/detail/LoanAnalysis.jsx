import { memo, useState } from "react";
import { C } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE, LTV_RATES } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";
import { thStyle, tdStyle } from "./tableStyles";
import { useRentLoanRates } from "@/hooks/useRentLoanRates";
import { LoanRatesSection } from "./LoanRatesSection";

export const LoanAnalysis = memo(function LoanAnalysis({ apt }) {
  const [showLegal, setShowLegal] = useState(false);
  const { rates: rentRates } = useRentLoanRates();

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
  const rentMinRate = rentRates[0]?.rateMin ?? null;
  const hasRentData = (apt.rentByArea ?? []).length > 0;
  const rows = hasDetail ? loanSrc.map(p => {
    const rent = (apt.rentByArea ?? []).find(r => r.area === p.area);
    const gap = rent ? p.min - rent.avg : null;
    const ltv = calcLTV(p.min, zone);
    const monthlyInterest = (gap != null && gap > 0 && rentMinRate) ? Math.round(gap * rentMinRate / 100 / 12) : null;
    return { area: p.area, min: p.min, rentAvg: rent?.avg, gap, ltv, monthlyInterest };
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
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thStyle}>면적</th><th style={thStyle}>최저매매</th><th style={thStyle}>전세평균</th><th style={thStyle}>갭투자액</th><th style={thStyle}>월이자</th><th style={{ ...thStyle, textAlign: "right" }}>LTV한도</th>
              </tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.area}㎡</td>
                  <td style={tdStyle}>{fmtPrice(r.min)}</td>
                  <td style={tdStyle}>{r.rentAvg ? fmtPrice(r.rentAvg) : "-"}</td>
                  <td style={{ ...tdStyle, color: r.gap != null ? (r.gap > 0 ? C.red : C.green) : C.muted }}>{r.gap != null ? (r.gap === 0 ? "0만" : (r.gap > 0 ? "+" : "-") + fmtPrice(Math.abs(r.gap))) : "-"}</td>
                  <td style={{ ...tdStyle, color: r.monthlyInterest != null ? C.amber : C.muted }}>{r.monthlyInterest != null ? `${fmtPrice(r.monthlyInterest)}/월` : "-"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.blue }}>{fmtPrice(r.ltv)}</td>
                </tr>
              ))}</tbody>
            </table>
            {rentMinRate != null && hasRentData && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>전세대출 최저 {rentMinRate}% 기준 (만기일시상환, 이자만 납부)</div>
            )}
            {!hasRentData && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>전세 시세 데이터가 없어 갭투자 월이자를 계산할 수 없습니다</div>
            )}
          </>
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

      <LoanRatesSection apt={{ ...apt, _ltvBase: ltvBase }} />
    </>
  );
});
