/**
 * 필터 드롭다운 패널 래퍼 (세션 481: 글래스 오버레이)
 * - position:absolute 로 카드를 밀지 않고 그 위를 덮으며 내려옴
 * - 65% 반투명 + backdrop-blur 글래스 (미지원 브라우저는 @supports 폴백으로 불투명)
 * - isOpen=false 시 렌더링하지 않음, ESC/외부클릭/scrim 은 부모(SearchFilterBar)에서 처리
 * ⚠️ 부모(SearchFilterBar 최상위 div)에 position:relative 필요 (기준점)
 */
import { memo } from "react";
import { C, R } from "@/theme";
import type { FilterDropdownProps } from "@/types/filters";

/* 글래스 스타일 주입 (SSR-safe, 최초 1회) — backdrop-filter 미지원 시 불투명 폴백 */
const GLASS_ID = "filter-glass";
if (typeof document !== "undefined" && !document.getElementById(GLASS_ID)) {
  const s = document.createElement("style");
  s.id = GLASS_ID;
  s.textContent = `
.filter-glass{background:${C.card};}
@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .filter-glass{
    background:rgba(255,255,255,0.65);
    -webkit-backdrop-filter:saturate(180%) blur(16px);
    backdrop-filter:saturate(180%) blur(16px);
  }
  @media (prefers-color-scheme:dark){ .filter-glass{background:rgba(27,31,43,0.62);} }
}`;
  document.head.appendChild(s);
}

export const FilterDropdown = memo(function FilterDropdown({
  isOpen,
  children,
  label,
  isDesktop,
}: FilterDropdownProps) {
  if (!isOpen) return null;
  return (
    <div
      role="region"
      aria-label={`${label} 필터`}
      className="filter-glass"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        right: 0,
        zIndex: 40,
        border: `1px solid ${C.border}`,
        borderRadius: R.panel,
        padding: isDesktop ? 14 : 10,
        boxShadow: C.shadowMd,
      }}
    >
      {children}
    </div>
  );
});
