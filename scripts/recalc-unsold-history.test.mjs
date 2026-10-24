// @ts-check
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeSupabase } from "./_fake-supabase.mjs";
import {
  parseArgs, planHistoryRecalc, checkBreakers, classifyLive, diffBucket, kstMonth, run, snapshotPathOf, kosisPathOf, updateCount, sha16,
} from "./recalc-unsold-history.mjs";

/** @param {Record<string, any>} o @returns {any} */
const apt = (o) => ({
  name: "단지", region: "서울", gu: "강남구", units: null, unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null,
  unsold_source: "kosis", unsold_as_of: null, complex_key: null, naver_presale_no: null, unit_source: null, created_at: "2026-01-01T00:00:00Z", ...o,
});
/** @param {string} c2 @param {string} m @param {number} v */
const k = (c2, m, v) => ({ C1_NM: "서울", C2_NM: c2, PRD_DE: m, DT: String(v) });

// 손계산: 강남구 분모 = 100 + 300 + 600 = 1,000(c1 은 세대수 없음 → 분모·계산 밖). 서초구 분모 = 10.
//   202601 강남 50 → a1 5 · a2 15 · a3 30 (5%)   202602 강남 100 → a1 10 · a2 30 · a3 60 (10%)
//   서초 8 → b1 8 = 80% → held
const APTS = () => [
  apt({ id: "a1", units: 100 }), apt({ id: "a2", units: 300 }), apt({ id: "a3", units: 600 }),
  apt({ id: "b1", gu: "서초구", units: 10 }), apt({ id: "c1", units: null }),
];
const KOSIS = [k("강남구", "202601", 50), k("강남구", "202602", 100), k("서초구", "202601", 8), k("서초구", "202602", 8)];
/** @param {number} id @param {string} a @param {string} m @param {number|null} v */
const h = (id, a, m, v) => ({ id, apartment_id: a, base_month: m, unsold_count: v, post_completion_unsold: null, change: null, recorded_at: "2026-04-20" });
const HIST = () => [
  h(1, "a1", "202601", 4), // 바뀜 → 5
  h(2, "a1", "202602", 10), // 같음
  h(3, "a2", "202601", 15), // 같음
  h(4, "a2", "202602", 20), // 바뀜 → 30
  h(5, "a3", "202601", 100), // 바뀜 → 30
  h(6, "a3", "202602", 60), // 같음
  h(7, "b1", "202601", 3), // held(80%) → 그대로
  h(8, "c1", "202601", 7), // 계산 대상 아님 → 그대로
];

/**
 * 표마다 가짜를 따로 끼운다(_fake-supabase 는 표 이름을 무시하는 단일 표). 모든 표 메서드 호출을 ops 에 남긴다.
 * @param {any[]} apts @param {any[]} hist
 */
function mkSb(apts, hist) {
  const A = makeFakeSupabase(apts), H = makeFakeSupabase(hist);
  /** @type {Array<[string, string]>} */
  const ops = [];
  const sb = {
    from: (/** @type {string} */ t) => {
      const base = (t === "apartments" ? A : H).from(t);
      return {
        select: (/** @type {string} */ c, /** @type {any} */ o) => { ops.push(["select", t]); return base.select(c, o); },
        update: (/** @type {any} */ p) => { ops.push(["update", t]); return base.update(p); },
        delete: () => { ops.push(["delete", t]); return base.delete(); },
        insert: () => { ops.push(["insert", t]); throw new Error("insert 금지"); },
        upsert: () => { ops.push(["upsert", t]); throw new Error("upsert 금지"); },
      };
    },
  };
  return { A, H, sb, ops };
}

/** @type {string} */ let dir;
/** @type {string} */ let kosisFile;
const quiet = { log: () => {}, err: () => {} };
const now = () => new Date("2026-10-24T00:00:00Z");
const small = { minApartments: 1, minHistory: 1 };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recalc-hist-"));
  kosisFile = join(dir, "kosis-in.json");
  writeFileSync(kosisFile, JSON.stringify(KOSIS));
});
const plan = () => join(dir, "plan.json");
/** @param {any} sb @param {any} [extra] @param {string} [out] */
const dry = (sb, extra = {}, out = plan()) => run([`--out=${out}`, `--kosis-file=${kosisFile}`], { sb, now, ...quiet, ...small, fetchKosis: () => { throw new Error("KOSIS 호출 금지"); }, ...extra });
/** @param {any} sb @param {string} [from] @param {any} [extra] */
const apply = (sb, from = plan(), extra = {}) => run([`--out=${join(dir, "apply.json")}`, "--apply", `--from=${from}`], { sb, now, ...quiet, ...small, ...extra });
/** @param {any} sb @param {string[]} [extra] */
const undo = (sb, extra = []) => run([`--undo=${snapshotPathOf(plan())}`, ...extra], { sb, now, ...quiet, ...small });
/** @param {any} H @param {number} id */
const val = (H, id) => H.snapshot().find((/** @type {any} */ r) => r.id === id)?.unsold_count;

describe("parseArgs — 허용 목록", () => {
  it("모르는 인자·--dry-run 은 던진다", () => {
    expect(() => parseArgs(["--out=a", "--dry-run"])).toThrow(/모르는 인자/);
    expect(() => parseArgs(["--out=a", "--foo=1"])).toThrow(/모르는 인자/);
  });
  it("필수·조합 규칙", () => {
    expect(() => parseArgs([])).toThrow(/--out/);
    expect(() => parseArgs(["--out=a", "--apply"])).toThrow(/--from/);
    expect(() => parseArgs(["--out=a", "--from=b"])).toThrow(/--apply·--undo 와만/);
    expect(() => parseArgs(["--out=a", "--apply", "--from=a"])).toThrow(/덮어쓴다/);
    expect(() => parseArgs(["--out=d/p.before.json", "--apply", "--from=d/p.json"])).toThrow(/덮어쓴다/);
    expect(() => parseArgs(["--out=d/p.kosis.json", "--apply", "--from=d/p.json"])).toThrow(/덮어쓴다/);
    expect(() => parseArgs(["--out=a", "--apply", "--from=b", "--kosis-file=k"])).toThrow(/kosis-file/);
    expect(() => parseArgs(["--undo=s", "--apply", "--from=b"])).toThrow(/같이 못/);
    expect(() => parseArgs(["--undo=s", "--out=a"])).toThrow(/--out/);
    expect(() => parseArgs(["--out=d/p.json", "--kosis-file=d/p.kosis.json"])).toThrow(/kosis-file/);
    expect(parseArgs(["--out=a"]).mode).toBe("dry");
    expect(parseArgs(["--out=a", "--apply", "--from=b"]).mode).toBe("apply");
    expect(parseArgs(["--undo=s"]).mode).toBe("undo");
  });
});

describe("planHistoryRecalc — 손계산 대조(분류 4종)", () => {
  it("묶음 분모(구 전체 세대수)로 다시 계산 · 다른 줄만 rows", () => {
    const { rows, summary } = planHistoryRecalc({ apartments: APTS(), history: HIST(), kosisRows: KOSIS });
    expect(rows.map((r) => [r.id, r.old, r.new])).toEqual([[1, 4, 5], [4, 20, 30], [5, 100, 30]]);
    expect(rows[0]).toMatchObject({ apartment_id: "a1", base_month: "202601", region: "서울", gu: "강남구" });
    expect(summary.counts).toEqual({ changed: 3, same: 3, orphan: 1, held: 1 });
    expect(summary.byMonth["202601"]).toEqual({ changed: 2, same: 1, orphan: 1, held: 1 });
    expect(summary.byMonth["202602"]).toEqual({ changed: 1, same: 2, orphan: 0, held: 0 });
    expect(summary.byRange["≤202606"]).toEqual(summary.counts);
    expect(summary.diffDist).toEqual({ "1~2": 1, "3~10": 1, "11~50": 0, "51+": 1, "이전 빈칸": 0 });
    expect(summary.direction).toEqual({ up: 2, down: 1 });
  });
  it("hold 행은 시계열 계산 밖(그대로) · 분모에는 남는다", () => {
    const apts = APTS().map((a) => (a.id === "a2" ? { ...a, unsold_source: "hold" } : a));
    const { rows, summary } = planHistoryRecalc({ apartments: apts, history: HIST(), kosisRows: KOSIS });
    expect(rows.map((r) => r.id)).toEqual([1, 5]); // a2 의 4번 줄은 계산 밖 · a1·a3 값은 그대로(분모 1,000 유지)
    expect(summary.counts.orphan).toBe(3);
  });
  it("diffBucket · kstMonth", () => {
    expect(diffBucket(null, 3)).toBe("이전 빈칸");
    expect(diffBucket(10, 12)).toBe("1~2");
    expect(diffBucket(10, 61)).toBe("51+");
    expect(kstMonth(new Date("2026-09-30T15:30:00Z"))).toBe("202610"); // KST 10/01 00:30
  });
});

describe("checkBreakers", () => {
  const base = { apartments: APTS(), history: HIST(), aptCount: 5, histCount: 8, minApartments: 1, minHistory: 1 };
  it("통과", () => expect(checkBreakers({ ...base, kosisRows: KOSIS })).toEqual([]));
  it("① KOSIS 에 history 의 달이 빠지면", () => {
    expect(checkBreakers({ ...base, kosisRows: KOSIS.filter((r) => r.PRD_DE !== "202602") }).join()).toMatch(/① .*202602/);
  });
  it("② 행 수 문턱 · count 불일치", () => {
    expect(checkBreakers({ ...base, kosisRows: KOSIS, minApartments: 6 }).join()).toMatch(/② apartments 5 < 6/);
    expect(checkBreakers({ ...base, kosisRows: KOSIS, minHistory: 9 }).join()).toMatch(/② history 8 < 9/);
    expect(checkBreakers({ ...base, kosisRows: KOSIS, histCount: 9 }).join()).toMatch(/history 읽은 8 ≠ count exact 9/);
    expect(checkBreakers({ ...base, kosisRows: KOSIS, aptCount: 6 })).toEqual(["② apartments 읽은 5 ≠ count exact 6"]);
    expect(checkBreakers({ apartments: APTS(), history: HIST(), aptCount: 5, histCount: 8, kosisRows: KOSIS }).length).toBe(2); // 기본 3,000/9,000
  });
});

describe("classifyLive", () => {
  const p = { id: 1, apartment_id: "a1", name: null, region: null, gu: null, base_month: "202601", old: 4, new: 5 };
  it("이전 / 새 / 그 밖", () => {
    expect(classifyLive(h(1, "a1", "202601", 4), p)).toBe("이전");
    expect(classifyLive(h(1, "a1", "202601", 5), p)).toBe("새");
    expect(classifyLive(h(1, "a1", "202601", 6), p)).toBe("그 밖");
    expect(classifyLive(h(1, "a1", "202602", 4), p)).toBe("그 밖");
    expect(classifyLive(undefined, p)).toBe("그 밖");
  });
});

describe("run — 미리보기", () => {
  it("--kosis-file 이면 호출 0 · 미리보기·KOSIS 저장본 · DB 쓰기 0", async () => {
    const { sb, ops } = mkSb(APTS(), HIST());
    expect(await dry(sb)).toBe(0);
    expect(ops.filter(([op]) => op !== "select")).toEqual([]);
    const pv = JSON.parse(readFileSync(plan(), "utf8"));
    expect(pv.mode).toBe("dry");
    expect(pv.breakers).toEqual([]);
    expect(pv.rows.map((/** @type {any} */ r) => r.id)).toEqual([1, 4, 5]);
    expect(pv.inputs).toMatchObject({ kosisRows: 4, kosisMonths: ["202601", "202602"], apartments: 5, apartmentsCountExact: 5, history: 8, historyCountExact: 8 });
    expect(JSON.parse(readFileSync(kosisPathOf(plan()), "utf8"))).toEqual(KOSIS);
    expect(existsSync(snapshotPathOf(plan()))).toBe(false);
  });
  it("KOSIS 는 202601~이번 달(KST) 1회", async () => {
    const { sb } = mkSb(APTS(), HIST());
    const fetchKosis = vi.fn(async () => KOSIS);
    expect(await run([`--out=${plan()}`], { sb, now, ...quiet, ...small, fetchKosis })).toBe(0);
    expect(fetchKosis).toHaveBeenCalledTimes(1);
    expect(fetchKosis).toHaveBeenCalledWith("202610");
  });
  it("차단기 ①② — 미리보기는 경고 + 파일에 사유 + exit 0 · 쓰기 0 · 그 미리보기로 --apply 는 거부", async () => {
    writeFileSync(kosisFile, JSON.stringify(KOSIS.filter((r) => r.PRD_DE !== "202602")));
    const { sb, ops } = mkSb(APTS(), HIST());
    /** @type {string[]} */ const errs = [];
    expect(await dry(sb, { err: (/** @type {string} */ s) => errs.push(s) })).toBe(0);
    expect(errs.join()).toMatch(/\[차단\] ①/);
    expect(ops.filter(([op]) => op !== "select")).toEqual([]);
    expect(JSON.parse(readFileSync(plan(), "utf8")).breakers.join()).toMatch(/①/);
    const s2 = mkSb(APTS(), HIST());
    const plan2 = join(dir, "plan2.json");
    expect(await dry(s2.sb, { minApartments: 3000, minHistory: 9000 }, plan2)).toBe(0);
    expect(JSON.parse(readFileSync(plan2, "utf8")).breakers.join()).toMatch(/② apartments 5 < 3000.*② history 8 < 9000/);
    await expect(apply(s2.sb, plan2)).rejects.toThrow(/차단기/);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
  });

  it("이미 있는 미리보기 이름이면 덮어쓰지 않는다(wx) — exit 1·파일 불변", async () => {
    writeFileSync(plan(), "옛 미리보기");
    const { sb } = mkSb(APTS(), HIST());
    expect(await dry(sb)).toBe(1);
    expect(readFileSync(plan(), "utf8")).toBe("옛 미리보기");
    expect(existsSync(kosisPathOf(plan()))).toBe(false);
    // KOSIS 저장본만 있어도 그 파일은 덮지 않는다
    const p3 = join(dir, "plan3.json");
    writeFileSync(kosisPathOf(p3), "옛 저장본");
    expect(await dry(mkSb(APTS(), HIST()).sb, {}, p3)).toBe(1);
    expect(readFileSync(kosisPathOf(p3), "utf8")).toBe("옛 저장본");
  });

  it("반영 사본(<out>.before.json)이 있으면 미리보기 자체를 거부 — 반영 뒤 같은 이름 금지", async () => {
    writeFileSync(snapshotPathOf(plan()), "{}");
    const { sb, ops } = mkSb(APTS(), HIST());
    /** @type {string[]} */ const errs = [];
    expect(await dry(sb, { err: (/** @type {string} */ s) => errs.push(s) })).toBe(1);
    expect(errs.join()).toMatch(/반영 뒤 같은 이름 금지/);
    expect(existsSync(plan())).toBe(false);
    expect(ops).toEqual([]);
  });
});

describe("run — 반영", () => {
  it("이전 → 새 · 조건 id+unsold_count=old · 사본 wx · INSERT·DELETE 0", async () => {
    const { sb, H, ops } = mkSb(APTS(), HIST());
    await dry(sb);
    expect(await apply(sb)).toBe(0);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((id) => val(H, id))).toEqual([5, 10, 15, 30, 30, 60, 3, 7]); // held·대상 아님 그대로
    const ups = H.calls.filter((/** @type {any} */ c) => c.op === "update");
    expect(ups.length).toBe(3);
    for (const u of ups) {
      expect(u.payload).toEqual({ unsold_count: expect.any(Number) }); // 한 칸만
      expect(u.filters).toEqual([["eq", "id"], ["eq", "unsold_count"]]);
    }
    expect(ops.filter(([op]) => op === "insert" || op === "upsert" || op === "delete")).toEqual([]);
    expect(ops.filter(([op]) => op === "update").every(([, t]) => t === "unsold_history")).toBe(true);
    const snap = JSON.parse(readFileSync(snapshotPathOf(plan()), "utf8"));
    expect(snap.rows).toEqual([
      { id: 1, apartment_id: "a1", base_month: "202601", unsold_count: 4, recorded_at: "2026-04-20" },
      { id: 4, apartment_id: "a2", base_month: "202602", unsold_count: 20, recorded_at: "2026-04-20" },
      { id: 5, apartment_id: "a3", base_month: "202601", unsold_count: 100, recorded_at: "2026-04-20" },
    ]);
    const res = JSON.parse(readFileSync(join(dir, "apply.json"), "utf8"));
    expect(res.result).toEqual({ ok: 3, skip: 0, fail: 0, good: 3 });
    expect(res.rows.map((/** @type {any} */ r) => r.result)).toEqual(["반영", "반영", "반영"]);
  });

  it('"그 밖" 1행이면 쓰기 0 + exit 1(사본도 안 만든다)', async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    const s2 = mkSb(APTS(), HIST().map((x) => (x.id === 4 ? { ...x, unsold_count: 21 } : x)));
    expect(await apply(s2.sb)).toBe(1);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
    expect(existsSync(snapshotPathOf(plan()))).toBe(false);
    const res = JSON.parse(readFileSync(join(dir, "apply.json"), "utf8"));
    expect(res.byState).toEqual({ "이전": 2, "새": 0, "그 밖": 1 });
  });

  it("일부만 반영된 뒤 다시 돌리면 남은 행만 잇는다(사본 재사용)", async () => {
    const { sb, H } = mkSb(APTS(), HIST());
    await dry(sb);
    expect(await apply(sb)).toBe(0);
    const snapBefore = readFileSync(snapshotPathOf(plan()), "utf8");
    const s2 = mkSb(APTS(), H.snapshot().map((/** @type {any} */ x) => (x.id === 4 ? { ...x, unsold_count: 20 } : x)));
    expect(await apply(s2.sb)).toBe(0);
    expect(s2.H.calls.filter((/** @type {any} */ c) => c.op === "update").length).toBe(1);
    expect(val(s2.H, 4)).toBe(30);
    expect(readFileSync(snapshotPathOf(plan()), "utf8")).toBe(snapBefore);
  });

  it('사본이 없는데 이미 "새" 행이 있으면 거부', async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    const s2 = mkSb(APTS(), HIST().map((x) => (x.id === 1 ? { ...x, unsold_count: 5 } : x)));
    expect(await apply(s2.sb)).toBe(1);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
  });

  it("차단기가 걸린 미리보기로는 반영 못 한다 · 반영 때 count 불일치도 차단", async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    const pv = JSON.parse(readFileSync(plan(), "utf8"));
    writeFileSync(plan(), JSON.stringify({ ...pv, breakers: ["① x"] }));
    await expect(apply(sb)).rejects.toThrow(/차단기/);
    writeFileSync(plan(), JSON.stringify(pv));
    const s2 = mkSb(APTS(), HIST());
    expect(await run([`--out=${join(dir, "apply.json")}`, "--apply", `--from=${plan()}`], { sb: s2.sb, now, ...quiet, minApartments: 6, minHistory: 1 })).toBe(1);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
  });

  it("기존 사본이 이 미리보기와 다르면(지문·이전 값) exit 1·쓰기 0", async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    const snapPath = snapshotPathOf(plan());
    const good = { fromSha16: "", rows: HIST().filter((x) => [1, 4, 5].includes(x.id)).map(({ id, apartment_id, base_month, unsold_count, recorded_at }) => ({ id, apartment_id, base_month, unsold_count, recorded_at })) };
    writeFileSync(snapPath, JSON.stringify({ ...good, fromSha16: "0000000000000000" }));
    const s2 = mkSb(APTS(), HIST());
    expect(await apply(s2.sb)).toBe(1);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
    const sha = sha16(readFileSync(plan(), "utf8"));
    writeFileSync(snapPath, JSON.stringify({ ...good, fromSha16: sha, rows: good.rows.map((r) => (r.id === 4 ? { ...r, unsold_count: 19 } : r)) }));
    const s3 = mkSb(APTS(), HIST());
    expect(await apply(s3.sb)).toBe(1);
    expect(s3.ops.filter(([op]) => op !== "select")).toEqual([]);
    // 같은 지문·같은 이전 값이면 재사용해 반영(대조 시험의 양성 대조군)
    writeFileSync(snapPath, JSON.stringify({ ...good, fromSha16: sha }));
    const s4 = mkSb(APTS(), HIST());
    expect(await apply(s4.sb)).toBe(0);
    expect(val(s4.H, 4)).toBe(30);
  });

  it("UPDATE 가 0행이면 실패로 센다 — exit 1 · 실패 1 · 재조회 새 값 2/3", async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    const s2 = mkSb(APTS(), HIST());
    // 4번 줄 UPDATE 만 엉뚱한 id 조건으로 바꿔 0행이 돌아오게 한다(쓰기 사이 경합 흉내)
    const sb2 = {
      from: (/** @type {string} */ t) => {
        const f = s2.sb.from(t);
        return { ...f, update: (/** @type {any} */ p) => { const b = f.update(p); return { eq: (/** @type {string} */ c, /** @type {any} */ v) => b.eq(c, c === "id" && v === 4 ? -1 : v) }; } };
      },
    };
    expect(await apply(sb2)).toBe(1);
    const res = JSON.parse(readFileSync(join(dir, "apply.json"), "utf8"));
    expect(res.result).toEqual({ ok: 2, skip: 0, fail: 1, good: 2 });
    expect(res.rows.find((/** @type {any} */ r) => r.id === 4).result).toMatch(/^실패: 0행/);
    expect(val(s2.H, 4)).toBe(20);
  });

  it("다시 계산한 새 값이 --from 과 행 단위로 다르면 쓰기 0 + exit 1", async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    const pv = JSON.parse(readFileSync(plan(), "utf8"));
    // ① --from 의 새 값 1행을 바꿔 끼움
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ ...pv, rows: pv.rows.map((/** @type {any} */ r) => (r.id === 4 ? { ...r, new: 31 } : r)) }));
    const s2 = mkSb(APTS(), HIST());
    expect(await apply(s2.sb, bad)).toBe(1);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "apply.json"), "utf8"))).toMatchObject({ result: "거부(행 단위 불일치)", diffNew: 1, extra: 0 });
    // ② 미리보기 뒤 세대수가 바뀌어 분모가 달라짐(행 수는 그대로일 수 있다)
    const s3 = mkSb(APTS().map((a) => (a.id === "a3" ? { ...a, units: 500 } : a)), HIST());
    expect(await apply(s3.sb)).toBe(1);
    expect(s3.ops.filter(([op]) => op !== "select")).toEqual([]);
    // ③ 지금 계산엔 고칠 줄인데 --from 에 없는 행
    const fewer = join(dir, "fewer.json");
    writeFileSync(fewer, JSON.stringify({ ...pv, rows: pv.rows.filter((/** @type {any} */ r) => r.id !== 5) }));
    const s4 = mkSb(APTS(), HIST());
    expect(await apply(s4.sb, fewer)).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "apply.json"), "utf8"))).toMatchObject({ diffNew: 0, extra: 1 });
    expect(s4.ops.filter(([op]) => op !== "select")).toEqual([]);
  });

  it("KOSIS 저장본이 없거나 지문이 다르면 쓰기 0 + exit 1", async () => {
    const { sb } = mkSb(APTS(), HIST());
    await dry(sb);
    writeFileSync(kosisPathOf(plan()), JSON.stringify(KOSIS.slice(0, 3)));
    const s2 = mkSb(APTS(), HIST());
    expect(await apply(s2.sb)).toBe(1);
    expect(s2.ops).toEqual([]);
  });

  it("updateCount — 이전 값 null 이면 .is", async () => {
    const H = makeFakeSupabase(/** @type {any} */ ([h(9, "a1", "202601", null)]));
    const r = await updateCount({ from: () => H.from("unsold_history") }, 9, null, 5);
    expect(r.ok).toBe(true);
    expect(H.calls[0].filters).toEqual([["eq", "id"], ["is", "unsold_count"]]);
  });
});

describe("run — 되돌림", () => {
  it('"새" 만 사본 값으로 · 지금 = 사본은 건너뜀 · "그 밖" 은 실패 보고', async () => {
    const { sb, H } = mkSb(APTS(), HIST());
    await dry(sb);
    await apply(sb);
    // 4번 줄은 반영 뒤 수집기가 다른 값(33)으로 덮음 → 그 밖
    const s2 = mkSb(APTS(), H.snapshot().map((/** @type {any} */ x) => (x.id === 4 ? { ...x, unsold_count: 33 } : x)));
    expect(await undo(s2.sb)).toBe(1);
    expect([1, 4, 5].map((id) => val(s2.H, id))).toEqual([4, 33, 100]);
    const ups = s2.H.calls.filter((/** @type {any} */ c) => c.op === "update");
    expect(ups.length).toBe(2);
    expect(ups.every((/** @type {any} */ u) => JSON.stringify(u.filters) === JSON.stringify([["eq", "id"], ["eq", "unsold_count"]]))).toBe(true);
    // 다시 되돌리면 사본 값 행은 건너뛰고 그 밖만 실패(쓰기 0)
    const before = s2.H.calls.length;
    expect(await undo(s2.sb)).toBe(1);
    expect(s2.H.calls.length).toBe(before);
    expect(s2.ops.filter(([op]) => op === "insert" || op === "upsert" || op === "delete")).toEqual([]);
  });

  it("recorded_at 이 사본과 다르면(수집기가 다시 쓴 줄) 그 밖 — 그 행은 안 씀", async () => {
    const { sb, H } = mkSb(APTS(), HIST());
    await dry(sb);
    await apply(sb);
    const s2 = mkSb(APTS(), H.snapshot().map((/** @type {any} */ x) => (x.id === 5 ? { ...x, recorded_at: "2026-11-09" } : x)));
    /** @type {string[]} */ const errs = [];
    expect(await run([`--undo=${snapshotPathOf(plan())}`], { sb: s2.sb, now, log: () => {}, err: (s) => errs.push(s) })).toBe(1);
    expect([1, 4, 5].map((id) => val(s2.H, id))).toEqual([4, 20, 30]);
    expect(s2.H.calls.filter((/** @type {any} */ c) => c.op === "update").length).toBe(2);
    expect(errs.join()).toMatch(/5 — recorded_at/);
  });

  it("미리보기를 못 찾으면 사본과 다른 행은 되돌리지 않는다", async () => {
    const { sb, H } = mkSb(APTS(), HIST());
    await dry(sb);
    await apply(sb);
    const snapPath = snapshotPathOf(plan());
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    writeFileSync(snapPath, JSON.stringify({ ...snap, fromPath: join(dir, "없음.json") }));
    const s2 = mkSb(APTS(), H.snapshot());
    expect(await undo(s2.sb)).toBe(1);
    expect(s2.ops.filter(([op]) => op !== "select")).toEqual([]);
    expect([1, 4, 5].map((id) => val(s2.H, id))).toEqual([5, 30, 30]);
  });
});
