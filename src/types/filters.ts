/**
 * filters/* 컴포넌트 공통 props 타입 (M3b).
 *
 * SearchFilterBar 가 8개 필터 패널 + FilterButton + FilterDropdown 호출.
 * 각 props 정확 시그니처는 호출처 (sections/SearchFilterBar.jsx) 갱신 시 보완.
 */
import type { ReactNode } from "react";

export interface FilterDropdownProps {
  isOpen: boolean;
  children: ReactNode;
  label: string;
  isDesktop?: boolean;
}

export interface FilterButtonProps {
  label: string;
  summary?: string;
  isOpen: boolean;
  isActive?: boolean;
  onClick: () => void;
}
