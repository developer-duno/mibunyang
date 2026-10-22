// @ts-check
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeSupabase } from "./_fake-supabase.mjs";
import {
  parseArgs, validatePlan, rateOf, classifyRow, changeKind, run, snapshotPathOf,
  molitTargeted, viewUnitsChanges, kosisDenomChanges, naverRefill, liveVisibility,
} from "./fix-units-from-plan.mjs";

/** @param {Record<string, any>} o @returns {any} */
const row = (o) => ({
  name: "단지", region: "경기", gu: "수원시", units: null, unit_source: null, unsold: null, unsold_rate: null,
  unsold_source: "kosis", unsold_as_of: null, presale_type: null, naver_presale_no: null, complex_key: null,
  updated_at: "2026-10-21T08:00:00Z", ...o,
});

/** @type {any} */
const PLAN = {
  generatedAt: "2026-10-21T01:12:19Z",
  counts: { set: 2, set_null: 1, skip: 1 },
  plan: [
    { id: "ah-1", name: "가", region: "경기", oldUnits: 98, oldSource: null, newUnits: 340, newSource: "applyhome", basis: "b", action: "set" },
    { id: "ah-2", name: "나", region: "경기", oldUnits: 646, oldSource: "molit", newUnits: 997, newSource: "applyhome", basis: "b", action: "set" },
    { id: "ah-3", name: "다", region: "세종", oldUnits: 1, oldSource: null, newUnits: null, newSource: null, basis: "b", action: "set_null" },
    { id: "ah-4", name: "라", region: "대구", oldUnits: 454, oldSource: "molit", newUnits: null, newSource: null, basis: "b", action: "skip" },
  ],
};

const baseRows = () => [
  row({ id: "ah-1", units: 98, unsold: 14, unsold_rate: 14.3, complex_key: "k1", naver_presale_no: "6026203" }),
  row({ id: "ah-2", units: 646, unit_source: "molit", unsold: 89, unsold_rate: 13.8, complex_key: "k2" }),
  row({ id: "ah-3", units: 1, region: "세종", gu: null, unsold_source: null, complex_key: "ks" }),
  row({ id: "ah-3b", units: 1, region: "세종", gu: null, unsold_source: null, complex_key: "ks" }),
  row({ id: "ah-4", units: 454, unit_source: "molit", unsold: 173, unsold_rate: 38.1, complex_key: "k4" }),
];

/** @type {string} */ let dir;
/** @type {string} */ let planPath;
const quiet = { log: () => {}, err: () => {} };
const now = () => new Date("2026-10-22T00:00:00Z");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fix-units-"));
  planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(PLAN));
});

/** @param {any} sb @param {string[]} extra */
const dry = (sb, extra = []) => run([`--plan=${planPath}`, `--impact-out=${join(dir, "dry.json")}`, ...extra], { sb, livePath: join(dir, "none.json"), now, ...quiet });
/** @param {any} sb */
const apply = (sb) => run([`--plan=${planPath}`, `--impact-out=${join(dir, "apply.json")}`, "--apply", `--from=${join(dir, "dry.json")}`], { sb, livePath: join(dir, "none.json"), now, ...quiet });
/** @param {any} sb */
const undo = (sb) => run([`--plan=${planPath}`, `--undo=${snapshotPathOf(planPath)}`], { sb, now, ...quiet });
/** @param {any} sb @param {string} id */
const get = (sb, id) => sb.snapshot().find((/** @type {any} */ r) => r.id === id);

describe("parseArgs — 허용 목록", () => {
  it("모르는 인자·--dry-run 은 던진다", () => {
    expect(() => parseArgs(["--plan=a", "--impact-out=b", "--dry-run"])).toThrow(/모르는 인자/);
    expect(() => parseArgs(["--plan=a", "--impact-out=b", "--foo=1"])).toThrow(/모르는 인자/);
  });
  it("필수·조합 규칙", () => {
    expect(() => parseArgs(["--impact-out=b"])).toThrow(/--plan/);
    expect(() => parseArgs(["--plan=a"])).toThrow(/--impact-out/);
    expect(() => parseArgs(["--plan=a", "--impact-out=b", "--apply"])).toThrow(/--from/);
    expect(() => parseArgs(["--plan=a", "--impact-out=b", "--from=c"])).toThrow(/--apply 와만/);
    expect(() => parseArgs(["--plan=a", "--impact-out=b", "--apply", "--from=b"])).toThrow(/같은 파일/);
    expect(() => parseArgs(["--plan=a", "--undo=s", "--impact-out=b"])).toThrow(/--undo/);
    expect(() => parseArgs(["--plan=a", "--undo=s", "--apply", "--from=c"])).toThrow(/같이 못/);
    expect(parseArgs(["--plan=a", "--impact-out=b"]).mode).toBe("dry");
  });
  it("--impact-out 이 계획 파일·되돌림 사본 경로면 던진다(정규화 비교)", () => {
    expect(() => parseArgs(["--plan=d/plan.json", "--impact-out=./d/../d/plan.json"])).toThrow(/계획 파일/);
    expect(() => parseArgs(["--plan=d/plan.json", "--impact-out=d/plan.before.json"])).toThrow(/되돌림 사본/);
    expect(() => parseArgs(["--plan=d/plan.json", "--impact-out=d/plan.before.json", "--apply", "--from=d/dry.json"])).toThrow(/되돌림 사본/);
    expect(parseArgs(["--plan=a", "--undo=s"]).mode).toBe("undo");
  });
});

describe("validatePlan", () => {
  it("개수 불일치·중복·이상한 새 값·할 일 없는 행을 거부", () => {
    expect(() => validatePlan({ ...PLAN, counts: { set: 3, set_null: 1, skip: 1 } })).toThrow(/counts.set/);
    expect(() => validatePlan({ plan: [PLAN.plan[0], PLAN.plan[0]] })).toThrow(/중복/);
    expect(() => validatePlan({ plan: [{ ...PLAN.plan[0], newUnits: 1 }] })).toThrow(/새 값/);
    expect(() => validatePlan({ plan: [{ ...PLAN.plan[2], newUnits: 5 }] })).toThrow(/set_null/);
    expect(() => validatePlan({ plan: [{ ...PLAN.plan[0], newUnits: 98, newSource: null }] })).toThrow(/새 값|이전 = 새/);
    expect(validatePlan(PLAN).targets.length).toBe(3);
  });
});

describe("rateOf · classifyRow · changeKind", () => {
  it("미분양률은 수집기와 같은 식", () => {
    expect(rateOf(14, 340)).toBe(4.1);
    expect(rateOf(14, 98)).toBe(14.3);
    expect(rateOf(14, null)).toBeNull();
    expect(rateOf(null, 340)).toBeNull();
    expect(rateOf(500, 100)).toBeNull(); // 100 초과 → null(clampUnsoldRate)
  });
  it("이전 / 새 / 그 밖 / 건너뜀", () => {
    const p = PLAN.plan[0];
    expect(classifyRow(row({ id: "ah-1", units: 98, unsold: 14, unsold_rate: 14.3 }), p)).toBe("이전");
    expect(classifyRow(row({ id: "ah-1", units: 340, unit_source: "applyhome", unsold: 14, unsold_rate: 4.1 }), p)).toBe("새");
    expect(classifyRow(row({ id: "ah-1", units: 99, unsold: 14, unsold_rate: 14.1 }), p)).toBe("그 밖");
    expect(classifyRow(row({ id: "ah-1", units: 98, unit_source: "molit", unsold: 14, unsold_rate: 14.3 }), p)).toBe("그 밖");
    // 재료 칸 unsold 가 미리보기 때(14)와 다르면 그 밖
    expect(classifyRow(row({ id: "ah-1", units: 98, unsold: 15, unsold_rate: 15.3 }), p, 14)).toBe("그 밖");
    expect(classifyRow(row({ id: "ah-4" }), PLAN.plan[3])).toBe("건너뜀");
    expect(changeKind(PLAN.plan[0])).toBe("값→다른 값");
    expect(changeKind(PLAN.plan[2])).toBe("값→빈칸");
    expect(changeKind(PLAN.plan[3])).toBe("건너뜀");
  });
});

describe("run — 미리보기", () => {
  it("impact 를 저장하고 쓰기 0", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await dry(sb)).toBe(0);
    expect(sb.calls.length).toBe(0);
    const impact = JSON.parse(readFileSync(join(dir, "dry.json"), "utf8"));
    expect(impact.mode).toBe("dry");
    expect(impact.summary.byState).toEqual({ "이전": 3, "건너뜀": 1 });
    expect(impact.summary.byChange).toEqual({ "값→다른 값": 2, "값→빈칸": 1, "건너뜀": 1 });
    expect(impact.rows.find((/** @type {any} */ r) => r.id === "ah-1").next).toEqual({ units: 340, unit_source: "applyhome", unsold_rate: 4.1 });
    expect(existsSync(snapshotPathOf(planPath))).toBe(false); // 미리보기는 사본을 안 만든다
  });
  it('"그 밖" 이 있어도 미리보기는 exit 0(경고)', async () => {
    const rows = baseRows();
    rows[0].units = 99;
    const sb = makeFakeSupabase(rows);
    expect(await dry(sb)).toBe(0);
    const impact = JSON.parse(readFileSync(join(dir, "dry.json"), "utf8"));
    expect(impact.summary.byState["그 밖"]).toBe(1);
  });
});

describe("run — 반영", () => {
  it("이전 → 새, null 기대값은 .is, 사본 wx", async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    expect(await apply(sb)).toBe(0);
    expect(get(sb, "ah-1")).toMatchObject({ units: 340, unit_source: "applyhome", unsold: 14, unsold_rate: 4.1 });
    expect(get(sb, "ah-2")).toMatchObject({ units: 997, unit_source: "applyhome", unsold_rate: 8.9 });
    expect(get(sb, "ah-3")).toMatchObject({ units: null, unit_source: null, unsold_rate: null });
    expect(get(sb, "ah-3b")).toMatchObject({ units: 1 }); // 명단 밖 형제는 그대로
    expect(get(sb, "ah-4")).toMatchObject({ units: 454, unit_source: "molit" }); // skip
    const ups = sb.calls.filter((c) => c.op === "update");
    expect(ups.length).toBe(3);
    // ah-1 의 기대 unit_source 는 null → .is, ah-2 는 molit → .eq
    expect(ups[0].filters).toEqual(expect.arrayContaining([["is", "unit_source"], ["eq", "units"], ["eq", "unsold"]]));
    expect(ups[0].filters).not.toContainEqual(["eq", "unit_source"]);
    expect(ups[1].filters).toContainEqual(["eq", "unit_source"]);
    expect(ups[2].filters).toEqual(expect.arrayContaining([["is", "unit_source"], ["is", "unsold"]]));
    const snap = JSON.parse(readFileSync(snapshotPathOf(planPath), "utf8"));
    expect(snap.rows.map((/** @type {any} */ r) => r.id)).toEqual(["ah-1", "ah-2", "ah-3"]);
    expect(snap.rows[0]).toEqual({ id: "ah-1", units: 98, unit_source: null, unsold: 14, unsold_rate: 14.3, updated_at: "2026-10-21T08:00:00Z" });
  });

  it('"그 밖" 1행이면 쓰기 0 + exit 1(사본도 안 만든다)', async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    const r = sb.snapshot();
    const sb2 = makeFakeSupabase(r.map((x) => (x.id === "ah-2" ? { ...x, units: 650 } : x)));
    expect(await apply(sb2)).toBe(1);
    expect(sb2.calls.filter((c) => c.op === "update").length).toBe(0);
    expect(existsSync(snapshotPathOf(planPath))).toBe(false);
  });

  it("미리보기와 반영 사이 unsold 가 바뀌면 그 밖 → 쓰기 0", async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    const sb2 = makeFakeSupabase(sb.snapshot().map((x) => (x.id === "ah-1" ? { ...x, unsold: 20, unsold_rate: 20.4 } : x)));
    expect(await apply(sb2)).toBe(1);
    expect(sb2.calls.length).toBe(0);
    // unsold 만 바뀌고 미분양률은 옛 값 그대로여도 그 밖
    const sb3 = makeFakeSupabase(sb.snapshot().map((x) => (x.id === "ah-1" ? { ...x, unsold: 20 } : x)));
    expect(await apply(sb3)).toBe(1);
    expect(sb3.calls.length).toBe(0);
  });

  it("일부만 반영된 뒤 다시 돌리면 남은 행만 잇는다(사본 재사용)", async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    expect(await apply(sb)).toBe(0);
    const snapBefore = readFileSync(snapshotPathOf(planPath), "utf8");
    // ah-2 만 이전 값으로 돌아간 상태(= 그 행 쓰기가 실패했던 것과 같다)
    const sb2 = makeFakeSupabase(sb.snapshot().map((x) => (x.id === "ah-2" ? { ...x, units: 646, unit_source: "molit", unsold_rate: 13.8 } : x)));
    expect(await apply(sb2)).toBe(0);
    const ups = sb2.calls.filter((c) => c.op === "update");
    expect(ups.length).toBe(1);
    expect(get(sb2, "ah-2")).toMatchObject({ units: 997, unit_source: "applyhome" });
    expect(readFileSync(snapshotPathOf(planPath), "utf8")).toBe(snapBefore);
  });

  it('사본이 없는데 이미 "새" 행이 있으면 거부', async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    const sb2 = makeFakeSupabase(sb.snapshot().map((x) => (x.id === "ah-1" ? { ...x, units: 340, unit_source: "applyhome", unsold_rate: 4.1 } : x)));
    expect(await apply(sb2)).toBe(1);
    expect(sb2.calls.length).toBe(0);
  });

  it("계획 파일이 미리보기 뒤 바뀌면 던진다(sha256)", async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    writeFileSync(planPath, JSON.stringify({ ...PLAN, generatedAt: "x" }));
    await expect(apply(sb)).rejects.toThrow(/sha256/);
  });
});

describe("run — 되돌림", () => {
  it('"새" 만 사본 값으로, "그 밖" 은 실패 보고', async () => {
    const sb = makeFakeSupabase(baseRows());
    await dry(sb);
    await apply(sb);
    // ah-2 는 반영 뒤 KOSIS 가 unsold 를 바꿈 → 그 밖
    const sb2 = makeFakeSupabase(sb.snapshot().map((x) => (x.id === "ah-2" ? { ...x, unsold: 50, unsold_rate: 5 } : x)));
    expect(await undo(sb2)).toBe(1);
    expect(get(sb2, "ah-1")).toMatchObject({ units: 98, unit_source: null, unsold_rate: 14.3 });
    expect(get(sb2, "ah-3")).toMatchObject({ units: 1, unit_source: null });
    expect(get(sb2, "ah-2")).toMatchObject({ units: 997, unsold: 50 });
    // 다시 되돌리면 이전 행은 건너뛰고 그 밖만 실패
    const before = sb2.calls.length;
    expect(await undo(sb2)).toBe(1);
    expect(sb2.calls.length).toBe(before);
  });
});

describe("세 시점 판정(순수)", () => {
  it("molit-units 대상 조건 — null 은 대상 아님", () => {
    expect(molitTargeted({ id: "a", units: 1, unsold_rate: null })).toBe(true);
    expect(molitTargeted({ id: "a", units: null, unsold_rate: null })).toBe(false);
    expect(molitTargeted({ id: "a", units: 340, unsold_rate: 100 })).toBe(true);
    expect(molitTargeted({ id: "a", units: 340, unsold_rate: 4.1 })).toBe(false);
  });
  it("VIEW 카드 세대수 — 혼자면 그 행, 묶음이면 D7(1 이하 제외)", () => {
    const before = [row({ id: "a", units: 98, complex_key: "k1" }), row({ id: "s1", units: 1, complex_key: "ks" }), row({ id: "s2", units: 1, complex_key: "ks" })];
    const after = [row({ id: "a", units: 340, complex_key: "k1" }), row({ id: "s1", units: null, complex_key: "ks" }), row({ id: "s2", units: 1, complex_key: "ks" })];
    const v = viewUnitsChanges(before, after);
    expect(v.bundles).toBe(2);
    expect(v.changed).toEqual([{ key: "k1", before: 98, after: 340 }]);
    expect(kosisDenomChanges(before, after)).toEqual([{ key: "k1", before: 98, after: 340 }]);
  });
  it("naver-presale 다시 채움 후보 = 빈칸 + 번호", () => {
    const r = naverRefill([
      row({ id: "ah-3", units: null }), row({ id: "ah-5", units: null, naver_presale_no: "1" }),
      row({ id: "ah-1", units: 340, unit_source: "applyhome", naver_presale_no: "6026203" }),
      row({ id: "ap-9", units: 500, unit_source: "naver_presale", naver_presale_no: "9" }), // 번호 주인 = 따라가기 후보
      row({ id: "ap-8", units: 500, unit_source: "naver_presale", naver_presale_no: "7" }), // 주인 아님
    ]);
    expect(r.blankAfter).toEqual(["ah-3", "ah-5"]);
    expect(r.blankWithPresaleNo).toEqual(["ah-5"]);
    expect(r.followCandidates).toEqual(["ap-9"]);
  });
  it("라이브 노출 — 대표 / 묶인 행 / 안 보임", () => {
    const live = { data: [{ id: "a", memberIds: ["a", "b"], aliasIds: ["a", "b"] }, { id: "c" }] };
    expect(liveVisibility(["a", "b", "z"], live)).toEqual({ cards: 2, asRep: 1, asMember: 1, notShown: ["z"] });
  });
});
