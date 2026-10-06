// @ts-check
/**
 * air-annual-load.mjs — 3년 평균 반영 전 거르기 규칙 검증 (세션559)
 *
 * 핵심 규칙: **표본 1년치(8,760시간) 미만은 반영하지 않는다.**
 * 3년치가 정상이면 약 26,000시간인데, 중간 신설·폐지·장기 결측 측정소는 그보다 훨씬 적다.
 * 그 평균을 "3년 평균"이라 부르고 점수에 쓰면 얇은 표본으로 단지를 채점하게 된다.
 * 실측(2026-09-22): 671곳 중 20곳이 여기 걸린다(최소 733시간 = 한 달분).
 *
 * 새 파일에 없는 측정소 행은 지운다(세션605) — 폐쇄·개명 측정소의 옛 평균이 남으면 그 이름을 쥔 단지가
 * 낡은 값으로 채점된다. 단 지울 비율이 기존의 10% 를 넘으면(정확히 10% 는 통과) 아무것도 쓰지 않는다.
 * `--expect-purge=N` 이 있으면 비율 대신 "정확히 N곳"으로 판정한다.
 */
import { describe, it, expect } from "vitest";
import { prepareRows, MIN_SAMPLE_HOURS, planPurge, parseExpectPurge, runLoad, PURGE_CHUNK } from "./air-annual-load.mjs";

/** @param {Record<string, unknown>} over */
const row = (over) => ({
  station_name: "중구",
  station_code: "111121",
  pm25: 18.5,
  pm10: 24.6,
  o3: 0.031,
  years: "2022,2023,2024",
  sample_hours: 26000,
  address: "서울 중구 덕수궁길 15",
  ...over,
});

describe("prepareRows — 얇은 표본을 거른다", () => {
  it("3년치 정상 표본은 반영한다", () => {
    const { accepted, rejected } = prepareRows([row({})]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    expect(accepted[0].station_name).toBe("중구");
    expect(accepted[0].pm25).toBe(18.5);
  });

  it("표본 1년 미만은 거른다 (실측 20곳)", () => {
    // 선암동 733시간(한 달분) — 이 값으로 단지를 채점하면 안 된다
    const { accepted, rejected } = prepareRows([row({ station_name: "선암동", sample_hours: 733 })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain("733");
  });

  it("경계: 정확히 8,760시간은 반영한다 (1년치는 쓸 수 있다)", () => {
    const { accepted } = prepareRows([row({ sample_hours: MIN_SAMPLE_HOURS })]);
    expect(accepted).toHaveLength(1);
  });

  it("경계: 8,759시간은 거른다", () => {
    const { accepted } = prepareRows([row({ sample_hours: MIN_SAMPLE_HOURS - 1 })]);
    expect(accepted).toHaveLength(0);
  });

  it("측정값이 전무하면 거른다 (표본 수가 많아도)", () => {
    const { accepted, rejected } = prepareRows([row({ pm25: null, pm10: null })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain("측정값");
  });

  it("pm25 가 없어도 pm10 이 있으면 반영한다", () => {
    const { accepted } = prepareRows([row({ pm25: null })]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].pm25).toBeNull();
    expect(accepted[0].pm10).toBe(24.6);
  });

  it("측정소명이 비면 거른다", () => {
    const { accepted, rejected } = prepareRows([row({ station_name: "   " })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain("측정소명");
  });

  it("측정소명 앞뒤 공백은 다듬는다 (조인 키라 어긋나면 단지가 통째로 빠진다)", () => {
    const { accepted } = prepareRows([row({ station_name: " 중구 " })]);
    expect(accepted[0].station_name).toBe("중구");
  });

  it("sample_hours 가 숫자가 아니면 0 으로 보고 거른다", () => {
    const { accepted } = prepareRows([row({ sample_hours: null })]);
    expect(accepted).toHaveLength(0);
  });
});

/** @param {number} n @param {string} [p] */
const names = (n, p = "s") => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(3, "0")}`);

describe("planPurge — 새 파일에 없는 측정소 (세션605)", () => {
  it("기존 100 · 겹침 95 → 지울 5 · 5% · 통과", () => {
    const existing = names(100);
    const p = planPurge(existing, existing.slice(0, 95));
    expect(p.toDelete).toEqual(existing.slice(95));
    expect(p.ratio).toBe(0.05);
    expect(p.breaker).toEqual({ fired: false, limit: 0.1, expect: null });
  });

  it("기존 100 · 겹침 85 → 지울 15 · 15% · 발동", () => {
    const existing = names(100);
    const p = planPurge(existing, existing.slice(0, 85));
    expect(p.toDelete).toHaveLength(15);
    expect(p.ratio).toBe(0.15);
    expect(p.breaker.fired).toBe(true);
  });

  it("경계: 정확히 10% 는 통과, 한 곳 더(11%)면 발동", () => {
    const existing = names(100);
    expect(planPurge(existing, existing.slice(0, 90)).breaker.fired).toBe(false);
    expect(planPurge(existing, existing.slice(0, 89)).breaker.fired).toBe(true);
  });

  it("expect 일치 → 비율이 넘어도 통과 · 불일치 → 비율이 낮아도 발동", () => {
    const existing = names(100);
    expect(planPurge(existing, existing.slice(0, 85), { expect: 15 }).breaker).toEqual({ fired: false, limit: 0.1, expect: 15 });
    expect(planPurge(existing, existing.slice(0, 85), { expect: 14 }).breaker.fired).toBe(true);
    expect(planPurge(existing, existing.slice(0, 98), { expect: 0 }).breaker.fired).toBe(true);
  });

  it("기존 0 → 지울 0 · 비율 0 · 통과", () => {
    const p = planPurge([], names(5));
    expect(p).toEqual({ toDelete: [], ratio: 0, breaker: { fired: false, limit: 0.1, expect: null } });
  });

  it("새 파일에만 있는 이름은 지울 명단에 안 들어간다 · 명단은 정렬", () => {
    const p = planPurge(["다", "가", "나"], ["나", "새측정소"]);
    expect(p.toDelete).toEqual(["가", "다"]);
  });
});

describe("parseExpectPurge — 정수만 (세션605)", () => {
  it("없으면 null · 정수면 그 값", () => {
    expect(parseExpectPurge(["node", "x", "--apply"])).toBeNull();
    expect(parseExpectPurge(["node", "x", "--expect-purge=15"])).toBe(15);
    expect(parseExpectPurge(["node", "x", "--expect-purge=0"])).toBe(0);
  });
  it("두 번 주면 즉시 실패 (어느 값이 이기는지 모호 — 세션605 보완)", () => {
    expect(() => parseExpectPurge(["node", "x", "--expect-purge=15", "--expect-purge=3"])).toThrow(/한 번만/);
  });
  it("정수가 아니면 즉시 실패", () => {
    for (const a of ["--expect-purge=", "--expect-purge=abc", "--expect-purge=1.5", "--expect-purge=-1", "--expect-purge"]) {
      expect(() => parseExpectPurge(["node", "x", a]), a).toThrow(/정수/);
    }
  });
});

/**
 * 아주 작은 가짜 Supabase — selectAll(커서) · upsert · delete().in() · insert(collector_runs) 만 흉내.
 * @param {string[]} existingNames
 * @param {{ deleteError?: boolean, upsertFailStation?: string }} [o]
 */
function makeFakeSb(existingNames, o = {}) {
  /** 쓰기 호출 순서(upsert → delete) — 한 배열에 담아 순서를 단언한다. @type {string[]} */
  const calls = [];
  /** @type {any[][]} */
  const upserts = [];
  /** @type {string[][]} */
  const deletes = [];
  /** @type {any[]} */
  const runs = [];
  const sb = {
    /** @param {string} table */
    from(table) {
      return {
        select() {
          const q = {
            order() { return q; },
            limit() { return q; },
            gt() { return { then: (/** @type {any} */ r) => r({ data: [], error: null }) }; },
            then(/** @type {any} */ r) { return r({ data: existingNames.map((station_name) => ({ station_name })), error: null }); },
          };
          return q;
        },
        /** @param {any[]} rows */
        upsert(rows) {
          calls.push("upsert");
          // upsertFailStation 이 든 묶음은 실패 — upsertBatch 가 한 행씩 다시 넣어 그 한 곳만 빠진다.
          if (o.upsertFailStation && rows.some((r) => r.station_name === o.upsertFailStation)) {
            return Promise.resolve({ error: { message: "bad row" } });
          }
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            /** @param {string} _c @param {string[]} list */
            in(_c, list) {
              calls.push("delete");
              deletes.push(list);
              return Promise.resolve({ error: o.deleteError ? { message: "boom" } : null });
            },
          };
        },
        /** @param {any} row */
        insert(row) { if (table === "collector_runs") runs.push(row); return Promise.resolve({ error: null }); },
      };
    },
  };
  return { sb: /** @type {any} */ (sb), upserts, deletes, runs, calls };
}

/** @param {string[]} stations */
const fileOf = (stations) => stations.map((s) => row({ station_name: s }));

describe("runLoad — 흐름 (세션605)", () => {
  it("dry-run 은 아무것도 쓰지 않고 계획만 돌려준다", async () => {
    const f = makeFakeSb(["가", "나", "다"]);
    const { exitCode, plan } = await runLoad(fileOf(["가", "나"]), { apply: false, sb: f.sb, recordSb: f.sb });
    expect(exitCode).toBe(0);
    expect(plan.toDelete).toEqual(["다"]);
    expect(f.upserts).toEqual([]);
    expect(f.deletes).toEqual([]);
    expect(f.runs).toEqual([]);
  });

  it("⚠️ 차단기 발동이면 upsert·삭제 0 · 실패 기록 · exit 1", async () => {
    const existing = names(100);
    const f = makeFakeSb(existing);
    const { exitCode } = await runLoad(fileOf(existing.slice(0, 85)), { apply: true, sb: f.sb, recordSb: f.sb });
    expect(exitCode).toBe(1);
    expect(f.upserts).toEqual([]);
    expect(f.deletes).toEqual([]);
    expect(f.runs).toHaveLength(1);
    expect(f.runs[0]).toMatchObject({ collector: "air-annual", status: "failure", ok_count: 0, fail_count: 1 });
    expect(f.runs[0].error_message).toContain("PURGE_BREAKER");
  });

  it("통과면 upsert → 삭제 → 기록(ok=반영·skip=제외·ANNUAL_PURGED=N)", async () => {
    const existing = names(100);
    const f = makeFakeSb(existing);
    const file = [...fileOf(existing.slice(0, 95)), row({ station_name: "얇은곳", sample_hours: 10 })];
    const { exitCode } = await runLoad(file, { apply: true, sb: f.sb, recordSb: f.sb });
    expect(exitCode).toBe(0);
    expect(f.upserts.flat()).toHaveLength(95);
    expect(f.deletes).toEqual([existing.slice(95)]);
    expect(f.calls, "반영이 삭제보다 먼저여야 한다").toEqual(["upsert", "delete"]);
    expect(f.runs[0]).toMatchObject({ status: "success", ok_count: 95, skip_count: 1, error_message: "ANNUAL_PURGED=5" });
  });

  it("지울 것이 없으면 삭제 호출 0 · error_message 없음", async () => {
    const f = makeFakeSb(["가", "나"]);
    await runLoad(fileOf(["가", "나"]), { apply: true, sb: f.sb, recordSb: f.sb });
    expect(f.deletes).toEqual([]);
    expect(f.runs[0]).toMatchObject({ status: "success", ok_count: 2, error_message: null });
  });

  it("--expect-purge 일치면 10% 를 넘어도 진행 · 삭제는 200개씩 나눈다", async () => {
    const existing = names(500);
    const f = makeFakeSb(existing);
    const { exitCode } = await runLoad(fileOf(existing.slice(0, 50)), { apply: true, expectPurge: 450, sb: f.sb, recordSb: f.sb });
    expect(exitCode).toBe(0);
    expect(f.deletes.map((d) => d.length)).toEqual([PURGE_CHUNK, PURGE_CHUNK, 50]);
    expect(f.runs[0].error_message).toBe("ANNUAL_PURGED=450");
  });

  it("삭제 오류는 실패로 센다 · exit 1", async () => {
    const existing = names(100);
    const f = makeFakeSb(existing, { deleteError: true });
    const { exitCode } = await runLoad(fileOf(existing.slice(0, 95)), { apply: true, sb: f.sb, recordSb: f.sb });
    expect(exitCode).toBe(1);
    expect(f.runs[0]).toMatchObject({ status: "failure", fail_count: 5 });
    expect(f.runs[0].error_message).toBe("PURGE_FAILED=1: boom");
  });

  it("⚠️ 반영이 한 곳이라도 빠지면 삭제를 건너뛴다 · fail 1 · UPSERT_PARTIAL (세션605 보완)", async () => {
    const existing = names(20);
    const f = makeFakeSb(existing, { upsertFailStation: existing[0] });
    const { exitCode } = await runLoad(fileOf(existing.slice(0, 19)), { apply: true, sb: f.sb, recordSb: f.sb });
    expect(exitCode).toBe(1);
    expect(f.upserts.flat()).toHaveLength(18);
    expect(f.deletes).toEqual([]);
    expect(f.calls).not.toContain("delete");
    expect(f.runs[0]).toMatchObject({ status: "failure", ok_count: 18, fail_count: 1 });
    expect(f.runs[0].error_message).toBe("UPSERT_PARTIAL=18/19");
  });
});
