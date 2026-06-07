import { memo, useRef, useEffect, useState } from "react";
import { C, F, gr } from "@/theme";

// 상세 모달 목차바 (StickyJumpNav) — 13블록을 6 섹션으로 점프.
// DetailModal 스크롤 컨테이너(overflowY:auto) 안쪽 첫 자식에 position:sticky 로 얹는다.
// 좌우 패딩 누출 처리: 스크롤러 좌우 패딩(PC 24 / 모바일 16) 틈으로 콘텐츠가 칩바 옆을 통과하지
// 않게 negative margin + padding 으로 전폭을 덮는다.
//
// variant (세션 383):
//   "chips"(기본, DetailModal) = 가로 스크롤 칩바.
//   "dropdown"(ExpertDashboard) = active 라벨 단추 1개 + 펼침 세로 목록. 가로 스크롤 0.
//     섹션 10개+ 라 가로 칩바가 모바일에서 안 넘어가던 문제 해소.

export const JUMP_NAV_HEIGHT = 44;

export type JumpSection = { id: string; label: string; highlighted?: boolean };

type StickyJumpNavProps = {
  sections: JumpSection[];
  activeId: string | null;
  totalScore?: number | null;
  onJump: (_id: string) => void;
  isDesktop?: boolean;
  noPrint?: boolean;
  variant?: "chips" | "dropdown";
};

export const StickyJumpNav = memo(function StickyJumpNav({
  sections, activeId, totalScore, onJump, isDesktop, noPrint, variant = "chips",
}: StickyJumpNavProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeChipRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  // 모바일 가로 스와이프: active 칩이 가로 스크롤 영역 밖이면 자동 정렬.
  // scrollIntoView 미구현 환경(jsdom 등) 가드 — 없으면 정렬만 건너뜀. (chips 전용)
  useEffect(() => {
    if (variant !== "chips") return;
    const chip = activeChipRef.current;
    const box = scrollRef.current;
    if (!chip || !box || typeof chip.scrollIntoView !== "function") return;
    chip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeId, variant]);

  const pad = isDesktop ? 24 : 16;
  const g = gr(totalScore ?? 0);

  // ── dropdown variant: 가로 스크롤 없는 단추 1개 + 펼침 목록 ──
  if (variant === "dropdown") {
    const activeLabel = sections.find((s) => s.id === activeId)?.label ?? sections[0]?.label ?? "목차";
    return (
      <div
        {...(noPrint ? { "data-no-print": true } : {})}
        style={{
          position: "sticky", top: 0, zIndex: 10, height: JUMP_NAV_HEIGHT,
          background: C.card, margin: `0 -${pad}px`, padding: `0 ${pad}px`,
          borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 6, background: C.slate100, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "6px 12px", fontSize: F.sm, fontWeight: 700,
              cursor: "pointer", minHeight: 32, whiteSpace: "nowrap",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activeLabel}</span>
            <span style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
          </button>
          {open && (
            <>
              {/* 바깥 클릭 닫기 백드롭 */}
              <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
              <ul
                role="listbox"
                style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
                  margin: 0, padding: 4, listStyle: "none", background: C.card,
                  border: `1px solid ${C.border}`, borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: "60dvh", overflowY: "auto",
                }}
              >
                {sections.map((s) => {
                  const isActive = s.id === activeId;
                  return (
                    <li key={s.id}>
                      {/* role/aria-selected/onClick 을 같은 엘리먼트(button)에 둔다 — 분리하면
                          스크린리더·키보드·테스트에서 선택과 클릭이 어긋난다(세션 383). */}
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => { onJump(s.id); setOpen(false); }}
                        style={{
                          width: "100%", textAlign: "left", background: isActive ? C.blueLight : "transparent",
                          color: isActive ? C.blue : C.text, border: "none", borderRadius: 6,
                          padding: "9px 12px", fontSize: F.sm, fontWeight: isActive ? 700 : 500,
                          cursor: "pointer", minHeight: 40,
                        }}
                      >
                        {s.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        {totalScore != null && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, paddingLeft: 8, borderLeft: `1px solid ${C.border}` }}>
            <span style={{ fontSize: F.xs, color: C.muted, fontWeight: 600 }}>종합</span>
            <span style={{ fontSize: F.md, fontWeight: 800, color: g.c, lineHeight: 1 }}>{totalScore}</span>
          </div>
        )}
      </div>
    );
  }

  // ── chips variant (기본): 가로 스크롤 칩바 ──
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
                border: !isActive && s.highlighted ? `1.5px solid ${C.blue}` : "1.5px solid transparent",
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
