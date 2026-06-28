/**
 * 필터 컴포넌트 공유 인라인 스타일 상수
 * SearchFilterBar에서 추출 — 6개 패널 + 오케스트레이터 공용
 */
import type { CSSProperties } from "react";
import { C, F } from "@/theme";

/* 배지 pulse 애니메이션 (SSR-safe, 최초 1회 주입) */
const BADGE_ANIM = "badge-pulse";
if (typeof document !== "undefined" && !document.getElementById(BADGE_ANIM)) {
  const s = document.createElement("style");
  s.id = BADGE_ANIM;
  s.textContent = `@keyframes ${BADGE_ANIM}{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}`;
  document.head.appendChild(s);
}

/* select 드롭다운 화살표 SVG */
export const selectArrow = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`;

/* 네이티브 select 기본 스타일 */
export const selectBase: CSSProperties = {
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundImage: selectArrow,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 6px center",
};

/* 숫자 입력 필드 스타일 (val: 현재값, h: 높이) */
export const numInput = (val: string | number, h = 30): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  padding: "4px 6px",
  fontSize: F.sm,
  border: val ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
  borderRadius: 5,
  outline: "none",
  height: h,
  boxSizing: "border-box",
  background: C.slate100,
});

/* 초기화 버튼 스타일 */
export const resetBtn = (h = 30): CSSProperties => ({
  background: C.slate100,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  padding: "0 6px",
  fontSize: F.sm,
  color: C.muted,
  cursor: "pointer",
  height: h,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});

/* 물결표(~) 구분자 */
export const tilde: CSSProperties = { fontSize: F.micro, color: C.muted, flexShrink: 0 };

/* 활성 필터 칩 */
export const chipStyle: CSSProperties = {
  fontSize: F.sm,
  padding: "3px 8px",
  borderRadius: 10,
  background: C.indigoLight,
  color: C.indigo,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
