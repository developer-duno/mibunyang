// @ts-check
/**
 * compute-scores.mjs 배선 가드 (세션 495).
 *
 * main() 을 실행하려면 Supabase·스코어링 엔진을 통째로 모킹해야 해서 비용이 크다.
 * 여기서 지키려는 건 로직이 아니라 **배선 두 가지**뿐이라 소스 직독으로 가드한다:
 *   1) collector_runs 기록 — 성공·실패·0건 세 경로 모두 recordCollectorRun 이 배선돼 있는가.
 *      (이 배선이 빠지면 점수 갱신이 며칠째 안 돼도 collector_runs·monitor 어디에도 신호가 없다 —
 *       세션 495 적대검증에서 "역대 0행" 으로 실측된 구멍.)
 *   2) isCLI 가드 — import 만으로 main() 이 돌아 실 DB 를 치는 회귀 방지.
 *
 * ⚠️ 소스 grep 가드는 주석·선언부에 매칭되면 통째로 무효다(guards-must-be-mutation-tested §소스 grep).
 *    주석을 걷어낸 사본에 검사하고, 패턴은 호출 문장 전체를 고정한다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./compute-scores.mjs", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("compute-scores — collector_runs 기록 배선 (세션 495)", () => {
  it("PHASE 상수가 monitor 라벨과 같은 'compute-scores' 다", () => {
    expect(src).toMatch(/const\s+PHASE\s*=\s*["']compute-scores["']/);
  });

  it("정상 종료 경로에서 reporter.summary() 를 기록한다", () => {
    expect(src).toMatch(/await\s+recordCollectorRun\(\s*PHASE\s*,\s*reporter\.summary\(\)\s*\)/);
  });

  it("데이터 로드 실패 경로도 status failure 로 기록하고 죽는다 (무기록 사망 금지)", () => {
    expect(src).toMatch(
      /await\s+recordCollectorRun\(\s*PHASE\s*,\s*\{\s*\.\.\.reporter\.summary\(\)\s*,\s*status:\s*["']failure["']/,
    );
  });

  it("DB UPDATE 실패 건수를 reporter 에 합산한다 (계산 성공 + 반영 전멸 = success 방지)", () => {
    expect(src).toMatch(/if\s*\(dbFailed\s*>\s*0\)\s*reporter\.fail\(dbFailed\)/);
  });

  it("isCLI 가드 — import 만으로 main() 이 실행되지 않는다", () => {
    expect(src).toMatch(/const\s+isCLI\s*=\s*argv1\s*&&/);
    expect(src).toMatch(/if\s*\(isCLI\)\s*main\(\)\.catch/);
  });
});
