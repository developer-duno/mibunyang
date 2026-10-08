// @ts-check
/**
 * 감시 ⑱ checkSgisMapMarkers 시험 — SGIS 행정동 매핑의 첫 회차 대기·시도 불일치 표시를 읽는다(세션614 보완 W2).
 *
 * 왜: 관문 대기 실행은 매주 success·skip 1 행을 남겨 ⑤(checkExternalApiStale)가 못 본다 —
 *   ⑤-a 는 skip>0 를 건너뛰고, 행이 있으니 ⑤-b·등재 뒤 행 0 도 안 걸린다(검사관이 4행으로 재현).
 * 설계서 `.omc/artifacts/session614/plan-sgis-map-emd.md` · 보완 지시서 `brief-fix-1.md` W2
 */
import { describe, it, expect } from "vitest";
import {
  checkSgisMapMarkers, checkExternalApiStale, EXTERNAL_API_COLLECTORS, SGIS_MAP_COLLECTOR, isAlwaysDedup, fetchSgisMapLatestRun,
} from "./monitor-collectors.mjs";
import { formatSgisSidoMismatch, SGIS_FIRST_RUN_PENDING_MARKER } from "./collectors/_shared.mjs";
import { formatIssue } from "./notify-telegram.mjs";

const TARGETS = [{ collector: "sgis-map-emd", stale_days: 14, since: "2026-10-08", owner: "SGIS 좌표→행정동 매핑" }];
/** 화요일마다 관문 대기 1행(최신이 앞) — 5개월 */
const pendingRows = [
  { status: "success", ok_count: 0, skip_count: 1, error_message: SGIS_FIRST_RUN_PENDING_MARKER, finished_at: "2027-03-02T20:31:00Z" },
  { status: "success", ok_count: 0, skip_count: 1, error_message: SGIS_FIRST_RUN_PENDING_MARKER, finished_at: "2027-02-23T20:31:00Z" },
  { status: "success", ok_count: 0, skip_count: 1, error_message: SGIS_FIRST_RUN_PENDING_MARKER, finished_at: "2027-02-16T20:31:00Z" },
  { status: "success", ok_count: 0, skip_count: 1, error_message: SGIS_FIRST_RUN_PENDING_MARKER, finished_at: "2027-02-09T20:31:00Z" },
];

describe("⑱ checkSgisMapMarkers — 첫 회차 대기", () => {
  it("대기 4행(등재 뒤 5개월) → 경보 1 · at = 최신 행 시각", () => {
    const issues = checkSgisMapMarkers(pendingRows, new Date("2027-03-03T00:00:00Z"), TARGETS);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "sgis-map-pending", collector: SGIS_MAP_COLLECTOR, at: "2027-03-02T20:31:00Z" });
    expect(issues[0].detail).toMatch(/^첫 회차 대기 14\d일 — 전이표 승인 뒤 --first-run$/);
  });
  it("같은 대기 4행을 ⑤ 는 못 본다(이 점검이 필요한 이유 — 회귀 고정)", () => {
    const runs = { "sgis-map-emd": pendingRows };
    expect(checkExternalApiStale(TARGETS, runs, new Date("2027-03-03T00:00:00Z"))).toEqual([]);
  });
  it("등재 뒤 10일 → 0", () => {
    const rows = [{ error_message: SGIS_FIRST_RUN_PENDING_MARKER, finished_at: "2026-10-13T20:31:00Z" }];
    expect(checkSgisMapMarkers(rows, new Date("2026-10-17T15:00:00Z"), TARGETS)).toEqual([]);
  });
  it("경계: 등재 + 14일 정확히 → 0, 1ms 넘으면 → 1", () => {
    const rows = [{ error_message: SGIS_FIRST_RUN_PENDING_MARKER, finished_at: "2026-10-20T20:31:00Z" }];
    const sinceMs = new Date("2026-10-08T00:00:00+09:00").getTime();
    expect(checkSgisMapMarkers(rows, new Date(sinceMs + 14 * 86400000), TARGETS)).toEqual([]);
    expect(checkSgisMapMarkers(rows, new Date(sinceMs + 14 * 86400000 + 1), TARGETS)).toHaveLength(1);
  });
  it("최신 행이 정상(첫 회차 끝남)이면 옛 대기 행이 있어도 0", () => {
    const rows = [{ error_message: null, finished_at: "2027-03-09T20:31:00Z" }, ...pendingRows];
    expect(checkSgisMapMarkers(rows, new Date("2027-03-10T00:00:00Z"), TARGETS)).toEqual([]);
  });
  it("행이 없으면 침묵(⑤ 등재 뒤 행 0 몫)", () => {
    expect(checkSgisMapMarkers([], new Date("2027-03-03T00:00:00Z"), TARGETS)).toEqual([]);
  });
  it("운영 목록의 sgis-map-emd 항목(since·stale_days)을 기본값으로 쓴다", () => {
    const entry = EXTERNAL_API_COLLECTORS.find((c) => c.collector === SGIS_MAP_COLLECTOR);
    expect(entry?.since).toBe("2026-10-08");
    expect(checkSgisMapMarkers(pendingRows, new Date("2027-03-03T00:00:00Z"))).toHaveLength(1);
  });
});

describe("⑱ checkSgisMapMarkers — 시도 불일치 표시", () => {
  it("SGIS_SIDO_MISMATCH=3 → 경보 1(N 이 문구에)", () => {
    const rows = [{ error_message: formatSgisSidoMismatch(3), finished_at: "2026-10-20T20:31:00Z" }];
    const issues = checkSgisMapMarkers(rows, new Date("2026-10-21T00:00:00Z"), TARGETS);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "sgis-map-sido-mismatch", at: "2026-10-20T20:31:00Z" });
    expect(issues[0].detail).toContain("3곳");
  });
  it("실패 사유 뒤에 이어 붙은 표시도 읽는다", () => {
    const rows = [{ error_message: `연속 실패 20회 — 중단 | ${formatSgisSidoMismatch(2)}`, finished_at: "2026-10-20T20:31:00Z" }];
    expect(checkSgisMapMarkers(rows, new Date("2026-10-21T00:00:00Z"), TARGETS).map((i) => i.kind)).toEqual(["sgis-map-sido-mismatch"]);
  });
});

describe("⑱ 알림 모양 · dedup", () => {
  it("두 종류 모두 daily 에서도 dedup(같은 행은 한 번만 — at 이 행마다 달라 다음 화요일엔 다시 운다)", () => {
    expect(isAlwaysDedup({ kind: "sgis-map-pending", collector: SGIS_MAP_COLLECTOR, detail: "x" })).toBe(true);
    expect(isAlwaysDedup({ kind: "sgis-map-sido-mismatch", collector: SGIS_MAP_COLLECTOR, detail: "x" })).toBe(true);
  });
  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    for (const issue of checkSgisMapMarkers(
      [{ error_message: `${SGIS_FIRST_RUN_PENDING_MARKER} | ${formatSgisSidoMismatch(1)}`, finished_at: "2027-03-02T20:31:00Z" }],
      new Date("2027-03-03T00:00:00Z"), TARGETS,
    )) {
      const text = formatIssue(issue);
      expect(text).toContain("[조치]");
      expect(text).not.toContain("undefined");
    }
  });
});

describe("⑱ fetchSgisMapLatestRun — 이 수집기의 **가장 최근** 1행을 읽는다(보완 2)", () => {
  /** 이 조회가 쓰는 조합만 흉내 내는 가짜 — 요청한 정렬 방향대로 정렬해 돌려준다(오름차순이면 가장 옛 행이 나온다). */
  function fakeSb() {
    const rows = [
      { collector: "sgis-map-emd", error_message: "FIRST_RUN_PENDING", finished_at: "2026-10-13T20:31:00Z" },
      { collector: "sgis-map-emd", error_message: null, finished_at: "2026-10-27T20:31:00Z" },
      { collector: "reverse-geocode", error_message: null, finished_at: "2026-10-28T20:31:00Z" },
      { collector: "sgis-map-emd", error_message: "SGIS_SIDO_MISMATCH=2", finished_at: "2026-10-20T20:31:00Z" },
    ];
    /** @type {Array<[string, ...any[]]>} */
    const calls = [];
    /** @type {{ eq: Array<[string, any]>, order: { col: string, asc: boolean } | null, limit: number | null }} */
    const st = { eq: [], order: null, limit: null };
    /** @type {any} */
    const b = {
      select(/** @type {string} */ c) { calls.push(["select", c]); return b; },
      eq(/** @type {string} */ c, /** @type {any} */ v) { calls.push(["eq", c, v]); st.eq.push([c, v]); return b; },
      order(/** @type {string} */ c, /** @type {{ ascending?: boolean }} */ o = {}) { calls.push(["order", c, o]); st.order = { col: c, asc: o.ascending !== false }; return b; },
      limit(/** @type {number} */ n) { calls.push(["limit", n]); st.limit = n; return b; },
      then(/** @type {any} */ ok, /** @type {any} */ bad) {
        let hit = rows.filter((r) => st.eq.every(([c, v]) => /** @type {any} */ (r)[c] === v));
        if (st.order) {
          const { col, asc } = st.order;
          hit = [...hit].sort((x, y) => (asc ? 1 : -1) * String(/** @type {any} */ (x)[col]).localeCompare(String(/** @type {any} */ (y)[col])));
        }
        if (st.limit != null) hit = hit.slice(0, st.limit);
        return Promise.resolve({ data: hit, error: null }).then(ok, bad);
      },
    };
    return { sb: { from: (/** @type {string} */ t) => { calls.push(["from", t]); return b; } }, calls };
  }

  it("collector 필터 + finished_at 내림차순 + limit 1 → 최신 행 하나", async () => {
    const { sb, calls } = fakeSb();
    const rows = await fetchSgisMapLatestRun(sb);
    expect(rows).toHaveLength(1);
    expect(rows[0].finished_at).toBe("2026-10-27T20:31:00Z");
    expect(calls).toContainEqual(["from", "collector_runs"]);
    expect(calls).toContainEqual(["eq", "collector", SGIS_MAP_COLLECTOR]);
    expect(calls).toContainEqual(["order", "finished_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 1]);
  });
});
