import { memo, useRef, useEffect } from "react";
import { C, F, gr } from "@/theme";

// 상세 모달 목차바 (StickyJumpNav) — 13블록을 6 섹션으로 점프.
// DetailModal 스크롤 컨테이너(overflowY:auto) 안쪽 첫 자식에 position:sticky 로 얹는다.
// 좌우 패딩 누출 처리: 스크롤러 좌우 패딩(PC 24 / 모바일 16) 틈으로 콘텐츠가 칩바 옆을 통과하지
// 않게 negative margin + padding 으로 전폭을 덮는다.

export const JUMP_NAV_HEIGHT = 44;

export type JumpSection = { id: string; label: string };

type StickyJumpNavProps = {
  sections: JumpSection[];
  activeId: string | null;
  totalScore?: number | null;
  onJump: (_id: string) => void;
  isDesktop?: boolean;
  noPrint?: boolean;
};

export const StickyJumpNav = memo(function StickyJumpNav({
  sections, activeId, totalScore, onJump, isDesktop, noPrint,
}: StickyJumpNavProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeChipRef = useRef<HTMLButtonElement | null>(null);

  // 모바일 가로 스와이프: active 칩이 가로 스크롤 영역 밖이면 자동 정렬.
  // scrollIntoView 미구현 환경(jsdom 등) 가드 — 없으면 정렬만 건너뜀.
  useEffect(() => {
    const chip = activeChipRef.current;
    const box = scrollRef.current;
    if (!chip || !box || typeof chip.scrollIntoView !== "function") return;
    chip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeId]);

  const pad = isDesktop ? 24 : 16;
  const g = gr(totalScore ?? 0);

  return (
    <div
      {...(noPrint ? { "data-no-print": true } : {})}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        height: JUMP_NAV_HEIGHT,
        // 좌우 패딩 누출 차단 — 스크롤러 전폭을 불투명 배경으로 덮기
        background: C.card,
        margin: `0 -${pad}px`,
        padding: `0 ${pad}px`,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          gap: 6,
          overflowX: "auto",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
          height: "100%",
          alignItems: "center",
        }}
      >
        {sections.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              ref={isActive ? activeChipRef : undefined}
              onClick={() => onJump(s.id)}
              aria-current={isActive ? "true" : undefined}
              style={{
                flexShrink: 0,
                background: isActive ? C.blue : "transparent",
                color: isActive ? C.white : C.muted,
                border: "none",
                borderRadius: 99,
                padding: "5px 12px",
                fontSize: F.sm,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background .15s, color .15s",
                minHeight: 30,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {totalScore != null && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            paddingLeft: 8,
            borderLeft: `1px solid ${C.border}`,
          }}
        >
          <span style={{ fontSize: F.xs, color: C.muted, fontWeight: 600 }}>종합</span>
          <span style={{ fontSize: F.md, fontWeight: 800, color: g.c, lineHeight: 1 }}>{totalScore}</span>
        </div>
      )}
    </div>
  );
});
