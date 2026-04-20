import { kv } from "../_lib/redis.js";
import { verifyToken, createToken, createRefreshToken, verifyRefreshToken } from "../_lib/auth.js";
import { isBlacklisted, blacklistToken } from "../_lib/tokenBlacklist.js";
import { withHandler } from "../_lib/handler.js";

// action=refresh → refresh token rotation (기존 /api/auth/refresh 통합)
async function handleRefresh(req, res) {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ ok: false, error: "refreshToken이 필요합니다" });
  }

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 refresh token입니다" });
  }

  if (await isBlacklisted(refreshToken)) {
    return res.status(401).json({ ok: false, error: "무효화된 refresh token입니다" });
  }

  let user;
  try {
    user = await kv.get(`user:${payload.email}`);
    if (!user || user.status === "rejected" || user.status === "pending" || user.status === "suspended") {
      return res.status(403).json({ ok: false, error: "접근 권한이 없습니다" });
    }
  } catch {
    return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }

  // 이전 refresh token 블랙리스트 (rotation)
  await blacklistToken(refreshToken, payload);

  const role = user.role || "user";
  const isAdmin = role === "admin";
  const token = createToken(
    { email: payload.email, name: user.name, ...(role !== "user" && { role }) },
    { ttl: isAdmin ? 3600000 : 86400000 }
  );
  const newRefreshToken = createRefreshToken(payload.email);

  res.json({ ok: true, token, refreshToken: newRefreshToken, user: { email: payload.email, name: user.name }, role });
}

// 기본: access token 검증
async function handleVerify(req, res) {
  const { token } = req.body || {};
  if (!token) {
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
    const user = await kv.get(`user:${payload.email}`);
    if (!user || user.status === "rejected" || user.status === "pending" || user.status === "suspended") {
      return res.status(403).json({ ok: false, reason: "revoked", error: "접근 권한이 없습니다" });
    }
  } catch {
    return res.status(500).json({ ok: false, reason: "db_error", error: "서버 오류가 발생했습니다" });
  }

  res.json({
    ok: true,
    user: { email: payload.email, name: payload.name },
    ...(payload.role && { role: payload.role }),
  });
}

export default withHandler({ method: "POST", cors: {}, rateLimit: "verify", handler: async (req, res) => {
  const { action } = req.body || {};
  if (action === "refresh") return handleRefresh(req, res);
  return handleVerify(req, res);
}});
