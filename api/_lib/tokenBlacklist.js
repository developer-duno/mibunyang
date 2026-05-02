import { kv } from "./redis.js";
import crypto from "crypto";

/** 토큰 해시 생성 (SHA-256, 32자 — 원본 토큰 저장 방지) */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/** 토큰 블랙리스트 등록 (TTL = 토큰 잔여 만료 시간) */
export async function blacklistToken(token, payload) {
  const ttlMs = payload.exp - Date.now();
  if (ttlMs <= 0) return; // 이미 만료된 토큰은 등록 불필요
  const ttlSec = Math.ceil(ttlMs / 1000);
  const hash = hashToken(token);
  await kv.set(`bl:${hash}`, 1, { ex: ttlSec });
}

/**
 * 블랙리스트 확인 — Redis 장애 시 fail-open.
 *
 * Operational policy:
 * - Availability wins over logout blacklist enforcement if KV is temporarily down.
 * - JWT expiration remains the primary hard boundary; this blacklist is a
 *   best-effort early revocation layer for already-issued tokens.
 * - Missing KV values, including null and undefined, mean "not blacklisted".
 */
export async function isBlacklisted(token) {
  try {
    const hash = hashToken(token);
    const val = await kv.get(`bl:${hash}`);
    return val != null;
  } catch {
    return false;
  }
}
