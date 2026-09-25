// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkApplyhomeUnsold,
  APPLYHOME_EXPIRY_ALERT_GRACE_DAYS,
  fingerprintIds,
  dedupScope,
  dedupKey,
  filterUnsent,
  ALWAYS_DEDUP_KINDS,
  HOLD_BASELINE_IDS,
  HOLD_REVIEW_MONTHS,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

// 감시 ⑫ — 청약홈(applyhome) 출처 미분양 값 만료 기준 C6 의 세 명단(세션569).
// 개수가 아니라 **id 명단**으로 본다(expect-ids-not-counts — 개수만 같고 명단이 뒤바뀐 걸 놓친다).

/** 2026-10-09 06:00 KST */
const NOW = new Date("2026-10-08T21:00:00Z");
/** @param {object} o */
const ah = (o) => ({ id: "ah-1", name: "청약홈단지", unsold: 10, unsold_source: "applyhome", unsold_as_of: "2026-08-14", competition_shortfall: 3, ...o });

/** @param {ReturnType<typeof checkApplyhomeUnsold>} issues @param {string} prefix */
const byPrefix = (issues, prefix) => issues.find((i) => String(i.at).startsWith(prefix));

/** (a)(b)(c) 시험은 hold 기준 명단을 비운다 — 그래야 (d)(명단 불일치)가 섞이지 않는다(세션570). */
const NO_HOLD = /** @type {string[]} */ ([]);
/** @param {string} id @param {object} [o] */
const hold = (id, o = {}) => ({ id, name: `보류${id}`, unsold: null, unsold_source: "hold", unsold_as_of: "2026-09-24", competition_shortfall: null, ...o });

describe("checkApplyhomeUnsold — 세 명단 (a) 만료 (b) 공고일 없음 (c) 완판인데 값 남음", () => {
  it("정상 행만 있으면 이상 0건", () => {
    expect(checkApplyhomeUnsold([ah({})], { holdBaseline: NO_HOLD, now: NOW })).toEqual([]);
  });

  it("(a) 공고 + 6개월 + 여유 35일이 지났는데 applyhome — 여유 안이면 아직 안 알린다(매월 9일 수집기 한 주기)", () => {
    // 2026-03-09 + 6개월 = 09-09 → 여유 35일 뒤 = 10-14 까지는 정상
    expect(APPLYHOME_EXPIRY_ALERT_GRACE_DAYS).toBe(35);
    expect(byPrefix(checkApplyhomeUnsold([ah({ id: "ah-3", unsold_as_of: "2026-03-09" })], { holdBaseline: NO_HOLD, now: NOW }), "expired:")).toBeUndefined();
    const later = new Date("2026-10-20T00:00:00Z");
    const a = byPrefix(checkApplyhomeUnsold([ah({ id: "ah-3", unsold_as_of: "2026-03-09" })], { holdBaseline: NO_HOLD, now: later }), "expired:");
    expect(a?.kind).toBe("applyhome-unsold");
    expect(a?.detail).toContain("ah-3");
    expect(a?.at).toBe(`expired:${fingerprintIds(["ah-3"])}`);
  });

  it("(b) 공고일 빈 applyhome — 형식 불량도 같은 명단", () => {
    const issues = checkApplyhomeUnsold([ah({ id: "ah-b1", unsold_as_of: null }), ah({ id: "ah-b2", unsold_as_of: "20260601" })], { holdBaseline: NO_HOLD, now: NOW });
    const b = byPrefix(issues, "nodate:");
    expect(b?.at).toBe(`nodate:${fingerprintIds(["ah-b1", "ah-b2"])}`);
    expect(b?.detail).toContain("2곳");
  });

  it("(c) 평형별 미달 0 인데 unsold > 0 — 미달 null 이나 값 0 은 아님", () => {
    const issues = checkApplyhomeUnsold([
      ah({ id: "ah-c1", competition_shortfall: 0, unsold: 3 }),
      ah({ id: "ah-c2", competition_shortfall: 0, unsold: 0 }),
      ah({ id: "ah-c3", competition_shortfall: null, unsold: 3 }),
    ], { holdBaseline: NO_HOLD, now: NOW });
    const c = byPrefix(issues, "soldout:");
    expect(c?.at).toBe(`soldout:${fingerprintIds(["ah-c1"])}`);
  });

  it("applyhome 이 아닌 행은 명단에 안 들어간다", () => {
    const issues = checkApplyhomeUnsold([ah({ id: "k1", unsold_source: "kosis", unsold_as_of: null, competition_shortfall: 0 })], { holdBaseline: NO_HOLD, now: NOW });
    expect(issues).toEqual([]);
  });

  it("★ 개수가 같아도 명단이 바뀌면 지문이 바뀐다(다시 알린다) — 같은 명단이면 같은 지문(침묵)", () => {
    const one = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { holdBaseline: NO_HOLD, now: NOW });
    const same = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { holdBaseline: NO_HOLD, now: new Date("2026-11-01T00:00:00Z") });
    const swapped = checkApplyhomeUnsold([ah({ id: "ah-y", unsold_as_of: null })], { holdBaseline: NO_HOLD, now: NOW });
    expect(one[0].at).toBe(same[0].at);
    expect(one[0].at).not.toBe(swapped[0].at);
  });

  it("dedup — daily 에서도 항상 dedup(사람이 고쳐야 풀린다), 같은 명단은 다음 날 침묵", () => {
    expect(ALWAYS_DEDUP_KINDS.has("applyhome-unsold")).toBe(true);
    const issues = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { holdBaseline: NO_HOLD, now: NOW });
    const scoped = dedupScope(issues, "daily");
    expect(scoped).toHaveLength(1);
    const sent = new Set(scoped.map(dedupKey));
    expect(filterUnsent(dedupScope(issues, "daily"), sent)).toHaveLength(0);
  });

  it("텔레그램 제목·조치 문구가 붙는다", () => {
    const issues = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { holdBaseline: NO_HOLD, now: NOW });
    const text = formatIssue(/** @type {any} */ (issues[0]));
    expect(text).toContain("🏠 <b>청약홈 미분양 값 점검</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});

describe("⑫ main 배선 (소스)", () => {
  const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("daily 스윕이 ⑫ 를 조회해 issues 에 싣는다", () => {
    expect(src).toMatch(/const ahIssues = checkApplyhomeUnsold\(ahRows\);/);
    // 세션569 🔴1: 점검 본문이 runDailyGuardedChecks 의 fail-open 블록으로 옮겨 가 결과를 돌려준다
    expect(src).toMatch(/const ahRows = await fetchAhRows\(\);/);
    expect(src).toMatch(/return ahIssues;/);
    expect(src).toMatch(/issues = issues\.concat\(await runDailyGuardedChecks\(\)\);/);
  });

  it("조회는 applyhome·hold 출처만, 판정에 쓰는 칸을 모두 가져온다(세션570)", () => {
    expect(src).toContain('select("id, name, unsold, unsold_source, unsold_as_of, competition_shortfall").in("unsold_source", ["applyhome", "hold"])');
    expect(src).not.toContain('.eq("unsold_source", "applyhome")');
  });
});

describe("⑫ (d)(e) 사람 보류(hold) — 세션570", () => {
  it("기준 명단은 결정된 13곳(정렬) 그대로 — 세션570 11곳 + 세션571 대표 2행(910303·910363)", () => {
    expect([...HOLD_BASELINE_IDS]).toEqual([
      "ah-2021910123", "ah-2021910165", "ah-2022910170", "ah-2022910216", "ah-2022910285", "ah-2022910303",
      "ah-2022910320", "ah-2022910325", "ah-2022910363", "ah-2025910235", "ah-2025910236", "ah-2025910250",
      "ah-2025910274",
    ]);
    expect([...HOLD_BASELINE_IDS].length).toBe(13);
    expect([...HOLD_BASELINE_IDS]).toEqual([...HOLD_BASELINE_IDS].sort());
    expect(HOLD_REVIEW_MONTHS).toBe(6);
  });

  it("DB hold 명단 = 기준 → 이상 0건(기본 기준 명단 사용)", () => {
    expect(checkApplyhomeUnsold(HOLD_BASELINE_IDS.map((id) => hold(id)), { now: NOW })).toEqual([]);
  });

  it("(d) 추가·해제를 id 로 펼치고, at 은 DB hold 명단 지문 + 기준 명단 지문(세션572)", () => {
    const rows = [hold("h-1"), hold("h-new")];
    const d = byPrefix(checkApplyhomeUnsold(rows, { now: NOW, holdBaseline: ["h-1", "h-2"] }), "hold:");
    expect(d?.kind).toBe("applyhome-unsold");
    expect(d?.detail).toContain("추가 1: h-new");
    expect(d?.detail).toContain("해제 1: h-2");
    expect(d?.at).toBe(`hold:${fingerprintIds(["h-1", "h-new"])}+${fingerprintIds(["h-1", "h-2"])}`);
  });

  it("(d) ★ 같은 DB 명단이어도 기준 명단이 다르면 at 이 다르다 — 기준만 바뀐 사고도 새 열쇠(세션572)", () => {
    const rows = [hold("h-1"), hold("h-2")];
    const d1 = byPrefix(checkApplyhomeUnsold(rows, { now: NOW, holdBaseline: ["h-1", "h-3"] }), "hold:");
    const d2 = byPrefix(checkApplyhomeUnsold(rows, { now: NOW, holdBaseline: ["h-1", "h-4"] }), "hold:");
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();
    expect(d1?.at).not.toBe(d2?.at);
  });

  it("(d) 같은 DB·같은 기준이면 at 이 같다(하루 지나도) — dedup 이 이어진다", () => {
    const rows = [hold("h-1")];
    const opts = { holdBaseline: ["h-1", "h-2"] };
    const d1 = byPrefix(checkApplyhomeUnsold(rows, { ...opts, now: NOW }), "hold:");
    const d2 = byPrefix(checkApplyhomeUnsold(rows, { ...opts, now: new Date(NOW.getTime() + 86400000) }), "hold:");
    expect(d1?.at).toBeDefined();
    expect(d1?.at).toBe(d2?.at);
    // 기준 명단 순서가 달라도 같은 열쇠(정렬 후 지문)
    const d3 = byPrefix(checkApplyhomeUnsold(rows, { holdBaseline: ["h-2", "h-1"], now: NOW }), "hold:");
    expect(d3?.at).toBe(d1?.at);
  });

  it("(d) ★ 개수가 같아도(하나 풀리고 하나 생김) 알린다 — 같은 명단이면 침묵", () => {
    const base = ["h-1", "h-2"];
    expect(byPrefix(checkApplyhomeUnsold([hold("h-1"), hold("h-2")], { now: NOW, holdBaseline: base }), "hold:")).toBeUndefined();
    expect(byPrefix(checkApplyhomeUnsold([hold("h-1"), hold("h-3")], { now: NOW, holdBaseline: base }), "hold:")).toBeDefined();
  });

  it("(d) hold 가 하나도 없으면(backfill 전·전부 풀림) 해제 N 으로 알린다", () => {
    const d = byPrefix(checkApplyhomeUnsold([], { now: NOW, holdBaseline: ["h-1"] }), "hold:");
    expect(d?.detail).toContain("해제 1: h-1");
    expect(d?.at).toBe(`hold:${fingerprintIds([])}+${fingerprintIds(["h-1"])}`);
  });

  it("(e) 보류일 + 6개월이 지나야 재검토 알림 — 그 전은 침묵, 자동 해제 문구 포함", () => {
    const rows = [hold("h-1", { unsold_as_of: "2026-03-01" }), hold("h-2", { unsold_as_of: "2026-09-24" })];
    const opts = { holdBaseline: ["h-1", "h-2"] };
    expect(byPrefix(checkApplyhomeUnsold(rows, { ...opts, now: new Date("2026-08-15T00:00:00Z") }), "holdstale:")).toBeUndefined();
    const e = byPrefix(checkApplyhomeUnsold(rows, { ...opts, now: NOW }), "holdstale:");
    expect(e?.detail).toContain("보류 6개월 지남");
    expect(e?.detail).toContain("자동 해제 없음");
    expect(e?.detail).toContain("h-1");
    expect(e?.detail).not.toContain("h-2");
    expect(e?.at).toBe(`holdstale:${fingerprintIds(["h-1"])}`);
  });

  it("hold 행은 (a)(b)(c) 에 섞이지 않는다 — 공고일 없음·미달 0·오래된 날짜여도", () => {
    const rows = [
      hold("h-1", { unsold_as_of: null, competition_shortfall: 0, unsold: 5 }),
      hold("h-2", { unsold_as_of: "2025-01-01" }),
    ];
    const issues = checkApplyhomeUnsold(rows, { now: NOW, holdBaseline: ["h-1", "h-2"] });
    expect(byPrefix(issues, "expired:")).toBeUndefined();
    expect(byPrefix(issues, "nodate:")).toBeUndefined();
    expect(byPrefix(issues, "soldout:")).toBeUndefined();
  });

  it("(d)(e) 도 daily dedup — 같은 명단은 다음 날 침묵", () => {
    const issues = checkApplyhomeUnsold([hold("h-1", { unsold_as_of: "2025-01-01" })], { now: NOW, holdBaseline: [] });
    expect(issues.map((i) => String(i.at).split(":")[0]).sort()).toEqual(["hold", "holdstale"]);
    const scoped = dedupScope(issues, "daily");
    expect(scoped).toHaveLength(2);
    const sent = new Set(scoped.map(dedupKey));
    expect(filterUnsent(dedupScope(issues, "daily"), sent)).toHaveLength(0);
  });
});
