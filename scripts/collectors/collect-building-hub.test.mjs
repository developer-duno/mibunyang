// @ts-check
import { describe, it, expect, vi } from "vitest";

// collect-building-hub.mjs 테스트
// 이 테스트가 검증하는 것: 지번 파라미터 생성 + 에너지 집계 + 타입 변환의 정확성

// main() 진입 시 API_KEY 가드(early return)를 통과시키기 위해 import 전에 설정.
process.env.MOLIT_KEY = "test-key";

const recordCollectorRun = vi.fn();

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    sleep: vi.fn(),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(), interrupted: () => false,
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
    recordApiQuota: vi.fn(),
    recordCollectorRun,
  };
});

vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, REQUEST_DELAY: 0 };
});

const { makeLotParams, pickLatestAvailableMonth, main } = await import("./collect-building-hub.mjs");
const { getSupabase } = /** @type {any} */ (await import("./_shared.mjs"));

// quakeDesign 타입 변환 ("1"/"Y"/true → boolean) — 원본 fetchQuakeDesign 내부 인라인 로직 재현
/**
 * @param {string | number | boolean | null | undefined} val
 * @returns {boolean | null}
 */
function parseQuakeDesign(val) {
  if (val === "0" || val === "N" || val === false || val === "미적용") return false;
  if (val === "1" || val === "Y" || val === true || val === "적용") return true;
  return null;
}

// energy MAX 집계 — 원본 fetchEnergy 내부 인라인 로직 재현
/**
 * @param {Array<{useQty: string}> | null | undefined} items
 * @returns {number | null}
 */
function aggregateEnergy(items) {
  if (!items || items.length === 0) return null;
  const max = Math.max(...items.map(i => parseFloat(i.useQty) || 0));
  return max === 0 ? null : max;
}

// heatFuel MODE 집계 — 원본 fetchHeatFuel 내부 인라인 로직 재현
/**
 * @param {Array<{heatMethCdNm?: string | null, fuelCdNm?: string | null}> | null | undefined} items
 * @returns {string | null}
 */
function aggregateHeatFuel(items) {
  if (!items || items.length === 0) return null;
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of items) {
    const fuel = item.heatMethCdNm || item.fuelCdNm || null;
    if (fuel) counts[fuel] = (counts[fuel] || 0) + 1;
  }
  const entries = Object.entries(counts);
  return entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : null;
}

describe("makeLotParams — 지번 파라미터 생성", () => {
  it("정상 10자리 법정동코드 분할", () => {
    const p = makeLotParams("1168010100", 123, 4);
    expect(p.sigunguCd).toBe("11680");
    expect(p.bjdongCd).toBe("10100");
    expect(p.bun).toBe("0123");
    expect(p.ji).toBe("0004");
  });

  it("부번 없음 (0) → '0000'", () => {
    const p = makeLotParams("1168010100", 456, 0);
    expect(p.ji).toBe("0000");
  });

  it("부번 null → '0000'", () => {
    const p = makeLotParams("1168010100", 456, null);
    expect(p.ji).toBe("0000");
  });

  it("본번 null → '0000'", () => {
    const p = makeLotParams("1168010100", null, 0);
    expect(p.bun).toBe("0000");
  });
});

describe("parseQuakeDesign — 내진설계 타입 변환", () => {
  it('"1" → true', () => expect(parseQuakeDesign("1")).toBe(true));
  it('"Y" → true', () => expect(parseQuakeDesign("Y")).toBe(true));
  it('"적용" → true', () => expect(parseQuakeDesign("적용")).toBe(true));
  it('true → true', () => expect(parseQuakeDesign(true)).toBe(true));
  it('"0" → false', () => expect(parseQuakeDesign("0")).toBe(false));
  it('"N" → false', () => expect(parseQuakeDesign("N")).toBe(false));
  it('"미적용" → false', () => expect(parseQuakeDesign("미적용")).toBe(false));
  it('null → null', () => expect(parseQuakeDesign(null)).toBeNull());
  it('undefined → null', () => expect(parseQuakeDesign(undefined)).toBeNull());
});

describe("aggregateEnergy — MAX 집계", () => {
  it("복수 건물 → 최대값", () => {
    expect(aggregateEnergy([{ useQty: "100" }, { useQty: "250" }, { useQty: "180" }])).toBe(250);
  });

  it("단일 건물", () => {
    expect(aggregateEnergy([{ useQty: "420" }])).toBe(420);
  });

  it("빈 배열 → null", () => {
    expect(aggregateEnergy([])).toBeNull();
  });

  it("모든 값 0 → null", () => {
    expect(aggregateEnergy([{ useQty: "0" }, { useQty: "0" }])).toBeNull();
  });

  it("유효하지 않은 값 → 0 처리", () => {
    expect(aggregateEnergy([{ useQty: "abc" }, { useQty: "150" }])).toBe(150);
  });
});

describe("pickLatestAvailableMonth — 조회 월 자동 탐지 (세션568)", () => {
  // now = 2026-09-24 고정. 2개월 전=202607, 3개월 전=202606, 4개월 전=202605, 5개월 전=202604 ...
  const NOW = new Date(2026, 8, 24); // month is 0-indexed → 9월

  it("① 202607·202606 0건, 202605 503(재시도도 실패), 202604 자료 있음 → 202604 채택", async () => {
    /** @type {Record<string, boolean | null>} */
    const data = { "202607": false, "202606": false, "202605": null, "202604": true };
    const probe = vi.fn(async (ym) => data[ym] ?? null);
    const result = await pickLatestAvailableMonth(probe, { now: NOW });
    expect(result.useYm).toBe("202604");
    expect(result.monthsBack).toBe(5);
    // 202607(1) + 202606(1) + 202605(재시도 포함 2) + 202604(1) = 5회
    expect(result.calls).toBe(5);
  });

  it("② 최근 8개월 모두 0건 → useYm null (본 조회 안 함)", async () => {
    const probe = vi.fn(async () => false);
    const result = await pickLatestAvailableMonth(probe, { now: NOW, maxBackMonths: 8 });
    expect(result.useYm).toBeNull();
    expect(result.monthsBack).toBe(-1);
    expect(probe).toHaveBeenCalledTimes(7); // back=2..8 → 7개월, 전부 false(재시도 없음)
  });

  it("③ 503 한 번 뒤 재시도 성공 → 그 달 채택", async () => {
    let callCount = 0;
    const probe = vi.fn(async (ym) => {
      callCount++;
      if (ym === "202607" && callCount === 1) return null; // 첫 시도 503
      if (ym === "202607" && callCount === 2) return true; // 재시도 성공
      return false;
    });
    const result = await pickLatestAvailableMonth(probe, { now: NOW });
    expect(result.useYm).toBe("202607");
    expect(result.monthsBack).toBe(2);
    expect(result.calls).toBe(2);
  });

  it("④ 표본 3곳 중 1곳만 자료 있음 → probe가 true를 주면 그 달 채택 (표본 순회는 probe 내부 책임)", async () => {
    const samples = ["ap-1", "ap-2", "ap-3"];
    /** @type {Record<string, Record<string, boolean>>} */
    const hasData = { "ap-3": { "202606": true } }; // ap-3만 202606에 자료
    const probe = vi.fn(async (ym) => {
      for (const s of samples) {
        if (hasData[s]?.[ym]) return true;
      }
      return false;
    });
    const result = await pickLatestAvailableMonth(probe, { now: NOW });
    expect(result.useYm).toBe("202606");
    expect(result.monthsBack).toBe(3);
  });

  it("모름(null)이 재시도 후에도 계속되면 다음 달로 계속 거슬러간다", async () => {
    /** @type {Record<string, boolean | null>} */
    const data = { "202607": null, "202606": null, "202605": true };
    const probe = vi.fn(async (ym) => data[ym] ?? null);
    const result = await pickLatestAvailableMonth(probe, { now: NOW });
    expect(result.useYm).toBe("202605");
    // 202607(재시도 2) + 202606(재시도 2) + 202605(1) = 5
    expect(result.calls).toBe(5);
  });
});

describe("aggregateHeatFuel — MODE 집계", () => {
  it("최빈값 반환", () => {
    const items = [
      { heatMethCdNm: "도시가스" },
      { heatMethCdNm: "도시가스" },
      { heatMethCdNm: "LPG" },
    ];
    expect(aggregateHeatFuel(items)).toBe("도시가스");
  });

  it("단일 값", () => {
    expect(aggregateHeatFuel([{ fuelCdNm: "지역난방" }])).toBe("지역난방");
  });

  it("빈 배열 → null", () => {
    expect(aggregateHeatFuel([])).toBeNull();
  });

  it("모든 값 null → null", () => {
    expect(aggregateHeatFuel([{ heatMethCdNm: null }, {}])).toBeNull();
  });
});

// ── main() 조회 월 탐지 실패 → collector_runs 하드닝 (검사관 지적, 세션568) ──
// housing-permits.mjs 패턴 답습: 실패 경로도 recordCollectorRun 을 남겨야 감시 ⑤ 사각이 없다.
describe("main() — 조회 월 탐지 실패 시 collector_runs 기록 하드닝", () => {
  it("표본 8개월 모두 자료 없음 → recordCollectorRun(status:failure) 1회 + exit(1)", async () => {
    recordCollectorRun.mockClear();
    // 가드 #6(limit) 통과 + 가드 #7(not→count, thenable) 통과 + 표본 조회(not→not→order→limit) 반환.
    // not() 결과가 "count 조회를 위해 await 되는 것"과 "표본 체인을 이어가는 것" 둘 다로 쓰이므로
    // thenable 겸 체이너블 객체 하나로 두 쓰임을 만족시킨다.
    const notResult = {
      then: (/** @type {any} */ resolve) => resolve({ count: 5, error: null }),
      not: () => ({
        order: () => ({
          limit: async () => ({
            data: [{ id: 1, bjd_code: "1168010100", lot_main: 1, lot_sub: 0 }],
            error: null,
          }),
        }),
      }),
    };
    const sb = {
      from: () => ({
        select: () => ({
          limit: async () => ({ data: [], error: null }), // 가드 #6
          not: () => notResult,
        }),
      }),
    };
    getSupabase.mockReturnValue(sb);

    // 표본 조회로 자료가 있는지 묻는 모든 hubApiCall 호출이 0건을 반환하도록.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response: { body: { items: [], totalCount: 0 } } }),
    })));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ ((/** @type {number} */ code) => {
      throw new Error(`__EXIT_${code}__`);
    }));

    await expect(main()).rejects.toThrow("__EXIT_1__");

    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "building-hub",
      expect.objectContaining({ status: "failure", ok: 0, fail: 1 }),
    );

    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
