import { kv } from "@vercel/kv";
import { verifyPassword, hashPassword, createToken } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { limited, retryAfter } = await checkRateLimit(req, "login");
  if (limited) {
    return res.status(429).json({ ok: false, error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
  }

  const { email, password } = req.body || {};

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ ok: false, error: "이메일과 비밀번호를 입력해주세요" });
  }
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: "올바른 이메일 형식이 아닙니다" });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ ok: false, error: "올바른 비밀번호 형식이 아닙니다" });
  }

  try {
    const user = await kv.get(`user:${email.toLowerCase().trim()}`);
    if (!user) {
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    }

    const valid = verifyPassword(password, user.passwordHash, user.salt);
    if (!valid) {
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    }

    // 레거시 SHA-256 → PBKDF2 자동 마이그레이션
    if (user.passwordHash.length === 64) {
      const { hash, salt } = hashPassword(password);
      await kv.set(`user:${email.toLowerCase().trim()}`, { ...user, passwordHash: hash, salt });
    }

    const isAdmin = process.env.ADMIN_EMAIL &&
      user.email === process.env.ADMIN_EMAIL.toLowerCase().trim();

    if (!isAdmin) {
      const status = user.status ?? "approved";
      if (status === "pending") {
        return res.status(403).json({ ok: false, error: "관리자 승인 대기중입니다. 승인 후 이용 가능합니다.", statusCode: "PENDING" });
      }
      if (status === "rejected") {
        return res.status(403).json({ ok: false, error: "가입 신청이 거부되었습니다. 관리자에게 문의해주세요.", statusCode: "REJECTED" });
      }
    }

    const token = createToken({
      email: user.email, name: user.name,
      ...(isAdmin && { role: "admin" }),
    });
    res.json({
      ok: true,
      token,
      user: { email: user.email, name: user.name, affiliation: user.affiliation },
      ...(isAdmin && { role: "admin" }),
    });
  } catch (err) {
    console.error("[auth/login] error:", err.message);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}
