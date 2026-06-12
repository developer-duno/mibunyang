// @ts-check
/**
 * 관리자 계정 생성/비밀번호 재설정 — 수동 1회성 스크립트 (세션 405).
 *
 * 배경: 전문가 가입(api/auth/signup) 폐지로 계정 생성 경로가 사라짐.
 *       관리자 계정 분실·비밀번호 재설정 시 이 스크립트가 유일한 복구 수단 (잠금 방지 안전망).
 *
 * 사용법 (비밀번호는 셸 히스토리 노출 방지를 위해 인자 금지 — 환경변수로만):
 *   ADMIN_NEW_EMAIL=boss@example.com ADMIN_NEW_PASSWORD='비밀번호8자이상' node scripts/create-admin-user.mjs
 *   (dry-run: ADMIN_NEW_PASSWORD 없이 실행하면 대상 키와 기존 레코드 유무만 출력)
 *
 * 주의: 로그인 시 관리자 판별은 KV 레코드가 아니라 Vercel ADMIN_EMAIL 환경변수(timingSafeEqual)다.
 *       새 이메일로 만들면 Vercel 의 ADMIN_EMAIL 도 같은 값으로 바꿔야 관리자 로그인이 된다.
 */
import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { loadEnv } from "./collectors/_shared.mjs";

// api/_lib/auth.ts hashPassword 와 동일 파라미터 (TS 파일이라 .mjs 직접 import 불가 — 인라인 복제.
// 원본 변경 시 동기 의무: PBKDF2 100_000 iter / 64 keylen / sha512)
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = "sha512";

function hashPassword(/** @type {string} */ password) {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  return { hash, salt };
}

async function main() {
  loadEnv(); // .env.local 로드 (UPSTASH_REDIS_REST_URL/KV_REST_API_URL)
  const email = (process.env.ADMIN_NEW_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.ADMIN_NEW_PASSWORD ?? "";

  if (!email || !email.includes("@")) {
    console.error("[create-admin-user] ADMIN_NEW_EMAIL 환경변수 필요 (이메일 형식)");
    process.exit(1);
  }

  // Vercel KV(구) / Upstash(신) 두 이름 폴백 — 로컬에 없으면 `vercel env pull .env.local` 로 수령
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("[create-admin-user] KV 자격증명 필요: UPSTASH_REDIS_REST_URL/TOKEN 또는 KV_REST_API_URL/TOKEN");
    console.error("  → `vercel env pull .env.local` 실행 후 재시도 (프로젝트 루트)");
    process.exit(1);
  }
  const kv = new Redis({ url, token });
  const key = `user:${email}`;
  const existing = await kv.get(key);

  if (!password) {
    console.log(`[dry-run] 대상 키: ${key} / 기존 레코드: ${existing ? "있음 (덮어쓰기 대상 — 비밀번호만 갱신)" : "없음 (신규 생성)"}`);
    console.log("[dry-run] 실제 적용은 ADMIN_NEW_PASSWORD 환경변수와 함께 재실행");
    return;
  }
  if (password.length < 8 || password.length > 128) {
    console.error("[create-admin-user] 비밀번호는 8~128자");
    process.exit(1);
  }

  const { hash, salt } = hashPassword(password);
  const base = (existing && typeof existing === "object") ? existing : { email, name: "관리자", createdAt: new Date().toISOString() };
  const record = { ...base, email, passwordHash: hash, salt, status: "approved", role: "admin" };
  await kv.set(key, record);
  // admin 통계/목록 status set 동기화 (kakao.ts·review.ts 패턴 답습, idempotent)
  await kv.sadd("users:approved", email);

  console.log(`[완료] ${key} ${existing ? "비밀번호 갱신" : "신규 생성"}.`);
  console.log("⚠️ 로그인 판별은 Vercel ADMIN_EMAIL 환경변수 — 이 이메일과 일치하는지 확인할 것.");
}

main().catch((err) => {
  console.error("[create-admin-user] ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
