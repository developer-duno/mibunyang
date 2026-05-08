// @ts-check
import { verifyToken, verifyRefreshToken } from "../_lib/auth.js";
import { blacklistToken } from "../_lib/tokenBlacklist.js";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "POST", cors: {}, rateLimit: "logout", handler: async (req, res) => {
  const { token, refreshToken } = /** @type {{ token?: unknown, refreshToken?: unknown }} */ (req.body ?? {});
  if (!token || typeof token !== "string") {
    return res.status(400).json({ ok: false, error: "토큰이 필요합니다" });
  }

  // access token 블랙리스트
  const payload = verifyToken(token);
  if (payload) await blacklistToken(token, payload);

  // refresh token도 블랙리스트 (있으면)
  if (refreshToken && typeof refreshToken === "string") {
    const rtPayload = verifyRefreshToken(refreshToken);
    if (rtPayload) await blacklistToken(refreshToken, rtPayload);
  }

  res.json({ ok: true, message: "로그아웃되었습니다" });
}});
