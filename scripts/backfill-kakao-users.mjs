#!/usr/bin/env node
/**
 * backfill-kakao-users.mjs
 *
 * api/auth/kakao.js 의 sadd 누락 버그 (커밋 2d5a25f 이전) 로 인해
 * KV 에 user:{email} 로는 저장됐지만 users:{status} set 에 없는 카카오
 * 가입자를 admin 통계에서 보이도록 backfill 한다.
 *
 * 동작:
 *   1. kakao:* 역참조 키를 SCAN 으로 모두 수집
 *   2. 각 이메일에 대응하는 user:{email} 객체를 GET
 *   3. user.status 의 set 에 이미 있는지 SISMEMBER 로 확인
 *   4. 없으면 SADD (idempotent)
 *
 * 사용:
 *   node scripts/backfill-kakao-users.mjs --dry-run    # 미리보기 (SADD 안 함)
 *   node scripts/backfill-kakao-users.mjs              # 실행
 *
 * 안전성:
 *   - SADD 는 idempotent: 이미 있으면 no-op
 *   - 이미 set 에 있는 사용자는 건드리지 않음
 *   - 롤백 필요 없음 (잘못 추가될 수 없는 구조)
 */
import { Redis } from "@upstash/redis";
import { loadEnv } from "./collectors/_shared.mjs";

loadEnv();

const dryRun = process.argv.includes("--dry-run");
const PHASE = "backfill-kakao-users";

function log(msg) {
  console.log(`[${PHASE}] ${msg}`);
}

async function main() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error(`[${PHASE}] KV_REST_API_URL + KV_REST_API_TOKEN 환경변수 필요`);
    process.exit(1);
  }
  const kv = new Redis({ url, token });

  log(dryRun ? "DRY-RUN 모드 (SADD 호출 안 함)" : "실행 모드");

  // 1. kakao:* 역참조 모두 SCAN — 카카오 가입자 이메일 수집
  const kakaoEmails = new Set();
  let cursor = 0;
  do {
    const [next, keys] = await kv.scan(cursor, { match: "kakao:*", count: 200 });
    cursor = Number(next);
    if (keys.length > 0) {
      const values = await Promise.all(keys.map(k => kv.get(k)));
      for (const email of values) {
        if (typeof email === "string" && email.length > 0) kakaoEmails.add(email);
      }
    }
  } while (cursor !== 0);

  log(`카카오 역참조 키 → 이메일 ${kakaoEmails.size}개 수집`);

  if (kakaoEmails.size === 0) {
    log("백필 대상 없음 — kakao:* 역참조 키가 없습니다");
    return;
  }

  // 2. 각 이메일 → user 객체 → status 확인 + sadd 누락 검사
  const stats = { sadded: 0, alreadyInSet: 0, userMissing: 0, statusMissing: 0 };
  for (const email of kakaoEmails) {
    const user = await kv.get(`user:${email}`);
    if (!user) { stats.userMissing++; continue; }
    const status = user.status || "approved";
    if (!status) { stats.statusMissing++; continue; }
    const key = `users:${status}`;
    const isMember = await kv.sismember(key, email);
    if (isMember) { stats.alreadyInSet++; continue; }
    if (dryRun) {
      log(`  [DRY] SADD ${key} ${email}`);
    } else {
      await kv.sadd(key, email);
      log(`  SADD ${key} ${email}`);
    }
    stats.sadded++;
  }

  log("─".repeat(50));
  log(`결과: ${stats.sadded}건 ${dryRun ? "백필 예정" : "백필 완료"}`);
  log(`  이미 set 에 있음: ${stats.alreadyInSet}`);
  log(`  user 키 누락: ${stats.userMissing}`);
  log(`  status 누락: ${stats.statusMissing}`);
}

main().catch(err => {
  console.error(`[${PHASE}] 오류:`, err.message);
  process.exit(1);
});
