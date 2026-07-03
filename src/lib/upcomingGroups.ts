// 곧 분양 카드 시간축 그룹핑 (세션 469 PR2)
// 벤치마킹 확정안: 큰 월 그리드 대신 "D-day 임박 → N월 예정" 아젠다 리스트.
// 데이터가 월-only(YYYY-MM, 일자 미상)가 많아 거짓 날짜 없이 "N월 예정" 그룹으로 표현.

import type { UpcomingApt } from "@/types/upcoming";

/** recruitDate 가 월-only(YYYY-MM / YYYY.MM, 일자 없음)인지 */
export function isMonthOnly(recruitDate: string | null | undefined): boolean {
  if (!recruitDate || typeof recruitDate !== "string") return false;
  return /^\d{4}[.-]\d{2}$/.test(recruitDate.trim());
}

/** recruitDate → "YYYY-MM" 월 키. 파싱 불가면 null. (일자 있으면 앞 7자, 월-only면 그대로) */
export function monthKey(recruitDate: string | null | undefined): string | null {
  if (!recruitDate || typeof recruitDate !== "string") return null;
  const s = recruitDate.trim().replace(/\./g, "-");
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** "YYYY-MM" → "N월 예정" 라벨 (연도가 올해와 다르면 "YYYY년 N월 예정") */
export function monthLabel(key: string, thisYear: number): string {
  const [y, mo] = key.split("-");
  const month = Number(mo);
  return Number(y) === thisYear ? `${month}월 예정` : `${y}년 ${month}월 예정`;
}

export interface UpcomingGroup {
  /** "imminent" = D-day 임박(일정 확정) / "month:YYYY-MM" = 월 예정 / "etc" = 미상 */
  key: string;
  label: string;
  items: UpcomingApt[];
}

/**
 * 카드 items 를 시간축 그룹으로 나눈다.
 * - 임박 그룹: 일자 확정(monthOnly 아님) + 오늘~7일 이내(D-7 이상). 임박 순(가까운 날 먼저).
 * - 월 그룹: 그 외 미래 월(월-only 포함). 이번 달 이후 오름차순 먼저, 과거 월은 뒤로.
 * - 기타 그룹: 날짜 파싱 불가(미정 등). 원래 순서.
 * @param items /api/upcoming 카드 배열
 * @param today 기준일 (테스트 주입용)
 */
export function groupUpcoming(items: UpcomingApt[], today: Date = new Date()): UpcomingGroup[] {
  const todayMid = new Date(today);
  todayMid.setHours(0, 0, 0, 0);
  const thisMonthKey = `${todayMid.getFullYear()}-${String(todayMid.getMonth() + 1).padStart(2, "0")}`;
  const thisYear = todayMid.getFullYear();

  const imminent: Array<{ apt: UpcomingApt; days: number }> = [];
  const byMonth = new Map<string, UpcomingApt[]>();
  const etc: UpcomingApt[] = [];

  for (const apt of items) {
    const rd = apt.presaleRecruitDate;
    const mk = monthKey(rd);
    if (!mk) {
      etc.push(apt);
      continue;
    }
    // 일자 확정 + 임박(오늘~7일) → 임박 그룹
    if (!isMonthOnly(rd)) {
      const d = new Date(String(rd).replace(/\./g, "-"));
      if (!isNaN(d.getTime())) {
        d.setHours(0, 0, 0, 0);
        const days = Math.round((d.getTime() - todayMid.getTime()) / 86400000);
        if (days >= 0 && days <= 7) {
          imminent.push({ apt, days });
          continue;
        }
      }
    }
    byMonth.set(mk, [...(byMonth.get(mk) ?? []), apt]);
  }

  const groups: UpcomingGroup[] = [];
  if (imminent.length) {
    imminent.sort((a, b) => a.days - b.days);
    groups.push({ key: "imminent", label: "🔥 청약 임박", items: imminent.map((x) => x.apt) });
  }
  // 월 그룹: 이번 달 이후 오름차순 먼저, 과거 월은 뒤로
  const monthKeys = [...byMonth.keys()].sort();
  const futureMonths = monthKeys.filter((k) => k >= thisMonthKey);
  const pastMonths = monthKeys.filter((k) => k < thisMonthKey);
  for (const k of [...futureMonths, ...pastMonths]) {
    groups.push({ key: `month:${k}`, label: `📆 ${monthLabel(k, thisYear)}`, items: byMonth.get(k) ?? [] });
  }
  if (etc.length) {
    groups.push({ key: "etc", label: "📋 일정 미정", items: etc });
  }
  return groups;
}
