import { kv } from "@vercel/kv";
import { createToken, createRefreshToken, verifyRefreshToken } from "../_lib/auth.js";
import { isBlacklisted, blacklistToken } from "../_lib/tokenBlacklist.js";
import { withHandler } from "../_lib/handler.js";

// refresh token으로 새 access token + refresh token 발급 (rotation)
export default withHandler({ method: "POST", cors: {}, rateLimit: "verify", handler: async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ ok: false, error: "refreshToken이 필요합니다" });
  }

  // refresh token 검증
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 refresh token입니다" });
  }

  // 블랙리스트 확인
  if (await isBlacklisted(refreshToken)) {
    return res.status(401).json({ ok: false, error: "무효화된 refresh token입니다" });
  }

  // 사용자 상태 확인
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

  // 새 토큰 발급
  const role = user.role || "user";
  const isAdmin = role === "admin";
  const token = createToken(
    { email: payload.email, name: user.name, ...(role !== "user" && { role }) },
    { ttl: isAdmin ? 3600000 : 86400000 }
  );
  const newRefreshToken = createRefreshToken(payload.email);

  res.json({ ok: true, token, refreshToken: newRefreshToken, user: { email: payload.email, name: user.name }, role });
}});
