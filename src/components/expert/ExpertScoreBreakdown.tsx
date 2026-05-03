import { memo } from "react";
import { C, F, catCol } from "@/theme";
import { BRAND_TIER } from "@/constants/brands";
import { PROFILES } from "@/constants/profiles";
import { getAgeCoeff, getAreaAdj } from "@/scoring/engine";
import { fmtCompletion } from "@/lib/format";
import type { ExpertScoreBreakdownProps } from "@/types/expert";

export const ExpertScoreBreakdown = memo(function ExpertScoreBreakdown({ apt, res, profile }: ExpertScoreBreakdownProps) {
  const w = PROFILES[profile]?.w || PROFILES.live.w;
  const catKeys = Object.keys(res.cats);

  const ageCoeff = getAgeCoeff(apt.completion);
  const areaAdj = getAreaAdj(apt.area);
  const brand = (apt.builder ? (BRAND_TIER as Record<string, { adj: number; tier?: string }>)[apt.builder] : null) || { adj: 1.0 };
  const nearbyMedian = apt.nearbyMedian ?? 0;
  const aptPrice = apt.price ?? 0;
  const fairPrice = nearbyMedian > 0 ? Math.round(nearbyMedian * ageCoeff * areaAdj * brand.adj) : 0;
  const devPct = fairPrice > 0 ? ((fairPrice - aptPrice) / fairPrice * 100).toFixed(1) : "N/A";

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: F.base, fontWeight: 800, color: C.green, marginBottom: 10, borderBottom: `2px solid ${C.green}`, paddingBottom: 6 }}>적정가 산출 과정</div>
        <div style={{ fontSize: F.sm, lineHeight: 1.8, color: C.sub }}>
          <div>주변중위가: <b style={{ color: C.text }}>{(apt.nearbyMedian ?? 0).toLocaleString("ko-KR")}만원</b></div>
          <div>× 연식계수: <b style={{ color: C.text }}>{ageCoeff.toFixed(2)}</b> (입주: {fmtCompletion(apt.completion)})</div>
          <div>× 면적보정: <b style={{ color: C.text }}>{areaAdj.toFixed(2)}</b> ({apt.area ?? ""}㎡)</div>
          <div>× 브랜드보정: <b style={{ color: C.text }}>{brand.adj.toFixed(2)}</b> ({apt.builder})</div>
          <div style={{ marginTop: 6, padding: "8px 10px", background: fairPrice > aptPrice ? C.greenLight : C.redLight, borderRadius: 6, fontWeight: 700, color: fairPrice > aptPrice ? C.green : C.red }}>
            = 적정가 {fairPrice.toLocaleString("ko-KR")}만원 | 괴리도 {devPct}% ({fairPrice > aptPrice ? "저평가" : fairPrice < aptPrice ? "고평가" : "적정"})
          </div>
        </div>
      </div>

      {catKeys.map(k => {
        const cat = res.cats[k as keyof typeof res.cats];
        const weight = w[k as keyof typeof w] || 0;
        const contribution = (cat.total * weight / 100).toFixed(1);
        return (
          <div key={k} style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: F.base, fontWeight: 800, color: (catCol as Record<string, string>)[k] }}>{cat.label}</span>
              <span style={{ fontSize: F.base, fontWeight: 800, color: (catCol as Record<string, string>)[k] }}>총점: {cat.total}점</span>
            </div>
            <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>
              프로필 가중치: {weight}% → 기여도: {cat.total} × {weight}% = <b style={{ color: C.text }}>{contribution}점</b>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: F.xs }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${(catCol as Record<string, string>)[k]}` }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", color: C.text, fontWeight: 700 }}>서브항목</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", color: C.text, fontWeight: 700 }}>정보 · 기준</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: C.text, fontWeight: 700 }}>점수</th>
                </tr>
              </thead>
              <tbody>
                {(cat.subs || []).map((sub, si) => (
                  <tr key={si} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 6px", color: C.sub, fontWeight: 600, whiteSpace: "nowrap" }}>{sub.name}</td>
                    <td style={{ padding: "8px 6px", textAlign: "left", color: C.sub, fontSize: F.xs, wordBreak: "break-word", lineHeight: 1.5 }}>{sub.detail || sub.info}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700, color: sub.score >= 70 ? C.green : sub.score >= 40 ? (catCol as Record<string, string>)[k] : C.red, whiteSpace: "nowrap" }}>{sub.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
});
