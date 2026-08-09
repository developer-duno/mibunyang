// @ts-check
/*
 * Node ESM 실행 사슬 import audit
 *
 * compute-scores.mjs(daily-deploy 03:00 · 네이버 로컬 러너 6/6 · post-naver 4단계)는
 * `node --loader ./scripts/alias-loader.mjs` 로 `@/scoring/engine` 사슬을 직접 연다.
 * 그런데 CI 의 어느 관문(lint·tsc·vitest·build)도 이 "일반 Node 방식 import" 를 밟지 않는다 —
 * Vite/vitest 는 import 속성 없는 JSON import 를 허용하지만 Node ESM 은
 * ERR_IMPORT_ATTRIBUTE_MISSING 으로 즉사하므로, Vite 전용 문법이 이 사슬에 스며들면
 * 화면·테스트·빌드 전부 초록인 채 운영 점수 갱신만 죽는다(세션 508 — PR-1 #364 의
 * regulation-zones.json import 가 daily-deploy 크론 3시간 전에 발견된 실사고).
 *
 * 실행(CI 와 동일): node --loader ./scripts/alias-loader.mjs scripts/audit-node-esm-chain.mjs
 * import 자체가 실패하면 스크립트가 비정상 종료(exit≠0)하므로 그것만으로 차단된다.
 */
import { getZone } from "@/constants/regulations";
import { calcCats } from "@/scoring/engine";

const zone = getZone("서울", "강남구");
if (typeof calcCats !== "function" || !zone) {
  console.error(`❌ Node ESM 사슬 이상: calcCats=${typeof calcCats}, getZone(서울,강남구)=${String(zone)}`);
  process.exit(1);
}
console.log(`✅ Node ESM 사슬 OK — getZone(서울,강남구)=${zone}`);
