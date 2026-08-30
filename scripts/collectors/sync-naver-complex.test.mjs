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

// ── fetchAllPages (고유키 커서 페이징 회귀 가드, 세션534) ──────────
// 옛 구현은 무정렬 OFFSET(.range) 반복이라 큰 표에서 행이 새고 중복됐다
// (라이브 실측: articles 같은 offset 2회 조회 교집합 0/100).
// 아래 fake 는 .range 를 아예 제공하지 않으므로, OFFSET 으로 되돌리면 TypeError 로 빨강.
/**
 * 체인 가능한 fake Supabase 빌더 — 커서 페이징(order/limit/lt/gt) 전용.
 *
 * allRows 를 order 방향으로 정렬 → lt/gt 커서 필터 → limit 슬라이스 → select 컬럼으로 투영.
 * "select 에 keyCol 누락" 시나리오는 투영에서 그 키가 빠지는 것으로 자연스럽게 재현된다
 * (정렬 자체는 원본 행으로 하므로 fake 가 먼저 죽지 않는다).
 *
 * @param {any[]} allRows
 * @param {{ errorOnCall?: number; errorMsg?: string }} [opts]
 */
function makeFakeSb(allRows, opts = {}) {
  /** @type {Array<{ table: string; cols: string[] | null; orderCol: string | null; ascending: boolean; op: string | null; cursorCol: string | null; cursor: any; limit: number }>} */
  const calls = [];
  let callIdx = 0;
  /** @type {any} */
  let st = null;

  const settle = () => {
    callIdx++;
    calls.push({ ...st });
    if (!st.orderCol) {
      // 무정렬 조회 = 이 룰이 막으려는 그 결함. fake 가 조용히 통과시키면 가드가 껍데기가 된다.
      throw new Error("fake sb: .order() 없이 조회 — 무정렬 페이징 회귀");
    }
    if (opts.errorOnCall === callIdx) {
      return Promise.resolve({ data: null, error: { message: opts.errorMsg ?? "fake error" } });
    }
    const col = st.orderCol;
    const sign = st.ascending ? 1 : -1;
    let rows = allRows.slice().sort((a, b) => (a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1) * sign));
    if (st.op === "gt") rows = rows.filter((r) => r[st.cursorCol] > st.cursor);
    else if (st.op === "lt") rows = rows.filter((r) => r[st.cursorCol] < st.cursor);
    rows = rows.slice(0, st.limit);
    const data = st.cols
      ? rows.map((r) => Object.fromEntries(st.cols.filter((/** @type {string} */ c) => c in r).map((/** @type {string} */ c) => [c, r[c]])))
      : rows;
    return Promise.resolve({ data, error: null });
  };

  // .limit() 이후에도 .lt/.gt 를 붙일 수 있어야 하므로 thenable 로 지연 평가.
  const terminal = () => ({
    /** @param {string} col @param {any} v */
    lt(col, v) { st.op = "lt"; st.cursorCol = col; st.cursor = v; return terminal(); },
    /** @param {string} col @param {any} v */
    gt(col, v) { st.op = "gt"; st.cursorCol = col; st.cursor = v; return terminal(); },
    /** @param {any} res @param {any} rej */
    then(res, rej) { return settle().then(res, rej); },
  });

  const chain = {
    /** @param {string} table */
    from(table) {
      st = { table, cols: null, orderCol: null, ascending: true, op: null, cursorCol: null, cursor: null, limit: Infinity };
      return chain;
    },
    /** @param {string} cols */
    select(cols) { st.cols = typeof cols === "string" ? cols.split(",").map((c) => c.trim()) : null; return chain; },
    eq() { return chain; },
    not() { return chain; },
    /** @param {string} col @param {{ ascending?: boolean }} [o] */
    order(col, o) { st.orderCol = col; st.ascending = o?.ascending !== false; return chain; },
    /** @param {number} n */
    limit(n) { st.limit = n; return terminal(); },
  };
  return { sb: chain, calls };
}

describe("fetchAllPages — 고유키 커서 페이징", () => {
  /** @param {number} n */
  const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, v: `v${i}` }));

  it("2500행 오름차순 → 3회 호출·전량 2500행·중복 0", async () => {
    const { sb, calls } = makeFakeSb(mkRows(2500));
    const result = await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id" });
    expect(result.error).toBeNull();
    expect(result.rows.length).toBe(2500);
    // 무정렬 OFFSET 으로 회귀하면 같은 행을 다시 받아 Set 크기가 작아진다.
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(2500);
    expect(calls.length).toBe(3);
    // 매 호출에 order 가 붙어야 한다 — 이게 빠지면 표본이 흔들린다.
    expect(calls.every((c) => c.orderCol === "id" && c.ascending === true)).toBe(true);
  });

  it("desc: true → ascending:false + lt 커서 사용", async () => {
    const { sb, calls } = makeFakeSb(mkRows(2500));
    const result = await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id", desc: true });
    expect(result.rows.length).toBe(2500);
    expect(calls.every((c) => c.ascending === false)).toBe(true);
    expect(calls[0].op).toBeNull();                      // 1페이지는 커서 없음
    expect(calls.slice(1).every((c) => c.op === "lt")).toBe(true);
    expect(result.rows[0].id).toBe(2499);                 // 내림차순 첫 행
  });

  it("커서 값이 각 페이지 마지막 행의 keyCol", async () => {
    const { sb, calls } = makeFakeSb(mkRows(2500));
    await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id" });
    expect(calls[1].cursorCol).toBe("id");
    expect(calls[1].cursor).toBe(999);   // 1페이지 마지막 행
    expect(calls[2].cursor).toBe(1999);  // 2페이지 마지막 행
  });

  it("중간 페이지 error → { rows: 누적분, error } (fail-open 회귀 가드)", async () => {
    const { sb } = makeFakeSb(mkRows(2500), { errorOnCall: 2, errorMsg: "조회 실패" });
    const result = await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id" });
    expect(result.error).toBe("조회 실패");     // throw 로 바뀌면 이 단언에 도달 못 해 빨강
    expect(result.rows.length).toBe(1000);
  });

  it("빈 테이블(0행) → { rows: [], error: null }", async () => {
    const { sb, calls } = makeFakeSb([]);
    const result = await fetchAllPages((s) => s.from("t").select("id"), sb, { keyCol: "id" });
    expect(result.rows).toEqual([]);
    expect(result.error).toBeNull();
    expect(calls.length).toBe(1);
  });

  it("정확히 page 배수(2000행) → 마지막 빈 페이지 후 정상 종료", async () => {
    const { sb, calls } = makeFakeSb(mkRows(2000));
    const result = await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id" });
    expect(result.rows.length).toBe(2000);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(2000);
    expect(calls.length).toBe(3); // 2페이지 가득 → 3번째 빈 페이지 확인 후 종료
  });

  it("커스텀 page 크기 적용", async () => {
    const { sb, calls } = makeFakeSb(mkRows(250));
    const result = await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id", page: 100 });
    expect(result.rows.length).toBe(250);
    expect(calls.map((c) => c.limit)).toEqual([100, 100, 100]);
  });

  it("가득 찬 페이지 끝의 null 키 → error 반환 (무한루프 가드, 적대검증 F1)", async () => {
    // 가드가 없으면 cursor=null → 다음 회차가 커서 없이 같은 페이지를 다시 받아 무한루프(테스트 타임아웃).
    // fake 의 desc 정렬은 null 을 맨 뒤로 보낸다(JS 비교) — 999행 + null 1행 = 정확히 가득 찬 1000행.
    const rows = [...Array.from({ length: 999 }, (_, i) => ({ id: i + 1, v: i })), { id: null, v: "x" }];
    const { sb } = makeFakeSb(rows);
    const result = await fetchAllPages((s) => s.from("t").select("id, v"), sb, { keyCol: "id", desc: true });
    expect(result.error).toContain("커서 진행 불가");
    expect(result.rows.length).toBe(1000); // fail-open: 누적분은 돌려준다
  });

  it("select 에 keyCol 누락 → error 반환 (throw 아님)", async () => {
    // select 가 article_no 를 안 담으면 커서를 못 만들어 조용히 1페이지만 받고 끝난다.
    const rows = Array.from({ length: 2500 }, (_, i) => ({ article_no: String(1000000 + i), v: i }));
    const { sb } = makeFakeSb(rows);
    const result = await fetchAllPages(
      (s) => s.from("articles").select("v"), // ← article_no 누락
      sb,
      { keyCol: "article_no" },
    );
    expect(result.error).toContain("keyCol 'article_no' 누락");
    expect(result.rows).toEqual([]); // 잘린 1페이지를 전량인 척 돌려주지 않는다
  });
});

// ── fetchAllPages 호출처 배선 가드 (소스 grep, 세션534) ──────────────────
// 순수 함수 테스트로는 "어느 표를 어느 키·어느 방향으로 훑는가" 를 못 잡는다.
// 정규식은 좌변(구조분해 변수명)까지 고정해 함수 선언부·주석에 걸리지 않게 한다
// (.claude/rules/meta/guards-must-be-mutation-tested.md §소스 grep).
describe("fetchAllPages 호출처 배선 가드", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./sync-naver-complex.mjs", import.meta.url)),
    "utf8",
  );
  /** @param {RegExp} re */
  const block = (re) => {
    const m = src.match(re);
    expect(m?.[1]).toBeTruthy();
    return m?.[1] ?? "";
  };

  it("articles 통합 조회 = article_no 내림차순 커서", () => {
    const b = block(/const \{ rows: allArticles, error: artFetchErr \} = await fetchAllPages\(([\s\S]{0,900}?)\);/);
    expect(b).toContain('.from("articles")');
    // select "리터럴" 에 커서 키가 있어야 한다 — 바깥 keyCol 옵션 줄에도 article_no 가 있어
    // 느슨한 toContain("article_no") 는 select 에서 빼도 초록(뮤테이션 M4 실증) → 리터럴 고정.
    expect(b).toContain('"article_no, complex_no');
    expect(b).toContain('keyCol: "article_no"');
    expect(b).toContain("desc: true");          // 활성 매물이 최신 쪽에 몰려 있다(§2)
    expect(b).toContain('.eq("is_active", true)');
  });

  it("heating 조회는 생 쿼리가 아니라 fetchAllPages 경유 (not 필터 유지)", () => {
    const b = block(/const \{ rows: heatingRows, error: hErr \} = await fetchAllPages\(([\s\S]{0,900}?)\);/);
    expect(b).toContain('.from("articles")');
    expect(b).toContain('.not("heating_type", "is", null)');
    expect(b).toContain('"article_no, complex_no, heating_type"'); // select 리터럴 고정 (M4 답습)
    expect(b).toContain('keyCol: "article_no"');
    expect(b).toContain("desc: true");
  });

  it("complex_price_history 조회 = id 오름차순 커서", () => {
    const b = block(/const \{ rows: priceRows, error: prErr \} = await fetchAllPages\(([\s\S]{0,900}?)\);/);
    expect(b).toContain('.from("complex_price_history")');
    expect(b).toContain('.select("id,');        // select 에 커서 키 포함
    expect(b).toContain('keyCol: "id"');
  });

  it("fetchAllPages 가 무정렬 .range() 로 되돌아가지 않음", () => {
    const m = src.match(/export async function fetchAllPages\([\s\S]{0,1200}?\n\}/);
    expect(m).toBeTruthy();
    expect(m?.[0]).toContain(".order(keyCol");
    expect(m?.[0]).not.toContain(".range(");
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

// ── complexes 무정렬 페이징 → 고유키(complex_no) 커서 회귀 가드 (세션534) ──────
// complexes 는 id 컬럼이 없어 고유키 = complex_no. 무정렬 OFFSET 으로 훑으면 6.4만행
// 3페이지 경계에서 행이 샌다(unordered-pagination-loses-rows.md §1). selectAll 커서 모드
// 옵트인(keyCol="complex_no")이 되돌아가지 않게 소스에서 직접 검사.
describe("complexes 고유키(complex_no) 커서 페이징 가드", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./sync-naver-complex.mjs", import.meta.url)),
    "utf8",
  );

  it("complexes 조회는 selectAll(..., sbMibunyang, \"complex_no\") 커서", () => {
    // 호출부를 앵커로 keyCol 캡처 — keyCol 제거·변경 시 red (뮤테이션 대상).
    const m = src.match(
      /selectAll\(\s*\(s\) => s\.from\("complexes"\)[\s\S]*?,\s*sbMibunyang,\s*"([^"]+)"/,
    );
    expect(m?.[1]).toBe("complex_no");
  });

  it("complexes 에 무정렬 .range() 오프셋 루프가 남아있지 않음", () => {
    // .from("complexes") 직후 .range( 가 붙으면 옛 offset 페이징이 되살아난 것.
    expect(/\.from\("complexes"\)[\s\S]{0,400}?\.range\(/.test(src)).toBe(false);
  });
});

// ── apartments 재조회(aptsForUnsold·aptsForNaver) 손제작 커서 회귀 가드 (세션534) ──
// fail-open(에러 시 break·throw 안 함)을 유지해야 해서 selectAll(throw) 대신 id 손제작
// 커서로 전환. 무정렬 OFFSET 으로 되돌아가면 3페이지 경계에서 행이 샌다(§1).
describe("apartments 재조회 id 손제작 커서 페이징 가드", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./sync-naver-complex.mjs", import.meta.url)),
    "utf8",
  );

  it("apartments 조회에 무정렬 .range() 오프셋 루프가 남아있지 않음", () => {
    // .from("apartments") 직후 .range( 가 붙으면 옛 offset 페이징이 되살아난 것.
    expect(/\.from\("apartments"\)[\s\S]{0,400}?\.range\(/.test(src)).toBe(false);
  });

  it("aptsForUnsold·aptsForNaver 재조회는 id 커서(order+gt)로 훑는다", () => {
    // 두 재조회 블록이 order("id", {ascending:true}) + gt("id", cursorX) 로 커서 훑기.
    // 한 블록만 range 로 되돌아가도 order 개수가 2 미만이 되어 red (뮤테이션 대상).
    const orderIds = src.match(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/g) ?? [];
    const gtIds = src.match(/\.gt\("id",\s*cursor[A-Z]\)/g) ?? [];
    expect(orderIds.length).toBeGreaterThanOrEqual(2); // B(aptsForUnsold) + C(aptsForNaver)
    expect(gtIds.length).toBeGreaterThanOrEqual(2);
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
    // 첫 supabase 호출(complexes selectAll 커서)에서 에러 반환 → throw.
    // 세션534: selectAll 이 order().limit() 체인으로 훑고 "selectAll 조회 실패:" 로 래핑.
    getMibuyangSupabase.mockReturnValue(/** @type {any} */ ({
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    }));

    await expect(main()).rejects.toThrow("selectAll 조회 실패: boom");
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "sync-naver",
      expect.objectContaining({ status: "failure", errorMessage: "selectAll 조회 실패: boom" }),
    );
  });

  it("정상 종료(빈 데이터) → status=success / ok=0 / fail=0 기록", async () => {
    // 모든 select·eq·not·order·limit 체인이 빈 배열로 resolve → 4 Phase 전부 통과, throw 없음.
    // 세션534: complexes·apartments 는 selectAll 커서(order().limit().gt()) 경로,
    // articles(통합·heating)·complex_price_history 는 fetchAllPages 커서 경로.
    // → .not() 도 체인 가능해야 한다(뒤에 .order().limit() 이 붙는다).
    const emptyResult = { data: [], error: null };
    const emptyChain = {
      select: () => emptyChain,
      eq: () => emptyChain,
      not: () => emptyChain,
      range: () => Promise.resolve(emptyResult),
      order: () => emptyChain,
      limit: () => Promise.resolve(emptyResult),
      gt: () => Promise.resolve(emptyResult),
      lt: () => Promise.resolve(emptyResult),
    };
    getMibuyangSupabase.mockReturnValue(/** @type {any} */ ({ from: () => emptyChain }));

    await main();
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "sync-naver",
      expect.objectContaining({ status: "success", ok: 0, fail: 0, skip: 0 }),
    );
  });
});
