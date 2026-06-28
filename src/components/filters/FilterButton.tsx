/**
 * 필터 드롭다운 트리거 버튼
 * 클릭 시 해당 필터 패널을 열고/닫는 공용 버튼
 */
import { memo } from "react";
import { C, F } from "@/theme";
import { IconChevronDown } from "@/components/icons";
import type { FilterButtonProps } from "@/types/filters";

export const FilterButton = memo(function FilterButton({
  label,
  summary,
  isOpen,
  isActive,
  onClick,
}: FilterButtonProps) {
  const active = isOpen || isActive;
  return (
    <button
      onClick={onClick}
      aria-expanded={isOpen}
      style={{
        height: 36,
        padding: "0 10px",
        fontSize: F.sm,
        fontWeight: active ? 700 : 500,
        background: isOpen ? C.indigoLight : isActive ? C.indigoLight : C.slate100,
        color: isOpen ? C.indigo : isActive ? C.indigo : C.slate600,
        border: active ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
        borderRadius: 6,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "all .15s",
      }}
    >
      {label}
      {summary ? `: ${summary}` : ""}
      <span
        style={{ display: "inline-flex", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}
      >
        <IconChevronDown size={11} />
      </span>
    </button>
  );
});
