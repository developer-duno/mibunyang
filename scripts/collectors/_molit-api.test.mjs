// @ts-check
/**
 * _molit-api.mjs 테스트 — 국토부 공동주택 API 공유 모듈 검증
 *
 * 대상: cleanName, findBestMatch, molitApiCall, fetchSidoAptList, 상수
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// _shared.mjs — loadEnv/getSupabase 차단, stringSimilarity는 실제 유지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    sleep: vi.fn(),
    log: vi.fn(),
  };
});

// fetch 전역 모킹
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const {
  cleanName, findBestMatch, molitApiCall, fetchSidoAptList,
  SIDO_CODE, MIN_SIMILARITY, REQUEST_DELAY,
  API_LIST_BASE, API_DETAIL_BASE,
  KAPT_MIN_INTERVAL_MS, KAPT_LIST_PAGE_SIZE, KaptResultError,
  KAPT_TRANSIENT_RETRY_DELAYS_MS, KAPT_MAX_CONSECUTIVE_FAILS, createKaptFailureGate, kaptTransientRetryCount,
} = await import("./_molit-api.mjs");
const { sleep } = /** @type {any} */ (await import("./_shared.mjs"));

// ── 헬퍼 ─────────────────────────────────────────────────────
function jsonRes(/** @type {any} */ body, /** @type {any} */ status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}
function xmlRes(/** @type {any} */ text, /** @type {any} */ status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  };
}
function errRes(/** @type {any} */ status) {
  return { ok: false, status, text: () => Promise.resolve("") };
}

// ── 상수 검증 ────────────────────────────────────────────────
describe("SIDO_CODE / 상수", () => {
  it("17개 시도 코드 + 서울·제주 스팟체크", () => {
    expect(Object.keys(SIDO_CODE)).toHaveLength(17);
    expect(SIDO_CODE["서울"]).toBe("11");
    expect(SIDO_CODE["제주"]).toBe("50");
  });

  it("MIN_SIMILARITY=0.5, REQUEST_DELAY=400", () => {
    expect(MIN_SIMILARITY).toBe(0.5);
    expect(REQUEST_DELAY).toBe(400);
  });
});

// ── cleanName ────────────────────────────────────────────────
describe("cleanName", () => {
  const cases = [
    [null, "", "null 입력"],
    [undefined, "", "undefined 입력"],
    ["상개동 (12단지)", "상개동", "괄호 내용 제거"],
    ["  래미안   원베일리  ", "래미안 원베일리", "공백 정리"],
    ["(전체삭제)", "", "전체가 괄호인 경우"],
    ["", "", "빈 문자열"],
  ];
  for (const [input, expected, label] of cases) {
    it(`${label}: "${input}" → "${expected}"`, () => {
      expect(cleanName(input)).toBe(expected);
    });
  }
});

// ── findBestMatch ────────────────────────────────────────────
describe("findBestMatch", () => {
  // 테스트용 단지 목록
  const aptList = [
    { kaptCode: "K001", kaptName: "래미안 원베일리", as1: "서울특별시", as2: "서초구", as3: "서초동" },
    { kaptCode: "K002", kaptName: "힐스테이트", as1: "경기도", as2: "수원시", as3: "영통구" },
    { kaptCode: "K003", kaptName: "전혀다른아파트", as1: "부산광역시", as2: "해운대구", as3: "중동" },
  ];

  it("완전 일치 시 score ≈ 1.0 반환", () => {
    const match = findBestMatch("래미안 원베일리", null, aptList);
    expect(match).not.toBeNull();
    expect(match?.kaptCode).toBe("K001");
    expect(match?.matchScore).toBeGreaterThanOrEqual(0.9);
  });

  it("유사 매칭 (≥0.5) 시 결과 반환", () => {
    const match = findBestMatch("래미안원베일리아파트", null, aptList);
    expect(match).not.toBeNull();
    expect(match?.kaptCode).toBe("K001");
  });

  it("유사도 < 0.5 이면 null 반환", () => {
    const match = findBestMatch("완전히다른이름xyz", null, aptList);
    expect(match).toBeNull();
  });

  it("빈 목록이면 null 반환", () => {
    expect(findBestMatch("래미안", null, [])).toBeNull();
  });

  // 옵션 조합 테스트
  const optCases = [
    ["guField='address' 보너스", "래미안 원베일리", "서초구", { guField: "address" }, true],
    ["guField='kaptName' 보너스", "힐스테이트", "힐스테이트", { guField: "kaptName", guBonus: 0.15 }, true],
    ["targetGu=null → 보너스 미적용", "래미안 원베일리", null, { guField: "address" }, true],
    ["attachScore=false → matchScore 없음", "래미안 원베일리", null, { attachScore: false }, false],
  ];
  for (const [label, name, gu, opts, hasScore] of optCases) {
    it(/** @type {any} */ (label), () => {
      const match = findBestMatch(/** @type {any} */ (name), /** @type {any} */ (gu), aptList, /** @type {any} */ (opts));
      if (hasScore === false) {
        expect(match).not.toBeNull();
        expect(match?.matchScore).toBeUndefined();
      } else {
        // 매칭 자체만 검증 (보너스 효과는 점수로 간접 확인)
        expect(match).not.toBeNull();
      }
    });
  }
});

// ── molitApiCall ─────────────────────────────────────────────
describe("molitApiCall", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("정상 JSON 응답 파싱 + URL 파라미터 검증", async () => {
    const body = { response: { body: { items: [{ kaptCode: "K001" }] } } };
    mockFetch.mockResolvedValueOnce(jsonRes(body));

    const result = await molitApiCall("test", API_DETAIL_BASE, "getAphusBassInfoV4", { kaptCode: "K001" }, "test-key");
    expect(result).toEqual(body);

    // URL에 serviceKey, type=json, kaptCode 포함 검증
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("serviceKey=test-key");
    expect(calledUrl).toContain("type=json");
    expect(calledUrl).toContain("kaptCode=K001");
  });

  // 재시도 시나리오: 상태별 백오프
  const retryCases = [
    [429, "429 Rate Limit"],
    [500, "500 서버 에러"],
    [503, "503 서비스 불가"],
  ];
  for (const [status, label] of retryCases) {
    it(`${label} → 재시도 후 성공`, async () => {
      const body = { response: { body: {} } };
      mockFetch
        .mockResolvedValueOnce(errRes(status))
        .mockResolvedValueOnce(jsonRes(body));

      const result = await molitApiCall("test", API_LIST_BASE, "getSidoAptList3", {}, "key");
      expect(result).toEqual(body);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  }

  // 4xx (429 제외) → NonRetryableError → 즉시 throw (재시도 안 함)
  it("4xx (403) → 즉시 throw (mockFetch 1회)", async () => {
    mockFetch.mockResolvedValue(errRes(403));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("HTTP 403");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // XML 에러 → NonRetryableError → 즉시 throw
  it("XML 응답 → 즉시 throw (mockFetch 1회)", async () => {
    mockFetch.mockResolvedValue(xmlRes('<?xml version="1.0"?><error>fail</error>'));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("XML 응답:");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("SERVICE_KEY 미등록 → 즉시 throw (mockFetch 1회)", async () => {
    mockFetch.mockResolvedValue(xmlRes("<error>SERVICE_KEY_IS_NOT_REGISTERED</error>"));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("API 키 미등록");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 3회 500 → break → 루프 후 throw "재시도 소진"
  it("3회 500 → 재시도 소진 후 throw", async () => {
    mockFetch.mockResolvedValue(errRes(500));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("재시도 소진");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // 3회 429 → break → 루프 후 throw "재시도 소진"
  it("3회 429 → 재시도 소진 후 throw", async () => {
    mockFetch.mockResolvedValue(errRes(429));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("재시도 소진");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // 타임아웃 — fetch reject → catch → 3회 후 throw
  it("타임아웃 → 3회 재시도 후 throw", async () => {
    mockFetch.mockRejectedValue(new Error("AbortError: timeout"));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("AbortError");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ── opts override (세션 451: collector-local timeout/retry 축소) ──
  // 공유 상수(MOLIT_TIMEOUT_MS=30000 / MOLIT_MAX_RETRIES=3) 를 호출처에서 좁힐 수 있어야 함.
  // molit-units·molit-building-info 는 opts 미전달 = 기존 30s×3 그대로(cross-collector 회귀 0).
  it("opts.maxRetries=1 → 500 에러 시 1회만 호출 후 throw", async () => {
    mockFetch.mockResolvedValue(errRes(500));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key", { maxRetries: 1 }))
      .rejects.toThrow("재시도 소진");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("opts 미전달 (기본) → 기존 3회 재시도 보존 (cross-collector 회귀 가드)", async () => {
    mockFetch.mockResolvedValue(errRes(500));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key"))
      .rejects.toThrow("재시도 소진");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("opts.maxRetries=2 → 2회 호출 후 throw", async () => {
    mockFetch.mockResolvedValue(errRes(503));
    await expect(molitApiCall("test", API_LIST_BASE, "ep", {}, "key", { maxRetries: 2 }))
      .rejects.toThrow("재시도 소진");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── fetchSidoAptList ─────────────────────────────────────────
describe("fetchSidoAptList", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("단일 페이지 (< 500건) → 전체 반환", async () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ kaptCode: `K${i}` }));
    mockFetch.mockResolvedValueOnce(jsonRes({
      response: { body: { totalCount: 3, items } },
    }));

    const result = await fetchSidoAptList("test", "11", "key");
    expect(result).toHaveLength(3);
    expect(result[0].kaptCode).toBe("K0");
  });

  // 세션589 R1: 쪽 크기 500 → 6000(경기 5,665건이 한 번에 온다 — 500씩 12콜이 K-apt 속도 제한을 앞당겼다).
  // 옛 시험은 500/502 였다 — 쪽 크기가 바뀌어 "가득 찬 쪽" 기준이 6000 이 됐다.
  it("다중 페이지(총 건수 > 6000) → 누적 반환 + 종료조건 검증", async () => {
    const page1 = Array.from({ length: 6000 }, (_, i) => ({ kaptCode: `A${i}` }));
    const page2 = [{ kaptCode: "B0" }, { kaptCode: "B1" }];

    mockFetch
      .mockResolvedValueOnce(jsonRes({ response: { body: { totalCount: 6002, items: page1 } } }))
      .mockResolvedValueOnce(jsonRes({ response: { body: { totalCount: 6002, items: page2 } } }));

    const result = await fetchSidoAptList("test", "11", "key");
    expect(result).toHaveLength(6002);
    expect(result[6000].kaptCode).toBe("B0");
    expect(mockFetch.mock.calls[1][0]).toContain("pageNo=2");
  });

  it("경기 규모(5,665건)는 numOfRows=6000 한 번으로 끝난다 (세션589 R1)", async () => {
    const items = Array.from({ length: 5665 }, (_, i) => ({ kaptCode: `G${i}` }));
    mockFetch.mockResolvedValueOnce(jsonRes({ response: { body: { totalCount: 5665, items } } }));
    const result = await fetchSidoAptList("test", "41", "key");
    expect(result).toHaveLength(5665);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain(`numOfRows=${KAPT_LIST_PAGE_SIZE}`);
    expect(KAPT_LIST_PAGE_SIZE).toBe(6000);
  });

  // 엣지케이스
  const edgeCases = [
    ["빈 응답 (totalCount=0) → []", { response: { body: { totalCount: 0, items: [] } } }, 0],
    ["단일 아이템 (비배열) → 배열 래핑", { response: { body: { totalCount: 1, items: { item: { kaptCode: "X" } } } } }, 1],
  ];
  for (const [label, json, expectedLen] of edgeCases) {
    it(/** @type {any} */ (label), async () => {
      mockFetch.mockResolvedValueOnce(jsonRes(json));
      const result = await fetchSidoAptList("test", "11", "key");
      expect(result).toHaveLength(/** @type {any} */ (expectedLen));
    });
  }
});

// ── 전남광주통합특별시 (2026-07-01) — 세션545 ─────────────────
// 시도 목록 API(getSidoAptList4) 는 "46"·"29" 에 0건, "12" 에 1,758건을 준다(raw 실측 2026-09-10).
// 키는 17개 그대로 두고 값만 바꾼다 — 소비처가 region 별로 도는 구조라 키를 줄이면 그 지역이 통째로 빠진다.
describe("SIDO_CODE — 전남광주통합특별시 (세션545)", () => {
  it("광주·전남이 같은 '12'", () => {
    expect(SIDO_CODE["광주"]).toBe("12");
    expect(SIDO_CODE["전남"]).toBe("12");
  });

  it("옛 코드 29·46 은 어느 지역에도 안 남아 있다", () => {
    expect(Object.values(SIDO_CODE)).not.toContain("29");
    expect(Object.values(SIDO_CODE)).not.toContain("46");
  });

  it("키는 여전히 17개 (지역이 줄어든 게 아니라 코드를 공유할 뿐)", () => {
    expect(Object.keys(SIDO_CODE)).toHaveLength(17);
    expect(new Set(Object.values(SIDO_CODE)).size).toBe(16);
  });
});

// ── 강원·전북 시도 코드 (세션589 V7) ─────────────────────────────
// 강원 2023-06 → 51 · 전북 2024-01 → 52. 옛 42·45 는 K-apt 목록이 0건이라 두 도가 통째로 빠져 있었다
// (조사반 G 실측). 첫 회차에 강원 67·전북 41곳이 처음 매칭 대상이 된다 — 게이트를 지난 짝만 붙는다.
describe("SIDO_CODE — 강원 51 · 전북 52 (세션589)", () => {
  it("강원 '51' · 전북 '52'", () => {
    expect(SIDO_CODE["강원"]).toBe("51");
    expect(SIDO_CODE["전북"]).toBe("52");
  });
  it("옛 코드 42·45 는 어느 지역에도 안 남아 있다", () => {
    expect(Object.values(SIDO_CODE)).not.toContain("42");
    expect(Object.values(SIDO_CODE)).not.toContain("45");
  });
});

// ── K-apt 호출 간격 1.5초 (세션589 R1) ───────────────────────────
// 2u 인계(2026-10-01): 0.3초 간격이면 33번째 콜부터 약 10분간 K-apt 전체가 04. 1.5초는 400콜·10분 통과.
// 간격은 모듈 안 "마지막 K-apt 호출 시각" 기준이라 세 서비스(목록·기본정보·관리비)가 함께 지킨다.
describe("K-apt 호출 간격 (KAPT_MIN_INTERVAL_MS)", () => {
  beforeEach(() => { mockFetch.mockReset(); sleep.mockClear(); });

  it("1500ms 로 고정", () => { expect(KAPT_MIN_INTERVAL_MS).toBe(1500); });

  it("같은 시각에 연달아 부르면 두 번째 호출 전에 1500ms 를 기다린다", async () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(9_000_000_000_000);
    try {
      mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "00" }, body: {} } }));
      await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: "A1" }, "k");
      expect(sleep).not.toHaveBeenCalledWith(1500);
      await molitApiCall("t", API_LIST_BASE, "getSidoAptList4", { sidoCode: "41" }, "k");
      expect(sleep).toHaveBeenCalledWith(1500);
    } finally { spy.mockRestore(); }
  });

  it("직전 호출에서 1000ms 지났으면 나머지 500ms 만 기다린다 · 1500ms 넘게 지났으면 안 기다린다", async () => {
    let t = 9_100_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => t);
    try {
      mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "00" }, body: {} } }));
      await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: "A1" }, "k");
      t += 1000;
      sleep.mockClear();
      await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: "A2" }, "k");
      expect(sleep).toHaveBeenCalledWith(500);
      t += 2000;
      sleep.mockClear();
      await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: "A3" }, "k");
      expect(sleep).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("관리비 서비스(AptIndvdlzManageCostServiceV3)도 같은 간격을 탄다", async () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(9_200_000_000_000);
    try {
      mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "00" }, body: {} } }));
      const COST = "https://apis.data.go.kr/1613000/AptIndvdlzManageCostServiceV3";
      await molitApiCall("t", COST, "getHsmpHeatCostInfoV3", {}, "k");
      await molitApiCall("t", COST, "getHsmpGasRentalFeeInfoV3", {}, "k");
      expect(sleep).toHaveBeenCalledWith(1500);
    } finally { spy.mockRestore(); }
  });

  it("K-apt 가 아닌 서비스(건축HUB 등)는 간격을 안 탄다", async () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(9_300_000_000_000);
    try {
      mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "00" }, body: {} } }));
      const HUB = "https://apis.data.go.kr/1613000/BldEngyHubService";
      await molitApiCall("t", HUB, "ep", {}, "k");
      await molitApiCall("t", HUB, "ep", {}, "k");
      expect(sleep).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

// ── 결과 코드 검사 (세션589 R2) ──────────────────────────────────
// 옛 동작: HTTP 200 + JSON 이면 그대로 돌려줘 04(속도 제한)가 "목록 0건·건너뛰기"로 사라졌다.
// 코드 위치 = 정상 모양 response.header.resultCode · 오류 봉투 cmmMsgHeader.returnReasonCode(JSON/XML).
// 코드 뜻 = 2u backend/crawler/kapt_api.py (03 = 자료 없음만 빈 결과).
describe("molitApiCall — 결과 코드", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  // 세션589 보완(검사 C2·A6): 옛 시험은 "재시도 없이 즉시(fetch 1회)"였다. 2u 는 04 를 간헐 오류로 보고
  // 3·10·30초 재시도한다(kapt_api.py:150-156) — 우리는 3초·10초 뒤 두 번 다시 부르고 그래도 같으면 던진다.
  it("resultCode 04 가 계속 오면 3초·10초 뒤 두 번 다시 부른 뒤 KaptResultError(코드 04 · 일시 오류)", async () => {
    mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "04", resultMsg: "HTTP_ERROR" }, body: {} } }));
    const err = await molitApiCall("t", API_LIST_BASE, "getSidoAptList4", {}, "k").catch((e) => e);
    expect(err).toBeInstanceOf(KaptResultError);
    expect(err.code).toBe("04");
    expect(err.transient).toBe(true);
    expect(err.message).toMatch(/^KAPT_RESULT_04/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("오류 봉투(OpenAPI_ServiceResponse.cmmMsgHeader) 04 → KaptResultError", async () => {
    mockFetch.mockResolvedValue(jsonRes({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "HTTP_ERROR", returnAuthMsg: "HTTP 에러", returnReasonCode: "04" } } }));
    const err = await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch((e) => e);
    expect(err).toBeInstanceOf(KaptResultError);
    expect(err.code).toBe("04");
  });

  it("최상위 cmmMsgHeader 22(한도 초과) → KaptResultError(일시 오류 아님)", async () => {
    mockFetch.mockResolvedValue(jsonRes({ cmmMsgHeader: { errMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", returnReasonCode: 22 } }));
    const err = await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch((e) => e);
    expect(err).toBeInstanceOf(KaptResultError);
    expect(err.code).toBe("22");
    expect(err.transient).toBe(false);
  });

  it("XML 오류 봉투의 returnReasonCode 05 → KaptResultError", async () => {
    mockFetch.mockResolvedValue(xmlRes("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICETIMEOUT_ERROR</returnAuthMsg><returnReasonCode>05</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"));
    const err = await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch((e) => e);
    expect(err).toBeInstanceOf(KaptResultError);
    expect(err.code).toBe("05");
    expect(err.transient).toBe(true);
  });

  it("resultCode 03(자료 없음) → 예외 없이 빈 결과", async () => {
    mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "03", resultMsg: "NODATA_ERROR" }, body: { item: { kaptCode: "X" } } } }));
    const json = /** @type {any} */ (await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k"));
    expect(json?.response?.body?.item).toBeUndefined();
  });

  it("목록에서 03 → 빈 목록(실패 아님)", async () => {
    mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "03" }, body: { totalCount: 5, items: [{ kaptCode: "X" }] } } }));
    expect(await fetchSidoAptList("t", "41", "k")).toEqual([]);
  });

  it("목록에서 04 → 빈 목록으로 삼키지 않고 던진다", async () => {
    mockFetch.mockResolvedValue(jsonRes({ response: { header: { resultCode: "04" }, body: { totalCount: 0, items: [] } } }));
    await expect(fetchSidoAptList("t", "41", "k")).rejects.toBeInstanceOf(KaptResultError);
  });

  it("resultCode 00(문자열·숫자 0) → 그대로", async () => {
    const body = { response: { header: { resultCode: 0 }, body: { item: { kaptCode: "X" } } } };
    mockFetch.mockResolvedValue(jsonRes(body));
    expect(await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k")).toEqual(body);
  });
});

// ── 결과 코드 나누기 (세션589 보완 B3 · 검사 C2·A6) ───────────────────
// 출처 = 2u backend/crawler/kapt_api.py:150-156 — 재시도 = {01,02,04,05,99}(대기 3·10·30초),
// 10·11·12·20·21·22·30·31·32·33 은 재시도 안 함. 우리는 일시 코드만 3초·10초 뒤 두 번 다시 부른다.
describe("molitApiCall — 일시 코드 재시도 · 코드 종류", () => {
  beforeEach(() => { mockFetch.mockReset(); sleep.mockClear(); });
  const rc = (/** @type {string} */ code) => jsonRes({ response: { header: { resultCode: code }, body: { item: { kaptCode: "X" } } } });

  it("재시도 대기 = 3초·10초", () => {
    expect(KAPT_TRANSIENT_RETRY_DELAYS_MS).toEqual([3000, 10000]);
  });

  for (const code of ["01", "02", "04", "05", "99"]) {
    it(`${code} 다음 00 → 3초 쉬고 다시 불러 성공`, async () => {
      mockFetch.mockResolvedValueOnce(rc(code)).mockResolvedValueOnce(rc("00"));
      const json = /** @type {any} */ (await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k"));
      expect(json.response.body.item.kaptCode).toBe("X");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(3000);
    });
  }

  it("04·04·00 → 3초·10초 쉬고 세 번째에 성공", async () => {
    mockFetch.mockResolvedValueOnce(rc("04")).mockResolvedValueOnce(rc("04")).mockResolvedValueOnce(rc("00"));
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(sleep).toHaveBeenCalledWith(10000);
  });

  it("관리비처럼 maxRetries=1 로 좁힌 호출도 일시 코드 재시도는 한다(HTTP 재시도 횟수와 따로)", async () => {
    mockFetch.mockResolvedValueOnce(rc("04")).mockResolvedValueOnce(rc("00"));
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k", { timeoutMs: 8000, maxRetries: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  for (const code of ["10", "11"]) {
    it(`${code}(매개변수 오류) → 재시도 없이 KaptResultError(kind=param)`, async () => {
      mockFetch.mockResolvedValue(rc(code));
      const err = await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch((e) => e);
      expect(err).toBeInstanceOf(KaptResultError);
      expect(err.kind).toBe("param");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  }

  for (const code of ["12", "20", "21", "22", "30", "31", "32", "33", "77"]) {
    it(`${code} → 재시도 없이 KaptResultError(kind=fatal)`, async () => {
      mockFetch.mockResolvedValue(rc(code));
      const err = await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch((e) => e);
      expect(err).toBeInstanceOf(KaptResultError);
      expect(err.kind).toBe("fatal");
      expect(err.transient).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  }

  it("03 은 재시도 없이 빈 결과", async () => {
    mockFetch.mockResolvedValue(rc("03"));
    const json = /** @type {any} */ (await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k"));
    expect(json.response.body.item).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 재검사 🟡2 — 일시 코드 재시도로 더 나간 호출은 수집기의 논리 호출 수에 안 잡힌다. 모듈 누적 카운터로 센다
  // (수집기는 회차 시작 값과의 차이를 쿼터 기록에 더한다). 논리 호출 1 + 재시도 2 = 3 = fetch 횟수.
  it("04·04·00 이면 재시도 누적 카운터가 2 늘어난다(논리 1 + 재시도 2 = 실제 호출 3)", async () => {
    const base = kaptTransientRetryCount();
    mockFetch.mockResolvedValueOnce(rc("04")).mockResolvedValueOnce(rc("04")).mockResolvedValueOnce(rc("00"));
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k");
    expect(kaptTransientRetryCount() - base).toBe(2);
    expect(1 + (kaptTransientRetryCount() - base)).toBe(mockFetch.mock.calls.length);
  });

  it("04 가 끝까지 와서 던져도 재시도 2회는 센다 · 10(재시도 없음)·00 은 0", async () => {
    let base = kaptTransientRetryCount();
    mockFetch.mockResolvedValue(rc("04"));
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch(() => {});
    expect(kaptTransientRetryCount() - base).toBe(2);
    base = kaptTransientRetryCount();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(rc("10"));
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k").catch(() => {});
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(rc("00"));
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", {}, "k");
    expect(kaptTransientRetryCount() - base).toBe(0);
  });
});

// ── 한 회차의 연속 실패 판정 (세션589 보완 B3·B4 · 검사 A5·A6) ──────────
describe("createKaptFailureGate — 단지만 실패 · 연속 5건이면 중단", () => {
  it("연속 한도 = 5", () => { expect(KAPT_MAX_CONSECUTIVE_FAILS).toBe(5); });

  it("10·11 은 그 단지만 실패 — 다섯 번째 연속에서 중단(KAPT_RESULT_10)", () => {
    const g = createKaptFailureGate();
    const e = new KaptResultError("10", "INVALID_REQUEST_PARAMETER_ERROR", "getAphusBassInfoV5");
    for (let i = 0; i < 4; i++) expect(g.failure(e)).toBeNull();
    expect(g.failure(e)).toMatch(/^KAPT_RESULT_10 .*연속 5건/);
  });

  it("성공이 끼면 연속 수가 0 으로 돌아간다", () => {
    const g = createKaptFailureGate();
    const e = new KaptResultError("11", null, "ep");
    for (let i = 0; i < 4; i++) g.failure(e);
    g.success();
    for (let i = 0; i < 4; i++) expect(g.failure(e)).toBeNull();
  });

  it("결과 코드가 아닌 실패(재시도 소진·시간 초과·HTML·JSON 깨짐)도 연속 5건이면 KAPT_FETCH_FAIL", () => {
    const g = createKaptFailureGate();
    expect(g.failure(new Error("ep: 3회 재시도 소진 (마지막 상태: 429)"))).toBeNull();
    expect(g.failure(new Error("AbortError: timeout"))).toBeNull();
    expect(g.failure(new Error("XML 응답: <html>"))).toBeNull();
    expect(g.failure(new SyntaxError("Unexpected token"))).toBeNull();
    expect(g.failure(new Error("AbortError: timeout"))).toMatch(/^KAPT_FETCH_FAIL 연속 5건/);
  });

  it("일시 코드(재시도까지 소진)·그 밖의 코드는 첫 번에 중단", () => {
    expect(createKaptFailureGate().failure(new KaptResultError("04", null, "ep"))).toMatch(/^KAPT_RESULT_04/);
    expect(createKaptFailureGate().failure(new KaptResultError("22", null, "ep"))).toMatch(/^KAPT_RESULT_22/);
    expect(createKaptFailureGate().failure(new KaptResultError("12", null, "ep"))).toMatch(/^KAPT_RESULT_12/);
  });
});

// ── 실제 호출 간격 (세션589 보완 B5·B10 · 검사 A2·MA1·MA7) ──────────────
// 가상 시계: Date.now = t, sleep(ms) 는 다음 차례에 t 를 (호출 시각 + ms) 까지 민다. fetch 가 불린 시각을 적어
// 실제 간격을 잰다(sleep 이 불렸는지가 아니라 **나간 시각**을 본다).
describe("K-apt 실제 호출 간격 — 가상 시계", () => {
  /** @type {number} */
  let t;
  /** @type {number[]} */
  let calls;
  /** @type {any} */
  let spy;
  beforeEach(() => {
    t = 9_500_000_000_000;
    calls = [];
    spy = vi.spyOn(Date, "now").mockImplementation(() => t);
    mockFetch.mockReset();
    sleep.mockReset();
    sleep.mockImplementation((/** @type {number} */ ms) => {
      const target = t + ms;
      return new Promise((r) => setImmediate(() => { if (t < target) t = target; r(undefined); }));
    });
  });
  afterEach(() => { spy.mockRestore(); sleep.mockReset(); });
  const ok = () => { calls.push(t); return Promise.resolve(jsonRes({ response: { header: { resultCode: "00" }, body: {} } })); };
  /** @param {number[]} xs */
  const gaps = (xs) => xs.slice(1).map((x, i) => x - xs[i]);

  it("동시에 3번 불러도 1.5초 간격으로 차례대로 나간다(줄 세우기)", async () => {
    mockFetch.mockImplementation(ok);
    await Promise.all([1, 2, 3].map((i) => molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: `C${i}` }, "k")));
    expect(calls).toHaveLength(3);
    for (const g of gaps(calls)) expect(g).toBeGreaterThanOrEqual(KAPT_MIN_INTERVAL_MS);
  });

  it("호출 사이에 다른 대기(0.4초)가 끼어도 실제 간격 ≥ 1.5초 — '마지막 호출 시각'은 기다린 뒤에 적는다(MA7)", async () => {
    mockFetch.mockImplementation(ok);
    for (let i = 0; i < 4; i++) {
      await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: `S${i}` }, "k");
      t += 400; // 수집기의 REQUEST_DELAY 같은 다른 대기
    }
    expect(calls).toHaveLength(4);
    for (const g of gaps(calls)) expect(g).toBeGreaterThanOrEqual(KAPT_MIN_INTERVAL_MS);
  });

  it("HTTP 재시도도 1.5초 간격을 지킨다(MA1 — 500 뒤 1초 백오프만으로는 부족)", async () => {
    mockFetch
      .mockImplementationOnce(() => { calls.push(t); return Promise.resolve(errRes(500)); })
      .mockImplementationOnce(ok);
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: "R" }, "k");
    expect(calls).toHaveLength(2);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(KAPT_MIN_INTERVAL_MS);
  });

  it("일시 코드 재시도는 3초·10초 뒤에 나간다", async () => {
    const r04 = () => { calls.push(t); return Promise.resolve(jsonRes({ response: { header: { resultCode: "04" }, body: {} } })); };
    mockFetch.mockImplementationOnce(r04).mockImplementationOnce(r04).mockImplementationOnce(ok);
    await molitApiCall("t", API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode: "T" }, "k");
    expect(gaps(calls)[0]).toBeGreaterThanOrEqual(3000);
    expect(gaps(calls)[1]).toBeGreaterThanOrEqual(10000);
  });
});
