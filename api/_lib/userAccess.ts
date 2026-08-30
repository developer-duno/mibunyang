/**
 * 사용자 KV 레코드 접근 거부 판정 — 단일 출처 (세션 534 S0).
 *
 * verify.ts(handleVerify·handleRefresh)와 adminAuth.ts(verifyAdminToken·requireAdminGate)가
 * 공유한다. 두 곳이 서로 다른 기준을 쓰면 admin 강제 로그아웃(review.ts: status→"suspended")이
 * 한쪽에서만 먹히므로 반드시 같은 함수를 통과시킨다.
 *
 * 거부 = user 부재(!user) 또는 status ∈ {rejected, pending, suspended}.
 * ⚠️ kakao.ts 는 pending 을 statusCode:"PENDING" 으로 따로 처리하므로 이 헬퍼와 합치지 않는다.
 */
export type UserAccessRecord = { status?: string } | null | undefined;

export function isUserAccessDenied(user: UserAccessRecord): boolean {
  return !user || user.status === "rejected" || user.status === "pending" || user.status === "suspended";
}
