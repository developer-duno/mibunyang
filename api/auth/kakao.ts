import { kv } from "../_lib/redis.js";
import { createToken, createRefreshToken, isAdminEmail } from "../_lib/auth.js";
import { withHandler } from "../_lib/handler.js";

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
  phoneNumber?: string | null;       // 카카오 비즈앱 심사 완료 후 채워짐 (그 전까지 null)
  consentMarketing?: boolean | null; // null=아직 선택 안 함, true=동의, false=거부
  consentMarketingAt?: string | null;
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
    // 전화번호: 카카오 비즈앱 심사 완료 후 채워짐. 심사 전엔 undefined → null로 저장.
    const kakaoPhone: string | null = userData.kakao_account?.phone_number ?? null;

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
        // 레거시 사용자(consentMarketing 필드 없음) DB 일관성 — 이미 set 중이라 추가 write 0 (세션 427)
        if (user.consentMarketing !== true && user.consentMarketing !== false) user.consentMarketing = null;
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
        phoneNumber: kakaoPhone,       // 비즈앱 심사 전 null, 심사 후 자동 채워짐
        consentMarketing: null,        // 신규: 아직 선택 안 함 → 프론트에서 팝업 표시
        consentMarketingAt: null,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`user:${emailNorm}`, user);
    } else if (user && kakaoPhone && !user.phoneNumber) {
      // 기존 사용자 전화번호 업데이트 (비즈앱 심사 후 새로 받아온 경우)
      user.phoneNumber = kakaoPhone;
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
    // pending = 구 전문가 가입 잔존 미승인 계정 — 가입 폐지 후에도 차단 보존 (세션 405)
    if (user!.status === "pending") {
      return res.status(403).json({ ok: false, error: "관리자 승인 대기중입니다", statusCode: "PENDING" });
    }

    // 7. 관리자 판별 — ADMIN_EMAIL 파생 단일 출처 (세션 405, api/_lib/auth.ts 공유)
    const isAdmin = isAdminEmail(emailNorm);

    // 8. JWT 발급 — 비admin 은 전부 "user" (레거시 record 의 role "expert" 정규화, 세션 405)
    const role = isAdmin ? "admin" : "user";
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
      isNew,                                         // 프론트에서 신규 여부 판별 (마케팅 동의 팝업)
      // 동의 미선택 = boolean 이 아닌 모든 값. 신규(null) + 레거시 사용자(필드 자체 없음 → undefined)
      // 둘 다 포착해야 함. `=== null` 은 undefined 를 놓쳐 본 커밋 이전 가입자에게 모달이 영영 안 뜸. (세션 427 적대검증)
      needsMarketingConsent: user!.consentMarketing !== true && user!.consentMarketing !== false,
    });
  } catch (err) {
    console.error("[auth/kakao] error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
