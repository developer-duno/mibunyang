import { verifyToken } from "../_lib/auth.js";
import { blacklistToken } from "../_lib/tokenBlacklist.js";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "POST", cors: {}, rateLimit: "logout", handler: async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    return res.status(400).json({ ok: false, error: "토큰이 필요합니다" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    // 이미 만료/무효 토큰 — 멱등성 보장
    return res.json({ ok: true, message: "로그아웃되었습니다" });
  }

  await blacklistToken(token, payload);
  res.json({ ok: true, message: "로그아웃되었습니다" });
}});
