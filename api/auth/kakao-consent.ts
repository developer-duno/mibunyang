import { kv } from "../_lib/redis.js";
import { withHandler } from "../_lib/handler.js";

/**
 * 마케팅 수신 동의 저장
 * POST /api/auth/kakao-consent  { token: string, consent: boolean }
 * - token: 현재 로그인 중인 JWT (이메일 추출용)
 * - consent: true=동의, false=거부
 * 개인정보보호법상 수집 시점에 동의를 받아야 하므로 별도 엔드포인트로 분리
 */

import { verifyToken } from "../_lib/auth.js";

type KakaoUser = {
  email: string;
  consentMarketing?: boolean | null;
  consentMarketingAt?: string | null;
  [k: string]: unknown;
};

export default withHandler({ method: "POST", cors: {}, rateLimit: "kakao", handler: async (req, res) => {
  const { token, consent } = (req.body ?? {}) as { token?: unknown; consent?: unknown };

  if (!token || typeof token !== "string") {
    return res.status(400).json({ ok: false, error: "token이 필요합니다" });
  }
  if (typeof consent !== "boolean") {
    return res.status(400).json({ ok: false, error: "consent는 boolean이어야 합니다" });
  }

  // JWT에서 이메일 추출
  let email: string;
  try {
    const payload = verifyToken(token);
    if (!payload?.email) throw new Error("email 없음");
    email = (payload.email as string).toLowerCase().trim();
  } catch {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }

  const user = (await kv.get(`user:${email}`)) as KakaoUser | null;
  if (!user) {
    return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다" });
  }

  user.consentMarketing = consent;
  user.consentMarketingAt = new Date().toISOString();
  await kv.set(`user:${email}`, user);

  // 동의자 집합 관리 (관리자 통계용)
  if (consent) {
    await kv.sadd("users:consent_marketing", email);
  } else {
    await kv.srem("users:consent_marketing", email);
  }

  return res.json({ ok: true });
}});
