import { memo } from "react";
import { C, F, catCol, gr } from "@/theme";
import { BRAND_TIER, resolveBuilder } from "@/constants/brands";
import { PROFILES } from "@/constants/profiles";
import { orderedCatEntries } from "@/constants/catOrder";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import { DEV_NEUTRAL_BAND_PCT } from "@/constants/scoringTiers";
import { getAgeCoeff, getAreaAdj, isPresale } from "@/scoring/engine";
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
  // 미준공(분양 예정)은 "연식"이 아니라 "신축 프리미엄"이라 라벨이 달라야 정직하다(세션528
  // 결함B 처방 — 같은 ageCoeff 가 이제 두 가지 다른 현상을 나타낸다). brands.ts 주석 참조.
  const presale = isPresale(apt.completion);
  const areaAdj = getAreaAdj(apt.area);
  // ⚠️ **`resolveBuilder` 를 반드시 거친다.** 직조회하면 "지에스건설(주)"·"디엘이앤씨 주식회사" 같은
  //    법인 표기가 미등재 1.0 으로 떨어져, 이 패널이 보여주는 곱셈이 바로 아래 "= 적정가" 와 안 맞는다
  //    (세션529 적대검증 실측: 2,227곳 중 **50곳** 불일치 — 지에스건설(주) 화면 1.00 vs 엔진 1.05 등).
  //    세션513이 `scorePrice` 에서 같은 결함을 고치며 남긴 교훈 그대로다 — 정규화는 한 군데가 아니라
  //    **`builder` 를 읽는 모든 자리**에서 해야 한다.
  const brand = (BRAND_TIER as Record<string, { adj: number; tier?: string }>)[
    resolveBuilder(apt.builder as string | null | undefined)
  ] || { adj: 1.0 };
  const nearbyMedian = apt.nearbyMedian ?? 0;
  // ⚠️ **엔진이 계산한 값을 그대로 쓴다 — 여기서 다시 계산하지 않는다.**
  // 옛 코드는 `nearbyMedian × ageCoeff × areaAdj × brand` 로 자체 재계산했는데, 세션527이
  // fairPrice 1순위를 평형별 실거래 버킷 매칭으로 바꾼 뒤 **같은 모달에 서로 다른 괴리율 두 개**가
  // 뜨게 됐다(적대검증이 잡음). 산식이 또 바뀌어도 이 화면은 따라올 필요가 없다.
  const priceRes = res.cats.price;
  const fairPrice = Number(priceRes.fairPrice ?? 0);
  const devPct = fairPrice > 0 ? String(priceRes.deviation ?? "N/A") : "N/A";
  // 색·배경·문구는 부호 단독(적정가 > 단지가면 무조건 초록)이 아니라 ±DEV_NEUTRAL_BAND_PCT 중립대 3분기 —
  // DetailModal SC0 답습(같은 상수). 추정 오차보다 작은 차이로 "저평가/고평가"를 단정하지 않는다.
  // 셋을 하나의 tone 에서 파생해 "색=중립인데 문구=저평가" 모순을 원천 차단한다(세션512 PR-2 답습).
  // fairPrice≤0(SC1 게이트)이면 devPct="N/A" → Number 가 NaN → 자동으로 중립(부재를 초록/빨강으로 오표시 안 함).
  const devNum = Number(devPct);
  const priceTone = !Number.isFinite(devNum)
    ? "neutral"
    : devNum > DEV_NEUTRAL_BAND_PCT
      ? "cheap"
      : devNum < -DEV_NEUTRAL_BAND_PCT
        ? "expensive"
        : "neutral";
  const toneColor = priceTone === "cheap" ? C.green : priceTone === "expensive" ? C.red : C.muted;
  const toneBg = priceTone === "cheap" ? C.greenLight : priceTone === "expensive" ? C.redLight : C.amberLight;
  const toneLabel = priceTone === "cheap" ? "저평가" : priceTone === "expensive" ? "고평가" : "적정가 수준";
  const fromBucket = priceRes.fairPriceFromAreaBucket === true;
  const fromSido = priceRes.fairPriceFromSidoAvg === true;

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
          {/* 기준값 줄 — 어느 경로로 구한 fairPrice 인지에 따라 설명이 달라진다.
              버킷 경로는 이미 그 평형대 실거래라 면적보정을 곱하지 않으므로 그 줄도 감춘다. */}
          <div>
            {fromBucket ? "평형별 실거래" : fromSido ? "광역 시도 평균(폴백)" : "주변중위가"}:{" "}
            <b style={{ color: C.text }}>
              {fromBucket ? `${apt.area ?? "?"}㎡ 기준` : `${nearbyMedian.toLocaleString("ko-KR")}만원`}
            </b>
          </div>
          <div>
            × {presale ? "신축 프리미엄" : "연식계수"}: <b style={{ color: C.text }}>{ageCoeff.toFixed(2)}</b> (입주:{" "}
            {fmtCompletion(apt.completion)})
          </div>
          {!fromBucket && (
            <div>
              × 면적보정: <b style={{ color: C.text }}>{areaAdj.toFixed(2)}</b> ({apt.area ?? ""}㎡)
            </div>
          )}
          <div>
            × 브랜드보정: <b style={{ color: C.text }}>{brand.adj.toFixed(2)}</b> ({apt.builder})
          </div>
          <div
            style={{
              marginTop: 6,
              padding: "8px 10px",
              background: toneBg,
              borderRadius: 6,
              fontWeight: 700,
              color: toneColor,
            }}
          >
            = 적정가 {fairPrice.toLocaleString("ko-KR")}만원 | 괴리도 {devPct}% ({toneLabel})
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
