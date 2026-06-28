import { memo } from "react";
import type { ReactNode } from "react";
import { C, F } from "@/theme";

type WidgetCardProps = { title: string; onExpand?: () => void; expandLabel?: string; children: ReactNode };

/** 홈 위젯 공통 카드 틀 — 제목 + (옵션) 펼치기 버튼. InfoPage cardStyle 답습 */
export const WidgetCard = memo(function WidgetCard({
  title,
  onExpand,
  expandLabel = "펼치기",
  children,
}: WidgetCardProps) {
  return (
    <section
      aria-label={title}
      style={{
        background: C.card,
        borderRadius: 12,
        padding: 14,
        border: `1px solid ${C.border}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: F.md, fontWeight: 800, color: C.text }}>{title}</span>
        {onExpand && (
          <button
            onClick={onExpand}
            style={{
              background: "transparent",
              border: "none",
              color: C.blue,
              fontSize: F.sm,
              fontWeight: 700,
              cursor: "pointer",
              padding: "4px 6px",
              minHeight: 36,
            }}
          >
            {expandLabel} →
          </button>
        )}
      </div>
      {children}
    </section>
  );
});
