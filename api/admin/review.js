import { kv } from "@vercel/kv";
import { withHandler } from "../_lib/handler.js";

export default withHandler({ method: "POST", admin: true, rateLimit: "admin", handler: async (req, res) => {
  const { email, action, note } = req.body || {};
  if (!email || typeof email !== "string" || !["approve", "reject", "force-logout"].includes(action)) {
    return res.status(400).json({ ok: false, error: "이메일과 승인/거부/강제로그아웃 액션이 필요합니다" });
  }

  try {
    const key = `user:${email.toLowerCase().trim()}`;
    const user = await kv.get(key);
    if (!user) {
      return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다" });
    }

    const newStatus = action === "force-logout" ? "suspended" : action === "approve" ? "approved" : "rejected";
    const oldStatus = user.status ?? "pending";

    const emailNorm = email.toLowerCase().trim();
    const defaultNote = action === "force-logout" ? "관리자 강제 로그아웃" : null;
    const updatedUser = {
      ...user,
      status: newStatus,
      reviewedAt: new Date().toISOString(),
      reviewNote: (note || "").trim() || defaultNote,
    };

    // 집합 먼저 업데이트 (실패 시 해시 변경 없이 안전)
    try {
      await kv.sadd(`users:${newStatus}`, emailNorm);
      if (oldStatus !== newStatus) {
        await kv.srem(`users:${oldStatus}`, emailNorm);
      }
    } catch (setErr) {
      // sadd 성공 후 srem 실패 시 복원
      try { await kv.srem(`users:${newStatus}`, emailNorm); } catch { /* best-effort */ }
      throw setErr;
    }

    // 집합 성공 후 해시 업데이트
    try {
      await kv.set(key, updatedUser);
    } catch (hashErr) {
      // 해시 업데이트 실패 시 집합 복원
      try {
        await kv.srem(`users:${newStatus}`, emailNorm);
        if (oldStatus !== newStatus) await kv.sadd(`users:${oldStatus}`, emailNorm);
      } catch { /* best-effort */ }
      throw hashErr;
    }

    const MSG = { approve: "승인되었습니다", reject: "거부되었습니다", "force-logout": "강제 로그아웃 처리되었습니다" };
    res.json({ ok: true, message: MSG[action] });
  } catch (err) {
    console.error("[admin/review] error:", err.message);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
