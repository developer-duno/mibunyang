/**
 * API 핸들러 응답 공통 타입 (M2 b-2).
 *
 * api/CLAUDE.md 의 "Supabase 연동 응답 형식" + withHandler 의 에러 응답 패턴 박제.
 * 모든 api/* 핸들러가 반환하는 JSON 구조의 공통 형식.
 */

/**
 * 성공 응답.
 *
 * @example
 *   { ok: true, data: [...], count: 1424, fetchedAt: "2026-05-03T12:00:00Z" }
 */
export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  data: T;
  count?: number;
  fetchedAt?: string;
  // 도메인별 추가 필드 (선택)
  [key: string]: unknown;
}

/**
 * 에러 응답.
 *
 * withHandler 의 405 (Method not allowed), 401 (관리자 인증), 429 (Rate limit) 모두 동일 형식.
 *
 * @example
 *   { ok: false, error: "관리자 인증이 필요합니다" }
 *   { ok: false, error: "요청이 너무 많습니다. 60초 후 다시 시도해주세요." }
 */
export interface ApiErrorResponse {
  ok: false;
  error: string;
  // 추가 필드 (예: code, details)
  [key: string]: unknown;
}

/**
 * 통합 응답 union — 핸들러 시그니처에 사용.
 *
 * @example
 *   async function handler(req, res): Promise<ApiResponse<Apt[]>> { ... }
 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Vercel Serverless Function 핸들러 시그니처 (간이).
 * `@vercel/node` 의 VercelRequest/VercelResponse 미사용 시 임시 사용.
 *
 * 정식 변환 시 (M2c-4) handler.ts 가 `@vercel/node` 임포트 추가 가능.
 */
export type ApiHandler = (_req: unknown, _res: unknown) => Promise<unknown> | unknown;
