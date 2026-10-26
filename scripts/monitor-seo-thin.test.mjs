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
} from "./monitor-collectors.mjs";
import { buildBriefing, seoThinBriefLine } from "./monitor-briefing.mjs";
import { formatIssue } from "./notify-telegram.mjs";

const IDS5 = ["ap-6025745", "ap-6027214", "ap-6028737", "ap-6028739", "ap-6028740"];
/** @param {number} n */
const nameList = (n) => Array.from({ length: n }, (_, i) => `단지${i + 1}`);
/** @param {number} n */
const idList = (n) => Array.from({ length: n }, (_, i) => `ap-${i + 1}`);
const OK_BODY = JSON.stringify({ count: 5, ids: IDS5, names: nameList(5), applied: true, cap: 15 });

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
    fetchFailureRuns: async () => [],
    fetchKeyHealth: async () => ({ gapRows: [], latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    fetchTradeDeals: async () => ({ empty: true, rows: [], tradesCounts: {}, latest: "202609", prev: "202608" }),
    fetchTradeLinks: async () => ({ links: [], apts: [], latestSuccess: null }),
    fetchSgisMapRun: async () => [],
    fetchNoticeRuns: async () => ({}),
    fetchPriceHistoryCounts: async () => ({ A: { count: 163140 }, B: { count: 129 } }),
    clearHoldAlertKeys: async () => {},
  };
  it("정상 기록 → ㉓ 이슈 0 · 조회 1회", async () => {
    let n = 0;
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchSeoThin: async () => { n++; return { status: 200, text: OK_BODY }; } }));
    expect(n).toBe(1);
    expect(issues.filter((i) => i.kind === "seo-thin")).toEqual([]);
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
