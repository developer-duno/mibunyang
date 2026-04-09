import { kv } from "@vercel/kv";
import { withHandler } from "../_lib/handler.js";

// action=stats → 통계 반환 (stats.js 통합 — Vercel Hobby 12함수 제한)
async function handleStats(req, res) {
  try {
    const [pendingC, approvedC, rejectedC, suspendedC] = await Promise.all([
      kv.scard("users:pending"), kv.scard("users:approved"),
      kv.scard("users:rejected"), kv.scard("users:suspended"),
    ]);
    const counts = {
      pending: pendingC || 0, approved: approvedC || 0,
      rejected: rejectedC || 0, suspended: suspendedC || 0,
      total: (pendingC || 0) + (approvedC || 0) + (rejectedC || 0) + (suspendedC || 0),
    };
    const [p, a, r, s] = await Promise.all([
      kv.smembers("users:pending"), kv.smembers("users:approved"),
      kv.smembers("users:rejected"), kv.smembers("users:suspended"),
    ]);
    const allEmails = [...new Set([...(p || []), ...(a || []), ...(r || []), ...(s || [])])];
    let kakaoCount = 0, expertCount = 0;
    const specialtyDist = {}, signupByDate = {};
    if (allEmails.length > 0) {
      const results = await Promise.allSettled(allEmails.map(email => kv.get(`user:${email}`)));
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const user = r.value;
        if (user.kakaoId || user.role === "user") kakaoCount++; else expertCount++;
        if (user.specialty) specialtyDist[user.specialty] = (specialtyDist[user.specialty] || 0) + 1;
        if (user.createdAt) {
          const created = new Date(user.createdAt).getTime();
          if (created >= fourteenDaysAgo) {
            const dateKey = new Date(user.createdAt).toISOString().slice(0, 10);
            signupByDate[dateKey] = (signupByDate[dateKey] || 0) + 1;
          }
        }
      }
    }
    const recentSignups = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      recentSignups.push({ date: dateKey, count: signupByDate[dateKey] || 0 });
    }
    res.json({ ok: true, counts, userTypes: { kakao: kakaoCount, expert: expertCount }, specialtyDist, recentSignups });
  } catch (err) {
    console.error("[admin/users?action=stats] error:", err.message);
    res.status(500).json({ ok: false, error: "통계 조회에 실패했습니다" });
  }
}

export default withHandler({ method: "GET", admin: true, rateLimit: "admin", handler: async (req, res) => {
  // 통계 분기
  if (req.query.action === "stats") return handleStats(req, res);

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
