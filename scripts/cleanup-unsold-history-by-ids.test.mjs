// @ts-check
/**
 * cleanup-unsold-history-by-ids.mjs 시험 (세션578) — 가짜 Supabase·메모리 fs 로 dry-run → --apply 끝까지.
 * 첫 대상 = 음성아이파크(ap-6026677) 이력 2행(318→280).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { run, checkHistorySet } from "./cleanup-unsold-history-by-ids.mjs";
import { makeFakeSupabase, makeMemFs } from "./_fake-supabase.test-helper.mjs";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const CWD = "F:/fake-cwd";
const IDS = resolve(CWD, "ids.json");

function tables() {
  return {
    unsold_history: [
      { id: 11, apartment_id: "ap-6026677", base_month: "202607", unsold_count: 318, post_completion_unsold: 0, change: null },
      { id: 12, apartment_id: "ap-6026677", base_month: "202608", unsold_count: 280, post_completion_unsold: 0, change: -38 },
      { id: 13, apartment_id: "ah-다른단지", base_month: "202608", unsold_count: 5, post_completion_unsold: 0, change: null },
    ],
  };
}

describe("run — 입력 거부 (T2-1)", () => {
  it("--ids-file 이 없거나 파일이 없으면 code 1 · DB 호출 0", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await run({ argv: [], sb, cwd: CWD, ...makeMemFs() })).code).toBe(1);
    expect((await run({ argv: ["--ids-file=ids.json"], sb, cwd: CWD, ...makeMemFs() })).code).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  it("ids 가 1,000 을 넘으면 code 1 · DB 호출 0", async () => {
    const sb = makeFakeSupabase(tables());
    const ids = Array.from({ length: 1001 }, (_, i) => `ap-${i}`);
    const r = await run({ argv: ["--ids-file=ids.json"], sb, cwd: CWD, ...makeMemFs({ [IDS]: JSON.stringify(ids) }) });
    expect(r.code).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  it("--apply 에 --from 이 없으면 거부(code 1) · DB 호출 0", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await run({ argv: ["--ids-file=ids.json", "--apply"], sb, cwd: CWD, ...makeMemFs({ [IDS]: '["ap-6026677"]' }) });
    expect(r.code).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });
});

describe("checkHistorySet — 사본 ↔ DB 집합 대조 (T2-3)", () => {
  it("unsold_count 가 바뀐 행·없어진 행·명단 밖 행은 skip, 사본 뒤 새 행은 extra", () => {
    const snap = tables().unsold_history;
    const db = [
      { ...snap[0] },
      { ...snap[1], unsold_count: 275 },
      { id: 99, apartment_id: "ap-6026677", base_month: "202609", unsold_count: 270, post_completion_unsold: 0 },
    ];
    const { toDelete, skipped, extra } = checkHistorySet(/** @type {any} */ (snap), /** @type {any} */ (db), new Set(["ap-6026677"]));
    expect(toDelete.map((r) => r.id)).toEqual([11]);
    expect(skipped.map((s) => s.id)).toEqual([12, 13]);
    expect(skipped[0].reason).toBe("현재값 달라짐: unsold_count DB=275 사본=280");
    expect(skipped[1].reason).toMatch(/명단 밖/);
    expect(extra.map((r) => r.id)).toEqual([99]);
  });
});

describe("run — dry-run → --apply (T2-2·T2-3)", () => {
  it("dry-run 은 사본만 남기고, --apply --from 은 사본의 행만 지우고 남은 행 0 을 확인한다", async () => {
    const t = tables();
    const sb = makeFakeSupabase(t);
    const fs = makeMemFs({ [IDS]: '["ap-6026677"]' });
    const now = new Date(2026, 8, 26, 9, 0, 0);
    const r1 = await run({ argv: ["--ids-file=ids.json"], sb, cwd: CWD, now, ...fs });
    expect(r1.code).toBe(0);
    expect(r1.rows).toBe(2);
    expect(r1.beforePath).toBe(`${IDS}.history.before.20260926-090000.json`);
    expect(sb.calls.every((c) => c.op === "select")).toBe(true);
    // 같은 시각 재실행 — 사본 덮어쓰기 거부
    expect((await run({ argv: ["--ids-file=ids.json"], sb, cwd: CWD, now, ...fs })).code).toBe(1);

    const r2 = await run({ argv: ["--ids-file=ids.json", "--apply", `--from=${r1.beforePath}`], sb, cwd: CWD, ...fs });
    expect(r2.code).toBe(0);
    expect(r2.ok).toBe(2);
    expect(r2.left).toBe(0);
    expect(sb.tables.unsold_history.map((r) => r.id)).toEqual([13]);
  });

  it("사본 뒤 unsold_count 가 바뀐 행은 지우지 않고, 남은 행이 있으니 code 1", async () => {
    const t = tables();
    const sb = makeFakeSupabase(t);
    const fs = makeMemFs({ [IDS]: '["ap-6026677"]' });
    const r1 = await run({ argv: ["--ids-file=ids.json"], sb, cwd: CWD, now: new Date(2026, 8, 26, 9, 1, 0), ...fs });
    t.unsold_history[1].unsold_count = 275;
    const r2 = await run({ argv: ["--ids-file=ids.json", "--apply", `--from=${r1.beforePath}`], sb, cwd: CWD, ...fs });
    expect(r2.skipped).toBe(1);
    expect(r2.ok).toBe(1);
    expect(r2.code).toBe(1);
    expect(sb.tables.unsold_history.map((r) => r.id)).toEqual([12, 13]);
  });

  it("성공은 돌아온 행으로만 센다 — DELETE 가 행을 안 돌려주면 실패로 세고 code 1 (T2-4)", async () => {
    const t = tables();
    const fs = makeMemFs({ [IDS]: '["ap-6026677"]' });
    const r1 = await run({ argv: ["--ids-file=ids.json"], sb: makeFakeSupabase(t), cwd: CWD, now: new Date(2026, 8, 26, 9, 2, 0), ...fs });
    const sb = makeFakeSupabase(t, { failDeleteIds: new Set([12]) });
    const r2 = await run({ argv: ["--ids-file=ids.json", "--apply", `--from=${r1.beforePath}`], sb, cwd: CWD, ...fs });
    expect(r2.ok).toBe(1);
    expect(r2.fail).toBe(1);
    expect(r2.left).toBe(1);
    expect(r2.code).toBe(1);
  });
});
