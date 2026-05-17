// @ts-check
/**
 * monitor-collectors.mjs 순수 점검 함수 테스트
 * 대상: checkFailedRuns, checkEmptyRuns, checkStaleWorkflows, checkNullSurge
 */
import { describe, it, expect, vi } from "vitest";

// 모듈 초기화 부수효과 차단 (loadEnv / Supabase)
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { checkFailedRuns, checkEmptyRuns, checkStaleWorkflows, checkNullSurge, checkCategoryNullSurge } =
  await import("./monitor-collectors.mjs");

describe("checkFailedRuns — ① 실패/취소", () => {
  it("conclusion 이 failure/cancelled/timed_out 이면 이상", () => {
    const issues = checkFailedRuns([
      { name: "A", status: "completed", conclusion: "failure", html_url: "u1" },
      { name: "B", status: "completed", conclusion: "cancelled", html_url: "u2" },
      { name: "C", status: "completed", conclusion: "timed_out", html_url: "u3" },
    ]);
    expect(issues).toHaveLength(3);
    expect(issues[0].kind).toBe("fail");
    expect(issues[0].collector).toBe("A");
    expect(issues[0].url).toBe("u1");
  });

  it("success 는 이상 아님", () => {
    const issues = checkFailedRuns([
      { name: "A", status: "completed", conclusion: "success" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("아직 안 끝난 run(status!=completed)은 무시", () => {
    const issues = checkFailedRuns([
      { name: "A", status: "in_progress", conclusion: null },
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("checkEmptyRuns — ② 데이터 0건", () => {
  it("success 인데 ok·skip 모두 0 이면 이상", () => {
    const issues = checkEmptyRuns([
      { collector: "molit-units", status: "success", ok_count: 0, skip_count: 0 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("empty");
    expect(issues[0].collector).toBe("molit-units");
  });

  it("ok 또는 skip 이 1건이라도 있으면 정상", () => {
    const issues = checkEmptyRuns([
      { collector: "A", status: "success", ok_count: 5, skip_count: 0 },
      { collector: "B", status: "success", ok_count: 0, skip_count: 3 },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("status 가 success 아니면 0건 점검 대상 아님 (실패는 ①이 잡음)", () => {
    const issues = checkEmptyRuns([
      { collector: "A", status: "failure", ok_count: 0, skip_count: 0 },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("ok_count/skip_count 가 null 이면 0 으로 간주", () => {
    const issues = checkEmptyRuns([
      { collector: "A", status: "success", ok_count: null, skip_count: null },
    ]);
    expect(issues).toHaveLength(1);
  });
});

describe("checkStaleWorkflows — ③ 미발화", () => {
  const now = new Date("2026-05-17T00:00:00Z");

  it("마지막 run 이 35일 초과면 이상", () => {
    const issues = checkStaleWorkflows(
      [{ name: "collect-noxious", lastRunAt: "2026-03-01T00:00:00Z" }], // 77일 전
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].detail).toMatch(/일 전/);
  });

  it("35일 이내면 정상", () => {
    const issues = checkStaleWorkflows(
      [{ name: "A", lastRunAt: "2026-05-01T00:00:00Z" }], // 16일 전
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("실행 기록이 한 번도 없으면 이상", () => {
    const issues = checkStaleWorkflows([{ name: "A", lastRunAt: null }], now);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/한 번도 없음/);
  });
});

describe("checkNullSurge — ④ NULL 급증", () => {
  it("NULL 비율이 40% 초과면 이상", () => {
    const issues = checkNullSurge([
      { column: "net_migration", total: 100, filled: 50 }, // NULL 50%
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("nulls");
    expect(issues[0].collector).toBe("regions.net_migration");
    expect(issues[0].detail).toMatch(/50%/);
  });

  it("NULL 비율이 40% 이하면 정상", () => {
    const issues = checkNullSurge([
      { column: "crime_grade", total: 100, filled: 70 }, // NULL 30%
    ]);
    expect(issues).toHaveLength(0);
  });

  it("total 0 이면 나눗셈 회피 — 이상 아님", () => {
    const issues = checkNullSurge([{ column: "x", total: 0, filled: 0 }]);
    expect(issues).toHaveLength(0);
  });
});

describe("checkCategoryNullSurge — ④ 카테고리 NULL 급증", () => {
  const baseline = { core: 70, infra: 70 };

  it("rate 가 기대 최저값 미만이면 이상", () => {
    const issues = checkCategoryNullSurge(
      { core: { collector: "applyhome", filled: 1000, total: 2000, rate: 50 } },
      baseline,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("nulls");
    expect(issues[0].collector).toBe("core 카테고리 (applyhome)");
    expect(issues[0].detail).toMatch(/50%/);
    expect(issues[0].detail).toMatch(/70%/);
  });

  it("rate 가 기대 최저값 이상이면 정상", () => {
    const issues = checkCategoryNullSurge(
      { infra: { collector: "infra-kakao", filled: 1800, total: 2000, rate: 90 } },
      baseline,
    );
    expect(issues).toHaveLength(0);
  });

  it("baseline 에 없는 카테고리는 무시 — 이상 아님", () => {
    const issues = checkCategoryNullSurge(
      { benefits: { collector: "applyhome", filled: 0, total: 2000, rate: 0 } },
      baseline,
    );
    expect(issues).toHaveLength(0);
  });

  it("total 0 이면 무시 — 이상 아님", () => {
    const issues = checkCategoryNullSurge(
      { core: { collector: "applyhome", filled: 0, total: 0, rate: 0 } },
      baseline,
    );
    expect(issues).toHaveLength(0);
  });
});
