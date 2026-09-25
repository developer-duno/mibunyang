/**
 * 손님 "의견 보내기" 종류 — 단일 출처 (세션574).
 *
 * 화면(FeedbackForm 라디오)·관리자 목록(AdminFeedback 배지)·텔레그램 알림(api/_lib/telegram)·
 * API 검증(api/feedback.ts)이 모두 이 표 하나를 쓴다. 코드값은 DB `site_feedback.kind` CHECK 와 같아야 한다
 * (supabase/migrations/20260925000000_site_feedback.sql) — 종류를 늘리면 마이그도 함께 바꾼다.
 *
 * ⚠️ api/ 가 이 파일을 import 한다(api/feedback.ts) — 여기에 브라우저 전용 import(@/theme 등)를 넣지 않는다.
 */
export const FEEDBACK_KINDS = [
  { code: "bug", label: "버그·오류" },
  { code: "data", label: "정보가 틀려요" },
  { code: "suggest", label: "건의·제안" },
  { code: "other", label: "기타" },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["code"];

/** 코드 → 라벨. 모르는 코드는 원문 그대로 돌려준다(관리자 화면에서 빈칸이 되지 않게). */
export function feedbackKindLabel(code: string): string {
  return FEEDBACK_KINDS.find((k) => k.code === code)?.label ?? code;
}

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return typeof v === "string" && FEEDBACK_KINDS.some((k) => k.code === v);
}

/** 내용 글자 수 — 서버는 1~1000(DB CHECK 와 같음), 화면은 최소 10자부터 보내기를 연다. */
export const FEEDBACK_MESSAGE_MAX = 1000;
export const FEEDBACK_MESSAGE_MIN_UI = 10;
