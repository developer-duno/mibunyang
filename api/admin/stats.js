import { kv } from "@vercel/kv";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "GET", admin: true, rateLimit: "admin", handler: async (req, res) => {
  try {
    // 상태별 카운트 (scard O(1))
    const [pendingC, approvedC, rejectedC, suspendedC] = await Promise.all([
      kv.scard("users:pending"),
      kv.scard("users:approved"),
      kv.scard("users:rejected"),
      kv.scard("users:suspended"),
    ]);
    const counts = {
      pending: pendingC || 0,
      approved: approvedC || 0,
      rejected: rejectedC || 0,
      suspended: suspendedC || 0,
      total: (pendingC || 0) + (approvedC || 0) + (rejectedC || 0) + (suspendedC || 0),
    };

    // 전체 사용자 스캔 (유형 분류 + 전문분야 + 가입 추이)
    const [p, a, r, s] = await Promise.all([
      kv.smembers("users:pending"),
      kv.smembers("users:approved"),
      kv.smembers("users:rejected"),
      kv.smembers("users:suspended"),
    ]);
    const allEmails = [...new Set([...(p || []), ...(a || []), ...(r || []), ...(s || [])])];

    let kakaoCount = 0;
    let expertCount = 0;
    const specialtyDist = {};
    const signupByDate = {};

    if (allEmails.length > 0) {
      const results = await Promise.allSettled(
        allEmails.map(email => kv.get(`user:${email}`))
      );

      const now = Date.now();
      const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const user = r.value;

        // 카카오 vs 전문가 구분
        if (user.kakaoId || user.role === "user") {
          kakaoCount++;
        } else {
          expertCount++;
        }

        // 전문 분야 분포 (전문가만)
        if (user.specialty) {
          specialtyDist[user.specialty] = (specialtyDist[user.specialty] || 0) + 1;
        }

        // 최근 14일 가입 추이
        if (user.createdAt) {
          const created = new Date(user.createdAt).getTime();
          if (created >= fourteenDaysAgo) {
            const dateKey = new Date(user.createdAt).toISOString().slice(0, 10);
            signupByDate[dateKey] = (signupByDate[dateKey] || 0) + 1;
          }
        }
      }
    }

    // 최근 14일 타임라인 (빈 날짜 포함)
    const recentSignups = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      recentSignups.push({ date: dateKey, count: signupByDate[dateKey] || 0 });
    }

    res.json({
      ok: true,
      counts,
      userTypes: { kakao: kakaoCount, expert: expertCount },
      specialtyDist,
      recentSignups,
    });
  } catch (err) {
    console.error("[admin/stats] error:", err.message);
    res.status(500).json({ ok: false, error: "통계 조회에 실패했습니다" });
  }
}});
