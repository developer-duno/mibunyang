import { memo, useState } from "react";
import { C, F } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE, NORMAL_LTV, REGULATED_LTV_RATE } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";
import { thStyle, tdStyle } from "./tableStyles";
import { useRentLoanRates } from "@/hooks/useRentLoanRates";
import { LoanRatesSection } from "./LoanRatesSection";
import type { LoanAnalysisProps } from "@/types/components/LoanAnalysis.types";
import type { PriceAreaRow } from "@/types/detail";

export const LoanAnalysis = memo(function LoanAnalysis({ apt, isLoading, error }: LoanAnalysisProps) {
  const [showLegal, setShowLegal] = useState(false);
  const { rates: rentRates, loading: rentLoading } = useRentLoanRates() as {
    rates: Array<{ rateMin?: number | null }>;
    loading: boolean;
  };

  const zone = getZone(apt.region, apt.gu);
  const zoneName = (ZONE_TYPE as Record<string, string>)[zone];
  // 규제지역은 비율 하나로 못 적는다 — 40% 를 곱한 뒤 집값 구간별 금액 뚜껑이 또 씌워지기 때문.
  const ltvSummary =
    zone === "normal"
      ? `LTV: 9억 이하 ${Math.round(NORMAL_LTV.under * 100)}% / 초과분 ${Math.round(NORMAL_LTV.over * 100)}% (무주택자 기준)`
      : `LTV: ${Math.round(REGULATED_LTV_RATE * 100)}% (무주택자 기준) · 대출한도 15억 초과 4억 / 25억 초과 2억`;
  // 2단 통일(세션508 PR-3a A3) — 종합 탭(2단: normal→초록/그외→빨강)과 여기(옛 3단:
  // overheated→주황/speculative→빨강)가 갈려 있었다. ZONE_MAP 이 전 항목을 overheated 하나로만
  // 매핑(PR-1)해 실제로는 같은 단지가 종합=빨강·금융=주황으로 보이는 모순이 생겼다.
  // speculative 분기는 지우지 않고 주석으로 남긴다 — 투기과열지구·조정대상지역 두 목록이
  // 다시 갈라지는 날 여기서 3단을 복원한다(regulations.ts:10 주석과 짝).
  // const zoneColor = zone === "speculative" ? C.red : zone === "overheated" ? C.amber : C.green;
  const zoneColor = zone === "normal" ? C.green : C.red;
  const aptPrice = Number(apt.price ?? 0);
  const aptArea = Number(apt.area ?? 0);
  const ltvBase = calcLTV(aptPrice, zone);
  const needCash = aptPrice - ltvBase;
  const allLoan = (apt.priceByArea as PriceAreaRow[] | undefined) ?? [];
  const narrowLoan = allLoan.filter((p) => Math.abs(p.area - aptArea) <= 10);
  const loanSrc = narrowLoan.length >= 3 ? narrowLoan : allLoan.filter((p) => Math.abs(p.area - aptArea) <= 20);
  const hasDetail = loanSrc.length > 0;
  const rentMinRate = rentRates[0]?.rateMin ?? null;
  const allRent = (apt.rentByArea as PriceAreaRow[] | undefined) ?? [];
  const hasRentData = allRent.length > 0;
  const rows = hasDetail
    ? loanSrc.map((p) => {
        const rent = allRent.find((r) => r.area === p.area);
        const gap = rent ? p.min - rent.avg : null;
        const ltv = calcLTV(p.min, zone);
        const monthlyInterest =
          gap != null && gap > 0 && rentMinRate ? Math.round((gap * rentMinRate) / 100 / 12) : null;
        return { area: p.area, min: p.min, rentAvg: rent?.avg, gap, ltv, monthlyInterest };
      })
    : [];

  return (
    <>
      <div
        style={{
          background: C.bg,
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 10,
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>매매/대출 분석</span>
          <span
            style={{
              fontSize: F.xs,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              // background: zone === "normal" ? C.greenLight : zone === "overheated" ? C.amberLight : C.redLight,
              background: zone === "normal" ? C.greenLight : C.redLight,
              color: zoneColor,
            }}
          >
            {zoneName}
          </span>
        </div>
        <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>{ltvSummary}</div>
        {zone !== "normal" && (
          <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 8 }}>
            2025년 10·15 대책으로 조정대상지역·투기과열지구에 함께 지정된 곳이에요.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: hasDetail ? 10 : 0 }}>
          <div
            style={{
              flex: 1,
              background: C.card,
              borderRadius: 8,
              padding: "8px 10px",
              textAlign: "center",
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>분양가</div>
            <div style={{ fontSize: F.base, fontWeight: 800, color: C.text }}>{fmtPrice(aptPrice)}</div>
          </div>
          <div
            style={{
              flex: 1,
              background: C.card,
              borderRadius: 8,
              padding: "8px 10px",
              textAlign: "center",
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>LTV 대출한도</div>
            <div style={{ fontSize: F.base, fontWeight: 800, color: C.blue }}>{fmtPrice(ltvBase)}</div>
          </div>
          <div
            style={{
              flex: 1,
              background: C.card,
              borderRadius: 8,
              padding: "8px 10px",
              textAlign: "center",
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>필요 자기자본</div>
            <div style={{ fontSize: F.base, fontWeight: 800, color: C.red }}>{fmtPrice(needCash)}</div>
          </div>
        </div>
        {!hasDetail && isLoading && (
          <div style={{ fontSize: F.xs, color: C.muted, marginTop: 4 }}>가격 정보를 불러오는 중…</div>
        )}
        {!hasDetail && !isLoading && error && (
          <div style={{ fontSize: F.xs, color: C.red, marginTop: 4 }}>
            가격 정보를 불러오지 못했습니다. 새로고침해 주세요.
          </div>
        )}
        {hasDetail && (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>면적</th>
                  <th style={thStyle}>최저매매</th>
                  <th style={thStyle}>전세평균</th>
                  <th style={thStyle}>갭투자액</th>
                  <th style={thStyle}>월이자</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>LTV한도</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.area}㎡</td>
                    <td style={tdStyle}>{fmtPrice(r.min)}</td>
                    <td style={tdStyle}>{r.rentAvg ? fmtPrice(r.rentAvg) : "-"}</td>
                    <td style={{ ...tdStyle, color: r.gap != null ? (r.gap > 0 ? C.red : C.green) : C.muted }}>
                      {r.gap != null
                        ? r.gap === 0
                          ? "0만"
                          : (r.gap > 0 ? "+" : "-") + fmtPrice(Math.abs(r.gap))
                        : "-"}
                    </td>
                    <td style={{ ...tdStyle, color: r.monthlyInterest != null ? C.amber : C.muted }}>
                      {r.monthlyInterest != null ? `${fmtPrice(r.monthlyInterest)}/월` : rentLoading ? "…" : "-"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.blue }}>
                      {fmtPrice(r.ltv)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rentMinRate != null && hasRentData && (
              <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4 }}>
                전세대출 최저 {rentMinRate}% 기준 (만기일시상환, 이자만 납부)
              </div>
            )}
            {!hasRentData && (
              <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4 }}>
                전세 시세 데이터가 없어 갭투자 월이자를 계산할 수 없습니다
              </div>
            )}
          </>
        )}
      </div>

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
          onClick={() => setShowLegal((v) => !v)}
          role="button"
          tabIndex={0}
          aria-expanded={showLegal}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowLegal((v) => !v);
            }
          }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        >
          <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>관련 법률/규정 안내</span>
          <span
            style={{
              fontSize: F.sm,
              color: C.muted,
              transition: "transform .2s",
              transform: showLegal ? "rotate(180deg)" : "rotate(0)",
              display: "inline-block",
            }}
          >
            ▼
          </span>
        </div>
        {showLegal && (
          <div style={{ fontSize: F.xs, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>LTV (담보인정비율)</strong> — 규제지역(조정대상지역·투기과열지구 동시
              지정) 40%, 단 대출한도는 집값 15억 초과 시 4억·25억 초과 시 2억으로 제한. 비규제지역은 9억 이하 70%,
              초과분 60% (2025년 10·15 대책, 무주택자 기준)
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>DSR (총부채원리금상환비율)</strong> — 전 금융권 40% 적용. 연소득 대비
              모든 대출의 원리금 상환액 비율 제한
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>디딤돌대출</strong> — 무주택 서민 대상, 연소득 6천만원 이하, 최대
              2.5억(생애최초 3억), 금리 2.15~3.00%
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: C.text }}>보금자리론</strong> — 무주택자·1주택자, 연소득 7천만원 이하, 최대 3.6억,
              고정금리
            </div>
            <div style={{ color: C.red, fontSize: F.xs, fontWeight: 600, marginTop: 8 }}>
              본 정보는 참고용이며 실제 대출 조건은 금융기관에 확인하세요. 규제지역 지정·해제는 수시 변경될 수 있습니다.
            </div>
          </div>
        )}
      </div>

      <LoanRatesSection apt={{ ...apt, _ltvBase: ltvBase }} />
    </>
  );
});
