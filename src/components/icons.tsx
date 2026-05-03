import { memo, type ReactNode } from "react";

type IconProps = { size?: number; color?: string };
type IconPath = string | ((_color: string) => ReactNode);
type IconOpts = { fill?: boolean; sw?: number };

const I = (_name: string, d: IconPath, opts: IconOpts = {}) =>
  memo(function Icon({ size = 16, color = "currentColor" }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={opts.fill ? "none" : color} strokeWidth={opts.sw || 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {typeof d === "string" ? <path d={d} fill={opts.fill ? color : "none"} /> : d(color)}
      </svg>
    );
  });

/** ✕ 닫기 */
export const IconClose = I("Close", "M18 6L6 18M6 6l12 12");

/** ? 도움말 */
export const IconHelp = I("Help", (c) => (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><circle cx="12" cy="17" r="0.5" fill={c} stroke="none" /></>));

/** 하트 (빈) */
export const IconHeart = I("Heart", "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z");

/** 하트 (채움) */
export const IconHeartFilled = I("HeartFilled", "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z", { fill: true });

/** 아래 화살표 */
export const IconChevronDown = I("ChevronDown", "M6 9l6 6 6-6");
