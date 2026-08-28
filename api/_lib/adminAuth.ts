import { verifyToken, type AuthPayload } from "./auth.js";
import { isBlacklisted } from "./tokenBlacklist.js";
import { kv } from "./redis.js";
import { isUserAccessDenied } from "./userAccess.js";

type ReqLike = {
  headers: { authorization?: string };
};

/**
 * KV user:{email} 레코드 status 가 접근 거부 상태인지 확인 (세션 534 S0).
 *
 * review.ts force-logout(status→"suspended")이 유효한 admin JWT(최대 1h)를 즉시 무력화하려면
 * 서명·role·블랙리스트뿐 아니라 KV status 를 매 요청 재확인해야 한다. 기준은 verify.ts 와
 * 공유하는 isUserAccessDenied 단일 출처 — 갈리면 강제 로그아웃이 한쪽만 먹힌다.
 *
 * 반환 = "거부해야 하면 true". KV 순단 시 fail-open(false) — 블랙리스트 계층(isBlacklisted)과
 * 동일 정책(availability 우선, JWT 만료가 1차 경계). suspended admin 이 통과하는 창은
 * 블랙리스트 fail-open 창과 동일하고 JWT TTL 로 상한된다.
 */
async function isAdminAccessRevoked(email: string | undefined): Promise<boolean> {
  try {
    const user = (await kv.get(`user:${email}`)) as { status?: string } | null;
    return isUserAccessDenied(user);
  } catch {
    return false; // KV 순단 → fail-open
  }
}

export async function verifyAdminToken(req: ReqLike): Promise<AuthPayload | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload || payload.role !== "admin") return null;
  if (await isBlacklisted(token)) return null;
  if (await isAdminAccessRevoked(payload.email)) return null;
  return payload;
}

/** admin 게이트 단계별 응답을 보존하는 판정 결과 (consults handleGet/handleDelete 동일 게이트 공유용).
 *  실패 시 호출처가 status/error 를 그대로 반환 — 단계별 메시지·코드 유지 (handler.ts admin 미들웨어의
 *  generic 401 과 달리 consults 는 단계별 메시지를 노출하므로 verifyAdminToken 으로 합치면 동작이 바뀜). */
export type AdminGateResult =
  | { ok: true; payload: AuthPayload }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdminGate(req: ReqLike): Promise<AdminGateResult> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "인증이 필요합니다" };
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return { ok: false, status: 401, error: "유효하지 않은 토큰입니다" };
  }
  if (await isBlacklisted(token)) {
    return { ok: false, status: 401, error: "로그아웃된 토큰입니다" };
  }
  if (payload.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (await isAdminAccessRevoked(payload.email)) {
    return { ok: false, status: 403, error: "접근 권한이 없습니다" };
  }
  return { ok: true, payload };
}
