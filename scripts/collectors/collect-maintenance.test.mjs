// @ts-check
/**
 * collect-maintenance.mjs 테스트 — 관리비 수집기 검증
 *
 * 대상: fetchBassInfo, fetchMaintenanceCost, main() 게이트 경로, 관리비 계산 로직, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    recordCollectorRun: vi.fn(),
  };
});

// _molit-api.mjs 모킹 — molitApiCall·fetchSidoAptList 제어
const mockMolitApiCall = vi.fn();
const mockFetchSidoAptList = vi.fn();
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, molitApiCall: mockMolitApiCall, fetchSidoAptList: mockFetchSidoAptList };
});
/** 원본 molitApiCall — fetchMaintenanceCost 시험은 이것을 거쳐 진짜 결과 코드 검사·재시도 경로를 지난다 */
const realMolit = /** @type {any} */ (await vi.importActual("./_molit-api.mjs"));

// fetch 전역 모킹 — 원본 molitApiCall 이 이 fetch 를 부른다
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { fetchBassInfo, fetchMaintenanceCost, budgetExceeded, sortByUpdatedAtAsc, maintUpdateRow, main } = await import("./collect-maintenance.mjs");
const { getSupabase, createReporter, recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));
const { KaptResultError } = realMolit;

// ── 팩토리 ───────────────────────────────────────────────────
/** molitApiCall 응답 팩토리 (fetchBassInfo용)
 * @param {any} kaptdaCnt @param {boolean} [useItems] @param {string} [usedate] */
function makeHouseholdsResponse(kaptdaCnt, useItems = false, usedate = undefined) {
  const item = kaptdaCnt != null ? { kaptdaCnt: String(kaptdaCnt), ...(usedate ? { kaptUsedate: usedate } : {}) } : null;
  if (useItems) {
    return { response: { body: { items: { item } } } };
  }
  return { response: { body: { item } } };
}

/** fetch 응답 팩토리 (fetchMaintenanceCost용 — 원본 molitApiCall 이 text() 로 읽는다)
 * @param {any} field @param {any} value @param {string} [resultCode] */
function makeCostResponse(field, value, resultCode = undefined) {
  const body = {
    response: { ...(resultCode ? { header: { resultCode } } : {}), body: { item: { [field]: String(value) } } },
  };
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function makeFailResponse(status = 500) {
  return { ok: false, status, json: () => Promise.resolve({}), text: () => Promise.resolve("") };
}

// ── fetchBassInfo (세션589: fetchTotalHouseholds → 세대수 + 사용승인일) ──────
describe("fetchBassInfo", () => {
  beforeEach(() => {
    mockMolitApiCall.mockReset();
  });

  it("정상 응답 (body.item) → 세대수 + 사용승인일", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(500, false, "20180629"));
    const result = await fetchBassInfo("K001");
    expect(result).toEqual({ households: 500, usedate: "20180629" });
  });

  it("정상 응답 (body.items.item) → 세대수 반환", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(300, true));
    const result = await fetchBassInfo("K002");
    expect(result?.households).toBe(300);
    expect(result?.usedate).toBeNull();
  });

  it("kaptdaCnt=0 → 세대수 null (무효)", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(0));
    const result = await fetchBassInfo("K003");
    expect(result?.households).toBeNull();
  });

  it("body null → null", async () => {
    mockMolitApiCall.mockResolvedValueOnce({ response: { body: null } });
    const result = await fetchBassInfo("K004");
    expect(result).toBeNull();
  });

  // 세션589 보완 B4(검사 A5): 옛 시험은 "throw → null(건너뜀)"을 정답으로 못 박았다 — 그 때문에 장애 회차가
  // 성공으로 기록됐다. 이제 던지고, main 이 실패로 세어 연속 5건이면 회차를 멈춘다.
  it("molitApiCall throw (재시도 소진·시간 초과·키 미등록) → 삼키지 않고 던진다", async () => {
    mockMolitApiCall.mockRejectedValueOnce(new Error("API 키 미등록"));
    await expect(fetchBassInfo("K005")).rejects.toThrow("API 키 미등록");
    expect(mockMolitApiCall).toHaveBeenCalledTimes(1);
  });

  it("K-apt 결과 코드 04 는 삼키지 않고 던진다 (세션589 R2 — 회차를 멈춰야 한다)", async () => {
    mockMolitApiCall.mockRejectedValueOnce(new KaptResultError("04", "HTTP_ERROR", "getAphusBassInfoV5"));
    await expect(fetchBassInfo("K006")).rejects.toBeInstanceOf(KaptResultError);
  });

  // 세션 451: households 호출도 8s/1retry 로 좁혀 hang 누적 차단 (cost endpoint 톤 일치).
  // 공유 상수(_molit-api MOLIT_TIMEOUT_MS=30000/MOLIT_MAX_RETRIES=3) 전역 변경 없이 maintenance-local opts 만.
  it("molitApiCall 에 8s timeout + 1 retry opts 를 전달 (hang 누적 차단)", async () => {
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(500));
    await fetchBassInfo("K010");
    const opts = mockMolitApiCall.mock.calls[0][5];
    expect(opts).toEqual({ timeoutMs: 8000, maxRetries: 1 });
  });
});

// ── fetchMaintenanceCost (W3 5 항목 분리 — object 구조) ────────
// 세션589: 직접 fetch → molitApiCall 경유(K-apt 1.5초 간격·결과 코드 검사). 시험은 **원본** molitApiCall 을
// 그대로 태워(mockImplementation) 그 아래의 fetch 만 바꾼다 — 실패 응답·throw 가 옛날처럼 그 항목 null 로
// 가는지와, 04 가 "자료 없음"으로 삼켜지지 않는지를 실제 경로로 본다.
describe("fetchMaintenanceCost", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockMolitApiCall.mockReset();
    mockMolitApiCall.mockImplementation(realMolit.molitApiCall);
  });

  it("결과 코드 04 → 자료 없음(null)으로 삼키지 않고 KaptResultError 를 던진다 (세션589 R2)", async () => {
    mockFetch.mockResolvedValue(makeCostResponse("heatP", 1000, "04"));
    await expect(fetchMaintenanceCost("K-04", "202508")).rejects.toBeInstanceOf(KaptResultError);
    // 첫 항목에서 3초·10초 뒤 두 번 다시 부르고(보완 B3) 그래도 04 면 던진다 — 나머지 4항목은 부르지 않는다
    expect(mockFetch).toHaveBeenCalledTimes(3);
    for (const c of mockFetch.mock.calls) expect(c[0]).toContain("getHsmpHeatCostInfoV3");
  });

  it("결과 코드 03(자료 없음) → 그 항목 null · 다른 항목은 그대로", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCostResponse("heatP", 1000, "03"))
      .mockResolvedValueOnce(makeCostResponse("waterHotP", 2000, "00"))
      .mockResolvedValueOnce(makeCostResponse("gasP", 3000))
      .mockResolvedValueOnce(makeCostResponse("electP", 4000))
      .mockResolvedValueOnce(makeCostResponse("waterCoolP", 5000));
    const result = await fetchMaintenanceCost("K-03", "202508");
    expect(result?.heat).toBeNull();
    expect(result?.hotwater).toBe(2000);
  });

  it("관리비 호출이 K-apt 간격·8초·1회 옵션으로 molitApiCall 을 탄다", async () => {
    for (const f of ["heatP", "waterHotP", "gasP", "electP", "waterCoolP"]) mockFetch.mockResolvedValueOnce(makeCostResponse(f, 1));
    await fetchMaintenanceCost("K-o", "202508");
    expect(mockMolitApiCall).toHaveBeenCalledTimes(5);
    expect(mockMolitApiCall.mock.calls[0][1]).toBe("https://apis.data.go.kr/1613000/AptIndvdlzManageCostServiceV3");
    expect(mockMolitApiCall.mock.calls[0][3]).toEqual({ pageNo: "1", numOfRows: "1", kaptCode: "K-o", searchDate: "202508" });
    expect(mockMolitApiCall.mock.calls[0][5]).toEqual({ timeoutMs: 8000, maxRetries: 1 });
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

  // 세션589 보완 B4(검사 A5): 옛 시험은 "다섯 항목 전부 실패 → null(건너뜀)"이었다 — 게이트웨이 장애가
  // "관리비 없음"으로 사라졌다. 이제 다섯 개 전부 호출 실패면 던진다(일부만 실패면 그 항목만 null — 위 시험).
  it("다섯 항목 전부 호출 실패 → 던진다(건너뜀으로 삼키지 않는다)", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeFailResponse(500));
    }
    await expect(fetchMaintenanceCost("K003", "202501")).rejects.toThrow("재시도 소진");
  });

  it("다섯 항목 전부 시간 초과·JSON 깨짐 → 던진다", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("AbortError: timeout"))
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("{깨진") })
      .mockRejectedValueOnce(new Error("AbortError: timeout"))
      .mockRejectedValueOnce(new Error("AbortError: timeout"))
      .mockRejectedValueOnce(new Error("AbortError: timeout"));
    await expect(fetchMaintenanceCost("K003b", "202501")).rejects.toThrow("AbortError");
  });

  it("호출은 됐는데 다섯 항목 다 자료 없음(item 없음) → null(실패 아님)", async () => {
    for (let i = 0; i < 5; i++) mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ response: { body: {} } })) });
    expect(await fetchMaintenanceCost("K003c", "202501")).toBeNull();
  });

  it("item null → null (anyValid=false)", async () => {
    // 세션589 보완: 옛 가짜 응답은 json() 만 있어 원본 molitApiCall 의 text() 에서 TypeError 가 났고, 그게 삼켜져
    // 우연히 null 이 됐다. 다섯 항목 전부 호출 실패는 이제 던지므로, 진짜 "item null" 응답을 준다.
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ response: { body: { item: null } } })),
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
    // V3 리터럴 고정 — 서비스 개편(2026-08-27 공지) 시 코드만 되돌아오면 red 나야 한다
    const endpoints = [
      "getHsmpHeatCostInfoV3",
      "getHsmpHotWaterCostInfoV3",
      "getHsmpGasRentalFeeInfoV3",
      "getHsmpElectricityCostInfoV3",
      "getHsmpWaterCostInfoV3",
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
    mockMolitApiCall.mockImplementation(realMolit.molitApiCall); // 관리비 호출은 원본 경로(세션589)
    mockFetch.mockReset();
  });

  it("fetchBassInfo + fetchMaintenanceCost → 5 항목 + 합산 세대당 산출", async () => {
    // 1. 세대수 조회 성공 (1000세대)
    mockMolitApiCall.mockResolvedValueOnce(makeHouseholdsResponse(1000));
    const households = (await fetchBassInfo("K001"))?.households ?? null;
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
    const households = (await fetchBassInfo("K100"))?.households ?? null;

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

  it("기본정보가 자료 없음(item 없음) → null → main 에서 skip (관리비 미계산)", async () => {
    // 세션589 보완 B4: 옛 시험은 timeout 을 null 로 받았다 — 이제 timeout 은 던지고(실패), 빈 응답만 null 이다.
    mockMolitApiCall.mockResolvedValueOnce({ response: { body: {} } });
    expect(await fetchBassInfo("K999")).toBeNull();
    mockMolitApiCall.mockRejectedValueOnce(new Error("timeout"));
    await expect(fetchBassInfo("K999")).rejects.toThrow("timeout");
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

// ── wall-clock budget (세션 447) ─────────────────────────────
describe("budgetExceeded — 벽시계 예산 판정", () => {
  const startedAt = 1_000_000; // 임의 기준 시각 (ms)

  it("예산 미초과 — false", () => {
    // 100분 예산, 50분 경과
    expect(budgetExceeded(startedAt, 100, startedAt + 50 * 60_000)).toBe(false);
  });

  it("예산 초과 — true", () => {
    // 100분 예산, 101분 경과
    expect(budgetExceeded(startedAt, 100, startedAt + 101 * 60_000)).toBe(true);
  });

  it("정확히 경계(=예산) — true (>=)", () => {
    expect(budgetExceeded(startedAt, 100, startedAt + 100 * 60_000)).toBe(true);
  });

  it("예산 0 = 비활성(무제한) — 아무리 경과해도 false", () => {
    expect(budgetExceeded(startedAt, 0, startedAt + 9999 * 60_000)).toBe(false);
  });

  it("예산 음수 = 비활성 — false", () => {
    expect(budgetExceeded(startedAt, -1, startedAt + 9999 * 60_000)).toBe(false);
  });
});

describe("wall-clock budget 박힘 (회귀 가드)", () => {
  const src = readFileSync(
    path.join(process.cwd(), "scripts/collectors/collect-maintenance.mjs"),
    "utf8",
  );

  it("본문에 budgetExceeded break 2 회 박힘 (외부 region + 내부 단지 loop)", () => {
    const matches = src.match(/if \(budgetExceeded\(startedAt, budgetMin\)\) \{ budgetHit = true; break; \}/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  // 세션589 보완 B8: 시도 목록 단계 → 짝 고르기 → 처리 단계로 나뉘어 "region loop" 가 없어졌다.
  // 옛 시험(`if (budgetHit) break;`)은 그 구조를 지켰다 — 이제 두 단계가 **각자** 예산을 본다(위 2회 시험)는 것과
  // 처리 단계 반복이 예산 검사를 단지마다 지나는지를 본다.
  it("처리 단계(짝이 붙은 단지 반복)가 단지마다 예산을 본다", () => {
    expect(src).toMatch(/for \(let i = 0; i < selected\.length; i\+\+\) \{[\s\S]{0,200}if \(budgetExceeded\(startedAt, budgetMin\)\) \{ budgetHit = true; break; \}/);
  });

  it("기본 예산 100분 (120분 job timeout 미만 — SIGKILL 레이스 회피)", () => {
    expect(src).toMatch(/DEFAULT_BUDGET_MIN = 100/);
  });
});

// ── sortByUpdatedAtAsc — 조회에서 클라이언트로 옮긴 정렬 (세션544) ──
/**
 * 옛 `.order("updated_at", { ascending: true, nullsFirst: true })` 를 그대로 재현해야 한다.
 * `--limit` 이 앞에서 자르므로 이 순서가 곧 "이번 회차에 어느 단지를 채우나" 다.
 */
describe("sortByUpdatedAtAsc — updated_at 오래된 순 (NULL 먼저)", () => {
  it("오래된 순으로 정렬한다", () => {
    const rows = [
      { id: "c", updated_at: "2026-03-01T00:00:00Z" },
      { id: "a", updated_at: "2026-01-01T00:00:00Z" },
      { id: "b", updated_at: "2026-02-01T00:00:00Z" },
    ];
    expect(sortByUpdatedAtAsc(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("NULL 이 가장 먼저 온다 (nullsFirst 재현 — 한 번도 안 채워진 단지 우선)", () => {
    const rows = [
      { id: "old", updated_at: "2026-01-01T00:00:00Z" },
      { id: "never", updated_at: null },
      { id: "new", updated_at: "2026-05-01T00:00:00Z" },
    ];
    expect(sortByUpdatedAtAsc(rows).map((r) => r.id)).toEqual(["never", "old", "new"]);
  });

  it("updated_at 동률은 id 로 갈라 회차마다 같은 순서가 나온다", () => {
    const same = "2026-04-01T00:00:00Z";
    const rows = [
      { id: "b2", updated_at: same },
      { id: "a1", updated_at: same },
      { id: "c3", updated_at: same },
    ];
    expect(sortByUpdatedAtAsc(rows).map((r) => r.id)).toEqual(["a1", "b2", "c3"]);
  });

  it("원본 배열을 바꾸지 않는다", () => {
    const rows = [{ id: "b", updated_at: "2026-02-01" }, { id: "a", updated_at: "2026-01-01" }];
    sortByUpdatedAtAsc(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("빈 배열도 안전", () => {
    expect(sortByUpdatedAtAsc([])).toEqual([]);
  });

  // ⚠️ 세션546 M5 — 문자열 사전순으로 되돌리면 red.
  // `+09:00` 표기는 같은 순간을 다른 글자로 적는다: "2026-04-01T09:00:00+09:00" == "2026-04-01T00:00:00Z".
  // 사전순은 "0…" < "2026-04-01T09…" 라 **더 뒤로** 밀어 "오래된 순" 전제를 깬다.
  it("★ 오프셋이 섞여도 실제 시각으로 정렬한다 (문자열 사전순이면 red)", () => {
    const rows = [
      { id: "kst_later", updated_at: "2026-04-01T18:00:00+09:00" }, // = 09:00Z
      { id: "utc_early", updated_at: "2026-04-01T03:00:00Z" },
      { id: "kst_early", updated_at: "2026-04-01T09:00:00+09:00" }, // = 00:00Z ← 가장 오래됨
    ];
    expect(sortByUpdatedAtAsc(rows).map((r) => r.id)).toEqual(["kst_early", "utc_early", "kst_later"]);
  });

  it("★ 같은 순간을 다른 표기로 적으면 동률 — id 로 갈린다", () => {
    const rows = [
      { id: "b", updated_at: "2026-04-01T09:00:00+09:00" },
      { id: "a", updated_at: "2026-04-01T00:00:00Z" },
    ];
    expect(sortByUpdatedAtAsc(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("파싱 안 되는 값은 NULL 과 같이 가장 앞 — 영영 안 채워지는 행을 만들지 않는다", () => {
    const rows = [
      { id: "ok", updated_at: "2026-04-01T00:00:00Z" },
      { id: "junk", updated_at: "알 수 없음" },
      { id: "nul", updated_at: null },
    ];
    const ids = sortByUpdatedAtAsc(rows).map((r) => r.id);
    expect(ids.slice(0, 2).sort()).toEqual(["junk", "nul"]); // 둘 다 앞(동률 → id 순)
    expect(ids[2]).toBe("ok");
  });
});

// ── 대상 조회는 고유키(id) 커서 (세션544) ──
describe("대상 조회 배선 — selectAll keyCol", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/collectors/collect-maintenance.mjs"), "utf8");

  it("selectAll 에 keyCol \"id\" 를 넘긴다 (무정렬 OFFSET 이면 2,900행 표에서 행이 샌다)", () => {
    // 좌변까지 고정해 함수 선언부·주석에 매칭되지 않게 한다 (guards-must-be-mutation-tested §소스 grep).
    expect(src).toMatch(/let targets = [\s\S]{0,80}await selectAll\(\(s\) => \{[\s\S]*?\}, sb, "id"\)\);/);
  });

  it("커서 키가 select 에 들어 있다 (없으면 selectAll 이 즉시 throw)", () => {
    expect(src).toMatch(/\.select\("id, name, region, gu, units, updated_at,/);
  });

  it("조회에는 .order 를 남기지 않는다 — 정렬 키와 커서 키가 어긋나면 행이 잘린다", () => {
    expect(src).not.toMatch(/q\.order\("updated_at"/);
  });
});

// ── K6 관리비는 값이 있는 칸만 쓴다 (세션589) ─────────────────────
// 옛 동작: 6칸을 무조건 써서 이번 달 항목이 비면 지난번 값을 null 로 지웠다.
describe("maintUpdateRow — null 로 덮지 않는다", () => {
  it("값이 있는 항목만 싣는다", () => {
    const row = maintUpdateRow(30, { heat: 10, hotwater: null, gas: 5, elec: null, water: 15 });
    expect(row.avg_maintenance_cost).toBe(30);
    expect(row.maint_heat).toBe(10);
    expect(row.maint_gas).toBe(5);
    expect(row.maint_water).toBe(15);
    expect("maint_hotwater" in row).toBe(false);
    expect("maint_elec" in row).toBe(false);
    expect(typeof row.updated_at).toBe("string");
  });
});

// ── main() 실전 경로 — V6·게이트·K4·K6·R2 (세션589 T5) ─────────────────
describe("main() — 세션589 게이트 실전 경로", () => {
  /** 2026-10-15 05:30 KST */
  const NOW = new Date("2026-10-14T20:30:00Z");
  /** @type {any} */
  let exitSpy;
  /** @type {{ ok: number; fail: number; skip: number }} */
  let counts;
  const LIST = [
    { kaptCode: "K-SDT", kaptName: "신동탄 롯데캐슬아파트", bjdCode: "4159510500", as1: "경기도", as2: "화성병점구", as3: "반월동" },
  ];
  /** @param {string} id @param {string|null} completion */
  const target = (id, completion) => ({ id, name: "신동탄롯데캐슬", region: "경기", gu: "화성시", units: null, updated_at: null,
    completion, bjd_code: "4159510500", avg_maintenance_cost: null, maint_heat: null, maint_hotwater: null, maint_gas: null, maint_elec: null, maint_water: null });

  /** @param {any[]} rows */
  function makeMainSb(rows) {
    /** @type {Array<{ id: string; row: any }>} */
    const updates = [];
    const sb = {
      from: () => ({
        select: () => ({ or: () => ({ order: () => ({ limit: () => ({
          gt: () => Promise.resolve({ data: [], error: null }),
          /** @param {any} res @param {any} rej */
          then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
        }) }) }) }),
        /** @param {any} row */
        update: (row) => ({ eq: (/** @type {string} */ _c, /** @type {string} */ id) => { updates.push({ id, row }); return Promise.resolve({ error: null }); } }),
      }),
    };
    return { sb, updates };
  }

  /**
   * @param {{ usedate?: string; costs?: Record<string, number | null>; costError?: Error }} o
   */
  function route(o) {
    const COST_FIELD = { getHsmpHeatCostInfoV3: "heatP", getHsmpHotWaterCostInfoV3: "waterHotP", getHsmpGasRentalFeeInfoV3: "gasP", getHsmpElectricityCostInfoV3: "electP", getHsmpWaterCostInfoV3: "waterCoolP" };
    mockMolitApiCall.mockImplementation(async (/** @type {string} */ _p, /** @type {string} */ _b, /** @type {string} */ ep) => {
      if (ep === "getAphusBassInfoV5") return { response: { body: { item: { kaptdaCnt: "100", kaptUsedate: o.usedate ?? "20180629" } } } };
      if (o.costError) throw o.costError;
      const f = /** @type {Record<string, string>} */ (COST_FIELD)[ep];
      const v = o.costs?.[f];
      return { response: { body: { item: v == null ? null : { [f]: String(v) } } } };
    });
  }

  beforeEach(() => {
    mockMolitApiCall.mockReset();
    mockFetchSidoAptList.mockReset();
    recordCollectorRun.mockClear();
    counts = { ok: 0, fail: 0, skip: 0 };
    createReporter.mockImplementation(() => ({
      success: (/** @type {number} */ n) => { counts.ok += n; },
      fail: (/** @type {number} */ n) => { counts.fail += n; },
      skip: (/** @type {number} */ n) => { counts.skip += n; },
      interrupted: () => false,
      summary: () => ({ elapsed: "0.0", ...counts, total: counts.ok + counts.fail + counts.skip, status: counts.fail > 0 ? "failure" : "success" }),
    }));
    exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
  });
  afterEach(() => { exitSpy.mockRestore(); });

  it("V6 — 입주 전·완공월 모름 단지는 대상에서 빠져 K-apt 를 부르지 않는다", async () => {
    const { sb, updates } = makeMainSb([target("pre", "202711"), target("nocomp", null), target("thismonth", "202610")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ costs: { heatP: 1_000_000 } });
    await main({ now: NOW });
    expect(mockFetchSidoAptList).not.toHaveBeenCalled();
    expect(mockMolitApiCall).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("입주 후 단지는 맞는 짝으로 쓰고, 이번 달 비어 있는 항목은 null 로 덮지 않는다(K6)", async () => {
    const { sb, updates } = makeMainSb([target("t1", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ costs: { heatP: 10_000_000, waterHotP: null, gasP: 5_000_000, electP: null, waterCoolP: 2_000_000 } });
    await main({ now: NOW });
    expect(updates).toHaveLength(1);
    const row = updates[0].row;
    expect(row.maint_heat).toBe(10);
    expect(row.maint_gas).toBe(5);
    expect(row.maint_water).toBe(2);
    expect("maint_hotwater" in row).toBe(false);
    expect("maint_elec" in row).toBe(false);
    expect(row.avg_maintenance_cost).toBe(17);
  });

  it("K4 — 사용승인일이 25개월 다르면 관리비를 부르지도 쓰지도 않는다", async () => {
    const { sb, updates } = makeMainSb([target("t1", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ usedate: "20200701", costs: { heatP: 10_000_000 } });
    await main({ now: NOW });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(1); // 기본정보만
    expect(updates).toEqual([]);
    expect(counts.skip).toBe(1);
  });

  it("R2 — 관리비 호출이 04 면 '자료 없음'으로 넘기지 않고 회차를 멈춘다(KAPT_RESULT_04)", async () => {
    const { sb, updates } = makeMainSb([target("a", "201806"), target("b", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ costError: new KaptResultError("04", "HTTP_ERROR", "getHsmpHeatCostInfoV3") });
    await main({ now: NOW });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(2); // a 의 기본정보 + 첫 관리비 → 멈춤(b 는 안 부름)
    expect(updates).toEqual([]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.status).toBe("failure");
    expect(rec.errorMessage).toMatch(/^KAPT_RESULT_04/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── main() — 세션589 보완(B1·B3·B4·B8·MA3·MA6) ─────────────────────────────
describe("main() — 2u 창 · 실패 판정 · --limit 은 짝이 붙은 단지만 (세션589 보완)", () => {
  /** 2026-10-15 05:30 KST — 창 밖 */
  const NOW = new Date("2026-10-14T20:30:00Z");
  /** @param {string} hhmm KST 2026-10-15 의 시각 */
  const kst = (hhmm) => new Date(`2026-10-15T${hhmm}:00+09:00`);
  const BJD = "4159510500";
  /** 짝이 붙는 이름 5개 + 경기 목록 */
  const NAMES = ["가람마을한신휴플러스", "나래울푸르지오", "다솔마을우남퍼스트빌", "라온프라이빗", "마루힐스테이트"];
  const LIST = NAMES.map((n, i) => ({ kaptCode: `K-${i}`, kaptName: n, bjdCode: BJD, as1: "경기도", as2: "화성병점구", as3: "반월동" }));
  /** @type {any} */
  let exitSpy;
  /** @type {{ ok: number; fail: number; skip: number }} */
  let counts;

  /**
   * @param {string} id @param {string} name @param {string | null} completion @param {string | null} updatedAt
   * @param {string} [region]
   */
  const row = (id, name, completion, updatedAt, region = "경기") => ({ id, name, region, gu: "화성시", units: null, updated_at: updatedAt,
    completion, bjd_code: BJD, avg_maintenance_cost: null, maint_heat: null, maint_hotwater: null, maint_gas: null, maint_elec: null, maint_water: null });

  /** @param {any[]} rows */
  function makeSb(rows) {
    /** @type {Array<{ id: string; row: any }>} */
    const updates = [];
    const sb = {
      from: () => ({
        select: () => ({ or: () => ({ order: () => ({ limit: () => ({
          gt: () => Promise.resolve({ data: [], error: null }),
          /** @param {any} res @param {any} rej */
          then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
        }) }) }) }),
        /** @param {any} r */
        update: (r) => ({ eq: (/** @type {string} */ _c, /** @type {string} */ id) => { updates.push({ id, row: r }); return Promise.resolve({ error: null }); } }),
      }),
    };
    return { sb, updates };
  }

  /**
   * K-apt 호출 흉내. `bassFail(kaptCode, n)` 이 오류를 돌려주면 그 기본정보 호출이 던진다(n = 몇 번째 기본정보 호출인지, 1부터).
   * @param {{ bassFail?: (kaptCode: string, n: number) => Error | null }} [o]
   */
  function route(o = {}) {
    let bassN = 0;
    mockMolitApiCall.mockImplementation(async (/** @type {string} */ _p, /** @type {string} */ _b, /** @type {string} */ ep, /** @type {any} */ params) => {
      if (ep === "getAphusBassInfoV5") {
        bassN++;
        const e = o.bassFail?.(params.kaptCode, bassN);
        if (e) throw e;
        return { response: { body: { item: { kaptdaCnt: "100", kaptUsedate: "20180629" } } } };
      }
      return { response: { body: { item: { heatP: "10000000", waterHotP: "1", gasP: "1", electP: "1", waterCoolP: "1" } } } };
    });
  }
  const bassCalls = () => mockMolitApiCall.mock.calls.filter((c) => c[2] === "getAphusBassInfoV5").map((c) => c[3].kaptCode);

  /** @param {string[]} extra */
  async function runMain(extra = [], opts = {}) {
    const before = process.argv.length;
    process.argv.push(...extra);
    try { await main({ now: NOW, ...opts }); } finally { process.argv.splice(before); }
  }

  beforeEach(() => {
    mockMolitApiCall.mockReset();
    mockFetchSidoAptList.mockReset();
    recordCollectorRun.mockClear();
    counts = { ok: 0, fail: 0, skip: 0 };
    createReporter.mockImplementation(() => ({
      success: (/** @type {number} */ n) => { counts.ok += n; },
      fail: (/** @type {number} */ n) => { counts.fail += n; },
      skip: (/** @type {number} */ n) => { counts.skip += n; },
      interrupted: () => false,
      summary: () => ({ elapsed: "0.0", ...counts, total: counts.ok + counts.fail + counts.skip, status: counts.fail > 0 ? "failure" : "success" }),
    }));
    exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
  });
  afterEach(() => { exitSpy.mockRestore(); });

  it("B8 — --limit=1 이면 짝이 안 붙는 (더 오래된) 단지는 자리를 안 차지하고 짝이 붙은 단지를 처리한다", async () => {
    const { sb, updates } = makeSb([
      row("nomatch", "전혀관계없는이름의단지", "201806", null), // 가장 오래됨(null) · 입주 후 · 짝 없음
      row("hit", NAMES[0], "201806", "2026-01-01T00:00:00Z"),
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route();
    await runMain(["--limit=1"]);
    expect(updates.map((u) => u.id)).toEqual(["hit"]);
    expect(counts.skip).toBe(1); // 짝 없음 1곳
  });

  it("MA3 — --limit=1 이면 입주 전 (더 오래된) 단지는 자르기 전에 빠져 자리를 안 차지한다", async () => {
    const { sb, updates } = makeSb([
      row("pre", NAMES[0], "202711", null), // 가장 오래됨 · 입주 전
      row("hit", NAMES[1], "201806", "2026-01-01T00:00:00Z"),
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route();
    await runMain(["--limit=1"]);
    expect(updates.map((u) => u.id)).toEqual(["hit"]);
    expect(bassCalls()).toEqual(["K-1"]);
  });

  it("B8 — 호출 수 상한은 그대로: --limit=2 면 짝이 붙은 2곳 × (기본정보 1 + 관리비 5) + 목록 1", async () => {
    const { sb, updates } = makeSb([
      row("x1", "전혀관계없는이름의단지", "201806", null),
      row("x2", "또다른엉뚱한이름단지", "201806", null),
      row("a", NAMES[0], "201806", "2026-01-01T00:00:00Z"),
      row("b", NAMES[1], "201806", "2026-01-02T00:00:00Z"),
      row("c", NAMES[2], "201806", "2026-01-03T00:00:00Z"),
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route();
    await runMain(["--limit=2"]);
    expect(updates.map((u) => u.id)).toEqual(["a", "b"]);
    expect(mockMolitApiCall).toHaveBeenCalledTimes(12);
    expect(mockFetchSidoAptList).toHaveBeenCalledTimes(1);
  });

  it("MA6 — 시도 목록이 04 면 회차를 멈춘다(다른 시도 목록·기본정보를 부르지 않는다)", async () => {
    const { sb, updates } = makeSb([row("a", NAMES[0], "201806", null), row("s", "서울단지", "201001", null, "서울")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockRejectedValue(new KaptResultError("04", "HTTP_ERROR", "getSidoAptList4"));
    route();
    await main({ now: NOW });
    expect(mockFetchSidoAptList).toHaveBeenCalledTimes(1);
    expect(mockMolitApiCall).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.status).toBe("failure");
    expect(rec.errorMessage).toMatch(/^KAPT_RESULT_04/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("B1 — 시작이 창 5분 전 안(06:16)이면 K-apt 를 부르지 않고 SIBLING_KAPT_WINDOW 로 남긴다", async () => {
    const { sb, updates } = makeSb([row("a", NAMES[0], "201806", null), row("b", NAMES[1], "201806", null)]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route();
    await main({ now: NOW, clock: () => kst("06:16") });
    expect(mockFetchSidoAptList).not.toHaveBeenCalled();
    expect(mockMolitApiCall).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.errorMessage).toMatch(/^SIBLING_KAPT_WINDOW/);
    expect(rec.status).toBe("success");
    expect(rec.skip).toBe(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("B1 — 06:14 에는 계속, 다음 단지 차례가 06:16 이면 그 자리에서 멈춘다(남은 단지는 skip)", async () => {
    const { sb, updates } = makeSb([row("a", NAMES[0], "201806", null), row("b", NAMES[1], "201806", "2026-01-01T00:00:00Z"), row("c", NAMES[2], "201806", "2026-01-02T00:00:00Z")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route();
    const times = [kst("06:10"), kst("06:14"), kst("06:16")]; // 목록 · 단지 a · 단지 b
    let k = 0;
    await main({ now: NOW, clock: () => times[Math.min(k++, times.length - 1)] });
    expect(updates.map((u) => u.id)).toEqual(["a"]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.errorMessage).toMatch(/^SIBLING_KAPT_WINDOW .*남은 2곳/);
    expect(rec.skip).toBe(2);
  });

  it("B4 — 결과 코드가 아닌 실패(시간 초과)를 실패로 세고, 연속 5건이면 KAPT_FETCH_FAIL 로 멈춘다", async () => {
    const rows = NAMES.map((n, i) => row(`r${i}`, n, "201806", `2026-01-0${i + 1}T00:00:00Z`));
    rows.push(row("r5", "가람마을한신휴플러스2단지", "201806", "2026-01-09T00:00:00Z"));
    const { sb, updates } = makeSb(rows);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue([...LIST, { kaptCode: "K-5", kaptName: "가람마을한신휴플러스2단지", bjdCode: BJD, as2: "화성병점구" }]);
    route({ bassFail: () => new Error("getAphusBassInfoV5: 1회 재시도 소진 (마지막 상태: 0)") });
    await main({ now: NOW });
    expect(bassCalls()).toHaveLength(5); // 여섯째는 부르지 않는다
    expect(updates).toEqual([]);
    expect(counts.fail).toBe(5);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.status).toBe("failure");
    expect(rec.errorMessage).toMatch(/^KAPT_FETCH_FAIL 연속 5건/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("B4 — 4건 실패 뒤 성공이 끼면 계속 간다(연속 수 초기화)", async () => {
    const { sb, updates } = makeSb(NAMES.map((n, i) => row(`r${i}`, n, "201806", `2026-01-0${i + 1}T00:00:00Z`)));
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ bassFail: (_c, n) => (n <= 4 ? new Error("AbortError: timeout") : null) });
    await main({ now: NOW });
    expect(updates.map((u) => u.id)).toEqual(["r4"]);
    expect(counts.fail).toBe(4);
    expect(recordCollectorRun.mock.calls.at(-1)[1].errorMessage ?? null).toBeNull();
  });

  it("B3 — 매개변수 코드(10)는 그 단지만 실패로 세고 다음 단지는 처리한다", async () => {
    const { sb, updates } = makeSb([row("a", NAMES[0], "201806", null), row("b", NAMES[1], "201806", "2026-01-01T00:00:00Z")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ bassFail: (c) => (c === "K-0" ? new KaptResultError("10", "INVALID_REQUEST_PARAMETER_ERROR", "getAphusBassInfoV5") : null) });
    await main({ now: NOW });
    expect(updates.map((u) => u.id)).toEqual(["b"]);
    expect(counts.fail).toBe(1);
  });

  it("B3 — fatal 코드(22)는 첫 단지에서 멈춘다", async () => {
    const { sb, updates } = makeSb([row("a", NAMES[0], "201806", null), row("b", NAMES[1], "201806", "2026-01-01T00:00:00Z")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    route({ bassFail: () => new KaptResultError("22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", "getAphusBassInfoV5") });
    await main({ now: NOW });
    expect(bassCalls()).toEqual(["K-0"]);
    expect(updates).toEqual([]);
    expect(recordCollectorRun.mock.calls.at(-1)[1].errorMessage).toMatch(/^KAPT_RESULT_22/);
  });
});
