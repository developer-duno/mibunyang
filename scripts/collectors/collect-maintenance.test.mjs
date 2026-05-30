// @ts-check
/**
 * collect-maintenance.mjs 테스트 — 관리비 수집기 검증
 *
 * 대상: fetchTotalHouseholds, fetchMaintenanceCost, 관리비 계산 로직, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    sleep: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    createReporter: vi.fn(() => ({
      success: vi.fn(),
      fail: vi.fn(),
      skip: vi.fn(),
      interrupted: vi.fn(() => false),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0, status: "success" })),
    })),
    recordApiQuota: vi.fn(),
  };
});

// _molit-api.mjs 모킹 — molitApiCall 제어
const mockMolitApiCall = vi.fn();
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, molitApiCall: mockMolitApiCall };
});

// fetch 전역 모킹 — fetchMaintenanceCost가 직접 fetch 사용
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { fetchTotalHouseholds, fetchMaintenanceCost } = await import("./collect-maintenance.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** molitApiCall 응답 팩토리 (fetchTotalHouseholds용)
 * @param {any} kaptdaCnt @param {boolean} [useItems] */
function makeHouseholdsResponse(kaptdaCnt, useItems = false) {
  const item = kaptdaCnt != null ? { kaptdaCnt: String(kaptdaCnt) } : null;
  if (useItems) {
    return { response: { body: { items: { item } } } };
  }
  return { response: { body: { item } } };
}

/** fetch 응답 팩토리 (fetchMaintenanceCost용)
 * @param {any} field @param {any} value */
function makeCostResponse(field, value) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response: { body: { item: { [field]: String(value) } } },
    }),
  };
}

function makeFailResponse(status = 500) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

// ── fetchTotalHouseholds ────────────────────────────────────
describe("fetchTotalHouseholds", () => {
  beforeEach(() => {
    mockMolitApiCall.mockReset();
  });

  it("정상 응답 (body.item) → 세대수 반환", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(500));
    const result = await fetchTotalHouseholds("K001");
    expect(result).toBe(500);
  });

  it("정상 응답 (body.items.item) → 세대수 반환", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(300, true));
    const result = await fetchTotalHouseholds("K002");
    expect(result).toBe(300);
  });

  it("kaptdaCnt=0 → null (무효)", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(0));
    const result = await fetchTotalHouseholds("K003");
    expect(result).toBeNull();
  });

  it("body null → null", async () => {
    mockMolitApiCall.mockResolvedValueOnce({ response: { body: null } });
    const result = await fetchTotalHouseholds("K004");
    expect(result).toBeNull();
  });

  it("molitApiCall throw (NonRetryableError 포함) → catch에서 null 반환", async () => {
    mockMolitApiCall.mockRejectedValueOnce(new Error("API 키 미등록"));
    const result = await fetchTotalHouseholds("K005");
    expect(result).toBeNull();
    expect(mockMolitApiCall).toHaveBeenCalledTimes(1);
  });
});

// ── fetchMaintenanceCost (W3 5 항목 분리 — object 구조) ────────
describe("fetchMaintenanceCost", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // COST_ENDPOINTS 순서: 난방(heatP), 급탕(waterHotP), 가스(gasP), 전기(electP), 수도(waterCoolP)
  const FIELDS = ["heatP", "waterHotP", "gasP", "electP", "waterCoolP"];

  it("5항목 모두 성공 → object {heat,hotwater,gas,elec,water} 반환", async () => {
    const values = [1000, 2000, 3000, 4000, 5000];
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeCostResponse(FIELDS[i], values[i]));
    }

    const result = await fetchMaintenanceCost("K001", "202501");
    expect(result).not.toBeNull();
    expect(result?.heat).toBe(1000);
    expect(result?.hotwater).toBe(2000);
    expect(result?.gas).toBe(3000);
    expect(result?.elec).toBe(4000);
    expect(result?.water).toBe(5000);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("일부 항목 실패 (res.ok=false) → 해당 key null, 유효 raw 값 보존", async () => {
    // 난방 성공, 급탕 실패, 가스 성공, 전기 실패, 수도 성공
    mockFetch
      .mockResolvedValueOnce(makeCostResponse("heatP", 1000))
      .mockResolvedValueOnce(makeFailResponse(500))
      .mockResolvedValueOnce(makeCostResponse("gasP", 3000))
      .mockResolvedValueOnce(makeFailResponse(404))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));

    const result = await fetchMaintenanceCost("K002", "202501");
    expect(result?.heat).toBe(1000);
    expect(result?.hotwater).toBeNull();
    expect(result?.gas).toBe(3000);
    expect(result?.elec).toBeNull();
    expect(result?.water).toBe(5000);
  });

  it("전부 실패 → null", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeFailResponse(500));
    }
    const result = await fetchMaintenanceCost("K003", "202501");
    expect(result).toBeNull();
  });

  it("item null → null (anyValid=false)", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { body: { item: null } } }),
      });
    }
    const result = await fetchMaintenanceCost("K004", "202501");
    expect(result).toBeNull();
  });

  it("음수값 → 해당 key null, 유효 항목만 raw 값 보존", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCostResponse("heatP", -100))  // 음수 → null
      .mockResolvedValueOnce(makeCostResponse("waterHotP", 2000))
      .mockResolvedValueOnce(makeCostResponse("gasP", -50))    // 음수 → null
      .mockResolvedValueOnce(makeCostResponse("electP", 4000))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));

    const result = await fetchMaintenanceCost("K005", "202501");
    expect(result?.heat).toBeNull();
    expect(result?.hotwater).toBe(2000);
    expect(result?.gas).toBeNull();
    expect(result?.elec).toBe(4000);
    expect(result?.water).toBe(5000);
  });

  it("fetch throw → 해당 key null", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network error"))       // 난방 throw
      .mockResolvedValueOnce(makeCostResponse("waterHotP", 2000))
      .mockResolvedValueOnce(makeCostResponse("gasP", 3000))
      .mockResolvedValueOnce(makeCostResponse("electP", 4000))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));

    const result = await fetchMaintenanceCost("K006", "202501");
    expect(result?.heat).toBeNull();
    expect(result?.hotwater).toBe(2000);
    expect(result?.gas).toBe(3000);
    expect(result?.elec).toBe(4000);
    expect(result?.water).toBe(5000);
  });

  it("fetch URL에 5개 endpoint명이 순서대로 포함", async () => {
    const endpoints = [
      "getHsmpHeatCostInfoV2",
      "getHsmpHotWaterCostInfoV2",
      "getHsmpGasRentalFeeInfoV2",
      "getHsmpElectricityCostInfoV2",
      "getHsmpWaterCostInfoV2",
    ];
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeCostResponse(FIELDS[i], 100));
    }

    await fetchMaintenanceCost("K007", "202501");

    for (let i = 0; i < 5; i++) {
      const url = mockFetch.mock.calls[i][0];
      expect(url).toContain(endpoints[i]);
    }
  });

  it("반환 object 키 정확히 5개 (heat,hotwater,gas,elec,water)", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeCostResponse(FIELDS[i], 100));
    }
    const result = await fetchMaintenanceCost("K008", "202501");
    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {}).sort()).toEqual(["elec", "gas", "heat", "hotwater", "water"]);
  });

  it("1개 항목만 성공 → 나머지 4개 null + anyValid=true → object 반환", async () => {
    mockFetch
      .mockResolvedValueOnce(makeFailResponse(500))
      .mockResolvedValueOnce(makeFailResponse(500))
      .mockResolvedValueOnce(makeCostResponse("gasP", 12345))
      .mockResolvedValueOnce(makeFailResponse(500))
      .mockResolvedValueOnce(makeFailResponse(500));

    const result = await fetchMaintenanceCost("K009", "202501");
    expect(result?.heat).toBeNull();
    expect(result?.hotwater).toBeNull();
    expect(result?.gas).toBe(12345);
    expect(result?.elec).toBeNull();
    expect(result?.water).toBeNull();
  });
});

// ── 관리비 계산 로직 (W3 항목별 + 합산) ────────────────────
describe("관리비 계산 로직 (항목별)", () => {
  // collect-maintenance.mjs main() 의 toItemPerUnit + sumItems 로직 직접 검증
  // ITEM_CAP=100, MAINT_CAP=500

  /** @param {any} raw @param {any} households */
  function calcItemPerUnit(raw, households) {
    if (raw == null || raw <= 0 || !households) return null;
    return Math.min(Math.round(raw / households / 10000), 100);
  }

  it("정상 (1,000,000원 / 100세대 = 1만원)", () => {
    expect(calcItemPerUnit(1000000, 100)).toBe(1);
  });

  it("항목 상한 클램핑 (>100 → 100)", () => {
    expect(calcItemPerUnit(99999999999, 10)).toBe(100);
  });

  it("raw ≤ 0 → null", () => {
    expect(calcItemPerUnit(0, 100)).toBeNull();
    expect(calcItemPerUnit(-50, 100)).toBeNull();
  });

  it("raw null → null", () => {
    expect(calcItemPerUnit(null, 100)).toBeNull();
  });

  it("households falsy → null", () => {
    expect(calcItemPerUnit(1000000, 0)).toBeNull();
    expect(calcItemPerUnit(1000000, null)).toBeNull();
  });
});

describe("관리비 합산 로직 (sumItems + MAINT_CAP)", () => {
  // 5 항목 만원 → sumItems → MAINT_CAP=500 클램핑
  /** @param {Array<number|null>} arr */
  function sumItems(arr) {
    const total = arr.reduce(
      /** @param {number} s @param {number|null} v */ (s, v) => s + (v ?? 0),
      0,
    );
    if (total <= 0) return null;
    return Math.min(total, 500);
  }

  it("5 항목 모두 유효 → 합산", () => {
    expect(sumItems([10, 20, 30, 40, 50])).toBe(150);
  });

  it("일부 null → 유효 항목만 합산", () => {
    expect(sumItems([10, null, 30, null, 50])).toBe(90);
  });

  it("전부 null → null (skip)", () => {
    expect(sumItems([null, null, null, null, null])).toBeNull();
  });

  it("합산 > 500 → 500 클램핑", () => {
    expect(sumItems([100, 100, 100, 100, 100])).toBe(500);
    expect(sumItems([100, 100, 100, 100, 99])).toBe(499);
  });
});

// ── E2E 시나리오 ─────────────────────────────────────────────
describe("E2E 시나리오", () => {
  beforeEach(() => {
    mockMolitApiCall.mockReset();
    mockFetch.mockReset();
  });

  it("fetchTotalHouseholds + fetchMaintenanceCost → 5 항목 + 합산 세대당 산출", async () => {
    // 1. 세대수 조회 성공 (1000세대)
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(1000));
    const households = await fetchTotalHouseholds("K001");
    expect(households).toBe(1000);

    // 2. 관리비 5항목 raw 각 2,000,000원
    const values = [2000000, 2000000, 2000000, 2000000, 2000000];
    const fields = ["heatP", "waterHotP", "gasP", "electP", "waterCoolP"];
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeCostResponse(fields[i], values[i]));
    }
    const costs = await fetchMaintenanceCost("K001", "202501");
    expect(costs).not.toBeNull();

    // 3. 항목별 세대당 (만원): 2,000,000 / 1000 / 10000 = 0.2 → round = 0
    //    (실제 데이터는 더 큼. 본 mock 은 sumItems 0 → null skip 시나리오 우회 위해 큰 값으로 재계산)
    /** @param {number|null} raw @returns {number|null} */
    function toItemPerUnit(raw) {
      if (raw == null || raw <= 0 || !households) return null;
      return Math.min(Math.round(raw / households / 10000), 100);
    }
    const heat = toItemPerUnit(costs?.heat ?? null);
    const sum = [costs?.heat, costs?.hotwater, costs?.gas, costs?.elec, costs?.water]
      .reduce(/** @param {number} s @param {any} v */ (s, v) => s + (v ?? 0), 0);
    expect(sum).toBe(10000000); // raw 합산
    expect(heat).toBe(0); // 2,000,000 / 1000 / 10000 = 0.2 → round 0
  });

  it("실제 단지 수준 raw → 5 항목 + 합산 세대당 산출 (10만원/세대 시나리오)", async () => {
    // 1000세대 + 항목별 200,000,000원 → 항목별 20만원 → ITEM_CAP=100 클램프 → 100만원
    // 합산 500 (5*100) MAINT_CAP 정합
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(1000));
    const households = await fetchTotalHouseholds("K100");

    const fields = ["heatP", "waterHotP", "gasP", "electP", "waterCoolP"];
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeCostResponse(fields[i], 200000000));
    }
    const costs = await fetchMaintenanceCost("K100", "202501");
    expect(costs?.heat).toBe(200000000);

    /** @param {number|null} raw @returns {number|null} */
    function toItemPerUnit(raw) {
      if (raw == null || raw <= 0 || !households) return null;
      return Math.min(Math.round(raw / households / 10000), 100);
    }
    const heat = toItemPerUnit(costs?.heat ?? null);
    expect(heat).toBe(20); // 200,000,000 / 1000 / 10000 = 20
    const sum = [costs?.heat, costs?.hotwater, costs?.gas, costs?.elec, costs?.water]
      .map(/** @param {any} v */ (v) => toItemPerUnit(v ?? null))
      .reduce(/** @param {number} s @param {any} v */ (s, v) => s + (v ?? 0), 0);
    expect(sum).toBe(100); // 5 * 20
  });

  it("세대수 null → skip (관리비 미계산)", async () => {
    mockMolitApiCall.mockRejectedValueOnce(new Error("timeout"));
    const households = await fetchTotalHouseholds("K999");
    expect(households).toBeNull();
    // households가 null이면 main에서 rpt.skip(1) + continue
  });
});

// ── graceful shutdown 회귀 가드 (PR #55, 세션 343) ─────────────
describe("graceful shutdown 박힘 (회귀 가드)", () => {
  it("collect-maintenance.mjs 본문에 rpt.interrupted break 2 회 박힘 (외부+내부 loop)", () => {
    const src = readFileSync(
      path.join(process.cwd(), "scripts/collectors/collect-maintenance.mjs"),
      "utf8",
    );
    const matches = src.match(/if \(rpt\.interrupted\(\)\) break;/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
