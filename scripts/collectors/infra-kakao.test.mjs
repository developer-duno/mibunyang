// @ts-check
/**
 * infra-kakao.mjs 테스트 — 세마포어 동시성 제어 검증
 *
 * 대상: createSemaphore
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
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

const { createSemaphore } = await import("./infra-kakao.mjs");

// ── createSemaphore ───────────────────────────────────────────
describe("createSemaphore", () => {
  it("동시 1개 제한 — 순차 실행", async () => {
    const sem = createSemaphore(1);
    const order = [];

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
    const order = [];

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
    const results = [];

    await Promise.all([
      sem(async () => { results.push(1); }),
      sem(async () => { results.push(2); }),
      sem(async () => { results.push(3); }),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });
});
