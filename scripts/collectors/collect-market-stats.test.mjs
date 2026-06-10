// @ts-check
/**
 * collect-market-stats.mjs 테스트 — KOSIS 시장통계 순수 함수 검증
 *
 * 대상: extractLatestByRegion, parseAllPeriodsByRegion
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithRetryMock = vi.fn();

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    // main 테스트용 최소 체이너블 (regions 조회만 — 빈 응답/전 지표 실패 경로는 update/upsert 미도달)
    getSupabase: vi.fn(() => ({
      from: () => ({ select: () => ({ is: async () => ({ data: [], error: null }) }) }),
    })),
    log: vi.fn(),
    logError: vi.fn(),
    // 세션 395: stateful 미니 reporter — interrupted 포함 + summary 가 실측 카운트·status 반환
    // (고정값 mock 이면 main 의 rpt.interrupted() TypeError + failure status 검증 불가)
    createReporter: vi.fn(() => {
      let ok = 0, fail = 0, skip = 0;
      return {
        success(/** @type {number} */ n = 1) { ok += n; },
        fail(/** @type {number} */ n = 1) { fail += n; },
        skip(/** @type {number} */ n = 1) { skip += n; },
        interrupted: () => false,
        summary: () => ({
          elapsed: "0.0", ok, fail, skip, total: ok + fail + skip,
          status: fail > 0 ? "failure" : "success",
        }),
      };
    }),
    sleep: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
    upsertBatch: vi.fn(),
    // 세션 330: fetchWithRetry mock (fetchKosisTable 통일 회귀 가드 자리) — 세션 395 델리게이트 전환
    fetchWithRetry: (/** @type {any[]} */ ...args) => fetchWithRetryMock(...args),
  };
});

process.env.KOSIS_KEY = "test-key";

const { extractLatestByRegion, parseAllPeriodsByRegion, main } = await import("./collect-market-stats.mjs");
const { recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));

// ── 팩토리 ───────────────────────────────────────────────────
/** @param {any} c1 @param {any} c2 @param {any} period @param {any} value */
function makeRow(c1, c2, period, value) {
  return { C1_NM: c1, C2_NM: c2, PRD_DE: period, DT: String(value) };
}

function makeIndicator(parseFn = parseFloat) {
  return /** @type {any} */ ({ parse: parseFn });
}

// ── extractLatestByRegion ─────────────────────────────────────
describe("extractLatestByRegion", () => {
  it("빈 배열 → 빈 객체", () => {
    expect(extractLatestByRegion([], makeIndicator())).toEqual({});
  });

  it("단일 시도 행 → 올바른 매핑", () => {
    const rows = [makeRow("서울", null, "202601", "105.3")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"]).toEqual({ value: 105.3, period: "202601" });
  });

  it("C2_NM이 '전체'인 행만 사용", () => {
    const rows = [
      makeRow("서울", "전체", "202601", "100.0"),
      makeRow("서울", "강남구", "202601", "120.0"), // 무시됨
    ];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"].value).toBe(100.0);
  });

  it("같은 지역 최신 기간 덮어쓰기", () => {
    const rows = [
      makeRow("경기", null, "202601", "90.0"),
      makeRow("경기", null, "202603", "95.0"), // 최신
    ];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["경기"]).toEqual({ value: 95.0, period: "202603" });
  });

  it("매핑 안 되는 시도명 → 무시", () => {
    const rows = [makeRow("전국", null, "202601", "100.0")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("parseInt 파서 적용", () => {
    const rows = [makeRow("서울", null, "202601", "12345")];
    const result = extractLatestByRegion(rows, makeIndicator(parseInt));
    expect(result["서울"].value).toBe(12345);
  });

  it("DT가 숫자 아님 → 무시", () => {
    const rows = [makeRow("서울", null, "202601", "-")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("C2_NM=null인 행 → 포함 (C2_NM falsy 조건 mutation 방지)", () => {
    const rows = [makeRow("서울", null, "202601", "100.0")];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"]).toBeDefined();
  });

  it("C2_NM='강남구' 등 비전체 행 → 제외 (필터 mutation 방지)", () => {
    const rows = [
      makeRow("서울", "전체", "202601", "100.0"),
      makeRow("서울", "강남구", "202601", "150.0"),
      makeRow("서울", "서초구", "202601", "140.0"),
    ];
    const result = extractLatestByRegion(rows, makeIndicator());
    expect(result["서울"].value).toBe(100.0);
    expect(result["서울"].value).not.toBe(150.0);
  });
});

// ── parseAllPeriodsByRegion (시계열 보존) ──────────────────────
describe("parseAllPeriodsByRegion", () => {
  it("월간 3개월치 → 3행 반환 (모든 PRD_DE 보존)", () => {
    const rows = [
      makeRow("서울", null, "202601", "100.0"),
      makeRow("서울", null, "202602", "101.0"),
      makeRow("서울", null, "202603", "102.0"),
    ];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(3);
    expect(result.map(r => r.base_month)).toEqual(["202601", "202602", "202603"]);
    expect(result[0]).toEqual({ region: "서울", gu: "", base_month: "202601", value: 100.0 });
  });

  it("분기 PRD_DE '20261' (5자리) → 허용", () => {
    const rows = [makeRow("서울", null, "20261", "85.5")];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(1);
    expect(result[0].base_month).toBe("20261");
  });

  it("PRD_DE 포맷 위반 ('2026Q1', '20261A', '2026') → 무시", () => {
    const rows = [
      makeRow("서울", null, "2026Q1", "100.0"),
      makeRow("서울", null, "20261A", "100.0"),
      makeRow("서울", null, "2026", "100.0"),
    ];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(0);
  });

  it("REGION_MAP 매핑 실패 (전국) → 무시", () => {
    const rows = [makeRow("전국", null, "202601", "100.0")];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(0);
  });

  it("DT NaN ('-') → 무시", () => {
    const rows = [
      makeRow("서울", null, "202601", "-"),
      makeRow("서울", null, "202602", "100.0"),
    ];
    const result = parseAllPeriodsByRegion(rows, makeIndicator());
    expect(result).toHaveLength(1);
    expect(result[0].base_month).toBe("202602");
  });
});

// ── 세션 330: fetchWithRetry 통일 회귀 가드 ──────────────────
describe("fetchKosisTable fetchWithRetry 사용 (통일 회귀 가드)", () => {
  it("collect-market-stats.mjs 본문이 fetchWithRetry import 박힘", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve("scripts/collectors/collect-market-stats.mjs"), "utf8");
    expect(src).toMatch(/import\s*{[^}]*fetchWithRetry[^}]*}\s*from\s*["']\.\/_shared\.mjs["']/);
  });

  it("collect-market-stats.mjs 본문에 https.request / https.Agent / SSL_OP_LEGACY_SERVER_CONNECT 박힘 0건 (자체 함수 폐기 확인)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve("scripts/collectors/collect-market-stats.mjs"), "utf8");
    expect(src).not.toMatch(/https\.request\s*\(/);
    expect(src).not.toMatch(/new\s+https\.Agent\s*\(/);
    expect(src).not.toMatch(/SSL_OP_LEGACY_SERVER_CONNECT/);
  });
});

// ── main() collector_runs 기록 하드닝 (KOSIS 러너 차단 사고, 세션 395) ──
// market-stats 는 지표별 fetch 실패를 reporter 가 흡수(throw 아님) → rejects 패턴 불가.
// 전 지표(5회) 실패 = summary status=failure 기록 + ok=0 이면 process.exit(1) 정책.
describe("main() recordCollectorRun 하드닝", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  it("전 지표 fetch 실패 → status=failure 기록 + exit(1)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => /** @type {never} */ (undefined));
    fetchWithRetryMock.mockRejectedValue(new Error("fetch failed"));
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "market-stats",
      expect.objectContaining({ status: "failure", ok: 0, fail: 5 }),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("빈 응답 → summary 그대로 기록 (ok=0, fail=0, success) + exit 미발동", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => /** @type {never} */ (undefined));
    fetchWithRetryMock.mockResolvedValue({ json: async () => [] });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "market-stats",
      expect.objectContaining({ ok: 0, fail: 0, status: "success" }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
