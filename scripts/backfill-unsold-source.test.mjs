// @ts-check
/**
 * backfill-unsold-source.mjs 테스트 — 순수 판정 함수 checkPlanRow 검증 (세션568)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// _shared.mjs 모킹 (main() 실행 경로 검증용)
const selectAllMock = vi.fn();

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    selectAll: (/** @type {any[]} */ ...args) => selectAllMock(...args),
  };
});

const { checkPlanRow, main } = await import("./backfill-unsold-source.mjs");
const { getSupabase, log: logMock } = /** @type {any} */ (await import("./collectors/_shared.mjs"));

/** @param {Partial<any>} o */
function planRow(o = {}) {
  return {
    id: "id-1", name: "테스트단지", op: "mark_kosis",
    expect: { unsold: 50, unsold_rate: 10, unsold_source: null },
    set: { unsold_source: "kosis" },
    ...o,
  };
}

/** @param {Partial<any>} o */
function dbRow(o = {}) {
  return { id: "id-1", unsold: 50, unsold_rate: 10, unsold_source: null, ...o };
}

// ── checkPlanRow ────────────────────────────────────────────
describe("checkPlanRow", () => {
  it("expect 의 모든 키가 DB 값과 같으면 ok:true", () => {
    const r = checkPlanRow(planRow(), dbRow());
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("DB 에 그 id 행이 없으면 ok:false, reason='행 없음'", () => {
    const r = checkPlanRow(planRow(), undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("행 없음");
  });

  it("값이 바뀌었으면(unsold 다름) ok:false + 사유에 필드명", () => {
    const r = checkPlanRow(planRow(), dbRow({ unsold: 99 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unsold");
  });

  it("unsold_rate 가 바뀌었으면 ok:false", () => {
    const r = checkPlanRow(planRow(), dbRow({ unsold_rate: 5 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unsold_rate");
  });

  it("출처가 이미 있으면(expect unsold_source=null 인데 DB 에 값 있음) ok:false", () => {
    const r = checkPlanRow(planRow(), dbRow({ unsold_source: "applyhome" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unsold_source");
  });

  // ── null 비교 ──
  it("null 은 null 과만 같다 — expect null, DB null → ok", () => {
    const r = checkPlanRow(planRow({ expect: { unsold_source: null } }), dbRow({ unsold_source: null }));
    expect(r.ok).toBe(true);
  });

  it("null 은 null 과만 같다 — expect null, DB 에 값 있음 → 불일치", () => {
    const r = checkPlanRow(planRow({ expect: { unsold_source: null } }), dbRow({ unsold_source: "kosis" }));
    expect(r.ok).toBe(false);
  });

  it("null 은 null 과만 같다 — expect 값, DB null → 불일치", () => {
    const r = checkPlanRow(planRow({ expect: { unsold: 50 } }), dbRow({ unsold: null }));
    expect(r.ok).toBe(false);
  });

  // ── 숫자는 Number() 비교 ──
  it("숫자는 Number() 로 비교 — 문자열 '50' 과 숫자 50 이 같다", () => {
    const r = checkPlanRow(planRow({ expect: { unsold: "50" } }), dbRow({ unsold: 50 }));
    expect(r.ok).toBe(true);
  });

  // ── expect 에 없는 키는 비교하지 않는다 (clear_listing_hold 의 unsold_rate 부재) ──
  it("expect 에 unsold_rate 가 없으면 DB 의 unsold_rate 값과 무관하게 ok (op=clear_listing_hold 형태)", () => {
    const row = planRow({
      op: "clear_listing_hold",
      expect: { unsold: 105, unsold_source: null }, // unsold_rate 없음
      set: { unsold: null, unsold_rate: null, unsold_source: null },
    });
    const r = checkPlanRow(row, dbRow({ unsold: 105, unsold_rate: 999, unsold_source: null })); // rate 가 뭐든 무관
    expect(r.ok).toBe(true);
  });

  // ── op 3종 형태 각각 ──
  it("op=mark_kosis — expect(unsold,unsold_rate,unsold_source=null) 일치 시 ok", () => {
    const row = planRow({ op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } });
    const r = checkPlanRow(row, dbRow({ unsold: 1, unsold_rate: 2, unsold_source: null }));
    expect(r.ok).toBe(true);
  });

  it("op=replace_kosis — expect(옛값) 일치 시 ok, set 은 새값+출처", () => {
    const row = planRow({
      op: "replace_kosis",
      expect: { unsold: 8, unsold_rate: 24.2, unsold_source: null },
      set: { unsold: 1, unsold_rate: 3, unsold_source: "kosis" },
    });
    const r = checkPlanRow(row, dbRow({ unsold: 8, unsold_rate: 24.2, unsold_source: null }));
    expect(r.ok).toBe(true);
  });

  it("op=clear_listing_hold — expect(unsold, unsold_source=null) 일치 시 ok, set 은 전부 null", () => {
    const row = planRow({
      op: "clear_listing_hold",
      expect: { unsold: 105, unsold_source: null },
      set: { unsold: null, unsold_rate: null, unsold_source: null },
    });
    const r = checkPlanRow(row, dbRow({ unsold: 105, unsold_rate: 30, unsold_source: null }));
    expect(r.ok).toBe(true);
  });
});

// ── main() — 계획 파일 모드 실행 경로 ──────────────────────
describe("main() — 계획 파일 모드", () => {
  beforeEach(() => {
    selectAllMock.mockReset();
    getSupabase.mockReset();
    logMock.mockReset();
  });

  it("dry-run — op 별 통과/불일치 집계, DB 에 쓰기 0", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { writeFileSync: wf, rmSync } = await import("node:fs");
    const planPath = path.join(os.tmpdir(), `s568_plan_${Date.now()}.json`);
    wf(planPath, JSON.stringify({
      counts: { mark_kosis: 1, replace_kosis: 1, clear_listing_hold: 1 },
      plan: [
        { id: "a", name: "A", op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } },
        { id: "b", name: "B", op: "replace_kosis", expect: { unsold: 8, unsold_rate: 24.2, unsold_source: null }, set: { unsold: 1, unsold_rate: 3, unsold_source: "kosis" } },
        { id: "c", name: "C", op: "clear_listing_hold", expect: { unsold: 105, unsold_source: null }, set: { unsold: null, unsold_rate: null, unsold_source: null } },
        { id: "d", name: "D(불일치)", op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } },
      ],
    }), "utf8");

    selectAllMock.mockResolvedValueOnce([
      { id: "a", unsold: 1, unsold_rate: 2, unsold_source: null },
      { id: "b", unsold: 8, unsold_rate: 24.2, unsold_source: null },
      { id: "c", unsold: 105, unsold_rate: 30, unsold_source: null },
      { id: "d", unsold: 999, unsold_rate: 2, unsold_source: null }, // 불일치
    ]);

    /** @type {any[]} */
    const updateCalls = [];
    getSupabase.mockReturnValue({
      from: () => ({
        update: (/** @type {any} */ payload) => ({
          eq: () => { updateCalls.push(payload); return { select: () => Promise.resolve({ data: [{ id: "x" }], error: null }) }; },
        }),
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, `--plan=${planPath}`];
    /** @type {any} */
    let result = /** @type {any} */ (undefined);
    try {
      result = await main();
    } finally {
      process.argv = originalArgv;
      try { rmSync(planPath); } catch { /* noop */ }
    }

    expect(result.toApply).toBe(3);
    expect(result.mismatches).toBe(1);
    expect(updateCalls).toHaveLength(0); // dry-run 이라 쓰기 0
    expect(result.summary.mark_kosis.pass).toBe(1);
    expect(result.summary.mark_kosis.failByReason.unsold).toBe(1);
    expect(result.summary.replace_kosis.pass).toBe(1);
    expect(result.summary.clear_listing_hold.pass).toBe(1);
  });

  it("--apply — set 페이로드가 그대로 나간다 (op 3종)", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { writeFileSync: wf, rmSync } = await import("node:fs");
    const planPath = path.join(os.tmpdir(), `s568_plan_apply_${Date.now()}.json`);
    wf(planPath, JSON.stringify({
      plan: [
        { id: "a", name: "A", op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } },
        { id: "b", name: "B", op: "replace_kosis", expect: { unsold: 8, unsold_rate: 24.2, unsold_source: null }, set: { unsold: 1, unsold_rate: 3, unsold_source: "kosis" } },
        { id: "c", name: "C", op: "clear_listing_hold", expect: { unsold: 105, unsold_source: null }, set: { unsold: null, unsold_rate: null, unsold_source: null } },
      ],
    }), "utf8");

    selectAllMock.mockResolvedValueOnce([
      { id: "a", unsold: 1, unsold_rate: 2, unsold_source: null },
      { id: "b", unsold: 8, unsold_rate: 24.2, unsold_source: null },
      { id: "c", unsold: 105, unsold_rate: 30, unsold_source: null },
    ]);

    // L3 — 체이닝 가능한 builder mock. update().eq("id",id).eq/is(expect 키들)...select() 를
    // 흉내낸다. eq/is 로 걸린 조건(expect)을 whereById 에 누적해 apply 페이로드와 함께 검증한다.
    /** @type {Record<string, any>} */
    const updateCallsById = {};
    /** @type {Record<string, Record<string, any>>} */
    const whereById = {};
    getSupabase.mockReturnValue({
      from: () => ({
        update: (/** @type {any} */ payload) => {
          /** @type {string | null} */
          let currentId = null;
          const builder = {
            eq: (/** @type {string} */ col, /** @type {any} */ val) => {
              if (col === "id") { currentId = val; updateCallsById[val] = payload; whereById[val] = {}; }
              else if (currentId) whereById[currentId][col] = val;
              return builder;
            },
            is: (/** @type {string} */ col, /** @type {any} */ val) => {
              if (currentId) whereById[currentId][col] = val;
              return builder;
            },
            select: () => Promise.resolve({ data: currentId ? [{ id: currentId }] : [], error: null }),
          };
          return builder;
        },
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, `--plan=${planPath}`, "--apply"];
    /** @type {any} */
    let result = /** @type {any} */ (undefined);
    try {
      result = await main();
    } finally {
      process.argv = originalArgv;
      try { rmSync(planPath); } catch { /* noop */ }
    }

    expect(updateCallsById.a).toEqual({ unsold_source: "kosis" });
    expect(updateCallsById.b).toEqual({ unsold: 1, unsold_rate: 3, unsold_source: "kosis" });
    expect(updateCallsById.c).toEqual({ unsold: null, unsold_rate: null, unsold_source: null });
    // L3 — expect 의 각 키가 WHERE 절(eq/is)에 실제로 실렸는지 확인.
    expect(whereById.a).toEqual({ unsold: 1, unsold_rate: 2, unsold_source: null });
    expect(whereById.c).toEqual({ unsold: 105, unsold_source: null }); // clear_listing_hold 는 unsold_rate 없음
    expect(result.applied).toBe(3);
    expect(result.fail).toBe(0);
  });

  it("성공 수는 돌아온 행 기준 — update 가 error 없이도 빈 배열을 돌려주면 경합에서 진 것으로 센다(L3)", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { writeFileSync: wf, rmSync } = await import("node:fs");
    const planPath = path.join(os.tmpdir(), `s568_plan_emptyreturn_${Date.now()}.json`);
    wf(planPath, JSON.stringify({
      plan: [{ id: "a", name: "A", op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } }],
    }), "utf8");

    selectAllMock.mockResolvedValueOnce([{ id: "a", unsold: 1, unsold_rate: 2, unsold_source: null }]);

    getSupabase.mockReturnValue({
      from: () => ({
        update: () => {
          const builder = {
            eq: () => builder,
            is: () => builder,
            select: () => Promise.resolve({ data: [], error: null }), // 돌아온 행 0건
          };
          return builder;
        },
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, `--plan=${planPath}`, "--apply"];
    /** @type {any} */
    let result = /** @type {any} */ (undefined);
    try {
      result = await main();
    } finally {
      process.argv = originalArgv;
      try { rmSync(planPath); } catch { /* noop */ }
    }

    // L3 — 돌아온 행 0 은 이제 "실패"가 아니라 "경합에서 짐"(WHERE 절의 expect 가 더는
    // DB 와 안 맞는다)으로 분류된다. error 가 없으므로 fail 은 0, raceLost 가 1.
    expect(result.applied).toBe(0);
    expect(result.fail).toBe(0);
    expect(result.raceLost).toBe(1);
  });

  it("L3 — WHERE 절(expect)이 실제 DB 와 다르면 그 행만 매칭 실패(0건)로 빠진다(가짜 저장소)", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { writeFileSync: wf, rmSync } = await import("node:fs");
    const planPath = path.join(os.tmpdir(), `s568_plan_l3_${Date.now()}.json`);
    wf(planPath, JSON.stringify({
      plan: [
        { id: "a", name: "A", op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } },
        { id: "b", name: "B(경합에서 짐)", op: "mark_kosis", expect: { unsold: 1, unsold_rate: 2, unsold_source: null }, set: { unsold_source: "kosis" } },
      ],
    }), "utf8");

    // dry-run 시점엔 둘 다 unsold=1 이었지만, 적용 시점엔 b 가 이미 다른 값으로 바뀌었다고 가정.
    selectAllMock.mockResolvedValueOnce([
      { id: "a", unsold: 1, unsold_rate: 2, unsold_source: null },
      { id: "b", unsold: 1, unsold_rate: 2, unsold_source: null },
    ]);

    /** 가짜 저장소 — b 는 이미 unsold=99 로 바뀐 상태(경합) */
    const liveDb = { a: { unsold: 1, unsold_rate: 2, unsold_source: null }, b: { unsold: 99, unsold_rate: 2, unsold_source: null } };
    getSupabase.mockReturnValue({
      from: () => ({
        update: (/** @type {any} */ payload) => {
          /** @type {string | null} */
          let currentId = null;
          /** @type {Record<string, any>} */
          let where = {};
          const builder = {
            eq: (/** @type {string} */ col, /** @type {any} */ val) => {
              if (col === "id") currentId = val; else where[col] = val;
              return builder;
            },
            is: (/** @type {string} */ col, /** @type {any} */ val) => { where[col] = val; return builder; },
            select: () => {
              if (!currentId) return Promise.resolve({ data: [], error: null });
              const row = /** @type {any} */ (liveDb)[currentId];
              const matches = row && Object.entries(where).every(([k, v]) => row[k] === v);
              if (matches) Object.assign(row, payload);
              return Promise.resolve({ data: matches ? [{ id: currentId }] : [], error: null });
            },
          };
          return builder;
        },
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, `--plan=${planPath}`, "--apply"];
    /** @type {any} */
    let result = /** @type {any} */ (undefined);
    try {
      result = await main();
    } finally {
      process.argv = originalArgv;
      try { rmSync(planPath); } catch { /* noop */ }
    }

    expect(result.applied).toBe(1); // a 만 성공
    expect(result.raceLost).toBe(1); // b 는 경합에서 짐
    expect(liveDb.a.unsold_source).toBe("kosis"); // a 는 실제로 반영됨
    expect(liveDb.b.unsold_source).toBeNull(); // b 는 반영 안 됨(경합 창이 닫혔다)
  });
});

// ── 세션569 C6 — unsold_as_of(청약홈 값의 공고일) expect·set ──
describe("unsold_as_of 계획 행 (세션569 C6)", () => {
  it("expect.unsold_as_of=null 이면 DB 가 null 일 때만 통과 — seed 가 이미 채운 공고일을 덮지 않는다", () => {
    const row = planRow({ op: "set_asof", expect: { unsold: 3, unsold_source: "applyhome", unsold_as_of: null }, set: { unsold_as_of: "2026-04-03" } });
    expect(checkPlanRow(row, /** @type {any} */ (dbRow({ unsold: 3, unsold_source: "applyhome", unsold_as_of: null }))).ok).toBe(true);
    const r = checkPlanRow(row, /** @type {any} */ (dbRow({ unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-05-01" })));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unsold_as_of");
  });

  it("DB 조회 칸에 unsold_as_of 가 들어 있다 — 빠지면 expect 비교가 늘 undefined 라 전부 불일치", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./backfill-unsold-source.mjs", import.meta.url)), "utf8");
    expect(src).toContain('s.from("apartments").select("id, unsold, unsold_rate, unsold_source, unsold_as_of")');
  });
});
