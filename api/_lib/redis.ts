import { Redis } from "@upstash/redis";

// Vercel KV 는 2024-12 Upstash Marketplace 로 자동 이관됨 (@vercel/kv deprecated 대체).
// Redis.fromEnv() 는 UPSTASH_REDIS_REST_URL || KV_REST_API_URL (fallback) 을 읽음.
// 실측 근거: node_modules/@upstash/redis/nodejs.mjs:266-282.
// env 부재 시 console.warn 만 출력, throw 없음 → 빌드·배포 안전성 보존.
// 모듈 첫 import 시점에 1회 초기화 (Node 모듈 캐싱으로 lazy 의도 실질 보존).
export const kv = Redis.fromEnv();
