// @ts-check
/**
 * sync-naver-complex.mjs 테스트 — 네이버 단지 동기화 순수 함수 검증
 *
 * 대상: matchApartments, median, parseFloor, buildSpatialGrid, findNearbyComplexes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// _shared.mjs 모킹 — stringSimilarity는 실제 구현 사용
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    getMibuyangSupabase: vi.fn(),
    recordCollectorRun: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    stringSimilarity: orig.stringSimilarity,
  };
});

const { matchApartments, median, parseFloor, buildSpatialGrid, findNearbyComplexes, fetchAllPages, flushUpdates, main } =
  await import("./sync-naver-complex.mjs");
const { getMibuyangSupabase, recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));

// ── 팩토리 ───────────────────────────────────────────────────
/**
 * @param {string} complexNo @param {string} name
 * @param {number|null} [lat] @param {number|null} [lng]
 */
function makeComplex(complexNo, name, lat = null, lng = null) {
  return /** @type {any} */ ({ complex_no: complexNo, complex_name: name, latitude: lat, longitude: lng });
}

/**
 * @param {string} id @param {string} name
 * @param {number|null} [lat] @param {number|null} [lng]
 */
function makeApt(id, name, lat = null, lng = null) {
  return /** @type {any} */ ({ id, name, lat, lng });
}

// ── median ────────────────────────────────────────────────────
describe("median (sync-naver-complex)", () => {
  it("빈 배열 → 0 (trade-stats와 다름)", () => {
    expect(median([])).toBe(0);
  });

  it("단일 요소 → 그대로", () => {
    expect(median([42])).toBe(42);
  });

  it("홀수 개 → 중앙값", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("짝수 개 → 두 중앙값 평균 (반올림)", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("원본 배열 미변경", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

// ── parseFloor ────────────────────────────────────────────────
describe("parseFloor", () => {
  it("'3/15' → 3 (슬래시 앞 파싱)", () => {
    expect(parseFloor("3/15")).toBe(3);
  });

  it("null/undefined → null", () => {
    expect(parseFloor(null)).toBeNull();
    expect(parseFloor(undefined)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(parseFloor("")).toBeNull();
  });

  it("한국어 '저' → 3", () => {
    expect(parseFloor("저")).toBe(3);
  });

  it("한국어 '중' → 8", () => {
    expect(parseFloor("중")).toBe(8);
  });

  it("한국어 '고' → 20", () => {
    expect(parseFloor("고")).toBe(20);
  });

  it("숫자 0 → null (0층 무효)", () => {
    expect(parseFloor("0")).toBeNull();
  });

  it("음수 → null", () => {
    expect(parseFloor("-1")).toBeNull();
  });

  it("200 이상 → null (범위 초과)", () => {
    expect(parseFloor("200")).toBeNull();
    expect(parseFloor("999")).toBeNull();
  });

  it("199 → 199 (유효 범위)", () => {
    expect(parseFloor("199")).toBe(199);
  });

  it("숫자 타입 입력 → String 변환 후 파싱", () => {
    expect(parseFloor(/** @type {any} */ (10))).toBe(10);
  });
});

// ── matchApartments ───────────────────────────────────────────
describe("matchApartments", () => {
  it("complexLinksMap에 매핑 있음 → 해당 아파트 반환", () => {
    const cpx = makeComplex("C001", "래미안");
    const apts = [makeApt("A1", "래미안", 37.5, 127.0), makeApt("A2", "힐스테이트", 37.5, 127.0)];
    const linksMap = new Map([["C001", ["A1"]]]);

    const result = matchApartments(cpx, apts, linksMap);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A1");
  });

  it("complexLinksMap에 매핑 없음 → 이름 유사도로 폴백", () => {
    const cpx = makeComplex("C001", "래미안아파트");
    const apts = [
      makeApt("A1", "래미안아파트", 37.5, 127.0),
      makeApt("A2", "힐스테이트아파트", 37.5, 127.0),
    ];
    const linksMap = new Map();

    const result = matchApartments(cpx, apts, linksMap);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(a => a.id === "A1")).toBe(true);
  });

  it("매칭 결과 없음 → 빈 배열", () => {
    const cpx = makeComplex("C001", "완전다른이름");
    const apts = [makeApt("A1", "래미안아파트", 37.5, 127.0)];
    const linksMap = new Map();

    const result = matchApartments(cpx, apts, linksMap);
    expect(result).toEqual([]);
  });

  it("단지명 괄호 제거 후 매칭", () => {
    const cpx = makeComplex("C001", "래미안(1단지)");
    const apts = [makeApt("A1", "래미안", 37.5, 127.0)];
    const linksMap = new Map();

    // 괄호 제거 후 "래미안"으로 매칭
    const result = matchApartments(cpx, apts, linksMap);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("linksMap 매핑이 빈 배열이면 이름 매칭으로 폴백", () => {
    const cpx = makeComplex("C001", "래미안아파트");
    const apts = [makeApt("A1", "래미안아파트", 37.5, 127.0)];
    const linksMap = new Map([["C001", []]]);

    const result = matchApartments(cpx, apts, linksMap);
    // nearbyIds가 빈 배열이므로 matched.length === 0 → 이름 매칭 폴백
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ── buildSpatialGrid ──────────────────────────────────────────
describe("buildSpatialGrid", () => {
  it("좌표 있는 단지 → 그리드 셀에 배치", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const { grid, cellSize } = buildSpatialGrid(complexes);
    expect(cellSize).toBe(0.02);
    expect(Object.keys(grid).length).toBe(1);
  });

  it("좌표 없는 단지 → 스킵", () => {
    const complexes = [makeComplex("C1", "A", null, null)];
    const { grid } = buildSpatialGrid(complexes);
    expect(Object.keys(grid).length).toBe(0);
  });

  it("같은 셀에 여러 단지 배치", () => {
    // 0.02도 셀 = ~2km, 같은 셀 내 근접 좌표
    const complexes = [
      makeComplex("C1", "A", 37.500, 127.000),
      makeComplex("C2", "B", 37.501, 127.001),
    ];
    const { grid } = buildSpatialGrid(complexes);
    // 같은 셀에 2개
    const cells = Object.values(grid);
    const totalItems = cells.reduce((sum, arr) => sum + arr.length, 0);
    expect(totalItems).toBe(2);
  });

  it("커스텀 cellSize", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const { cellSize } = buildSpatialGrid(complexes, 0.05);
    expect(cellSize).toBe(0.05);
  });
});

// ── findNearbyComplexes ───────────────────────────────────────
describe("findNearbyComplexes", () => {
  it("반경 내 단지 반환", () => {
    // 서울 강남역 근처 (~300m 거리)
    const complexes = [
      makeComplex("C1", "A", 37.4979, 127.0276),
      makeComplex("C2", "B", 37.4990, 127.0280),
    ];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", 37.4985, 127.0278);

    const result = findNearbyComplexes(apt, spatialGrid, 2);
    expect(result).toContain("C1");
    expect(result).toContain("C2");
  });

  it("반경 외 단지 제외", () => {
    // ~50km 떨어진 좌표
    const complexes = [makeComplex("C1", "A", 38.0, 127.0)];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", 37.5, 127.0);

    const result = findNearbyComplexes(apt, spatialGrid, 2);
    expect(result).toEqual([]);
  });

  it("apt에 좌표 없음 → 빈 배열", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", null, null);

    const result = findNearbyComplexes(apt, spatialGrid);
    expect(result).toEqual([]);
  });

  it("빈 그리드 → 빈 배열", () => {
    const spatialGrid = buildSpatialGrid([]);
    const apt = makeApt("A1", "test", 37.5, 127.0);

    const result = findNearbyComplexes(apt, spatialGrid);
    expect(result).toEqual([]);
  });

  it("같은 좌표 → 거리 0, 반드시 포함", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", 37.5, 127.0);

    const result = findNearbyComplexes(apt, spatialGrid, 0.001);
    expect(result).toContain("C1");
  });
});

// ── fetchAllPages (PostgREST max_rows=1000 cap 회귀 가드) ──────────
/**
 * 체인 가능한 fake Supabase 빌더. allRows 를 .range(lo,hi) 로 슬라이스 반환.
 * range 호출 인자를 calls 에 기록 (1000씩 증가 검증용).
 * @param {any[]} allRows
 * @param {{ errorOnCall?: number; errorMsg?: string }} [opts]
 */
function makeFakeSb(allRows, opts = {}) {
  /** @type {Array<[number, number]>} */
  const rangeCalls = [];
  let callIdx = 0;
  const chain = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    not() { return chain; },
    /** @param {number} lo @param {number} hi */
    range(lo, hi) {
      rangeCalls.push([lo, hi]);
      callIdx++;
      if (opts.errorOnCall === callIdx) {
        return Promise.resolve({ data: null, error: { message: opts.errorMsg ?? "fake error" } });
      }
      return Promise.resolve({ data: allRows.slice(lo, hi + 1), error: null });
    },
  };
  return { sb: chain, rangeCalls };
}

describe("fetchAllPages (max_rows=1000 cap 회귀 가드)", () => {
  it("2500행 → range(0,999)/(1000,1999)/(2000,2999) 3회 호출 + 전건 2500행 수집", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const { sb, rangeCalls } = makeFakeSb(rows);
    const result = await fetchAllPages((s) => s.from("articles").select("id"), sb);
    expect(result.error).toBeNull();
    expect(result.rows.length).toBe(2500); // ← .range(0,99999) 단일 호출로 회귀하면 1000 으로 빨강
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("range 인자가 page(1000)씩 증가", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    const { sb, rangeCalls } = makeFakeSb(rows);
    await fetchAllPages((s) => s.from("articles").select("id"), sb);
    expect(rangeCalls.map(([lo]) => lo)).toEqual([0, 1000]);
  });

  it("정확히 PAGE 배수(2000행) → 빈 페이지 후 종료", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const { sb, rangeCalls } = makeFakeSb(rows);
    const result = await fetchAllPages((s) => s.from("articles").select("id"), sb);
    expect(result.rows.length).toBe(2000);
    // 2000행 = 2페이지 가득 → 3번째 빈 페이지 조회 후 종료
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("1페이지 error → { rows: 누적분, error } 반환 (graceful degradation 보존)", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const { sb } = makeFakeSb(rows, { errorOnCall: 2, errorMsg: "조회 실패" });
    const result = await fetchAllPages((s) => s.from("articles").select("id"), sb);
    expect(result.error).toBe("조회 실패");
    expect(result.rows.length).toBe(1000); // 1페이지(0~999)만 누적 후 2페이지에서 error
  });

  it("빈 테이블(0행) → { rows: [], error: null }", async () => {
    const { sb, rangeCalls } = makeFakeSb([]);
    const result = await fetchAllPages((s) => s.from("articles").select("id"), sb);
    expect(result.rows).toEqual([]);
    expect(result.error).toBeNull();
    expect(rangeCalls).toEqual([[0, 999]]); // 1회 조회 후 빈 결과로 종료
  });

  it("커스텀 page 크기 적용", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const { sb, rangeCalls } = makeFakeSb(rows);
    const result = await fetchAllPages((s) => s.from("articles").select("id"), sb, 100);
    expect(result.rows.length).toBe(250);
    expect(rangeCalls).toEqual([[0, 99], [100, 199], [200, 299]]);
  });
});

// ── articles 통합 fetch 컬럼 가드 (세션 356) ──────────────────────
// 4 Phase(area/trade_type/floor/maintenance)가 공유하는 단일 fetch 의 select 에
// 각 Phase 요구 컬럼이 빠짐없이 포함됐는지 검증. 미래에 Phase 가 새 컬럼을 쓰면서
// 통합 select 갱신을 깜박하면 silent 로 그 필드 집계가 비는 사고 차단.
describe("articles 통합 fetch 컬럼 가드", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./sync-naver-complex.mjs", import.meta.url)),
    "utf8",
  );
  // 통합 fetch select 문자열 추출 (allArticles 선언 라인 인근)
  const m = src.match(/allArticles[\s\S]*?\.select\(\s*"([^"]+)"/);
  const cols = (m?.[1] ?? "").split(",").map((c) => c.trim());

  const REQUIRED = [
    "complex_no",            // 모든 Phase 그룹핑 키
    "area1_m2", "area2_m2",  // Phase 1 전용률
    "direction",             // Phase 1 일조 + Phase 4 방향
    "building_name",         // Phase 1 조망
    "trade_type_name",       // Phase 2 매물수
    "floor_info",            // Phase 3b 평균층수
    "numeric_maintenance_cost", // Phase 4 관리비
  ];

  it("통합 select 가 추출됨", () => {
    expect(cols.length).toBeGreaterThan(0);
  });

  it.each(REQUIRED)("통합 select 에 %s 컬럼 포함", (col) => {
    expect(cols).toContain(col);
  });

  it("articles 별도 fetch 는 heating 1곳만 (Phase 2/3b/4 별도 fetch 제거 확인)", () => {
    // heating fetch + 통합 fetch = articles 직접 .from("articles") 2곳
    const fromArticles = (src.match(/\.from\("articles"\)/g) ?? []).length;
    expect(fromArticles).toBe(2);
  });
});

// ── flushUpdates 반환 형태 (collector_runs fail 집계용, 세션 373) ──────
describe("flushUpdates {ok, fail} 반환", () => {
  it("빈 배열 → { ok: 0, fail: 0 }", async () => {
    expect(await flushUpdates(/** @type {any} */ ({}), [], "")).toEqual({ ok: 0, fail: 0 });
  });

  it("성공·실패 섞임 → ok·fail 비대칭 정확 집계 (ok≠fail, 스왑 버그 차단)", async () => {
    // 3건 중 2건 성공·1건 실패 → ok=2, fail=1 (대칭이면 ok↔fail 스왑 버그 못 잡음)
    let call = 0;
    const sb = /** @type {any} */ ({
      from: () => ({
        update: () => ({
          eq: () => {
            call++;
            return Promise.resolve({ error: call === 2 ? { message: "boom" } : null });
          },
        }),
      }),
    });
    const updates = [
      /** @type {any} */ ({ id: "a", name: "A", row: {} }),
      /** @type {any} */ ({ id: "b", name: "B", row: {} }),
      /** @type {any} */ ({ id: "c", name: "C", row: {} }),
    ];
    expect(await flushUpdates(sb, updates, "test")).toEqual({ ok: 2, fail: 1 });
  });
});

// ── main() collector_runs 기록 (텔레그램 감시 편입, 세션 373) ──────
describe("main() recordCollectorRun 편입", () => {
  beforeEach(() => {
    recordCollectorRun.mockClear();
    getMibuyangSupabase.mockReset();
  });

  it("complexes 조회 실패 → throw + status=failure 기록", async () => {
    // 첫 supabase 호출(complexes select range)에서 에러 반환 → L203 throw
    getMibuyangSupabase.mockReturnValue(/** @type {any} */ ({
      from: () => ({
        select: () => ({
          range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
      }),
    }));

    await expect(main()).rejects.toThrow("complexes 조회 실패: boom");
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "sync-naver",
      expect.objectContaining({ status: "failure", errorMessage: "complexes 조회 실패: boom" }),
    );
  });

  it("정상 종료(빈 데이터) → status=success / ok=0 / fail=0 기록", async () => {
    // 모든 select·eq·not 체인이 빈 배열로 resolve → 4 Phase 전부 통과, throw 없음.
    // .not() 은 thenable(빈 배열) 이자 체인 가능해야 함 (heating 쿼리 L220-222).
    const emptyResult = { data: [], error: null };
    const emptyChain = {
      select: () => emptyChain,
      eq: () => emptyChain,
      not: () => Promise.resolve(emptyResult),
      range: () => Promise.resolve(emptyResult),
    };
    getMibuyangSupabase.mockReturnValue(/** @type {any} */ ({ from: () => emptyChain }));

    await main();
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "sync-naver",
      expect.objectContaining({ status: "success", ok: 0, fail: 0, skip: 0 }),
    );
  });
});
