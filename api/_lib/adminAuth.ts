import { verifyToken, type AuthPayload } from "./auth.js";
import { isBlacklisted } from "./tokenBlacklist.js";

type ReqLike = {
  headers: { authorization?: string };
};

export async function verifyAdminToken(req: ReqLike): Promise<AuthPayload | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload || payload.role !== "admin") return null;
  if (await isBlacklisted(token)) return null;
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
  return { ok: true, payload };
}
