import { kv } from "../_lib/redis.js";
import { withHandler } from "../_lib/handler.js";
import { isValidEmail } from "../_lib/validators.js";

type UserRecord = {
  status?: string;
  [k: string]: unknown;
};

async function reviewOne(emailRaw: string, action: string, note?: string) {
  const emailNorm = emailRaw.toLowerCase().trim();
  const key = `user:${emailNorm}`;
  const user = (await kv.get(key)) as UserRecord | null;
  if (!user) return { email: emailNorm, ok: false, error: "사용자를 찾을 수 없습니다" };

  const newStatus = action === "force-logout" ? "suspended" : action === "approve" ? "approved" : "rejected";
  const oldStatus = user.status ?? "pending";
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
    if (oldStatus !== newStatus) await kv.srem(`users:${oldStatus}`, emailNorm);
  } catch (setErr) {
    try { await kv.srem(`users:${newStatus}`, emailNorm); } catch { /* best-effort */ }
    throw setErr;
  }

  // 집합 성공 후 해시 업데이트
  try {
    await kv.set(key, updatedUser);
  } catch (hashErr) {
    try {
      await kv.srem(`users:${newStatus}`, emailNorm);
      if (oldStatus !== newStatus) await kv.sadd(`users:${oldStatus}`, emailNorm);
    } catch { /* best-effort */ }
    throw hashErr;
  }

  return { email: emailNorm, ok: true };
}

const MAX_BATCH = 50;

export default withHandler({ method: "POST", admin: true, rateLimit: "admin", handler: async (req, res) => {
  const { email, emails, action, note } = (req.body ?? {}) as { email?: unknown; emails?: unknown; action?: unknown; note?: unknown };
  if (typeof action !== "string" || !["approve", "reject", "force-logout"].includes(action)) {
    return res.status(400).json({ ok: false, error: "승인/거부/강제로그아웃 액션이 필요합니다" });
  }
  const noteStr = typeof note === "string" ? note : undefined;

  if (email && typeof email === "string" && !emails) {
    try {
      const result = await reviewOne(email, action, noteStr);
      if (!result.ok) return res.status(404).json({ ok: false, error: result.error });
      const MSG = { approve: "승인되었습니다", reject: "거부되었습니다", "force-logout": "강제 로그아웃 처리되었습니다" } as const;
      return res.json({ ok: true, message: MSG[action as keyof typeof MSG] });
    } catch (err) {
      console.error("[admin/review] error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  }

  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ ok: false, error: "이메일 또는 이메일 배열이 필요합니다" });
  }
  if (emails.length > MAX_BATCH) {
    return res.status(400).json({ ok: false, error: `최대 ${MAX_BATCH}건까지 일괄 처리 가능합니다` });
  }
  if (!emails.every(isValidEmail)) {
    return res.status(400).json({ ok: false, error: "유효하지 않은 이메일이 포함되어 있습니다" });
  }

  const results = [];
  for (const em of emails) {
    try {
      results.push(await reviewOne(em, action, noteStr));
    } catch (err) {
      console.error("[admin/review] batch error:", em, err instanceof Error ? err.message : err);
      results.push({ email: String(em).toLowerCase().trim(), ok: false, error: "처리 실패" });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const failCount = results.length - successCount;
  res.json({ ok: true, results, successCount, failCount });
}});
