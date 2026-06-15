// @ts-check
/**
 * monitor-collectors.mjs 순수 점검 함수 테스트
 * 대상: checkFailedRuns, checkEmptyRuns, checkStaleWorkflows, checkNullSurge, checkExternalApiStale
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
  QUARTERLY_CRON_WORKFLOWS, checkExternalApiStale, EXTERNAL_API_COLLECTORS,
  checkViewRegionStale, VIEW_REGION_STALE_TARGETS,
  dedupKey, filterUnsent,
} = await import("./monitor-collectors.mjs");
const { AUDIT_FIELDS } = await import("./collectors/data-audit.mjs");

describe("checkFailedRuns — ① 실패/취소", () => {
  it("conclusion 이 failure/cancelled/timed_out 이면 이상 + 각각 conclusion 필드 박힘", () => {
    const issues = checkFailedRuns([
      { name: "A", status: "completed", conclusion: "failure", html_url: "u1" },
      { name: "B", status: "completed", conclusion: "cancelled", html_url: "u2" },
      { name: "C", status: "completed", conclusion: "timed_out", html_url: "u3" },
    ]);
    expect(issues).toHaveLength(3);
    for (const issue of issues) {
      expect(issue.kind).toBe("fail");
    }
    expect(issues[0].conclusion).toBe("failure");
    expect(issues[1].conclusion).toBe("cancelled");
    expect(issues[2].conclusion).toBe("timed_out");
    expect(issues[0].detail).toContain("실패 상태로");
    expect(issues[1].detail).toContain("취소 상태로");
    expect(issues[2].detail).toContain("시간 초과 상태로");
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

  it("신선도 가드: maxAgeHours 초과한 옛 0건 행은 제외 (run 모드 스팸 차단)", () => {
    const now = new Date("2026-06-03T12:00:00Z");
    const issues = checkEmptyRuns(
      [{ collector: "housing-permits", status: "success", ok_count: 0, skip_count: 0, finished_at: "2026-05-26T18:46:08Z" }],
      {},
      { maxAgeHours: 36, now },
    );
    expect(issues).toHaveLength(0); // 8일 전 행 → 제외
  });

  it("신선도 가드: maxAgeHours 이내 0건 행은 정상 점검", () => {
    const now = new Date("2026-06-03T12:00:00Z");
    const issues = checkEmptyRuns(
      [{ collector: "A", status: "success", ok_count: 0, skip_count: 0, finished_at: "2026-06-03T06:00:00Z" }],
      {},
      { maxAgeHours: 36, now },
    );
    expect(issues).toHaveLength(1); // 6시간 전 → 점검
  });

  it("신선도 가드 미지정(daily 하위호환): 옛 행도 점검 (나이 무관)", () => {
    const issues = checkEmptyRuns([
      { collector: "housing-permits", status: "success", ok_count: 0, skip_count: 0, finished_at: "2020-01-01T00:00:00Z" },
    ]);
    expect(issues).toHaveLength(1);
  });
});

describe("dedupKey / filterUnsent — 알림 dedup (텔레그램 스팸 차단)", () => {
  /** @type {any} */
  const empty526 = { kind: "empty", collector: "housing-permits", at: "2026-05-26T18:46:08Z" };
  /** @type {any} */
  const empty527 = { kind: "empty", collector: "housing-permits", at: "2026-05-27T18:46:08Z" };
  /** @type {any} */
  const nullsNoAt = { kind: "nulls", collector: "regions.net_migration" };

  it("dedupKey = kind|collector|at 안정 키", () => {
    expect(dedupKey(empty526)).toBe("empty|housing-permits|2026-05-26T18:46:08Z");
  });

  it("같은 stale 행(at 불변) = 같은 키 → 재발송 1건만", () => {
    expect(dedupKey(empty526)).toBe(dedupKey({ ...empty526 }));
  });

  it("새 run(at 변경)이 다시 0건 = 새 키 → 재알림 대상", () => {
    expect(dedupKey(empty526)).not.toBe(dedupKey(empty527));
  });

  it("at 없는 이슈 = kind|collector| 만으로 키", () => {
    expect(dedupKey(nullsNoAt)).toBe("nulls|regions.net_migration|");
  });

  it("filterUnsent: 이미 보낸 키 제외, 새 이슈만 반환", () => {
    const sent = new Set([dedupKey(empty526)]);
    const fresh = filterUnsent([empty526, empty527], sent);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].at).toBe("2026-05-27T18:46:08Z");
  });

  it("filterUnsent: 전부 이미 보냈으면 빈 배열", () => {
    const sent = new Set([dedupKey(empty526), dedupKey(empty527)]);
    expect(filterUnsent([empty526, empty527], sent)).toHaveLength(0);
  });

  it("filterUnsent: 보낸 키 없으면 전부 통과", () => {
    expect(filterUnsent([empty526, empty527], new Set())).toHaveLength(2);
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

  it("lastRunAt 이 미래여도(시계 오차) 음수 ageDays 없이 정상 처리 — 음수 가드", () => {
    // 미래 시각 → 옛 코드는 ageDays<0 으로 비교가 깨질 수 있음. Math.max(0,...) 가드로 stale 아님 안정.
    const issues = checkStaleWorkflows(
      [{ name: "A", lastRunAt: "2026-06-01T00:00:00Z" }], // now(05-17) 보다 미래
      now,
    );
    expect(issues).toHaveLength(0); // ageDays=0 → 35일 이내 → 미발화 아님
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

describe("checkExternalApiStale — ⑤ 외부 API 장기 중단", () => {
  const now = new Date("2026-05-28T00:00:00Z");
  /** @type {Array<{ collector: string, stale_days: number, owner: string }>} */
  const targets = [{ collector: "housing-permits", stale_days: 14, owner: "MOLIT" }];

  it("장기 중단 — 최근 3회 모두 success+ok=0 이고 첫 시각이 stale_days 초과면 이상 박힘", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, finished_at: "2026-05-26T00:00:00Z" },
          { status: "success", ok_count: 0, finished_at: "2026-04-25T00:00:00Z" },
          { status: "success", ok_count: 0, finished_at: "2026-04-10T00:00:00Z" }, // 48일 전
        ],
      },
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("outage");
    expect(issues[0].collector).toBe("housing-permits");
    expect(issues[0].detail).toMatch(/MOLIT/);
    expect(issues[0].detail).toMatch(/48일\+/);
  });

  it("정상 — 최근 3회 중 1회라도 ok>0 이면 이상 아님 (자연 회복)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, finished_at: "2026-05-27T00:00:00Z" },
          { status: "success", ok_count: 42, finished_at: "2026-04-10T00:00:00Z" }, // 회복
          { status: "success", ok_count: 0, finished_at: "2026-03-10T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("회복 직후 — 최근 1회 ok>0 이면 즉시 정상 (단발 회복 인정)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 17, finished_at: "2026-05-28T00:00:00Z" }, // 회복
          { status: "success", ok_count: 0, finished_at: "2026-04-28T00:00:00Z" },
          { status: "success", ok_count: 0, finished_at: "2026-03-28T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("신규 collector — 행 수 < 3 이면 점검 skip (오탐 차단)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, finished_at: "2026-05-27T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("미발화 — 최신 행이 stale_days 초과면 kind=stale 박힘 (로컬 러너 '안 돌면 알림', 세션 289)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 42, finished_at: "2026-05-10T00:00:00Z" }, // 18일 전 > 14
          { status: "success", ok_count: 10, finished_at: "2026-04-10T00:00:00Z" },
          { status: "success", ok_count: 7, finished_at: "2026-03-10T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].detail).toMatch(/미발화/);
    expect(issues[0].detail).toMatch(/18일/);
  });

  it("미발화 + ok=0 동시 — stale 1건만 박힘 (outage 이중 알림 차단)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, finished_at: "2026-05-01T00:00:00Z" }, // 27일 전
          { status: "success", ok_count: 0, finished_at: "2026-04-01T00:00:00Z" },
          { status: "success", ok_count: 0, finished_at: "2026-03-01T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
  });

  it("연간 데이터 무변경 — ok=0 이라도 skip>0 이면 outage 아님 (fertility 등 diff-only 수집기 평상시, 세션 289)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, skip_count: 250, finished_at: "2026-05-26T00:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 250, finished_at: "2026-04-25T00:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 251, finished_at: "2026-04-10T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("EXTERNAL_API_COLLECTORS 배열 = 18 후보 박힘 (기존 5 + KOSIS 로컬 10, 세션 289 + childcare 로컬 3, 세션 399)", () => {
    const names = EXTERNAL_API_COLLECTORS.map((c) => c.collector).sort();
    expect(names).toEqual([
      "applyhome-detail", "avg-income", "building-hub",
      "childcare-detail", "childcare-info", "childcare-info-jeju",
      "housing-permits",
      "kosis-fertility-rate", "kosis-housing-supply-ratio", "kosis-jeonse-price-index",
      "kosis-medical-access", "kosis-regional-economy", "kosis-sale-price-index",
      "kosis-unsold", "market-stats", "migration", "schools", "transport",
    ]);
    for (const c of EXTERNAL_API_COLLECTORS) {
      expect(c.stale_days).toBeGreaterThan(0);
      expect(c.owner).toBeTruthy();
    }
  });
});

describe("checkViewRegionStale — ⑥ VIEW 회귀 (regions 원본 채움 but VIEW NULL)", () => {
  const targets = [{ viewKey: "regions.netMigration", regionColumn: "net_migration", label: "순이동 (migration)" }];

  it("회귀 박힘 — 원본 ≥20% 채움인데 VIEW ≤5% (세션 391 패턴: 원본 700/1043 vs VIEW 0/1424)", () => {
    const issues = checkViewRegionStale(
      { "regions.netMigration": { filled: 0, missing: 1424 } },
      [{ column: "net_migration", total: 1043, filled: 700 }],
      targets,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("nulls");
    expect(issues[0].detail).toMatch(/순이동/);
    expect(issues[0].detail).toMatch(/회귀 의심/);
  });

  it("정상 — VIEW 도 채워졌으면 이상 아님 (핫픽스/B안 적용 후 17/17)", () => {
    const issues = checkViewRegionStale(
      { "regions.netMigration": { filled: 1424, missing: 0 } },
      [{ column: "net_migration", total: 1043, filled: 700 }],
      targets,
    );
    expect(issues).toHaveLength(0);
  });

  it("원본부터 0 — supply_ratio 식 원본 부재는 회귀 아님 (regionRate < 20% 면 skip)", () => {
    const issues = checkViewRegionStale(
      { "regions.netMigration": { filled: 0, missing: 1424 } },
      [{ column: "net_migration", total: 1043, filled: 0 }], // 원본도 0
      targets,
    );
    expect(issues).toHaveLength(0);
  });

  it("부분 채움 — VIEW 가 5% 초과면 회귀 아님 (경계)", () => {
    const issues = checkViewRegionStale(
      { "regions.netMigration": { filled: 100, missing: 1324 } }, // 7.0%
      [{ column: "net_migration", total: 1043, filled: 700 }],
      targets,
    );
    expect(issues).toHaveLength(0);
  });

  it("분모 0 / 키 부재 — 조용히 skip (점검 자체를 막지 않음)", () => {
    expect(checkViewRegionStale({}, [], targets)).toHaveLength(0);
    expect(checkViewRegionStale(
      { "regions.netMigration": { filled: 0, missing: 0 } },
      [{ column: "net_migration", total: 0, filled: 0 }],
      targets,
    )).toHaveLength(0);
  });

  it("VIEW_REGION_STALE_TARGETS 정합 — net_migration 등재 + regionColumn 이 REGION_KEY_COLUMNS 후보", () => {
    expect(VIEW_REGION_STALE_TARGETS.length).toBeGreaterThanOrEqual(1);
    const nm = VIEW_REGION_STALE_TARGETS.find((t) => t.regionColumn === "net_migration");
    expect(nm).toBeTruthy();
    expect(nm?.viewKey).toBe("regions.netMigration");
  });
});
