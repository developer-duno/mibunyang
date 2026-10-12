// @ts-check
/**
 * 감시 ㉑ 청약홈 공고 정리 경고 표식 (세션632 · BACKLOG 세션631 후속 ⓒ)
 * 수집기 collect-applyhome-detail.mjs 가 성공 실행에도 error_message 에 남기는 NTC_SKIP·NTC_UNRESOLVED·NTC_NO_EVIDENCE·NTC_MANUAL_MISSING 을 읽는다.
 * 메시지는 수집기와 같은 꼴(표식들을 " · " 로 이음 · 실패 실행이면 실패 문구가 맨 앞)로 만든다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkNoticeMarkers,
  parseNoticeMarkers,
  isCleanNoticeRun,
  NOTICE_MARKER_COLLECTOR,
  NOTICE_MARKER_MEANINGS,
  runDailyGuardedChecks,
  isAlwaysDedup,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

/** 수집기 :1253 성공 기록과 같은 이음 */
const join = (/** @type {string[]} */ marks) => marks.join(" · ");
/**
 * @param {string | null} msg
 * @param {string} at
 * @param {string} [status]
 */
const run = (msg, at, status = "success") => ({ status, error_message: msg, finished_at: at });

describe("parseNoticeMarkers", () => {
  it("성공 표식 4종을 수집기가 남긴 순서대로 뽑는다", () => {
    expect(parseNoticeMarkers(join(["NTC_SKIP 일정 표 1940행 ≠ count 1941", "NTC_UNRESOLVED 2", "NTC_NO_EVIDENCE 3", "NTC_MANUAL_MISSING 2025000001>ap-1+ap-2"]))).toEqual([
      { name: "SKIP", value: "일정 표 1940행 ≠ count 1941" },
      { name: "UNRESOLVED", value: "2" },
      { name: "NO_EVIDENCE", value: "3" },
      { name: "MANUAL_MISSING", value: "2025000001>ap-1+ap-2" },
    ]);
  });

  it("null·빈칸·다른 수집기 표식은 빈 배열", () => {
    expect(parseNoticeMarkers(null)).toEqual([]);
    expect(parseNoticeMarkers("")).toEqual([]);
    expect(parseNoticeMarkers("REGION_UNRESOLVED n=2: 전남광주")).toEqual([]);
    // 조각 머리에서만 읽는다 — 실패 문구 본문에 박힌 글자는 표식이 아니다(세션632 적대 M7)
    expect(parseNoticeMarkers("NTC_BREAKER 지움 31 > 30 — NTC_UNRESOLVED 9 를 본 뒤 --apply-from 으로")).toEqual([]);
  });
});

describe("checkNoticeMarkers — 최신 실행 1행", () => {
  const T1 = "2026-10-05T03:31:00Z";
  const T2 = "2026-10-12T03:31:00Z";

  it("UNRESOLVED 만 → 1건(머리말·뜻·최근 실행 KST)", () => {
    const issues = checkNoticeMarkers([run("NTC_UNRESOLVED 2", T2)]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "notice-markers", collector: "applyhome-detail" });
    expect(issues[0].detail).toBe("NTC_MARKERS 청약홈 공고 정리 경고 — UNRESOLVED 2");
    expect(issues[0].lines).toEqual([`UNRESOLVED 2 — ${NOTICE_MARKER_MEANINGS.UNRESOLVED}`, "최근 실행: 10/12 12:31 KST"]);
  });

  it("SKIP 만 → 이유가 상세 줄에", () => {
    const [i] = checkNoticeMarkers([run("NTC_SKIP 중단 신호", T2)]);
    expect(i.detail).toBe("NTC_MARKERS 청약홈 공고 정리 경고 — SKIP");
    expect(i.lines?.[0]).toBe(`SKIP(중단 신호) — ${NOTICE_MARKER_MEANINGS.SKIP}`);
  });

  it("NO_EVIDENCE 만 → 1건", () => {
    const [i] = checkNoticeMarkers([run("NTC_NO_EVIDENCE 7", T2)]);
    expect(i.detail).toBe("NTC_MARKERS 청약홈 공고 정리 경고 — NO_EVIDENCE 7");
  });

  it("MANUAL_MISSING 만 → 공고 수 + 명단(5개 넘으면 외 N건)", () => {
    const items = ["H1>a", "H2>b", "H3>c", "H4>d", "H5>e", "H6>f+g"];
    const [i] = checkNoticeMarkers([run(`NTC_MANUAL_MISSING ${items.join(",")}`, T2)]);
    expect(i.detail).toBe("NTC_MARKERS 청약홈 공고 정리 경고 — MANUAL_MISSING 6");
    expect(i.lines?.[0]).toBe(`MANUAL_MISSING 6 — ${NOTICE_MARKER_MEANINGS.MANUAL_MISSING}: H1>a, H2>b, H3>c, H4>d, H5>e 외 1건`);
  });

  it("여럿 동시 → 한 건에 고정 순서(SKIP·UNRESOLVED·NO_EVIDENCE·MANUAL_MISSING)", () => {
    const [i] = checkNoticeMarkers([run(join(["NTC_MANUAL_MISSING H1>a", "NTC_UNRESOLVED 1", "NTC_SKIP 후보 10행 ≠ apartments count 11"]), T2)]);
    expect(i.detail).toBe("NTC_MARKERS 청약홈 공고 정리 경고 — SKIP · UNRESOLVED 1 · MANUAL_MISSING 1");
    expect(i.lines).toHaveLength(4);
  });

  it("최신 실행에 표식 없음 → [] · 실행 없음 → []", () => {
    expect(checkNoticeMarkers([run(null, T2)])).toEqual([]);
    expect(checkNoticeMarkers([])).toEqual([]);
  });

  it("직전 실행에만 표식 → [] (최신만 본다)", () => {
    expect(checkNoticeMarkers([run(null, T2), run("NTC_UNRESOLVED 2", T1)])).toEqual([]);
  });

  it("최신이 failure + 성공 표식 없음 → []", () => {
    expect(checkNoticeMarkers([run("NTC_WRITE units boom — 지우기 도중 멈춤(일정·평형·분양가 upsert 안 함)", T2, "failure"), run("NTC_UNRESOLVED 2", T1)])).toEqual([]);
  });

  it("실패 표식만(NTC_BREAKER · NTC_PLAN_MISMATCH 안의 ' · ') → []", () => {
    expect(checkNoticeMarkers([run("NTC_BREAKER 지우는 일정 행 40/1940 = 2.1% — 한도(30행 또는 10%) 초과 — 명단을 승인받은 뒤 --apply-from 으로", T2, "failure")])).toEqual([]);
    expect(checkNoticeMarkers([run("NTC_PLAN_MISMATCH 승인한 계획 파일과 지금 계획이 다르다 — 지금만 1 · 파일에만 2. 미리보기(--out)를 다시 떠서 승인받으세요", T2, "failure")])).toEqual([]);
    expect(checkNoticeMarkers([run("NTC_ERROR 판정 파일 깨짐 — API 호출 전에 멈춤", T2, "failure")])).toEqual([]);
  });

  it("최신이 failure 라도 뒤에 붙은 성공 표식은 읽는다(수집기 :1250 [failNote, ...marks])", () => {
    const [i] = checkNoticeMarkers([run(join(["NTC_BREAKER 지우는 일정 행 40/1940 = 2.1% — 한도 초과 — 명단을 승인받은 뒤 --apply-from 으로", "NTC_UNRESOLVED 3"]), T2, "failure")]);
    expect(i.detail).toBe("NTC_MARKERS 청약홈 공고 정리 경고 — UNRESOLVED 3");
    expect(i.lines?.at(-1)).toBe("최근 실행: 10/12 12:31 KST (failure)");
  });
});

describe("checkNoticeMarkers — dedup 구간", () => {
  const T0 = "2026-09-28T03:31:00Z";
  const T1 = "2026-10-05T03:31:00Z";
  const T2 = "2026-10-12T03:31:00Z";
  const at = (/** @type {any[]} */ runs) => String(checkNoticeMarkers(runs)[0].at);

  it("같은 내용 2회 연속 → 같은 지문(구간 시작 = 첫 회차)", () => {
    const a = at([run("NTC_UNRESOLVED 2", T1), run(null, T0)]);
    const b = at([run("NTC_UNRESOLVED 2", T2), run("NTC_UNRESOLVED 2", T1), run(null, T0)]);
    expect(b).toBe(a);
    expect(b.endsWith(`@${T1}`)).toBe(true);
  });

  it("사이에 깨끗한 실행 → 다른 지문(구간이 새로 시작)", () => {
    const a = at([run("NTC_UNRESOLVED 2", T0)]);
    const b = at([run("NTC_UNRESOLVED 2", T2), run(null, T1), run("NTC_UNRESOLVED 2", T0)]);
    expect(b).not.toBe(a);
    expect(b.endsWith(`@${T2}`)).toBe(true);
  });

  it("표식 없는 실패 실행은 구간을 끊지 않는다", () => {
    const b = at([run("NTC_UNRESOLVED 2", T2), run("NTC_WRITE x", T1, "failure"), run("NTC_UNRESOLVED 2", T0)]);
    expect(b.endsWith(`@${T0}`)).toBe(true);
  });

  it("내용이 바뀌면 다른 지문", () => {
    expect(at([run("NTC_UNRESOLVED 3", T2)]).split("@")[0]).not.toBe(at([run("NTC_UNRESOLVED 2", T2)]).split("@")[0]);
  });

  it("isCleanNoticeRun — success + 표식 없음만 깨끗", () => {
    expect(isCleanNoticeRun({ status: "success", error_message: null })).toBe(true);
    expect(isCleanNoticeRun({ status: "success", error_message: "NTC_NO_EVIDENCE 1" })).toBe(false);
    expect(isCleanNoticeRun({ status: "failure", error_message: null })).toBe(false);
  });

  it("daily 에서도 dedup(ALWAYS_DEDUP_KINDS)", () => {
    expect(isAlwaysDedup(checkNoticeMarkers([run("NTC_UNRESOLVED 2", T2)])[0])).toBe(true);
  });
});

describe("㉑ 배선", () => {
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    fetchTradeDeals: async () => ({ empty: true, rows: /** @type {Array<Record<string, any>>} */ ([]), tradesCounts: {}, latest: "202609", prev: "202608" }),
    fetchTradeLinks: async () => ({ links: /** @type {Array<Record<string, any>>} */ ([]), apts: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: null }),
    fetchSgisMapRun: async () => [],
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };

  it("runDailyGuardedChecks 가 applyhome-detail 최근 행을 물어 ㉑ 이슈를 싣는다", async () => {
    /** @type {string[][]} */
    const asked = [];
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchNoticeRuns: async (/** @type {readonly string[]} */ names) => { asked.push([...names]); return { "applyhome-detail": [run("NTC_UNRESOLVED 2", "2026-10-12T03:31:00Z")] }; },
    }));
    expect(asked).toEqual([["applyhome-detail"]]);
    expect(issues.filter((i) => i.kind === "notice-markers")).toHaveLength(1);
    expect(issues.filter((i) => i.kind === "check-failed")).toEqual([]);
  });

  it("수집기 PHASE·표식 문구·이음이 감시와 같다(한쪽만 바뀌면 빨강)", () => {
    const src = readFileSync(fileURLToPath(new URL("./collectors/collect-applyhome-detail.mjs", import.meta.url)), "utf8");
    expect(src).toContain(`const PHASE = "${NOTICE_MARKER_COLLECTOR}";`);
    // 표식 배열 안의 글자만(앞 `[`) — 같은 글자가 logError 줄에도 있어 그것만으로는 표식 이름 변경을 못 잡는다(세션632 적대 M1)
    for (const name of Object.keys(NOTICE_MARKER_MEANINGS)) expect(src).toContain(`[\`NTC_${name} \${`);
    expect(src).toContain('errorMessage: marks.length ? marks.join(" · ") : null');
    // failure 기록 두 길도 같은 이음 — 바뀌면 실패 실행의 성공 표식이 조용히 사라진다(세션632 적대 M6)
    expect(src).toContain('errorMessage: [failNote, ...marks].join(" · ")');
    expect(src).toContain('errorMessage: [note, ...noticeMarkers()].join(" · ")');
  });

  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(checkNoticeMarkers([run("NTC_UNRESOLVED 2", "2026-10-12T03:31:00Z")])[0]);
    expect(text).toContain("<b>청약홈 공고 정리 경고 표식</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});
