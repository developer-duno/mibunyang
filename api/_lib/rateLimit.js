import { kv } from "@vercel/kv";

const MAX_ATTEMPTS = 5;
const WINDOW_SEC = 300; // 5분

export async function checkRateLimit(req, endpoint) {
  try {
    const fwd = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown";
    const ip = fwd.split(",").pop().trim();
    const key = `rl:${ip}:${endpoint}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, WINDOW_SEC);
    if (count > MAX_ATTEMPTS) {
      return { limited: true, retryAfter: WINDOW_SEC };
    }
    return { limited: false };
  } catch {
    // Redis 장애 시 fail-close (보안 우선)
    return { limited: true, retryAfter: WINDOW_SEC };
  }
}
