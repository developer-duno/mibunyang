import { kv } from "../_lib/redis.js";
import { verifyPassword, hashPassword, createToken, createRefreshToken, isAdminEmail } from "../_lib/auth.js";
import { withHandler } from "../_lib/handler.js";
import { isValidEmail } from "../_lib/validators.js";

/**
 * KV `user:{email}` 레코드 — 5 source (login/signup/verify/kakao/logout) 공통 활용.
 * 카카오 사용자는 passwordHash/salt 부재, 일반 사용자는 kakaoId/profileImage 부재.
 */
type UserRecord = {
  email: string;
  name: string;
  passwordHash?: string;
  salt?: string;
  status?: string;
  role?: string;
  affiliation?: string;
  phone?: string;
  specialty?: string;
  license?: string;
  experience?: number;
  bio?: string;
  kakaoId?: string;
  profileImage?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt?: string;
};

export default withHandler({ method: "POST", cors: {}, rateLimit: "login", handler: async (req, res) => {
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ ok: false, error: "이메일과 비밀번호를 입력해주세요" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "올바른 이메일 형식이 아닙니다" });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ ok: false, error: "올바른 비밀번호 형식이 아닙니다" });
  }

  try {
    const user = (await kv.get(`user:${email.toLowerCase().trim()}`)) as UserRecord | null;
    if (!user || !user.passwordHash || !user.salt) {
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

    // 세션 405: 비밀번호 로그인 = 관리자 전용. 비admin(레거시 전문가 가입 계정 포함)은
    // 계정 존재 비노출을 위해 generic 401 (손님은 카카오 로그인 단독).
    const isAdmin = isAdminEmail(user.email);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    }

    const role = "admin";
    const token = createToken({
      email: user.email, name: user.name,
      role,
    }, { ttl: 3600000 });
    const refreshToken = createRefreshToken(user.email);
    res.json({
      ok: true,
      token,
      refreshToken,
      user: { email: user.email, name: user.name, affiliation: user.affiliation },
      role,
    });
  } catch (err) {
    console.error("[auth/login] error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
