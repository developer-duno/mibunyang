// @ts-check
/**
 * collect-jeonse-price-index.mjs 테스트 — KOSIS DT_30404_B013 전세가격지수 파싱 검증
 *
 * 대상: parseKabRows(rows, regionGuMap)
 * 환각 차단: C1_NM='아파트' 필터, C2 코드 prefix 시도 판정, 권역 트리에서
 *           시군구행만 추출(집계/시도/권역/세부행정구 버림), 동명 시군구 구분,
 *           C2_NM 약칭 ↔ regions.gu 정식명 접미사 매칭, 월간 base_month 6자리
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithRetryMock = vi.fn();

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    upsertBatch: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
    fetchWithRetry: (/** @type {any[]} */ ...args) => fetchWithRetryMock(...args),
  };
});

process.env.KOSIS_KEY = "test-key";

const { parseKabRows, main } = await import("./collect-jeonse-price-index.mjs");
const { recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));

/**
 * @param {string} c1Nm  C1_NM (주택유형: 종합/아파트/연립다세대/단독주택)
 * @param {string} c2    C2 코드 (부동산원 권역 트리)
 * @param {string} c2Nm  C2_NM (지역명)
 * @param {string} prd   PRD_DE (월간 YYYYMM)
 * @param {string|number} value  DT
 * @param {string} [itm]  ITM_NM
 */
function makeRow(c1Nm, c2, c2Nm, prd, value, itm = "전세가격") {
  return { C1_NM: c1Nm, C2: c2, C2_NM: c2Nm, ITM_NM: itm, PRD_DE: prd, DT: String(value) };
}

/**
 * 테스트용 regionGuMap 빌더.
 * @param {Record<string, string[]>} obj  region → gu 명 배열
 * @returns {Map<string, Set<string>>}
 */
function makeRegionGuMap(obj) {
  const m = new Map();
  for (const [region, gus] of Object.entries(obj)) m.set(region, new Set(gus));
  return m;
}

const DEFAULT_MAP = makeRegionGuMap({
  서울: ["종로구", "중구", "용산구"],
  경기: ["수원시", "과천시", "안양시"],
  부산: ["중구", "서구"],
});

describe("parseKabRows (DT_30404_B013 전세가격지수)", () => {
  it("빈 배열 → matched 빈 배열", () => {
    expect(parseKabRows([], DEFAULT_MAP)).toEqual({ matched: [], unmatched: [], skipped: 0 });
  });

  it("정상 아파트 시군구 행 → region/gu/base_month/jeonse_price_index 추출", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a7010101", "종로", "202601", 102.5)],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([
      { region: "서울", gu: "종로구", base_month: "202601", jeonse_price_index: 102.5 },
    ]);
  });

  it("C2 prefix 로 시도 판정 (a7→서울, a8→경기, b1→부산)", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a7010101", "종로", "202601", 102.5),
        makeRow("아파트", "a80203", "수원", "202601", 98.3),
        makeRow("아파트", "b10101", "중", "202601", 95.1),
      ],
      DEFAULT_MAP,
    );
    expect(result.matched).toContainEqual(
      { region: "서울", gu: "종로구", base_month: "202601", jeonse_price_index: 102.5 },
    );
    expect(result.matched).toContainEqual(
      { region: "경기", gu: "수원시", base_month: "202601", jeonse_price_index: 98.3 },
    );
    expect(result.matched).toContainEqual(
      { region: "부산", gu: "중구", base_month: "202601", jeonse_price_index: 95.1 },
    );
  });

  it("C1_NM '아파트' 외(종합/연립다세대/단독주택) → matched 미포함", () => {
    const result = parseKabRows(
      [
        makeRow("종합", "a7010101", "종로", "202601", 100),
        makeRow("연립다세대", "a7010101", "종로", "202601", 100),
        makeRow("단독주택", "a7010101", "종로", "202601", 100),
        makeRow("아파트", "a7010101", "종로", "202601", 102.5),
      ],
      DEFAULT_MAP,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.jeonse_price_index).toBe(102.5);
  });

  it("집계행 prefix(a0/a1/a2/a4/a6/d1/d2) → skipped 증가, matched 미포함", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a0", "전국", "202601", 100),
        makeRow("아파트", "a1", "수도권", "202601", 100),
        makeRow("아파트", "a2", "지방", "202601", 100),
        makeRow("아파트", "a4", "5대광역시", "202601", 100),
        makeRow("아파트", "a6", "8개도", "202601", 100),
        makeRow("아파트", "d1", "6대광역시", "202601", 100),
        makeRow("아파트", "d2", "9개도", "202601", 100),
      ],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
    expect(result.skipped).toBe(7);
  });

  it("시도행(C2='a7' 서울) → regions.gu 에 시도명 없음 → 미매칭", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a7", "서울", "202601", 100)],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.unmatched).toContain("서울");
  });

  it("시도행 C2 코드 = KAB_REGION_PREFIX 키 → 시군구명과 우연 일치해도 제외 (제주/세종 충돌)", () => {
    // c8=제주(시도행) / c801=제주시(세부행정구). 둘 다 C2_NM='제주',
    // regions.gu 에 '제주시' 존재 → 'c8' 도 '제주'+'시' 매칭되어 중복 키 발생.
    // 시도행 코드(c8)는 명시 제외 → c801 만 매칭.
    const map = makeRegionGuMap({ 제주: ["제주시", "서귀포시"] });
    const result = parseKabRows(
      [
        makeRow("아파트", "c8", "제주", "202601", 103.2),
        makeRow("아파트", "c801", "제주", "202601", 103.1),
      ],
      map,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.jeonse_price_index).toBe(103.1);
  });

  it("권역행(C2='a701' 강북권역) → 미매칭", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a701", "강북권역", "202601", 100)],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toContain("강북권역");
  });

  it("세부행정구(C2 8자리 'a8010201' 만안) → regions 에 일반구 없음 → 미매칭", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a8010201", "만안", "202601", 100)],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toContain("만안");
  });

  it("동명 시군구 — C2 prefix 로 시도 구분 (서울 중구 a7 ≠ 부산 중구 b1)", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a7010102", "중", "202601", 110.1),
        makeRow("아파트", "b10101", "중", "202601", 88.7),
      ],
      DEFAULT_MAP,
    );
    const seoul = result.matched.find((m) => m.region === "서울" && m.gu === "중구");
    const busan = result.matched.find((m) => m.region === "부산" && m.gu === "중구");
    expect(seoul?.jeonse_price_index).toBe(110.1);
    expect(busan?.jeonse_price_index).toBe(88.7);
  });

  it("C2_NM 약칭('종로') + regions.gu 정식명('종로구') 접미사 매칭", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a7010101", "종로", "202601", 102.5),
        makeRow("아파트", "a80203", "수원", "202601", 98.3),
      ],
      DEFAULT_MAP,
    );
    expect(result.matched.find((m) => m.gu === "종로구")).toBeTruthy();
    expect(result.matched.find((m) => m.gu === "수원시")).toBeTruthy();
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a7010101", "종로", "202601", "abc")],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
  });

  it("DT<=0 (이상치 가드) → 무시", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a7010101", "종로", "202601", 0)],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
  });

  it("PRD_DE 비정상 포맷(5·7자리) → 무시", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a7010101", "종로", "20261", 100),
        makeRow("아파트", "a7010101", "종로", "2026013", 100),
      ],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
  });

  it("ITM_NM '전세가격' 외 → 무시", () => {
    const result = parseKabRows(
      [makeRow("아파트", "a7010101", "종로", "202601", 102.5, "변동률")],
      DEFAULT_MAP,
    );
    expect(result.matched).toEqual([]);
  });

  it("같은 시군구 여러 월 → 모두 보존 (시계열)", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a7010101", "종로", "202512", 101.0),
        makeRow("아파트", "a7010101", "종로", "202601", 102.5),
      ],
      DEFAULT_MAP,
    );
    expect(result.matched).toHaveLength(2);
  });

  it("unmatched 는 중복 제거 (Set)", () => {
    const result = parseKabRows(
      [
        makeRow("아파트", "a701", "강북권역", "202512", 100),
        makeRow("아파트", "a701", "강북권역", "202601", 100),
      ],
      DEFAULT_MAP,
    );
    expect(result.unmatched).toEqual(["강북권역"]);
  });
});

// ── main() collector_runs 기록 하드닝 (KOSIS 러너 차단 사고, 세션 394) ──
describe("main() recordCollectorRun 하드닝", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  it("KOSIS fetch 실패 → rethrow + status=failure 기록", async () => {
    fetchWithRetryMock.mockRejectedValue(new Error("fetch failed"));
    await expect(main()).rejects.toThrow("KOSIS fetch failed");
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-jeonse-price-index",
      expect.objectContaining({ status: "failure", errorMessage: "KOSIS fetch failed" }),
    );
  });

  it("KOSIS 빈 응답 early-return 도 기록 (ok=0)", async () => {
    fetchWithRetryMock.mockResolvedValue({ json: async () => [] });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-jeonse-price-index",
      { ok: 0, skip: 0 },
    );
  });
});
