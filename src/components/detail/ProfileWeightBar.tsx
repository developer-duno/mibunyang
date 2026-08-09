import { memo } from "react";
import { C, F, catCol, SHORT_LABEL } from "@/theme";
import { getTopCats } from "@/constants/profiles";
import type { Cats, ProfileWeights } from "@/types/scoring";

/**
 * ProfileWeightBar — 상세 모달 종합 탭 "왜 이 점수인지" 가중치 막대 (세션 434, 점수 근거 투명화 A+B).
 *
 * 손님이 처음 보는 새 정보축: "내 프로필이 어느 카테고리를 중시하는지". 기존 관리자 전용
 * AdminScoreBreakdown 가중 합계표(기여분 숫자)와 달리, 비중 %만 막대로 보여 정직성·중복 동시 해소.
 *
 * 표현 계층 전용. 점수 엔진·DB·prop 무변경. getTopCats·catCol·SHORT_LABEL 기존 export 재활용.
 * 막대 행은 role=button 없음(미니카드가 점프 담당, 막대는 정보 표시 전용).
 *
 * ⚠️ 세션508 PR-3a: 강점(최고 total)·보완(최저 total) 요약 줄은 `aptVerdict`(종합 탭 맨 위
 * "판정 한 줄")로 이관했다 — 같은 탭에서 같은 말을 두 번 하던 자리였다(ProfileWeightBar 는
 * profile && !blind 일 때만 떠서 비로그인·프로필 미선택 손님은 그 결론을 못 봤다). 이 컴포넌트는
 * 이제 막대만 그린다.
 */
type ProfileWeightBarProps = {
  weights: ProfileWeights;
  cats: Cats;
};

function shortLabel(label?: string): string {
  return (SHORT_LABEL as Record<string, string>)[label ?? ""] || label || "";
}

export const ProfileWeightBar = memo(function ProfileWeightBar({ weights, cats }: ProfileWeightBarProps) {
  const topCats = getTopCats(weights, 3);
  const maxW = Math.max(...topCats.map((k) => weights[k]), 1);

  return (
    <div
      style={{
        background: C.bg,
        borderRadius: 10,
        padding: "12px 14px",
        margin: "12px 0",
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 10 }}>
        이 점수는 당신의 프로필 기준으로 계산됐어요
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {topCats.map((k) => {
          const w = weights[k];
          const col = (catCol as Record<string, string>)[k] || C.text;
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: F.xs, fontWeight: 600, color: C.sub, width: 32, flexShrink: 0 }}>
                {shortLabel(cats[k].label)}
              </span>
              <div style={{ flex: 1, height: 8, background: C.card, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${(w / maxW) * 100}%`, height: "100%", background: col, borderRadius: 4 }} />
              </div>
              <span
                style={{ fontSize: F.xs, fontWeight: 700, color: col, width: 34, textAlign: "right", flexShrink: 0 }}
              >
                {w}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
