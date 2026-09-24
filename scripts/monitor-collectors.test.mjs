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
  scopeCompetitionToAh, COMPETITION_CATEGORY, COMPETITION_FIELDS, COMPETITION_SCOPE_SUFFIX,
  fetchAhCompetitionCounts, AH_ID_PREFIX,
  QUARTERLY_CRON_WORKFLOWS, SCHEDULELESS_WORKFLOWS, checkExternalApiStale, EXTERNAL_API_COLLECTORS,
  checkViewRegionStale, VIEW_REGION_STALE_TARGETS, REGION_KEY_COLUMNS,
  checkOrphanGuPairs, GU_JOIN_COLUMNS, fetchGuPairStats,
  checkTradeMonthGaps, TRADE_GAP_LOOKBACK, TRADE_GAP_MIN_BASELINE,
  dedupKey, filterUnsent, hasGithubApiAuth,
} = await import("./monitor-collectors.mjs");
const { AUDIT_FIELDS } = await import("./collectors/data-audit.mjs");
// 세션 517: 크론(로컬 러너 DAY_TABLE) ↔ 감시(EXTERNAL_API_COLLECTORS) 를 한 테스트로 묶기 위해 함께 읽는다.
const { DAY_TABLE } = await import("./kosis-local-runner.mjs");

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
  it("삭제된 워크플로는 QUARTERLY_CRON_WORKFLOWS 에 남지 않는다", () => {
    // 세션 515: "Collect Building Hub (에너지+인허가)" 도 워크플로 자체가 삭제됐다 —
    // MOLIT(1613000) 해외 IP 차단으로 로컬 러너(분기 15일) 이전.
    // 없는 워크플로가 여기 남으면 "분기라 오래 안 돈 것" 으로 오해되므로 등재돼 있으면 안 된다.
    expect(QUARTERLY_CRON_WORKFLOWS).not.toContain("Collect Building Hub (에너지+인허가)");
    // 세션 501: "Housing Permits Data Collection" 은 **워크플로 자체가 삭제**됐다.
    // MOLIT ArchPmsService_v2 폐기 → KOSIS 이전인데 kosis.kr 이 해외 IP 를 막아 GH 에서 못 돈다.
    // 없는 워크플로가 여기 남으면 "분기라 오래 안 돈 것" 으로 오해되므로 등재돼 있으면 안 된다.
    expect(QUARTERLY_CRON_WORKFLOWS).not.toContain("Housing Permits Data Collection");
  });

  it("QUARTERLY_CRON_WORKFLOWS 의 이름은 실제 yml 에 존재한다 (삭제 드리프트 차단)", () => {
    const wfDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");
    /** @type {Set<string>} */
    const names = new Set();
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith(".yml"))) {
      const m = readFileSync(join(wfDir, f), "utf8").match(/^name:\s*(.+)$/m);
      if (m) names.add(m[1].trim().replace(/^["'](.*)["']$/, "$1"));
    }
    for (const name of QUARTERLY_CRON_WORKFLOWS) {
      expect(names.has(name), `QUARTERLY_CRON_WORKFLOWS 의 "${name}" 에 해당하는 yml 이 없다`).toBe(true);
    }
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

  // 세션 505 — 성기게 채워지는 게 정상인 컬럼(공시가격 252/1533)은 ④ 에서 뺀다.
  // 안 빼면 고장 0인데 매일 경보가 울리고, 그런 경보는 곧 아무도 안 본다.
  it("nullSurge:false 컬럼은 NULL 이 임계를 넘어도 ④ 경보 안 함", () => {
    const issues = checkNullSurge([
      { column: "housing_price", total: 1533, filled: 252, nullSurge: false }, // NULL 83.6%
    ]);
    expect(issues).toHaveLength(0);
  });

  it("같은 수치라도 플래그가 없으면 ④ 경보한다 (플래그가 실제로 일하는지 확인)", () => {
    const issues = checkNullSurge([
      { column: "housing_price", total: 1533, filled: 252 },
    ]);
    expect(issues).toHaveLength(1);
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

describe("scopeCompetitionToAh — ④ competition 모수를 청약홈(ah-) 단지로 좁힘 (세션 522)", () => {
  // 실측 골격 (apartments_flat, 2026-08-22):
  //   전체 2,211 = ah- 982 + ap- 1,229. ap- 는 청약홈 공고번호와 이을 키가 없어 3필드 전량 0 채움.
  const AH_TOTAL = 982;
  const ALL_TOTAL = 2211;
  /** @type {Record<string, number>} ah- 단지의 필드별 채움 수 (라이브 실측) */
  const AH_FILLED = { competitionRate: 779, competitionSupply: 781, competitionApplicants: 781 };
  /** ah- 모수 실측 채움률 (2,341/2,946). 문턱 산정의 관측 앵커. */
  const OBSERVED_AH_RATE = 79.5;

  /** 전체 모수로 집계된 computeAudit 결과 골격 (ap- 는 0 채움이라 filled 가 곧 ah- 채움). */
  function makeAudit() {
    /** @type {Record<string, { category: string, field: string, filled: number, missing: number }>} */
    const fields = {};
    let catFilled = 0;
    for (const f of COMPETITION_FIELDS) {
      const filled = AH_FILLED[f];
      fields[`${COMPETITION_CATEGORY}.${f}`] = {
        category: COMPETITION_CATEGORY, field: f, filled, missing: ALL_TOTAL - filled,
      };
      catFilled += filled;
    }
    fields["core.name"] = { category: "core", field: "name", filled: ALL_TOTAL, missing: 0 };
    const catTotal = ALL_TOTAL * COMPETITION_FIELDS.length;
    return {
      categories: {
        [COMPETITION_CATEGORY]: {
          collector: "collect-applyhome",
          filled: catFilled,
          total: catTotal,
          rate: Math.round((catFilled / catTotal) * 1000) / 10, // 35.3
        },
        core: { collector: "applyhome", filled: ALL_TOTAL, total: ALL_TOTAL, rate: 100 },
      },
      fields,
    };
  }

  const ahCounts = { total: AH_TOTAL, filled: AH_FILLED };

  it("정상 전환 — 카테고리 total·filled·rate 가 ah- 모수로 교체된다", () => {
    const { categories, fields } = makeAudit();
    const out = scopeCompetitionToAh(categories, fields, ahCounts);
    const stat = out.categories[COMPETITION_CATEGORY];
    expect(stat.total).toBe(AH_TOTAL * 3); // 2946
    expect(stat.filled).toBe(779 + 781 + 781); // 2341
    expect(stat.rate).toBe(OBSERVED_AH_RATE); // 79.5 — 원본 35.3 에서 재계산됨
    expect(stat.collector).toContain(COMPETITION_SCOPE_SUFFIX); // 경보에 모수가 드러난다
  });

  it("정상 전환 — 필드별 filled/missing 도 ah- 모수로 교체된다", () => {
    const { categories, fields } = makeAudit();
    const out = scopeCompetitionToAh(categories, fields, ahCounts);
    const rate = out.fields[`${COMPETITION_CATEGORY}.competitionRate`];
    expect(rate.filled).toBe(779);
    expect(rate.missing).toBe(AH_TOTAL - 779); // 203 — 전체 모수였다면 1432
    expect(rate.category).toBe(COMPETITION_CATEGORY); // 나머지 속성은 보존
  });

  it("ahCounts.total = 0 이면 원본 그대로 — 감시를 조용히 끄지 않는다", () => {
    const { categories, fields } = makeAudit();
    const out = scopeCompetitionToAh(categories, fields, { total: 0, filled: {} });
    expect(out.categories).toBe(categories);
    expect(out.fields).toBe(fields);
  });

  it("ahCounts 가 null(조회 실패)이면 원본 그대로", () => {
    const { categories, fields } = makeAudit();
    const out = scopeCompetitionToAh(categories, fields, null);
    expect(out.categories).toBe(categories);
    expect(out.fields).toBe(fields);
  });

  it("competition 외 카테고리·필드는 손대지 않는다", () => {
    const { categories, fields } = makeAudit();
    const out = scopeCompetitionToAh(categories, fields, ahCounts);
    expect(out.categories.core).toEqual(categories.core);
    expect(out.fields["core.name"]).toEqual(fields["core.name"]);
  });

  it("원본 객체를 변형하지 않는다 (⑥ VIEW 회귀·브리핑이 같은 audit 을 쓴다)", () => {
    const { categories, fields } = makeAudit();
    const before = JSON.parse(JSON.stringify({ categories, fields }));
    scopeCompetitionToAh(categories, fields, ahCounts);
    expect(JSON.parse(JSON.stringify({ categories, fields }))).toEqual(before);
  });

  it("의미 가드 — ap- 0채움/ah- 79% 상태에서 전환하면 경보 0건, 전환 없이는 1건", () => {
    const { categories, fields } = makeAudit();
    // 전환 없이(전체 모수) — 도달 가능 최대 44.4% 라 문턱을 영구히 못 넘는 거짓 경보
    const before = checkCategoryNullSurge(categories, AUDIT_CATEGORY_BASELINE, fields);
    expect(before.filter((i) => i.collector.includes("청약경쟁률"))).toHaveLength(1);
    // 전환 후 — 청약홈 단지 품질(79.5%)로 판정되어 경보 없음
    const scoped = scopeCompetitionToAh(categories, fields, ahCounts);
    const after = checkCategoryNullSurge(scoped.categories, AUDIT_CATEGORY_BASELINE, scoped.fields);
    expect(after.filter((i) => i.collector.includes("청약경쟁률"))).toHaveLength(0);
  });

  it("문턱 앵커 — competition 문턱은 ah- 실측 채움률(79.5%)보다 8~25%p 아래", () => {
    // 파생 가드(상수에서 읽어 비교)만으로는 상수를 잘못 바꿔도 전부 초록이라, 상수가 근거로 삼은
    // **관측값**을 적어 둔다. 전체 모수 시절 문턱(45)은 마진 34.5%p 라 여기서 빨강.
    const margin = OBSERVED_AH_RATE - AUDIT_CATEGORY_BASELINE.competition;
    expect(margin).toBeGreaterThanOrEqual(8);
    expect(margin).toBeLessThanOrEqual(25);
    // 전체 모수의 도달 가능 최대치(982/2211=44.4%)보다는 반드시 높아야 한다 —
    // 그보다 낮으면 모수 전환의 이유 자체가 사라진다.
    expect(AUDIT_CATEGORY_BASELINE.competition).toBeGreaterThan((AH_TOTAL / ALL_TOTAL) * 100);
  });

  it("배선 가드 — runAll 이 ④ 에 원본이 아니라 좁힌 사본을 넘긴다", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "monitor-collectors.mjs"), "utf8");
    // 좌변까지 고정해 호출부만 잡는다 (선언부·주석 매칭 방지 — guards 룰 §소스 grep 가드)
    expect(src).toMatch(/const\s+scoped\s*=\s*scopeCompetitionToAh\(\s*audit\.categories\s*,\s*audit\.fields\s*,\s*ahCounts\s*\)/);
    expect(src).toMatch(/checkCategoryNullSurge\(\s*scoped\.categories\s*,\s*AUDIT_CATEGORY_BASELINE\s*,\s*scoped\.fields\s*\)/);
  });

  it("COMPETITION_FIELDS 는 data-audit 의 competition 필드와 정확히 일치", () => {
    expect([...COMPETITION_FIELDS].sort()).toEqual([...AUDIT_FIELDS.competition.fields].sort());
  });
});

describe("fetchAhCompetitionCounts — ④ ah- 모수 조회 (세션 522·523)", () => {
  /**
   * apartments_flat count 쿼리만 흉내내는 최소 Supabase mock.
   *
   * 체이닝은 `from().select().like()` 로 시작하고, 필드 count 일 때만 `.not(field,"is",null)` 가
   * 덧붙는다 — 그래서 `.not` 호출 여부가 곧 "total 이냐 필드냐" 의 판별이 된다.
   * 반환 객체는 thenable 이라 `await q` 가 그대로 `{ count }` 를 준다(실제 PostgrestFilterBuilder 와 같은 꼴).
   *
   * @param {{ total: number|null, filled: Record<string, number|null> }} counts
   * @param {{ throwOn?: string }} [opts] "total" 또는 필드명이면 그 쿼리에서 throw (조회 실패 재현)
   */
  function makeAhSb(counts, opts = {}) {
    /** @type {{ tables: string[], likes: Array<[string, string]>, notFields: string[] }} */
    const calls = { tables: [], likes: [], notFields: [] };
    const builder = () => {
      /** @type {string | null} */
      let field = null;
      /** @type {any} */
      const q = {
        select: () => q,
        like: (/** @type {string} */ col, /** @type {string} */ pat) => {
          calls.likes.push([col, pat]);
          return q;
        },
        not: (/** @type {string} */ f) => {
          field = f;
          calls.notFields.push(f);
          return q;
        },
        then: (/** @type {any} */ resolve, /** @type {any} */ reject) => {
          const key = field ?? "total";
          if (opts.throwOn === key) {
            return Promise.reject(new Error(`쿼리 실패: ${key}`)).then(resolve, reject);
          }
          const raw = field ? counts.filled[field] : counts.total;
          return Promise.resolve({ count: raw === undefined ? null : raw }).then(resolve, reject);
        },
      };
      return q;
    };
    return {
      calls,
      sb: { from: (/** @type {string} */ t) => { calls.tables.push(t); return builder(); } },
    };
  }

  /** 라이브 실측 골격 (2026-08-22): ah- 982 단지, 3필드 채움 779/781/781. */
  const AH_TOTAL = 982;
  const AH_FILLED = { competitionRate: 779, competitionSupply: 781, competitionApplicants: 781 };

  it("정상 — total + 3필드 채움 수를 { total, filled } 로 돌려준다", async () => {
    const { sb, calls } = makeAhSb({ total: AH_TOTAL, filled: AH_FILLED });
    const out = await fetchAhCompetitionCounts(sb);
    expect(out).toEqual({ total: AH_TOTAL, filled: AH_FILLED });
    // 주입한 sb 를 실제로 썼다는 증거 (getSupabase() 로 샜다면 undefined.from 으로 죽어 null 이 된다)
    expect(calls.tables).toEqual(Array(4).fill("apartments_flat")); // total 1 + 필드 3
    expect(calls.notFields).toEqual([...COMPETITION_FIELDS]);
  });

  it("정상 — 모든 쿼리가 ah- 접두사로 모수를 좁힌다", async () => {
    const { sb, calls } = makeAhSb({ total: AH_TOTAL, filled: AH_FILLED });
    await fetchAhCompetitionCounts(sb);
    expect(calls.likes).toHaveLength(4);
    for (const [col, pat] of calls.likes) {
      expect(col).toBe("id");
      expect(pat).toBe(`${AH_ID_PREFIX}%`);
    }
  });

  it("total count 가 null 이면 null — 필드 쿼리로 넘어가지 않는다", async () => {
    const { sb, calls } = makeAhSb({ total: null, filled: AH_FILLED });
    expect(await fetchAhCompetitionCounts(sb)).toBeNull();
    expect(calls.notFields).toEqual([]); // total 에서 즉시 중단
  });

  it("필드 count 가 하나라도 null 이면 null — 반쪽 모수로 판정하지 않는다", async () => {
    const { sb } = makeAhSb({
      total: AH_TOTAL,
      filled: { ...AH_FILLED, competitionSupply: null },
    });
    expect(await fetchAhCompetitionCounts(sb)).toBeNull();
  });

  it("쿼리가 throw 하면 null + 로그 1줄 — 감시 자체는 멈추지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { sb } = makeAhSb({ total: AH_TOTAL, filled: AH_FILLED }, { throwOn: "competitionRate" });
      expect(await fetchAhCompetitionCounts(sb)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain("ah- 모수 조회 실패");
    } finally {
      spy.mockRestore();
    }
  });

  it("total 쿼리 자체가 throw 해도 null (첫 쿼리 실패 경로)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { sb } = makeAhSb({ total: AH_TOTAL, filled: AH_FILLED }, { throwOn: "total" });
      expect(await fetchAhCompetitionCounts(sb)).toBeNull();
    } finally {
      spy.mockRestore();
    }
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

  it("신규 collector — 행 1개 + 최신이 신선하면 조용 (오탐 차단)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, finished_at: "2026-05-27T00:00:00Z" }, // 1일 전
        ],
      },
      now,
    );
    expect(issues).toHaveLength(0);
  });

  it("행이 아예 없으면 조용 — 기준 시각이 없어 판정 불가 (세션 504)", () => {
    const issues = checkExternalApiStale(targets, { "housing-permits": [] }, now);
    expect(issues).toHaveLength(0);
  });

  // ⚠️ 아래 두 건이 세션 504 회귀 가드의 본체다.
  //    "행 3개 미만이면 skip" 가드가 함수 맨 앞에 있으면 ⑤-b(미발화)까지 함께 막혀
  //    행 1~2개짜리 collector 가 몇 달을 안 돌아도 영영 침묵한다(실제로 그 상태였다).
  //    ⑤-b 는 최신 1행이면 판정 가능하므로, 가드를 위로 되돌리면 이 두 건이 red 여야 한다.
  it("행 1개뿐이어도 최신이 stale_days 초과면 미발화 알림 (세션 504)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 42, finished_at: "2026-05-01T00:00:00Z" }, // 27일 전 > 14
        ],
      },
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].detail).toMatch(/미발화/);
    expect(issues[0].detail).toMatch(/27일/);
  });

  it("행 2개여도 최신이 stale_days 초과면 미발화 알림 (세션 504)", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 5, finished_at: "2026-05-08T00:00:00Z" }, // 20일 전 > 14
          { status: "success", ok_count: 3, finished_at: "2026-04-08T00:00:00Z" },
        ],
      },
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].detail).toMatch(/20일/);
  });

  it("행 2개 + 전부 ok=0 이어도 outage 로는 안 간다 — N회 연속 정의상 3행 필요 (세션 504)", () => {
    // ⑤-a 는 "3회 연속 빈 성공" 이 정의라 2행으로는 판정하지 않는다.
    // 최신 행을 신선하게 둬서 ⑤-b 도 안 걸리게 한 뒤, 결과가 0건인지로 ⑤-a 의 3행 요건을 검증한다.
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 0, finished_at: "2026-05-27T00:00:00Z" }, // 1일 전
          { status: "success", ok_count: 0, finished_at: "2026-04-27T00:00:00Z" },
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

  it("미발화(F3) — naver- 접두 collector 는 조치 문구가 MibunyangNaverCollect 로 분기", () => {
    const naverTargets = [{ collector: "naver-pipeline", stale_days: 4, owner: "네이버 로컬 파이프라인" }];
    const issues = checkExternalApiStale(
      naverTargets,
      { "naver-pipeline": [{ status: "success", ok_count: 6, finished_at: "2026-05-20T00:00:00Z" }] }, // 8일 전 > 4
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].lines?.join("\n")).toContain("MibunyangNaverCollect");
    expect(issues[0].lines?.join("\n")).toContain("record-pipeline-run.mjs done --collector=naver-pipeline");
  });

  it("미발화(F3) — housing-permits(naver- 아님) 는 기존 KOSIS 로컬 러너 문구 그대로", () => {
    const issues = checkExternalApiStale(
      targets,
      {
        "housing-permits": [
          { status: "success", ok_count: 42, finished_at: "2026-05-01T00:00:00Z" }, // 27일 전 > 14
        ],
      },
      now,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].lines?.join("\n")).toContain("MibunyangKosisLocal");
    expect(issues[0].lines?.join("\n")).not.toContain("MibunyangNaverCollect");
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

  it("naver-pipeline(완주 기록)이 stale 4 로 등재돼 있다 — 한 회차 놓침을 다음 회차 전에 (세션 570)", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === "naver-pipeline");
    expect(entry, "naver-pipeline 미등재 — 재시작으로 4~6단계가 끊겨도 아무도 모른다").toBeTruthy();
    expect(entry?.stale_days).toBe(4);
  });

  it("naver-pipeline — 목요일 회차가 끊기면 금 09:00 은 침묵, 토 09:00 에 울린다 / 정상 목→월은 침묵", () => {
    const target = EXTERNAL_API_COLLECTORS.filter((c) => c.collector === "naver-pipeline");
    // 월 2026-09-28 12:00 KST(=03:00Z) 완주, 목 10/01 은 재시작으로 행 없음
    const runs = { "naver-pipeline": [{ status: "success", ok_count: 6, skip_count: 0, finished_at: "2026-09-28T03:00:00Z" }] };
    expect(checkExternalApiStale(target, runs, new Date("2026-10-02T00:00:00Z"))).toHaveLength(0); // 금 09:00 KST
    const sat = checkExternalApiStale(target, runs, new Date("2026-10-03T00:00:00Z")); // 토 09:00 KST
    expect(sat).toHaveLength(1);
    expect(sat[0].kind).toBe("stale");
    // 정상 — 목 10/01 12:00 KST 완주 → 월 10/05 09:00 KST 감시(3.9일)
    const normal = { "naver-pipeline": [{ status: "success", ok_count: 6, skip_count: 0, finished_at: "2026-10-01T03:00:00Z" }] };
    expect(checkExternalApiStale(target, normal, new Date("2026-10-05T00:00:00Z"))).toHaveLength(0);
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

  it("EXTERNAL_API_COLLECTORS 배열 = 36 후보 박힘 (기존 5 + KOSIS 로컬 10, 세션 289 + childcare 로컬 3, 세션 399 + maintenance, 세션 447 + applyhome-seed, 세션 466 + notify-subscribers, 세션 467 + naver-presale, 세션 470 + naver-collect, 세션 495 + applyhome-remndr, 세션 496 + housing-price, 세션 504 + MOLIT 로컬 3, 세션 515 + naver-devplan, 세션 517 + air-quality, 세션 519 + crime-safety, 세션 521 + lhzone-status, 세션 522 + emergency, 세션 525 + population·population-sex-age, 세션 550 + naver-pipeline, 세션 570)", () => {
    const names = EXTERNAL_API_COLLECTORS.map((c) => c.collector).sort();
    expect(names).toEqual([
      "air-quality",
      "applyhome-detail", "applyhome-remndr", "applyhome-seed", "avg-income", "building-hub",
      "childcare-detail", "childcare-info", "childcare-info-jeju",
      // 세션 521: CSV 기반이라 "자동 실행 경로가 없다" 며 감시에서 빼 뒀던 것을 로컬 러너
      // 매월 8일로 편입하면서 정식 등재. 안 돌던 사이 regions 3개월치가 통째로 NULL 이었다.
      "crime-safety",
      // 세션 525: apis.data.go.kr/B552657(응급의료기관)도 해외 IP 차단 → GH yml 삭제 +
      // 로컬 러너 매월 3일. GH run 이 없어 ①③ 대상 밖이므로 ⑤ 가 유일한 "안 돌면 알림".
      "emergency",
      "housing-permits", "housing-price",
      "kosis-fertility-rate", "kosis-housing-supply-ratio", "kosis-jeonse-price-index",
      "kosis-medical-access", "kosis-regional-economy", "kosis-sale-price-index",
      "kosis-unsold",
      // 세션 522: 택지정보시스템 지구단계정보 → dev_plans.progression_step(lh_zone).
      // 로컬 러너 매월 21일 편입과 한 쌍(아래 동기화 describe 가 한쪽만 지워지면 red).
      "lhzone-status",
      "maintenance", "market-stats", "migration",
      // 세션 515: MOLIT(1613000) 해외 IP 차단 → GH yml 5개 삭제 + 로컬 러너 이전.
      // GH run 이 없어 ①③ 대상 밖이므로 ⑤ 신선도가 유일한 "안 돌면 알림".
      "molit-building", "molit-units", "trades",
      // 세션 517: naver-devplan 을 로컬 러너 매월 20일로 크론 편입 → ⑤ 신선도 감시 등재.
      "naver-collect", "naver-devplan", "naver-presale", "notify-subscribers",
      // 세션 570: run-naver-local.bat 6단계 완주 기록(record-pipeline-run.mjs). 세 주 연속 4~6단계가 끊겼는데 무음이었다.
      "naver-pipeline",
      // 세션 550: 행안부(MOIS) 인구 API 도 해외 IP 차단 → collect-population.yml 삭제 +
      // 로컬 러너 매월 5일(행 생성자라 후행보다 앞). 한 yml 이 두 수집기를 돌렸고 둘 다
      // 자기 collector_runs 행을 남기므로 **둘 다** 등재한다 — 하나만 넣으면 나머지가 조용히 죽는다.
      "population", "population-sex-age",
      "schools", "transport-tago",
    ].sort());
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
        /** @param {string} arg recordCollectorRun 첫 인자 원문 */
        const addLabel = (arg) => {
          const a = arg.trim();
          if (a === "PHASE") {
            if (phase) labels.add(phase);
            return;
          }
          const lit = a.match(/^["'`]([^"'`]+)["'`]$/);
          if (lit) labels.add(lit[1]);
        };
        for (const m of src.matchAll(/recordCollectorRun\(\s*([^,)]+)/g)) addLabel(m[1]);
        // 세션 517: 기록을 **감싸는 래퍼**도 라벨 소스다. naver-devplan.mjs 는
        //   `recordRunUnlessDryRun(dryRun, result, recorder = recordCollectorRun)` 안에서
        //   `recorder(PHASE, result)` 로 부르므로 위의 직접 호출 정규식엔 걸리지 않는다.
        //   기본값이 recordCollectorRun 인 매개변수 이름을 뽑아 그 호출도 같은 규칙으로 훑는다.
        for (const alias of src.matchAll(/(\w+)\s*=\s*recordCollectorRun\b/g)) {
          for (const c of src.matchAll(new RegExp(`\\b${alias[1]}\\(\\s*([^,)]+)`, "g")))
            addLabel(c[1]);
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

  // 세션 505 PR-C — 공시가격 등재. 원본 정상 채움이 16.4% 라 기본 하한 20% 로는 조건이
  // 성립할 수 없어, minRegionRate 를 안 낮추면 "등재는 했는데 영영 안 잡히는" 껍데기가 된다.
  //
  // 등재가 사라지면 아래 두 테스트가 "0건이라 통과" 하는 게 아니라 여기서 먼저 터진다 —
  // 못 찾은 걸 조용히 넘기면 뮤테이션이 초록불로 지나간다.
  function housingPriceTarget() {
    const t = VIEW_REGION_STALE_TARGETS.find((x) => x.regionColumn === "housing_price");
    if (!t) throw new Error("VIEW_REGION_STALE_TARGETS 에 housing_price 등재가 없다");
    return t;
  }

  it("⑥ housing_price 등재 — minRegionRate 를 낮췄기에 실제 회귀가 잡힌다", () => {
    const target = housingPriceTarget();
    expect(target.viewKey).toBe("regions.housingPrice");
    expect(target.minRegionRate ?? 0.2).toBeLessThan(0.164); // 라이브 원본 채움률 252/1533
    // VIEW 가 컬럼을 잃은 회귀 상황 (원본 252/1533 그대로인데 화면만 0)
    expect(checkViewRegionStale(
      { "regions.housingPrice": { filled: 0, missing: 2043 } },
      [{ column: "housing_price", total: 1533, filled: 252 }],
      [target],
    )).toHaveLength(1);
  });

  it("⑥ housing_price 정상 — 화면 81.4% 채움이면 경보 없음", () => {
    expect(checkViewRegionStale(
      { "regions.housingPrice": { filled: 1664, missing: 379 } },
      [{ column: "housing_price", total: 1533, filled: 252 }],
      [housingPriceTarget()],
    )).toHaveLength(0);
  });

  it("⑥ minRegionRate 미지정 대상은 기본 하한 0.2 를 그대로 쓴다", () => {
    const targets = [{ viewKey: "regions.x", regionColumn: "x", label: "X" }];
    // 원본 19% → 기본 하한 20% 미달이라 skip
    expect(checkViewRegionStale(
      { "regions.x": { filled: 0, missing: 100 } },
      [{ column: "x", total: 100, filled: 19 }],
      targets,
    )).toHaveLength(0);
    // 원본 21% → 발화
    expect(checkViewRegionStale(
      { "regions.x": { filled: 0, missing: 100 } },
      [{ column: "x", total: 100, filled: 21 }],
      targets,
    )).toHaveLength(1);
  });
});

describe("checkOrphanGuPairs — ⑦ 시군구 짝 불일치 (세션549)", () => {
  // ⚠️ 기대값은 전부 **리터럴**이다 — 검사 대상 상수(GU_JOIN_COLUMNS)에서 파생하면
  //    상수를 바꾸는 순간 단언도 같이 밀려 항등식이 된다(guards-must-be-mutation-tested §파생 가드).
  const COLS = ["fertility_rate", "doctors_per_1k", "hospital_beds_per_1k", "housing_price"];

  /**
   * regions 행 하나 — 지정한 컬럼만 값을 채운다.
   * @param {string} region @param {string} gu @param {Record<string, number|null>} [vals]
   */
  const rrow = (region, gu, vals = {}) => ({
    region, gu,
    fertility_rate: null, doctors_per_1k: null, hospital_beds_per_1k: null, housing_price: null,
    ...vals,
  });

  it("정상 — 모든 짝이 값 있는 regions 행을 가지면 이상 0건", () => {
    const issues = checkOrphanGuPairs(
      [{ region: "경기", gu: "수원시 권선구", count: 14 }, { region: "인천", gu: "제물포구", count: 30 }],
      [rrow("경기", "수원시 권선구", { fertility_rate: 0.7 }), rrow("인천", "제물포구", { housing_price: 3.1 })],
    );
    expect(issues).toHaveLength(0);
  });

  it("A 짝 없음 — regions 에 그 (region,gu) 행이 아예 없으면 발화 (세션549 일반구 표기 사고)", () => {
    // 실사고: apartments.gu 가 "권선구" 인데 regions 는 "수원시 권선구" 로만 있었다.
    const issues = checkOrphanGuPairs(
      [{ region: "경기", gu: "권선구", count: 14 }],
      [rrow("경기", "수원시 권선구", { fertility_rate: 0.7 })],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("nulls");
    expect(issues[0].detail).toMatch(/짝 없음 1쌍/);
    expect(issues[0].detail).toMatch(/단지 14곳/);
    expect(issues[0].lines?.join("\n")).toMatch(/경기\|권선구 14곳/);
  });

  it("B 빈 껍데기 — 행은 있는데 4컬럼이 전부 NULL 이면 발화 (세션548 인천 신설 4구)", () => {
    const issues = checkOrphanGuPairs(
      [{ region: "인천", gu: "제물포구", count: 30 }],
      [rrow("인천", "제물포구")],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/빈 껍데기 1쌍/);
    expect(issues[0].detail).toMatch(/단지 30곳/);
  });

  it("B 는 모든 recorded_at 행이 비었을 때만 — 옛 행에 값이 있으면 발화 안 함", () => {
    // VIEW latest_regions_gu 는 컬럼별 최신 non-null 을 고르므로 옛 행 값도 화면에 나온다.
    // 새 행이 비었다고 울리면 매달 population 이 새 행을 만들 때마다 거짓 경보가 된다.
    const issues = checkOrphanGuPairs(
      [{ region: "경기", gu: "화성시", count: 12 }],
      [
        rrow("경기", "화성시", { fertility_rate: 0.8 }), // 옛 행 — 값 있음
        rrow("경기", "화성시"),                          // 새 행 — 전부 NULL
      ],
    );
    expect(issues).toHaveLength(0);
  });

  it("부분 비움은 발화 안 함 — housing_price 만 NULL (충남|천안시 식, 정상)", () => {
    // 라이브 실측(2026-09-20): 공동주택 없는 시 단위 8쌍에서 housing_price 만 정상적으로 빈다.
    const issues = checkOrphanGuPairs(
      [{ region: "충남", gu: "천안시", count: 9 }],
      [rrow("충남", "천안시", { fertility_rate: 0.9, doctors_per_1k: 2.1, hospital_beds_per_1k: 8.4 })],
    );
    expect(issues).toHaveLength(0);
  });

  it("부분 비움은 발화 안 함 — hospital_beds_per_1k 만 NULL (강원|고성군 식, 정상)", () => {
    const issues = checkOrphanGuPairs(
      [{ region: "강원", gu: "고성군", count: 2 }],
      [rrow("강원", "고성군", { fertility_rate: 1.1, doctors_per_1k: 1.2, housing_price: 1.5 })],
    );
    expect(issues).toHaveLength(0);
  });

  it("집계 — 종류당 이슈 1건 · 단지수 내림차순 상위 8쌍 + \"외 N쌍\" (텔레그램 도배 차단)", () => {
    // 10쌍(짝 없음) + 2쌍(빈 껍데기) = 이슈는 2건이어야 한다 (쌍마다 1건이면 12건이 한 번에 나간다).
    const aptPairs = [];
    for (let i = 1; i <= 10; i++) aptPairs.push({ region: "경기", gu: `구${i}`, count: i });
    aptPairs.push({ region: "인천", gu: "제물포구", count: 30 }, { region: "인천", gu: "영종구", count: 20 });
    const issues = checkOrphanGuPairs(aptPairs, [rrow("인천", "제물포구"), rrow("인천", "영종구")]);

    expect(issues).toHaveLength(2);
    const [a, b] = issues;
    // A: 10쌍 · 단지 1+2+…+10 = 55곳
    expect(a.detail).toMatch(/짝 없음 10쌍/);
    expect(a.detail).toMatch(/단지 55곳/);
    const aLines = a.lines ?? [];
    // 첫 줄은 설명, 그 다음이 쌍 목록 8줄 + "외 2쌍"
    expect(aLines.filter((l) => l.startsWith("  · ")).length).toBe(9);
    expect(aLines[1]).toBe("  · 경기|구10 10곳"); // 내림차순 1위
    expect(aLines[8]).toBe("  · 경기|구3 3곳");   // 8위
    expect(aLines[9]).toBe("  · 외 2쌍");
    // B: 2쌍 · 50곳
    expect(b.detail).toMatch(/빈 껍데기 2쌍/);
    expect(b.detail).toMatch(/단지 50곳/);
    expect((b.lines ?? []).filter((l) => l.startsWith("  · "))).toEqual([
      "  · 인천|제물포구 30곳",
      "  · 인천|영종구 20곳",
    ]);
  });

  it("8쌍 이하면 \"외 N쌍\" 줄이 없다 (경계)", () => {
    const aptPairs = [];
    for (let i = 1; i <= 8; i++) aptPairs.push({ region: "경기", gu: `구${i}`, count: i });
    const lines = checkOrphanGuPairs(aptPairs, [])[0].lines ?? [];
    expect(lines.filter((l) => l.startsWith("  · ")).length).toBe(8);
    expect(lines.join("\n")).not.toMatch(/외 \d+쌍/);
  });

  it("gu·region 이 비면 무시 — 세종처럼 gu 없는 단지는 rg 조인을 안 쓴다", () => {
    expect(checkOrphanGuPairs(
      [
        { region: "세종", gu: null, count: 40 },
        { region: "세종", gu: "", count: 3 },
        { region: null, gu: "권선구", count: 5 },
        { region: "경기", count: 7 },
      ],
      [],
    )).toHaveLength(0);
  });

  it("dedup 키가 쌍 집합마다 다르다 — 두 번째 다른 사고가 첫 경보에 먹히지 않는다", () => {
    // dedupKey = `kind|collector|at`. collector 에 쌍 지문이 없으면 첫 경보 뒤 영구 침묵한다.
    const one = checkOrphanGuPairs([{ region: "경기", gu: "권선구", count: 14 }], [])[0];
    const two = checkOrphanGuPairs([{ region: "인천", gu: "제물포구", count: 30 }], [])[0];
    const both = checkOrphanGuPairs(
      [{ region: "경기", gu: "권선구", count: 14 }, { region: "인천", gu: "제물포구", count: 30 }],
      [],
    )[0];
    expect(dedupKey(one)).not.toBe(dedupKey(two));
    expect(dedupKey(one)).not.toBe(dedupKey(both));
    expect(dedupKey(two)).not.toBe(dedupKey(both));
    // 같은 집합이면 같은 키 (하루 두 번 돌아도 1회만 알림)
    expect(dedupKey(checkOrphanGuPairs([{ region: "경기", gu: "권선구", count: 14 }], [])[0])).toBe(dedupKey(one));
  });

  it("A 와 B 는 서로 다른 dedup 키 — 한쪽 경보가 다른 쪽을 가리지 않는다", () => {
    const issues = checkOrphanGuPairs(
      [{ region: "경기", gu: "권선구", count: 14 }, { region: "인천", gu: "제물포구", count: 30 }],
      [rrow("인천", "제물포구")],
    );
    expect(issues).toHaveLength(2);
    expect(dedupKey(issues[0])).not.toBe(dedupKey(issues[1]));
  });

  it("GU_JOIN_COLUMNS = VIEW 의 rg 조인 4컬럼 (리터럴 박제 — 늘리면 여기도 고친다)", () => {
    expect(GU_JOIN_COLUMNS).toEqual(COLS);
  });

  it("columns 를 넓히면 그만큼 더 요구한다 — opts.columns 경로", () => {
    // 4컬럼 기준으로는 정상인 행이, 5번째 컬럼을 요구하면 여전히 정상(하나라도 차 있으면 OK).
    expect(checkOrphanGuPairs(
      [{ region: "경기", gu: "화성시", count: 3 }],
      [{ region: "경기", gu: "화성시", fertility_rate: 0.8 }],
      { columns: ["fertility_rate", "새컬럼"] },
    )).toHaveLength(0);
    // fertility_rate 를 빼고 새컬럼만 요구하면 껍데기로 잡힌다
    expect(checkOrphanGuPairs(
      [{ region: "경기", gu: "화성시", count: 3 }],
      [{ region: "경기", gu: "화성시", fertility_rate: 0.8 }],
      { columns: ["새컬럼"] },
    )).toHaveLength(1);
  });

  it("count 가 없거나 0 이어도 쌍은 잡는다 (단지수만 0곳으로 표기)", () => {
    const issues = checkOrphanGuPairs([{ region: "경기", gu: "권선구" }], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/단지 0곳/);
  });
});

// ── ⑦ 세종 짝 검사 (세션550) ──────────────────────────────────────
//
// VIEW 가 `rg.gu = CASE WHEN a.region = '세종' THEN '세종시' ELSE a.gu END` 로 바뀌면서
// 세종 단지(apartments.gu = NULL)도 `세종|세종시` 로 조인된다. ⑦ 이 옛 `if (!region || !gu) continue`
// 로 남으면 그 짝을 **한 번도 검사하지 않는다** — 세종 35곳이 4칸을 잃어도 조용하다.
//
// ⚠️ 쌍을 만드는 자리는 `fetchGuPairStats` 안이라, 판정 함수만 테스트하면 되돌아가도 초록이다.
//    그래서 진짜 조회 경로(selectAll 체인)를 스텁으로 태워 잰다.
describe("fetchGuPairStats — ⑦ 가 세종 짝을 만든다 (세션550)", () => {
  /**
   * selectAll 커서 모드 체인 재현: from(t).select(cols).order().limit().gt?() → { data, error }.
   * 한 페이지(1,000행 미만)면 루프가 한 번에 끝난다.
   * @param {Record<string, Record<string, unknown>[]>} tableRows
   */
  const makeSb = (tableRows) => ({
    from(/** @type {string} */ table) {
      const rows = tableRows[table] ?? [];
      /** @type {any} */
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        gt: () => ({ ...q, then: undefined }),
        then: (/** @type {any} */ res, /** @type {any} */ rej) =>
          Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return q;
    },
  });

  const SEJONG_REGION_ROW = {
    id: 1, region: "세종", gu: "세종시",
    fertility_rate: 1.061, doctors_per_1k: null, hospital_beds_per_1k: null, housing_price: 366,
  };

  it("세종 단지(gu null)가 '세종|세종시' 쌍으로 집계된다", async () => {
    const { aptPairs } = await fetchGuPairStats(makeSb({
      apartments: [{ id: "ah-1", region: "세종", gu: null }, { id: "ah-2", region: "세종", gu: null }],
      regions: [SEJONG_REGION_ROW],
    }));
    const sejong = aptPairs.find((p) => p.region === "세종");
    expect(sejong).toEqual({ region: "세종", gu: "세종시", count: 2 });
  });

  it("세종의 쓰레기 gu 표기도 '세종시' 한 쌍으로 모인다", async () => {
    const { aptPairs } = await fetchGuPairStats(makeSb({
      apartments: [
        { id: "ah-1", region: "세종", gu: null },
        { id: "ah-2", region: "세종", gu: "6-3생활권" },
      ],
      regions: [SEJONG_REGION_ROW],
    }));
    expect(aptPairs).toHaveLength(1);
    expect(aptPairs[0]).toEqual({ region: "세종", gu: "세종시", count: 2 });
  });

  it("세종이 아닌 gu 없는 단지는 여전히 빠진다 (VIEW 도 조인 안 함)", async () => {
    const { aptPairs } = await fetchGuPairStats(makeSb({
      apartments: [{ id: "ah-1", region: "경기", gu: null }, { id: "ah-2", region: "경기", gu: "화성시" }],
      regions: [],
    }));
    expect(aptPairs).toEqual([{ region: "경기", gu: "화성시", count: 1 }]);
  });

  it("A 짝 없음 — regions 에 '세종|세종시' 행이 없으면 발화", async () => {
    const { aptPairs, regionRows } = await fetchGuPairStats(makeSb({
      apartments: [{ id: "ah-1", region: "세종", gu: null }],
      regions: [],
    }));
    const issues = checkOrphanGuPairs(aptPairs, regionRows);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/짝 없음 1쌍/);
    expect(issues[0].lines?.join("\n")).toMatch(/세종\|세종시 1곳/);
  });

  it("B 빈 껍데기 — 행은 있는데 4컬럼이 전부 NULL 이면 발화", async () => {
    const { aptPairs, regionRows } = await fetchGuPairStats(makeSb({
      apartments: [{ id: "ah-1", region: "세종", gu: null }],
      regions: [{
        id: 1, region: "세종", gu: "세종시",
        fertility_rate: null, doctors_per_1k: null, hospital_beds_per_1k: null, housing_price: null,
      }],
    }));
    const issues = checkOrphanGuPairs(aptPairs, regionRows);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/빈 껍데기 1쌍/);
  });

  it("정상 — 값이 있는 '세종|세종시' 행이 있으면 이상 0건 (라이브 실측 모양)", async () => {
    const { aptPairs, regionRows } = await fetchGuPairStats(makeSb({
      apartments: [{ id: "ah-1", region: "세종", gu: null }],
      regions: [SEJONG_REGION_ROW],
    }));
    expect(checkOrphanGuPairs(aptPairs, regionRows)).toHaveLength(0);
  });
});

describe("REGION_KEY_COLUMNS — ④ NULL 점검 대상 granularity 구조 (세션 478)", () => {
  it("각 항목이 column + granularity(sido|sigungu|all) 구조 · 6개", () => {
    expect(REGION_KEY_COLUMNS.length).toBe(6);
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
    // 공시가격 (세션 505) — VIEW latest_regions_gu 노출이라 sigungu. 시도로 세면 0% 오탐
    expect(g("housing_price")).toBe("sigungu");
  });

  // 세션 505 — ⑥ 는 REGION_KEY_COLUMNS 에 있는 컬럼만 조회하므로, ④ 에서 뺀 컬럼도
  // 목록에는 남아 있어야 한다. 목록에서 지우면 ⑥ 등재가 조용히 무력화된다.
  it("④ 에서 뺀 컬럼(nullSurge:false)도 목록에는 남아 ⑥ 가 조회할 수 있다", () => {
    const hp = REGION_KEY_COLUMNS.find((c) => c.column === "housing_price");
    expect(hp).toBeTruthy();
    expect(hp?.nullSurge).toBe(false);
    // ⑥ 대상의 regionColumn 은 전부 이 목록에 있어야 조회된다
    for (const t of VIEW_REGION_STALE_TARGETS) {
      expect(REGION_KEY_COLUMNS.some((c) => c.column === t.regionColumn)).toBe(true);
    }
  });
});

describe("크론(DAY_TABLE) ↔ 감시(EXTERNAL_API_COLLECTORS) 동기화 — naver-devplan (세션 517)", () => {
  // [[guards-must-be-mutation-tested]] §"주기·설정을 바꾸면 그것을 읽는 감시도 함께 바꾼다":
  // 한쪽만 되돌리면 red 여야 한다. 크론만 지우면 "안 돌아도 아무도 모르는" 편입 전 상태로,
  // 감시만 지우면 "돌다 멈춰도 조용한" 상태로 각각 회귀한다 — 둘 다 겉보기엔 정상이다.
  const SCRIPT = "naver-devplan.mjs";
  const COLLECTOR = "naver-devplan";
  // 인자를 빼면 V-WORLD 축까지 켜져 ~7.5h 단발 upsert(중간 체크포인트 없음)로 늘어난다.
  // 스펙을 못박는 것이 목적이므로 여기만 리터럴로 둔다.
  const ARGS = ["--kinds=road,rail,station,jigu"];

  it("DAY_TABLE 매월 20일에 naver-devplan 이 --kinds 4종 인자와 함께 있다", () => {
    const rows = DAY_TABLE.filter((e) => e.script === SCRIPT);
    expect(rows.map((e) => e.day), "매월 20일 1회여야 한다").toEqual([20]);
    expect(rows[0]?.args, "인자가 빠지면 V-WORLD 축까지 켜져 회차가 ~7.5h 로 늘어난다").toEqual(ARGS);
  });

  it("같은 수집기가 monitor ⑤ 에 월간(38) 신선도로 등재돼 있다", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === COLLECTOR);
    expect(entry, `${COLLECTOR} 가 EXTERNAL_API_COLLECTORS 에 없다 — 크론만 있고 감시가 없다`).toBeTruthy();
    expect(entry?.stale_days, "월간(매월 20일) = 31일 + 여유 1주").toBe(38);
  });

  it("크론과 감시가 한 쌍으로 존재한다 (한쪽만 되돌리면 red)", () => {
    const scheduled = DAY_TABLE.some((e) => e.script === SCRIPT);
    const monitored = EXTERNAL_API_COLLECTORS.some((c) => c.collector === COLLECTOR);
    expect(
      scheduled,
      "DAY_TABLE 에서 naver-devplan 이 빠졌다 — 어느 스케줄에도 없던 편입 전으로 회귀",
    ).toBe(true);
    expect(
      monitored,
      "EXTERNAL_API_COLLECTORS 에서 naver-devplan 이 빠졌다 — 안 돌아도 알림 0",
    ).toBe(true);
  });
});

describe("크론(DAY_TABLE) ↔ 감시(EXTERNAL_API_COLLECTORS) 동기화 — lhzone-status (세션 522)", () => {
  // 세션 517 선례를 그대로 답습한다. 한쪽만 되돌리면 red 여야 한다 —
  // 크론만 지우면 "안 돌아도 아무도 모르는" 상태, 감시만 지우면 "돌다 멈춰도 조용한" 상태.
  const SCRIPT = "lhzone-status.mjs";
  const COLLECTOR = "lhzone-status";

  it("DAY_TABLE 매월 21일에 lhzone-status 가 있다", () => {
    const rows = DAY_TABLE.filter((e) => e.script === SCRIPT);
    expect(rows.map((e) => e.day), "매월 21일 1회여야 한다").toEqual([21]);
  });

  it("같은 수집기가 monitor ⑤ 에 월간(38) 신선도로 등재돼 있다", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === COLLECTOR);
    expect(entry, `${COLLECTOR} 가 EXTERNAL_API_COLLECTORS 에 없다 — 크론만 있고 감시가 없다`).toBeTruthy();
    expect(entry?.stale_days, "월간(매월 21일) = 31일 + 여유 1주").toBe(38);
  });

  it("크론과 감시가 한 쌍으로 존재한다 (한쪽만 되돌리면 red)", () => {
    expect(
      DAY_TABLE.some((e) => e.script === SCRIPT),
      "DAY_TABLE 에서 lhzone-status 가 빠졌다 — 어느 스케줄에도 없던 편입 전으로 회귀",
    ).toBe(true);
    expect(
      EXTERNAL_API_COLLECTORS.some((c) => c.collector === COLLECTOR),
      "EXTERNAL_API_COLLECTORS 에서 lhzone-status 가 빠졌다 — 안 돌아도 알림 0",
    ).toBe(true);
  });
});

describe("크론(DAY_TABLE) ↔ 감시(EXTERNAL_API_COLLECTORS) 동기화 — emergency (세션 525)", () => {
  // 세션 517·522 선례를 그대로 답습한다. 한쪽만 되돌리면 red 여야 한다 —
  // 크론만 지우면 "안 돌아도 아무도 모르는" 상태, 감시만 지우면 "돌다 멈춰도 조용한" 상태.
  // ⚠️ 스크립트 파일명(collect-emergency.mjs)과 기록 라벨(emergency)이 다르다.
  //    라벨의 진실의 원천은 recordCollectorRun 첫 인자 = PHASE 상수다(세션 439 드리프트 사고).
  const SCRIPT = "collect-emergency.mjs";
  const COLLECTOR = "emergency";

  it("DAY_TABLE 매월 3일에 emergency 가 있다 (옛 cron `0 16 2 * *` = UTC 2일 → KST 3일)", () => {
    const rows = DAY_TABLE.filter((e) => e.script === SCRIPT);
    expect(rows.map((e) => e.day), "매월 3일 1회여야 한다").toEqual([3]);
  });

  it("같은 수집기가 monitor ⑤ 에 월간(38) 신선도로 등재돼 있다", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === COLLECTOR);
    expect(entry, `${COLLECTOR} 가 EXTERNAL_API_COLLECTORS 에 없다 — 크론만 있고 감시가 없다`).toBeTruthy();
    expect(entry?.stale_days, "월간(매월 3일) = 31일 + 여유 1주").toBe(38);
  });

  it("크론과 감시가 한 쌍으로 존재한다 (한쪽만 되돌리면 red)", () => {
    expect(
      DAY_TABLE.some((e) => e.script === SCRIPT),
      "DAY_TABLE 에서 emergency 가 빠졌다 — GH yml 을 지웠으므로 아예 안 도는 상태로 회귀",
    ).toBe(true);
    expect(
      EXTERNAL_API_COLLECTORS.some((c) => c.collector === COLLECTOR),
      "EXTERNAL_API_COLLECTORS 에서 emergency 가 빠졌다 — 안 돌아도 알림 0",
    ).toBe(true);
  });
});

describe("크론(DAY_TABLE) ↔ 감시(EXTERNAL_API_COLLECTORS) 동기화 — population 2종 (세션 550)", () => {
  // 세션 517·522·525 선례 답습. 한쪽만 되돌리면 red 여야 한다 —
  // 크론만 지우면 "안 돌아도 아무도 모르는" 상태, 감시만 지우면 "돌다 멈춰도 조용한" 상태.
  // ⚠️ 이 건은 **한 yml 이 두 수집기를 돌렸다**. 둘 다 자기 collector_runs 행을 남기므로
  //    (population.mjs:731 / population-sex-age.mjs:311) 크론·감시 모두 2건이어야 한다.
  //    하나만 챙기면 나머지가 조용히 죽는다.
  const PAIRS = [
    { script: "population.mjs", collector: "population" },
    { script: "population-sex-age.mjs", collector: "population-sex-age" },
  ];

  for (const { script, collector } of PAIRS) {
    it(`DAY_TABLE 매월 5일에 ${script} 가 있다 (옛 cron \`0 20 5 * *\` = KST 6일이지만 행 생성자라 하루 앞)`, () => {
      const rows = DAY_TABLE.filter((e) => e.script === script);
      expect(rows.map((e) => e.day), "매월 5일 1회여야 한다").toEqual([5]);
      expect(rows[0]?.args, "옛 GH yml 은 dry_run 입력 외 고정 인자를 넘기지 않았다").toBeUndefined();
    });

    it(`${collector} 가 monitor ⑤ 에 월간(38) 신선도로 등재돼 있다`, () => {
      const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === collector);
      expect(entry, `${collector} 가 EXTERNAL_API_COLLECTORS 에 없다 — 크론만 있고 감시가 없다`).toBeTruthy();
      expect(entry?.stale_days, "월간(매월 5일) = 31일 + 여유 1주").toBe(38);
    });

    it(`${collector} 는 크론과 감시가 한 쌍으로 존재한다 (한쪽만 되돌리면 red)`, () => {
      expect(
        DAY_TABLE.some((e) => e.script === script),
        `DAY_TABLE 에서 ${script} 가 빠졌다 — GH yml 을 지웠으므로 아예 안 도는 상태로 회귀`,
      ).toBe(true);
      expect(
        EXTERNAL_API_COLLECTORS.some((c) => c.collector === collector),
        `EXTERNAL_API_COLLECTORS 에서 ${collector} 가 빠졌다 — 안 돌아도 알림 0`,
      ).toBe(true);
    });
  }
});

describe("checkTradeMonthGaps — ⑧ 지역×월 거래 0건 (세션556)", () => {
  /**
   * 한 지역의 월별 건수를 trades 행 배열로 편다.
   * @param {string} region
   * @param {Record<string, number>} byMonth
   */
  const rows = (region, byMonth) =>
    Object.entries(byMonth).flatMap(([m, n]) =>
      Array(n).fill(0).map(() => ({ region, deal_month: m })),
    );
  /** 검사 대상이 되려면 마지막 달 하나가 더 필요하다(마지막 달은 제외되므로). */
  const MONTHS = ["202601", "202602", "202603", "202604", "202605", "202606"];

  it("직전 3개월 평균이 충분한데 0건이면 경보", () => {
    // 202605 만 0건 — 202606 은 '마지막 달' 이라 검사 대상 밖
    const issues = checkTradeMonthGaps([
      ...rows("전남", { 202601: 100, 202602: 100, 202603: 100, 202604: 100, 202606: 100 }),
      ...rows("서울", { 202601: 500, 202602: 500, 202603: 500, 202604: 500, 202605: 500, 202606: 500 }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toContain("전남");
    expect(issues[0].collector).toContain("202605");
    expect(issues[0].collector).not.toContain("서울");
  });

  // ⚠️ 뮤테이션 대상 — `months.slice(0, -1)` 을 `months` 로 바꾸면 red.
  //    실거래가는 신고 기한이 있어 **가장 최근 달은 아직 차오르는 중**이다. 세션556 실측:
  //    서울 202607 13,715건 → 202608 8,777건. 마지막 달을 검사하면 매달 거짓 경보가 난다.
  it("가장 최근 달은 검사하지 않는다 (아직 차오르는 중)", () => {
    const issues = checkTradeMonthGaps(
      rows("전남", { 202601: 100, 202602: 100, 202603: 100, 202604: 100, 202605: 100 }).concat(
        // 202606 이 아예 없다 = 마지막 달이 0건인 상황
        rows("서울", { 202601: 1, 202602: 1, 202603: 1, 202604: 1, 202605: 1, 202606: 1 }),
      ),
    );
    expect(issues).toHaveLength(0);
  });

  // ⚠️ 뮤테이션 대상 — minBaseline 검사를 지우면 red.
  it("원래 거래가 드문 곳은 넘어간다", () => {
    const issues = checkTradeMonthGaps([
      ...rows("제주", { 202601: 2, 202602: 3, 202603: 2, 202606: 3 }), // 평균 2.3 < 10
      ...rows("서울", { 202601: 500, 202602: 500, 202603: 500, 202604: 500, 202605: 500, 202606: 500 }),
    ]);
    expect(issues).toHaveLength(0);
  });

  // ⚠️ 뮤테이션 대상 — 연속 접기(run/flush)를 지우면 지역당 달마다 1건씩 나와 red.
  it("연속 0건은 경보 하나로 접는다 (전남 3개월 사고 재현)", () => {
    const issues = checkTradeMonthGaps([
      // 202604·05 연속 0건 (202606 은 마지막 달이라 제외)
      ...rows("전남", { 202601: 200, 202602: 200, 202603: 200, 202606: 200 }),
      ...rows("서울", { 202601: 500, 202602: 500, 202603: 500, 202604: 500, 202605: 500, 202606: 500 }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].collector).toContain("202604/202605");
    expect(issues[0].detail).toContain("2개월");
  });

  it("정상 격자에서는 조용하다", () => {
    const issues = checkTradeMonthGaps(
      MONTHS.flatMap((m) => [...rows("서울", { [m]: 500 }), ...rows("전남", { [m]: 100 })]),
    );
    expect(issues).toHaveLength(0);
  });

  it("달이 lookback 보다 적으면 판정하지 않는다", () => {
    const issues = checkTradeMonthGaps(rows("서울", { 202601: 500, 202602: 500 }));
    expect(issues).toHaveLength(0);
  });

  it("region 이나 deal_month 가 비면 무시한다", () => {
    expect(() =>
      checkTradeMonthGaps([{ region: null, deal_month: "202601" }, { region: "서울", deal_month: null }, {}]),
    ).not.toThrow();
    expect(checkTradeMonthGaps([{ region: null, deal_month: null }])).toHaveLength(0);
  });

  it("경보에 조치 안내가 들어간다", () => {
    // ⚠️ 달 목록은 **전체 입력**에서 만들어지므로, 0건인 달(202605)을 다른 지역이 채워 줘야
    //    그 달이 격자에 존재한다. 전남만 넣으면 202605 가 아예 없는 달이 되어 검사 대상 밖이다.
    const issues = checkTradeMonthGaps([
      ...rows("전남", { 202601: 100, 202602: 100, 202603: 100, 202604: 100, 202606: 100 }),
      ...rows("서울", { 202601: 500, 202602: 500, 202603: 500, 202604: 500, 202605: 500, 202606: 500 }),
    ]);
    const text = (issues[0]?.lines ?? []).join("\n");
    expect(text).toContain("admin-district-code-reform");
    expect(text).toContain("백필");
    expect(issues[0].kind).toBe("nulls");
  });

  it("상수가 뜻대로다", () => {
    expect(TRADE_GAP_LOOKBACK).toBe(3);
    expect(TRADE_GAP_MIN_BASELINE).toBe(10);
  });
});

// ── ⑪ KOSIS 시도 이름 못 맞춤 (세션569) ──────────────────────
const { checkRegionUnresolved, REGION_UNRESOLVED_COLLECTORS } = await import("./monitor-collectors.mjs");
const { formatRegionUnresolved } = await import("./collectors/_shared.mjs");

describe("checkRegionUnresolved — ⑪ 시도 이름 못 맞춤 마커", () => {
  /** @param {string[]} names */
  const markerOf = (names) => formatRegionUnresolved({
    unmergeable: 0, unknown: names.length, unknownNames: names,
    unknownCounts: Object.fromEntries(names.map((n) => [n, 1])),
  });

  it("대상 이름 = 세 수집기의 recordCollectorRun 기록명(PHASE 상수) 그대로", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const phases = ["collect-market-stats.mjs", "collect-avg-income.mjs", "collect-housing-supply-ratio.mjs"].map((f) => {
      const m = readFileSync(join(here, "collectors", f), "utf8").match(/const PHASE = "([^"]+)"/);
      return m?.[1];
    });
    expect([...REGION_UNRESOLVED_COLLECTORS].sort()).toEqual(phases.sort());
  });

  it("최신 실행에 마커 있음 → 이슈 1건 (kind·collector·n·이름·at)", () => {
    const issues = checkRegionUnresolved({
      "market-stats": [{ error_message: markerOf(["광주전남"]), finished_at: "2026-10-05T20:30:00Z" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("region-unresolved");
    expect(issues[0].collector).toBe("market-stats");
    expect(issues[0].detail).toContain("1건");
    expect(issues[0].detail).toContain("광주전남");
    // at = dedup 지문(마커 해시 @ 구간 첫 실행 시각) — 실행 시각은 본문 줄로 옮겼다
    expect(issues[0].at).toMatch(/^[0-9a-f]{8}@2026-10-05T20:30:00Z$/);
    expect(issues[0].lines?.some((l) => l.startsWith("최근 실행:"))).toBe(true);
  });

  it("마커 없음(null·일반 실패 사유) → 0건", () => {
    expect(checkRegionUnresolved({
      "market-stats": [{ error_message: null, finished_at: "2026-10-05T20:30:00Z" }],
      "avg-income": [{ error_message: "KOSIS HTTP 500", finished_at: "2026-10-12T20:30:00Z" }],
      "kosis-housing-supply-ratio": [],
    })).toEqual([]);
  });

  it("옛 실행에만 마커가 있고 최신 실행은 깨끗 → 0건(고친 뒤에는 경보가 그친다)", () => {
    expect(checkRegionUnresolved({
      "market-stats": [
        { error_message: null, finished_at: "2026-11-05T20:30:00Z" },
        { error_message: markerOf(["광주전남"]), finished_at: "2026-10-05T20:30:00Z" },
      ],
    })).toEqual([]);
  });

  it("실패 사유 뒤에 붙은 마커도 읽는다", () => {
    const issues = checkRegionUnresolved({
      "avg-income": [{ error_message: `KOSIS HTTP 500 | ${markerOf(["광주전남"])}`, finished_at: "2026-10-12T20:30:00Z" }],
    });
    expect(issues).toHaveLength(1);
  });

  it("이름 6개 → 앞 5개 + '외 1건'", () => {
    const issues = checkRegionUnresolved({
      "kosis-housing-supply-ratio": [{ error_message: markerOf(["가", "나", "다", "라", "마", "바"]), finished_at: "2026-10-01T20:30:00Z" }],
    });
    expect(issues[0].detail).toContain("6건");
    expect(issues[0].detail).toContain("가, 나, 다, 라, 마 외 1건");
    expect(issues[0].detail).not.toContain("바");
  });

  it("텔레그램 문구에 제목·조치가 붙는다(새 kind 가 notify-telegram 에 등록됨)", async () => {
    const { formatIssue } = await import("./notify-telegram.mjs");
    const [issue] = checkRegionUnresolved({
      "market-stats": [{ error_message: markerOf(["광주전남"]), finished_at: "2026-10-05T20:30:00Z" }],
    });
    const text = formatIssue(/** @type {any} */ (issue));
    expect(text).toContain("시도 이름 못 맞춤");
    expect(text).not.toContain("undefined");
  });
});

// ── ⑪ dedup — ⑨ 와 같은 monitor_alert_state·dedupKey 재사용 (세션569) ──
const { dedupScope, isCleanRegionRun } = await import("./monitor-collectors.mjs");

describe("⑪ dedup — 지문 = 마커 해시 + 연속 구간 첫 실행 시각", () => {
  /** @param {string[]} names */
  const mk = (names) => formatRegionUnresolved({
    unmergeable: 0, unknown: names.length, unknownNames: names,
    unknownCounts: Object.fromEntries(names.map((n) => [n, 1])),
  });
  const A = mk(["광주전남"]);
  const B = mk(["광주전남", "알수없음"]);
  /** @param {string|null} msg @param {string} at @param {string} [status] */
  const run = (msg, at, status = "success") => ({ status, error_message: msg, finished_at: at });
  /** 하루치 감시: 알릴 것만 돌려주고, 알린 키를 sent 에 쌓는다(main 의 거르기·기록과 같은 dedupScope) */
  /** @param {Record<string, any[]>} runs @param {Set<string>} sent */
  const day = (runs, sent) => {
    const fresh = filterUnsent(dedupScope(checkRegionUnresolved(runs), "daily"), sent);
    for (const i of fresh) sent.add(dedupKey(i));
    return fresh;
  };

  it("같은 지문 → 다음 날 0건, 다음 달 n 만 늘어난 같은 이름 마커가 이어져도 0건", () => {
    // 실제 상황: market-stats 의 n = 지표 × 조회 창 기간 수라 라벨이 바뀐 뒤 매달 늘어난다(5 → 10)
    const oct = "REGION_UNRESOLVED n=5: 광주전남";
    const nov = "REGION_UNRESOLVED n=10: 광주전남";
    const sent = new Set();
    expect(day({ "market-stats": [run(oct, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(1);
    expect(day({ "market-stats": [run(oct, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(0);
    expect(day({ "market-stats": [run(nov, "2026-11-05T20:30:00Z"), run(oct, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(0);
  });

  it("같은 이름 집합이면 n·이름 순서가 달라도 같은 지문 → 0건", () => {
    const sent = new Set();
    day({ "market-stats": [run("REGION_UNRESOLVED n=2: 광주전남, 알수없음", "2026-10-05T20:30:00Z")] }, sent);
    expect(day({ "market-stats": [
      run("REGION_UNRESOLVED n=7: 알수없음, 광주전남", "2026-11-05T20:30:00Z"),
      run("REGION_UNRESOLVED n=2: 광주전남, 알수없음", "2026-10-05T20:30:00Z"),
    ] }, sent)).toHaveLength(0);
  });

  it("지문 변화(이름이 늘어남) → 1건", () => {
    const sent = new Set();
    day({ "market-stats": [run(A, "2026-10-05T20:30:00Z")] }, sent);
    expect(day({ "market-stats": [run(B, "2026-11-05T20:30:00Z"), run(A, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(1);
  });

  it("마커 사라짐 → 0건, 같은 마커가 다시 생김 → 1건(구간이 새로 시작)", () => {
    const sent = new Set();
    day({ "market-stats": [run(A, "2026-10-05T20:30:00Z")] }, sent);
    const clean = run(null, "2026-11-05T20:30:00Z");
    expect(day({ "market-stats": [clean, run(A, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(0);
    expect(day({ "market-stats": [run(A, "2026-12-05T20:30:00Z"), clean, run(A, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(1);
  });

  it("마커 없는 **실패** 실행은 구간을 끊지 않는다 → 같은 마커가 이어지면 0건", () => {
    const sent = new Set();
    day({ "market-stats": [run(A, "2026-10-05T20:30:00Z")] }, sent);
    const failed = run("KOSIS HTTP 500", "2026-11-05T20:30:00Z", "failure");
    expect(day({ "market-stats": [run(A, "2026-12-05T20:30:00Z"), failed, run(A, "2026-10-05T20:30:00Z")] }, sent)).toHaveLength(0);
  });

  it("깨끗한 실행 = 마커 없는 success 1회", () => {
    expect(isCleanRegionRun(run(null, "t"))).toBe(true);
    expect(isCleanRegionRun(run(A, "t"))).toBe(false);
    expect(isCleanRegionRun(run("KOSIS HTTP 500", "t", "failure"))).toBe(false);
    expect(isCleanRegionRun(run(`KOSIS HTTP 500 | ${A}`, "t", "failure"))).toBe(false);
  });
});

describe("dedupScope — daily 에서 기록·거르는 대상은 ⑨·⑪ 뿐", () => {
  /** @param {string} kind @param {string} collector */
  const iss = (kind, collector) => /** @type {any} */ ({ kind, collector, detail: "d", at: "x" });
  const others = [
    iss("fail", "School District Collection"), iss("empty", "molit-units"), iss("stale", "market-stats"),
    iss("outage", "housing-permits"), iss("nulls", "교통 (transport-tago)"), iss("nulls", "db-permissions"),
  ];
  const coord = iss("nulls", "coord-shared");
  const region = iss("region-unresolved", "market-stats");

  it("daily: ①~⑧·⑩ 이슈는 dedup 대상이 아니다(기록 안 됨·매일 리마인드 유지), ⑨·⑪ 만", () => {
    expect(dedupScope([...others, coord, region], "daily")).toEqual([coord, region]);
    expect(dedupScope(others, "daily")).toEqual([]);
  });

  it("run: 전부(기존 동작 그대로)", () => {
    expect(dedupScope([...others, coord, region], "run")).toHaveLength(8);
  });

  it("main 은 발송 뒤 dedupScope 로 기록한다 — run 모드 한정 기록으로 되돌아가면 ⑨·⑪ dedup 이 죽는다(정적 가드)", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "monitor-collectors.mjs"), "utf8");
    expect(src).toContain("if (anySent) await recordSentAlerts(dedupScope(issues, mode));");
    expect(src).not.toMatch(/mode === "run" && anySent/);
  });

  it("⑨ coord-shared: daily 에서도 같은 지문은 다음 날 침묵(세션569 전엔 키가 기록 안 돼 매일 울렸다)", () => {
    const sent = new Set(dedupScope([coord], "daily").map(dedupKey));
    expect(filterUnsent(dedupScope([coord], "daily"), sent)).toHaveLength(0);
  });
});

describe("checkExternalApiStale — ⑤ 등재일(since) 뒤 행 0 경보 (세션571)", () => {
  const target = [{ collector: "naver-pipeline", stale_days: 4, since: "2026-09-25", owner: "네이버 로컬 파이프라인" }];

  it("since 뒤 stale_days 초과 + 행 0 → stale 1건 (9/29 09:48 KST = 4.41일)", () => {
    const issues = checkExternalApiStale(target, {}, new Date("2026-09-29T00:48:00Z"));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].collector).toBe("naver-pipeline");
    expect(issues[0].detail).toContain("행 0");
    expect(issues[0].detail).toContain("등재(2026-09-25)");
    expect(issues[0].at).toBe(new Date("2026-09-25T00:00:00+09:00").toISOString());
    const lines = issues[0].lines?.join("\n") ?? "";
    expect(lines).toContain("record-pipeline-run.mjs 호출");
    expect(lines).toContain("MibunyangNaverCollect"); // 기존 naver- 조치 줄 그대로
  });

  it("since 뒤 stale_days 이하(9/28 09:48 KST = 3.41일) → 0건 — 첫 정기 실행 당일 아침 오탐 없음", () => {
    expect(checkExternalApiStale(target, { "naver-pipeline": [] }, new Date("2026-09-28T00:48:00Z"))).toHaveLength(0);
  });

  it("since 없는 항목 + 행 0 → 종전대로 0건 (회귀)", () => {
    const noSince = [{ collector: "housing-permits", stale_days: 14, owner: "MOLIT" }];
    expect(checkExternalApiStale(noSince, {}, new Date("2027-01-01T00:00:00Z"))).toHaveLength(0);
  });

  it("행이 1개라도 있으면 since 무관하게 기존 ⑤-b 판정 (최신 행 기준)", () => {
    const runs = { "naver-pipeline": [{ status: "success", ok_count: 6, skip_count: 0, finished_at: "2026-09-28T03:00:00Z" }] };
    expect(checkExternalApiStale(target, runs, new Date("2026-10-02T00:00:00Z"))).toHaveLength(0);
    const sat = checkExternalApiStale(target, runs, new Date("2026-10-03T00:00:00Z"));
    expect(sat).toHaveLength(1);
    expect(sat[0].detail).toContain("마지막 실행");
  });

  it("운영 목록의 naver-pipeline 은 since 2026-09-25 로 등재돼 있다", () => {
    expect(EXTERNAL_API_COLLECTORS.find((c) => c.collector === "naver-pipeline")?.since).toBe("2026-09-25");
  });

  // 🟢2 — 경계 미고정(days <= stale_days 를 < 로 바꿔도 통과하던 구멍)을 리터럴 시각으로 못 박는다.
  it("since + 정확히 4.00일 → 0건 (경계는 초과만 울린다)", () => {
    expect(checkExternalApiStale(target, {}, new Date("2026-09-28T15:00:00Z"))).toHaveLength(0);
  });

  it("since + 4.00일 + 1ms → 1건", () => {
    expect(checkExternalApiStale(target, {}, new Date("2026-09-28T15:00:00.001Z"))).toHaveLength(1);
  });

  // B3 — 조회 실패는 "등재 뒤 행 0" 으로 판정하지 않는다(세션571 검사관 🟡1)
  it("queryFailed 에 있는 collector 는 since 뒤 stale_days 초과+행 0 이어도 0건 (조회 실패는 별도 check-failed 가 알린다)", () => {
    expect(
      checkExternalApiStale(target, {}, new Date("2026-09-29T00:48:00Z"), {
        queryFailed: new Set(["naver-pipeline"]),
      }),
    ).toHaveLength(0);
  });
});

describe("fetchExternalApiRuns/호출부 — ⑤ collector_runs 조회 실패를 check-failed 로 알린다 (세션571, 정적 가드)", () => {
  it("fetchExternalApiRuns 는 error 를 받아 failed 에 기록하고, 호출부는 그걸 checkFailedIssue 로 push 한다", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "monitor-collectors.mjs"), "utf8");
    expect(src).toContain("failed.set(name, error);");
    expect(src).toContain("queryFailed: new Set(queryFailed.keys())");
    expect(src).toMatch(/issues\.push\(checkFailedIssue\(`⑤/);
  });
});
