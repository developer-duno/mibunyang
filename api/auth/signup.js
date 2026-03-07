import { kv } from "@vercel/kv";
import { hashPassword } from "../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { email, password, name, affiliation } = req.body || {};

  if (!email || !password || !name) {
    return res.status(400).json({ ok: false, error: "이메일, 비밀번호, 이름은 필수입니다" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "올바른 이메일 형식이 아닙니다" });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: "비밀번호는 8자 이상이어야 합니다" });
  }
  if (name.length > 50 || (affiliation && affiliation.length > 100)) {
    return res.status(400).json({ ok: false, error: "입력값이 너무 깁니다" });
  }

  try {
    const key = `user:${email.toLowerCase().trim()}`;
    const existing = await kv.get(key);
    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 등록된 이메일입니다" });
    }

    const { hash, salt } = hashPassword(password);
    await kv.set(key, {
      email: email.toLowerCase().trim(),
      name: name.trim(),
      affiliation: (affiliation || "").trim(),
      passwordHash: hash,
      salt,
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, message: "가입이 완료되었습니다. 로그인해주세요." });
  } catch (err) {
    console.error("[auth/signup] error:", err.message);
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}
