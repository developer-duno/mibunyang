import { kv } from "@vercel/kv";
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

/** 블랙리스트 확인 — Redis 장애 시 fail-open (가용성 우선, 토큰 만료가 2차 방어선) */
export async function isBlacklisted(token) {
  try {
    const hash = hashToken(token);
    const val = await kv.get(`bl:${hash}`);
    return val !== null;
  } catch {
    return false;
  }
}
