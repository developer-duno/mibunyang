// @ts-check
/**
 * kosis-local-runner 테스트 — 일자 디스패치 순수 로직 + 매핑 무결성
 *
 * KOSIS 해외IP 차단(세션 288)으로 GH cron 10종을 집서버 로컬 러너로 이전.
 * 이 테스트는 (1) 일자→수집기 매핑이 의도대로 동작하고 (2) 매핑이 가리키는
 * 스크립트 파일이 실제로 존재하는지(이름 변경 시 silent 미실행 차단) 가드한다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn() };
});
vi.mock("./notify-telegram.mjs", () => ({ sendTelegram: vi.fn() }));

import { DAY_TABLE, collectorsDueOn } from "./kosis-local-runner.mjs";

describe("collectorsDueOn — 일자 디스패치", () => {
  it("매월 9일은 미분양(unsold) 수집기가 due 다", () => {
    expect(collectorsDueOn(new Date("2026-07-09"))).toEqual(["collect-unsold-kosis.mjs"]);
  });

  it("매월 10일은 출산율(fertility) 수집기가 due 다", () => {
    expect(collectorsDueOn(new Date("2026-07-10"))).toEqual(["collect-fertility-rate.mjs"]);
  });

  it("due 없는 날짜는 빈 배열", () => {
    expect(collectorsDueOn(new Date("2026-07-03"))).toEqual([]);
  });

  it("분기 수집기(sale-price)는 1·4·7·10월 17일에만 due 다", () => {
    expect(collectorsDueOn(new Date("2026-07-17"))).toEqual(["collect-sale-price-index.mjs"]);
    // 비분기 월(6월)의 17일은 빈 배열
    expect(collectorsDueOn(new Date("2026-06-17"))).toEqual([]);
  });

  it("매핑표는 KOSIS 10종 전부를 정확히 1회씩 커버한다", () => {
    const scripts = DAY_TABLE.map((e) => e.script).sort();
    expect(scripts).toEqual(
      [
        "collect-avg-income.mjs",
        "collect-fertility-rate.mjs",
        "collect-housing-supply-ratio.mjs",
        "collect-jeonse-price-index.mjs",
        "collect-market-stats.mjs",
        "collect-medical-access.mjs",
        "collect-regional-economy.mjs",
        "collect-sale-price-index.mjs",
        "collect-unsold-kosis.mjs",
        "migration.mjs",
      ].sort(),
    );
  });

  it("매핑표의 스크립트 파일이 전부 실재한다 (이름 변경 silent 미실행 차단)", () => {
    for (const e of DAY_TABLE) {
      const p = path.join(process.cwd(), "scripts", "collectors", e.script);
      expect(existsSync(p), `${e.script} 가 scripts/collectors/ 에 없음`).toBe(true);
    }
  });
});
