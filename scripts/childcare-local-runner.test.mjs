// @ts-check
/**
 * childcare-local-runner 테스트 — 대상 배열 무결성 + 파일 실재
 *
 * api.childcare.go.kr 해외IP 차단(세션 399)으로 GH childcare 3종을 집서버 로컬 러너로 이전.
 * 일자 디스패치가 없는(화요일만 전부 실행 — 세션612) 단순 구조라, 이 테스트는 (1) CHILDCARE_COLLECTORS
 * 가 이전 대상 3종을 정확히 담고 (2) 그 스크립트 파일이 실재하며(이름 변경 시 silent
 * 미실행 차단) (3) 해외 IP 안전한 Kakao/DB 가공 수집기는 제외됐는지 가드한다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn() };
});
vi.mock("./notify-telegram.mjs", () => ({ sendTelegram: vi.fn() }));

import { CHILDCARE_COLLECTORS, CHILDCARE_RUN_DOW, shouldRunToday } from "./childcare-local-runner.mjs";

// 세션612(결정 ⑨): 3종을 화요일(KST)만. 작업 스케줄러는 매일 04:30 그대로라 러너가 거른다.
// 시각은 리터럴로 고정 — 2026-10-13 은 화요일, 10-14 는 수요일(달력 바깥 세계 기준).
describe("shouldRunToday — 화요일만 실행 (세션612)", () => {
  it("요일 상수는 화요일(2)", () => {
    expect(CHILDCARE_RUN_DOW).toBe(2);
  });

  it("화 04:30 KST(= 월 19:30 UTC) → 실행", () => {
    expect(shouldRunToday(new Date("2026-10-12T19:30:00Z"), false)).toBe(true);
  });

  it("수 04:30 KST(= 화 19:30 UTC) → 건너뜀 — UTC 요일(화)로 재면 틀리게 실행한다", () => {
    expect(shouldRunToday(new Date("2026-10-13T19:30:00Z"), false)).toBe(false);
  });

  it("월 23:59 KST → 건너뜀 / 화 00:00 KST → 실행 (자정 경계)", () => {
    expect(shouldRunToday(new Date("2026-10-12T14:59:00Z"), false)).toBe(false);
    expect(shouldRunToday(new Date("2026-10-12T15:00:00Z"), false)).toBe(true);
  });

  it("--force 면 요일 무관 실행", () => {
    expect(shouldRunToday(new Date("2026-10-13T19:30:00Z"), true)).toBe(true);
  });

  // 세션615 검사관: 순수 함수만 시험하면 main 이 판정을 안 부르거나 --force 를 안 넘겨도 초록이다.
  // main 본문(선언부 제외)에서 배선을 글자로 고정한다.
  it("main 배선 — shouldRunToday 호출 1건에 --force 인자가 들어간다", () => {
    const src = readFileSync(path.join(process.cwd(), "scripts", "childcare-local-runner.mjs"), "utf8");
    const start = src.indexOf("async function main()");
    const end = src.indexOf("const argv1", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const mainBody = src.slice(start, end);
    expect(mainBody.match(/shouldRunToday\(/g) ?? []).toHaveLength(1);
    expect(mainBody).toMatch(/const\s+force\s*=\s*process\.argv\.includes\(\s*"--force"\s*\)/);
    expect(mainBody).toMatch(/if\s*\(\s*!shouldRunToday\(\s*date\s*,\s*force\s*\)\s*\)\s*\{[\s\S]*?return;/);
  });
});

describe("CHILDCARE_COLLECTORS — 대상 배열 무결성", () => {
  // 세션606: childcare-detail 복귀(시군구 단위 호출) — 3종, 상세는 목록(info) 뒤에 돈다.
  it("대상 3종을 info → jeju → detail 순서로 담는다", () => {
    expect([...CHILDCARE_COLLECTORS]).toEqual(["childcare-info.mjs", "childcare-info-jeju.mjs", "childcare-detail.mjs"]);
    expect(CHILDCARE_COLLECTORS).toContain("childcare-detail.mjs");
  });

  it("중복 항목이 없다", () => {
    expect(new Set(CHILDCARE_COLLECTORS).size).toBe(CHILDCARE_COLLECTORS.length);
  });

  it("전부 .mjs 확장자다", () => {
    for (const s of CHILDCARE_COLLECTORS) {
      expect(s.endsWith(".mjs"), `${s} 가 .mjs 가 아님`).toBe(true);
    }
  });

  it("대상 스크립트 파일이 전부 실재한다 (이름 변경 silent 미실행 차단)", () => {
    for (const s of CHILDCARE_COLLECTORS) {
      const p = path.join(process.cwd(), "scripts", "collectors", s);
      expect(existsSync(p), `${s} 가 scripts/collectors/ 에 없음`).toBe(true);
    }
  });

  it("해외 IP 안전한 수집기(Kakao collect-childcare / DB 가공 nearby)는 제외된다", () => {
    expect(CHILDCARE_COLLECTORS).not.toContain("collect-childcare.mjs");
    expect(CHILDCARE_COLLECTORS).not.toContain("collect-nearby-childcare.mjs");
  });
});
