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
 * 본 PR-A 시점 (세션 329) 잠정 박힘. PR-B / PR-C 머지 후 ALLOWLIST 에서 제거 의무:
 *   PR-B (7건): collect-housing-price / childcare-detail / collect-nearby-childcare /
 *               collect-crime-safety / calc-school-walk / collect-market-stats / naver-presale
 *   PR-C (2건): collect-trades / childcare-info
 *
 * 추가 답습 자산:
 *   collect-maintenance (rpt=1 break=0, PR-B 외 추가 보강 후보) — 잠정 ALLOWLIST 박힘
 *   trade-stats-regions (setupGracefulShutdown import 박혔으나 호출 0건 회귀) — 별 진단 박힘
 */
const ALLOWLIST = new Set([
  // PR-B 대상 (머지 후 ALLOWLIST 제거)
  "collect-housing-price.mjs",
  "childcare-detail.mjs",
  "collect-nearby-childcare.mjs",
  "collect-crime-safety.mjs",
  "calc-school-walk.mjs",
  "collect-market-stats.mjs",
  "naver-presale.mjs",
  // PR-C 대상 (머지 후 ALLOWLIST 제거)
  "collect-trades.mjs",
  "childcare-info.mjs",
  // 추가 보강 후보 (별 PR / 진단 박힘)
  "collect-maintenance.mjs",       // K-apt 관리비, rpt=1 break=0
  "trade-stats-regions.mjs",       // setupGracefulShutdown import 0회 호출 회귀
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
  "noxious.mjs",
  "transit-match.mjs",
  // graceful 무관 — 단발 / 보조 / 진단
  "data-audit.mjs",
  "data-fill.mjs",
  "geocode-missing.mjs",
  "migration.mjs",
  "molit-units.mjs",
  "naver-listings.mjs",
  "noise-estimate.mjs",
  "regulation-seed.mjs",
  "reverse-geocode.mjs",
  "sync-naver-complex.mjs",
  "trade-stats.mjs",
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
