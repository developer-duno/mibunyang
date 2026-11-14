// @ts-check
/**
 * 세션716 휴면 전 감시 보강 — ⑤-b 미발화 주 1회(M4) · ㉗ DSR 통과 칸 모양(M2) · ㉘ 카카오 첫 사이클(M3) · ㉙ 2u 글 링크(M5).
 * ⚠️ 날짜는 전부 밖에서 넣는다 — 실제 오늘에 기대면 날짜 창(11/17~12/03)이 지나는 날 시험 결과가 바뀐다.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkExternalApiStale,
  dedupKey,
  dedupScope,
  filterUnsent,
  isAlwaysDedup,
  kstWeekStart,
  checkDsrShape,
  fetchDsrShapeCounts,
  runDsrShapeCheck,
  checkKakaoDeferred,
  checkKakaoNullAfterCycle,
  fetchKakaoNullApts,
  runKakaoCycleCheck,
  INFRA_COLLECTOR,
  KAKAO_NULL_GRACE_DAYS,
  readLoanFilterPostHref,
  judgeLinkResponse,
  linkStateOf,
  runLoanFilterLinkCheck,
  LOAN_FILTER_POST_MARKER,
  LINK_RETRY_DELAY_MS,
  ALWAYS_DEDUP_KINDS,
} from "./monitor-collectors.mjs";
import { joinRunMessage } from "./collectors/_shared.mjs";
import { formatIssue } from "./notify-telegram.mjs";

// infra-kakao.mjs 는 KAKAO_KEY 가 없으면 import 순간 process.exit 한다 — 상수는 글자로 읽어 맞댄다(감시도 import 하지 않는다).
const INFRA_SRC = readFileSync(fileURLToPath(new URL("./collectors/infra-kakao.mjs", import.meta.url)), "utf8");
const INFRA_DEFERRED_MARKER = /export const INFRA_DEFERRED_MARKER = "([^"]+)";/.exec(INFRA_SRC)?.[1] ?? "";

/** KST 날짜·시각 → Date. @param {string} kst "YYYY-MM-DDTHH:MM" */
const atKst = (kst) => new Date(`${kst}:00+09:00`);

// ── M4 ⑤-b 미발화 주 1회 ───────────────────────────────────────────────
describe("⑤-b 미발화 주 1회(세션716 M4 · BACKLOG 427)", () => {
  const target = [{ collector: "lhzone-status", stale_days: 38, owner: "택지정보시스템" }];
  const runs = { "lhzone-status": [{ status: "success", ok_count: 5, skip_count: 0, finished_at: "2026-09-20T20:40:00Z" }] };

  it("kstWeekStart — KST 기준 그 주 월요일(UTC 날짜가 달라도)", () => {
    expect(kstWeekStart(atKst("2026-11-15T09:00"))).toBe("2026-11-09"); // 일
    expect(kstWeekStart(atKst("2026-11-16T00:30"))).toBe("2026-11-16"); // 월 0시 30분(UTC 로는 일요일)
    expect(kstWeekStart(atKst("2026-11-22T23:30"))).toBe("2026-11-16"); // 일 밤
    expect(kstWeekStart(atKst("2026-11-18T09:00"))).toBe("2026-11-16"); // 수
  });

  it("미발화 이슈에만 remindWeek 가 붙고 daily dedup 대상이 된다", () => {
    const [is] = checkExternalApiStale(target, runs, atKst("2026-11-18T09:00"));
    expect(is.kind).toBe("stale");
    expect(is.remindWeek).toBe("2026-11-16");
    expect(isAlwaysDedup(is)).toBe(true);
    expect(dedupScope([is], "daily")).toEqual([is]);
  });

  it("같은 사고 = 한 주에 한 번: 수~일 열쇠 같음 · 다음 월요일 열쇠 바뀜 · 마지막 실행이 바뀌면 열쇠 바뀜", () => {
    const keyOn = (/** @type {string} */ kst, r = runs) => dedupKey(checkExternalApiStale(target, r, atKst(kst))[0]);
    const wed = keyOn("2026-11-18T09:00");
    expect(keyOn("2026-11-22T09:00")).toBe(wed);
    const mon = keyOn("2026-11-23T09:00");
    expect(mon).not.toBe(wed);
    const r2 = { "lhzone-status": [{ ...runs["lhzone-status"][0], finished_at: "2026-09-21T20:40:00Z" }] };
    expect(keyOn("2026-11-18T09:00", r2)).not.toBe(wed);
  });

  it("main 의 거르기 흉내 — 이번 주에 이미 보낸 열쇠면 빠지고, 지난주 열쇠만 있으면 다시 나간다", () => {
    const thu = checkExternalApiStale(target, runs, atKst("2026-11-19T09:00"));
    const sentThisWeek = new Set([dedupKey(checkExternalApiStale(target, runs, atKst("2026-11-18T09:00"))[0])]);
    expect(filterUnsent(dedupScope(thu, "daily"), sentThisWeek)).toEqual([]);
    const mon = checkExternalApiStale(target, runs, atKst("2026-11-23T09:00"));
    expect(filterUnsent(dedupScope(mon, "daily"), sentThisWeek)).toHaveLength(1);
  });

  it("범위는 ⑤-b 미발화 하나 — ⑤-a 외부 중단·등재 뒤 행 0 은 remindWeek 없음(매일 리마인드 그대로)", () => {
    const outageRuns = {
      x: [0, 1, 2].map((d) => ({ status: "success", ok_count: 0, skip_count: 0, finished_at: new Date(Date.parse("2026-11-17T00:00:00Z") - d * 86400000 * 20).toISOString() })),
    };
    const outage = checkExternalApiStale([{ collector: "x", stale_days: 30, owner: "X" }], outageRuns, atKst("2026-11-18T09:00"));
    expect(outage.map((i) => i.kind)).toEqual(["outage"]);
    expect(outage[0].remindWeek).toBeUndefined();
    expect(isAlwaysDedup(outage[0])).toBe(false);
    const since = checkExternalApiStale([{ collector: "y", stale_days: 3, owner: "Y", since: "2026-11-01" }], {}, atKst("2026-11-18T09:00"));
    expect(since).toHaveLength(1);
    expect(since[0].remindWeek).toBeUndefined();
  });
});

// ── M2 ㉗ DSR 통과 칸 모양 ───────────────────────────────────────────────
describe("㉗ DSR 40% 통과 칸 모양(세션716 M2 · BACKLOG 411 ⑱)", () => {
  it("통과·미통과가 둘 다 있으면 침묵 · 표가 비면 침묵", () => {
    expect(checkDsrShape({ trueN: 900, falseN: 1500, total: 3400 })).toEqual([]);
    expect(checkDsrShape({ trueN: 0, falseN: 0, total: 0 })).toEqual([]);
  });
  it("전부 빈칸 / 전부 미통과 / 전부 통과 → 1건씩", () => {
    const allNull = checkDsrShape({ trueN: 0, falseN: 0, total: 3400 });
    expect(allNull.map((i) => i.kind)).toEqual(["dsr-shape"]);
    expect(allNull[0].detail).toContain("전부 빈칸");
    expect(checkDsrShape({ trueN: 0, falseN: 2400, total: 3400 })[0].detail).toContain("전부 미통과");
    expect(checkDsrShape({ trueN: 2400, falseN: 0, total: 3400 })[0].detail).toContain("전부 통과");
    expect(checkDsrShape({ trueN: 1, falseN: 0, total: 3400 })).toHaveLength(1);
    expect(checkDsrShape({ trueN: 1, falseN: 1, total: 3400 })).toEqual([]);
  });
  it("fetchDsrShapeCounts — apartments 에 dsr40pass=true · =false · 전체를 count head 로 세고, count=null·오류면 던진다", async () => {
    /** @type {Array<[string, unknown]>} */
    const eqs = [];
    const mk = (/** @type {Record<string, any>} */ ans) => ({
      from: (/** @type {string} */ t) => {
        expect(t).toBe("apartments");
        let key = "all";
        const q = {
          select: () => q,
          eq: (/** @type {string} */ c, /** @type {unknown} */ v) => { eqs.push([c, v]); key = String(v); return q; },
          then: (/** @type {any} */ res, /** @type {any} */ rej) => Promise.resolve(ans[key]).then(res, rej),
        };
        return q;
      },
    });
    const c = await fetchDsrShapeCounts(mk({ true: { count: 10 }, false: { count: 20 }, all: { count: 40 } }));
    expect(c).toEqual({ trueN: 10, falseN: 20, total: 40 });
    expect(eqs).toEqual([["dsr40pass", true], ["dsr40pass", false]]);
    await expect(fetchDsrShapeCounts(mk({ true: { count: null }, false: { count: 1 }, all: { count: 2 } }))).rejects.toThrow(/count=null/);
    await expect(fetchDsrShapeCounts(mk({ true: { error: { message: "boom" } }, false: { count: 1 }, all: { count: 2 } }))).rejects.toThrow(/boom/);
  });
  it("조회 실패는 실행 실패 1건(침묵하지 않음)", async () => {
    const is = await runDsrShapeCheck({ fetchCounts: async () => { throw new Error("db down"); } });
    expect(is.map((i) => i.kind)).toEqual(["check-failed"]);
  });
});

// ── M3 ㉘ 카카오 첫 사이클 ───────────────────────────────────────────────
describe("㉘ 카카오 첫 사이클 결과(세션716 M3 · BACKLOG A-27)", () => {
  const run = (/** @type {string} */ fin, /** @type {string|null} */ msg) => ({ status: "success", error_message: msg, finished_at: fin });
  // 11/17(화) 05:30 KST 회차 = UTC 11/16 20:30 시작
  const R5 = "2026-11-16T20:45:00Z";

  it("표식 글자는 수집기 상수와 같고, 수집기가 남기는 꼴(joinRunMessage) 그대로 읽힌다", () => {
    expect(INFRA_DEFERRED_MARKER).toBe("INFRA_DEFERRED=");
    const msg = /** @type {string} */ (joinRunMessage(undefined, `${INFRA_DEFERRED_MARKER}7`));
    expect(checkKakaoDeferred([run(R5, msg)], atKst("2026-11-18T09:00"))[0].detail).toContain("7곳");
    const joined = /** @type {string} */ (joinRunMessage("앞 표식", `${INFRA_DEFERRED_MARKER}12`));
    expect(checkKakaoDeferred([run(R5, joined)], atKst("2026-11-18T09:00"))[0].detail).toContain("12곳");
  });
  it("5회차 뒤 넘김 > 0 → 1건(at = 그 실행 시각 · 항상 dedup) · 0·표식 없음 → 침묵", () => {
    const is = checkKakaoDeferred([run(R5, "INFRA_DEFERRED=3")], atKst("2026-11-17T09:00"));
    expect(is.map((i) => i.kind)).toEqual(["kakao-cycle-deferred"]);
    expect(is[0].at).toBe(R5);
    expect(is[0].collector).toBe(INFRA_COLLECTOR);
    expect(isAlwaysDedup(is[0])).toBe(true);
    expect(ALWAYS_DEDUP_KINDS.has("kakao-cycle-null")).toBe(false);
    expect(checkKakaoDeferred([run(R5, "INFRA_DEFERRED=0")], atKst("2026-11-17T09:00"))).toEqual([]);
    expect(checkKakaoDeferred([run(R5, null)], atKst("2026-11-17T09:00"))).toEqual([]);
  });
  it("창 밖이면 침묵 — 5회차 전 실행만 있음 · 오늘이 11/17 05시 전 · 12/04 뒤", () => {
    expect(checkKakaoDeferred([run("2026-11-13T21:00:00Z", "INFRA_DEFERRED=640")], atKst("2026-11-18T09:00"))).toEqual([]);
    expect(checkKakaoDeferred([run(R5, "INFRA_DEFERRED=3")], atKst("2026-11-17T04:00"))).toEqual([]);
    expect(checkKakaoDeferred([run("2026-12-01T20:45:00Z", "INFRA_DEFERRED=3")], atKst("2026-12-04T09:00"))).toEqual([]);
    expect(checkKakaoDeferred([run("2026-12-01T20:45:00Z", "INFRA_DEFERRED=3")], atKst("2026-12-03T09:00"))).toHaveLength(1);
  });
  it("창 안 가장 최근 실행만 본다 — 6회차가 0 이면 5회차의 넘김으로 울리지 않는다", () => {
    const runs = [run("2026-11-19T20:45:00Z", null), run(R5, "INFRA_DEFERRED=5")];
    expect(checkKakaoDeferred(runs, atKst("2026-11-21T09:00"))).toEqual([]);
  });

  const old = "2026-10-01T00:00:00Z";
  it("시계 빈칸 — 11/18 전엔 침묵 · 좌표 있고 오래된 단지만 센다(좌표 없음·새 단지 뺌 · 만든 날 모르면 셈)", () => {
    const input = {
      nullTotal: 5,
      truncated: false,
      apts: [
        { id: "a-old", lat: 37.5, lng: 127.0, created_at: old },
        { id: "b-nocoord", lat: null, lng: 127.0, created_at: old },
        { id: "c-new", lat: 37.5, lng: 127.0, created_at: new Date(atKst("2026-11-18T09:00").getTime() - (KAKAO_NULL_GRACE_DAYS - 1) * 86400000).toISOString() },
        { id: "d-nodate", lat: 37.5, lng: 127.0, created_at: null },
        { id: "e-zero", lat: 0, lng: 127.0, created_at: old },
      ],
    };
    expect(checkKakaoNullAfterCycle(input, atKst("2026-11-17T23:00"))).toEqual([]);
    const is = checkKakaoNullAfterCycle(input, atKst("2026-11-18T09:00"));
    expect(is.map((i) => i.kind)).toEqual(["kakao-cycle-null"]);
    expect(is[0].detail).toContain("2곳");
    expect(is[0].lines?.[0]).toContain("a-old, d-nodate");
    expect(isAlwaysDedup(is[0])).toBe(true); // 보완 F1 뒤 — 같은 명단은 주 1회(remindWeek)
  });
  it("시계 빈칸 — 걸리는 단지 0 이면 침묵 · 1,000행 넘게 비면 「앞 1,000행만」 표기", () => {
    expect(checkKakaoNullAfterCycle({ nullTotal: 0, truncated: false, apts: [] }, atKst("2026-11-20T09:00"))).toEqual([]);
    const is = checkKakaoNullAfterCycle({ nullTotal: 1500, truncated: true, apts: [{ id: "x", lat: 1, lng: 1, created_at: old }] }, atKst("2026-11-20T09:00"));
    expect(is[0].detail).toContain("앞 1,000행만");
  });
  it("fetchKakaoNullApts — 빈 행 0 이면 더 묻지 않고, 아니면 apartments 를 200개씩 나눠 좌표·만든 날을 읽는다", async () => {
    /** @type {string[]} */
    const calls = [];
    const mk = (/** @type {number} */ nullCount, /** @type {string[]} */ ids) => ({
      from: (/** @type {string} */ t) => {
        /** @type {any} */
        const st = { t, head: false, inIds: null };
        const q = {
          select: (/** @type {string} */ _c, /** @type {any} */ o) => { st.head = Boolean(o?.head); return q; },
          is: () => q,
          order: () => q,
          limit: () => q,
          in: (/** @type {string} */ _c, /** @type {string[]} */ v) => { st.inIds = v; return q; },
          then: (/** @type {any} */ res, /** @type {any} */ rej) => {
            calls.push(`${t}${st.head ? ":head" : ""}${st.inIds ? `:in${st.inIds.length}` : ""}`);
            if (t === "infra" && st.head) return Promise.resolve({ count: nullCount }).then(res, rej);
            if (t === "infra") return Promise.resolve({ data: ids.map((id) => ({ apartment_id: id })) }).then(res, rej);
            return Promise.resolve({ data: st.inIds.map((/** @type {string} */ id) => ({ id, lat: 1, lng: 1, created_at: old })) }).then(res, rej);
          },
        };
        return q;
      },
    });
    expect(await fetchKakaoNullApts(mk(0, []))).toEqual({ nullTotal: 0, truncated: false, apts: [] });
    expect(calls).toEqual(["infra:head"]);
    calls.length = 0;
    const ids = Array.from({ length: 250 }, (_, i) => `id${String(i).padStart(3, "0")}`);
    const r = await fetchKakaoNullApts(mk(250, ids));
    expect(r.apts).toHaveLength(250);
    expect(r.truncated).toBe(false);
    expect(calls).toEqual(["infra:head", "infra", "apartments:in200", "apartments:in50"]);
  });
  it("runKakaoCycleCheck — (a) 조회 실패가 (b) 를 막지 않는다 · 11/17 전엔 아무것도 묻지 않는다", async () => {
    const fetchNullApts = vi.fn(async () => ({ nullTotal: 1, truncated: false, apts: [{ id: "x", lat: 1, lng: 1, created_at: old }] }));
    const is = await runKakaoCycleCheck({
      now: atKst("2026-11-18T09:00"),
      fetchRuns: async () => { throw new Error("runs down"); },
      fetchNullApts,
    });
    expect(is.map((i) => i.kind)).toEqual(["check-failed", "kakao-cycle-null"]);
    const fetchRuns = vi.fn(async () => ({}));
    const early = vi.fn(async () => ({ nullTotal: 0, truncated: false, apts: [] }));
    expect(await runKakaoCycleCheck({ now: atKst("2026-11-16T09:00"), fetchRuns, fetchNullApts: early })).toEqual([]);
    expect(fetchRuns).not.toHaveBeenCalled();
    expect(early).not.toHaveBeenCalled();
  });
});

// ── M5 ㉙ 2u 글 링크 ───────────────────────────────────────────────
describe("㉙ 2u 대출 거르기 글 링크 생존(세션716 M5 · BACKLOG 439)", () => {
  const FP = readFileSync(fileURLToPath(new URL("../src/components/detail/FundingPlanner.tsx", import.meta.url)), "utf8");
  const POST = `<title>대출이 급할 때, ${LOAN_FILTER_POST_MARKER} 걸러 내는 법</title>`;

  it("주소는 화면 상수에서 글자로 읽는다(= 지금 상수) · 화면 글 제목도 표식 글자를 담는다 · CRLF 도 읽고 없으면 던진다", () => {
    expect(readLoanFilterPostHref()).toBe("https://2u.pe.kr/blog/illegal-loan-filter");
    const label = /const LOAN_FILTER_POST = \{[\s\S]*?label: "([^"]+)"/.exec(FP)?.[1] ?? "";
    expect(label).toContain(LOAN_FILTER_POST_MARKER);
    expect(readLoanFilterPostHref('const LOAN_FILTER_POST = {\r\n  href: "https://example.com/a",\r\n')).toBe("https://example.com/a");
    expect(() => readLoanFilterPostHref("const OTHER = {}")).toThrow(/LOAN_FILTER_POST/);
  });
  it("감시는 FundingPlanner.tsx 를 import 하지 않는다(로더 없는 node 에서 감시 전체가 죽는다)", () => {
    const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
    expect(src).not.toMatch(/^import[^\n]*FundingPlanner/m);
    expect(src).not.toMatch(/import\([^)]*FundingPlanner/);
  });
  it("judgeLinkResponse — 200+표식 = 정상 · 404 · 200 인데 다른 장 · 요청 실패", () => {
    expect(judgeLinkResponse({ status: 200, text: POST })).toBeNull();
    expect(judgeLinkResponse({ status: 404, text: POST })).toBe("HTTP 404");
    expect(judgeLinkResponse({ status: 200, text: "<title>아파트 실거래가 조회</title>" })).toContain("없음");
    expect(judgeLinkResponse({ error: "fetch failed" })).toContain("fetch failed");
  });

  /** @param {number} status @param {string} text */
  const res = (status, text) => /** @type {any} */ ({ status, text: async () => text });
  it("첫 시도 정상 → 침묵 · 한 번만 묻는다", async () => {
    const fetchImpl = vi.fn(async () => res(200, POST));
    const sleep = vi.fn(async () => {});
    expect(await runLoanFilterLinkCheck({ readHref: () => "https://x/y", fetchImpl: /** @type {any} */ (fetchImpl), sleep })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("일시 오류 1회(첫 실패·재시도 정상) → 침묵 · 5초 쉬고 다시", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(res(200, POST));
    const sleep = vi.fn(async () => {});
    expect(await runLoanFilterLinkCheck({ readHref: () => "https://x/y", fetchImpl: /** @type {any} */ (fetchImpl), sleep })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(LINK_RETRY_DELAY_MS);
    expect(LINK_RETRY_DELAY_MS).toBe(5000);
  });
  it("두 번 다 이상(404·다른 장·예외) → link-dead 1건", async () => {
    const sleep = async () => {};
    const dead = await runLoanFilterLinkCheck({ readHref: () => "https://x/y", fetchImpl: /** @type {any} */ (async () => res(404, "")), sleep });
    expect(dead.map((i) => i.kind)).toEqual(["link-dead"]);
    expect(dead[0].detail).toContain("https://x/y");
    const soft = await runLoanFilterLinkCheck({ readHref: () => "https://x/y", fetchImpl: /** @type {any} */ (async () => res(200, "home")), sleep });
    expect(soft.map((i) => i.kind)).toEqual(["link-dead"]);
    const thrown = await runLoanFilterLinkCheck({ readHref: () => "https://x/y", fetchImpl: /** @type {any} */ (async () => { throw new Error("ENOTFOUND"); }), sleep });
    expect(thrown[0].detail).toContain("ENOTFOUND");
  });
  it("주소를 못 읽으면 실행 실패 1건", async () => {
    const is = await runLoanFilterLinkCheck({ readHref: () => { throw new Error("no href"); } });
    expect(is.map((i) => i.kind)).toEqual(["check-failed"]);
  });
});

describe("새 종류 4개는 텔레그램 제목·그림·조치를 갖는다", () => {
  it.each(["dsr-shape", "kakao-cycle-deferred", "kakao-cycle-null", "link-dead"])("%s", (kind) => {
    const t = formatIssue(/** @type {any} */ ({ kind, collector: "c", detail: "d" }));
    expect(t).not.toContain("undefined");
    expect(t).toContain("[조치]");
  });
});

describe("main 배선 — ㉗·㉘·㉙ 를 daily 에서 부른다", () => {
  it("세 run 함수를 issues 에 합친다(좌변까지 고정 — 선언부에 안 걸리게)", () => {
    const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
    const main = src.slice(src.indexOf("async function main()"));
    expect(main).toMatch(/\n\s*issues = issues\.concat\(await runDsrShapeCheck\(\)\);/);
    expect(main).toMatch(/\n\s*issues = issues\.concat\(await runKakaoCycleCheck\(\)\);/);
    expect(main).toMatch(/\n\s*issues = issues\.concat\(await runLoanFilterLinkCheck\(\)\);/);
  });
});

// ── 세션716 보완 F1·F2 — 휴면 중 같은 알림이 매일 울려 진짜 알림을 묻지 않게(주 1회 · 바뀌면 즉시) ─────
describe("보완 F1 ㉘(b) 같은 명단은 주 1회 · 명단이 바뀌면 즉시", () => {
  const old = "2026-10-01T00:00:00Z";
  const apt = (/** @type {string} */ id) => ({ id, lat: 37.5, lng: 127.0, created_at: old });
  const input = (/** @type {string[]} */ ids) => ({ nullTotal: ids.length, truncated: false, apts: ids.map(apt) });
  const keyOn = (/** @type {string[]} */ ids, /** @type {string} */ kst) => dedupKey(checkKakaoNullAfterCycle(input(ids), atKst(kst))[0]);

  it("이슈는 daily dedup 대상이고 열쇠에 명단 지문이 들어간다(시각 아님)", () => {
    const [is] = checkKakaoNullAfterCycle(input(["a", "b"]), atKst("2026-11-18T09:00"));
    expect(isAlwaysDedup(is)).toBe(true);
    expect(is.at).toMatch(/^ids:[0-9a-f]{8}$/);
    expect(is.remindWeek).toBe("2026-11-16");
  });
  it("같은 명단 이틀 연속 → 둘째 날 조용(이미 보낸 열쇠)", () => {
    const sent = new Set([keyOn(["a", "b"], "2026-11-18T09:00")]);
    const thu = checkKakaoNullAfterCycle(input(["a", "b"]), atKst("2026-11-19T09:00"));
    expect(filterUnsent(dedupScope(thu, "daily"), sent)).toEqual([]);
  });
  it("다음 월요일 → 다시 알림", () => {
    expect(keyOn(["a", "b"], "2026-11-23T09:00")).not.toBe(keyOn(["a", "b"], "2026-11-18T09:00"));
  });
  it("명단에 단지 1곳 추가 → 그날 바로 알림(열쇠 다름)", () => {
    expect(keyOn(["a", "b", "c"], "2026-11-19T09:00")).not.toBe(keyOn(["a", "b"], "2026-11-19T09:00"));
  });
  it("명단 순서만 다름 → 같은 열쇠", () => {
    expect(keyOn(["b", "a"], "2026-11-19T09:00")).toBe(keyOn(["a", "b"], "2026-11-19T09:00"));
  });
});

describe("보완 F2 ㉙ 같은 상태는 주 1회 · 상태가 바뀌면 즉시", () => {
  /** @param {number} status @param {string} text */
  const res = (status, text) => /** @type {any} */ ({ status, text: async () => text });
  const sleep = async () => {};
  /** @param {() => Promise<any>} f @param {string} kst */
  const run = async (f, kst) => (await runLoanFilterLinkCheck({ readHref: () => "https://x/y", fetchImpl: /** @type {any} */ (f), sleep, now: atKst(kst) }))[0];

  it("죽은 링크 이슈는 daily dedup 대상 · 열쇠 = 주소 + 2차 상태", async () => {
    const is = await run(async () => res(404, ""), "2026-11-18T09:00");
    expect(isAlwaysDedup(is)).toBe(true);
    expect(is.at).toBe("link:https://x/y|http:404");
    expect(linkStateOf({ status: 404, text: "" })).toBe("http:404");
    expect(linkStateOf({ status: 200, text: "x" })).toBe("no-marker");
    expect(linkStateOf({ error: "a" })).toBe("error");
  });
  it("같은 상태 이틀 연속 → 같은 열쇠(둘째 날 조용) · 다음 월요일 → 다른 열쇠", async () => {
    const wed = dedupKey(await run(async () => res(404, ""), "2026-11-18T09:00"));
    const thu = await run(async () => res(404, ""), "2026-11-19T09:00");
    expect(filterUnsent(dedupScope([thu], "daily"), new Set([wed]))).toEqual([]);
    expect(dedupKey(await run(async () => res(404, ""), "2026-11-23T09:00"))).not.toBe(wed);
  });
  it("상태가 바뀌면 같은 주라도 그날 바로(404 → 다른 장) · 오류 글자만 다르면 같은 상태", async () => {
    const a = dedupKey(await run(async () => res(404, ""), "2026-11-18T09:00"));
    const b = dedupKey(await run(async () => res(200, "home"), "2026-11-19T09:00"));
    expect(b).not.toBe(a);
    const e1 = dedupKey(await run(async () => { throw new Error("timeout after 20000ms"); }, "2026-11-18T09:00"));
    const e2 = dedupKey(await run(async () => { throw new Error("ECONNRESET"); }, "2026-11-19T09:00"));
    expect(e2).toBe(e1);
  });
});
