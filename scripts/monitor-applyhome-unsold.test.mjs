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

describe("checkApplyhomeUnsold — 세 명단 (a) 만료 (b) 공고일 없음 (c) 완판인데 값 남음", () => {
  it("정상 행만 있으면 이상 0건", () => {
    expect(checkApplyhomeUnsold([ah({})], { now: NOW })).toEqual([]);
  });

  it("(a) 공고 + 6개월 + 여유 35일이 지났는데 applyhome — 여유 안이면 아직 안 알린다(매월 9일 수집기 한 주기)", () => {
    // 2026-03-09 + 6개월 = 09-09 → 여유 35일 뒤 = 10-14 까지는 정상
    expect(APPLYHOME_EXPIRY_ALERT_GRACE_DAYS).toBe(35);
    expect(byPrefix(checkApplyhomeUnsold([ah({ id: "ah-3", unsold_as_of: "2026-03-09" })], { now: NOW }), "expired:")).toBeUndefined();
    const later = new Date("2026-10-20T00:00:00Z");
    const a = byPrefix(checkApplyhomeUnsold([ah({ id: "ah-3", unsold_as_of: "2026-03-09" })], { now: later }), "expired:");
    expect(a?.kind).toBe("applyhome-unsold");
    expect(a?.detail).toContain("ah-3");
    expect(a?.at).toBe(`expired:${fingerprintIds(["ah-3"])}`);
  });

  it("(b) 공고일 빈 applyhome — 형식 불량도 같은 명단", () => {
    const issues = checkApplyhomeUnsold([ah({ id: "ah-b1", unsold_as_of: null }), ah({ id: "ah-b2", unsold_as_of: "20260601" })], { now: NOW });
    const b = byPrefix(issues, "nodate:");
    expect(b?.at).toBe(`nodate:${fingerprintIds(["ah-b1", "ah-b2"])}`);
    expect(b?.detail).toContain("2곳");
  });

  it("(c) 평형별 미달 0 인데 unsold > 0 — 미달 null 이나 값 0 은 아님", () => {
    const issues = checkApplyhomeUnsold([
      ah({ id: "ah-c1", competition_shortfall: 0, unsold: 3 }),
      ah({ id: "ah-c2", competition_shortfall: 0, unsold: 0 }),
      ah({ id: "ah-c3", competition_shortfall: null, unsold: 3 }),
    ], { now: NOW });
    const c = byPrefix(issues, "soldout:");
    expect(c?.at).toBe(`soldout:${fingerprintIds(["ah-c1"])}`);
  });

  it("applyhome 이 아닌 행은 명단에 안 들어간다", () => {
    const issues = checkApplyhomeUnsold([ah({ id: "k1", unsold_source: "kosis", unsold_as_of: null, competition_shortfall: 0 })], { now: NOW });
    expect(issues).toEqual([]);
  });

  it("★ 개수가 같아도 명단이 바뀌면 지문이 바뀐다(다시 알린다) — 같은 명단이면 같은 지문(침묵)", () => {
    const one = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { now: NOW });
    const same = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { now: new Date("2026-11-01T00:00:00Z") });
    const swapped = checkApplyhomeUnsold([ah({ id: "ah-y", unsold_as_of: null })], { now: NOW });
    expect(one[0].at).toBe(same[0].at);
    expect(one[0].at).not.toBe(swapped[0].at);
  });

  it("dedup — daily 에서도 항상 dedup(사람이 고쳐야 풀린다), 같은 명단은 다음 날 침묵", () => {
    expect(ALWAYS_DEDUP_KINDS.has("applyhome-unsold")).toBe(true);
    const issues = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { now: NOW });
    const scoped = dedupScope(issues, "daily");
    expect(scoped).toHaveLength(1);
    const sent = new Set(scoped.map(dedupKey));
    expect(filterUnsent(dedupScope(issues, "daily"), sent)).toHaveLength(0);
  });

  it("텔레그램 제목·조치 문구가 붙는다", () => {
    const issues = checkApplyhomeUnsold([ah({ id: "ah-x", unsold_as_of: null })], { now: NOW });
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
    expect(src).toMatch(/issues = issues\.concat\(ahIssues\);/);
  });

  it("조회는 applyhome 출처만, 판정에 쓰는 칸을 모두 가져온다", () => {
    expect(src).toContain('select("id, name, unsold, unsold_source, unsold_as_of, competition_shortfall").eq("unsold_source", "applyhome")');
  });
});
