import { kv } from "@vercel/kv";
import { verifyAdminToken } from "../_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!verifyAdminToken(req)) {
    return res.status(401).json({ ok: false, error: "관리자 인증이 필요합니다" });
  }

  const { email, action, note } = req.body || {};
  if (!email || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ ok: false, error: "이메일과 승인/거부 액션이 필요합니다" });
  }

  try {
    const key = `user:${email.toLowerCase().trim()}`;
    const user = await kv.get(key);
    if (!user) {
      return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다" });
    }

    const newStatus = action === "approve" ? "approved" : "rejected";
    const oldStatus = user.status || "pending";

    await kv.set(key, {
      ...user,
      status: newStatus,
      reviewedAt: new Date().toISOString(),
      reviewNote: (note || "").trim() || null,
    });

    const emailNorm = email.toLowerCase().trim();
    if (oldStatus && oldStatus !== newStatus) {
      await kv.srem(`users:${oldStatus}`, emailNorm);
    }
    await kv.sadd(`users:${newStatus}`, emailNorm);

    res.json({ ok: true, message: action === "approve" ? "승인되었습니다" : "거부되었습니다" });
  } catch (err) {
    console.error("[admin/review] error:", err.message);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}
