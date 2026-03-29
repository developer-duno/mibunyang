/**
 * collect-maintenance.mjs 테스트 — 관리비 수집기 검증
 *
 * 대상: fetchTotalHouseholds, fetchMaintenanceCost, 관리비 계산 로직, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
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
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
    recordApiQuota: vi.fn(),
  };
});

// _molit-api.mjs 모킹 — molitApiCall 제어
const mockMolitApiCall = vi.fn();
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, molitApiCall: mockMolitApiCall };
});

// fetch 전역 모킹 — fetchMaintenanceCost가 직접 fetch 사용
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { fetchTotalHouseholds, fetchMaintenanceCost } = await import("./collect-maintenance.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** molitApiCall 응답 팩토리 (fetchTotalHouseholds용) */
function makeHouseholdsResponse(kaptdaCnt, useItems = false) {
  const item = kaptdaCnt != null ? { kaptdaCnt: String(kaptdaCnt) } : null;
  if (useItems) {
    return { response: { body: { items: { item } } } };
  }
  return { response: { body: { item } } };
}

/** fetch 응답 팩토리 (fetchMaintenanceCost용) */
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

// ── fetchMaintenanceCost ────────────────────────────────────
describe("fetchMaintenanceCost", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // COST_ENDPOINTS 순서: 난방(heatP), 급탕(waterHotP), 가스(gasP), 전기(electP), 수도(waterCoolP)
  const FIELDS = ["heatP", "waterHotP", "gasP", "electP", "waterCoolP"];

  it("5항목 모두 성공 → 합산값 반환", async () => {
    const values = [1000, 2000, 3000, 4000, 5000];
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeCostResponse(FIELDS[i], values[i]));
    }

    const result = await fetchMaintenanceCost("K001", "202501");
    expect(result).toBe(15000); // 1000+2000+3000+4000+5000
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("일부 항목 실패 (res.ok=false) → 유효 항목만 합산", async () => {
    // 난방 성공, 급탕 실패, 가스 성공, 전기 실패, 수도 성공
    mockFetch
      .mockResolvedValueOnce(makeCostResponse("heatP", 1000))
      .mockResolvedValueOnce(makeFailResponse(500))
      .mockResolvedValueOnce(makeCostResponse("gasP", 3000))
      .mockResolvedValueOnce(makeFailResponse(404))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));

    const result = await fetchMaintenanceCost("K002", "202501");
    expect(result).toBe(9000); // 1000+3000+5000
  });

  it("전부 실패 → null", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeFailResponse(500));
    }
    const result = await fetchMaintenanceCost("K003", "202501");
    expect(result).toBeNull();
  });

  it("item null → 건너뜀 (validCount 미증가)", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { body: { item: null } } }),
      });
    }
    const result = await fetchMaintenanceCost("K004", "202501");
    expect(result).toBeNull();
  });

  it("음수값 → 무시 (합산에서 제외)", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCostResponse("heatP", -100))  // 음수 → 무시
      .mockResolvedValueOnce(makeCostResponse("waterHotP", 2000))
      .mockResolvedValueOnce(makeCostResponse("gasP", -50))    // 음수 → 무시
      .mockResolvedValueOnce(makeCostResponse("electP", 4000))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));

    const result = await fetchMaintenanceCost("K005", "202501");
    expect(result).toBe(11000); // 2000+4000+5000
  });

  it("fetch throw → 해당 항목 건너뜀", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network error"))       // 난방 throw
      .mockResolvedValueOnce(makeCostResponse("waterHotP", 2000))
      .mockResolvedValueOnce(makeCostResponse("gasP", 3000))
      .mockResolvedValueOnce(makeCostResponse("electP", 4000))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));

    const result = await fetchMaintenanceCost("K006", "202501");
    expect(result).toBe(14000); // 2000+3000+4000+5000
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
});

// ── 관리비 계산 로직 (단위 테스트) ──────────────────────────
describe("관리비 계산 로직", () => {
  // 계산: Math.round(totalCost / totalHouseholds / 10000), 클램핑 0~500
  // collect-maintenance.mjs 162-166행의 로직을 직접 검증

  function calcPerUnit(totalCost, totalHouseholds) {
    if (totalCost == null || totalCost <= 0 || !totalHouseholds) return null;
    const MAINT_CAP = 500;
    const rawPerUnit = Math.round(totalCost / totalHouseholds / 10000);
    return Math.min(Math.max(0, rawPerUnit), MAINT_CAP);
  }

  it("정상 계산 (5,000,000원 / 500세대 = 1만원)", () => {
    expect(calcPerUnit(5000000, 500)).toBe(1);
  });

  it("상한 클램핑 (>500 → 500)", () => {
    expect(calcPerUnit(100000000000, 10)).toBe(500);
  });

  it("totalCost ≤ 0 → null (skip)", () => {
    expect(calcPerUnit(0, 500)).toBeNull();
    expect(calcPerUnit(-100, 500)).toBeNull();
  });

  it("totalHouseholds falsy → null (skip)", () => {
    expect(calcPerUnit(5000000, 0)).toBeNull();
    expect(calcPerUnit(5000000, null)).toBeNull();
  });
});

// ── E2E 시나리오 ─────────────────────────────────────────────
describe("E2E 시나리오", () => {
  beforeEach(() => {
    mockMolitApiCall.mockReset();
    mockFetch.mockReset();
  });

  it("fetchTotalHouseholds + fetchMaintenanceCost → 세대당 관리비 산출", async () => {
    // 1. 세대수 조회 성공 (1000세대)
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(1000));
    const households = await fetchTotalHouseholds("K001");
    expect(households).toBe(1000);

    // 2. 관리비 5항목 합산 (10,000,000원)
    const values = [2000000, 2000000, 2000000, 2000000, 2000000];
    for (let i = 0; i < 5; i++) {
      const fields = ["heatP", "waterHotP", "gasP", "electP", "waterCoolP"];
      mockFetch.mockResolvedValueOnce(makeCostResponse(fields[i], values[i]));
    }
    const totalCost = await fetchMaintenanceCost("K001", "202501");
    expect(totalCost).toBe(10000000);

    // 3. 세대당 관리비: 10,000,000 / 1000 / 10000 = 1만원
    const perUnit = Math.min(Math.max(0, Math.round(totalCost / households / 10000)), 500);
    expect(perUnit).toBe(1);
  });

  it("세대수 null → skip (관리비 미계산)", async () => {
    mockMolitApiCall.mockRejectedValueOnce(new Error("timeout"));
    const households = await fetchTotalHouseholds("K999");
    expect(households).toBeNull();
    // households가 null이면 main에서 rpt.skip(1) + continue
  });
});
