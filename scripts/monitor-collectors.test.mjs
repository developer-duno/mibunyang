// @ts-check
/**
 * monitor-collectors.mjs 순수 점검 함수 테스트
 * 대상: checkFailedRuns, checkEmptyRuns, checkStaleWorkflows, checkNullSurge, checkExternalApiStale
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 모듈 초기화 부수효과 차단 (loadEnv / Supabase)
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const {
  checkFailedRuns, checkEmptyRuns, checkStaleWorkflows, buildStaleCheckList,
  checkNullSurge, checkCategoryNullSurge, AUDIT_CATEGORY_BASELINE, EXCLUDED_AUDIT_CATEGORIES,
  QUARTERLY_CRON_WORKFLOWS, SCHEDULELESS_WORKFLOWS, checkExternalApiStale, EXTERNAL_API_COLLECTORS,
  checkViewRegionStale, VIEW_REGION_STALE_TARGETS, REGION_KEY_COLUMNS,
  dedupKey, filterUnsent, hasGithubApiAuth,
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

  it("외부 API 수집기는 ②에서 제외 — 0건이 정상, ⑤가 단독 판정 (중복 노이즈 차단, 세션 444)", () => {
    const external = new Set(["housing-permits", "kosis-fertility-rate"]);
    const issues = checkEmptyRuns(
      [
        { collector: "housing-permits", status: "success", ok_count: 0, skip_count: 0 },
        { collector: "kosis-fertility-rate", status: "success", ok_count: 0, skip_count: 0 },
      ],
      {},
      { externalApiCollectors: external },
    );
    expect(issues).toHaveLength(0); // 둘 다 외부 API → ②에서 제외
  });

  it("외부 API 집합에 없는 일반 수집기 0건은 ②가 그대로 점검 (진짜 신호 보존)", () => {
    const external = new Set(["housing-permits"]);
    const issues = checkEmptyRuns(
      [
        { collector: "housing-permits", status: "success", ok_count: 0, skip_count: 0 }, // 제외
        { collector: "molit-units", status: "success", ok_count: 0, skip_count: 0 },     // 점검
      ],
      {},
      { externalApiCollectors: external },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toBe("molit-units");
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

describe("hasGithubApiAuth — 로컬 실행 시 ①③ skip 가드 (가짜 미발화 알림 차단, 세션 444)", () => {
  const orig = { repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN };
  afterEach(() => {
    if (orig.repo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = orig.repo;
    if (orig.token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = orig.token;
  });

  it("GITHUB_REPOSITORY + GITHUB_TOKEN 둘 다 있으면 true (Actions 러너)", () => {
    process.env.GITHUB_REPOSITORY = "developer-duno/mibunyang";
    process.env.GITHUB_TOKEN = "ghs_x";
    expect(hasGithubApiAuth()).toBe(true);
  });

  it("둘 다 없으면 false (로컬 PC — ①③ 점검 skip → 미발화 오탐 차단)", () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
    expect(hasGithubApiAuth()).toBe(false);
  });

  it("repo 만 있고 token 없으면 false (부분 인증도 안전하게 skip)", () => {
    process.env.GITHUB_REPOSITORY = "developer-duno/mibunyang";
    delete process.env.GITHUB_TOKEN;
    expect(hasGithubApiAuth()).toBe(false);
  });
});

/**
 * 세션 491 적대검증 후속 — 주기를 바꾸면 **감시 기준도 함께** 바꿔야 한다.
 *
 * 세션 491 이 워크플로 주기를 바꾸면서 monitor 를 한 줄도 안 고쳐 두 사고가 예약돼 있었다:
 *   ① 분기로 내린 2건의 stale_days 가 38(월간) 그대로 → ⑤-b(미발화)가 먼저 걸려 `continue` 로
 *      ⑤-a(진짜 outage) 판정을 덮음. 2026-08-18 부터 MOLIT 장기중단 경보가 사라졌을 것.
 *   ② schedule 을 통째로 지운 4건이 ③ 점검 대상에 남아 35일 후 거짓 경보 →
 *      dedup 때문에 그 1회 이후 ③ 이 해당 워크플로에 영구 침묵.
 * 아래 테스트가 그 회귀를 막는다.
 */
describe("주기 변경 ↔ 감시 기준 동기화 (세션 491 적대검증)", () => {
  it("분기 cron 워크플로가 QUARTERLY_CRON_WORKFLOWS 에 등재돼 있다", () => {
    expect(QUARTERLY_CRON_WORKFLOWS).toContain("Collect Building Hub (에너지+인허가)");
    // 세션 501: "Housing Permits Data Collection" 은 **워크플로 자체가 삭제**됐다.
    // MOLIT ArchPmsService_v2 폐기 → KOSIS 이전인데 kosis.kr 이 해외 IP 를 막아 GH 에서 못 돈다.
    // 없는 워크플로가 여기 남으면 "분기라 오래 안 돈 것" 으로 오해되므로 등재돼 있으면 안 된다.
    expect(QUARTERLY_CRON_WORKFLOWS).not.toContain("Housing Permits Data Collection");
  });

  it("분기 collector 의 stale_days 는 100 이다 — 38 이면 진짜 outage 판정을 덮는다", () => {
    for (const name of ["building-hub"]) {
      const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === name);
      expect(entry, `${name} 가 EXTERNAL_API_COLLECTORS 에 없다`).toBeTruthy();
      expect(entry?.stale_days, `${name} stale_days 가 분기 기준(100)이 아니다`).toBe(100);
    }
  });

  // 세션 501 — 주기가 바뀌면 감시 기준도 같이 바뀌어야 한다(이 describe 의 취지 그대로).
  // housing-permits 는 분기 GH cron → 로컬 러너 매월 11일로 옮겼으므로 100 이 아니라 38 이다.
  // 100 을 그대로 뒀다면 한 달 넘게 안 돌아도 조용해서 진짜 중단을 놓친다.
  it("KOSIS 로 이전한 housing-permits 는 월간 기준(38)이다", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === "housing-permits");
    expect(entry, "housing-permits 가 EXTERNAL_API_COLLECTORS 에 없다").toBeTruthy();
    expect(entry?.stale_days, "월간(로컬 매월 11일) 기준 38 이어야 한다").toBe(38);
  });

  it("housing-permits 가 로컬 러너 매핑표에 실제로 등록돼 있다 — 감시만 있고 실행이 없으면 영구 stale", async () => {
    const { DAY_TABLE } = await import("./kosis-local-runner.mjs");
    const entry = DAY_TABLE.find((e) => e.script === "housing-permits.mjs");
    expect(entry, "kosis-local-runner DAY_TABLE 에 housing-permits.mjs 가 없다").toBeTruthy();
    expect(entry?.months, "매월 실행이어야 한다(months 제한 없음)").toBeUndefined();
  });

  // 실측 3행 — housing-permits 가 3회 연속 success + ok_count=0 인 상태(진짜 MOLIT 장기 중단).
  const outageRows = [
    { status: "success", ok_count: 0, finished_at: "2026-07-10T21:28:48Z" },
    { status: "success", ok_count: 0, finished_at: "2026-06-10T22:54:35Z" },
    { status: "success", ok_count: 0, finished_at: "2026-05-26T18:46:08Z" },
  ];
  /** @param {number} staleDays @param {string} nowIso */
  const runFive = (staleDays, nowIso) =>
    checkExternalApiStale(
      [{ collector: "housing-permits", stale_days: staleDays, owner: "t" }],
      { "housing-permits": outageRows },
      new Date(nowIso),
    ).map((i) => i.kind);

  it("stale_days 38 은 진짜 outage 를 '미발화'로 덮는다 (틀린 진단)", () => {
    // ⑤-b(미발화)가 먼저 걸리면 `continue` 로 ⑤-a(outage) 판정에 도달조차 못 한다.
    // 최신 행 2026-07-10 기준 +38일 = 8/17 → 그 이후로는 계속 stale 로만 보인다.
    expect(runFive(38, "2026-09-05T00:00:00Z")).toContain("stale");
    expect(runFive(38, "2026-09-05T00:00:00Z")).not.toContain("outage");
  });

  it("stale_days 100 은 같은 시점에 진짜 원인(outage)을 정확히 짚는다", () => {
    // 최신 행 57일 < 100 이라 ⑤-b 를 통과하고, 가장 오래된 행(2026-05-26)이 102일 > 100 이라 ⑤-a 발화.
    expect(runFive(100, "2026-09-05T00:00:00Z")).toContain("outage");
  });

  it("⚠️ 트레이드오프 기록 — 100 으로 올리면 8/18~9/2 구간은 '무경보'다", () => {
    // outage 는 **가장 오래된 행**이 stale_days 를 넘어야 발화한다.
    // 2026-05-26 + 100일 = 9/3 이므로 그 전에는 stale 도 outage 도 안 난다.
    // 38 일 때의 "틀린 stale 경보"보다는 낫지만, "즉시 경보가 돌아온다"는 뜻이 아니다.
    // 이 공백이 문제가 되면 별도 분기(연속 ok=0 을 stale_days 와 무관하게 잡는 경로)가 필요하다.
    expect(runFive(100, "2026-08-20T00:00:00Z")).toEqual([]);
  });

  it("예약 없는 워크플로 4건은 ③ 점검에서 제외된다 (미발화 개념 자체가 성립 안 함)", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    const wfs = SCHEDULELESS_WORKFLOWS.map((name) => ({ name, lastRunAt: "2026-08-02T00:00:00Z" }));
    expect(checkStaleWorkflows(wfs, now)).toEqual([]);
  });

  it("제외 목록에 없는 워크플로는 그대로 35일 임계로 잡는다 (제외가 과하지 않다)", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    const issues = checkStaleWorkflows([{ name: "아무 월간 수집", lastRunAt: "2026-08-02T00:00:00Z" }], now);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
  });

  it("SCHEDULELESS_WORKFLOWS 는 실제로 schedule 이 없는 yml 만 담는다 (드리프트 차단)", () => {
    const wfDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");
    /** @type {Record<string, string>} */
    const nameToFile = {};
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith(".yml"))) {
      const src = readFileSync(join(wfDir, f), "utf8");
      const m = src.match(/^name:\s*(.+)$/m);
      if (m) nameToFile[m[1].trim()] = src;
    }
    for (const name of SCHEDULELESS_WORKFLOWS) {
      const src = nameToFile[name];
      expect(src, `SCHEDULELESS_WORKFLOWS 의 "${name}" 에 해당하는 yml 이 없다`).toBeTruthy();
      // on: 블록에 schedule 이 살아 있으면(주석 아님) 이 목록에서 빼야 한다.
      const hasSchedule = /^\s{2}schedule:\s*$/m.test(src || "");
      expect(hasSchedule, `"${name}" 에 schedule 이 되살아났다 — SCHEDULELESS_WORKFLOWS 에서 뺄 것`).toBe(false);
    }
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

  it("maintenance 미발화 — cancelled run 은 collector_runs 행 0건 → 마지막 success(5/17) 가 stale_days(38) 초과 시 stale 박힘 (세션 447 사고 재현)", () => {
    // collect-maintenance.yml 5/26·6/15 cancelled = recordCollectorRun 전 SIGKILL → 행 0건.
    // 따라서 latest collector_runs 는 5/17 success 에 고정 → 6/27 기준 ~40일 > 38 → ⑤-b 발화.
    // ③ checkStaleWorkflows 는 cancelled 의 GH created_at 으로 "신선" 마스킹돼 못 잡음 = ⑤ 가 유일.
    const issues = checkExternalApiStale(
      [{ collector: "maintenance", stale_days: 38, owner: "국토부 공동주택 관리비 (월 15~19일 cron + 1주 여유)" }],
      {
        maintenance: [
          { status: "success", ok_count: 3, finished_at: "2026-05-17T07:15:52Z" }, // 41일 전 > 38
          { status: "success", ok_count: 5, finished_at: "2026-04-15T05:22:46Z" },
          { status: "success", ok_count: 8, finished_at: "2026-03-15T00:00:00Z" },
        ],
      },
      new Date("2026-06-27T00:00:00Z"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].collector).toBe("maintenance");
    expect(issues[0].detail).toMatch(/미발화/);
    expect(issues[0].detail).toMatch(/40일/);
  });

  it("notify-subscribers 미발화 — 주간 cron 이 14일+ 침묵하면 ⑤-b stale (발송기 안 돎 신호, 세션 467)", () => {
    const issues = checkExternalApiStale(
      [{ collector: "notify-subscribers", stale_days: 14, owner: "분양 알림 발송기 (주간 월 cron)" }],
      {
        "notify-subscribers": [
          { status: "success", ok_count: 0, skip_count: 984, finished_at: "2026-06-15T05:00:00Z" }, // 20일 전 > 14
          { status: "success", ok_count: 2, skip_count: 980, finished_at: "2026-06-08T05:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 975, finished_at: "2026-06-01T05:00:00Z" },
        ],
      },
      new Date("2026-07-05T00:00:00Z"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].collector).toBe("notify-subscribers");
  });

  it("notify-subscribers 대상 0건 주간 — ok=0 이라도 skip(일정 스캔 행 수)>0 이면 ⑤-a 빈성공 아님 (세션 467 skip 설계)", () => {
    const issues = checkExternalApiStale(
      [{ collector: "notify-subscribers", stale_days: 14, owner: "분양 알림 발송기 (주간 월 cron)" }],
      {
        "notify-subscribers": [
          { status: "success", ok_count: 0, skip_count: 984, finished_at: "2026-06-29T05:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 984, finished_at: "2026-06-22T05:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 984, finished_at: "2026-06-15T05:00:00Z" },
        ],
      },
      new Date("2026-07-03T00:00:00Z"),
    );
    expect(issues).toHaveLength(0);
  });

  it("naver-collect 가 감시 목록에 등재돼 있다 — 1단계만 죽는 유형이 한 달 잠복했던 구멍 (세션 495)", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === "naver-collect");
    expect(entry, "naver-collect 미등재 — 스케줄러 정지·제한시간 초과를 아무도 못 본다").toBeTruthy();
    // 월/목 발화라 정상 최대 간격 4일. 주 2회 자매(naver-presale)와 같은 14 여야 한다.
    expect(entry?.stale_days).toBe(14);
  });

  it("naver-collect 미발화 14일 초과 → ⑤-b stale 발화 / 정상 주기(4일)엔 침묵", () => {
    const rows = [
      { status: "partial", ok_count: 120, skip_count: 900, finished_at: "2026-07-06T23:00:00Z" },
      { status: "partial", ok_count: 130, skip_count: 880, finished_at: "2026-07-02T23:00:00Z" },
      { status: "success", ok_count: 140, skip_count: 870, finished_at: "2026-06-29T23:00:00Z" },
    ];
    /** @param {string} nowIso */
    const run = (nowIso) => checkExternalApiStale(
      [{ collector: "naver-collect", stale_days: 14, owner: "네이버 매물·시세 1단계" }],
      { "naver-collect": rows },
      new Date(nowIso),
    );
    // 정상 주기 — 4일 뒤엔 조용
    expect(run("2026-07-10T23:00:00Z")).toHaveLength(0);
    // 스케줄러 정지 — 15일 뒤 미발화 경보
    const late = run("2026-07-22T00:00:00Z");
    expect(late).toHaveLength(1);
    expect(late[0].kind).toBe("stale");
  });

  it("naver-collect 는 ⑤-a 빈성공 오탐이 구조적으로 안 난다 (시간예산 중단 = partial)", () => {
    // 예산에 잘리면 status=partial 이라 3연속 success 사슬이 끊긴다.
    const issues = checkExternalApiStale(
      [{ collector: "naver-collect", stale_days: 14, owner: "네이버 매물·시세 1단계" }],
      {
        "naver-collect": [
          { status: "partial", ok_count: 0, skip_count: 0, finished_at: "2026-07-06T23:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 0, finished_at: "2026-07-02T23:00:00Z" },
          { status: "success", ok_count: 0, skip_count: 0, finished_at: "2026-06-29T23:00:00Z" },
        ],
      },
      new Date("2026-07-09T23:00:00Z"),
    );
    expect(issues).toHaveLength(0);
  });

  it("EXTERNAL_API_COLLECTORS 배열 = 25 후보 박힘 (기존 5 + KOSIS 로컬 10, 세션 289 + childcare 로컬 3, 세션 399 + maintenance, 세션 447 + applyhome-seed, 세션 466 + notify-subscribers, 세션 467 + naver-presale, 세션 470 + naver-collect, 세션 495 + applyhome-remndr, 세션 496 + housing-price, 세션 504)", () => {
    const names = EXTERNAL_API_COLLECTORS.map((c) => c.collector).sort();
    expect(names).toEqual([
      "applyhome-detail", "applyhome-remndr", "applyhome-seed", "avg-income", "building-hub",
      "childcare-detail", "childcare-info", "childcare-info-jeju",
      "housing-permits", "housing-price",
      "kosis-fertility-rate", "kosis-housing-supply-ratio", "kosis-jeonse-price-index",
      "kosis-medical-access", "kosis-regional-economy", "kosis-sale-price-index",
      "kosis-unsold", "maintenance", "market-stats", "migration",
      "naver-collect", "naver-presale", "notify-subscribers", "schools", "transport-tago",
    ]);
    for (const c of EXTERNAL_API_COLLECTORS) {
      expect(c.stale_days).toBeGreaterThan(0);
      expect(c.owner).toBeTruthy();
    }
  });
});

describe("EXTERNAL_API_COLLECTORS 라벨 ↔ recordCollectorRun 기록명 동기화 (드리프트 차단, 세션 439)", () => {
  // 각 collector .mjs 에서 recordCollectorRun 첫 인자 라벨을 정적 추출.
  // 두 형태 resolve: recordCollectorRun(PHASE) → const PHASE="..." 값 / recordCollectorRun("리터럴").
  // monitor EXTERNAL_API_COLLECTORS 의 collector 키는 이 기록명과 정확히 일치해야 ⑤ 점검이 매칭됨.
  // 세션 439 사고: transport-tago.mjs 가 "transport-tago" 를 기록하는데 배열은 "transport" 라
  // fetchExternalApiRuns(.eq("collector","transport")) 가 0행 → ⑤ 외부 API 침묵 탐지 영구 무력.
  function extractRecordedLabels() {
    const scriptsDir = dirname(fileURLToPath(import.meta.url));
    // collectors/ + scripts/ 최상위 — notify-subscribers.mjs 처럼 collectors/ 밖에 사는
    // recordCollectorRun 사용자(audit-env-keys·graceful 가드 밖 배치 관행)도 라벨 소스다 (세션 467).
    const dirs = [join(scriptsDir, "collectors"), scriptsDir];
    /** @type {Set<string>} */
    const labels = new Set();
    for (const dir of dirs) {
      for (const f of readdirSync(dir)) {
        if (f.includes(".test.")) continue;
        // 세션 495: 파이썬 수집기(naver-collect.py)도 같은 collector_runs 스키마에 직접 INSERT 한다.
        // .mjs 만 훑으면 그 라벨이 "어디에도 없는 이름" 으로 보여 이 가드가 오히려 정상을 막는다.
        if (f.endsWith(".py")) {
          const pySrc = readFileSync(join(dir, f), "utf8");
          // collector_runs 에 실제로 쓰는 파일만 — 아무 dict 의 "collector" 키를 주워
          // 가드를 헐겁게 만들지 않도록 좁힌다.
          if (!pySrc.includes("collector_runs")) continue;
          for (const m of pySrc.matchAll(/["']collector["']\s*:\s*["']([^"']+)["']/g)) labels.add(m[1]);
          continue;
        }
        if (!f.endsWith(".mjs")) continue;
        const src = readFileSync(join(dir, f), "utf8");
        const phaseM = src.match(/const\s+PHASE\s*=\s*["'`]([^"'`]+)["'`]/);
        const phase = phaseM ? phaseM[1] : null;
        for (const m of src.matchAll(/recordCollectorRun\(\s*([^,)]+)/g)) {
          const arg = m[1].trim();
          if (arg === "PHASE") {
            if (phase) labels.add(phase);
          } else {
            const lit = arg.match(/^["'`]([^"'`]+)["'`]$/);
            if (lit) labels.add(lit[1]);
          }
        }
      }
    }
    return labels;
  }

  it("파이썬 수집기의 collector_runs 라벨도 추출한다 (naver-collect.py, 세션 495)", () => {
    expect(extractRecordedLabels().has("naver-collect")).toBe(true);
  });

  it("각 collector 키가 실제 collector .mjs 의 recordCollectorRun 기록명에 존재한다", () => {
    const recorded = extractRecordedLabels();
    for (const { collector } of EXTERNAL_API_COLLECTORS) {
      expect(
        recorded.has(collector),
        `EXTERNAL_API '${collector}' 가 어떤 collector .mjs 의 recordCollectorRun 기록명에도 없음 — 라벨 드리프트 (monitor ⑤ 영구 무력)`,
      ).toBe(true);
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

  it("⑥ housing_supply_level 정상 회귀 가드 — granularity fix 후 regionRate 100% + L434 fix 후 viewRate 100% → 경보 없음", () => {
    // 세션 478: granularity fix 로 housing regionRate 가 10%(전체행)→100%(시도)로 바뀌어 ⑥ regionRate≥0.2 참.
    // 동시에 data-audit L434 fix 로 audit viewRate 가 0%→100% 라 viewRate≤0.05 거짓 → 경보 없음.
    // 둘 중 하나만 고치면 ⑥ 오탐이 나므로 이 케이스가 "두 fix 동반" 을 잠근다.
    const issues = checkViewRegionStale(
      { "regions.housingSupplyLevel": { filled: 2154, missing: 0 } }, // L434 fix 후 viewRate 100%
      [{ column: "housing_supply_level", total: 113, filled: 113 }], // granularity=sido fix 후 regionRate 100%
      [{ viewKey: "regions.housingSupplyLevel", regionColumn: "housing_supply_level", label: "주택보급률 (KOSIS)" }],
    );
    expect(issues).toHaveLength(0);
  });
});

describe("REGION_KEY_COLUMNS — ④ NULL 점검 대상 granularity 구조 (세션 478)", () => {
  it("각 항목이 column + granularity(sido|sigungu|all) 구조 · 5개", () => {
    expect(REGION_KEY_COLUMNS.length).toBe(5);
    for (const c of REGION_KEY_COLUMNS) {
      expect(typeof c.column).toBe("string");
      expect(["sido", "sigungu", "all"]).toContain(c.granularity);
    }
  });

  it("granularity 박제 — 데이터 단위 실측 기준 (시군구 전용은 sigungu, VIEW 미노출은 all)", () => {
    /** @param {string} col */
    const g = (col) => REGION_KEY_COLUMNS.find((c) => c.column === col)?.granularity;
    // 시군구 전용 (medical-access) — 시도로 세면 100% NULL 오탐이라 sigungu 필수
    expect(g("doctors_per_1k")).toBe("sigungu");
    expect(g("hospital_beds_per_1k")).toBe("sigungu");
    // 시도 노출/전용 — VIEW latest_regions
    expect(g("net_migration")).toBe("sido");
    expect(g("housing_supply_level")).toBe("sido");
    // VIEW 미노출 (crime_grade) — 전체행 완결성
    expect(g("crime_grade")).toBe("all");
  });
});
