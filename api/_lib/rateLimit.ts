import { kv } from "./redis.js";

const LIMITS: Record<string, number> = { login: 5, verify: 60, consult: 10, admin: 30, logout: 10, proxy: 30, kakao: 10, subscribers: 5 };
const DEFAULT_MAX = 5;
const WINDOW_SEC = 300; // 5분

// Redis 장애(catch) 시 fail-close 를 유지할 엔드포인트 — credential brute-force / 인증 없는 공개 쓰기 표면.
// 그 외(verify·logout·kakao·consult·admin·proxy)는 fail-open: JWT 위조 불가 + 만료, admin 토큰, OAuth,
// 외부 쿼터 보호 등 2차 방어선이 있어 Redis 순단 동안 rate limit 만 일시 무력화돼도 인증·인가는 안 뚫린다.
// fail-close 전역 유지 시 Upstash 순단 1회 = 전 API 429 전면 장애(SPOF) → 100명 운영 위험. (세션 427)
const FAIL_CLOSE_ENDPOINTS = new Set(["login", "subscribers"]);

type ReqLike = {
  headers: Record<string, string | string[] | undefined>;
};

type RateLimitResult = { limited: true; retryAfter: number } | { limited: false };

export async function checkRateLimit(req: ReqLike, endpoint: string): Promise<RateLimitResult> {
  try {
    const fwd = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown") as string | string[];
    const fwdStr = Array.isArray(fwd) ? fwd[0] : fwd;
    const ip = fwdStr.split(",").pop()?.trim() ?? "unknown";
    const key = `rl:${ip}:${endpoint}`;
    const p = kv.pipeline();
    p.incr(key);
    p.expire(key, WINDOW_SEC);
    const results = await p.exec();
    const count = results[0] as number;
    const max = LIMITS[endpoint] || DEFAULT_MAX;
    if (count > max) {
      return { limited: true, retryAfter: WINDOW_SEC };
    }
    return { limited: false };
  } catch {
    // Redis 장애 시 차등: login·subscribers 만 fail-close(보안 우선), 그 외 fail-open(가용성 우선).
    if (FAIL_CLOSE_ENDPOINTS.has(endpoint)) {
      return { limited: true, retryAfter: WINDOW_SEC };
    }
    return { limited: false };
  }
}
