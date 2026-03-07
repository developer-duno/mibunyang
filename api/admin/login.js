import { createToken } from "../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { secret } = req.body || {};
  if (!secret) {
    return res.status(400).json({ ok: false, error: "비밀번호를 입력해주세요" });
  }

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || secret !== adminSecret) {
    return res.status(401).json({ ok: false, error: "관리자 비밀번호가 일치하지 않습니다" });
  }

  const token = createToken({ role: "admin" });
  res.json({ ok: true, token });
}
