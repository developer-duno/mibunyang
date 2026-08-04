// @ts-check
/**
 * infra-kakao.mjs 테스트 — 세마포어 동시성 제어 검증
 *
 * 대상: createSemaphore
 */
import { describe, it, expect, vi } from "vitest";

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

const { createSemaphore, buildFreshIds, FRESH_DAYS, REQUIRED_KEYS } = await import("./infra-kakao.mjs");

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
