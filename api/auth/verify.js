import { kv } from "@vercel/kv";
import { verifyToken } from "../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.json({ ok: false });
  }

  const isAdmin = payload.role === "admin";

  if (!isAdmin) {
    try {
      const user = await kv.get(`user:${payload.email}`);
      if (!user || user.status === "rejected" || user.status === "pending") {
        return res.json({ ok: false, reason: "revoked" });
      }
    } catch {
      return res.json({ ok: false, reason: "db_error" });
    }
  }

  res.json({
    ok: true,
    user: { email: payload.email, name: payload.name },
    ...(payload.role && { role: payload.role }),
  });
}
