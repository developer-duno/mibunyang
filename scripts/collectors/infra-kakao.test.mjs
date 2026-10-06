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

  it("meta 가 없는 응답은 documents 길이로 폴백한다 (계약 유지)", async () => {
    mockRes(undefined, 3);
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

/** 모든 필수 컬럼이 채워진 완결 행 */
function makeCompleteRow(overrides = {}) {
  /** @type {Record<string, unknown>} */
  const row = { apartment_id: "ap-1", updated_at: daysAgo(1) };
  for (const k of REQUIRED_KEYS) row[k] = 1;
  return { ...row, ...overrides };
}

describe("buildFreshIds — 완결 + 신선 둘 다 만족해야 건너뜀", () => {
  it("완결 + 최근(1일 전) → 건너뜀", () => {
    expect(buildFreshIds([makeCompleteRow()], NOW).has("ap-1")).toBe(true);
  });

  it("완결이지만 오래됨(31일 전) → 재수집 (건너뛰지 않음)", () => {
    const rows = [makeCompleteRow({ updated_at: daysAgo(31) })];
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

  it("updated_at 없음 / 파싱 불가 → 재수집", () => {
    expect(buildFreshIds([makeCompleteRow({ updated_at: null })], NOW).size).toBe(0);
    expect(buildFreshIds([makeCompleteRow({ updated_at: "not-a-date" })], NOW).size).toBe(0);
  });

  it("경계: 정확히 FRESH_DAYS 직전은 건너뜀, 직후는 재수집", () => {
    const justInside = [makeCompleteRow({ updated_at: daysAgo(FRESH_DAYS - 0.01) })];
    const justOutside = [makeCompleteRow({ updated_at: daysAgo(FRESH_DAYS + 0.01) })];
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
      makeCompleteRow({ apartment_id: "ap-old", updated_at: daysAgo(90) }),
      makeCompleteRow({ apartment_id: "ap-partial", mart: null }),
    ];
    const fresh = buildFreshIds(rows, NOW);
    expect([...fresh]).toEqual(["ap-fresh"]);
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
