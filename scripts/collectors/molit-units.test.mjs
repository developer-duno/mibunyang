// @ts-check
/**
 * molit-units.mjs 테스트 — 세대수(units) 보정 수집기 검증
 *
 * 대상: getTargets, fetchAptDetail, updateUnits, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    recordApiQuota: vi.fn(),
  };
});

// _molit-api.mjs 모킹 — molitApiCall 제어
const mockMolitApiCall = vi.fn();
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, molitApiCall: mockMolitApiCall };
});

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { getTargets, fetchAptDetail, updateUnits, resolveUnits, writeUnmatchedLog, unmatchedLogPath } =
  await import("./molit-units.mjs");

// ── 헬퍼 ─────────────────────────────────────────────────────
/**
 * @param {any} data
 * @param {any} [error]
 * @returns {any}
 */
function makeMockSbForQuery(data, error = null) {
  // selectAll이 .range()를 호출하므로 체인에 포함
  const range = vi.fn().mockResolvedValue({ data, error });
  const or = vi.fn().mockReturnValue({ range });
  const select = vi.fn().mockReturnValue({ or });
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, or, range };
}

/**
 * @param {any} [updateResult]
 * @returns {any}
 */
function makeMockSbForUpdate(updateResult = { error: null }) {
  const eq = vi.fn().mockResolvedValue(updateResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { from, update, eq };
}

// ── getTargets ───────────────────────────────────────────────
describe("getTargets", () => {
  it("정상 조회 — Supabase 쿼리 체인 검증 + 데이터 반환", async () => {
    const mockData = [{ id: "a1", name: "테스트아파트", units: 0, unsold: 50 }];
    const sb = makeMockSbForQuery(mockData);

    const result = await getTargets(sb);
    expect(result).toEqual(mockData);
    expect(sb.from).toHaveBeenCalledWith("apartments");
  });

  // 에러 + 빈 데이터
  const errorCases = [
    ["Supabase 에러 → throw", null, { message: "DB 오류" }, true],
    ["data=null → 빈 배열", null, null, false],
  ];
  for (const [label, data, error, shouldThrow] of errorCases) {
    it(/** @type {string} */ (label), async () => {
      const sb = makeMockSbForQuery(data, error);
      if (shouldThrow) {
        await expect(getTargets(sb)).rejects.toThrow("selectAll 조회 실패");
      } else {
        const result = await getTargets(sb);
        expect(result).toEqual([]);
      }
    });
  }
});

// ── resolveUnits (kaptdaCnt 우선 + hoCnt 폴백, 세션 444) ──────
describe("resolveUnits — 세대수 결정 (kaptdaCnt 우선, 0이면 hoCnt 폴백)", () => {
  it("kaptdaCnt>1 이면 kaptdaCnt 사용 (정상 단지)", () => {
    expect(resolveUnits({ kaptdaCnt: "500", hoCnt: "500" })).toEqual({ units: 500, field: "kaptdaCnt" });
  });

  it("kaptdaCnt=0 이고 hoCnt>1 이면 hoCnt 폴백 (임의공급·특수 물량)", () => {
    // 주안 극동스타클래스 실측: kaptdaCnt=0, hoCnt=249
    expect(resolveUnits({ kaptdaCnt: "0", hoCnt: "249" })).toEqual({ units: 249, field: "hoCnt(폴백)" });
  });

  it("kaptdaCnt>1 이면 hoCnt 와 달라도 kaptdaCnt 우선 (회귀 방지)", () => {
    expect(resolveUnits({ kaptdaCnt: "920", hoCnt: "1000" }).units).toBe(920);
  });

  it("둘 다 0/1 이면 보정 불가 (units 0)", () => {
    expect(resolveUnits({ kaptdaCnt: "0", hoCnt: "1" }).units).toBe(0);
    expect(resolveUnits({ kaptdaCnt: "1", hoCnt: "0" }).units).toBe(0);
  });

  it("필드 누락·null detail 도 안전 (units 0)", () => {
    expect(resolveUnits({}).units).toBe(0);
    expect(resolveUnits(null).units).toBe(0);
    expect(resolveUnits({ kaptdaCnt: "abc", hoCnt: "xyz" }).units).toBe(0);
  });
});

// ── fetchAptDetail ───────────────────────────────────────────
describe("fetchAptDetail", () => {
  beforeEach(() => mockMolitApiCall.mockReset());

  // 응답 구조별 파싱
  const parseCases = [
    ["body.item 직접 반환", { response: { body: { item: { kaptdaCnt: "500" } } } }, "500"],
    ["body.items.item 반환", { response: { body: { items: { item: { kaptdaCnt: "300" } } } } }, "300"],
    ["body null → null", { response: { body: null } }, null],
    ["응답 전체 null → null", null, null],
  ];
  for (const [label, mockResponse, expectedCnt] of parseCases) {
    it(/** @type {string} */ (label), async () => {
      mockMolitApiCall.mockResolvedValueOnce(mockResponse);
      const detail = await fetchAptDetail("K001");
      if (expectedCnt === null) {
        expect(detail).toBeNull();
      } else {
        expect(detail?.kaptdaCnt).toBe(expectedCnt);
      }
    });
  }
});

// ── updateUnits ──────────────────────────────────────────────
describe("updateUnits", () => {
  it("정상 보정 — units=500, unsold=50 → rate=10.0, unit_source='molit'", async () => {
    const sb = makeMockSbForUpdate();
    const ok = await updateUnits(sb, "a1", 500, 50, false);

    expect(ok).toBe(true);
    const updateArg = sb.from("apartments").update.mock.calls[0][0];
    expect(updateArg.units).toBe(500);
    expect(updateArg.unsold_rate).toBe(10.0);
    expect(updateArg.unit_source).toBe("molit");
    expect(updateArg.updated_at).toBeDefined();
  });

  // unsoldRate 계산 엣지케이스
  const rateCases = [
    ["unsold=null → rate null", 500, null, null],
    ["newUnits=0 → rate null", 0, 50, null],
    ["unsold=0 → rate 0.0", 500, 0, 0],
  ];
  for (const [label, units, unsold, expectedRate] of rateCases) {
    it(/** @type {string} */ (label), async () => {
      const sb = makeMockSbForUpdate();
      await updateUnits(sb, "a1", /** @type {any} */ (units), /** @type {any} */ (unsold), false);
      if (expectedRate === null) {
        // dryRun이 아닌 경우에도 DB 호출은 함
        // unsoldRate 자체만 검증
        const arg = sb.from("apartments").update.mock.calls[0]?.[0];
        expect(arg?.unsold_rate ?? null).toBe(null);
      } else {
        const arg = sb.from("apartments").update.mock.calls[0][0];
        expect(arg.unsold_rate).toBe(expectedRate);
      }
    });
  }

  // dryRun + DB 에러
  const modeCases = [
    ["dryRun=true → DB 미호출 + true", true, { error: null }, true],
    ["DB 에러 → false", false, { error: { message: "실패" } }, false],
  ];
  for (const [label, dryRun, dbResult, expectedOk] of modeCases) {
    it(/** @type {string} */ (label), async () => {
      const sb = makeMockSbForUpdate(dbResult);
      const ok = await updateUnits(sb, "a1", 500, 50, /** @type {any} */ (dryRun));
      expect(ok).toBe(expectedOk);
      if (dryRun) {
        expect(sb.from).not.toHaveBeenCalled();
      }
    });
  }
});

// ── 미매칭 목록 파일 기록 (세션 495) ─────────────────────────
describe("writeUnmatchedLog — 미매칭 목록을 날짜별 파일로 남긴다", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "molit-units-log-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const entries = [
    { id: "ap-1", name: "가나아파트", region: "경기", gu: "화성시", reason: "이름 매칭 실패 (유사도 < 0.6)" },
    { id: "ap-2", name: "다라아파트", region: "서울", gu: null, reason: "상세 조회 실패 (kaptCode=K9)" },
  ];

  it("단지명·사유가 파일에 남는다 (bat 이 stdout 을 안 남겨 생긴 구멍)", () => {
    const p = writeUnmatchedLog(entries, dir, "2026-08-07");
    expect(p).toBe(unmatchedLogPath(dir, "2026-08-07"));
    const saved = JSON.parse(readFileSync(/** @type {string} */ (p), "utf8"));
    expect(saved.count).toBe(2);
    expect(saved.entries.map((/** @type {any} */ e) => e.name)).toEqual(["가나아파트", "다라아파트"]);
    expect(saved.entries[0].reason).toMatch(/이름 매칭 실패/);
    expect(saved.entries[1].reason).toMatch(/상세 조회 실패/);
  });

  it("미매칭 0건이면 파일을 만들지 않는다 (빈 파일 쓰레기 방지)", () => {
    expect(writeUnmatchedLog([], dir, "2026-08-07")).toBeNull();
    expect(existsSync(unmatchedLogPath(dir, "2026-08-07"))).toBe(false);
  });

  it("파일명에 날짜가 박혀 실행마다 덮어쓰지 않는다", () => {
    writeUnmatchedLog(entries, dir, "2026-08-07");
    writeUnmatchedLog(entries, dir, "2026-08-11");
    expect(existsSync(unmatchedLogPath(dir, "2026-08-07"))).toBe(true);
    expect(existsSync(unmatchedLogPath(dir, "2026-08-11"))).toBe(true);
  });

  it("기록 실패(없는 상위 경로 등)해도 예외를 던지지 않는다 — 진단이 수집을 죽이면 안 됨", () => {
    // 파일을 디렉토리 이름으로 써서 mkdir/write 를 실패시킨다.
    const bad = join(dir, "nope.json", "sub");
    expect(() => writeUnmatchedLog(entries, bad, "2026-08-07")).not.toThrow();
  });
});

describe("main 이 unmatched 를 collector_runs 의 skip 에 합산한다 (세션 495)", () => {
  // main() 은 export 되지 않아 배선 자체를 소스로 확인한다.
  // ⚠️ 좌변(await recordCollectorRun)까지 고정 + 주석 제거 사본에 검사 — 선언부·주석 매칭 함정 차단.
  const src = readFileSync(new URL("./molit-units.mjs", import.meta.url), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("recordCollectorRun 호출의 skip 이 skipped + unmatched 다", () => {
    expect(src).toMatch(/await\s+recordCollectorRun\(\s*PHASE\s*,\s*\{[^}]*skip:\s*skipped\s*\+\s*unmatched/);
  });

  it("미매칭 목록을 파일로 남기는 호출이 배선돼 있다", () => {
    expect(src).toMatch(/const\s+unmatchedLog\s*=\s*writeUnmatchedLog\(\s*unmatchedList\s*\)/);
  });
});

// ── E2E 시나리오 ─────────────────────────────────────────────
describe("E2E 시나리오", () => {
  beforeEach(() => mockMolitApiCall.mockReset());

  it("상세조회 → kaptdaCnt 추출 → updateUnits 연결", async () => {
    // fetchAptDetail 성공
    mockMolitApiCall.mockResolvedValueOnce({
      response: { body: { item: { kaptdaCnt: "800" } } },
    });

    const detail = await fetchAptDetail("K001");
    expect(detail).not.toBeNull();

    const kaptdaCnt = parseInt(/** @type {string} */ (detail?.kaptdaCnt), 10);
    expect(kaptdaCnt).toBe(800);
    expect(kaptdaCnt).toBeGreaterThan(1);

    // updateUnits 성공
    const sb = makeMockSbForUpdate();
    const ok = await updateUnits(sb, "a1", kaptdaCnt, 120, false);
    expect(ok).toBe(true);

    const arg = sb.from("apartments").update.mock.calls[0][0];
    expect(arg.units).toBe(800);
    expect(arg.unsold_rate).toBe(15.0); // 120/800*100 = 15.0
    expect(arg.unit_source).toBe("molit");
  });

  it("세대수 무효 (kaptdaCnt='0') → 보정 불가 로직 재현", async () => {
    mockMolitApiCall.mockResolvedValueOnce({
      response: { body: { item: { kaptdaCnt: "0" } } },
    });

    const detail = await fetchAptDetail("K999");
    expect(detail).not.toBeNull();

    const kaptdaCnt = parseInt(/** @type {string} */ (detail?.kaptdaCnt || "0"), 10);
    // main()에서 isNaN(kaptdaCnt) || kaptdaCnt <= 1 이면 skipped
    expect(isNaN(kaptdaCnt) || kaptdaCnt <= 1).toBe(true);
  });
});
