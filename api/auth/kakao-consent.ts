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
import { isBlacklisted } from "../_lib/tokenBlacklist.js";

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

  // 로그아웃/강제 로그아웃된 토큰으로 마케팅 동의를 뒤집지 못하게 차단 (세션 534 S1, verify.ts:73 패턴)
  if (await isBlacklisted(token)) {
    return res.status(401).json({ ok: false, error: "로그아웃된 토큰입니다" });
  }

  const user = (await kv.get(`user:${email}`)) as KakaoUser | null;
  if (!user) {
    return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다" });
  }

  user.consentMarketing = consent;
  user.consentMarketingAt = new Date().toISOString();

  // 동의자 집합(관리자 통계용, admin/users.ts scard 소비처)을 해시보다 먼저 갱신.
  // 실패 시 해시(kv.set)를 건드리기 전이라 통계-무결성 보존 → 부분 쓰기 0. review.ts:26-33 답습.
  if (consent) {
    await kv.sadd("users:consent_marketing", email);
  } else {
    await kv.srem("users:consent_marketing", email);
  }

  // 집합 성공 후 해시 갱신. 해시 실패 시 집합은 이미 새 값(통계 정확), 해시만 잠시 뒤처짐 —
  // 단일 op 라 review.ts 식 반대-op 보상은 오히려 drift 를 재생산하므로 롤백 없이 그대로 throw
  // (withHandler 가 500 응답, 개별 레코드는 재요청 시 자연 치유).
  await kv.set(`user:${email}`, user);

  return res.json({ ok: true });
}});
