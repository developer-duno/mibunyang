import { memo } from "react";
import { C, F, catCol, gr } from "@/theme";
import { BRAND_TIER } from "@/constants/brands";
import { PROFILES } from "@/constants/profiles";
import { orderedCatEntries } from "@/constants/catOrder";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import { getAgeCoeff, getAreaAdj } from "@/scoring/engine";
import { fmtCompletion } from "@/lib/format";
import type { Apt, Profile } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

/**
 * AdminScoreBreakdown — 점수 산출 과정 투명 분해 (관리자 전용, 세션 405 전문가 대시보드 이식).
 * 구 ExpertScoreBreakdown(적정가 산출 + 카테고리별 서브표) + ExpertScoreSummary(최종 가중 합계표)
 * + ExpertAptHeader 의 도시등급 1줄을 한 컴포넌트로 합본. 계산 로직 무변경 이식.
 * DetailModal §6 점수 섹션에서 adminLoggedIn 일 때만 lazy 렌더 — 소비자 번들/화면 영향 0.
 */
type AdminScoreBreakdownProps = {
  apt: Apt;
  res: ScoringResult;
  profile?: Profile;
};

export const AdminScoreBreakdown = memo(function AdminScoreBreakdown({
  apt,
  res,
  profile = "live",
}: AdminScoreBreakdownProps) {
  const w = PROFILES[profile]?.w || PROFILES.live.w;
  // 표시 순서는 CAT_DISPLAY_ORDER 고정 — 하드코딩이 아니라 단일 출처다(세션 487).
  // 실제 존재하는 카테고리만 남기므로 "동적 추출"의 취지(목록 드리프트 방지)는 유지되고,
  // catOrder.test.ts 가 6개 전량·중복 0 을 잠근다.
  const catKeys = orderedCatEntries(res.cats as unknown as Record<string, unknown>).map(([k]) => k);

  // 적정가 산출 과정 (구 ExpertScoreBreakdown L13-19 이식)
  const ageCoeff = getAgeCoeff(apt.completion);
  const areaAdj = getAreaAdj(apt.area);
  const brand = (apt.builder ? (BRAND_TIER as Record<string, { adj: number; tier?: string }>)[apt.builder] : null) || {
    adj: 1.0,
  };
  const nearbyMedian = apt.nearbyMedian ?? 0;
  const aptPrice = apt.price ?? 0;
  const fairPrice = nearbyMedian > 0 ? Math.round(nearbyMedian * ageCoeff * areaAdj * brand.adj) : 0;
  const devPct = fairPrice > 0 ? (((fairPrice - aptPrice) / fairPrice) * 100).toFixed(1) : "N/A";

  // 도시등급 (구 ExpertAptHeader L11-12 이식 — fieldMeta 141필드에 없는 유일한 헤더 정보)
  const tier =
    (apt.region ? (REGIONS as Record<string, { tier: string; gus: string[] }>)[apt.region]?.tier : null) || "C";
  const cityLabel = (CITY_TIER as Record<string, { label: string }>)[tier]?.label || tier;

  const g = gr(res.total);

  return (
    <div data-testid="admin-score-breakdown" style={{ marginTop: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: F.md, fontWeight: 800, color: C.indigo }}>점수 산출 과정 (관리자)</div>
          <div style={{ fontSize: F.xs, color: C.muted, marginTop: 2 }}>도시등급: {cityLabel}</div>
        </div>
        <button
          type="button"
          data-no-print
          onClick={() => window.print()}
          aria-label="분석 결과 인쇄"
          style={{
            background: C.indigo,
            color: C.white,
            border: "none",
            borderRadius: 4,
            padding: "6px 14px",
            fontSize: F.xs,
            fontWeight: 700,
            cursor: "pointer",
            minHeight: 36,
            flexShrink: 0,
          }}
        >
          인쇄
        </button>
      </div>

      {/* 적정가 산출 과정 */}
      <div
        style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}
      >
        <div
          style={{
            fontSize: F.base,
            fontWeight: 800,
            color: C.green,
            marginBottom: 10,
            borderBottom: `2px solid ${C.green}`,
            paddingBottom: 6,
          }}
        >
          적정가 산출 과정
        </div>
        <div style={{ fontSize: F.sm, lineHeight: 1.8, color: C.sub }}>
          <div>
            주변중위가: <b style={{ color: C.text }}>{(apt.nearbyMedian ?? 0).toLocaleString("ko-KR")}만원</b>
          </div>
          <div>
            × 연식계수: <b style={{ color: C.text }}>{ageCoeff.toFixed(2)}</b> (입주: {fmtCompletion(apt.completion)})
          </div>
          <div>
            × 면적보정: <b style={{ color: C.text }}>{areaAdj.toFixed(2)}</b> ({apt.area ?? ""}㎡)
          </div>
          <div>
            × 브랜드보정: <b style={{ color: C.text }}>{brand.adj.toFixed(2)}</b> ({apt.builder})
          </div>
          <div
            style={{
              marginTop: 6,
              padding: "8px 10px",
              background: fairPrice > aptPrice ? C.greenLight : C.redLight,
              borderRadius: 6,
              fontWeight: 700,
              color: fairPrice > aptPrice ? C.green : C.red,
            }}
          >
            = 적정가 {fairPrice.toLocaleString("ko-KR")}만원 | 괴리도 {devPct}% (
            {fairPrice > aptPrice ? "저평가" : fairPrice < aptPrice ? "고평가" : "적정"})
          </div>
        </div>
      </div>

      {/* 카테고리별 서브항목 분해 표 + 프로필 가중치 기여도 */}
      {catKeys.map((k) => {
        const cat = res.cats[k as keyof typeof res.cats];
        const weight = w[k as keyof typeof w] || 0;
        const contribution = ((cat.total * weight) / 100).toFixed(1);
        return (
          <div
            key={k}
            style={{
              background: C.card,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              padding: 16,
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: F.base, fontWeight: 800, color: (catCol as Record<string, string>)[k] }}>
                {cat.label}
              </span>
              <span style={{ fontSize: F.base, fontWeight: 800, color: (catCol as Record<string, string>)[k] }}>
                총점: {cat.total}점
              </span>
            </div>
            <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>
              프로필 가중치: {weight}% → 기여도: {cat.total} × {weight}% ={" "}
              <b style={{ color: C.text }}>{contribution}점</b>
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
                    <td style={{ padding: "8px 6px", color: C.sub, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {sub.name}
                    </td>
                    <td
                      style={{
                        padding: "8px 6px",
                        textAlign: "left",
                        color: C.sub,
                        fontSize: F.xs,
                        wordBreak: "break-word",
                        lineHeight: 1.5,
                      }}
                    >
                      {sub.detail || sub.info}
                    </td>
                    <td
                      style={{
                        padding: "8px 6px",
                        textAlign: "right",
                        fontWeight: 700,
                        color:
                          sub.score >= 70 ? C.green : sub.score >= 40 ? (catCol as Record<string, string>)[k] : C.red,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sub.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* 최종 가중 합계표 (구 ExpertScoreSummary 이식) */}
      <div
        style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}
      >
        <div
          style={{
            fontSize: F.base,
            fontWeight: 800,
            color: C.text,
            marginBottom: 10,
            borderBottom: `2px solid ${C.text}`,
            paddingBottom: 6,
          }}
        >
          최종 가중 합계 — {PROFILES[profile]?.name || profile}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: F.sm }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              <th style={{ textAlign: "left", padding: "8px 4px", color: C.muted }}>카테고리</th>
              <th style={{ textAlign: "center", padding: "8px 4px", color: C.muted }}>점수</th>
              <th style={{ textAlign: "center", padding: "8px 4px", color: C.muted }}>가중치</th>
              <th style={{ textAlign: "right", padding: "8px 4px", color: C.muted }}>기여분</th>
            </tr>
          </thead>
          <tbody>
            {catKeys.map((k) => {
              const cat = res.cats[k as keyof typeof res.cats];
              const weight = w[k as keyof typeof w] || 0;
              return (
                <tr key={k} style={{ borderBottom: `1px solid ${C.bg}` }}>
                  <td style={{ padding: "6px 4px", fontWeight: 600, color: (catCol as Record<string, string>)[k] }}>
                    {cat.label}
                  </td>
                  <td style={{ textAlign: "center", padding: "6px 4px", fontWeight: 700 }}>{cat.total}</td>
                  <td style={{ textAlign: "center", padding: "6px 4px", color: C.muted }}>{weight}%</td>
                  <td style={{ textAlign: "right", padding: "6px 4px", fontWeight: 700, color: C.text }}>
                    {((cat.total * weight) / 100).toFixed(1)}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `2px solid ${C.text}` }}>
              <td style={{ padding: "8px 4px", fontWeight: 800, color: C.text }}>합계</td>
              <td />
              <td style={{ textAlign: "center", padding: "8px 4px", fontWeight: 700 }}>100%</td>
              <td style={{ textAlign: "right", padding: "8px 4px", fontWeight: 800, fontSize: F.base, color: g.c }}>
                {res.total}점 ({g.l})
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});
