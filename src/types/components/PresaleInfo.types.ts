/**
 * PresaleInfo 컴포넌트 props 타입 (M3d).
 *
 * PresaleInfo.jsx L12:
 *   memo(function PresaleInfo({ apt }))
 */
import type { Apt } from "@/types/scoring";

export interface PresaleInfoProps {
  apt: Apt;
  /** 지난 일정 「끝남」 판정의 지금 시각(KST 날짜로 본다) — 시험이 고정한다. 기본 = 지금 */
  now?: Date;
}
