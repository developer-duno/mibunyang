/**
 * Upcoming(베타) 도메인 타입 묶음 (M3e).
 *
 * /api/upcoming 응답 + 컴포넌트 공유 타입.
 * 큰 컴포넌트(UpcomingPage 207 / UpcomingCardList 216 / HeaderSection 212)는 별도 .types.ts 분리.
 */

/**
 * 분양 단계 — DB 의 presaleStage 값.
 */
export type PresaleStage = "분양계획" | "청약중" | "분양중";

/**
 * 캘린더 이벤트 종류 — spec § 6-1 4색 매핑.
 */
export type CalendarEventType = "presale_announce" | "apply_start" | "apply_end" | "winner_announce" | "etc";

/**
 * /api/upcoming 응답의 단지 항목.
 */
export interface UpcomingApt {
  id: string;
  name: string;
  region?: string;
  gu?: string;
  presaleStage?: PresaleStage | string;
  presaleType?: string | null;
  presaleHousingType?: string | null;
  presaleMinPrice?: number | null;
  presaleRecruitDate?: string | null;
  presaleImageUrl?: string | null;
  catsCache?: { total?: number } | null;
  // 그 외 필드는 동적
  [key: string]: unknown;
}

/**
 * 캘린더 데이터 — { "YYYY-MM-DD": [{ id, event }] }.
 */
export interface CalendarEvent {
  id: string;
  event: CalendarEventType | string;
}

export type CalendarData = Record<string, CalendarEvent[]>;

/**
 * /api/upcoming 응답 본문.
 */
export interface UpcomingApiResponse {
  ok: boolean;
  error?: string;
  stages: {
    plan: UpcomingApt[];
    apply: UpcomingApt[];
    sale: UpcomingApt[];
  };
  totals: {
    plan: number;
    apply: number;
    sale: number;
  };
  calendar?: CalendarData;
}

/**
 * UpcomingCalendar props (77줄).
 */
export interface UpcomingCalendarProps {
  calendar: CalendarData | null | undefined;
  selectedDate: string | null;
  onDayClick: (_day: Date | undefined) => void;
}

/**
 * BottomNav props (44줄).
 */
export interface BottomNavProps {
  tab: string;
  /** 관리자 네비 분기 (세션 405 — 구 expertLoggedIn 토큰 축에서 role 축으로 교체) */
  adminLoggedIn: boolean;
  showComp: boolean;
  onNavClick: (_key: string) => void;
  containerMaxWidth: number;
  isDesktop: boolean;
}
