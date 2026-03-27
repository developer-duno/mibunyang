import { memo } from "react";

const I = (name, d, opts = {}) =>
  memo(function Icon({ size = 16, color = "currentColor" }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={opts.fill ? "none" : color} strokeWidth={opts.sw || 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {typeof d === "string" ? <path d={d} fill={opts.fill ? color : "none"} /> : d(color)}
      </svg>
    );
  });

/** ✕ 닫기 */
export const IconClose = I("Close", "M18 6L6 18M6 6l12 12");

/** 돋보기 검색 */
export const IconSearch = I("Search", (c) => (<><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></>));

/** ? 도움말 */
export const IconHelp = I("Help", (c) => (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><circle cx="12" cy="17" r="0.5" fill={c} stroke="none" /></>));

/** 핀 위치 */
export const IconLocation = I("Location", (c) => (<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></>));

/** 하트 (빈) */
export const IconHeart = I("Heart", "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z");

/** 하트 (채움) */
export const IconHeartFilled = I("HeartFilled", "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z", { fill: true });

/** 비교 (좌우 화살표) */
export const IconCompare = I("Compare", (c) => (<><path d="M16 3l4 4-4 4" /><path d="M20 7H4" /><path d="M8 21l-4-4 4-4" /><path d="M4 17h16" /></>));

/** 공유 */
export const IconShare = I("Share", (c) => (<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" /></>));

/** 아래 화살표 */
export const IconChevronDown = I("ChevronDown", "M6 9l6 6 6-6");
