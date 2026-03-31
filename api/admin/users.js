import { kv } from "@vercel/kv";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "GET", admin: true, rateLimit: "admin", handler: async (req, res) => {
  const status = req.query.status || "pending";
  const allowed = ["pending", "approved", "rejected", "suspended", "all"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: "잘못된 상태 필터입니다" });
  }

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
}});
