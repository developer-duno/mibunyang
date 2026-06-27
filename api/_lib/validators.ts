// RFC 5322 에 느슨하게 맞춘 이메일 정규식 — auth/signup·login·admin/review 공용
// 정책: 길이 <=254, 한 글자 TLD 금지, 공백·제어문자 금지
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

/** limit/offset 쿼리 파라미터 파싱 + 클램프 — consults·admin/users 공용.
 *  query 값이 배열이면 첫 요소 사용, 파싱 실패 시 defaultLimit/offset 0.
 *  limit 은 [1, maxLimit] 로 클램프, offset 은 0 이상. */
export function parsePagination(
  query: Record<string, unknown> | undefined,
  opts: { defaultLimit: number; maxLimit: number },
): { limit: number; offset: number } {
  const q = query ?? {};
  const limitRaw = Array.isArray(q.limit) ? q.limit[0] : q.limit;
  const offsetRaw = Array.isArray(q.offset) ? q.offset[0] : q.offset;
  const limit = Math.min(Math.max(parseInt(String(limitRaw ?? "")) || opts.defaultLimit, 1), opts.maxLimit);
  const offset = Math.max(parseInt(String(offsetRaw ?? "")) || 0, 0);
  return { limit, offset };
}
