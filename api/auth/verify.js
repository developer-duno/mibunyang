import { kv } from "@vercel/kv";
import { verifyToken } from "../_lib/auth.js";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "POST", cors: {}, rateLimit: "verify", handler: async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false, error: "토큰이 필요합니다" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }

  try {
    const user = await kv.get(`user:${payload.email}`);
    if (!user || user.status === "rejected" || user.status === "pending") {
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
}});
