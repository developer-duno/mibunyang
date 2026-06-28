import { memo, useState } from "react";
import { C, F } from "@/theme";

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

  return (
    <div
      role="group"
      aria-label="지역 필터"
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        paddingBottom: 4,
        marginBottom: 8,
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
        {editMode ? "완료" : "★ 편집"}
      </button>
    </div>
  );
});
