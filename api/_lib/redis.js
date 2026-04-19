import { Redis } from "@upstash/redis";

// Vercel KV 는 2024-12 Upstash Marketplace 로 자동 이관됨 (@vercel/kv deprecated 대체).
// 호출 시점에만 Redis.fromEnv() 실행(lazy)하여 환경변수 부재 상태에서도
// import·빌드·배포가 실패하지 않도록 보장. 실제 throw 는 첫 Redis 커맨드 호출 시점.
let client = null;

/**
 * Upstash Redis 클라이언트를 반환. 첫 호출 시점에 UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN 환경변수를 읽어 초기화하고, 이후 호출은 캐시된
 * 인스턴스를 재사용.
 *
 * @returns {Redis} Upstash Redis 클라이언트
 */
export function getRedisClient() {
  if (!client) {
    client = Redis.fromEnv();
  }
  return client;
}

// @vercel/kv 호출부 diff 최소화를 위해 `kv` 라는 이름으로도 노출.
// 세션127 에서 `import { kv } from "./redis.js"` 로 1줄 교체 예정.
export const kv = {
  get getInstance() {
    return getRedisClient();
  },
};
