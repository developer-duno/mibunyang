// @ts-check
/**
 * 감시 ⑫(i) 미래 기준일 · ㉖ 명단 총분양 상한 새 단지 (세션697 👤 결정 ① 「무시+경보」 · ② 「새로 걸린 단지만 알림」)
 *
 *   A5 — ⑫(i): applyhome·govlist 이고 기준일이 오늘(KST) 뒤인 행 ≥1 → 1건(id·기준일 앞 20개 + n) · 0 이면 조용 · ⑫(h)(a) 가 같은 행을 또 울리지 않는다
 *        + ㉔-d 양성 대조군은 「유효」 비공개만 센다(미래 행은 VIEW 가 존중하지 않으므로)
 *   B2 — ㉖: 가장 최근 KOSIS 실행 표식의 id 중 그 전 실행 표식에 한 번도 없던 것만 1건
 *   B3 — 같은 실행으로 이틀 이상 울리지 않는다(at = 실행 finished_at + 항상 dedup)
 *   B4 — 잘린 표식(앞 20개 + 「, …」)은 「일부만 비교」라고 밝힌다
 * 기대값 출처 = 지시서 brief-guard.md ③ 표의 예시값. 시각은 밖에서 넣는다.
 */
import { describe, it, expect } from "vitest";
import {
  checkApplyhomeUnsold,
  checkGovlistHiddenParity,
  checkListedCapNew,
  runListedCapCheck,
  KOSIS_UNSOLD_COLLECTOR,
  FUTURE_ASOF_ID_LIMIT,
  dedupKey,
  dedupScope,
  filterUnsent,
  isAlwaysDedup,
} from "./monitor-collectors.mjs";
import { formatListedCap } from "./collectors/collect-unsold-kosis.mjs";
import { formatIssue } from "./notify-telegram.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** KST 2026-11-05 09:00 — 감시가 도는 아침 */
const NOW = new Date("2026-11-05T00:00:00Z");

describe("A5 — ⑫(i) 미래 기준일", () => {
  const future = (/** @type {Array<Record<string, any>>} */ rows) => checkApplyhomeUnsold(rows, { now: NOW, holdBaseline: [] }).filter((i) => i.detail.startsWith("(i)"));

  it("지시서 예시: 0행 → 조용 · 1행 → 1건(id·기준일 + n)", () => {
    expect(future([{ id: "ah-v", name: "유효", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30" }])).toEqual([]);
    const is = future([{ id: "ah-f", name: "미래", unsold: null, unsold_source: "govlist", unsold_as_of: "2027-09-30" }]);
    expect(is).toHaveLength(1);
    expect(is[0].kind).toBe("applyhome-unsold");
    expect(is[0].detail).toBe("(i) 기준일(unsold_as_of)이 오늘(KST 2026-11-05) 뒤인 청약홈·지자체 명단 값 n=1: ah-f(govlist 2027-09-30)");
    expect(is[0].at?.startsWith("future:")).toBe(true);
    expect(isAlwaysDedup(is[0])).toBe(true); // ⑫ 와 같이 명단 지문 — 같은 명단이면 다음 날 침묵
  });
  it("경계: 오늘(KST 11/05) 기준일은 미래 아님 · 내일은 미래 · applyhome 도 센다 · kosis·hold 는 안 센다", () => {
    expect(future([{ id: "a", unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-11-05" }])).toEqual([]);
    expect(future([{ id: "a", unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-11-06" }])).toHaveLength(1);
    expect(future([
      { id: "k", unsold: 3, unsold_source: "kosis", unsold_as_of: "2027-01-01" },
      { id: "h", unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2027-01-01" },
    ])).toEqual([]);
  });
  it("25행 → 앞 20개(id 순) + 「, …」 + n=25", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `ah-${String(24 - i).padStart(2, "0")}`, unsold: null, unsold_source: "govlist", unsold_as_of: "2027-01-31" }));
    const d = future(rows)[0].detail;
    expect(FUTURE_ASOF_ID_LIMIT).toBe(20);
    expect(d).toContain("n=25: ah-00(govlist 2027-01-31), ah-01(");
    expect(d).toContain("ah-19(govlist 2027-01-31), …");
    expect(d).not.toContain("ah-20(");
  });
  it("⑫(a)(h) 는 미래 행을 「만료」로 또 울리지 않는다 — 미래 행만 있으면 ⑫ 전체가 (i) 1건", () => {
    const all = checkApplyhomeUnsold([
      { id: "g1", unsold: 4, unsold_source: "govlist", unsold_as_of: "2027-09-30" },
      { id: "g2", unsold: null, unsold_source: "govlist", unsold_as_of: "2027-09-30", unsold_listed_as_of: "2027-09-30" },
      { id: "a1", unsold: 3, unsold_source: "applyhome", unsold_as_of: "2027-09-30" },
    ], { now: NOW, holdBaseline: [] });
    expect(all.map((i) => i.detail.slice(0, 3))).toEqual(["(i)"]);
  });
  it("텔레그램 문구에 undefined 가 없다", () => {
    const text = formatIssue(future([{ id: "ah-f", unsold: null, unsold_source: "govlist", unsold_as_of: "2027-09-30" }])[0]);
    expect(text).toContain("ah-f");
    expect(text).not.toContain("undefined");
  });
  it("㉔-d 양성 대조군은 유효 비공개만 — 미래 비공개 행만 있으면 VIEW 0 이어도 「VIEW 0」 경보 없음 · 유효 행이면 경보", () => {
    expect(checkGovlistHiddenParity({ viewHidden: 0, rawAsOf: ["2027-09-30"], live: null }, NOW)).toEqual([]);
    expect(checkGovlistHiddenParity({ viewHidden: 0, rawAsOf: ["2026-09-30"], live: null }, NOW).map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_HIDDEN_VIEW_ZERO"]);
  });
});

/** @param {string[] | null} ids @param {string} at @param {string} [status] */
const run = (ids, at, status = "success") => ({ status, finished_at: at, error_message: ids ? formatListedCap(ids) : null });

describe("B2 — ㉖ 새로 걸린 단지만", () => {
  it("지시서 예시: 지난 회차 [ap-1] · 이번 [ap-1, ap-2] → ap-2 만", () => {
    const is = checkListedCapNew([run(["ap-1", "ap-2"], "2026-11-09T00:10:00Z"), run(["ap-1"], "2026-10-09T00:10:00Z")]);
    expect(is).toHaveLength(1);
    expect(is[0].kind).toBe("kosis-listed-cap");
    expect(is[0].collector).toBe(KOSIS_UNSOLD_COLLECTOR);
    expect(is[0].detail).toBe("KOSIS_LISTED_CAP 명단 총분양 상한에 새로 걸린 단지 1곳: ap-2");
  });
  it("처음 보는 게 없으면 조용 · 몇 회차 전에 한 번이라도 걸렸던 id 도 「본 것」", () => {
    expect(checkListedCapNew([run(["ap-1"], "2026-11-09T00:10:00Z"), run(["ap-1"], "2026-10-09T00:10:00Z")])).toEqual([]);
    expect(checkListedCapNew([run(["ap-3"], "2026-11-09T00:10:00Z"), run(null, "2026-10-09T00:10:00Z"), run(["ap-3"], "2026-09-09T00:10:00Z")])).toEqual([]);
  });
  it("첫 표식 회차(전 회차 표식 없음) → 걸린 단지 전부가 새것 · 최근 실행에 표식이 없거나 실행 0 이면 조용", () => {
    expect(checkListedCapNew([run(["ap-1", "ap-2"], "2026-11-09T00:10:00Z"), run(null, "2026-10-09T00:10:00Z")])[0].detail).toContain("2곳: ap-1, ap-2");
    expect(checkListedCapNew([run(null, "2026-11-09T00:10:00Z"), run(["ap-1"], "2026-10-09T00:10:00Z")])).toEqual([]);
    expect(checkListedCapNew([])).toEqual([]);
  });
  it("실패 실행이면 상태를 덧붙인다(텔레그램 문구에 undefined 없음)", () => {
    const is = checkListedCapNew([run(["ap-2"], "2026-11-09T00:10:00Z", "failure")]);
    const text = formatIssue(is[0]);
    expect(text).toContain("(failure)");
    expect(text).toContain("<b>명단 총분양 상한에 새로 걸린 단지</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});

describe("B3 — 같은 KOSIS 회차로 이틀 이상 울리지 않는다", () => {
  it("at = 그 실행의 finished_at · daily 에서도 dedup 대상 → 둘째 날(같은 실행) 보낸 키에 걸려 빠진다", () => {
    const runs = [run(["ap-1", "ap-2"], "2026-11-09T00:10:00Z"), run(["ap-1"], "2026-10-09T00:10:00Z")];
    const day1 = checkListedCapNew(runs);
    expect(day1[0].at).toBe("cap:2026-11-09T00:10:00Z");
    expect(dedupScope(day1, "daily")).toEqual(day1); // daily 에서도 dedup 을 거친다
    const sent = new Set(day1.map(dedupKey));
    const day2 = checkListedCapNew(runs); // 다음 날 아침 — 새 KOSIS 실행 없음
    expect(filterUnsent(dedupScope(day2, "daily"), sent)).toEqual([]);
    // 다음 달 회차가 또 새 단지를 걸면 새 열쇠라 다시 운다
    const next = checkListedCapNew([run(["ap-1", "ap-2", "ap-3"], "2026-12-09T00:10:00Z"), ...runs]);
    expect(filterUnsent(dedupScope(next, "daily"), sent)).toHaveLength(1);
  });
});

describe("B4 — 잘린 표식은 「일부만 비교」", () => {
  const ids25 = Array.from({ length: 25 }, (_, i) => `ah-${String(i).padStart(2, "0")}`);
  it("지시서 예시: 이번 n=25(앞 20개만 보임) → 앞 20개만 비교했다고 밝힌다", () => {
    const is = checkListedCapNew([run(ids25, "2026-11-09T00:10:00Z"), run(["ah-00"], "2026-10-09T00:10:00Z")]);
    expect(is[0].detail).toBe(`KOSIS_LISTED_CAP 명단 총분양 상한에 새로 걸린 단지 19곳(일부만 비교): ${ids25.slice(1, 20).join(", ")}`);
    expect(is[0].lines?.some((l) => l.includes("일부만 비교: 이번 실행 표식이 앞 20개로 잘려(n=25) 앞 20개만 비교했습니다 — 나머지 5곳은 판정 못 함"))).toBe(true);
  });
  it("이번이 잘렸고 보이는 20개가 전부 본 것이면 조용(안 보이는 5곳은 판정 못 함 — 문구 없는 침묵)", () => {
    expect(checkListedCapNew([run(ids25, "2026-11-09T00:10:00Z"), run(ids25.slice(0, 20), "2026-10-09T00:10:00Z")])).toEqual([]);
  });
  it("지난 실행이 잘렸으면 그때 안 보인 단지가 새것으로 잡힐 수 있다고 밝힌다", () => {
    const is = checkListedCapNew([run(["ah-22"], "2026-11-09T00:10:00Z"), run(ids25, "2026-10-09T00:10:00Z")]);
    expect(is[0].detail).toContain("(일부만 비교): ah-22");
    expect(is[0].lines?.some((l) => l.startsWith("일부만 비교: 지난 실행 표식 중 잘린 회차가 있어"))).toBe(true);
  });
  it("잘리지 않았으면 「일부만 비교」가 없다", () => {
    const is = checkListedCapNew([run(["ap-2"], "2026-11-09T00:10:00Z"), run(["ap-1"], "2026-10-09T00:10:00Z")]);
    expect(is[0].detail).not.toContain("일부만 비교");
    expect(is[0].lines?.some((l) => l.includes("일부만 비교"))).toBe(false);
  });
});

describe("㉖ 배선", () => {
  it("runListedCapCheck 가 kosis-unsold 최근 행을 물어 ㉖ 이슈를 싣는다 · 조회 실패는 실행 실패 1건", async () => {
    /** @type {string[][]} */
    const asked = [];
    const is = await runListedCapCheck({
      fetchRuns: async (names) => { asked.push([...names]); return { "kosis-unsold": [run(["ap-1", "ap-2"], "2026-11-09T00:10:00Z"), run(["ap-1"], "2026-10-09T00:10:00Z")] }; },
    });
    expect(asked).toEqual([["kosis-unsold"]]);
    expect(is.map((i) => i.kind)).toEqual(["kosis-listed-cap"]);
    const failed = await runListedCapCheck({ fetchRuns: async () => { throw new Error("boom"); } });
    expect(failed.map((i) => i.detail)).toEqual(["㉖ 명단 총분양 상한 새 단지 실행 실패 — boom"]);
  });
  it("수집기 PHASE·표식 이음이 감시와 같다 · main 이 매일 부른다(한쪽만 바뀌면 빨강)", () => {
    const col = readFileSync(fileURLToPath(new URL("./collectors/collect-unsold-kosis.mjs", import.meta.url)), "utf8");
    expect(col).toContain(`const PHASE = "${KOSIS_UNSOLD_COLLECTOR}";`);
    expect(col).toContain("govlistMarkers = joinRunMessage(formatGovlistNoDate(govlistNoDateIds), formatListedCap(cappedPlans.map((p) => p.id))) ?? null;");
    const mon = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
    expect(mon).toContain("    issues = issues.concat(await runListedCapCheck());");
  });
});
