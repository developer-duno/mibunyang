import { memo } from "react";
import { C, F } from "@/theme";

// 데이터 채움률 도넛 (세션 380 PR-2) — primitives.tsx ScoreBadge circle 패턴 복제(본문 수정 아님).
// ScoreBadge는 gr(score) 등급색 + "점수+등급"이라 재사용 불가 → 채움률 전용 신규.
// 색은 80/50 임계값(ExpertDataCompleteness 동일 기준). 가운데 "N%" 텍스트.

type CompletenessDonutProps = { pct: number; size?: number; label?: string };

const donutColor = (pct: number) => (pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red);

// 도넛 링 두께 — 트랙·진행 공통(세션 385: 4→2.5 로 더 얇게, 사장님 요청).
const DONUT_STROKE = 2.5;

export const CompletenessDonut = memo(function CompletenessDonut({ pct, size = 40, label }: CompletenessDonutProps) {
  const r = size / 2 - 3.5;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(pct, 100)) / 100);
  const color = donutColor(pct);
  // aria-label에 "점수" 글자 금지 — DetailModal 테스트의 getAllByRole("img",{name:/점수/})와 무충돌.
  const aria = `${label ? label + " " : ""}채움률 ${pct}%`;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} role="img" aria-label={aria}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECEEF4" strokeWidth={DONUT_STROKE} />
        <circle data-role="progress" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={DONUT_STROKE} strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: F.xs, fontWeight: 800, color, lineHeight: 1 }}>{pct}%</span>
      </div>
    </div>
  );
});
