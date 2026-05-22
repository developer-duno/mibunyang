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

const {
  checkFailedRuns, checkEmptyRuns, checkStaleWorkflows, buildStaleCheckList,
  checkNullSurge, checkCategoryNullSurge, AUDIT_CATEGORY_BASELINE, EXCLUDED_AUDIT_CATEGORIES,
  QUARTERLY_CRON_WORKFLOWS,
} = await import("./monitor-collectors.mjs");
const { AUDIT_FIELDS } = await import("./collectors/data-audit.mjs");

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

  it("allowedNames 주면 목록에 없는 워크플로(CI 등)는 실패해도 무시", () => {
    const issues = checkFailedRuns(
      [
        { name: "CI", status: "completed", conclusion: "failure" },
        { name: "Air Quality Collection", status: "completed", conclusion: "failure" },
      ],
      ["Air Quality Collection"],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toBe("Air Quality Collection");
  });

  it("allowedNames 미지정 시 전체 점검 (하위호환)", () => {
    const issues = checkFailedRuns([
      { name: "CI", status: "completed", conclusion: "failure" },
    ]);
    expect(issues).toHaveLength(1);
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

  it("직전 정상 실행 맵이 있으면 비교 문장을 lines 에 넣는다", () => {
    const issues = checkEmptyRuns(
      [{ collector: "molit-units", status: "success", ok_count: 0, skip_count: 0, fail_count: 0 }],
      { "molit-units": { okCount: 1263, finishedAt: "2026-05-13T08:21:00Z" } },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].lines?.join("\n")).toMatch(/1263건을 처리했는데/);
    expect(issues[0].at).toBeUndefined(); // finished_at 미지정 → undefined
  });

  it("직전 정상 실행 맵이 없어도 이번 실행 요약 문장은 lines 에 들어간다", () => {
    const issues = checkEmptyRuns([
      { collector: "A", status: "success", ok_count: 0, skip_count: 0, fail_count: 2 },
    ]);
    expect(issues[0].lines?.[0]).toMatch(/처리 건수가 0건/);
    expect(issues[0].detail).toMatch(/fail 2/);
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

  it("최근 run 에 흔적이 없어도 lastRunAt=null 이면 stale 로 잡힌다 — 데드존 회귀", () => {
    // 월간 cron 워크플로가 오래 죽어 최근 run 목록에서 사라진 상황을 재현.
    const issues = checkStaleWorkflows(
      [{ name: "Migration Data Collection", lastRunAt: null }],
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].detail).toMatch(/한 번도 없음/);
  });

  it("lastRunAt=null 이어도 워크플로 생성이 35일 이내면 미발화 아님 (첫 cron 대기)", () => {
    const issues = checkStaleWorkflows(
      [
        // 5/13 생성 — now(5/17) 기준 4일 전, 첫 cron 아직. 미발화 아님.
        { name: "KOSIS Jeonse Price Index Collection", lastRunAt: null, createdAt: "2026-05-13T00:00:00Z" },
      ],
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("lastRunAt=null 이고 생성도 35일 초과면 미발화 (진짜 죽은 워크플로)", () => {
    const issues = checkStaleWorkflows(
      [{ name: "Migration Data Collection", lastRunAt: null, createdAt: "2026-01-01T00:00:00Z" }],
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/한 번도 없음/);
  });

  it("배열에 일간·월간이 섞여도 오래된 것만 골라낸다", () => {
    const issues = checkStaleWorkflows(
      [
        { name: "Naver Post-Processing (Core)", lastRunAt: "2026-05-16T00:00:00Z" }, // 1일 전 — 정상
        { name: "Migration Data Collection", lastRunAt: "2026-03-01T00:00:00Z" }, // 77일 전 — stale
        { name: "Collect Maintenance Cost", lastRunAt: null }, // 기록 없음 — stale
      ],
      now,
    );
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.collector).sort()).toEqual([
      "Collect Maintenance Cost",
      "Migration Data Collection",
    ]);
  });

  // 분기 cron 워크플로 — 91 일 간격 (1/4/7/10월 발화) false positive 차단 (세션 292).
  it("분기 cron 워크플로는 80일 전이어도 정상 (35일 초과해도 미발화 아님)", () => {
    const issues = checkStaleWorkflows(
      [{ name: "DART 시공사 재무 수집", lastRunAt: "2026-02-27T00:00:00Z" }], // 79일 전 — 분기 cron 임계 100일 안
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("분기 cron 워크플로도 100일 초과면 stale (진짜 죽음)", () => {
    const issues = checkStaleWorkflows(
      [{ name: "DART 시공사 재무 수집", lastRunAt: "2026-02-01T00:00:00Z" }], // 105일 전 — 임계 초과
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].detail).toMatch(/분기 cron/);
  });
});

describe("buildStaleCheckList — ③ 점검 대상 + run 시각 병합", () => {
  it("monitor.yml 배열 전체를 대상으로 하되 recentRuns 의 시각을 우선 쓴다", () => {
    const wfList = buildStaleCheckList(
      ["A", "B", "C"],
      [{ name: "A", created_at: "2026-05-16T00:00:00Z" }],
      { B: "2026-04-01T00:00:00Z" },
      { A: "2026-01-01T00:00:00Z", B: "2026-01-01T00:00:00Z", C: "2026-01-01T00:00:00Z" },
    );
    expect(wfList).toEqual([
      { name: "A", lastRunAt: "2026-05-16T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { name: "B", lastRunAt: "2026-04-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { name: "C", lastRunAt: null, createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("createdAtByWf 미지정 시 createdAt 은 null (하위호환)", () => {
    const wfList = buildStaleCheckList(["A"], [], {});
    expect(wfList).toEqual([{ name: "A", lastRunAt: null, createdAt: null }]);
  });

  it("recentRuns 에 같은 워크플로가 여러 건이면 최신(첫 등장)만 쓴다", () => {
    const wfList = buildStaleCheckList(
      ["A"],
      [
        { name: "A", created_at: "2026-05-16T00:00:00Z" }, // 첫 등장 = 최신
        { name: "A", created_at: "2026-05-10T00:00:00Z" },
      ],
      {},
    );
    expect(wfList).toEqual([{ name: "A", lastRunAt: "2026-05-16T00:00:00Z", createdAt: null }]);
  });
});

describe("checkNullSurge — ④ NULL 급증", () => {
  it("NULL 비율이 40% 초과면 이상", () => {
    const issues = checkNullSurge([
      { column: "net_migration", total: 100, filled: 50 }, // NULL 50%
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("nulls");
    expect(issues[0].collector).toBe("순이동인구 (regions.net_migration)");
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
    expect(issues[0].collector).toBe("기본정보 (applyhome)");
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

  it("fields 가 있으면 필드별 채움률을 낮은 순으로 lines 에 펼친다", () => {
    const issues = checkCategoryNullSurge(
      { core: { collector: "applyhome", filled: 1000, total: 2000, rate: 50 } },
      baseline,
      {
        "core.name": { category: "core", field: "name", filled: 1000, missing: 0 },
        "core.completion": { category: "core", field: "completion", filled: 100, missing: 900 },
        "other.x": { category: "other", field: "x", filled: 0, missing: 1000 },
      },
    );
    expect(issues).toHaveLength(1);
    const body = issues[0].lines?.join("\n") ?? "";
    expect(body).toMatch(/2개 세부 데이터/); // core 필드만 — other 제외
    // 필드명은 한글 라벨로 — completion→준공연도, name→단지명
    expect(body).toContain("준공연도");
    expect(body).toContain("단지명");
    // 준공연도(10%)가 단지명(100%)보다 먼저 = 낮은 순 정렬
    expect(body.indexOf("준공연도")).toBeLessThan(body.indexOf("단지명"));
  });

  it("fields 가 없으면 lines 는 빈 배열 — 하위호환", () => {
    const issues = checkCategoryNullSurge(
      { core: { collector: "applyhome", filled: 1000, total: 2000, rate: 50 } },
      baseline,
    );
    expect(issues[0].lines).toEqual([]);
  });

  it("라벨 없는 카테고리·필드는 영어 키를 그대로 쓴다 — 누락 안전", () => {
    const issues = checkCategoryNullSurge(
      { unknownCat: { collector: "x", filled: 1, total: 100, rate: 1 } },
      { unknownCat: 70 },
      { "unknownCat.weirdField": { category: "unknownCat", field: "weirdField", filled: 1, missing: 99 } },
    );
    expect(issues[0].collector).toBe("unknownCat (x)");
    expect(issues[0].lines?.join("\n")).toContain("weirdField");
  });

  it("필드가 7개 이상이면 lines 의 필드 줄은 6개로 절단된다", () => {
    /** @type {Record<string, { category: string, field: string, filled: number, missing: number }>} */
    const fields = {};
    for (let i = 0; i < 8; i++) {
      fields[`core.f${i}`] = { category: "core", field: `f${i}`, filled: i * 100, missing: 800 };
    }
    const issues = checkCategoryNullSurge(
      { core: { collector: "applyhome", filled: 1000, total: 2000, rate: 50 } },
      baseline,
      fields,
    );
    // lines[0] = 머리말, 이후가 필드 줄. 8개 입력 → 6개로 절단
    const fieldLines = (issues[0].lines ?? []).filter((l) => l.startsWith("  · "));
    expect(fieldLines).toHaveLength(6);
  });
});

describe("AUDIT_CATEGORY_BASELINE 키 정합성 — data-audit 카테고리 drift 차단", () => {
  it("점검 12 + 제외 7 = data-audit AUDIT_FIELDS 19 카테고리와 정확히 일치", () => {
    const checked = Object.keys(AUDIT_CATEGORY_BASELINE);
    const monitored = new Set([...checked, ...EXCLUDED_AUDIT_CATEGORIES]);
    const auditCats = new Set(Object.keys(AUDIT_FIELDS));
    // 양방향 — monitor 가 모르는 카테고리도, 사라진 카테고리도 빨강
    expect([...monitored].sort()).toEqual([...auditCats].sort());
  });

  it("점검 키와 제외 키는 서로 겹치지 않는다", () => {
    const checked = new Set(Object.keys(AUDIT_CATEGORY_BASELINE));
    const overlap = EXCLUDED_AUDIT_CATEGORIES.filter((c) => checked.has(c));
    expect(overlap).toEqual([]);
  });
});
