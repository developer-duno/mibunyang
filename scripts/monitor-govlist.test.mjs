// @ts-check
/**
 * 감시 ⑫(h) 지자체 명단 만료·갱신 안 됨 + ㉔ 지자체 명단 수집 건전성(세션692 PR-4 · 설계서 §7).
 * 표식은 수집기 collect-unsold-govlist.mjs 와 같은 꼴(`GOVLIST_SKIP <출처> <이유>` 를 " · " 로 이음)으로 만든다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkApplyhomeUnsold,
  holdAlertResolved,
  HOLD_BASELINE_IDS,
  checkGovlistSkips,
  GOVLIST_LATE_DAYS,
  govlistNotNewerAgeDays,
  checkGovlistDrop,
  parseGovlistSkips,
  parseGovlistMatch,
  checkGovlistMatch,
  checkGovlistHiddenParity,
  fetchGovlistHiddenInputs,
  fetchGovlistHealthInputs,
  fetchGovlistListRows,
  fetchRegionUnresolvedRuns,
  GOVLIST_LIST_MONTHS,
  GOVLIST_LIVE_META_URL,
  GOVLIST_LIVE_LIST_URL,
  GOVLIST_COLLECTOR,
  EXTERNAL_API_COLLECTORS,
  checkExternalApiStale,
  runDailyGuardedChecks,
  isAlwaysDedup,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

/** 기준 명단 그대로의 hold 행 — (d) 가 끼지 않게. */
const holds = HOLD_BASELINE_IDS.map((id) => ({ id, unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2026-11-01" }));
/** @param {Record<string, unknown>} o */
const gov = (o) => ({ name: "두류", unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", ...o });
/** @param {any[]} rows @param {Date} now */
const hIssues = (rows, now) => checkApplyhomeUnsold([...holds, ...rows], { now }).filter((i) => i.collector === "unsold-govlist");

describe("⑫(h) 지자체 명단 — 만료 지남·갱신 안 됨", () => {
  it("brief 예시: govlist 0행 → 이슈 0", () => {
    expect(hIssues([], new Date("2027-12-01T00:00:00Z"))).toEqual([]);
  });
  it("(h-2) 비공개 등재: 기준월 + 6개월 당일까지 침묵 · 다음 날(KST) 1건", () => {
    const rows = [gov({ id: "ah-2025910146" })];
    expect(hIssues(rows, new Date("2027-03-30T14:59:00Z"))).toEqual([]); // KST 03-30 23:59
    const at = hIssues(rows, new Date("2027-03-30T15:00:00Z")); // KST 03-31
    expect(at.map((i) => i.at?.split(":")[0])).toEqual(["govstale"]);
    expect(at[0].detail).toContain("두류(ah-2025910146)");
  });
  it("(h-1) 만료 + 여유 35일 지남 → govexp · 숫자 명단 행은 h-2 에 안 걸린다", () => {
    const rows = [gov({ id: "a" }), gov({ id: "b", unsold: 4, unsold_rate: 1.1 })];
    // 03-30 만료 · +35일 = 05-04 · 다음 날 05-05 KST 부터 (h-1)
    expect(hIssues(rows, new Date("2027-05-04T03:00:00Z")).map((i) => i.at?.split(":")[0])).toEqual(["govstale"]);
    const later = hIssues(rows, new Date("2027-05-05T03:00:00Z"));
    expect(later.map((i) => i.at?.split(":")[0])).toEqual(["govexp", "govstale"]);
    // 세션696 B5(BACKLOG 440 adv🟡4): 수 비공개 a 는 (h-2) 가 이미 울려 (h-1) 에서 빠진다 — 숫자 b 만(옛 기대 「2곳」은 같은 단지 두 번 울림)
    expect(later[0].detail).toContain("1곳");
    expect(later[0].detail).toContain("두류(b)");
    expect(later[0].detail).not.toContain("두류(a)");
    expect(later[1].detail).toContain("두류(a)"); // 비공개만
    expect(later[1].detail).not.toContain("두류(b)");
  });
  it("세션696 B5 — 수 비공개 한 곳은 만료 다음 날부터 (h-2) 한 열쇠로만 운다(35일 뒤에도 (h-1) 열쇠가 새로 안 생김)", () => {
    const rows = [gov({ id: "h" })]; // 기준월 2026-09-30 · 만료 2027-03-30
    const keys = (/** @type {string} */ d) => hIssues(rows, new Date(d)).map((i) => i.at);
    const first = keys("2027-03-31T03:00:00Z");
    expect(first.map((k) => k?.split(":")[0])).toEqual(["govstale"]);
    expect(keys("2027-05-05T03:00:00Z")).toEqual(first); // 옛 판정은 여기서 govexp 열쇠가 하나 더 생겨 다시 울렸다
    expect(keys("2027-08-01T03:00:00Z")).toEqual(first);
  });
  it("dedup 지문 = 명단 id 정렬 해시 — 같은 명단은 같은 at, 순서만 바뀌어도 같고, 하나 늘면 바뀐다 · daily dedup · (d) 해소 판정과 안 섞임", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    const a = hIssues([gov({ id: "x" }), gov({ id: "y" })], now);
    const b = hIssues([gov({ id: "y" }), gov({ id: "x" })], now);
    const c = hIssues([gov({ id: "y" }), gov({ id: "x" }), gov({ id: "z" })], now);
    expect(a.map((i) => i.at)).toEqual(b.map((i) => i.at));
    expect(a[0].at).not.toBe(c[0].at);
    expect(a.every((i) => isAlwaysDedup(i))).toBe(true);
    expect(holdAlertResolved(checkApplyhomeUnsold([...holds, gov({ id: "x" })], { now }))).toBe(true);
  });
  it("(h-3) 기준월 있는 govlist 만이면 날짜 없음 줄 0건(침묵)", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    expect(hIssues([gov({ id: "a" }), gov({ id: "b", unsold: 4 })], now).filter((i) => i.at?.startsWith("govnodate:"))).toEqual([]);
  });
  it("(h-3) 기준월이 빈 govlist 1곳 → 「기준월이 빈 단지 1곳」 1건 · 지문 접두 govnodate · 다른 (h) 줄은 안 섞임", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const is = hIssues([gov({ id: "a" }), gov({ id: "nd", unsold_as_of: null, unsold_listed_as_of: null })], now);
    expect(is.map((i) => i.at?.split(":")[0])).toEqual(["govnodate"]);
    expect(is[0].detail).toContain("기준월(unsold_as_of)이 빈 단지 1곳");
    expect(is[0].detail).toContain("두류(nd)");
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("다른 출처·(a)~(f) 판정은 govlist 행이 섞여도 그대로(청약홈 만료 없음 → (a) 0)", () => {
    const all = checkApplyhomeUnsold([...holds, gov({ id: "x" })], { now: new Date("2026-11-08T00:00:00Z") });
    expect(all).toEqual([]);
  });
});

/** @param {string | null} msg @param {string} at @param {string} [status] */
const run = (msg, at, status = "success") => ({ status, error_message: msg, finished_at: at });

describe("㉔-a GOVLIST_SKIP — 최근 실행 1행", () => {
  it("parseGovlistSkips — 표식만 뽑고 다른 GOVLIST_* 조각은 무시", () => {
    expect(parseGovlistSkips("GOVLIST_SKIP chungnam not_newer · GOVLIST_WRITE race 1 · GOVLIST_SKIP daegu fetch")).toEqual([
      { source: "chungnam", reason: "not_newer" }, { source: "daegu", reason: "fetch" },
    ]);
    expect(parseGovlistSkips(null)).toEqual([]);
    expect(parseGovlistSkips("GOVLIST_BREAKER 바뀔 단지 60")).toEqual([]);
  });
  it("brief 예시: collector_runs 0행 → 이슈 0 · 최신 실행에 표식 없으면 침묵(옛 실행 표식은 무시)", () => {
    expect(checkGovlistSkips([])).toEqual([]);
    expect(checkGovlistSkips([run(null, "2026-12-08T00:00:00Z"), run("GOVLIST_SKIP chungnam not_newer", "2026-11-08T00:00:00Z")])).toEqual([]);
  });
  it("걸림 — 1건 · 출처·이유가 detail 에 · daily dedup", () => {
    const is = checkGovlistSkips([run("GOVLIST_SKIP chungnam not_newer", "2026-12-08T00:00:00Z")]);
    expect(is).toHaveLength(1);
    expect(is[0].kind).toBe("govlist-health");
    expect(is[0].collector).toBe(GOVLIST_COLLECTOR);
    expect(is[0].detail).toContain("chungnam(not_newer)");
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("dedup 지문 — 같은 표식이 다달이 이어지면 같은 at(구간 첫 실행) · 깨끗한 success 가 끊으면 새 구간 · 표식이 바뀌면 다른 at", () => {
    const m = "GOVLIST_SKIP chungnam not_newer";
    const one = checkGovlistSkips([run(m, "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    const two = checkGovlistSkips([run(m, "2027-01-08T00:00:00Z"), run(m, "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    expect(one).toBe(two);
    const broken = checkGovlistSkips([run(m, "2027-01-08T00:00:00Z"), run(null, "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    expect(broken).not.toBe(one);
    const other = checkGovlistSkips([run("GOVLIST_SKIP chungnam header", "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    expect(other).not.toBe(one);
    // 표식 순서만 바뀐 같은 내용은 같은 지문 앞부분
    const ab = checkGovlistSkips([run("GOVLIST_SKIP a x · GOVLIST_SKIP b y", "T")])[0].at;
    const ba = checkGovlistSkips([run("GOVLIST_SKIP b y · GOVLIST_SKIP a x", "T")])[0].at;
    expect(ab).toBe(ba);
  });
});

describe("㉔-a 게시 지연 문턱(세션695 PR-4c · 👤 11/04 BACKLOG 441) — not_newer 는 저장 기준일 + 70일이 지나야 알림", () => {
  // 수집기 collect-unsold-govlist.mjs:417 의 이유 꼴 그대로
  const nn = "GOVLIST_SKIP daegu not_newer(파일 2026-09-30 ≤ 저장된 2026-09-30)";
  /** KST 그날 아침 — 감시가 도는 09시(UTC 00시) @param {string} ymd */
  const at = (ymd) => new Date(`${ymd}T00:00:00Z`);
  it("문턱은 70일(리터럴)", () => {
    expect(GOVLIST_LATE_DAYS).toBe(70);
  });
  it("경계 — 저장 2026-09-30: 11/09(40일)·12/08(69일)·12/09(70일) 조용 · 12/10(71일) 알림", () => {
    expect(govlistNotNewerAgeDays("not_newer(파일 2026-09-30 ≤ 저장된 2026-09-30)", at("2026-12-10"))).toBe(71);
    for (const d of ["2026-11-09", "2026-12-08", "2026-12-09"]) expect(checkGovlistSkips([run(nn, "2026-11-08T00:00:00Z")], at(d))).toEqual([]);
    const is = checkGovlistSkips([run(nn, "2026-12-08T00:00:00Z")], at("2026-12-10"));
    expect(is).toHaveLength(1);
    expect(is[0].detail).toContain("daegu(not_newer(파일 2026-09-30 ≤ 저장된 2026-09-30))");
    expect(is[0].lines).toContain("게시 지연(not_newer)은 저장된 기준일 + 70일이 지나야 알립니다.");
  });
  it("오늘은 KST 날짜로 센다 — 12/09 23:30 KST 는 70일(조용) · 12/10 00:30 KST 는 71일(알림)", () => {
    expect(checkGovlistSkips([run(nn, "T")], new Date("2026-12-09T14:30:00Z"))).toEqual([]);
    expect(checkGovlistSkips([run(nn, "T")], new Date("2026-12-09T15:30:00Z"))).toHaveLength(1);
  });
  it("저장 기준일을 못 읽으면 그대로 알린다(이유 꼴이 다름 · 없는 날짜 · 미래 날짜)", () => {
    const now = at("2026-11-09");
    expect(checkGovlistSkips([run("GOVLIST_SKIP daegu not_newer", "T")], now)).toHaveLength(1);
    expect(checkGovlistSkips([run("GOVLIST_SKIP daegu not_newer(파일 2026-02-30 ≤ 저장된 2026-02-30)", "T")], now)).toHaveLength(1);
    expect(checkGovlistSkips([run("GOVLIST_SKIP daegu not_newer(파일 2027-01-31 ≤ 저장된 2027-01-31)", "T")], now)).toHaveLength(1);
    expect(govlistNotNewerAgeDays("not_newer(파일 2026-02-30 ≤ 저장된 2026-02-30)", now)).toBeNull();
  });
  it("header 와 조용한 not_newer 가 섞이면 header 만 알린다 · fetch·rows0 은 문턱과 무관", () => {
    const now = at("2026-11-09");
    const is = checkGovlistSkips([run(`GOVLIST_SKIP chungnam header(머리줄) · ${nn}`, "T")], now);
    expect(is).toHaveLength(1);
    expect(is[0].detail).toBe("GOVLIST_SKIP 지자체 명단 건너뜀 — chungnam(header(머리줄))");
    expect(checkGovlistSkips([run("GOVLIST_SKIP daegu fetch(HTTP 500)", "T")], now)).toHaveLength(1);
    expect(checkGovlistSkips([run("GOVLIST_SKIP daegu rows0", "T")], now)).toHaveLength(1);
  });
  it("dedup 구간 — 앞 달의 조용한 not_newer 실행은 구간 시작에 안 든다(그 뒤 header 가 첫 실행)", () => {
    const now = at("2026-12-09");
    const is = checkGovlistSkips([run("GOVLIST_SKIP daegu header(x)", "2026-12-08T00:00:00Z"), run(nn, "2026-11-08T00:00:00Z")], now);
    expect(is[0].at).toMatch(/@2026-12-08T00:00:00Z$/);
  });
});

/** @param {string} source @param {string} asOf @param {string} batch @param {number} n @param {number} [declared] */
const batch = (source, asOf, batch, n, declared = n) => Array.from({ length: n }, () => ({ source, as_of: asOf, batch_id: batch, batch_rows: declared }));

describe("㉔-b 명단 행 수 전 기준월 대비 −50%", () => {
  it("brief 예시: 명단 0행 → 이슈 0 · 기준월 하나뿐이면 침묵", () => {
    expect(checkGovlistDrop([])).toEqual([]);
    expect(checkGovlistDrop(batch("daegu", "2026-09-30", "b1", 60))).toEqual([]);
  });
  it("경계: 전 60 → 30 은 침묵(= 절반) · 29 는 걸림", () => {
    expect(checkGovlistDrop([...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 30)])).toEqual([]);
    const is = checkGovlistDrop([...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 29)]);
    expect(is).toHaveLength(1);
    expect(is[0].detail).toContain("GOVLIST_DROP daegu 명단 행 29 < 전 기준월(2026-09-30) 60");
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("반쯤 쓰인 batch(실제 행 ≠ batch_rows)는 세지 않는다 — 같은 달의 완성 batch 로 판정", () => {
    const rows = [...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "half", 10, 58), ...batch("daegu", "2026-10-31", "full", 58)];
    expect(checkGovlistDrop(rows)).toEqual([]);
    // 완성 batch 가 없는 달은 기준월로 안 친다 → 9월이 최신 하나뿐 → 침묵
    expect(checkGovlistDrop([...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "half", 10, 58)])).toEqual([]);
  });
  it("출처마다 따로 · dedup 지문 = 출처|기준월|행 수 — 같은 상태 같은 at, 다른 출처는 다른 at", () => {
    const rows = [...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 10), ...batch("chungnam", "2026-06-30", "c1", 100), ...batch("chungnam", "2026-07-31", "c2", 20)];
    const a = checkGovlistDrop(rows), b = checkGovlistDrop([...rows].reverse());
    expect(a.map((i) => i.detail.split(" ")[1])).toEqual(["chungnam", "daegu"]);
    expect(a.map((i) => i.at)).toEqual(b.map((i) => i.at));
    expect(a[0].at).not.toBe(a[1].at);
  });
});

describe("⑤ 등재 — unsold-govlist 월간 38 · ⑤-a 는 skip(명단 원문 행)으로 가른다(세션693 PR-4b A4 B 안)", () => {
  const target = EXTERNAL_API_COLLECTORS.filter((c) => c.collector === GOVLIST_COLLECTOR);
  const NOW = new Date("2027-02-20T00:00:00Z");
  const r3 = (/** @type {number} */ skip) => ["2027-02-08", "2027-01-08", "2026-12-08", "2026-11-08"].map((d) => ({ status: "success", ok_count: 0, skip_count: skip, finished_at: `${d}T00:00:00Z` }));
  it("등재 한 줄 · stale_days 38 · owner 에 대구·8일", () => {
    expect(target).toHaveLength(1);
    expect(target[0].stale_days).toBe(38);
    expect(target[0].owner).toMatch(/대구.*8일/);
  });
  it("① 바뀜 0·명단 60행 success 3회+ → ⑤-a 침묵 · ② 명단 못 읽은 달(skip 0) success 3회+ → ⑤-a 경보", () => {
    expect(checkExternalApiStale(target, { [GOVLIST_COLLECTOR]: r3(60) }, NOW)).toEqual([]);
    const loud = checkExternalApiStale(target, { [GOVLIST_COLLECTOR]: r3(0) }, NOW);
    expect(loud.map((i) => i.kind)).toEqual(["outage"]);
    expect(loud[0].collector).toBe(GOVLIST_COLLECTOR);
  });
  it("⑤-b 미발화 — 마지막 실행 38일 넘으면 stale", () => {
    expect(checkExternalApiStale(target, { [GOVLIST_COLLECTOR]: [{ status: "success", ok_count: 0, skip_count: 60, finished_at: "2026-11-08T00:00:00Z" }] }, new Date("2026-12-17T00:00:00Z")).map((i) => i.kind)).toEqual(["stale"]);
    expect(checkExternalApiStale(target, { [GOVLIST_COLLECTOR]: [{ status: "success", ok_count: 0, skip_count: 60, finished_at: "2026-11-08T00:00:00Z" }] }, new Date("2026-12-15T00:00:00Z"))).toEqual([]);
  });
});

describe("㉔-c 매칭 — 충돌 · 판정 필요 증가(세션693 PR-4b (e))", () => {
  const M = (/** @type {string} */ s, /** @type {number} */ n, /** @type {string} */ sgg, /** @type {number} */ c) => `GOVLIST_MATCH ${s} 판정필요 ${n}{${sgg}} 충돌 ${c}`;
  it("parseGovlistMatch — 다른 표식 사이에서 출처·수·시군구·충돌만 뽑는다", () => {
    expect(parseGovlistMatch(`GOVLIST_SKIP chungnam not_newer · ${M("daegu", 33, "달서구:5,수성구:28", 0)}`)).toEqual([{ source: "daegu", unresolved: 33, bySgg: { 달서구: 5, 수성구: 28 }, conflicts: 0 }]);
    expect(parseGovlistMatch(M("daegu", 0, "", 0))).toEqual([{ source: "daegu", unresolved: 0, bySgg: {}, conflicts: 0 }]);
    expect(parseGovlistMatch(null)).toEqual([]);
  });
  it("brief 예시: 33 → 33 침묵 · 33 → 35 알림(늘어난 시군구) · 35 → 33 침묵 · 앞 실행 없으면 침묵", () => {
    expect(checkGovlistMatch([run(M("daegu", 33, "달서구:5", 0), "2026-12-08T00:00:00Z"), run(M("daegu", 33, "달서구:5", 0), "2026-11-08T00:00:00Z")])).toEqual([]);
    const up = checkGovlistMatch([run(M("daegu", 35, "달서구:7", 0), "2026-12-08T00:00:00Z"), run(M("daegu", 33, "달서구:5", 0), "2026-11-08T00:00:00Z")]);
    expect(up.map((i) => i.detail)).toEqual(["GOVLIST_MATCH_GROWTH daegu 판정 필요 단지 33→35곳 — 늘어난 시군구: 달서구 5→7"]);
    expect(isAlwaysDedup(up[0])).toBe(true);
    expect(checkGovlistMatch([run(M("daegu", 33, "달서구:5", 0), "2026-12-08T00:00:00Z"), run(M("daegu", 35, "달서구:7", 0), "2026-11-08T00:00:00Z")])).toEqual([]);
    expect(checkGovlistMatch([run(M("daegu", 33, "달서구:5", 0), "2026-12-08T00:00:00Z")])).toEqual([]);
    expect(checkGovlistMatch([])).toEqual([]);
  });
  it("세션693 B7 — 합계 33→33 이어도 한 시군구 +1(다른 시군구 −1)이면 경보 · 늘어난 시군구만 detail 에", () => {
    const is = checkGovlistMatch([run(M("daegu", 33, "달서구:6,수성구:27", 0), "2026-12-08T00:00:00Z"), run(M("daegu", 33, "달서구:5,수성구:28", 0), "2026-11-08T00:00:00Z")]);
    expect(is.map((i) => i.detail)).toEqual(["GOVLIST_MATCH_GROWTH daegu 판정 필요 단지 33→33곳 — 늘어난 시군구: 달서구 5→6"]);
    // 새 시군구가 생겨도(앞 실행 0) 늘어난 것
    expect(checkGovlistMatch([run(M("daegu", 33, "북구:1,수성구:32", 0), "2026-12-08T00:00:00Z"), run(M("daegu", 33, "수성구:33", 0), "2026-11-08T00:00:00Z")]).map((i) => i.detail)).toEqual(["GOVLIST_MATCH_GROWTH daegu 판정 필요 단지 33→33곳 — 늘어난 시군구: 북구 0→1"]);
  });
  it("앞 실행은 **같은 출처 표식이 있는** 가장 가까운 실행(건너뜀·잠금 실행은 넘어간다) · 출처마다 따로", () => {
    const runs = [
      run(`${M("daegu", 34, "달서구:6", 0)} · ${M("chungnam", 10, "아산시:10", 0)}`, "2027-01-08T00:00:00Z"),
      run("GOVLIST_APPLY_LOCKED x", "2026-12-08T00:00:00Z", "failure"),
      run(`${M("daegu", 33, "달서구:5", 0)} · ${M("chungnam", 12, "아산시:12", 0)}`, "2026-11-08T00:00:00Z"),
    ];
    expect(checkGovlistMatch(runs).map((i) => i.detail.split(" ").slice(0, 2).join(" "))).toEqual(["GOVLIST_MATCH_GROWTH daegu"]);
  });
  it("충돌 ≥ 1 → 1건(앞 실행 없어도) · 0 이면 침묵 · 지문 = 출처|수 @ 실행 시각", () => {
    expect(checkGovlistMatch([run(M("daegu", 33, "달서구:5", 0), "2026-12-08T00:00:00Z")])).toEqual([]);
    const c = checkGovlistMatch([run(M("daegu", 33, "달서구:5", 2), "2026-12-08T00:00:00Z")]);
    expect(c.map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_MATCH_CONFLICT"]);
    expect(c[0].detail).toContain("매칭 충돌 2곳");
    expect(c[0].at).toMatch(/^mconf:[0-9a-f]+@2026-12-08T00:00:00Z$/);
    const again = checkGovlistMatch([run(M("daegu", 33, "달서구:5", 2), "2027-01-08T00:00:00Z")]);
    expect(again[0].at).not.toBe(c[0].at); // 다음 회차에도 남아 있으면 다시
  });
});

describe("㉔-d VIEW hidden = 목록 JSON hidden(세션693 PR-4b (f))", () => {
  const NOW = new Date("2026-12-09T00:00:00Z"); // KST 09:00
  const live = (/** @type {string} */ fetchedAt, /** @type {number} */ listHidden) => ({ fetchedAt, listHidden });
  it("같으면 침묵 · 다르면 1건(오늘 03시 뒤 굽기일 때만)", () => {
    expect(checkGovlistHiddenParity({ viewHidden: 3, rawAsOf: ["2026-09-30", "2026-09-30", "2026-09-30"], live: live("2026-12-08T18:05:00Z", 3) }, NOW)).toEqual([]);
    const is = checkGovlistHiddenParity({ viewHidden: 3, rawAsOf: ["2026-09-30", "2026-09-30", "2026-09-30"], live: live("2026-12-08T18:05:00Z", 2) }, NOW);
    expect(is.map((i) => i.detail)).toEqual(["GOVLIST_HIDDEN_MISMATCH VIEW 「수 비공개」 3곳 ≠ 라이브 목록 JSON 2곳"]);
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("굽기가 오늘 03시(KST) 전이면 비교하지 않는다 — 경계 03:00 은 비교", () => {
    const h = (/** @type {string} */ f) => checkGovlistHiddenParity({ viewHidden: 3, rawAsOf: ["2026-09-30"], live: live(f, 0) }, NOW);
    expect(h("2026-12-08T17:59:59Z")).toEqual([]); // KST 02:59:59
    expect(h("2026-12-08T18:00:00Z")).toHaveLength(1); // KST 03:00
    expect(checkGovlistHiddenParity({ viewHidden: 3, rawAsOf: ["2026-09-30"], live: null }, NOW)).toEqual([]); // 라이브 못 가져옴 = 비교 건너뜀
  });
  it("세션693 B2 — 굽기(03:05) 뒤에 수집기가 돌았으면(05:30 반영) VIEW 58 ≠ JSON 57 이어도 침묵 · 반영이 굽기 전이면 경보", () => {
    const h = { viewHidden: 58, rawAsOf: Array(58).fill("2026-11-30"), live: live("2026-12-07T18:05:00Z", 57) }; // 굽기 KST 12-08 03:05
    const now = new Date("2026-12-08T00:00:00Z"); // KST 12-08 09:00 감시
    const ran = (/** @type {string} */ at, status = "success", ok = 1) => ({ finished_at: at, status, ok_count: ok });
    expect(checkGovlistHiddenParity(h, now, ran("2026-12-07T20:30:00Z"))).toEqual([]); // 반영 KST 05:30 — 굽기 뒤
    expect(checkGovlistHiddenParity(h, now, ran("2026-12-07T18:04:00Z")).map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_HIDDEN_MISMATCH"]); // 반영 KST 03:04 — 굽기 전
    expect(checkGovlistHiddenParity(h, now, null)).toHaveLength(1); // 실행 기록 없음 → 그대로 비교
  });
  it("세션693 C2 — 굽기 뒤 실행이 쓰기 0 인 실패(차단기·첫 회차 막음)면 건너뛰지 않고 비교한다 · ok>0 인 partial 은 건너뜀", () => {
    const h = { viewHidden: 58, rawAsOf: ["2026-11-30"], live: live("2026-12-07T18:05:00Z", 57) };
    const now = new Date("2026-12-08T00:00:00Z");
    expect(checkGovlistHiddenParity(h, now, { finished_at: "2026-12-07T20:30:00Z", status: "failure", ok_count: 0 }).map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_HIDDEN_MISMATCH"]);
    expect(checkGovlistHiddenParity(h, now, { finished_at: "2026-12-07T20:30:00Z", status: "partial", ok_count: 3 })).toEqual([]);
    expect(checkGovlistHiddenParity(h, now, { finished_at: "2026-12-07T20:30:00Z", status: "failure", ok_count: null })).toHaveLength(1);
  });
  it("양성 대조군 — 원표 유효 비공개 1행+ 인데 VIEW 0 → 따로 1건(라이브와 무관) · 원표 행이 만료됐으면 침묵 · 0=0 은 침묵", () => {
    const z = checkGovlistHiddenParity({ viewHidden: 0, rawAsOf: ["2026-09-30"], live: null }, NOW);
    expect(z.map((i) => i.detail)).toEqual(["GOVLIST_HIDDEN_VIEW_ZERO 원표 govlist 비공개(유효) 1행인데 VIEW 「수 비공개」 카드 0곳"]);
    expect(checkGovlistHiddenParity({ viewHidden: 0, rawAsOf: ["2026-01-31"], live: null }, NOW)).toEqual([]); // 07-31 만료
    expect(checkGovlistHiddenParity({ viewHidden: 0, rawAsOf: [], live: live("2026-12-08T18:05:00Z", 0) }, NOW)).toEqual([]);
    expect(checkGovlistHiddenParity(undefined, NOW)).toEqual([]);
  });
  it("fetchGovlistHiddenInputs — 가짜 sb·fetch: VIEW 임대형 제외 · 원표 기준월 · 라이브 hidden 수 · 가져오기 실패는 live null(던지지 않음)", async () => {
    const tables = {
      apartments_flat: [{ id: "a", name: "두류", presaleType: null, unsoldListedHidden: true }, { id: "b", name: "x 행복주택", presaleType: null, unsoldListedHidden: true }, { id: "c", name: "y", presaleType: null, unsoldListedHidden: false }],
      apartments: [{ id: "a", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30" }, { id: "d", unsold: 5, unsold_source: "govlist", unsold_as_of: "2026-09-30" }, { id: "e", unsold: null, unsold_source: "hold", unsold_as_of: "2026-11-01" }],
    };
    /** @type {string[]} */ const urls = [];
    const okFetch = /** @type {any} */ (async (/** @type {string} */ u) => { urls.push(u); return new Response(JSON.stringify(u.endsWith("meta.json") ? { fetchedAt: "2026-12-08T18:05:00Z" } : { data: [{ unsoldListedHidden: true }, { unsoldListedHidden: false }] })); });
    const h = await fetchGovlistHiddenInputs({ sb: fakeSb(tables), fetchImpl: okFetch });
    expect(h).toEqual({ viewHidden: 1, rawAsOf: ["2026-09-30"], live: { fetchedAt: "2026-12-08T18:05:00Z", listHidden: 1 }, liveError: null });
    expect(urls).toEqual([GOVLIST_LIVE_META_URL, GOVLIST_LIVE_LIST_URL]);
    expect(GOVLIST_LIVE_LIST_URL).toMatch(/^https:\/\/www\./);
    const bad = await fetchGovlistHiddenInputs({ sb: fakeSb(tables), fetchImpl: /** @type {any} */ (async () => new Response("x", { status: 502 })) });
    expect(bad.live).toBeNull();
    expect(bad.liveError).toMatch(/HTTP 502/);
  });
});

/** 작은 읽기 전용 가짜 Supabase(select·eq·is·in·gt·lt·order·limit) — 부른 조회를 calls 에 남긴다. @param {Record<string, any[]>} tables @param {any[]} [calls] */
function fakeSb(tables, calls = []) {
  return {
    from: (/** @type {string} */ t) => {
      /** @type {any} */ const q = { t, f: [], ord: [], lim: null, ops: [] };
      /** @type {any} */ const api = {
        select: () => api,
        eq: (/** @type {string} */ k, /** @type {any} */ v) => { q.ops.push(`eq:${k}`); q.f.push((/** @type {any} */ r) => r[k] === v); return api; },
        is: (/** @type {string} */ k, /** @type {any} */ v) => { q.f.push((/** @type {any} */ r) => (r[k] ?? null) === v); return api; },
        in: (/** @type {string} */ k, /** @type {any[]} */ v) => { q.ops.push(`in:${k}=${v.join("|")}`); q.f.push((/** @type {any} */ r) => v.includes(r[k])); return api; },
        gt: (/** @type {string} */ k, /** @type {any} */ v) => { q.f.push((/** @type {any} */ r) => r[k] > v); return api; },
        lt: (/** @type {string} */ k, /** @type {any} */ v) => { q.f.push((/** @type {any} */ r) => r[k] < v); return api; },
        order: (/** @type {string} */ k, /** @type {any} */ o) => { q.ord.push([k, o?.ascending !== false]); return api; },
        limit: (/** @type {number} */ n) => { q.lim = n; return api; },
        then: (/** @type {any} */ ok, /** @type {any} */ bad) => {
          calls.push({ t, ops: q.ops });
          let out = (tables[t] ?? []).filter((r) => q.f.every((/** @type {any} */ fn) => fn(r)));
          for (const [k, asc] of [...q.ord].reverse()) out = [...out].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
          if (q.lim != null) out = out.slice(0, q.lim);
          return Promise.resolve({ data: out, error: null }).then(ok, bad);
        },
      };
      return api;
    },
  };
}

describe("㉔-b 조회 범위 — 출처마다 최근 기준월 2개(세션693 PR-4b (g))", () => {
  it("기준월 3개 있으면 가장 새 2개만 읽는다 · 출처마다 따로 · 판정은 그대로", async () => {
    let id = 1;
    const mk = (/** @type {string} */ source, /** @type {string} */ asOf, /** @type {number} */ n) => Array.from({ length: n }, () => ({ id: id++, source, as_of: asOf, batch_id: `${source}-${asOf}`, batch_rows: n }));
    const rows = [...mk("daegu", "2026-08-31", 60), ...mk("daegu", "2026-09-30", 60), ...mk("daegu", "2026-10-31", 20), ...mk("chungnam", "2026-06-30", 90)];
    /** @type {any[]} */ const calls = [];
    const got = await fetchGovlistListRows(fakeSb({ unsold_gov_list: rows }, calls));
    expect([...new Set(got.map((r) => `${r.source}|${r.as_of}`))].sort()).toEqual(["chungnam|2026-06-30", "daegu|2026-09-30", "daegu|2026-10-31"]);
    expect(got).toHaveLength(60 + 20 + 90);
    expect(calls.filter((c) => c.ops.some((/** @type {string} */ o) => o.startsWith("in:as_of="))).map((c) => c.ops.find((/** @type {string} */ o) => o.startsWith("in:")))).toEqual(["in:as_of=2026-06-30", "in:as_of=2026-10-31|2026-09-30"]);
    expect(checkGovlistDrop(got).map((i) => i.detail.split(" ").slice(0, 2).join(" "))).toEqual(["GOVLIST_DROP daegu"]);
    expect(GOVLIST_LIST_MONTHS).toBe(2);
    expect(await fetchGovlistListRows(fakeSb({ unsold_gov_list: [] }))).toEqual([]);
  });
});

describe("㉔ 배선", () => {
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchUnsourcedZero: async () => ({ rows: [], doc: { evidence: [], held: [], pending: [] } }),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    fetchTradeDeals: async () => ({ empty: true, rows: /** @type {Array<Record<string, any>>} */ ([]), tradesCounts: {}, latest: "202609", prev: "202608" }),
    fetchTradeLinks: async () => ({ links: /** @type {Array<Record<string, any>>} */ ([]), apts: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: null }),
    fetchSgisMapRun: async () => [],
    fetchNoticeRuns: async () => ({}),
    fetchPriceHistoryCounts: async () => ({ A: { count: 163140 }, B: { count: 129 } }),
    fetchSeoThin: async () => ({ status: 200, text: '{"count":0,"ids":[],"names":[],"applied":true,"cap":15}' }),
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };
  it("세션695 PR-4c 배선 — runDailyGuardedChecks 가 deps.now 를 ㉔-a 게시 지연 문턱에 넘긴다(저장 9/30: 11/09 조용 · 12/10 알림)", async () => {
    const nn = "GOVLIST_SKIP daegu not_newer(파일 2026-09-30 ≤ 저장된 2026-09-30)";
    const go = (/** @type {string} */ d) => runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, now: new Date(`${d}T00:00:00Z`), fetchGovlistHealth: async () => ({ runs: [run(nn, "2026-11-08T00:00:00Z")], listRows: [] }) }));
    const pick = (/** @type {any[]} */ is) => is.filter((i) => i.kind === "govlist-health" && String(i.detail).startsWith("GOVLIST_SKIP"));
    expect(pick(await go("2026-11-09"))).toEqual([]);
    expect(pick(await go("2026-12-10"))).toHaveLength(1);
  });
  it("runDailyGuardedChecks 가 ㉔ 재료를 1회 물어 두 판정을 싣는다 · 0행이면 침묵", async () => {
    let n = 0;
    const silent = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchGovlistHealth: async () => { n++; return { runs: [], listRows: [] }; } }));
    expect(n).toBe(1);
    expect(silent.filter((i) => i.kind === "govlist-health" || i.kind === "check-failed")).toEqual([]);
    const loud = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchGovlistHealth: async () => ({
        runs: [run("GOVLIST_SKIP chungnam not_newer", "2026-12-08T00:00:00Z")],
        listRows: [...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 5)],
      }),
    }));
    expect(loud.filter((i) => i.kind === "govlist-health").map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_SKIP", "GOVLIST_DROP"]);
  });
  it("수집기 PHASE·표식 문구·이음이 감시와 같다(한쪽만 바뀌면 빨강)", () => {
    const src = readFileSync(fileURLToPath(new URL("./collectors/collect-unsold-govlist.mjs", import.meta.url)), "utf8");
    expect(src).toContain(`export const PHASE = "${GOVLIST_COLLECTOR}";`);
    expect(src).toContain("const m = `GOVLIST_SKIP ${source} ${why}`;");
    expect(src).toContain('[...markers, ...matchMarkers].join(" · ")'); // 세션693: 매칭 표식(GOVLIST_MATCH)을 뒤에 붙여 같은 이음으로
    const mon = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
    // 세션693 (g): 출처마다 최근 기준월 2개로 좁힌 id 커서 조회
    expect(mon).toContain('s.from("unsold_gov_list").select("id, source, as_of, batch_id, batch_rows").eq("source", source).in("as_of", months),\n      sb,\n      "id",'.replace(/\n/g, mon.includes("\r\n") ? "\r\n" : "\n"));
    // 세션693 (e): 매칭 표식 꼴이 수집기와 같다
    expect(src).toContain("return `GOVLIST_MATCH ${source} 판정필요 ${total}{${list}} 충돌 ${conflicts}`;");
  });
  it("세션693 ㉔-c·㉔-d 배선 — 같은 ㉔ 재료(runs·hidden)에서 매칭·비공개 대조가 실린다 · hidden 없으면(옛 재료) 침묵", async () => {
    const loud = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchGovlistHealth: async () => ({
        runs: [run("GOVLIST_MATCH daegu 판정필요 35{달서구:5} 충돌 1", "2026-12-08T00:00:00Z"), run("GOVLIST_MATCH daegu 판정필요 33{달서구:3} 충돌 0", "2026-11-08T00:00:00Z")],
        listRows: [],
        hidden: { viewHidden: 0, rawAsOf: ["2099-01-31"], live: null, liveError: "boom" },
      }),
    }));
    expect(loud.filter((i) => i.kind === "govlist-health").map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_MATCH_CONFLICT", "GOVLIST_MATCH_GROWTH", "GOVLIST_HIDDEN_VIEW_ZERO"]);
    const quietRun = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchGovlistHealth: async () => ({ runs: [], listRows: [] }) }));
    expect(quietRun.filter((i) => i.kind === "govlist-health" || i.kind === "check-failed")).toEqual([]);
  });
  it("세션693 B5 — ㉔-d 재료 조회가 실패해도(hiddenError) ㉔-a·b·c 는 그대로 나오고 ㉔-d 만 실행 실패 1건", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchGovlistHealth: async () => ({ runs: [run("GOVLIST_SKIP daegu not_newer · GOVLIST_MATCH daegu 판정필요 1{달서구:1} 충돌 1", "2026-12-08T00:00:00Z")], listRows: [], hiddenError: "VIEW 조회 실패" }),
    }));
    expect(issues.filter((i) => i.kind === "govlist-health").map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_SKIP", "GOVLIST_MATCH_CONFLICT"]);
    expect(issues.filter((i) => i.kind === "check-failed").map((i) => i.detail)).toEqual(["㉔-d 지자체 명단 비공개 수 대조 실행 실패 — VIEW 조회 실패"]);
  });
  it("세션693 B5 — 운영 재료 함수(fetchGovlistHealthInputs)는 ㉔-d 조회 예외를 던지지 않고 hiddenError 로 넘긴다(㉔-a·b·c 재료는 그대로)", async () => {
    const runs = [run("GOVLIST_SKIP daegu not_newer", "2026-12-08T00:00:00Z")];
    const g = await fetchGovlistHealthInputs({
      sb: fakeSb({ unsold_gov_list: [{ id: 1, source: "daegu", as_of: "2026-09-30", batch_id: "b", batch_rows: 1 }] }),
      fetchRuns: /** @type {any} */ (async () => ({ [GOVLIST_COLLECTOR]: runs })),
      fetchHidden: /** @type {any} */ (async () => { throw new Error("VIEW 조회 실패"); }),
    });
    expect(g).toEqual({ runs, listRows: [{ id: 1, source: "daegu", as_of: "2026-09-30", batch_id: "b", batch_rows: 1 }], hiddenError: "VIEW 조회 실패" });
    const ok = await fetchGovlistHealthInputs({ sb: fakeSb({ unsold_gov_list: [] }), fetchRuns: /** @type {any} */ (async () => ({})), fetchHidden: /** @type {any} */ (async () => ({ viewHidden: 1, rawAsOf: [], live: null })) });
    expect(ok).toEqual({ runs: [], listRows: [], hidden: { viewHidden: 1, rawAsOf: [], live: null } });
  });
  it("세션693 B2 배선 — runDailyGuardedChecks 가 unsold-govlist 최근 실행 시각을 ㉔-d 에 넘긴다(굽기 뒤 반영이면 침묵 · 굽기 전이면 경보)", async () => {
    const now = new Date("2026-12-08T00:00:00Z"); // KST 12-08 09:00
    const hidden = { viewHidden: 58, rawAsOf: ["2026-11-30"], live: { fetchedAt: "2026-12-07T18:05:00Z", listHidden: 57 } };
    const go = (/** @type {string} */ at) => runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, now, fetchGovlistHealth: async () => ({ runs: [run(null, at)], listRows: [], hidden }) }));
    expect((await go("2026-12-07T20:30:00Z")).filter((i) => i.kind === "govlist-health")).toEqual([]);
    expect((await go("2026-12-07T18:00:00Z")).filter((i) => i.kind === "govlist-health").map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_HIDDEN_MISMATCH"]);
  });
  it("C4(B2c) 배선 — 「오늘 03시」 판정에 deps.now 를 쓴다(지난 날 now · 그날 굽기 → 비교해 경보 · 진짜 지금이면 낡은 굽기라 침묵했을 것)", async () => {
    const now = new Date("2020-01-02T00:00:00Z"); // KST 2020-01-02 09:00
    const hidden = { viewHidden: 3, rawAsOf: ["2019-12-31"], live: { fetchedAt: "2020-01-01T18:05:00Z", listHidden: 2 } }; // 굽기 KST 01-02 03:05
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, now, fetchGovlistHealth: async () => ({ runs: [], listRows: [], hidden }) }));
    expect(issues.filter((i) => i.kind === "govlist-health").map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_HIDDEN_MISMATCH"]);
  });
  it("세션696 B2(BACKLOG 442 adv-re2🟡1) — 운영 조회 fetchRegionUnresolvedRuns 가 ok_count 를 실어야 ㉔-d 가 굽기 뒤 partial+ok>0 실행을 「썼다」로 보고 건너뛴다", async () => {
    const rows = [{ collector: GOVLIST_COLLECTOR, status: "partial", error_message: null, finished_at: "2026-12-07T20:30:00Z", ok_count: 3 }];
    // select 한 칸만 돌려주는 가짜(PostgREST 와 같다 — 안 고른 칸은 안 온다)
    const sb = {
      from: () => {
        /** @type {string[]} */ let cols = [];
        /** @type {any} */ const api = {
          select: (/** @type {string} */ c) => { cols = c.split(",").map((s) => s.trim()); return api; },
          eq: () => api, order: () => api, limit: () => api,
          then: (/** @type {any} */ ok, /** @type {any} */ bad) => Promise.resolve({
            data: rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, /** @type {any} */ (r)[c]]))),
            error: null,
          }).then(ok, bad),
        };
        return api;
      },
    };
    const got = await fetchRegionUnresolvedRuns([GOVLIST_COLLECTOR], sb);
    const last = got[GOVLIST_COLLECTOR][0];
    expect(last.ok_count).toBe(3);
    const h = { viewHidden: 58, rawAsOf: ["2026-11-30"], live: { fetchedAt: "2026-12-07T18:05:00Z", listHidden: 57 } };
    expect(checkGovlistHiddenParity(h, new Date("2026-12-08T00:00:00Z"), last)).toEqual([]); // ok_count 가 빠지면 여기서 헛경보 1건
  });
  it("세션696 B4(BACKLOG 442 adv-re🟡2) — ㉔ 재료 조회가 실패하면 ㉔-d 도 침묵하지 않고 실행 실패 1건(㉔ 실패 1건과 따로)", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchGovlistHealth: async () => { throw new Error("collector_runs 조회 실패"); } }));
    expect(issues.filter((i) => i.kind === "check-failed").map((i) => i.detail.split(" 실행 실패")[0])).toEqual(["㉔ 지자체 명단 점검", "㉔-d 지자체 명단 비공개 수 대조"]);
  });
  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(checkGovlistSkips([run("GOVLIST_SKIP chungnam not_newer", "2026-12-08T00:00:00Z")])[0]);
    expect(text).toContain("<b>지자체 미분양 명단 수집 경고</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
    const h = formatIssue(hIssues([gov({ id: "x" })], new Date("2027-06-01T00:00:00Z"))[0]);
    expect(h).toContain("[조치]");
    expect(h).not.toContain("undefined");
  });
});
