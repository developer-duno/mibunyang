// @ts-check
/**
 * 감시 ㉓ checkSeoThin 시험 — 얇은 단지 검색 제외 안전선(세션668 PR-S1).
 *
 * 왜: postbuild-prerender 는 얇은 단지가 안전선(15)을 넘으면 그날 noindex 를 하나도 안 단다(수집 사고 하루에
 *   수백 장이 검색에서 빠지는 것을 막는 장치). 그날은 빌드가 초록이라 아무도 모른다 → 운영 기록 파일을 매일 본다.
 *   운영은 vercel.json catch-all rewrite 때문에 없는 파일도 200 + index.html 을 준다 → 상태 코드만으로 정상 판정 금지.
 * 보완(세션668 검사 뒤): F1 알림에 단지 명단 · F2 names 칸·아침 브리핑 한 줄(결정 35) · F4 내부 일관성.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkSeoThin, parseSeoThin, fetchSeoThinLive, loadSeoThinForBriefing, runDailyGuardedChecks, SEO_THIN_URL, isAlwaysDedup,
  checkSeoThinBuiltAt, fetchLatestDailyRefresh, BUILT_AT_GRACE_MIN, GithubAuthMissingError,
} from "./monitor-collectors.mjs";
import { buildBriefing, seoThinBriefLine } from "./monitor-briefing.mjs";
import { formatIssue } from "./notify-telegram.mjs";

const IDS5 = ["ap-6025745", "ap-6027214", "ap-6028737", "ap-6028739", "ap-6028740"];
/** @param {number} n */
const nameList = (n) => Array.from({ length: n }, (_, i) => `단지${i + 1}`);
/** @param {number} n */
const idList = (n) => Array.from({ length: n }, (_, i) => `ap-${i + 1}`);
const OK_BODY = JSON.stringify({ count: 5, ids: IDS5, names: nameList(5), applied: true, cap: 15 });
/** 세션697 새 칸이 든 기록 — 커밋 03:04 KST(18:04Z) 뒤 03:09 KST 에 빌드 */
const NEW_BODY = JSON.stringify({ count: 5, ids: IDS5, names: nameList(5), applied: true, cap: 15, bodyErrors: 0, bodyErrorIds: [], builtAt: "2026-11-05T18:09:00.000Z" });
const REFRESH = { at: "2026-11-05T18:04:00Z", sha: "0123456789abcdef0123" };
/** 감시 정기 시각 KST 09:00 = 커밋 6시간 뒤(유예 60분 밖) */
const NOW_0900 = new Date("2026-11-06T00:00:00Z");

describe("C7 parseSeoThin 새 칸(세션697) — 옛 기록도 정상, 틀린 새 칸은 그 칸만 무시 + 경고", () => {
  it("옛 기록(새 칸 없음) → ok · 경고 0 · 새 칸 없음", () => {
    const p = parseSeoThin(200, OK_BODY);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.warnings).toEqual([]);
    expect(Object.keys(p.rec)).toEqual(["count", "ids", "names", "applied", "cap"]);
  });
  it("새 기록 → 새 칸 3개를 읽는다", () => {
    const p = parseSeoThin(200, JSON.stringify({ ...JSON.parse(NEW_BODY), bodyErrors: 3, bodyErrorIds: ["a", 7] }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.rec).toMatchObject({ bodyErrors: 3, bodyErrorIds: ["a", "7"], builtAt: "2026-11-05T18:09:00.000Z" });
    expect(p.warnings).toEqual([]);
  });
  it("새 칸 모양이 틀리면 그 칸만 빼고 경고 — 기록 자체는 ok(모양 알림 없음)", () => {
    const probes = [
      [{ bodyErrors: -1 }, "bodyErrors"], [{ bodyErrors: "3" }, "bodyErrors"], [{ bodyErrors: 1.5 }, "bodyErrors"],
      [{ bodyErrorIds: "ap-1" }, "bodyErrorIds"], [{ builtAt: "어제" }, "builtAt"], [{ builtAt: 1730851740000 }, "builtAt"], [{ builtAt: "2026" }, "builtAt"],
    ];
    for (const [extra, field] of probes) {
      const p = parseSeoThin(200, JSON.stringify({ ...JSON.parse(OK_BODY), ...(/** @type {object} */ (extra)) }));
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(p.warnings).toHaveLength(1);
      expect(p.warnings[0]).toContain(/** @type {string} */ (field));
      expect(/** @type {any} */ (p.rec)[/** @type {string} */ (field)]).toBeUndefined();
      expect(checkSeoThin(200, JSON.stringify({ ...JSON.parse(OK_BODY), ...(/** @type {object} */ (extra)) }))).toEqual([]);
    }
  });
  it("아침 브리핑 — 새 기록도 읽는다", async () => {
    expect(await loadSeoThinForBriefing(async () => ({ status: 200, text: NEW_BODY }))).toMatchObject({ count: 5, applied: true, builtAt: "2026-11-05T18:09:00.000Z" });
  });
});

describe("C5 checkSeoThin bodyErrors(세션697) — 0 이면 조용, 넘으면 1건(명단)", () => {
  /** @param {Record<string, any>} o */
  const body = (o) => JSON.stringify({ ...JSON.parse(NEW_BODY), ...o });
  it("bodyErrors 0 → []", () => {
    expect(checkSeoThin(200, NEW_BODY)).toEqual([]);
  });
  it("B4: bodyErrors 1 → 1건(> 0 경계 — 실전에서 가장 흔한 수)", () => {
    const issues = checkSeoThin(200, body({ bodyErrors: 1, bodyErrorIds: ["ap-1"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("seo-body-error");
    expect(issues[0].lines?.[0]).toBe("명단: ap-1");
  });
  it("bodyErrors 3 → 1건 · 수 · 명단 · kind = seo-body-error(얇은 단지 안전선과 다른 갈래 · B6)", () => {
    const issues = checkSeoThin(200, body({ bodyErrors: 3, bodyErrorIds: ["ap-1", "ap-2", "ap-3"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "seo-body-error", collector: "postbuild-prerender" });
    expect(issues[0].detail).toBe("단지 장 본문 실패 3곳 — 그 장만 얇은 본문(h1·요약 한 줄 · 검색 제외)으로 배포됨");
    expect(issues[0].lines?.[0]).toBe("명단: ap-1 · ap-2 · ap-3");
  });
  it("bodyErrors 25 · id 20개 → \"외 5곳\"", () => {
    const issues = checkSeoThin(200, body({ bodyErrors: 25, bodyErrorIds: idList(20) }));
    expect(issues[0].lines?.[0].endsWith(" 외 5곳")).toBe(true);
  });
  it("applied:false + bodyErrors 2 → 2건(각자)", () => {
    const issues = checkSeoThin(200, body({ count: 40, ids: idList(40), names: nameList(40), applied: false, bodyErrors: 2, bodyErrorIds: ["x", "y"] }));
    expect(issues).toHaveLength(2);
    expect(issues[0].kind).toBe("seo-thin");
    expect(issues[0].detail).toContain("안전선");
    expect(issues[1].kind).toBe("seo-body-error");
    expect(issues[1].detail).toContain("본문 실패 2곳");
  });
});

describe("B6 텔레그램 — 갈래별 제목·조치(본문 실패·builtAt 이 「얇은 단지 안전선」으로 나가지 않게)", () => {
  it("본문 실패 → 제목 「단지 장 본문 실패」 · 조치 = 빌드 로그 '단지 장 본문 실패' 줄 · 안전선 제목 아님", () => {
    const text = formatIssue(checkSeoThin(200, JSON.stringify({ ...JSON.parse(NEW_BODY), bodyErrors: 1, bodyErrorIds: ["ap-1"] }))[0]);
    expect(text).toContain("<b>단지 장 본문 실패(얇은 본문으로 나감)</b>");
    expect(text).not.toContain("얇은 단지 검색 제외 안전선");
    expect(text).toContain("[조치] Vercel 배포 빌드 로그(Deployments → 그 배포 → Build Logs)의 '[postbuild-prerender] 단지 장 본문 실패' 줄");
    expect(text).toContain("15곳을 넘으면 빌드가 멈춰");
    expect(text.includes("undefined")).toBe(false);
  });
  it("builtAt → 제목 「오늘 화면 자료가 배포에 안 실림」 · 조치 = daily refresh 배포·Instant Rollback 확인", () => {
    const issue = checkSeoThinBuiltAt({ count: 0, ids: [], names: [], applied: true, cap: 15 }, null)[0];
    const text = formatIssue(issue);
    expect(text).toContain("<b>오늘 화면 자료가 배포에 안 실림</b>");
    expect(text).not.toContain("얇은 단지 검색 제외 안전선");
    expect(text).toContain("[조치] Vercel Deployments 에서 그날 'data: daily refresh' 커밋의 배포가 실패했는지");
    expect(text).toContain("Instant Rollback");
    expect(text.includes("undefined")).toBe(false);
  });
});

describe("C6 checkSeoThinBuiltAt(세션697) — builtAt ≥ main 마지막 daily refresh 커밋 시각", () => {
  /** @param {string | undefined} builtAt */
  const rec = (builtAt) => ({ count: 0, ids: [], names: [], applied: true, cap: 15, ...(builtAt === undefined ? {} : { builtAt }) });
  it("커밋 03:04 · builtAt 03:09 → 조용", () => {
    expect(checkSeoThinBuiltAt(rec("2026-11-05T18:09:00.000Z"), REFRESH, NOW_0900)).toEqual([]);
  });
  it("같은 시각 → 조용(경계)", () => {
    expect(checkSeoThinBuiltAt(rec("2026-11-05T18:04:00.000Z"), REFRESH, NOW_0900)).toEqual([]);
  });
  it("builtAt 전날 → 1건 · kind seo-built-at · 두 시각·커밋 앞 8글자", () => {
    const issues = checkSeoThinBuiltAt(rec("2026-11-04T18:09:00.000Z"), REFRESH, NOW_0900);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("seo-built-at");
    expect(issues[0].detail).toBe("오늘 화면 자료 커밋이 배포에 안 실림 — 빌드 실패·롤백 고착 의심");
    expect(issues[0].lines?.[0]).toBe("운영 빌드 시각 2026-11-04T18:09:00.000Z < main 마지막 daily refresh 커밋 2026-11-05T18:04:00Z (01234567)");
  });
  it("1초 이르면 1건(경계)", () => {
    expect(checkSeoThinBuiltAt(rec("2026-11-05T18:03:59.000Z"), REFRESH, NOW_0900)).toHaveLength(1);
  });
  it("builtAt 없음 → 1건(GitHub 조회 못 했어도 · 유예 안이어도)", () => {
    expect(checkSeoThinBuiltAt(rec(undefined), null)).toHaveLength(1);
    expect(checkSeoThinBuiltAt(rec(undefined), REFRESH, new Date("2026-11-05T18:05:00Z"))[0].detail).toContain("builtAt");
  });
  it("커밋 시각 모름(null) → 비교 건너뜀", () => {
    expect(checkSeoThinBuiltAt(rec("2020-01-01T00:00:00.000Z"), null, NOW_0900)).toEqual([]);
  });
  it("B8 유예 — 커밋 뒤 59분이면 비교 건너뜀 · 60분이면 비교(빌드 도중 헛경보 방지)", () => {
    expect(BUILT_AT_GRACE_MIN).toBe(60);
    const old = rec("2026-11-04T18:09:00.000Z");
    expect(checkSeoThinBuiltAt(old, REFRESH, new Date("2026-11-05T19:03:00Z"))).toEqual([]);
    expect(checkSeoThinBuiltAt(old, REFRESH, new Date("2026-11-05T19:04:00Z"))).toHaveLength(1);
  });
});

describe("C6 fetchLatestDailyRefresh — 가짜 GitHub 응답으로", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("인증이 없으면 던진다(㉓ 가 잡아 비교만 건너뜀) · 호출 0", async () => {
    vi.stubEnv("GITHUB_REPOSITORY", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    let n = 0;
    vi.stubGlobal("fetch", async () => { n++; return { ok: true, json: async () => [] }; });
    await expect(fetchLatestDailyRefresh()).rejects.toBeInstanceOf(GithubAuthMissingError);
    expect(n).toBe(0);
  });
  it("main·public/data 커밋을 1회 조회해 가장 최근 daily refresh 를 고른다(다른 커밋은 건너뜀)", async () => {
    vi.stubEnv("GITHUB_REPOSITORY", "o/r");
    vi.stubEnv("GITHUB_TOKEN", "t");
    /** @type {any[]} */
    const calls = [];
    vi.stubGlobal("fetch", async (/** @type {string} */ url, /** @type {any} */ init) => {
      calls.push([url, init]);
      return {
        ok: true,
        json: async () => [
          { sha: "aaa", commit: { message: "fix: 손으로 고친 자료", committer: { date: "2026-11-05T20:00:00Z" } } },
          { sha: "bbb", commit: { message: "data: daily refresh 2026-11-05 (auto)", committer: { date: "2026-11-05T18:04:00Z" } } },
          { sha: "ccc", commit: { message: "data: daily refresh 2026-11-04 (auto)", committer: { date: "2026-11-04T18:04:00Z" } } },
        ],
      };
    });
    expect(await fetchLatestDailyRefresh()).toEqual({ at: "2026-11-05T18:04:00Z", sha: "bbb" });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("https://api.github.com/repos/o/r/commits?sha=main&path=public/data&per_page=30");
    expect(calls[0][1].headers.Authorization).toBe("Bearer t");
  });
  it("daily refresh 가 없으면 null · 응답이 실패면 던진다", async () => {
    vi.stubEnv("GITHUB_REPOSITORY", "o/r");
    vi.stubEnv("GITHUB_TOKEN", "t");
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => [{ sha: "a", commit: { message: "chore", committer: { date: "2026-11-05T18:04:00Z" } } }] }));
    expect(await fetchLatestDailyRefresh()).toBeNull();
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await expect(fetchLatestDailyRefresh()).rejects.toThrow(/403/);
  });
});

describe("㉓ checkSeoThin — 정상은 JSON·모양·일관성·applied:true 일 때만", () => {
  it("정상 JSON → []", () => {
    expect(checkSeoThin(200, OK_BODY)).toEqual([]);
  });
  it("얇은 0곳(applied:true, ids·names 빈 배열) → []", () => {
    expect(checkSeoThin(200, JSON.stringify({ count: 0, ids: [], names: [], applied: true, cap: 15 }))).toEqual([]);
  });
  it("200 + HTML(rewrite 로 온 index.html) → 1건 · HTML 이라고 적는다", () => {
    const issues = checkSeoThin(200, "<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "seo-thin", collector: "postbuild-prerender" });
    expect(issues[0].detail).toContain("HTML");
  });
  it("파싱 실패(잘린 JSON) → 1건", () => {
    const issues = checkSeoThin(200, '{"count":5,"ids":[');
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("파싱 실패");
  });
  it("applied:false → 1건 · 수·안전선·수집 사고 의심", () => {
    const issues = checkSeoThin(200, JSON.stringify({ count: 40, ids: idList(40), names: nameList(40), applied: false, cap: 15 }));
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toBe("얇은 단지 40곳 > 안전선 15 — 오늘은 검색 제외를 하나도 적용 안 함, 수집 사고 의심");
  });
  it("F1: applied:false + ids 25개 → lines 에 명단 20개 + \"외 5곳\"", () => {
    const issues = checkSeoThin(200, JSON.stringify({ count: 25, ids: idList(25), names: nameList(25), applied: false, cap: 15 }));
    const list = /** @type {string[]} */ (issues[0].lines).find((l) => l.startsWith("명단")) ?? "";
    expect(list.startsWith("명단 25곳: ap-1 단지1 · ap-2 단지2")).toBe(true);
    expect(list.split(" · ")).toHaveLength(20);
    expect(list).toContain("ap-20 단지20");
    expect(list).not.toContain("ap-21");
    expect(list.endsWith(" 외 5곳")).toBe(true);
  });
  it("모양 틀림 → 1건씩(ids 없음 · names 없음 · names 길이 다름 · count 소수 · applied 글자 · cap 없음 · 배열 · null)", () => {
    const bad = [
      { count: 5, names: nameList(5), applied: true, cap: 15 },
      { count: 5, ids: IDS5, applied: true, cap: 15 },
      { count: 5, ids: IDS5, names: nameList(4), applied: true, cap: 15 },
      { count: 5.5, ids: IDS5, names: nameList(5), applied: true, cap: 15 },
      { count: 5, ids: IDS5, names: nameList(5), applied: "true", cap: 15 },
      { count: 5, ids: IDS5, names: nameList(5), applied: true },
      [],
      null,
    ];
    for (const b of bad) {
      const issues = checkSeoThin(200, JSON.stringify(b));
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain("모양");
    }
  });
  it("F4: 숫자가 서로 어긋나면 1건씩(applied:true+40/15 · count 999+ids 1 · count −1 · cap 0)", () => {
    const probes = [
      { count: 40, ids: idList(40), names: nameList(40), applied: true, cap: 15 },
      { count: 999, ids: idList(1), names: nameList(1), applied: false, cap: 15 },
      { count: -1, ids: [], names: [], applied: true, cap: 15 },
      { count: 0, ids: [], names: [], applied: true, cap: 0 },
    ];
    for (const b of probes) {
      const issues = checkSeoThin(200, JSON.stringify(b));
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain("숫자가 서로 안 맞음");
    }
  });
  it("200 이 아니면(정상 본문이어도) → 1건 — 상태 코드 확인도 한다", () => {
    expect(checkSeoThin(404, OK_BODY)).toHaveLength(1);
    expect(checkSeoThin(500, OK_BODY)[0].detail).toContain("500");
  });
});

describe("㉓ 경보 글 · dedup", () => {
  it("텔레그램 글 — 제목·상세·명단·주소·조치(Vercel 배포 빌드 로그)", () => {
    const text = formatIssue(checkSeoThin(200, JSON.stringify({ count: 40, ids: idList(40), names: nameList(40), applied: false, cap: 15 }))[0]);
    expect(text).toContain("얇은 단지 검색 제외 안전선");
    expect(text).toContain("안전선 15");
    expect(text).toContain("명단 40곳: ap-1 단지1");
    expect(text).toContain(SEO_THIN_URL);
    expect(text).toContain("Vercel 배포 빌드 로그(Deployments → 그 배포 → Build Logs)의 '[postbuild-prerender] 얇은 단지' 줄");
    expect(text).not.toContain("daily-deploy");
    expect(text.startsWith("undefined")).toBe(false);
  });
  it("daily 에서 dedup 하지 않는다(🟡 후속 — 고칠 때까지 매일)", () => {
    expect(isAlwaysDedup(checkSeoThin(200, "x")[0])).toBe(false);
  });
});

describe("㉓ 운영 조회 함수(fetchSeoThinLive) — 가짜 fetch 로", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("운영 주소를 20초 제한 신호로 GET 하고 상태·본문 글자를 그대로 넘긴다", async () => {
    /** @type {any[]} */
    const calls = [];
    vi.stubGlobal("fetch", async (/** @type {string} */ url, /** @type {any} */ init) => {
      calls.push([url, init]);
      return { status: 200, text: async () => OK_BODY };
    });
    const r = await fetchSeoThinLive();
    expect(r).toEqual({ status: 200, text: OK_BODY });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("https://www.xn--hg3bi2ac4o1ig57cnoa.com/data/seo-thin.json");
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(checkSeoThin(r.status, r.text)).toEqual([]);
  });
});

describe("아침 브리핑 한 줄(결정 35) — 경보 아님", () => {
  /** @param {any} rec */
  const brief = (rec) => buildBriefing({ runs24h: [], idempotentCollectors: new Set(), seoThin: rec });
  it("applied:true 5곳 → 이름 5개", () => {
    const p = parseSeoThin(200, OK_BODY);
    expect(p.ok).toBe(true);
    expect(brief(p.ok ? p.rec : null)).toContain("🔎 검색 제외 5곳: 단지1 · 단지2 · 단지3 · 단지4 · 단지5");
  });
  it("이름 12개 → 10개 + \"외 2곳\"", () => {
    const line = seoThinBriefLine({ count: 12, ids: idList(12), names: nameList(12), applied: true, cap: 15 });
    expect(line).toBe(`🔎 검색 제외 12곳: ${nameList(10).join(" · ")} 외 2곳`);
  });
  it("0곳 → \"🔎 검색 제외 0곳\"", () => {
    expect(brief({ count: 0, ids: [], names: [], applied: true, cap: 15 })).toContain("🔎 검색 제외 0곳");
  });
  it("applied:false → 미적용 + 수·안전선", () => {
    expect(brief({ count: 40, ids: idList(40), names: nameList(40), applied: false, cap: 15 })).toContain("🔎 검색 제외 미적용 — 얇은 단지 40곳 > 안전선 15");
  });
  it("못 읽음(null) → \"확인 못 함\"", () => {
    expect(brief(null)).toContain("🔎 검색 제외: 확인 못 함");
  });
  it("이름의 & < > 는 텔레그램 HTML 로 깨지지 않게 바꾼다", () => {
    expect(seoThinBriefLine({ count: 1, ids: ["x"], names: ["A<b>&"], applied: true, cap: 15 })).toBe("🔎 검색 제외 1곳: A&lt;b&gt;&amp;");
  });
  it("seoThin 을 안 넘긴 옛 호출은 줄이 없다", () => {
    expect(buildBriefing({ runs24h: [], idempotentCollectors: new Set() })).not.toContain("🔎");
  });
  it("조회가 던지면 null → 브리핑 글은 그대로 나오고 \"확인 못 함\"", async () => {
    const rec = await loadSeoThinForBriefing(async () => { throw new Error("timeout"); });
    expect(rec).toBeNull();
    const text = brief(rec);
    expect(text).toContain("📊 <b>수집기 현황 브리핑</b>");
    expect(text).toContain("🔎 검색 제외: 확인 못 함");
  });
  it("조회가 HTML 을 주거나 모양이 틀리면 null(→ 확인 못 함) · 정상이면 기록", async () => {
    expect(await loadSeoThinForBriefing(async () => ({ status: 200, text: "<!doctype html>" }))).toBeNull();
    expect(await loadSeoThinForBriefing(async () => ({ status: 200, text: '{"count":5}' }))).toBeNull();
    expect(await loadSeoThinForBriefing(async () => ({ status: 200, text: OK_BODY }))).toMatchObject({ count: 5, applied: true });
  });
});

describe("runDailyGuardedChecks — ㉓ 가 매일 점검 묶음에 연결돼 있다", () => {
  /** 다른 점검은 전부 조용한 가짜 — 운영 조회로 새지 않게 */
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => [],
    fetchTradeRows: async () => [],
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => [],
    fetchUnsourcedZero: async () => ({ rows: [], doc: { evidence: [], held: [], pending: [] } }), // ⑫(g)(세션684) — 운영 조회가 나가지 않게
    fetchFailureRuns: async () => [],
    fetchKeyHealth: async () => ({ gapRows: [], latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    fetchTradeDeals: async () => ({ empty: true, rows: [], tradesCounts: {}, latest: "202609", prev: "202608" }),
    fetchTradeLinks: async () => ({ links: [], apts: [], latestSuccess: null }),
    fetchSgisMapRun: async () => [],
    fetchNoticeRuns: async () => ({}),
    fetchPriceHistoryCounts: async () => ({ A: { count: 163140 }, B: { count: 129 } }),
    fetchGovlistHealth: async () => ({ runs: [], listRows: [] }), // ㉔(세션692) — 운영 조회가 나가지 않게
    fetchDailyRefresh: async () => REFRESH, // ㉓ builtAt(세션697) — 진짜 GitHub 를 부르지 않게
    clearHoldAlertKeys: async () => {},
    now: NOW_0900,
  };
  /** ㉓ 세 갈래(얇은 단지·본문 실패·builtAt) @param {any[]} issues */
  const seo = (issues) => issues.filter((i) => ["seo-thin", "seo-body-error", "seo-built-at"].includes(i.kind));
  it("정상 기록(builtAt ≥ 마지막 daily refresh · 세션697) → ㉓ 이슈 0 · 기록 조회 1회 · 커밋 조회 1회", async () => {
    let n = 0;
    let g = 0;
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchSeoThin: async () => { n++; return { status: 200, text: NEW_BODY }; },
      fetchDailyRefresh: async () => { g++; return REFRESH; },
    }));
    expect(n).toBe(1);
    expect(g).toBe(1);
    expect(seo(issues)).toEqual([]);
    expect(issues.filter((i) => i.kind === "check-failed")).toEqual([]);
  });
  it("C6: builtAt 이 마지막 daily refresh 보다 이르면 ㉓ 1건(seo-built-at · 배포에 안 실림)", async () => {
    const body = JSON.stringify({ ...JSON.parse(NEW_BODY), builtAt: "2026-11-04T18:09:00.000Z" });
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchSeoThin: async () => ({ status: 200, text: body }) }));
    const t = seo(issues);
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("seo-built-at");
    expect(t[0].detail).toContain("배포에 안 실림");
  });
  it("B8: 같은 기록이라도 커밋 뒤 60분 안(now 주입)이면 비교 건너뜀", async () => {
    const body = JSON.stringify({ ...JSON.parse(NEW_BODY), builtAt: "2026-11-04T18:09:00.000Z" });
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, now: new Date("2026-11-05T18:30:00Z"), fetchSeoThin: async () => ({ status: 200, text: body }) }));
    expect(seo(issues)).toEqual([]);
  });
  it("B7: 토큰 없음(로컬 · GithubAuthMissingError) → 비교만 건너뜀 — ㉓ 이슈 0 · check-failed 0", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet, fetchSeoThin: async () => ({ status: 200, text: NEW_BODY }), fetchDailyRefresh: async () => { throw new GithubAuthMissingError(); },
    }));
    expect(seo(issues)).toEqual([]);
    expect(issues.filter((i) => i.kind === "check-failed")).toEqual([]);
  });
  it("B7: 토큰이 있는데 조회 실패(403 등) → check-failed 1건(㉓ builtAt 커밋 조회) · ㉓ 나머지 판정은 그대로", async () => {
    const body = JSON.stringify({ ...JSON.parse(NEW_BODY), bodyErrors: 1, bodyErrorIds: ["ap-1"] });
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet, fetchSeoThin: async () => ({ status: 200, text: body }), fetchDailyRefresh: async () => { throw new Error("GitHub API /commits 403 — contents:read 권한 확인"); },
    }));
    const f = issues.filter((i) => i.kind === "check-failed");
    expect(f).toHaveLength(1);
    expect(f[0].detail).toBe("㉓ builtAt 커밋 조회 실행 실패 — GitHub API /commits 403 — contents:read 권한 확인");
    expect(seo(issues).map((i) => i.kind)).toEqual(["seo-body-error"]);
  });
  it("C6: builtAt 없는 옛 기록 → GitHub 조회를 못 해도 ㉓ 1건(builtAt 없음)", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet, fetchSeoThin: async () => ({ status: 200, text: OK_BODY }), fetchDailyRefresh: async () => { throw new GithubAuthMissingError(); },
    }));
    const t = seo(issues);
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("seo-built-at");
    expect(t[0].detail).toContain("builtAt");
  });
  it("C5: bodyErrors 2 → ㉓ 1건(seo-body-error · 명단)", async () => {
    const body = JSON.stringify({ ...JSON.parse(NEW_BODY), bodyErrors: 2, bodyErrorIds: ["ap-1", "ap-2"] });
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchSeoThin: async () => ({ status: 200, text: body }) }));
    const t = seo(issues);
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("seo-body-error");
    expect(t[0].lines?.[0]).toBe("명단: ap-1 · ap-2");
  });
  it("200 + HTML → ㉓ 이슈 1건", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchSeoThin: async () => ({ status: 200, text: "<!doctype html>" }) }));
    expect(issues.filter((i) => i.kind === "seo-thin")).toHaveLength(1);
  });
  it("조회가 던지면 check-failed 1건(이름 = ㉓ 검색 제외 안전선)", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchSeoThin: async () => { throw new Error("timeout"); } }));
    const f = issues.filter((i) => i.kind === "check-failed");
    expect(f).toHaveLength(1);
    expect(f[0].detail).toBe("㉓ 검색 제외 안전선 실행 실패 — timeout");
  });
});

describe("아침 브리핑 연결부 — sendDailyBriefing 이 기록을 읽어 buildBriefing 에 넘긴다(소스 글자)", () => {
  it("loadSeoThinForBriefing() 결과를 seoThin 으로 넘긴다", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./monitor-collectors.mjs", import.meta.url), "utf-8");
    const start = src.indexOf("async function sendDailyBriefing(");
    expect(start).toBeGreaterThan(0);
    const end = src.slice(start).search(/\r?\n\}\r?\n/);
    expect(end).toBeGreaterThan(0);
    const body = src.slice(start, start + end);
    expect(body).toMatch(/const seoThin = await loadSeoThinForBriefing\(\);/);
    expect(body).toMatch(/\r?\n\s+seoThin,\r?\n/);
  });
});
