import { kv } from "../_lib/redis.js";
import { verifyToken, createToken, createRefreshToken, verifyRefreshToken, isAdminEmail } from "../_lib/auth.js";
import { isBlacklisted, blacklistToken } from "../_lib/tokenBlacklist.js";
import { isUserAccessDenied } from "../_lib/userAccess.js";
import { withHandler } from "../_lib/handler.js";

type UserRecord = {
  email?: string;
  name?: string;
  status?: string;
  role?: string;
};

// 접근 거부 판정(user 부재 또는 rejected/pending/suspended)은 adminAuth 와 공유하는 단일 출처
// isUserAccessDenied(../_lib/userAccess) 를 쓴다 — 기준이 갈리면 강제 로그아웃이 한쪽만 먹힌다.

/** action=refresh → refresh token rotation (기존 /api/auth/refresh 통합) */
async function handleRefresh(req: any, res: any) {
  const { refreshToken } = (req.body ?? {}) as { refreshToken?: unknown };
  if (!refreshToken || typeof refreshToken !== "string") {
    return res.status(400).json({ ok: false, error: "refreshToken이 필요합니다" });
  }

  const payload = verifyRefreshToken(refreshToken);
  if (!payload || !payload.email) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 refresh token입니다" });
  }

  if (await isBlacklisted(refreshToken)) {
    return res.status(401).json({ ok: false, error: "무효화된 refresh token입니다" });
  }

  let user: UserRecord | null | undefined;
  try {
    user = (await kv.get(`user:${payload.email}`)) as UserRecord | null;
    if (isUserAccessDenied(user)) {
      return res.status(403).json({ ok: false, error: "접근 권한이 없습니다" });
    }
  } catch {
    return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }

  // 이전 refresh token 블랙리스트 (rotation)
  await blacklistToken(refreshToken, payload);

  // 세션 405: role 재발급 = ADMIN_EMAIL 파생 단일 출처 (레거시 expert record → "user" 강등).
  // handleVerify(아래)는 payload 에코만 — 잔존 expert 토큰은 만료 + consults admin 조임으로 무해.
  const role = isAdminEmail(payload.email) ? "admin" : "user";
  const isAdmin = role === "admin";
  const token = createToken(
    { email: payload.email, name: user?.name, ...(role !== "user" && { role }) },
    { ttl: isAdmin ? 3600000 : 86400000 }
  );
  const newRefreshToken = createRefreshToken(payload.email);

  res.json({ ok: true, token, refreshToken: newRefreshToken, user: { email: payload.email, name: user?.name }, role });
}

/** 기본: access token 검증 */
async function handleVerify(req: any, res: any) {
  const { token } = (req.body ?? {}) as { token?: unknown };
  if (!token || typeof token !== "string") {
    return res.status(400).json({ ok: false, error: "토큰이 필요합니다" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }

  if (await isBlacklisted(token)) {
    return res.status(401).json({ ok: false, error: "로그아웃된 토큰입니다" });
  }

  try {
    const user = (await kv.get(`user:${payload.email}`)) as UserRecord | null;
    if (isUserAccessDenied(user)) {
      return res.status(403).json({ ok: false, reason: "revoked", error: "접근 권한이 없습니다" });
    }
  } catch {
    return res.status(500).json({ ok: false, reason: "db_error", error: "서버 오류가 발생했습니다" });
  }

  res.json({
    ok: true,
    user: { email: payload.email, name: payload.name },
    ...(payload.role ? { role: payload.role } : {}),
  });
}

export default withHandler({ method: "POST", cors: {}, rateLimit: "verify", handler: async (req, res) => {
  const { action } = (req.body ?? {}) as { action?: unknown };
  if (action === "refresh") return handleRefresh(req, res);
  return handleVerify(req, res);
}});
