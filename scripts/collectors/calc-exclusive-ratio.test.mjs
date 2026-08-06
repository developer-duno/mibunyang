// @ts-check
/**
 * calc-exclusive-ratio.mjs 테스트 — calcRatio 전용률 계산 검증
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** @type {any} */
let mockSb;
/** @type {any[][]} */
let selectAllResults;
const mockRecord = vi.fn();

// 외부 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: () => mockSb,
    log: vi.fn(),
    logError: vi.fn(),
    // selectAll 은 호출 순서대로 준비된 결과를 돌려준다 (1: 대상 아파트, 2+: prices 청크).
    selectAll: async () => selectAllResults.shift() ?? [],
    recordCollectorRun: (/** @type {any[]} */ ...args) => mockRecord(...args),
  };
});

const { calcRatio, main } = await import("./calc-exclusive-ratio.mjs");

describe("calcRatio", () => {
  // 정상 계산 — 전용면적 84.99 / 공급면적 114.8 = 74.0%
  it("정상 비율을 소수점 1자리로 반환한다", () => {
    expect(calcRatio(84.99, 114.8)).toBe(74.0);
  });

  // 전용률 100% — area === supply_area
  it("전용면적 = 공급면적 → 100.0%", () => {
    expect(calcRatio(60, 60)).toBe(100.0);
  });

  // 소수점 반올림 검증
  it("소수점 반올림이 정확하다", () => {
    // 59 / 84 = 70.238... → 70.2
    expect(calcRatio(59, 84)).toBe(70.2);
  });

  // null 처리
  it("area가 null이면 null을 반환한다", () => {
    expect(calcRatio(null, 100)).toBeNull();
  });

  it("supplyArea가 null이면 null을 반환한다", () => {
    expect(calcRatio(84, null)).toBeNull();
  });

  // 0 처리
  it("area가 0이면 null을 반환한다", () => {
    expect(calcRatio(0, 100)).toBeNull();
  });

  it("supplyArea가 0이면 null을 반환한다 (0 나누기 방지)", () => {
    expect(calcRatio(84, 0)).toBeNull();
  });

  // 음수 방어
  it("supplyArea가 음수이면 null을 반환한다", () => {
    expect(calcRatio(84, -10)).toBeNull();
  });

  // undefined
  it("undefined 입력은 null을 반환한다", () => {
    expect(calcRatio(undefined, 100)).toBeNull();
    expect(calcRatio(84, undefined)).toBeNull();
  });
});

// ── 실행 기록 (세션 495) ──────────────────────────────────────
// 이 수집기는 run-naver-local.bat 5/6 단계라 GitHub Actions run 이 없다.
// collector_runs 기록이 없으면 "돌았는데 대상 0" 과 "아예 안 돌았다" 를 구분할 방법이 0 이었다.
describe("main — collector_runs 기록", () => {
  beforeEach(() => { mockRecord.mockReset(); });

  /** @param {any} [updateError] */
  function makeSb(updateError = null) {
    return {
      from: () => ({
        update: () => ({ eq: async () => ({ error: updateError }) }),
      }),
    };
  }

  it("정상 실행이 excl-ratio 로 기록된다 (갱신 성공 = ok)", async () => {
    selectAllResults = [
      [{ id: "ap-1", name: "가나", exclusive_ratio: null }],
      [{ apartment_id: "ap-1", area: 84, supply_area: 114 }],
    ];
    mockSb = makeSb();
    await main();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [collector, result] = mockRecord.mock.calls[0];
    expect(collector).toBe("excl-ratio");
    expect(result.ok).toBe(1);
    expect(result.status).toBe("success");
  });

  it("대상 0건이어도 기록한다 (기록 없이 return 하면 '안 돌았다'와 구분 불가)", async () => {
    selectAllResults = [[]];
    mockSb = makeSb();
    await main();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toBe("excl-ratio");
  });

  it("prices 가 없는 단지는 skip 으로 센다 (장애 아님)", async () => {
    selectAllResults = [
      [{ id: "ap-1", name: "가나", exclusive_ratio: null }],
      [],
    ];
    mockSb = makeSb();
    await main();
    const [, result] = mockRecord.mock.calls[0];
    expect(result.skip).toBe(1);
    expect(result.fail).toBe(0);
    expect(result.status).toBe("success");
  });

  it("UPDATE 오류는 skip 이 아니라 fail 이다 (옛 코드는 둘을 한 숫자에 묻었다)", async () => {
    selectAllResults = [
      [{ id: "ap-1", name: "가나", exclusive_ratio: null }],
      [{ apartment_id: "ap-1", area: 84, supply_area: 114 }],
    ];
    mockSb = makeSb({ message: "RLS 거부" });
    await main();
    const [, result] = mockRecord.mock.calls[0];
    expect(result.fail).toBe(1);
    expect(result.skip).toBe(0);
    expect(result.status).toBe("failure");
  });
});
