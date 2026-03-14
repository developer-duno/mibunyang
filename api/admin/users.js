import { kv } from "@vercel/kv";
import { verifyAdminToken } from "../_lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!verifyAdminToken(req)) {
    return res.status(401).json({ ok: false, error: "관리자 인증이 필요합니다" });
  }

  const status = req.query.status || "pending";
  const allowed = ["pending", "approved", "rejected", "all"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: "잘못된 상태 필터입니다" });
  }

  try {
    let emails = [];
    if (status === "all") {
      const [p, a, r] = await Promise.all([
        kv.smembers("users:pending"),
        kv.smembers("users:approved"),
        kv.smembers("users:rejected"),
      ]);
      emails = [...new Set([...(p || []), ...(a || []), ...(r || [])])];
    } else {
      emails = (await kv.smembers(`users:${status}`)) || [];
    }

    if (emails.length === 0) {
      return res.json({ ok: true, users: [] });
    }

    const results = await Promise.allSettled(
      emails.map(async (email) => {
        const user = await kv.get(`user:${email}`);
        if (!user) return null;
        const { passwordHash, salt, ...safe } = user;
        return safe;
      })
    );
    const users = results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);

    const sorted = users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, users: sorted });
  } catch (err) {
    console.error("[admin/users] error:", err.message);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}
