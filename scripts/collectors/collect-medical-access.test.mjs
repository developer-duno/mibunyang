// @ts-check
/**
 * collect-medical-access.mjs 테스트 — KOSIS DT_1YL20981/DT_1YL20971 파싱 검증
 *
 * 대상: parseKosisRows
 * 환각 차단: 1차원 통계표 C1 길이 2(집계행)/5(시군구) 분기, itmId=T10 외 ITM skip
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
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
    fetchWithRetry: (/** @type {any[]} */ ...args) => fetchWithRetryMock(...args),
  };
});

process.env.KOSIS_KEY = "test-key";

const { parseKosisRows, main } = await import("./collect-medical-access.mjs");
const { recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));

/**
 * @param {string} c1     C1 코드 (2자리=집계행 / 5자리=시군구)
 * @param {string} c1Nm   C1_NM (시도명 또는 시군구명)
 * @param {string} year   PRD_DE
 * @param {string|number} value  DT
 * @param {string} [itmId]  ITM_ID (T10 = 천명당 지표)
 */
function makeRow(c1, c1Nm, year, value, itmId = "T10") {
  return { C1: c1, C1_NM: c1Nm, ITM_ID: itmId, PRD_DE: year, DT: String(value) };
}

describe("parseKosisRows (DT_1YL20981/DT_1YL20971 의료 인프라)", () => {
  it("빈 배열 → matched 빈 객체", () => {
    expect(parseKosisRows([])).toEqual({ matched: {}, unmatched: [], aggSkipped: 0 });
  });

  it("5자리 C1 시군구 정상 → region::gu 키로 추출", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2024", 3.2)]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(3.2, 2);
  });

  it("동명 시군구 — C1 앞 2자리 시도코드로 구분 (서울 중구 ≠ 부산 중구)", () => {
    const result = parseKosisRows([
      makeRow("11020", "중구", "2024", 5.1),
      makeRow("21010", "중구", "2024", 2.3),
    ]);
    expect(result.matched["서울::중구"]).toBeCloseTo(5.1, 2);
    expect(result.matched["부산::중구"]).toBeCloseTo(2.3, 2);
  });

  it("2자리 C1 집계행 (전국 '00' / 서울 '11') → aggSkipped 증가, matched 미포함", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2024", 3.2),
      makeRow("11", "서울특별시", "2024", 4.5),
      makeRow("11010", "종로구", "2024", 8.1),
    ]);
    expect(result.aggSkipped).toBe(2);
    expect(Object.keys(result.matched)).toEqual(["서울::종로구"]);
  });

  it("최신 연도 우선 (2022 → 2024 덮어쓰기)", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2022", 7.5),
      makeRow("11010", "종로구", "2024", 8.1),
    ]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(8.1, 2);
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2024", "abc")]);
    expect(result.matched).toEqual({});
  });

  it("DT<=0 (이상치 가드) → 무시. 상한 없음 (병상수 큰 값 허용)", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2024", 0),
      makeRow("11020", "중구", "2024", 150),
    ]);
    expect(result.matched["서울::종로구"]).toBeUndefined();
    expect(result.matched["서울::중구"]).toBeCloseTo(150, 2);
  });

  it("알 수 없는 KOSIS 시도코드 (99xxx) → unmatched 에 C1_NM push", () => {
    const result = parseKosisRows([makeRow("99010", "가상시", "2024", 3.0)]);
    expect(result.matched).toEqual({});
    expect(result.unmatched).toEqual(["가상시"]);
  });

  it("ITM_ID='T10' 외 (T001 분자 / T002 분모) → 무시", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2024", 163115, "T001"),
      makeRow("11010", "종로구", "2024", 50000, "T002"),
      makeRow("11010", "종로구", "2024", 8.1, "T10"),
    ]);
    expect(Object.keys(result.matched)).toEqual(["서울::종로구"]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(8.1, 2);
  });

  it("PRD_DE 비-연도 포맷 → 무시", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2024M01", 3.0)]);
    expect(result.matched).toEqual({});
  });

  it("C1 길이 비정상 (3·4자리) → 무시", () => {
    const result = parseKosisRows([
      makeRow("110", "이상", "2024", 3.0),
      makeRow("1101", "이상", "2024", 3.0),
    ]);
    expect(result.matched).toEqual({});
  });

  it("17개 시도 시군구 동시 처리 — 시도코드별 region 매핑", () => {
    const sido = [
      ["11", "서울"], ["21", "부산"], ["22", "대구"], ["23", "인천"], ["24", "광주"],
      ["25", "대전"], ["26", "울산"], ["29", "세종"], ["31", "경기"], ["32", "강원"],
      ["33", "충북"], ["34", "충남"], ["35", "전북"], ["36", "전남"], ["37", "경북"],
      ["38", "경남"], ["39", "제주"],
    ];
    const rows = sido.map(([code, region], i) =>
      makeRow(`${code}010`, `${region}시군구`, "2024", 3.0 + i * 0.1),
    );
    const result = parseKosisRows(rows);
    expect(Object.keys(result.matched)).toHaveLength(17);
    expect(result.matched["서울::서울시군구"]).toBeCloseTo(3.0, 2);
    expect(result.unmatched).toHaveLength(0);
  });

  it("전국 + 시도 + 시군구 혼합 → 시군구만 matched, 나머지 aggSkipped", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2024", 3.2),
      makeRow("11", "서울특별시", "2024", 4.5),
      makeRow("11010", "종로구", "2024", 8.1),
      makeRow("31010", "수원시", "2024", 2.9),
    ]);
    expect(result.aggSkipped).toBe(2);
    expect(Object.keys(result.matched).sort()).toEqual(["경기::수원시", "서울::종로구"]);
  });
});

// ── 세종 예외 (세션550) ──────────────────────────────────────────
//
// 라이브 실측(2026-09-20, DT_1YL20981·DT_1YL20971 둘 다): 세종은 `C1="29"` 시도 행으로만 나오고
// `29xxx` 시군구 행이 없다(대조군 제주는 `39`+`39010`+`39020`). 그 행을 집계행으로 버리면
// regions `세종|세종시` 가 영영 비고 → VIEW 세종 35곳의 의사수·병상수가 구조적 NULL 이다.
// 아래 픽스처의 `C1_NM`·값은 전부 라이브 응답 모양 그대로다(2025: 의사 2.1 / 병상 5.4).
describe("parseKosisRows — 세종 시도 행은 곧 시군구 값 (세션550)", () => {
  it("세종 '29' 행이 '세종::세종시' 로 매칭된다 (regions 쪽 키와 동일)", () => {
    const result = parseKosisRows([makeRow("29", "세종특별자치시", "2025", 2.1)]);
    expect(result.matched["세종::세종시"]).toBeCloseTo(2.1, 2);
    expect(result.aggSkipped).toBe(0); // 세종은 버린 집계행이 아니다
  });

  it("다른 시도의 집계행은 여전히 버린다 (서울 값이 구 키로 새면 안 된다)", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2025", 2.6),
      makeRow("11", "서울특별시", "2025", 4.5),
      makeRow("29", "세종특별자치시", "2025", 2.1),
      makeRow("11010", "종로구", "2025", 8.1),
    ]);
    expect(result.aggSkipped).toBe(2); // 전국 + 서울만
    expect(Object.keys(result.matched).sort()).toEqual(["서울::종로구", "세종::세종시"]);
    // 서울 집계값(4.5)이 어떤 키로도 안 들어갔다
    expect(Object.values(result.matched)).not.toContain(4.5);
  });

  it("세종 길이 5 행이 생기면 시도 행을 이긴다 — 입력 순서 무관", () => {
    const sido = makeRow("29", "세종특별자치시", "2025", 2.1);
    const sgg = makeRow("29010", "세종시", "2025", 7.7);
    expect(parseKosisRows([sido, sgg]).matched["세종::세종시"]).toBeCloseTo(7.7, 2);
    expect(parseKosisRows([sgg, sido]).matched["세종::세종시"]).toBeCloseTo(7.7, 2);
  });

  it("세종 길이 5 행이 옛 연도여도 시도 행이 덮지 않는다 (길이 5 우선은 연도보다 강하다)", () => {
    const result = parseKosisRows([
      makeRow("29", "세종특별자치시", "2025", 2.1),
      makeRow("29010", "세종시", "2021", 7.7),
    ]);
    expect(result.matched["세종::세종시"]).toBeCloseTo(7.7, 2);
  });

  it("세종 시도 행끼리는 최신 연도가 이긴다", () => {
    const result = parseKosisRows([
      makeRow("29", "세종특별자치시", "2021", 1.5),
      makeRow("29", "세종특별자치시", "2025", 2.1),
      makeRow("29", "세종특별자치시", "2023", 1.8),
    ]);
    expect(result.matched["세종::세종시"]).toBeCloseTo(2.1, 2);
  });

  it("세종 시도 행도 값이 이상하면(0·비수치) 안 담는다", () => {
    expect(parseKosisRows([makeRow("29", "세종특별자치시", "2025", 0)]).matched["세종::세종시"]).toBeUndefined();
    expect(parseKosisRows([makeRow("29", "세종특별자치시", "2025", "abc")]).matched["세종::세종시"]).toBeUndefined();
  });

  it("ITM_ID 가 T10 이 아니면 세종도 제외 (분자/분모 행이 섞여도 안전)", () => {
    const result = parseKosisRows([makeRow("29", "세종특별자치시", "2025", 999, "T001")]);
    expect(result.matched["세종::세종시"]).toBeUndefined();
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
    await expect(main()).rejects.toThrow(/KOSIS .* fetch failed/);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-medical-access",
      expect.objectContaining({ status: "failure" }),
    );
  });

  it("전 통계표 빈 응답 early-return 도 기록 (ok=0)", async () => {
    fetchWithRetryMock.mockResolvedValue({ json: async () => [] });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-medical-access",
      { ok: 0, skip: 0 },
    );
  });
});
