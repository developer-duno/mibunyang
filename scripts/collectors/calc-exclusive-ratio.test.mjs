// @ts-check
/**
 * calc-exclusive-ratio.mjs 테스트 — calcRatio 전용률 계산 검증
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

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

  // ── 값 게이트(세션538) — **유형별 잣대**로 거른다 ────────────────────────
  // 이 수집기의 현재 write 대상은 0건이다(전용률 null 550곳 중 prices 재료 보유 0곳,
  // 세션538 실측). 즉 이 게이트는 즉시 효과가 아니라 선제 방어라 아래는 합성 케이스다.
  //
  // ⚠️ 60~90 은 **아파트 잣대**다. 이 수집기의 재료(prices presale_min)는 네이버 분양 API 의
  //    전용/공급면적이라 오피스텔에서도 진짜 전용률이고, 실측상 오피스텔은 54~59%가 정상이다
  //    (라이브 16건). 그래서 픽스처에 presale_housing_type 을 반드시 명시한다 — 유형을 빼면
  //    "유형 미상" 분기(정의상 한계만)로 떨어져 게이트를 검사하지 못한다.
  it("아파트인데 계산값이 상한(90) 초과면 skip 으로 세고 UPDATE 를 호출하지 않는다", async () => {
    // 95 / 100 = 95.0% — 아파트에서 공용면적이 사실상 0이라 불가능(실측: 루첸시아 93.9 등)
    selectAllResults = [
      [{ id: "ap-1", name: "다라", exclusive_ratio: null, presale_housing_type: "아파트" }],
      [{ apartment_id: "ap-1", area: 95, supply_area: 100 }],
    ];
    const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    mockSb = { from: () => ({ update: updateSpy }) };
    await main();
    expect(updateSpy).not.toHaveBeenCalled();
    const [, result] = mockRecord.mock.calls[0];
    expect(result.skip).toBe(1);
    expect(result.ok).toBe(0);
    expect(result.fail).toBe(0);
    expect(result.status).toBe("success");
  });

  it("아파트인데 계산값이 하한(60) 미만이면 skip 으로 센다", async () => {
    // 50 / 100 = 50.0% — 아파트 잣대 밖(실측: 아파트 라벨 6건이 54~55.7%로 오염 의심)
    selectAllResults = [
      [{ id: "ap-1", name: "마바", exclusive_ratio: null, presale_housing_type: "아파트" }],
      [{ apartment_id: "ap-1", area: 50, supply_area: 100 }],
    ];
    const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    mockSb = { from: () => ({ update: updateSpy }) };
    await main();
    expect(updateSpy).not.toHaveBeenCalled();
    const [, result] = mockRecord.mock.calls[0];
    expect(result.skip).toBe(1);
    expect(result.ok).toBe(0);
  });

  it("오피스텔의 58% 는 정상이라 UPDATE 를 호출한다 (아파트 잣대를 대면 안 된다)", async () => {
    // 라이브 실측: 중화역라온프라이빗센트로(오) 44.01/75.93 = 58.0%
    selectAllResults = [
      [{ id: "ap-1", name: "라온(오)", exclusive_ratio: null, presale_housing_type: "오피스텔" }],
      [{ apartment_id: "ap-1", area: 44.01, supply_area: 75.93 }],
    ];
    const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    mockSb = { from: () => ({ update: updateSpy }) };
    await main();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, result] = mockRecord.mock.calls[0];
    expect(result.ok).toBe(1);
    expect(result.skip).toBe(0);
  });

  it("오피스텔이어도 100% 는 정의상 불가능이라 skip 한다", async () => {
    // 전용 = 공급 → 주거공용 0. 어떤 유형에서도 나올 수 없다.
    selectAllResults = [
      [{ id: "ap-1", name: "불가능(오)", exclusive_ratio: null, presale_housing_type: "오피스텔" }],
      [{ apartment_id: "ap-1", area: 76.62, supply_area: 76.62 }],
    ];
    const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    mockSb = { from: () => ({ update: updateSpy }) };
    await main();
    expect(updateSpy).not.toHaveBeenCalled();
    const [, result] = mockRecord.mock.calls[0];
    expect(result.skip).toBe(1);
  });

  it("경계값(정확히 60, 90)은 타당 범위 — UPDATE 를 호출한다", async () => {
    // 60 / 100 = 60.0% (하한 포함)
    selectAllResults = [
      [{ id: "ap-1", name: "경계", exclusive_ratio: null, presale_housing_type: "아파트" }],
      [{ apartment_id: "ap-1", area: 60, supply_area: 100 }],
    ];
    const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    mockSb = { from: () => ({ update: updateSpy }) };
    await main();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, result] = mockRecord.mock.calls[0];
    expect(result.ok).toBe(1);
    expect(result.skip).toBe(0);
  });
});

// ── 배선 가드 ────────────────────────────────────────────────────────────────
// 위 행동 테스트는 selectAll 을 mock 하므로 **실제 SELECT 문에 유형 컬럼이 있는지**를 못 본다.
// 그 컬럼이 빠지면 apt.presale_housing_type 이 항상 undefined 가 되어 게이트가 조용히
// "유형 미상"(정의상 한계만) 으로 퇴화한다 — 테스트는 전부 초록인 채로.
describe("배선 가드 (세션538)", () => {
  const src = readFileSync(new URL("./calc-exclusive-ratio.mjs", import.meta.url), "utf8");

  it("대상 SELECT 가 presale_housing_type 을 함께 읽는다", () => {
    // 문자열 리터럴 조각으로 고정한다 — 단순히 "presale_housing_type" 만 찾으면 아래
    // 게이트 호출 줄이나 주석에 오매칭돼 SELECT 에서 빠져도 초록이 된다.
    expect(src).toContain('"id, name, exclusive_ratio, presale_housing_type"');
  });

  it("게이트가 유형을 인자로 받는다 (유형 무시형으로 되돌아가지 않는다)", () => {
    expect(src).toMatch(/if\s*\(!isPlausibleExclRatioFor\(\s*ratio\s*,\s*apt\.presale_housing_type\s*\)\)/);
  });
});
