/**
 * collect-avg-income.mjs 테스트 — KOSIS DT_1C86 파서 + 단위 변환 검증
 *
 * 대상: thousandWonYearToManWonMonth, aggregateIncomeRows, fetchKosisIncome
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithRetryMock = vi.fn();

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
    REGION_MAP: orig.REGION_MAP,
    fetchWithRetry: (...args) => fetchWithRetryMock(...args),
  };
});

process.env.KOSIS_MIGRATION_KEY = "test-key";

const { thousandWonYearToManWonMonth, aggregateIncomeRows, fetchKosisIncome } =
  await import("./collect-avg-income.mjs");

// ── thousandWonYearToManWonMonth ─────────────────────────────
describe("thousandWonYearToManWonMonth", () => {
  it("전국 2022 23388 천원/년 → 195 만원/월", () => {
    expect(thousandWonYearToManWonMonth("23388")).toBe(195);
  });
  it("서울 2022 26112 천원/년 → 218 만원/월", () => {
    expect(thousandWonYearToManWonMonth("26112")).toBe(218);
  });
  it("쉼표 포함 문자열 '23,388' 처리", () => {
    expect(thousandWonYearToManWonMonth("23,388")).toBe(195);
  });
  it("null → null", () => {
    expect(thousandWonYearToManWonMonth(null)).toBeNull();
  });
  it("빈 문자열 → null (NaN 필터)", () => {
    expect(thousandWonYearToManWonMonth("")).toBeNull();
  });
  it("0 이하 값 → null", () => {
    expect(thousandWonYearToManWonMonth("0")).toBeNull();
    expect(thousandWonYearToManWonMonth("-100")).toBeNull();
  });
});

// ── aggregateIncomeRows ──────────────────────────────────────
describe("aggregateIncomeRows", () => {
  const mkRow = (C1, C1_NM, PRD_DE, ITM_NM, DT) => ({ C1, C1_NM, PRD_DE, ITM_NM, DT });

  it("빈 배열 → period null, entries []", () => {
    expect(aggregateIncomeRows([])).toEqual({ period: null, entries: [] });
  });

  it("최신 연도만 채택 (2022 > 2021)", () => {
    const rows = [
      mkRow("11", "서울특별시", "2021", "1인당 개인소득", "24000"),
      mkRow("11", "서울특별시", "2022", "1인당 개인소득", "26112"),
    ];
    const { period, entries } = aggregateIncomeRows(rows);
    expect(period).toBe("2022");
    expect(entries).toEqual([{ region: "서울", gu: null, avg_income: 218 }]);
  });

  it("1인당 개인소득 ITM_NM 만 채택 — GRDP·총소득·민간소비 제외", () => {
    const rows = [
      mkRow("11", "서울특별시", "2022", "1인당 지역내총생산", "60000"),
      mkRow("11", "서울특별시", "2022", "1인당 지역총소득", "50000"),
      mkRow("11", "서울특별시", "2022", "1인당 민간소비", "25000"),
      mkRow("11", "서울특별시", "2022", "1인당 개인소득", "26112"),
    ];
    const { entries } = aggregateIncomeRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].avg_income).toBe(218);
  });

  it("전국('00') 제외", () => {
    const rows = [
      mkRow("00", "전국", "2022", "1인당 개인소득", "23388"),
      mkRow("11", "서울특별시", "2022", "1인당 개인소득", "26112"),
    ];
    const { entries } = aggregateIncomeRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].region).toBe("서울");
  });

  it("시도별 정식명 전부 REGION_MAP 경유 매핑", () => {
    const rows = [
      mkRow("11", "서울특별시", "2022", "1인당 개인소득", "26112"),
      mkRow("21", "부산광역시", "2022", "1인당 개인소득", "22577"),
      mkRow("29", "세종특별자치시", "2022", "1인당 개인소득", "23215"),
      mkRow("31", "경기도", "2022", "1인당 개인소득", "23136"),
      mkRow("32", "강원도", "2022", "1인당 개인소득", "22395"),
      mkRow("39", "제주특별자치도", "2022", "1인당 개인소득", "21508"),
    ];
    const { entries } = aggregateIncomeRows(rows);
    expect(entries).toHaveLength(6);
    const regions = entries.map(e => e.region).sort();
    expect(regions).toEqual(["강원", "경기", "부산", "서울", "세종", "제주"]);
    // 전부 gu=null (시도 단위)
    expect(entries.every(e => e.gu === null)).toBe(true);
  });

  it("미매핑 C1_NM → 무시 (REGION_MAP fallback)", () => {
    const rows = [
      mkRow("99", "알수없는지역", "2022", "1인당 개인소득", "20000"),
      mkRow("11", "서울특별시", "2022", "1인당 개인소득", "26112"),
    ];
    const { entries } = aggregateIncomeRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].region).toBe("서울");
  });

  it("DT NaN → 해당 row 스킵", () => {
    const rows = [
      mkRow("11", "서울특별시", "2022", "1인당 개인소득", "invalid"),
      mkRow("21", "부산광역시", "2022", "1인당 개인소득", "22577"),
    ];
    const { entries } = aggregateIncomeRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].region).toBe("부산");
  });

  it("구 강원도/강원특별자치도 표기 혼재 시 약칭 '강원'으로 통일", () => {
    const rows = [
      mkRow("32", "강원특별자치도", "2022", "1인당 개인소득", "22395"),
    ];
    const { entries } = aggregateIncomeRows(rows);
    expect(entries[0].region).toBe("강원");
  });
});

// ── fetchKosisIncome (fetchWithRetry 연동) ───────────────────
describe("fetchKosisIncome — fetchWithRetry 위임", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
  });

  it("성공 응답을 JSON 배열로 반환 + URL에 DT_1C86/T3 파라미터", async () => {
    const rows = [{ C1: "11", C1_NM: "서울특별시", PRD_DE: "2022", ITM_NM: "1인당 개인소득", DT: "26112" }];
    fetchWithRetryMock.mockResolvedValueOnce({ text: async () => JSON.stringify(rows) });
    const result = await fetchKosisIncome();
    expect(result).toEqual(rows);
    const url = fetchWithRetryMock.mock.calls[0][0];
    expect(url).toContain("orgId=101");
    expect(url).toContain("tblId=DT_1C86");
    expect(url).toContain("itmId=T3");
    expect(url).toContain("prdSe=Y");
  });

  it("fetchWithRetry 실패 시 'KOSIS' prefix 유지", async () => {
    fetchWithRetryMock.mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(fetchKosisIncome()).rejects.toThrow("KOSIS HTTP 500");
  });

  it("KOSIS err 필드 응답은 명시적 에러로 전환", async () => {
    fetchWithRetryMock.mockResolvedValueOnce({
      text: async () => JSON.stringify({ err: "30", errMsg: "인증 실패" }),
    });
    await expect(fetchKosisIncome()).rejects.toThrow(/KOSIS 에러 30/);
  });

  it("JSON 파싱 실패 시 본문 앞 200자 포함 에러", async () => {
    fetchWithRetryMock.mockResolvedValueOnce({ text: async () => "<html>error page" });
    await expect(fetchKosisIncome()).rejects.toThrow(/KOSIS JSON 파싱 실패/);
  });
});
