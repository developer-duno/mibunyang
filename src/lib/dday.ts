import { C } from "@/theme";
import type { DdayInfo } from "@/types/components/UpcomingCardList.types";

/**
 * D-day 계산 — spec § 6-2 (UpcomingCardList 에서 이동, 세션 404 M1)
 */
export function computeDday(recruitDate: string | null | undefined, today: Date = new Date()): DdayInfo | null {
  if (!recruitDate || typeof recruitDate !== "string") return null;
  const d = new Date(recruitDate);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0);
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < -7) return null; // 1주 이상 지난 단지는 D-day 표시 X
  if (days < 0) return { label: `D+${Math.abs(days)}`, color: C.muted };
  if (days === 0) return { label: "오늘 청약", color: C.red };
  if (days <= 3) return { label: `D-${days}`, color: C.amber };
  if (days <= 7) return { label: `D-${days}`, color: C.text };
  return { label: `D-${days}`, color: C.muted };
}
