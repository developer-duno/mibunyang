// @ts-check
/**
 * infra-kakao.mjs 테스트 — 세마포어 동시성 제어 검증
 *
 * 대상: createSemaphore
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    fetchWithRetry: vi.fn(),
    sleep: vi.fn(),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});

// KAKAO_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.KAKAO_KEY = "test-key";

const { createSemaphore, buildFreshIds, FRESH_DAYS, REQUIRED_KEYS, searchKakao, errorFailCount } = await import("./infra-kakao.mjs");
const shared = await import("./_shared.mjs");

// ── 개수는 meta.total_count 로 센다 (세션511) ─────────────────────────────
//
// 예전에는 `size=5` 로 받아 `documents.length` 를 셌다. 그러면 반경 안에 몇 개가 있든 **최대 5로
// 잘려서**, 만점 기준이 편의점 10 · 카페 20 인 두 항목은 **어떤 단지도 만점에 도달할 수 없었다**
// (세션498 버스 정류장과 같은 "수집 상한 < 만점 기준" 사고). 되돌아가면 여기서 red 가 난다.

describe("searchKakao — 개수는 meta.total_count (documents.length 로 되돌리면 red)", () => {
  /** @param {{ total_count?: number } | undefined} meta @param {number} docCount */
  function mockRes(meta, docCount) {
    const documents = Array.from({ length: docCount }, (_, i) => ({
      x: "127", y: "37", distance: String(100 + i),
    }));
    /** @type {any} */ (shared.fetchWithRetry).mockResolvedValue({ json: async () => ({ documents, meta }) });
  }

  it("documents 가 1건뿐이어도 total_count 를 개수로 쓴다", async () => {
    mockRes({ total_count: 42 }, 1);
    const { count } = await searchKakao(37.5, 127.0, "카페", 500);
    expect(count).toBe(42); // documents.length(=1) 로 세면 실패
  });

  it("만점 기준을 넘는 개수도 잘리지 않는다 — 카페 만점 20 을 넘는 193 이 그대로 온다", async () => {
    mockRes({ total_count: 193 }, 1);
    const { count } = await searchKakao(37.5, 127.0, "카페", 500);
    expect(count).toBe(193);
  });

  // 세션681: 옛 계약은 「meta 없으면 documents 길이로 폴백」이었다. 카카오 정상 응답은 늘 meta 를 싣는다
  // (developers.kakao.com/docs/ko/local/dev-guide) — meta 없는 응답은 모양이 깨진 것(한도·장애 의심)이라
  // 「0건/N건」으로 덮어쓰지 않고 던진다(설계서 2026-10-31-infra-kakao-updated-at-design.md §3-2 빈 응답).
  it("meta 가 없는 응답은 던진다 (세션681 — 옛 폴백 계약 폐기)", async () => {
    mockRes(undefined, 3);
    await expect(searchKakao(37.5, 127.0, "병원", 1000)).rejects.toThrow(/카카오 응답 모양 깨짐/);
  });

  it("meta 에 total_count 가 없으면 documents 길이로 (meta 는 있으니 모양 정상)", async () => {
    mockRes({}, 3);
    const { count } = await searchKakao(37.5, 127.0, "병원", 1000);
    expect(count).toBe(3);
  });

  it("최근접 1건의 거리는 그대로 얻는다 (sort=distance 라 첫 건이 최근접)", async () => {
    mockRes({ total_count: 42 }, 1);
    const { nearest } = await searchKakao(37.5, 127.0, "카페", 500);
    expect(nearest?.distance).toBe("100");
  });

  it("0건이면 count 0 · nearest null (없음을 실패로 만들지 않는다)", async () => {
    mockRes({ total_count: 0 }, 0);
    const { count, nearest } = await searchKakao(37.5, 127.0, "대형마트", 1000);
    expect(count).toBe(0);
    expect(nearest).toBeNull();
  });
});

// ── 세션681: 빈·깨진 응답 가드 — 모양이 깨진 응답을 0건으로 덮어쓰지 않는다 ─────────────
describe("searchKakao — 빈·깨진 응답은 던진다 (세션681 B7)", () => {
  /** @param {unknown} body */
  const mockBody = (body) => /** @type {any} */ (shared.fetchWithRetry).mockResolvedValue({ json: async () => body });

  for (const [label, body] of /** @type {Array<[string, unknown]>} */ ([
    ["빈 객체 {}", {}],
    ["documents 없음 {meta:{}}", { meta: {} }],
    ["documents 가 배열 아님", { meta: { total_count: 3 }, documents: "x" }],
    ["meta 가 배열", { meta: [], documents: [] }],
    ["null", null],
  ])) {
    it(`${label} → throw`, async () => {
      mockBody(body);
      await expect(searchKakao(37.5, 127.0, "병원", 1000)).rejects.toThrow(/카카오 응답 모양 깨짐/);
    });
  }

  it("정상 0건 {meta:{total_count:0},documents:[]} → count 0 · nearest null (진짜 0 은 그대로)", async () => {
    mockBody({ meta: { total_count: 0 }, documents: [] });
    const { count, nearest } = await searchKakao(37.5, 127.0, "병원", 1000);
    expect(count).toBe(0);
    expect(nearest).toBeNull();
  });

  it("지하철(카테고리) 검색도 같은 검사를 지난다 — searchKakaoCategory 소스 대조", () => {
    const fn = COLLECTOR_SRC.slice(COLLECTOR_SRC.indexOf("async function searchKakaoCategory("), COLLECTOR_SRC.indexOf("async function main()"));
    expect(fn).toMatch(/return assertKakaoShape\(await res\.json\(\), categoryCode\)\.documents;/);
    expect(fn).not.toMatch(/data\.documents \|\| \[\]/);
  });
});

// ── createSemaphore ───────────────────────────────────────────
describe("createSemaphore", () => {
  it("동시 1개 제한 — 순차 실행", async () => {
    const sem = createSemaphore(1);
    /** @type {string[]} */
    const order = [];

    /** @param {string} id @param {number} ms */
    const task = (id, ms) => sem(async () => {
      order.push(`start-${id}`);
      await new Promise(r => setTimeout(r, ms));
      order.push(`end-${id}`);
      return id;
    });

    const results = await Promise.all([task("a", 10), task("b", 10)]);
    expect(results).toEqual(["a", "b"]);
    // a가 완전히 끝난 후 b 시작
    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });

  it("동시 2개 제한 — 2개까지 병렬", async () => {
    const sem = createSemaphore(2);
    /** @type {string[]} */
    const order = [];

    /** @param {string} id @param {number} ms */
    const task = (id, ms) => sem(async () => {
      order.push(`start-${id}`);
      await new Promise(r => setTimeout(r, ms));
      order.push(`end-${id}`);
    });

    await Promise.all([task("a", 20), task("b", 20), task("c", 10)]);
    // a, b 동시 시작, c는 하나 완료 후 시작
    expect(order[0]).toBe("start-a");
    expect(order[1]).toBe("start-b");
  });

  it("작업 반환값 전달", async () => {
    const sem = createSemaphore(5);
    const result = await sem(async () => 42);
    expect(result).toBe(42);
  });

  it("작업 예외 시 슬롯 해제", async () => {
    const sem = createSemaphore(1);

    // 첫 작업 실패
    await expect(sem(async () => { throw new Error("fail"); })).rejects.toThrow("fail");

    // 두 번째 작업 정상 실행 (슬롯 해제 확인)
    const result = await sem(async () => "ok");
    expect(result).toBe("ok");
  });

  it("큐 대기 후 순서대로 실행", async () => {
    const sem = createSemaphore(1);
    /** @type {number[]} */
    const results = [];

    await Promise.all([
      sem(async () => { results.push(1); }),
      sem(async () => { results.push(2); }),
      sem(async () => { results.push(3); }),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });
});

// ── buildFreshIds — 매일 전량 재수집 차단 (세션 490) ──────────
const NOW = Date.parse("2026-08-05T00:00:00Z");
const daysAgo = (/** @type {number} */ n) => new Date(NOW - n * 86400000).toISOString();

/**
 * 모든 필수 컬럼이 채워진 완결 행. 시계 = kakao_updated_at(세션681).
 * 공유 시계 updated_at 은 일부러 넣지 않는다 — 판정이 updated_at 으로 되돌아가면 NULL 이라 재수집으로 바뀌어 red.
 */
function makeCompleteRow(overrides = {}) {
  /** @type {Record<string, unknown>} */
  const row = { apartment_id: "ap-1", kakao_updated_at: daysAgo(1) };
  for (const k of REQUIRED_KEYS) row[k] = 1;
  return { ...row, ...overrides };
}

describe("buildFreshIds — 완결 + 신선 둘 다 만족해야 건너뜀", () => {
  it("완결 + 최근(1일 전) → 건너뜀", () => {
    expect(buildFreshIds([makeCompleteRow()], NOW).has("ap-1")).toBe(true);
  });

  it("완결이지만 오래됨(31일 전) → 재수집 (건너뛰지 않음)", () => {
    const rows = [makeCompleteRow({ kakao_updated_at: daysAgo(31) })];
    expect(buildFreshIds(rows, NOW).size).toBe(0);
  });

  it("최근이지만 한 칸 비어 있음 → 재수집 (시간만 보면 영구 미보강 — 세션 338 교훈)", () => {
    const rows = [makeCompleteRow({ park: null })];
    expect(buildFreshIds(rows, NOW).size).toBe(0);
  });

  it("subway_dist 만 비어 있어도 재수집", () => {
    const rows = [makeCompleteRow({ subway_dist: null })];
    expect(buildFreshIds(rows, NOW).size).toBe(0);
  });

  it("kakao_updated_at 없음(잰 적 없음) / 파싱 불가 → 재수집", () => {
    expect(buildFreshIds([makeCompleteRow({ kakao_updated_at: null })], NOW).size).toBe(0);
    expect(buildFreshIds([makeCompleteRow({ kakao_updated_at: "not-a-date" })], NOW).size).toBe(0);
  });

  it("경계: 정확히 FRESH_DAYS 직전은 건너뜀, 직후는 재수집", () => {
    const justInside = [makeCompleteRow({ kakao_updated_at: daysAgo(FRESH_DAYS - 0.01) })];
    const justOutside = [makeCompleteRow({ kakao_updated_at: daysAgo(FRESH_DAYS + 0.01) })];
    expect(buildFreshIds(justInside, NOW).size).toBe(1);
    expect(buildFreshIds(justOutside, NOW).size).toBe(0);
  });

  it("apartment_id 없는 행은 무시 · 빈 입력은 빈 Set", () => {
    expect(buildFreshIds([makeCompleteRow({ apartment_id: "" })], NOW).size).toBe(0);
    expect(buildFreshIds([], NOW).size).toBe(0);
    expect(buildFreshIds(/** @type {any} */ (null), NOW).size).toBe(0);
  });

  it("혼합 3건: 완결·최근 1건만 건너뜀", () => {
    const rows = [
      makeCompleteRow({ apartment_id: "ap-fresh" }),
      makeCompleteRow({ apartment_id: "ap-old", kakao_updated_at: daysAgo(90) }),
      makeCompleteRow({ apartment_id: "ap-partial", mart: null }),
    ];
    const fresh = buildFreshIds(rows, NOW);
    expect([...fresh]).toEqual(["ap-fresh"]);
  });

  // 세션681 C2: 두 시계를 반대로 둔다 — 판정이 공유 시계 updated_at 으로 되돌아가면 두 단언이 함께 뒤집혀 red.
  it("두 시계 반대: 남의 시계 최신(1일) · 카카오 시계 낡음(40일) → 대상(건너뛰지 않음)", () => {
    const rows = [makeCompleteRow({ updated_at: daysAgo(1), kakao_updated_at: daysAgo(40) })];
    expect(buildFreshIds(rows, NOW).size).toBe(0);
  });
  it("두 시계 반대: 남의 시계 낡음(40일) · 카카오 시계 최신(1일) → 건너뜀", () => {
    const rows = [makeCompleteRow({ updated_at: daysAgo(40), kakao_updated_at: daysAgo(1) })];
    expect([...buildFreshIds(rows, NOW)]).toEqual(["ap-1"]);
  });
});

// ── 세션599: 카카오·upsert 오류를 비율 기준으로 실패로 센다 ──────────────
// 옛 판은 catch·upsert 오류에서 skipped++ 라 카카오가 하루 종일 고장이어도 success("갱신 없음(정상)").
// 이제 시도(갱신+오류) 중 오류가 절반 이상이면 fail(→ exit 1), 그 아래는 옛 동작대로 skip.
const COLLECTOR_SRC = readFileSync(new URL("./infra-kakao.mjs", import.meta.url), "utf-8");

describe("단지 처리 오류 — 절반 이상이면 실패로 센다 (세션599)", () => {
  it("시도 10 · 오류 5(경계, 정확히 절반) → fail 5", () => {
    expect(errorFailCount({ ok: 5, err: 5 })).toBe(5);
  });

  it("시도 10 · 오류 4(절반 미만) → fail 0 (skip 으로)", () => {
    expect(errorFailCount({ ok: 6, err: 4 })).toBe(0);
  });

  it("시도 0 → fail 0", () => {
    expect(errorFailCount({ ok: 0, err: 0 })).toBe(0);
  });

  it("갱신 0 · 오류 3(카카오 전부 고장) → fail 3", () => {
    expect(errorFailCount({ ok: 0, err: 3 })).toBe(3);
  });

  // 배선 — 함수만 옳고 main 이 안 부르면 위 시험은 초록이다(guards-must-be-mutation-tested).
  it("main 이 오류를 errored 로 세고, 판정 결과를 rpt.fail 로 넘기며 0 이면 rpt.skip 으로", () => {
    const body = COLLECTOR_SRC.slice(COLLECTOR_SRC.indexOf("async function main()"));
    expect(body).toMatch(/const errFailN = errorFailCount\(\{ ok: updated, err: errored \}\);\s*if \(errFailN > 0\) rpt\.fail\(errFailN\);\s*else rpt\.skip\(errored\);/);
    // catch·upsert 오류 둘 다 errored 로(skipped 칸이 되살아나면 red)
    expect(body.match(/errored\+\+;/g)?.length).toBe(2);
    expect(body).not.toMatch(/skipped\+\+/);
  });
});

// ── 세션679: 한 회차 상한 — 오래된 순 N곳만, 넘친 수는 기록, 굶주림 없음 ──────────
// 사건: infra.updated_at 공유 시계 때문에 3,440행 중 3,255행이 같은 초(2026-10-18T13:59:24Z)로 묶여
// KST 11/20 회차 한 번에 3,264단지 × 9콜이 몰릴 예정이었다(transition-b2.md ②-b). 사장님 결정 = 한 회차 상한.
const { selectInfraTargets, parseMaxApts, resolveMaxApts, countClockStats, DEFAULT_MAX_APTS, INFRA_DEFERRED_MARKER } = await import("./infra-kakao.mjs");

/** @param {string} id */
const apt = (id) => ({ id, name: id, lat: 37.5, lng: 127.0 });

describe("selectInfraTargets — 한 회차 상한 (세션679 · 시계 = kakao_updated_at 세션681)", () => {
  // 낡은(31일+) 완결 행 5개 — 낡은 정도가 id 순서와 반대라 정렬이 id 로 대신되면 red
  const staleRows = [
    makeCompleteRow({ apartment_id: "a1", kakao_updated_at: daysAgo(31) }),
    makeCompleteRow({ apartment_id: "a2", kakao_updated_at: daysAgo(40) }),
    makeCompleteRow({ apartment_id: "a3", kakao_updated_at: daysAgo(50) }),
    makeCompleteRow({ apartment_id: "a4", kakao_updated_at: daysAgo(60) }),
    makeCompleteRow({ apartment_id: "a5", kakao_updated_at: daysAgo(70) }),
  ];
  const aptsAll = ["a1", "a2", "a3", "a4", "a5"].map(apt);

  it("상한보다 많으면 오래된 순 N곳만 · 넘친 수 = 나머지", () => {
    const r = selectInfraTargets(aptsAll, staleRows, { nowMs: NOW, maxApts: 2 });
    expect(r.targets.map((a) => a.id)).toEqual(["a5", "a4"]);
    expect(r.deferred).toBe(3);
  });

  it("상한보다 적으면 전부 · 넘친 수 0", () => {
    const r = selectInfraTargets(aptsAll, staleRows, { nowMs: NOW, maxApts: 10 });
    expect(r.targets.map((a) => a.id)).toEqual(["a5", "a4", "a3", "a2", "a1"]);
    expect(r.deferred).toBe(0);
  });

  it("한 번도 못 채운 행(infra 행 없음·빈칸)이 낡은 완결 행보다 먼저 · 최신 완결 행은 안 고름", () => {
    const rows = [
      ...staleRows,
      makeCompleteRow({ apartment_id: "fresh", kakao_updated_at: daysAgo(1) }),
      makeCompleteRow({ apartment_id: "partial", kakao_updated_at: daysAgo(1), subway_dist: null }),
    ];
    const r = selectInfraTargets([...aptsAll, apt("fresh"), apt("partial"), apt("norow")], rows, { nowMs: NOW, maxApts: 3 });
    expect(r.targets.map((a) => a.id)).toEqual(["norow", "partial", "a5"]);
    expect(r.freshCount).toBe(1);
    expect(r.deferred).toBe(4);
  });

  it("kakao_updated_at 이 NULL(잰 적 없음)인 완결 행은 낡은 행보다 먼저(NULL = 맨 앞)", () => {
    const rows = [...staleRows, makeCompleteRow({ apartment_id: "a9", kakao_updated_at: null })];
    const r = selectInfraTargets([...aptsAll, apt("a9")], rows, { nowMs: NOW, maxApts: 2 });
    expect(r.targets.map((a) => a.id)).toEqual(["a9", "a5"]);
  });

  // 세션681 C2: 정렬 키가 공유 시계 updated_at 으로 되돌아가면 순서가 뒤집혀 red.
  it("두 시계 반대: 카카오 시계가 오래된 쪽이 먼저(남의 시계 순서와 반대)", () => {
    const rows = [
      makeCompleteRow({ apartment_id: "k-old", updated_at: daysAgo(1), kakao_updated_at: daysAgo(80) }),
      makeCompleteRow({ apartment_id: "k-new", updated_at: daysAgo(90), kakao_updated_at: daysAgo(35) }),
    ];
    const r = selectInfraTargets([apt("k-new"), apt("k-old")], rows, { nowMs: NOW, maxApts: 1 });
    expect(r.targets.map((a) => a.id)).toEqual(["k-old"]);
    expect(r.deferred).toBe(1);
  });

  it("kakao_updated_at 이 같으면 id 순", () => {
    const rows = ["c", "a", "b"].map((id) => makeCompleteRow({ apartment_id: id, kakao_updated_at: daysAgo(45) }));
    const r = selectInfraTargets([apt("c"), apt("a"), apt("b")], rows, { nowMs: NOW, maxApts: 2 });
    expect(r.targets.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("굶주림 없음 — 1회차에 고른 행이 갱신되면 2회차는 1회차가 못 고른 행부터", () => {
    const rows = /** @type {Array<Record<string, any>>} */ (staleRows.map((r) => ({ ...r })));
    const first = selectInfraTargets(aptsAll, rows, { nowMs: NOW, maxApts: 2 });
    for (const t of first.targets) {
      const row = rows.find((r) => r.apartment_id === t.id);
      if (row) row.kakao_updated_at = new Date(NOW).toISOString(); // 수집기가 쓴 카카오 시각
    }
    const second = selectInfraTargets(aptsAll, rows, { nowMs: NOW + 3 * 86400000, maxApts: 2 });
    expect(second.targets.map((a) => a.id)).toEqual(["a3", "a2"]);
    const third = selectInfraTargets(aptsAll, rows.map((r) => (second.targets.some((t) => t.id === r.apartment_id) ? { ...r, kakao_updated_at: new Date(NOW + 3 * 86400000).toISOString() } : r)), { nowMs: NOW + 7 * 86400000, maxApts: 2 });
    expect(third.targets.map((a) => a.id)).toEqual(["a1"]);
    expect(third.deferred).toBe(0);
  });

  it("force 면 신선한 행도 대상(상한 없으면 전부) · maxApts null = 상한 없음", () => {
    const rows = [makeCompleteRow({ apartment_id: "fresh", kakao_updated_at: daysAgo(1) }), ...staleRows];
    const r = selectInfraTargets([apt("fresh"), ...aptsAll], rows, { nowMs: NOW, force: true, maxApts: null });
    expect(r.targets).toHaveLength(6);
    expect(r.freshCount).toBe(0);
    expect(r.deferred).toBe(0);
  });
});

describe("parseMaxApts — 인자 (세션679)", () => {
  it("없으면 null · `--max-apts=N` 이면 N", () => {
    expect(parseMaxApts(["node", "x.mjs"])).toBeNull();
    expect(parseMaxApts(["node", "x.mjs", "--dry-run", "--max-apts=300"])).toBe(300);
  });
  it("0·음수·소수·글자·값 없음·두 번 주기는 던진다(오타로 상한이 조용히 풀리지 않게)", () => {
    for (const bad of [["--max-apts=0"], ["--max-apts=-5"], ["--max-apts=1.5"], ["--max-apts=abc"], ["--max-apts="], ["--max-apts"], ["--max-apts=1", "--max-apts=2"]]) {
      expect(() => parseMaxApts(bad)).toThrow();
    }
  });
});

describe("상한 배선 — main(소스 확인 · 세션679)", () => {
  const body = COLLECTOR_SRC.slice(COLLECTOR_SRC.indexOf("async function main()"));
  it("기본 상한 800 — 근거 숫자를 바꾸려면 transition-b2.md ②-b 를 다시 잰다", () => {
    expect(DEFAULT_MAX_APTS).toBe(800);
  });
  it("상한은 resolveMaxApts(process.argv) 한 곳에서 정하고 selectInfraTargets 로 넘긴다", () => {
    expect(body).toMatch(/const \{ force: forceAll, maxApts \} = resolveMaxApts\(process\.argv\);/);
    expect(body).toMatch(/selectInfraTargets\(withCoords, infraRows, \{ maxApts, force: forceAll \}\)/);
  });
  it("넘긴 수는 collector_runs.error_message 표식으로 남긴다(INFRA_DEFERRED=N)", () => {
    expect(INFRA_DEFERRED_MARKER).toBe("INFRA_DEFERRED=");
    expect(body).toMatch(/errorMessage: joinRunMessage\(undefined, `\$\{INFRA_DEFERRED_MARKER\}\$\{deferred\}`\)/);
    expect(body).toMatch(/await recordCollectorRun\(PHASE, result\);/);
  });
});

// ── 세션681: 카카오 전용 시계 kakao_updated_at 배선 ─────────────────────────────
describe("카카오 시계 배선 — main(소스 확인 · 세션681)", () => {
  const body = COLLECTOR_SRC.slice(COLLECTOR_SRC.indexOf("async function main()"));
  // C3: 읽기 select 목록에서 kakao_updated_at 을 빼먹으면 모든 행이 「잰 적 없음」이 되어 매 회차 800곳을 영구히 다시 잰다.
  it("infra 읽기 select 목록에 kakao_updated_at 이 있다", () => {
    const m = body.match(/s\.from\("infra"\)\.select\(\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m?.[1] ?? "").toContain('"kakao_updated_at"');
    expect(m?.[1] ?? "").toContain('"updated_at"'); // 관찰 로그용으로 남김(설계서 §6 Q1)
  });
  it("upsert 행에 kakao_updated_at 을 같은 시각으로 쓴다", () => {
    expect(body).toMatch(/const row = \{ apartment_id: apt\.id, updated_at: now, kakao_updated_at: now \};/);
  });
  it("관찰 로그 — 남의 시계 최신 M행 / kakao 시계 NULL K행", () => {
    expect(body).toMatch(/const clock = countClockStats\(infraRows\);/);
    expect(body).toContain("남의 시계(updated_at) 최신");
  });
  it("main().catch 가 실패 1행을 collector_runs 에 남긴 뒤 exit 1", () => {
    const tail = COLLECTOR_SRC.slice(COLLECTOR_SRC.indexOf("if (isCLI) main().catch("));
    expect(tail).toMatch(/await recordCollectorRun\(PHASE, \{ ok: 0, fail: 1, skip: 0, errorMessage: msg \}\);[\s\S]*process\.exit\(1\);/);
  });
});

describe("countClockStats — 관찰용 시계 통계 (세션681)", () => {
  it("남의 시계 30일 안 행 수 · 카카오 시계 NULL 행 수", () => {
    const rows = [
      { apartment_id: "a", updated_at: daysAgo(1), kakao_updated_at: null },
      { apartment_id: "b", updated_at: daysAgo(40), kakao_updated_at: daysAgo(1) },
      { apartment_id: "c", updated_at: null },
    ];
    expect(countClockStats(rows, NOW)).toEqual({ sharedFresh: 1, kakaoNull: 2 });
  });
});

// C5: --force 단독은 상한 없이 전량(약 31,000콜)이 나가므로 막는다.
describe("resolveMaxApts — --force 는 --max-apts 와 함께만 (세션681 B6)", () => {
  it("--force 만 → 던진다", () => {
    expect(() => resolveMaxApts(["node", "x.mjs", "--force"])).toThrow(/--force 는 --max-apts=<N> 과 함께만/);
  });
  it("--force --max-apts=100 → force · 상한 100", () => {
    expect(resolveMaxApts(["node", "x.mjs", "--force", "--max-apts=100"])).toEqual({ force: true, maxApts: 100 });
  });
  it("인자 없음 → 기본 상한 800 · force 아님", () => {
    expect(resolveMaxApts(["node", "x.mjs"])).toEqual({ force: false, maxApts: DEFAULT_MAX_APTS });
  });
  it("--max-apts=300 → 300", () => {
    expect(resolveMaxApts(["node", "x.mjs", "--dry-run", "--max-apts=300"])).toEqual({ force: false, maxApts: 300 });
  });
});
