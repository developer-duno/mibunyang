// @ts-check
/**
 * childcare-local-runner 테스트 — 대상 배열 무결성 + 파일 실재
 *
 * api.childcare.go.kr 해외IP 차단(세션 399)으로 GH childcare 3종을 집서버 로컬 러너로 이전.
 * 일자 디스패치가 없는(매일 전부 실행) 단순 구조라, 이 테스트는 (1) CHILDCARE_COLLECTORS
 * 가 이전 대상 3종을 정확히 담고 (2) 그 스크립트 파일이 실재하며(이름 변경 시 silent
 * 미실행 차단) (3) 해외 IP 안전한 Kakao/DB 가공 수집기는 제외됐는지 가드한다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn() };
});
vi.mock("./notify-telegram.mjs", () => ({ sendTelegram: vi.fn() }));

import { CHILDCARE_COLLECTORS } from "./childcare-local-runner.mjs";

describe("CHILDCARE_COLLECTORS — 대상 배열 무결성", () => {
  it("이전 대상 3종(detail/info/jeju)을 정확히 담는다", () => {
    expect([...CHILDCARE_COLLECTORS].sort()).toEqual(
      ["childcare-detail.mjs", "childcare-info.mjs", "childcare-info-jeju.mjs"].sort(),
    );
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
