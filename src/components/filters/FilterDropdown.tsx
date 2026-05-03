/**
 * 필터 드롭다운 패널 래퍼
 * isOpen=false 시 렌더링하지 않음, ESC/외부클릭은 부모(SearchFilterBar)에서 처리
 */
import { memo } from "react";
import { C } from "@/theme";
import type { FilterDropdownProps } from "@/types/filters";

export const FilterDropdown = memo(function FilterDropdown({ isOpen, children, label, isDesktop }: FilterDropdownProps) {
  if (!isOpen) return null;
  return (
    <div
      role="region"
      aria-label={`${label} 필터`}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: isDesktop ? 14 : 10,
        marginTop: 6,
        boxShadow: C.shadowMd,
      }}
    >
      {children}
    </div>
  );
});
