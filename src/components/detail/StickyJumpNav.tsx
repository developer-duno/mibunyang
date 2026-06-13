import { memo, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { C, F, gr } from "@/theme";

// 상세 모달 목차바 (StickyJumpNav) — 13블록을 6 섹션으로 점프(세션 410 D3: WAI-ARIA tablist). 가로 스크롤 칩바.
// DetailModal 스크롤 컨테이너(overflowY:auto) 안쪽 첫 자식에 position:sticky 로 얹는다.
// 좌우 패딩 누출 처리: 스크롤러 좌우 패딩(PC 24 / 모바일 16) 틈으로 콘텐츠가 칩바 옆을 통과하지
// 않게 negative margin + padding 으로 전폭을 덮는다.
// (구 "dropdown" variant 는 전문가 대시보드 전용이어서 세션 405 폐지와 함께 제거)

export const JUMP_NAV_HEIGHT = 44;

export type JumpSection = { id: string; label: string; highlighted?: boolean };

type StickyJumpNavProps = {
  sections: JumpSection[];
  activeId: string | null;
  totalScore?: number | null;
  onJump: (_id: string) => void;
  /** 패널이 DOM 에 마운트됐는지 — aria-controls dangling 차단(미마운트 패널 참조 방지). DetailModal isPanelMounted 전달. */
  isMounted: (_id: string) => boolean;
  isDesktop?: boolean;
  noPrint?: boolean;
};

export const StickyJumpNav = memo(function StickyJumpNav({
  sections, activeId, totalScore, onJump, isMounted, isDesktop, noPrint,
}: StickyJumpNavProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 칩 ref 배열 — 화살표 키보드 이동 시 다음 칩 focus + active 칩 scrollIntoView 용 (세션 410 D3).
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // 인덱스별 안정 ref 콜백(useMemo 1회 생성) — 인라인 화살표 ref 의 매 렌더 detach/attach 회피.
  const setChipRef = useMemo(
    () => sections.map((_, i) => (el: HTMLButtonElement | null) => { chipRefs.current[i] = el; }),
    [sections],
  );

  // 모바일 가로 스와이프: active 칩이 가로 스크롤 영역 밖이면 자동 정렬.
  // scrollIntoView 미구현 환경(jsdom 등) 가드 — 없으면 정렬만 건너뜀.
  useEffect(() => {
    const chip = chipRefs.current[sections.findIndex(s => s.id === activeId)];
    const box = scrollRef.current;
    if (!chip || !box || typeof chip.scrollIntoView !== "function") return;
    chip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeId, sections]);

  // 화살표 키보드 탭 이동 (WAI-ARIA tabs automatic activation) — ←/→ 로 인접 탭 활성화 + 포커스.
  // focus({preventScroll:true}) = effect 의 smooth scrollIntoView 와 자동스크롤 경합 방지(단일화).
  // preventScroll 미지원 구형 Safari(<15)는 추가 스크롤 한 번 튐(기능 침묵 아님, 허용).
  const handleChipKeyDown = (e: KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (idx + delta + sections.length) % sections.length;
    onJump(sections[nextIdx].id);
    chipRefs.current[nextIdx]?.focus({ preventScroll: true });
  };

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
        role="tablist"
        aria-label="상세 분석 카테고리"
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
        {sections.map((s, idx) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              ref={setChipRef[idx]}
              type="button"
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={isActive}
              // 미마운트 패널(미방문 탭) 참조 차단 — dangling aria-controls 방지(세션 410 D3)
              aria-controls={isMounted(s.id) ? s.id : undefined}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onJump(s.id)}
              onKeyDown={(e) => handleChipKeyDown(e, idx)}
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
                // 탭 전환(세션 407 D1)으로 칩이 비활성 콘텐츠의 유일한 진입로로 승격 — 터치 타겟 36px+ (접근성 규칙)
                minHeight: 36,
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
