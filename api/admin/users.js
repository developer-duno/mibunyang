import { kv } from "@vercel/kv";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "GET", admin: true, rateLimit: "admin", handler: async (req, res) => {
  const status = req.query.status || "pending";
  const allowed = ["pending", "approved", "rejected", "suspended", "all"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: "잘못된 상태 필터입니다" });
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().substring(0, 100).toLowerCase() : "";
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  try {
    let emails = [];
    if (status === "all") {
      const [p, a, r, s] = await Promise.all([
        kv.smembers("users:pending"),
        kv.smembers("users:approved"),
        kv.smembers("users:rejected"),
        kv.smembers("users:suspended"),
      ]);
      emails = [...new Set([...(p || []), ...(a || []), ...(r || []), ...(s || [])])];
    } else {
      emails = (await kv.smembers(`users:${status}`)) || [];
    }

    if (emails.length === 0) {
      return res.json({ ok: true, users: [], total: 0 });
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
    const filtered = q
      ? sorted.filter(u => [u.name, u.email, u.affiliation, u.specialty].some(f => f && String(f).toLowerCase().includes(q)))
      : sorted;
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    res.json({ ok: true, users: paged, total });
  } catch (err) {
    console.error("[admin/users] error:", err.message);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
