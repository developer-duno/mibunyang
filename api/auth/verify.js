import { kv } from "@vercel/kv";
import { verifyToken } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { limited, retryAfter } = await checkRateLimit(req, "verify");
  if (limited) {
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ ok: false, error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
  }

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
}
