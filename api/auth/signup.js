// @ts-check
import { kv } from "../_lib/redis.js";
import { hashPassword } from "../_lib/auth.js";
import { withHandler } from "../_lib/handler.js";
import { isValidEmail } from "../_lib/validators.js";

const SPECIALTIES = ["부동산 중개", "분양 컨설팅", "감정평가", "건축/설계", "기타"];

export default withHandler({ method: "POST", cors: { maxAge: 86400 }, rateLimit: "signup", handler: async (req, res) => {
  const { email, password, name, affiliation, phone, specialty, license, experience, bio } =
    /** @type {{ email?: unknown, password?: unknown, name?: unknown, affiliation?: unknown, phone?: unknown, specialty?: unknown, license?: unknown, experience?: unknown, bio?: unknown }} */
    (req.body ?? {});

  if (!email || !password || !name || typeof email !== "string" || typeof password !== "string" || typeof name !== "string") {
    return res.status(400).json({ ok: false, error: "이메일, 비밀번호, 이름은 필수입니다" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "올바른 이메일 형식이 아닙니다" });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ ok: false, error: "비밀번호는 8자 이상 128자 이하여야 합니다" });
  }
  if (name.length > 50 || (typeof affiliation === "string" && affiliation.length > 100)) {
    return res.status(400).json({ ok: false, error: "입력값이 너무 깁니다" });
  }
  if (typeof phone !== "string" || !/^01[016789]-?\d{3,4}-?\d{4}$/.test(phone.trim())) {
    return res.status(400).json({ ok: false, error: "올바른 연락처를 입력해주세요 (예: 010-1234-5678)" });
  }
  if (typeof specialty !== "string" || !SPECIALTIES.includes(specialty)) {
    return res.status(400).json({ ok: false, error: "전문 분야를 선택해주세요" });
  }
  const exp = Number(experience);
  if (!Number.isFinite(exp) || exp < 0 || exp > 50) {
    return res.status(400).json({ ok: false, error: "경력 연수를 올바르게 입력해주세요 (0~50)" });
  }
  if (typeof bio !== "string" || bio.trim().length < 10 || bio.trim().length > 500) {
    return res.status(400).json({ ok: false, error: "자기소개를 10자 이상 500자 이하로 입력해주세요" });
  }
  if (typeof license === "string" && license.length > 100) {
    return res.status(400).json({ ok: false, error: "자격증 정보가 너무 깁니다" });
  }

  try {
    const key = `user:${email.toLowerCase().trim()}`;
    const existing = await kv.get(key);
    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 등록된 이메일입니다" });
    }

    const { hash, salt } = hashPassword(password);
    const emailNorm = email.toLowerCase().trim();

    await kv.set(key, {
      email: emailNorm,
      name: name.trim(),
      affiliation: (typeof affiliation === "string" ? affiliation : "").trim(),
      phone: phone.trim(),
      specialty,
      license: (typeof license === "string" ? license : "").trim(),
      experience: exp,
      bio: bio.trim(),
      status: "pending",
      reviewedAt: null,
      reviewNote: null,
      passwordHash: hash,
      salt,
      createdAt: new Date().toISOString(),
    });
    try {
      await kv.sadd("users:pending", emailNorm);
    } catch (saddErr) {
      try { await kv.del(key); } catch { /* del 실패 시에도 상위 에러 전파 */ }
      throw saddErr;
    }

    res.json({ ok: true, message: "가입 신청이 완료되었습니다. 관리자 승인 후 이용 가능합니다." });
  } catch (err) {
    console.error("[auth/signup] error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
