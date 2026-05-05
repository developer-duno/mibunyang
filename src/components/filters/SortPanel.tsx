/**
 * 정렬 옵션 패널 — 7가지 정렬을 색상별 버튼 리스트로 표시
 * 선택 시 onSortChange + 패널 자동 닫기(onClose)
 */
import { memo } from "react";
import { SORT_OPTIONS } from "@/constants/sortOptions";
import { F } from "@/theme";
import type { SortKey } from "@/types/hooks";

type SortOption = { key: SortKey; bg: string; ac: string; mobileLabel: string };

type SortPanelProps = {
  sortKey: SortKey;
  onSortChange: (_key: SortKey) => void;
  onClose: () => void;
};

export const SortPanel = memo(function SortPanel({ sortKey, onSortChange, onClose }: SortPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
      {(SORT_OPTIONS as SortOption[]).map((s: SortOption) => {
        const selected = sortKey === s.key;
        return (
          <button key={s.key} onClick={() => { onSortChange(s.key); onClose(); }}
            aria-current={selected ? "true" : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", fontSize: F.sm,
              fontWeight: selected ? 700 : 500,
              background: selected ? s.bg : "transparent",
              color: selected ? s.ac : "#475569",
              border: selected ? `1.5px solid ${s.ac}` : "1.5px solid transparent",
              borderRadius: 6, cursor: "pointer", transition: "all .15s",
              textAlign: "left" as const,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: selected ? s.ac : "#CBD5E1",
              flexShrink: 0,
            }} />
            {s.mobileLabel}
          </button>
        );
      })}
    </div>
  );
});
