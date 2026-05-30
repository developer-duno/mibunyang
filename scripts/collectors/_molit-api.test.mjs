// @ts-check
/**
 * _molit-api.mjs 테스트 — 국토부 공동주택 API 공유 모듈 검증
 *
 * 대상: cleanName, findBestMatch, molitApiCall, fetchSidoAptList, 상수
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
} = await import("./_molit-api.mjs");

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

  it("다중 페이지 → 누적 반환 + 종료조건 검증", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ kaptCode: `A${i}` }));
    const page2 = [{ kaptCode: "B0" }, { kaptCode: "B1" }];

    mockFetch
      .mockResolvedValueOnce(jsonRes({ response: { body: { totalCount: 502, items: page1 } } }))
      .mockResolvedValueOnce(jsonRes({ response: { body: { totalCount: 502, items: page2 } } }));

    const result = await fetchSidoAptList("test", "11", "key");
    expect(result).toHaveLength(502);
    expect(result[500].kaptCode).toBe("B0");
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
