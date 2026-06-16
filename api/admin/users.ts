import { kv } from "../_lib/redis.js";
import { withHandler } from "../_lib/handler.js";

type UserRecord = {
  email?: string;
  name?: string;
  affiliation?: string;
  specialty?: string;
  role?: string;
  kakaoId?: string;
  phoneNumber?: string | null;
  consentMarketing?: boolean | null;
  createdAt?: string;
  passwordHash?: string;
  salt?: string;
  [k: string]: unknown;
};

async function handleStats(_req: any, res: any) {
  try {
    const [pendingC, approvedC, rejectedC, suspendedC, marketingConsentC] = await Promise.all([
      kv.scard("users:pending"), kv.scard("users:approved"),
      kv.scard("users:rejected"), kv.scard("users:suspended"),
      kv.scard("users:consent_marketing"),
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
    let kakaoCount = 0, expertCount = 0, phoneCount = 0;
    const specialtyDist: Record<string, number> = {};
    const signupByDate: Record<string, number> = {};
    if (allEmails.length > 0) {
      const results = await Promise.allSettled(allEmails.map(email => kv.get(`user:${email}`)));
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const user = r.value as UserRecord;
        if (user.kakaoId || user.role === "user") kakaoCount++; else expertCount++;
        if (user.phoneNumber) phoneCount++;
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
    res.json({ ok: true, counts, userTypes: { kakao: kakaoCount, expert: expertCount }, marketing: { consent: marketingConsentC || 0, withPhone: phoneCount }, specialtyDist, recentSignups });
  } catch (err) {
    console.error("[admin/users?action=stats] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: "통계 조회에 실패했습니다" });
  }
}

export default withHandler({ method: "GET", admin: true, rateLimit: "admin", handler: async (req, res) => {
  const query = req.query ?? {};
  if (query.action === "stats") return handleStats(req, res);

  const statusRaw = query.status ?? "pending";
  const status = Array.isArray(statusRaw) ? String(statusRaw[0]) : String(statusRaw);
  const allowed = ["pending", "approved", "rejected", "suspended", "all"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: "잘못된 상태 필터입니다" });
  }
  const q = typeof query.q === "string" ? query.q.trim().substring(0, 100).toLowerCase() : "";
  const limitRaw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const offsetRaw = Array.isArray(query.offset) ? query.offset[0] : query.offset;
  const limit = Math.min(Math.max(parseInt(String(limitRaw ?? "")) || 20, 1), 100);
  const offset = Math.max(parseInt(String(offsetRaw ?? "")) || 0, 0);

  try {
    let emails: string[] = [];
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
        const user = (await kv.get(`user:${email}`)) as UserRecord | null;
        if (!user) return null;
        const { passwordHash: _ph, salt: _s, ...safe } = user;
        return safe as UserRecord;
      })
    );
    const users = results
      .filter((r): r is PromiseFulfilledResult<UserRecord> => r.status === "fulfilled" && !!r.value)
      .map(r => r.value);

    const sorted = users.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const filtered = q
      ? sorted.filter(u => [u.name, u.email, u.affiliation, u.specialty].some(f => f && String(f).toLowerCase().includes(q)))
      : sorted;
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    res.json({ ok: true, users: paged, total });
  } catch (err) {
    console.error("[admin/users] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
