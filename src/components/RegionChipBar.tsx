import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { C, F } from "@/theme";

// 얇은 가로 스크롤바 (webkit) — 인라인 불가라 1회 주입. scrollbarWidth:thin(FF)은 컨테이너 인라인.
// StickyJumpNav 는 스크롤바 숨김이나, 지역 칩은 "옆에 더 있다"를 보여줘야 해 얇게 노출 (세션 478).
const CHIPBAR_SCROLLBAR_CSS = `.region-chipbar-scroll::-webkit-scrollbar{height:4px}
.region-chipbar-scroll::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
.region-chipbar-scroll::-webkit-scrollbar-track{background:transparent}`;

type RegionChipBarProps = {
  /** regionFilter 적용 전 모집단의 distinct 시도 (REGIONS 순서 정렬은 부모 책임) */
  regions: string[];
  active: string;
  onSelect: (_region: string) => void;
  /** ★ 관심지역 (맨 앞 정렬 + ★ prefix) */
  favorites: string[];
  onToggleFavorite: (_region: string) => void;
};

// 호갱노노 "관심 지역 수정" 답습 — 편집 모드 중 칩 클릭 = 관심 토글 (long-press 미사용).
// 칩 스타일 답습원 = UpcomingPage STAGE_TABS 버튼 (minHeight 36 + aria-pressed — 터치 타겟 규칙)
export const RegionChipBar = memo(function RegionChipBar({
  regions,
  active,
  onSelect,
  favorites,
  onToggleFavorite,
}: RegionChipBarProps) {
  const [editMode, setEditMode] = useState(false);
  const favSet = new Set(favorites);
  const ordered = ["전국", ...regions.filter((r) => favSet.has(r)), ...regions.filter((r) => !favSet.has(r))];

  // 오른쪽 그라데이션 힌트 — 스크롤로 끝까지 가면 숨김 (더 볼 게 없으니). 초기/리사이즈/스크롤 시 갱신.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const updateHint = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 스크롤 여지가 없거나(다 보임) 오른쪽 끝 도달 시 힌트 숨김 (1px 여유)
    const noScroll = el.scrollWidth <= el.clientWidth + 1;
    const reachedEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setAtEnd(noScroll || reachedEnd);
  }, []);
  useLayoutEffect(() => {
    updateHint();
  }, [updateHint, ordered.length, editMode]);

  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <style>{CHIPBAR_SCROLLBAR_CSS}</style>
      <div
        ref={scrollRef}
        className="region-chipbar-scroll"
        role="group"
        aria-label="지역 필터"
        onScroll={updateHint}
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "thin",
          paddingBottom: 4,
        }}
      >
        {ordered.map((region) => {
          const isFav = favSet.has(region);
          const isActive = !editMode && active === region;
          const togglable = editMode && region !== "전국"; // 전국은 관심 토글 대상 아님
          return (
            <button
              key={region}
              type="button"
              onClick={() => (togglable ? onToggleFavorite(region) : !editMode ? onSelect(region) : undefined)}
              aria-pressed={editMode ? isFav : isActive}
              aria-label={togglable ? `${region} 관심지역 ${isFav ? "해제" : "등록"}` : undefined}
              style={{
                fontSize: F.xs,
                fontWeight: 700,
                padding: "6px 12px",
                whiteSpace: "nowrap",
                flexShrink: 0,
                background: isActive ? C.blue : C.card,
                color: isActive ? "white" : editMode && !togglable ? C.muted : C.text,
                border: `1px solid ${isActive ? C.blue : editMode && isFav ? C.amber : C.border}`,
                borderRadius: 16,
                cursor: togglable || !editMode ? "pointer" : "default",
                minHeight: 36,
              }}
            >
              {isFav ? "★ " : editMode && togglable ? "☆ " : ""}
              {region}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setEditMode((m) => !m)}
          aria-pressed={editMode}
          aria-label="관심지역 편집 모드"
          style={{
            fontSize: F.xs,
            fontWeight: 700,
            padding: "6px 12px",
            whiteSpace: "nowrap",
            flexShrink: 0,
            background: editMode ? C.amberLight : C.card,
            color: editMode ? C.amber : C.muted,
            border: `1px solid ${editMode ? C.amber : C.border}`,
            borderRadius: 16,
            cursor: "pointer",
            minHeight: 36,
          }}
        >
          {editMode ? "완료" : "★ 관심지역"}
        </button>
      </div>
      {/* 편집 모드 안내 — 처음 쓰는 손님에게 칩 클릭 = 관심지역 토글임을 알림.
          overflowX 스크롤 컨테이너 밖(형제)에 둬 지역칩 가로 넘침(세션478 #250) 회귀 방지. */}
      {editMode && (
        <div style={{ fontSize: F.xs, color: C.muted, marginTop: 4, paddingLeft: 2 }}>
          칩을 눌러 관심 지역을 등록/해제하세요
        </div>
      )}
      {/* 오른쪽 그라데이션 힌트 — "옆으로 더 있다" 시각 신호. 끝 도달 시 숨김. 클릭 통과. */}
      {!atEnd && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 4,
            width: 28,
            pointerEvents: "none",
            background: `linear-gradient(90deg, transparent, ${C.bg})`,
          }}
        />
      )}
    </div>
  );
});
