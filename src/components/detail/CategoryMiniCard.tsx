import { memo } from "react";
import { C, F, catCol, gr, SHORT_LABEL } from "@/theme";
import { catVerdict } from "@/constants/catVerdict";
import type { Res } from "@/types/scoring";

/**
 * CategoryMiniCard — 상세 모달 종합 탭 "요약 대시보드" 카드 (세션 409 D2b).
 * 카테고리명 + 점수 + 등급 + 결론 1줄 → 탭하면 점수 탭의 해당 CatPanel 로 진입(자동 펼침).
 * progressive disclosure: 종합 탭에서 한눈에 보고, 깊이는 클릭으로.
 *
 * 강조(emphasized=프로필 상위 카테고리)는 테두리 + "중점" 칩으로 표시. CatPanel 은 테두리+"★ 중점"
 * 배지 2중인데, 미니카드는 종합 탭에 상시 마운트(display:none keepMounted)되어 점수 탭 CatPanel 의
 * "★ 중점" 카운트 단언과 충돌하므로 "★" 없는 "중점" 으로 분리 (세션 409 적대검증 R1-1).
 */
type CategoryMiniCardProps = {
  k: string;
  cat: Res;
  emphasized?: boolean;
  onJump: () => void;
};

export const CategoryMiniCard = memo(function CategoryMiniCard({ k, cat, emphasized, onJump }: CategoryMiniCardProps) {
  const col = (catCol as Record<string, string>)[k] || C.text;
  const grade = gr(cat.total);
  const label = (SHORT_LABEL as Record<string, string>)[cat.label ?? ""] || cat.label || k;
  const verdict = catVerdict(k, cat);

  return (
    <div
      onClick={onJump}
      role="button"
      tabIndex={0}
      aria-label={`${label} ${cat.total}점 ${grade.l} — ${verdict}. 점수 탭에서 상세 보기`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onJump();
        }
      }}
      style={{
        // CatPanel.tsx L62 삼항 통째 답습 — 강조/비강조 모두 동일 두께(레이아웃 시프트 0, 적대검증 R2)
        border: emphasized ? `2px solid ${col}` : `1px solid ${C.border}`,
        background: C.bg,
        borderRadius: 10,
        padding: "10px 12px",
        cursor: "pointer",
        minHeight: 44,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "border-color .15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>{label}</span>
          {emphasized && (
            <span style={{ fontSize: F.xs, fontWeight: 700, color: col, background: C.card, border: `1px solid ${col}`, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>중점</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: F.lg, fontWeight: 800, color: col, lineHeight: 1 }}>{cat.total}</span>
          <span style={{ fontSize: F.xs, fontWeight: 700, color: grade.c, background: grade.bg, padding: "1px 5px", borderRadius: 4 }}>{grade.l}</span>
        </span>
      </div>
      <span style={{ fontSize: F.sm, color: C.muted }}>{verdict}</span>
    </div>
  );
});
