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
  // 세션 495: calc-exclusive-ratio.mjs 를 ALLOWLIST 에서 **제거**했다.
  // 실행 기록(collector_runs)을 넣으면서 createReporter + 단지별 UPDATE 루프의 break 를 함께 박았다.
  // 여기 남겨두면 그 안전장치가 나중에 지워져도 아무도 모른다 (calc-layout·noxious 선례 답습).
  // 세션 504: calc-floors.mjs 를 ALLOWLIST 에서 **제거**했다.
  // 매주 도는데 collector_runs 기록이 0행이라 "돌았는지" 조차 볼 수 없었다.
  // createReporter/break/기록을 넣었으니 이제 검사 대상이다.
  // 세션 492: calc-layout.mjs 를 ALLOWLIST 에서 **제거**했다.
  // "calc 단발 변환"으로 분류돼 있었지만 실제로는 대상 건수만큼 도는 루프가 셋이고
  // (이름 유사도 8,720만 쌍 · articles 청크 조회 · 단지별 UPDATE), 예약 시간 30분에
  // 걸려 죽어도 collector_runs 에 흔적이 없었다. createReporter/break/기록을 넣었으니
  // 이제 검사 대상이다. 여기 남겨두면 그 안전장치가 나중에 지워져도 아무도 모른다.
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
  // 세션 504: dart-builders.mjs 를 ALLOWLIST 에서 **제거**했다.
  // 분기마다 도는데 collector_runs 기록이 0행이라 8/04 취소를 아무도 못 봤다.
  // createReporter/break/기록 + 실패사유 집계를 넣었으니 이제 검사 대상이다.
  // 세션 504: environment.mjs · industry-match.mjs 를 ALLOWLIST 에서 **제거**했다.
  // 매월 도는데 collector_runs 기록이 0행이라 감시가 못 보던 자리 — 배선하며 break 도 박았다.
  // 세션 491: noxious.mjs 를 ALLOWLIST 에서 **제거**했다.
  // 증분 수집 + 단지 단위 즉시 저장 + createReporter/break 를 넣었으므로 이제 검사 대상이다.
  // 여기 남겨두면 그 안전장치가 나중에 지워져도 아무도 모른다.
  "transit-match.mjs",
  // graceful 무관 — 단발 / 보조 / 진단
  "data-audit.mjs",
  "data-fill.mjs",
  "migration.mjs",
  // 세션 504: noise-estimate.mjs · regulation-seed.mjs 를 ALLOWLIST 에서 **제거**했다
  // (calc-floors 와 같은 이유 — 기록 배선하며 break 도 함께 박았다).
  "sync-naver-complex.mjs",
]);

const REPORTER_REGEX = /createReporter\s*\(|setupGracefulShutdown\s*\(/;
// break 박힘 두 형태 모두 매칭:
//   1. 단일 줄: `if (rpt.interrupted()) break;` (transport-tago / population 답습)
//   2. block: `if (rpt.interrupted()) { ...; break; }` (childcare-info-jeju 답습, 다중 줄)
const BREAK_REGEX = /(if\s*\(\s*\w+\.interrupted\s*\(\s*\)\s*\)|if\s*\(\s*isInterrupted\s*\(\s*\)\s*\))[\s\S]{0,200}?break/;

/**
 * 주석을 걷어낸 사본을 돌려준다.
 *
 * ⚠️ 왜 필요한가 (세션 492): 이 가드는 소스를 **문자열로 grep** 한다. 그래서 지켜야 할
 *    안전장치를 주석 처리해도 그대로 통과했다 —
 *        // if (rpt.interrupted()) break;
 *    안전장치가 죽었는데 초록불이 켜지는, 뮤테이션 없이는 절대 안 드러나는 구멍이다.
 *    (같은 취약점이 REPORTER_REGEX 에도 있었다. 둘 다 걷어낸 사본에 건다.)
 *
 * 경계:
 *   - URL 의 `//` 는 남긴다 — 앞 글자가 `:` 면 주석이 아니다 (`https://...`).
 *   - 문자열 리터럴 안의 `//` 까지 지워지는 것은 **의도한 동작**이다. 문자열에 적힌
 *     코드 조각이 "안전장치가 박혀 있다"는 증거가 되어선 안 된다.
 *   - 지나치게 지우면 정상 collector 가 실패하므로, 이 가드가 실제 파일 전체에서
 *     통과하는지(= 정상 통과)를 반드시 함께 확인한다.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("stripComments — 가드가 주석에 속지 않는지", () => {
  it("줄 주석으로 가려진 break 는 지워진다", () => {
    const src = "for (const x of xs) {\n  // if (rpt.interrupted()) break;\n}";
    expect(BREAK_REGEX.test(src), "주석 상태로도 매칭되는 것이 원래 결함").toBe(true);
    expect(BREAK_REGEX.test(stripComments(src))).toBe(false);
  });

  it("블록 주석으로 가려진 createReporter 는 지워진다", () => {
    const src = "/* const rpt = createReporter(PHASE); */\nconst x = 1;";
    expect(REPORTER_REGEX.test(stripComments(src))).toBe(false);
  });

  it("살아 있는 코드는 남는다", () => {
    const src = "const rpt = createReporter(PHASE);\nfor (const x of xs) {\n  if (rpt.interrupted()) break;\n}";
    expect(REPORTER_REGEX.test(stripComments(src))).toBe(true);
    expect(BREAK_REGEX.test(stripComments(src))).toBe(true);
  });

  it("URL 의 // 는 주석으로 오인하지 않는다", () => {
    expect(stripComments('const u = "https://a.b/c";')).toContain("https://a.b/c");
  });
});

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
      // 주석을 걷어낸 사본에 건다 — 주석 처리된 안전장치는 증거가 아니다 (세션 492)
      const src = stripComments(readFileSync(path.join(COLLECTORS_DIR, f), "utf8"));
      const hasReporter = REPORTER_REGEX.test(src);
      const hasBreak = BREAK_REGEX.test(src);
      expect(hasReporter, `${f}: createReporter / setupGracefulShutdown 호출 미박힘`).toBe(true);
      expect(hasBreak, `${f}: main loop break ('if (rpt.interrupted()) break' 류) 미박힘`).toBe(true);
    });
  }
});
