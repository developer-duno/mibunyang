// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkLocalFailures,
  LOCAL_FAILURE_RATIO_LIMIT,
  LOCAL_FAILURE_WINDOW_HOURS,
  ALWAYS_DEDUP_KINDS,
  isAlwaysDedup,
  dedupKey,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

// 감시 ⑬ 로컬 수집기 실패 명단(세션570). collector_runs.status=failure 는 ①(GitHub 만)·②(success 만)·
// ⑤(신선도만) 어디에도 안 보여 10/09 미분양 러너의 차단기 failure 도 무음이었다.
// 대조군 = 2026-09-24 48시간 실측 행(naver-presale failure 1297/4 · naver-collect partial 11464/skip 419).

const NOW = new Date("2026-09-24T09:00:00Z");
/** @param {number} hoursAgo */
const at = (hoursAgo) => new Date(NOW.getTime() - hoursAgo * 3600000).toISOString();

describe("checkLocalFailures — 판정", () => {
  it("양성: kosis-unsold 차단기 failure(ok 0) → 1건", () => {
    const issues = checkLocalFailures(
      [{ collector: "kosis-unsold", status: "failure", ok_count: 0, fail_count: 0, error_message: "[차단기] 0 으로 덮을 행 11곳", finished_at: at(2) }],
      { now: NOW },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "local-failure", collector: "kosis-unsold", at: at(2) });
    expect(issues[0].detail).toContain("성공 0 · 실패 0");
    expect(issues[0].detail).toContain("[차단기]");
  });

  it("양성: naver-pipeline 치명 단계 실패(STEP_FAILED 2/6, ok 1 · fail 1 = 50%) → 1건", () => {
    const issues = checkLocalFailures(
      [{ collector: "naver-pipeline", status: "failure", ok_count: 1, fail_count: 1, error_message: "STEP_FAILED: 2/6 sync-naver", finished_at: at(1) }],
      { now: NOW },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("STEP_FAILED: 2/6 sync-naver");
  });

  it("음성: naver-presale 4/1301(0.3%) 실측 행은 울리지 않는다", () => {
    expect(checkLocalFailures(
      [{ collector: "naver-presale", status: "failure", ok_count: 1297, fail_count: 4, error_message: "", finished_at: "2026-09-24T05:41:57.132192+00:00" }],
      { now: NOW },
    )).toEqual([]);
  });

  it("음성: naver-collect partial(시간 상한 정상 중단) · success 행", () => {
    expect(checkLocalFailures([
      { collector: "naver-collect", status: "partial", ok_count: 0, fail_count: 0, finished_at: "2026-09-24T01:00:13.198336+00:00" },
      { collector: "schools", status: "success", ok_count: 0, fail_count: 5, finished_at: at(3) },
    ], { now: NOW })).toEqual([]);
  });

  it("경계: 실패 비율이 정확히 10% 면 울리고, 그 바로 아래는 침묵", () => {
    expect(LOCAL_FAILURE_RATIO_LIMIT).toBe(0.1);
    expect(checkLocalFailures([{ collector: "x", status: "failure", ok_count: 90, fail_count: 10, finished_at: at(1) }], { now: NOW })).toHaveLength(1);
    expect(checkLocalFailures([{ collector: "x", status: "failure", ok_count: 91, fail_count: 10, finished_at: at(1) }], { now: NOW })).toHaveLength(0);
  });

  it("창: 26시간 안은 울리고 밖은 침묵 · finished_at 없는 행은 건너뛴다", () => {
    expect(LOCAL_FAILURE_WINDOW_HOURS).toBe(26);
    const row = (/** @type {number} */ h) => ({ collector: "x", status: "failure", ok_count: 0, fail_count: 1, finished_at: at(h) });
    expect(checkLocalFailures([row(25.9)], { now: NOW })).toHaveLength(1);
    expect(checkLocalFailures([row(26.1)], { now: NOW })).toHaveLength(0);
    expect(checkLocalFailures([{ collector: "x", status: "failure", ok_count: 0, fail_count: 1, finished_at: null }], { now: NOW })).toHaveLength(0);
  });

  it("error_message 는 앞 80자만", () => {
    const [i] = checkLocalFailures([{ collector: "x", status: "failure", ok_count: 0, fail_count: 1, error_message: "가".repeat(200), finished_at: at(1) }], { now: NOW });
    expect(i.detail).toContain("가".repeat(80));
    expect(i.detail).not.toContain("가".repeat(81));
  });
});

describe("⑬ 알림 형태·dedup", () => {
  const [issue] = checkLocalFailures(
    [{ collector: "kosis-unsold", status: "failure", ok_count: 0, fail_count: 0, error_message: "차단기", finished_at: at(2) }],
    { now: NOW },
  );

  it("daily 에서도 dedup — 같은 행(finished_at)은 이튿날 창이 겹쳐도 한 번만", () => {
    expect(ALWAYS_DEDUP_KINDS.has("local-failure")).toBe(true);
    expect(isAlwaysDedup(issue)).toBe(true);
    expect(dedupKey(issue)).toBe(`local-failure|kosis-unsold|${at(2)}`);
  });

  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(issue);
    expect(text).toContain("🛑 <b>로컬 수집기 실패</b>");
    expect(text).toContain("kosis-unsold");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});

describe("⑬ 배선 (소스)", () => {
  const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("runDailyGuardedChecks 안에서 fail-open 으로 돈다(⑫ 다음)", () => {
    const body = src.slice(src.indexOf("export async function runDailyGuardedChecks"));
    const end = body.indexOf("\n}");
    const fn = body.slice(0, end);
    expect(fn).toContain('runFailOpenCheck("⑬ 로컬 수집기 실패 점검"');
    expect(fn.indexOf("⑬ 로컬 수집기 실패 점검")).toBeGreaterThan(fn.indexOf("⑫ 청약홈 미분양 값 점검"));
    expect(fn).toContain("checkLocalFailures(");
  });

  it("Issue.kind 에 local-failure 가 있다", () => {
    const full = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
    expect(full).toMatch(/@property \{[^}]*"local-failure"[^}]*\} kind/);
  });
});
