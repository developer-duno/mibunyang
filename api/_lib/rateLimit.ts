import { kv } from "./redis.js";

const LIMITS: Record<string, number> = { login: 5, signup: 5, verify: 20, consult: 10, admin: 30, logout: 10, proxy: 30, kakao: 10, subscribers: 5 };
const DEFAULT_MAX = 5;
const WINDOW_SEC = 300; // 5분

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
    // Redis 장애 시 fail-close (보안 우선)
    return { limited: true, retryAfter: WINDOW_SEC };
  }
}
