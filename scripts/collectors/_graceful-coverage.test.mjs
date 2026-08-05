// @ts-check
/**
 * graceful shutdown coverage 회귀 가드 (세션 329, PR-A)
 *
 * 모든 main loop 박힘 collector 에 다음 둘 박힘 강제:
 *   1. createReporter(...) 또는 setupGracefulShutdown(...) 호출
 *   2. main loop body 안에 `if (rpt.interrupted()) break;` 류 박힘
 *
 * graceful 무관 collector (one-shot / non-loop / 단발 호출) 는 ALLOWLIST 에 박힘.
 *
 * 신규 collector 추가 시:
 *   - main loop 박힘 collector = createReporter + break 박힘 의무 (본 테스트 통과)
 *   - one-shot collector = ALLOWLIST 에 명시적 박힘
 *
 * 답습 자산:
 *   .claude/rules/collectors/graceful-shutdown-coverage.md
 *   scripts/collectors/_shared.test.mjs L400~ SIGTERM mock 4 테스트
 *   scripts/collectors/childcare-info-jeju.mjs L90+L96~99 풀버전 답습 패턴
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const COLLECTORS_DIR = path.resolve(process.cwd(), "scripts/collectors");

/**
 * graceful 무관 collector (one-shot / non-loop / 단발 호출 / batch upsert 단일 호출).
 *
 * 이력:
 *   - PR-A (세션 329) / PR-B (세션 330) / PR-C (세션 337): 9 collector
 *     (collect-housing-price / childcare-detail / collect-nearby-childcare /
 *      collect-crime-safety / calc-school-walk / collect-market-stats / naver-presale /
 *      collect-trades / childcare-info) graceful 적용 완료 + ALLOWLIST 에서 제거됨.
 *   - 세션 344: ALLOWLIST 거짓 음성 5건 (trade-stats / molit-units / naver-listings /
 *     reverse-geocode / geocode-missing) 발견 — 모두 cron 실행 + main loop + await 인데
 *     graceful 누락. setupGracefulShutdown + break 박힘 후 ALLOWLIST 에서 제거.
 */
const ALLOWLIST = new Set([
  // graceful 무관 — calc 단발 변환
  "calc-exclusive-ratio.mjs",
  "calc-floors.mjs",
  "calc-layout.mjs",
  // graceful 무관 — KOSIS / 공공API 단발 호출
  "collect-avg-income.mjs",
  "collect-fertility-rate.mjs",
  "collect-housing-supply-ratio.mjs",
  "collect-jeonse-price-index.mjs",
  "collect-medical-access.mjs",
  "collect-regional-economy.mjs",
  "collect-sale-price-index.mjs",
  "collect-unsold-kosis.mjs",      // 이미 박힘 (rpt=1 break=1) — 검증 통과 가능, 안전 박힘
  // graceful 무관 — DART / 환경 / 산업 / 운영
  "dart-builders.mjs",
  "environment.mjs",
  "industry-match.mjs",
  // 세션 491: noxious.mjs 를 ALLOWLIST 에서 **제거**했다.
  // 증분 수집 + 단지 단위 즉시 저장 + createReporter/break 를 넣었으므로 이제 검사 대상이다.
  // 여기 남겨두면 그 안전장치가 나중에 지워져도 아무도 모른다.
  "transit-match.mjs",
  // graceful 무관 — 단발 / 보조 / 진단
  "data-audit.mjs",
  "data-fill.mjs",
  "migration.mjs",
  "noise-estimate.mjs",
  "regulation-seed.mjs",
  "sync-naver-complex.mjs",
]);

const REPORTER_REGEX = /createReporter\s*\(|setupGracefulShutdown\s*\(/;
// break 박힘 두 형태 모두 매칭:
//   1. 단일 줄: `if (rpt.interrupted()) break;` (transport-tago / population 답습)
//   2. block: `if (rpt.interrupted()) { ...; break; }` (childcare-info-jeju 답습, 다중 줄)
const BREAK_REGEX = /(if\s*\(\s*\w+\.interrupted\s*\(\s*\)\s*\)|if\s*\(\s*isInterrupted\s*\(\s*\)\s*\))[\s\S]{0,200}?break/;

describe("graceful shutdown coverage 회귀 가드 (PR-A, 세션 329)", () => {
  const FILES = readdirSync(COLLECTORS_DIR)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && !f.startsWith("_"))
    .sort();

  it("ALLOWLIST 항목 = 모두 실제 파일", () => {
    for (const name of ALLOWLIST) {
      const exists = FILES.includes(name);
      expect(exists, `ALLOWLIST 항목 ${name} 가 실제 파일 미박힘 (오타 또는 stale 박힘)`).toBe(true);
    }
  });

  for (const f of FILES) {
    it(`${f}: createReporter or setupGracefulShutdown + main loop break 박힘`, () => {
      if (ALLOWLIST.has(f)) return;
      const src = readFileSync(path.join(COLLECTORS_DIR, f), "utf8");
      const hasReporter = REPORTER_REGEX.test(src);
      const hasBreak = BREAK_REGEX.test(src);
      expect(hasReporter, `${f}: createReporter / setupGracefulShutdown 호출 미박힘`).toBe(true);
      expect(hasBreak, `${f}: main loop break ('if (rpt.interrupted()) break' 류) 미박힘`).toBe(true);
    });
  }
});
