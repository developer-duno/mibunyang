import { BRAND_TIER, resolveBuilder } from "@/constants/brands";

/** 현재 연월 "YYYYMM" (AptCard.NOW_YM과 동일) */
const NOW_YM = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;

/* ── 분류 헬퍼 (filterOptionCounts + filtered 공용) ── */

/** 입주 상태 분류: "입주예정" | "미입주" | "입주완료" | null */
export function classifyMoveIn(apt) {
  if (!apt.completion) return null;
  if (apt.completion >= NOW_YM) return "입주예정";
  if ((apt.unsoldRate ?? 0) > 0) return "미입주";
  return "입주완료";
}

/** 시공사 등급 분류: "1군" | "2군" | "기타" */
export function classifyTier(apt) {
  const b = resolveBuilder(apt.builder);
  const t = BRAND_TIER[b]?.tier;
  if (t === "1군Super" || t === "1군") return "1군";
  if (t === "2군") return "2군";
  return "기타";
}
