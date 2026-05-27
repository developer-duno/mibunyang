import { kv } from "../_lib/redis.js";
import { createToken, createRefreshToken } from "../_lib/auth.js";
import { withHandler } from "../_lib/handler.js";
import crypto from "crypto";

/**
 * 카카오 OAuth 콜백 — 인가 코드 교환 + KV 사용자 조회/생성 + JWT 발급
 * POST /api/auth/kakao  { code: string }
 */

type KakaoUser = {
  email: string;
  name: string;
  affiliation?: string;
  kakaoId?: string;
  role?: string;
  status?: string;
  profileImage?: string | null;
  createdAt?: string;
  [k: string]: unknown;
};

// redirect_uri 화이트리스트 검증 (다중 도메인 대응)
const ALLOWED_ORIGINS = new Set([
  "https://www.xn--hg3bi2ac4o1ig57cnoa.com",
  "https://xn--hg3bi2ac4o1ig57cnoa.com",
  "https://mibunyang.vercel.app",
  "http://localhost:5173",
]);
const CALLBACK_PATH = "/oauth/kakao/callback";

function getAllowedOrigins() {
  const origins = new Set(ALLOWED_ORIGINS);
  for (const origin of (process.env.KAKAO_ALLOWED_ORIGINS || "").split(",")) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

export default withHandler({ method: "POST", cors: {}, rateLimit: "kakao", handler: async (req, res) => {
  const { code, redirect_uri } = (req.body ?? {}) as { code?: unknown; redirect_uri?: unknown };

  // 1. code + redirect_uri 검증
  if (!code || typeof code !== "string" || code.length < 10 || code.length > 200) {
    return res.status(400).json({ ok: false, error: "유효하지 않은 인가 코드입니다" });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    return res.status(400).json({ ok: false, error: "유효하지 않은 인가 코드입니다" });
  }
  if (!redirect_uri || typeof redirect_uri !== "string") {
    return res.status(400).json({ ok: false, error: "redirect_uri가 필요합니다" });
  }
  try {
    const origin = new URL(redirect_uri).origin;
    if (!getAllowedOrigins().has(origin) || !redirect_uri.endsWith(CALLBACK_PATH)) {
      return res.status(400).json({ ok: false, error: "허용되지 않은 redirect_uri입니다" });
    }
  } catch {
    return res.status(400).json({ ok: false, error: "잘못된 redirect_uri 형식입니다" });
  }

  const restApiKey = process.env.KAKAO_REST_API_KEY;
  if (!restApiKey) {
    console.error("[auth/kakao] KAKAO_REST_API_KEY 미설정");
    return res.status(500).json({ ok: false, error: "서버 설정 오류입니다" });
  }

  try {
    // 2. 카카오 토큰 교환
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: restApiKey,
      redirect_uri,
      code,
    });
    if (process.env.KAKAO_CLIENT_SECRET) {
      tokenParams.append("client_secret", process.env.KAKAO_CLIENT_SECRET);
    }

    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[auth/kakao] 토큰 교환 실패:", tokenData.error_description || tokenData.error);
      return res.status(401).json({ ok: false, error: "카카오 인증에 실패했습니다" });
    }

    // 3. 사용자 정보 조회
    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    if (!userRes.ok) {
      console.error("[auth/kakao] 사용자 정보 조회 실패:", userData.msg || userData.code);
      return res.status(401).json({ ok: false, error: "카카오 사용자 정보를 가져올 수 없습니다" });
    }

    const kakaoId = String(userData.id);
    const kakaoEmail = userData.kakao_account?.email;
    const kakaoNickname = userData.kakao_account?.profile?.nickname || "사용자";
    const kakaoProfileImage = userData.kakao_account?.profile?.profile_image_url || null;

    // 4. 이메일 필수 체크
    if (!kakaoEmail) {
      return res.status(400).json({
        ok: false,
        error: "카카오 계정에 이메일이 연결되어 있지 않습니다. 카카오 계정 설정에서 이메일을 연결해주세요.",
      });
    }

    const emailNorm = kakaoEmail.toLowerCase().trim();

    // 5. KV 조회 — 3분기 처리
    const existingByKakao = (await kv.get(`kakao:${kakaoId}`)) as string | null;
    let user: KakaoUser | null = null;
    let isNew = false;

    if (existingByKakao) {
      // A. kakaoId 기존: 이전에 카카오 로그인한 적 있음
      user = (await kv.get(`user:${existingByKakao}`)) as KakaoUser | null;
      if (!user) {
        // 역참조는 있는데 user 키가 사라진 경우 (비정상) → 신규 생성으로 폴백
        isNew = true;
      }
    }

    if (!isNew && !user) {
      // B. kakaoId 신규 → email로 기존 사용자 검색
      user = (await kv.get(`user:${emailNorm}`)) as KakaoUser | null;
      if (user) {
        // 기존 사용자에 kakaoId 연동
        user.kakaoId = kakaoId;
        if (kakaoProfileImage) user.profileImage = kakaoProfileImage;
        await kv.set(`user:${emailNorm}`, user);
      } else {
        isNew = true;
      }
    }

    if (isNew) {
      // C. 완전 신규 카카오 사용자
      user = {
        email: emailNorm,
        name: kakaoNickname,
        affiliation: "",
        kakaoId,
        role: "user",
        status: "approved",
        profileImage: kakaoProfileImage,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`user:${emailNorm}`, user);
    }

    // status set 동기화 — admin 통계/목록의 진실의 원천 (idempotent: 이미 있으면 no-op)
    // signup.ts / review.ts 와 동일 패턴. 누락 시 admin 대시보드에서 카카오 가입자 카운트 0
    await kv.sadd(`users:${user!.status || "approved"}`, emailNorm);

    // 역참조 키 저장 (TTL 90일)
    await kv.set(`kakao:${kakaoId}`, emailNorm, { ex: 90 * 24 * 60 * 60 });

    // 6. status 체크
    if (user!.status === "rejected" || user!.status === "suspended") {
      return res.status(403).json({ ok: false, error: "접근 권한이 없습니다" });
    }
    if (user!.status === "pending") {
      return res.status(403).json({ ok: false, error: "관리자 승인 대기중입니다", statusCode: "PENDING" });
    }

    // 7. 관리자 판별
    const isAdmin = (() => {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (!adminEmail) return false;
      const a = Buffer.from(emailNorm);
      const b = Buffer.from(adminEmail.toLowerCase().trim());
      if (a.length !== b.length) return false;
      try { return crypto.timingSafeEqual(a, b); } catch { return false; }
    })();

    // 8. JWT 발급
    const role = isAdmin ? "admin" : (user!.role || "user");
    const token = createToken(
      { email: emailNorm, name: user!.name, ...(role !== "user" && { role }) },
      isAdmin ? { ttl: 3600000 } : undefined,
    );

    const refreshToken = createRefreshToken(emailNorm);
    res.json({
      ok: true,
      token,
      refreshToken,
      user: { email: emailNorm, name: user!.name, affiliation: user!.affiliation || "" },
      ...(role !== "user" && { role }),
    });
  } catch (err) {
    console.error("[auth/kakao] error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
