import { kv } from "./redis.js";

const LIMITS = { login: 5, signup: 5, verify: 20, consult: 10, admin: 30, logout: 10, proxy: 30, kakao: 10 };
const DEFAULT_MAX = 5;
const WINDOW_SEC = 300; // 5분

export async function checkRateLimit(req, endpoint) {
  try {
    const fwd = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown";
    const ip = fwd.split(",").pop().trim();
    const key = `rl:${ip}:${endpoint}`;
    const p = kv.pipeline();
    p.incr(key);
    p.expire(key, WINDOW_SEC);
    const results = await p.exec();
    const count = results[0];
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
