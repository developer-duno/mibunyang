import { BRAND_TIER, resolveBuilder } from "@/constants/brands";
import type { Apt } from "@/types/scoring";

/** 현재 연월 "YYYYMM" (AptCard·moveInSoon 정렬 공용 단일 출처) */
export const NOW_YM = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;

/* ── 분류 상수 (단일 진실 원천) ── */

/** 입주 상태 레이블 */
export const MOVEIN_STATUS = {
  SCHEDULED: "입주예정",
  NOT_MOVED: "미입주",
  COMPLETED: "입주완료",
} as const;
/** 입주 상태 값 배열 (필터 UI, 카운트 초기화 등에 사용) */
export const MOVEIN_VALUES: string[] = Object.values(MOVEIN_STATUS);

/** 시공사 등급 레이블 */
export const TIER_LABELS = {
  TIER1: "1군",
  TIER2: "2군",
  ETC: "기타",
} as const;
/** 시공사 등급 값 배열 */
export const TIER_VALUES: string[] = Object.values(TIER_LABELS);

/* ── 분류 헬퍼 (filterOptionCounts + filtered 공용) ── */

/** 입주 상태 분류: "입주예정" | "미입주" | "입주완료" | null */
export function classifyMoveIn(apt: Apt): string | null {
  if (!apt.completion) return null;
  if (apt.completion >= NOW_YM) return MOVEIN_STATUS.SCHEDULED;
  // 미입주 판정은 unsold(수)로 — unsoldRate 는 100% 초과 폭발값이 null 로 무력화돼 있을 수 있어
  //   미분양 단지가 입주완료로 오분류되던 회귀 방지 (세션 445). 단지 잔여 미분양이 남았으면 미입주.
  if ((apt.unsold ?? 0) > 0) return MOVEIN_STATUS.NOT_MOVED;
  return MOVEIN_STATUS.COMPLETED;
}

/** 시공사 등급 분류: "1군" | "2군" | "기타" */
export function classifyTier(apt: Apt): string {
  const b = resolveBuilder(apt.builder);
  const tierMap = BRAND_TIER as Record<string, { tier?: string } | undefined>;
  const t = tierMap[b as string]?.tier;
  if (t === "1군Super" || t === "1군") return TIER_LABELS.TIER1;
  if (t === "2군") return TIER_LABELS.TIER2;
  return TIER_LABELS.ETC;
}
