// @ts-check
/**
 * sgis-map-emd.mjs 시험 — 네트워크 0(fetchImpl 주입) · DB 0(최소 가짜 Supabase).
 *
 * 대상: planRow 4갈래 · parseArgs 허용 목록 · runMapping(대조군 중단 · 연속 실패 20회 중단 ·
 *   빈칸만 채움 · dry-run 쓰기 0 · impact 모양).
 * 세션614 · 설계서 `.omc/artifacts/session614/plan-sgis-map-emd.md` §4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 로그 소음만 끈다 — selectAll·budgetExceeded 는 실제 함수를 태운다.
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn(), log: vi.fn(), logError: vi.fn() };
});

const {
  planRow, parseArgs, runMapping, runOutcome, runAndRecord, countSameCoordGroups, sggMatches,
  CONTROL, MAX_CONSECUTIVE_FAIL, DEFAULT_BUDGET_MIN, FIRST_RUN_PENDING,
} = await import("./sgis-map-emd.mjs");
const { resetTokenCache } = await import("./_sgis-api.mjs");

// ── 가짜 응답 ─────────────────────────────────────────────────
/** @param {number} status @param {any} body */
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
/** @param {string} sido @param {string} sgg @param {string} emd @param {string} nm @param {string} [sggNm] */
const rg = (sido, sgg, emd, nm, sggNm) => res(200, {
  errCd: 0, errMsg: "Success",
  result: [{ sido_cd: sido, sgg_cd: sgg, emdong_cd: emd, emdong_nm: nm, full_addr: `주소 ${nm}`, ...(sggNm ? { sgg_nm: sggNm } : {}) }],
});
const NONE = () => res(200, { errCd: -100, errMsg: "검색결과가 존재하지 않습니다." });
const YEOKSAM = () => rg("11", "230", "640", "역삼1동");

/**
 * 좌표("lat,lng")별 역지오 응답을 주는 가짜 fetch. 대조군 좌표는 기본 역삼1동.
 * @param {Record<string, () => any>} byCoord
 * @param {{ onCoord?: (key: string) => void }} [hooks]
 */
function fakeFetch(byCoord, hooks = {}) {
  /** @type {string[]} */
  const rgeoKeys = [];
  /** @param {any} u */
  const fn = async (u) => {
    const url = new URL(String(u));
    if (url.pathname.endsWith("/auth/authentication.json")) {
      return res(200, { errCd: 0, result: { accessToken: "tok-0000", accessTimeout: Date.now() + 3_600_000 } });
    }
    const key = `${url.searchParams.get("y_coor")},${url.searchParams.get("x_coor")}`;
    rgeoKeys.push(key);
    hooks.onCoord?.(key);
    const h = byCoord[key] ?? (key === `${CONTROL.lat},${CONTROL.lng}` ? YEOKSAM : null);
    return h ? h() : res(500, {});
  };
  return { fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (fn)), rgeoKeys };
}

// ── 최소 가짜 Supabase(이 수집기가 쓰는 조합만) ─────────────────
/** 지난 성공 회차 1행 — 평소(인자 없는) 실행이 첫 회차 관문을 통과하게 한다. */
const PRIOR_OK = { collector: "sgis-map-emd", status: "success", ok_count: 2610 };

/**
 * @param {Array<Record<string, any>>} rows apartments
 * @param {Array<Record<string, any>>} [runs] collector_runs (기본 = 지난 성공 1행)
 * @param {{ runsError?: string }} [opts]
 */
function makeDb(rows, runs = [PRIOR_OK], opts = {}) {
  const table = rows.map((r) => ({ ...r }));
  /** @type {Record<string, Array<Record<string, any>>>} */
  const tables = { apartments: table, collector_runs: runs.map((r) => ({ ...r })) };
  /** @type {Array<{ op: string, payload: any, filters: string[] }>} */
  const calls = [];
  /** @type {string[]} */
  const reads = [];
  /** @param {string} name */
  function from(name) {
    const rowsOf = tables[name];
    if (!rowsOf) throw new Error(`가짜 DB: 모르는 표 ${name}`);
    /** @type {{ op: string, payload: any, filters: Array<(r: any) => boolean>, names: string[], order: string | null, limit: number | null }} */
    const st = { op: "select", payload: null, filters: [], names: [], order: null, limit: null };
    /** @type {any} */
    const b = {
      select() { return b; },
      update(/** @type {any} */ p) { st.op = "update"; st.payload = p; return b; },
      not(/** @type {string} */ c, /** @type {string} */ op, /** @type {any} */ v) {
        if (op !== "is" || v !== null) throw new Error(`가짜 DB: not(${c}, ${op}) 미지원`);
        st.filters.push((r) => r[c] != null); st.names.push(`not:${c}`); return b;
      },
      is(/** @type {string} */ c, /** @type {any} */ v) { st.filters.push((r) => (r[c] ?? null) === v); st.names.push(`is:${c}`); return b; },
      eq(/** @type {string} */ c, /** @type {any} */ v) { st.filters.push((r) => r[c] === v); st.names.push(`eq:${c}`); return b; },
      gt(/** @type {string} */ c, /** @type {any} */ v) { st.filters.push((r) => r[c] > v); st.names.push(`gt:${c}`); return b; },
      order(/** @type {string} */ c) { st.order = c; return b; },
      limit(/** @type {number} */ n) { st.limit = n; return b; },
      then(/** @type {any} */ ok, /** @type {any} */ bad) { return run().then(ok, bad); },
    };
    async function run() {
      if (st.op === "select") reads.push(name);
      if (name === "collector_runs" && opts.runsError) return { data: null, error: { message: opts.runsError } };
      let hit = rowsOf.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "update") {
        calls.push({ op: "update", payload: st.payload, filters: st.names });
        for (const r of hit) Object.assign(r, st.payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (st.order) { const c = st.order; hit = [...hit].sort((a, z) => (a[c] < z[c] ? -1 : a[c] > z[c] ? 1 : 0)); }
      if (st.limit != null) hit = hit.slice(0, st.limit);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return b;
  }
  return { sb: { from }, table, calls, reads };
}

/** @param {string} id @param {string} region @param {number} lat @param {number} lng @param {Record<string, any>} [extra] */
const apt = (id, region, lat, lng, extra = {}) => ({ id, name: `단지${id}`, region, gu: "구", lat, lng, sgis_emd_cd: null, ...extra });

const noSleep = async () => {};
/** @type {Record<string, string | undefined>} */
const saved = {};
beforeEach(() => {
  saved.k = process.env.SGIS_CONSUMER_KEY; saved.s = process.env.SGIS_CONSUMER_SECRET;
  process.env.SGIS_CONSUMER_KEY = "k"; process.env.SGIS_CONSUMER_SECRET = "s";
  resetTokenCache();
});
afterEach(() => {
  if (saved.k === undefined) delete process.env.SGIS_CONSUMER_KEY; else process.env.SGIS_CONSUMER_KEY = saved.k;
  if (saved.s === undefined) delete process.env.SGIS_CONSUMER_SECRET; else process.env.SGIS_CONSUMER_SECRET = saved.s;
  resetTokenCache();
});

// ── planRow ───────────────────────────────────────────────────
describe("planRow — 판정 4갈래(ok · 시도 불일치 · none · fail 은 runMapping)", () => {
  /** @param {string} sidoCd @param {string} admCd */
  const ok = (sidoCd, admCd) => /** @type {const} */ ({ kind: "ok", admCd, sidoCd, sggCd: "230", emdongCd: "640", sggNm: "x", emdNm: "x", fullAddr: "x" });

  it("서울 + 응답 11 → write 11230640", () => {
    expect(planRow({ region: "서울" }, ok("11", "11230640"))).toEqual({ action: "write", admCd: "11230640" });
  });
  it("서울 + 응답 31(경기) → skip 시도 불일치 — 쓰지 않는다", () => {
    expect(planRow({ region: "서울" }, ok("31", "31014620"))).toEqual({
      action: "skip", reason: "sido-mismatch", expected: ["11"], sidoCd: "31",
    });
  });
  it("광주 + 응답 36, 전남 + 응답 24 → 둘 다 write(통합특별시 경계 미확인 — 서로 허용)", () => {
    expect(planRow({ region: "광주" }, ok("36", "36010101")).action).toBe("write");
    expect(planRow({ region: "전남" }, ok("24", "24010101")).action).toBe("write");
  });
  it("모르는 지역·빈 지역 → 시도 불일치(허용 집합 없음)", () => {
    expect(planRow({ region: "전남광주통합특별시" }, ok("36", "36010101")).action).toBe("skip");
    expect(planRow({ region: null }, ok("11", "11230640")).action).toBe("skip");
    expect(planRow({ region: "toString" }, ok("11", "11230640")).action).toBe("skip");
  });
  it("none → skip none", () => {
    expect(planRow({ region: "서울" }, { kind: "none" })).toEqual({ action: "skip", reason: "none" });
  });
});

// ── parseArgs ─────────────────────────────────────────────────
describe("parseArgs — 허용 목록", () => {
  const base = ["node", "sgis-map-emd.mjs"];
  it("인자 없음 → 쓰기 실행 · 예산 기본 60", () => {
    expect(parseArgs(base)).toEqual({ dryRun: false, impactOut: null, limit: null, budgetMin: DEFAULT_BUDGET_MIN, firstRun: false, expectOk: null });
    expect(DEFAULT_BUDGET_MIN).toBe(60);
  });
  it("네 가지 다", () => {
    const abs = process.platform === "win32" ? "C:/tmp/impact.json" : "/tmp/impact.json";
    expect(parseArgs([...base, "--dry-run", `--impact-out=${abs}`, "--limit=5", "--budget-min=0"]))
      .toEqual({ dryRun: true, impactOut: abs, limit: 5, budgetMin: 0, firstRun: false, expectOk: null });
  });
  it("첫 회차 = --first-run --expect-ok=N 함께", () => {
    expect(parseArgs([...base, "--first-run", "--expect-ok=2610"])).toMatchObject({ firstRun: true, expectOk: 2610, dryRun: false });
  });
  it("--first-run 혼자 · --expect-ok 혼자 → throw(함께만)", () => {
    expect(() => parseArgs([...base, "--first-run"])).toThrow(/함께만/);
    expect(() => parseArgs([...base, "--expect-ok=2610"])).toThrow(/함께만/);
  });
  it("--first-run 과 --limit 같이 → throw(첫 회차는 전수만 — 몇 행만 쓰고 관문이 열리면 나머지를 승인 없이 쓴다)", () => {
    expect(() => parseArgs([...base, "--first-run", "--expect-ok=5", "--limit=5"])).toThrow(/첫 회차는 전수만/);
    expect(parseArgs([...base, "--dry-run", "--limit=5"])).toMatchObject({ dryRun: true, limit: 5 });
  });
  it("--first-run 과 --dry-run 같이 → throw", () => {
    expect(() => parseArgs([...base, "--first-run", "--expect-ok=1", "--dry-run"])).toThrow(/같이 줄 수 없습니다/);
  });
  it("--expect-ok 꼴 틀림·두 번 → throw", () => {
    expect(() => parseArgs([...base, "--first-run", "--expect-ok=abc"])).toThrow(/--expect-ok/);
    expect(() => parseArgs([...base, "--first-run", "--expect-ok"])).toThrow(/--expect-ok/);
    expect(() => parseArgs([...base, "--first-run", "--expect-ok=1", "--expect-ok=2"])).toThrow(/두 번/);
    expect(() => parseArgs([...base, "--first-run", "--first-run", "--expect-ok=1"])).toThrow(/두 번/);
  });
  it("모르는 인자 → throw(예: --apply · --force · --dryrun)", () => {
    expect(() => parseArgs([...base, "--apply"])).toThrow(/모르는 인자/);
    expect(() => parseArgs([...base, "--force"])).toThrow(/모르는 인자/);
    expect(() => parseArgs([...base, "--dryrun"])).toThrow(/모르는 인자/);
  });
  it("--impact-out 등호 누락 → throw", () => {
    expect(() => parseArgs([...base, "--impact-out"])).toThrow(/--impact-out/);
    expect(() => parseArgs([...base, "--impact-out", "/tmp/x.json"])).toThrow(/--impact-out/);
  });
  it("--impact-out 상대경로 → throw", () => {
    expect(() => parseArgs([...base, "--impact-out=impact.json"])).toThrow(/절대경로/);
  });
  it("--limit=0 · --limit=abc · --budget-min=-1 → throw", () => {
    expect(() => parseArgs([...base, "--limit=0"])).toThrow(/--limit/);
    expect(() => parseArgs([...base, "--limit=abc"])).toThrow(/--limit/);
    expect(() => parseArgs([...base, "--budget-min=-1"])).toThrow(/--budget-min/);
  });
  it("같은 인자 두 번 → throw", () => {
    expect(() => parseArgs([...base, "--limit=1", "--limit=2"])).toThrow(/두 번/);
  });
});

// ── runMapping ────────────────────────────────────────────────
describe("runMapping — 대조군 · 판정 · 쓰기", () => {
  it("대상 0건 → API 호출 0 · total 0", async () => {
    const { sb } = makeDb([apt("a1", "서울", 37.5, 127.0, { sgis_emd_cd: "11230640" }), { id: "a2", region: "서울", lat: null, lng: null, sgis_emd_cd: null }]);
    const { fetchImpl, rgeoKeys } = fakeFetch({});
    const r = await runMapping({ sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.total).toBe(0);
    expect(rgeoKeys.length).toBe(0);
  });

  it("대조군이 다르면(경기로 옴) 즉시 중단 — 단지 호출 0 · 쓰기 0 · fail 1", async () => {
    const { sb, calls } = makeDb([apt("a1", "서울", 37.51, 127.01)]);
    const { fetchImpl, rgeoKeys } = fakeFetch({ [`${CONTROL.lat},${CONTROL.lng}`]: () => rg("31", "014", "620", "광교1동"), "37.51,127.01": YEOKSAM });
    const r = await runMapping({ sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.aborted).toMatch(/대조군과 다름/);
    expect(r.fail).toBe(1);
    expect(rgeoKeys).toEqual([`${CONTROL.lat},${CONTROL.lng}`]);
    expect(calls.length).toBe(0);
    expect(r.impact.aborted).toMatch(/대조군/);
  });

  it("대조군 호출이 던지면(HTTP 500) 즉시 중단", async () => {
    const { sb, calls } = makeDb([apt("a1", "서울", 37.51, 127.01)]);
    const { fetchImpl } = fakeFetch({ [`${CONTROL.lat},${CONTROL.lng}`]: () => res(500, {}) });
    const r = await runMapping({ sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.aborted).toMatch(/대조군과 다름/);
    expect(calls.length).toBe(0);
  });

  it("ok · 시도 불일치 · none · 실패 각 1 → 쓰기는 ok 1행만, impact 모양", async () => {
    const db = makeDb([
      apt("a1", "서울", 37.51, 127.01),
      apt("a2", "서울", 37.52, 127.02),
      apt("a3", "서울", 37.53, 127.03),
      apt("a4", "경기", 37.54, 127.04),
    ]);
    const { fetchImpl } = fakeFetch({
      "37.51,127.01": YEOKSAM,
      "37.52,127.02": () => rg("31", "014", "620", "광교1동"),
      "37.53,127.03": NONE,
      "37.54,127.04": () => res(500, {}),
    });
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: false, sleepFn: noSleep, nowIso: () => "2026-10-13T05:30:00.000Z" });
    expect({ ok: r.ok, skip: r.skip, fail: r.fail, total: r.total, aborted: r.aborted }).toEqual({ ok: 1, skip: 2, fail: 1, total: 4, aborted: null });
    expect(db.table.find((x) => x.id === "a1")).toMatchObject({ sgis_emd_cd: "11230640", sgis_mapped_at: "2026-10-13T05:30:00.000Z" });
    for (const id of ["a2", "a3", "a4"]) expect(db.table.find((x) => x.id === id)?.sgis_emd_cd).toBeNull();
    expect(db.calls.length).toBe(1);
    expect(db.calls[0].filters).toEqual(["eq:id", "is:sgis_emd_cd"]);

    const im = r.impact;
    expect(Object.keys(im).sort()).toEqual([
      "aborted", "byRegion", "byRegionSido", "bySido", "dryRun", "planned", "ranAt", "sameCoordGroups", "sample",
      "sggMismatch", "sidoMismatch", "stopped", "total",
    ]);
    expect(im.planned).toEqual({ ok: 1, skipNone: 1, skipSidoMismatch: 1, skipCoordShared: 0, fail: 1 });
    expect(im.byRegionSido).toEqual({ 서울: { 11: 1, 31: 1 } });
    expect(im.stopped).toBeNull();
    expect(im.bySido).toEqual({ 11: 1, 31: 1 });
    expect(im.byRegion).toEqual({ 서울: { ok: 1, skip: 2, fail: 0 }, 경기: { ok: 0, skip: 0, fail: 1 } });
    expect(im.sidoMismatch).toEqual([{ id: "a2", name: "단지a2", region: "서울", gu: "구", sidoCd: "31", fullAddr: "주소 광교1동" }]);
    expect(im.sample).toEqual([{ id: "a1", name: "단지a1", admCd: "11230640", emdNm: "역삼1동" }]);
  });

  it("이미 채워진 행은 안 덮는다 — 조회 뒤 다른 쪽이 채우면 쓰기 0행 · skip", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01)]);
    const { fetchImpl } = fakeFetch({ "37.51,127.01": YEOKSAM }, {
      // 역지오 호출 순간 다른 실행이 같은 행을 먼저 채운 상황
      onCoord: (key) => { if (key === "37.51,127.01") Object.assign(/** @type {any} */ (db.table[0]), { sgis_emd_cd: "11230650" }); },
    });
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(db.table[0].sgis_emd_cd).toBe("11230650");
    expect({ ok: r.ok, skip: r.skip }).toEqual({ ok: 0, skip: 1 });
  });

  it("dry-run → 쓰기 호출 0 · ok 는 예정 수", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.52, 127.02)]);
    const { fetchImpl } = fakeFetch({ "37.51,127.01": YEOKSAM, "37.52,127.02": YEOKSAM });
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: true, sleepFn: noSleep });
    expect(r.ok).toBe(2);
    expect(db.calls.length).toBe(0);
    expect(db.table.every((x) => x.sgis_emd_cd === null)).toBe(true);
    expect(r.impact.dryRun).toBe(true);
  });

  it(`연속 실패 ${MAX_CONSECUTIVE_FAIL}회 → 중단, 남은 단지는 부르지 않는다`, async () => {
    expect(MAX_CONSECUTIVE_FAIL).toBe(20);
    const rows = Array.from({ length: 25 }, (_, i) => apt(`a${String(i).padStart(2, "0")}`, "서울", 37 + i / 100, 127.5));
    const db = makeDb(rows);
    const { fetchImpl, rgeoKeys } = fakeFetch({});  // 대조군만 성공, 나머지 전부 500
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.aborted).toMatch(/연속 실패 20회/);
    expect(r.fail).toBe(20);
    expect(rgeoKeys.length).toBe(1 + 20);
    expect(db.calls.length).toBe(0);
  });

  it("실패가 사이사이 성공으로 끊기면 중단하지 않는다(연속만 센다)", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => apt(`a${String(i).padStart(2, "0")}`, "서울", 37 + i / 100, 127.5));
    /** @type {Record<string, () => any>} */
    const by = {};
    rows.forEach((x, i) => { if (i % 10 === 9) by[`${x.lat},${x.lng}`] = YEOKSAM; });
    const db = makeDb(rows);
    const { fetchImpl } = fakeFetch(by);
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: true, sleepFn: noSleep });
    expect(r.aborted).toBeNull();
    expect({ ok: r.ok, fail: r.fail }).toEqual({ ok: 3, fail: 27 });
  });

  it("--limit 만큼만 · 중단 신호면 멈춤(stopped=interrupted) · 예산 넘으면 stopped=budget", async () => {
    const rows = [apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.52, 127.02), apt("a3", "서울", 37.53, 127.03)];
    const by = { "37.51,127.01": YEOKSAM, "37.52,127.02": YEOKSAM, "37.53,127.03": YEOKSAM };

    const r1 = await runMapping({ sb: makeDb(rows).sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: true, limit: 2, sleepFn: noSleep });
    expect({ total: r1.total, ok: r1.ok }).toEqual({ total: 2, ok: 2 });

    let n = 0;
    const r2 = await runMapping({ sb: makeDb(rows).sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: true, sleepFn: noSleep, isInterrupted: () => n++ >= 1 });
    expect({ ok: r2.ok, stopped: r2.stopped }).toEqual({ ok: 1, stopped: "interrupted" });

    const r3 = await runMapping({ sb: makeDb(rows).sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: true, sleepFn: noSleep, budgetMin: 1, startedMs: 0, nowMs: () => 60_000 });
    expect({ ok: r3.ok, stopped: r3.stopped }).toEqual({ ok: 0, stopped: "budget" });
  });

  it("호출 사이 0.2초 간격(대조군 포함 매 호출 뒤)", async () => {
    /** @type {number[]} */
    const slept = [];
    const { fetchImpl } = fakeFetch({ "37.51,127.01": YEOKSAM, "37.52,127.02": NONE });
    await runMapping({ sb: makeDb([apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.52, 127.02)]).sb, fetchImpl, dryRun: true, sleepFn: async (ms) => { slept.push(ms); } });
    expect(slept).toEqual([200, 200, 200]);
  });
});

// ── 첫 회차 관문(설계서 §3 #3-가 · 세션614 메인 판정) ────────────────
describe("첫 회차 관문 — 러너 자동 실행이 마이그·전이표 승인보다 앞서도 쓰지 않는다", () => {
  const rows = () => [apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.52, 127.02)];
  const by = { "37.51,127.01": YEOKSAM, "37.52,127.02": YEOKSAM };

  it("인자 없음 + 쓴 행(ok_count>0, status 무관) 0 → 아무것도 안 씀 · SGIS 호출 0(대조군 포함) · 대상 조회 뒤 관문 · pending", async () => {
    const db = makeDb(rows(), []);
    const { fetchImpl, rgeoKeys } = fakeFetch(by);
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.pending).toBe(true);
    expect(rgeoKeys.length).toBe(0);
    expect(db.calls.length).toBe(0);
    expect(db.reads).toEqual(["apartments", "collector_runs"]);
    expect(runOutcome(r)).toEqual({ record: { ok: 0, fail: 0, skip: 1, status: "success", errorMessage: FIRST_RUN_PENDING }, exitCode: 0 });
    expect(FIRST_RUN_PENDING).toBe("FIRST_RUN_PENDING");
  });

  it("쓴 행이 0 인 기록(관문 대기 success·ok 0·skip 1 · 실패 ok 0)·다른 수집기 행만 있으면 여전히 pending", async () => {
    const db = makeDb(rows(), [
      { collector: "sgis-map-emd", status: "success", ok_count: 0, skip_count: 1 },
      { collector: "sgis-map-emd", status: "failure", ok_count: 0, fail_count: 1 },
      { collector: "reverse-geocode", status: "success", ok_count: 9 },
    ]);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.pending).toBe(true);
    expect(db.calls.length).toBe(0);
  });

  it("인자 없음 + 쓴 행(ok_count>0, status 무관) 있음 → 평소대로 새 단지만 쓴다", async () => {
    const db = makeDb(rows(), [PRIOR_OK]);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, sleepFn: noSleep });
    expect({ pending: r.pending, ok: r.ok }).toEqual({ pending: false, ok: 2 });
    expect(db.table.every((x) => x.sgis_emd_cd === "11230640")).toBe(true);
    expect(runOutcome(r)).toMatchObject({ record: { ok: 2, status: "success" }, exitCode: 0 });
  });

  it("대상 0건이면 관문까지 가지 않는다 — 쓴 행(ok_count>0, status 무관) 0 이어도 '대상 0건' skip 1 기록(FIRST_RUN_PENDING 아님)", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01, { sgis_emd_cd: "11230640" })], []);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, sleepFn: noSleep });
    expect({ pending: r.pending, total: r.total }).toEqual({ pending: false, total: 0 });
    expect(db.reads).toEqual(["apartments"]);
    expect(runOutcome(r)).toEqual({ record: { ok: 0, fail: 0, skip: 1, status: "success" }, exitCode: 0 });
  });

  it("관문 조회가 실패하면 → 쓰기 0 · fail 기록 · exit 1", async () => {
    const db = makeDb(rows(), [], { runsError: "permission denied" });
    const { fetchImpl, rgeoKeys } = fakeFetch(by);
    const r = await runMapping({ sb: db.sb, fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.aborted).toMatch(/관문 조회 실패 — permission denied/);
    expect(rgeoKeys.length).toBe(0);
    expect(db.calls.length).toBe(0);
    expect(runOutcome(r)).toMatchObject({ record: { status: "failure", fail: 1 }, exitCode: 1 });
  });

  it("미리보기(--dry-run)는 관문을 보지 않는다 — 첫 회차 전이표를 만들 수 있어야 한다", async () => {
    const db = makeDb(rows(), []);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: true, sleepFn: noSleep });
    expect({ pending: r.pending, ok: r.ok }).toEqual({ pending: false, ok: 2 });
    expect(db.reads).not.toContain("collector_runs");
    expect(db.calls.length).toBe(0);
  });

  it("--first-run 승인 2 · 계획 2 → 관문 조회 없이 쓴다(쓴 행(ok_count>0, status 무관) 0 이어도)", async () => {
    const db = makeDb(rows(), []);
    const ff = fakeFetch(by);
    const r = await runMapping({ sb: db.sb, fetchImpl: ff.fetchImpl, dryRun: false, firstRun: true, expectOk: 2, sleepFn: noSleep });
    expect({ ok: r.ok, aborted: r.aborted, pending: r.pending }).toEqual({ ok: 2, aborted: null, pending: false });
    expect(ff.rgeoKeys.length).toBe(1 + 2);  // 대조군 1 + 단지 2 — 쓰기 단계에서 재호출 없음
    expect(db.reads).not.toContain("collector_runs");
    expect(db.table.every((x) => x.sgis_emd_cd === "11230640")).toBe(true);
    expect(runOutcome(r)).toMatchObject({ record: { ok: 2, status: "success" }, exitCode: 0 });
  });

  it("--first-run 승인 3 · 계획 2 → 한 행도 안 씀 · fail 기록 · exit 1 (예: 승인 2,610 · 계획 2,598)", async () => {
    const db = makeDb(rows(), []);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, firstRun: true, expectOk: 3, sleepFn: noSleep });
    expect(r.aborted).toMatch(/승인 3 ≠ 계획 2/);
    expect(db.calls.length).toBe(0);
    expect(db.table.every((x) => x.sgis_emd_cd === null)).toBe(true);
    expect(runOutcome(r)).toMatchObject({ record: { status: "failure" }, exitCode: 1 });
    expect(runOutcome(r).record.fail).toBeGreaterThan(0);
  });

  it("--first-run 계획 도중 멈추면(중단 신호) 숫자가 맞아도 안 쓴다", async () => {
    const db = makeDb(rows(), []);
    let n = 0;
    const r = await runMapping({
      sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, firstRun: true, expectOk: 1, sleepFn: noSleep,
      isInterrupted: () => n++ >= 1,
    });
    expect(r.aborted).toMatch(/계획이 끝나지 않음/);
    expect(db.calls.length).toBe(0);
  });

  it("runOutcome — 대상 0건 skip 1 · 멈춤 partial · 대조군 실패 failure", () => {
    const base = /** @type {any} */ ({ ok: 0, fail: 0, skip: 0, total: 0, stopped: null, aborted: null, pending: false, impact: {} });
    expect(runOutcome(base)).toEqual({ record: { ok: 0, fail: 0, skip: 1, status: "success" }, exitCode: 0 });
    expect(runOutcome({ ...base, total: 5, ok: 3, stopped: "budget" })).toMatchObject({ record: { status: "partial" }, exitCode: 0 });
    expect(runOutcome({ ...base, total: 5, fail: 1, aborted: "SGIS 응답이 대조군과 다름" })).toMatchObject({ record: { status: "failure", errorMessage: "SGIS 응답이 대조군과 다름" }, exitCode: 1 });
  });
});

// ── 보완 지시서 1(세션614 검사관 지적 W1~W9) ─────────────────────────
const { formatSgisSidoMismatch, parseSgisSidoMismatch, SGIS_SIDO_MISMATCH_MARKER } = await import("./_shared.mjs");

describe("W1 관문 — status 무관, 쓴 행(ok_count > 0)이 있으면 열린다", () => {
  const rows = () => [apt("a1", "서울", 37.51, 127.01)];
  const by = { "37.51,127.01": YEOKSAM };
  /** @param {Record<string, any>} run */
  const opened = async (run) => {
    const db = makeDb(rows(), [run]);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, sleepFn: noSleep });
    return !r.pending;
  };
  it("{failure, ok 2609, fail 1} → 열림(첫 회차 2,610 중 1행 실패)", async () => {
    expect(await opened({ collector: "sgis-map-emd", status: "failure", ok_count: 2609, fail_count: 1 })).toBe(true);
  });
  it("{partial, ok 100} → 열림(예산·중단 신호로 멈춘 첫 회차)", async () => {
    expect(await opened({ collector: "sgis-map-emd", status: "partial", ok_count: 100 })).toBe(true);
  });
  it("{success, ok 0, skip 1} → 안 열림(관문 대기·대상 0건 기록)", async () => {
    expect(await opened({ collector: "sgis-map-emd", status: "success", ok_count: 0, skip_count: 1 })).toBe(false);
  });
});

describe("W3 자리표시 좌표 건너뛰기 · 같은 좌표 묶음 · 시군구 이름 대조", () => {
  it("coord_shared 행은 SGIS 를 부르지 않고 skipCoordShared · 쓰기 0", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01, { coord_shared: true }), apt("a2", "서울", 37.52, 127.02)]);
    const ff = fakeFetch({ "37.51,127.01": YEOKSAM, "37.52,127.02": YEOKSAM });
    const r = await runMapping({ sb: db.sb, fetchImpl: ff.fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(ff.rgeoKeys).not.toContain("37.51,127.01");
    expect(r.impact.planned.skipCoordShared).toBe(1);
    expect({ ok: r.ok, skip: r.skip }).toEqual({ ok: 1, skip: 1 });
    expect(db.table.find((x) => x.id === "a1")?.sgis_emd_cd).toBeNull();
  });
  it("coord_shared === false 인 행은 건너뛰지 않고 호출·쓰기까지 간다", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01, { coord_shared: false })]);
    const ff = fakeFetch({ "37.51,127.01": YEOKSAM });
    const r = await runMapping({ sb: db.sb, fetchImpl: ff.fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(ff.rgeoKeys).toContain("37.51,127.01");
    expect({ ok: r.ok, skipCoordShared: r.impact.planned.skipCoordShared }).toEqual({ ok: 1, skipCoordShared: 0 });
    expect(db.table[0].sgis_emd_cd).toBe("11230640");
  });
  it("sameCoordGroups — 소수 5자리가 같은 묶음 수와 그 행 수", () => {
    expect(countSameCoordGroups([
      { lat: 37.512341, lng: 127.012341 }, { lat: 37.512344, lng: 127.012339 }, // 소수 5자리 같음
      { lat: 37.6, lng: 127.1 }, { lat: 37.6, lng: 127.1 }, { lat: 37.6, lng: 127.1 },
      { lat: 35.1, lng: 129.0 },
    ])).toEqual({ groups: 2, rows: 5 });
    expect(countSameCoordGroups([{ lat: 37.5, lng: 127 }, { lat: 37.50001, lng: 127 }])).toEqual({ groups: 0, rows: 0 });
  });
  it("미리보기 impact.sameCoordGroups 가 대상 기준으로 채워진다", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.51, 127.01), apt("a3", "서울", 37.53, 127.03)]);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch({ "37.51,127.01": YEOKSAM, "37.53,127.03": YEOKSAM }).fetchImpl, dryRun: true, sleepFn: noSleep });
    expect(r.impact.sameCoordGroups).toEqual({ groups: 1, rows: 2 });
  });
  it("sggMatches — 우리 gu 낱말이 전부 응답 sgg_nm 에 있어야 맞음 · 비면 판정 안 함", () => {
    expect(sggMatches("영통구", "수원시 영통구")).toBe(true);
    expect(sggMatches("수원시 영통구", "수원시 영통구")).toBe(true);
    expect(sggMatches("수원시 장안구", "수원시 영통구")).toBe(false);
    expect(sggMatches("강남구", "서초구")).toBe(false);
    expect(sggMatches(null, "서초구")).toBe(true);
    expect(sggMatches("강남구", null)).toBe(true);
  });
  it("sggMismatch 명단 — 쓰기는 막지 않고 보고만", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01, { gu: "서초구" }), apt("a2", "서울", 37.52, 127.02, { gu: "강남구" })]);
    const by = { "37.51,127.01": () => rg("11", "230", "640", "역삼1동", "강남구"), "37.52,127.02": () => rg("11", "230", "640", "역삼1동", "강남구") };
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.impact.sggMismatch).toEqual([{ id: "a1", name: "단지a1", region: "서울", gu: "서초구", sggNm: "강남구", admCd: "11230640" }]);
    expect(r.ok).toBe(2);
  });
});

describe("W4 시도 불일치를 기록에 남긴다", () => {
  it("formatSgisSidoMismatch ↔ parseSgisSidoMismatch 짝(앞에 다른 사유가 붙어도)", () => {
    expect(formatSgisSidoMismatch(3)).toBe(`${SGIS_SIDO_MISMATCH_MARKER}3`);
    expect(parseSgisSidoMismatch(`연속 실패 20회 | ${formatSgisSidoMismatch(7)}`)).toBe(7);
    expect(parseSgisSidoMismatch("SGIS_SIDO_MISMATCH=0")).toBeNull();
    expect(parseSgisSidoMismatch("SGIS_SIDO_MISMATCH=x")).toBeNull();
    expect(parseSgisSidoMismatch(null)).toBeNull();
  });
  it("평소 실행에서 불일치 1곳 → errorMessage SGIS_SIDO_MISMATCH=1 · status 는 success 그대로 · 실패 사유와 함께면 이어 붙임", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.52, 127.02)]);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch({ "37.51,127.01": YEOKSAM, "37.52,127.02": () => rg("31", "014", "620", "광교1동") }).fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(runOutcome(r)).toEqual({ record: { ok: 1, fail: 0, skip: 1, status: "success", errorMessage: "SGIS_SIDO_MISMATCH=1" }, exitCode: 0 });
    const withAbort = { ...r, aborted: "승인 3 ≠ 계획 1 — 아무것도 쓰지 않았습니다", fail: 1 };
    expect(runOutcome(withAbort).record.errorMessage).toBe("승인 3 ≠ 계획 1 — 아무것도 쓰지 않았습니다 | SGIS_SIDO_MISMATCH=1");
  });
});

describe("W5 광주·전남 교차 집계", () => {
  it("byRegionSido — 우리 지역별 응답 sido_cd 수", async () => {
    const db = makeDb([apt("a1", "광주", 35.11, 126.81), apt("a2", "광주", 35.12, 126.82), apt("a3", "전남", 34.81, 126.41)]);
    const by = { "35.11,126.81": () => rg("24", "010", "101", "가"), "35.12,126.82": () => rg("36", "010", "101", "나"), "34.81,126.41": () => rg("36", "110", "250", "다") };
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch(by).fetchImpl, dryRun: true, sleepFn: noSleep });
    expect(r.impact.byRegionSido).toEqual({ 광주: { 24: 1, 36: 1 }, 전남: { 36: 1 } });
    expect(r.impact.bySido).toEqual({ 24: 1, 36: 2 });
  });
});

describe("W6 매핑 본체가 던져도 failure 1행을 남긴다", () => {
  it("가짜 DB 가 던짐(칸 없음 42703) → 기록 1행 · failure · fail 1 · exit 1", async () => {
    const sb = { from: () => { throw new Error("column apartments.sgis_emd_cd does not exist"); } };
    /** @type {any[]} */
    const recorded = [];
    const args = parseArgs(["node", "sgis-map-emd.mjs"]);
    const out = await runAndRecord({ sb, args, record: async (/** @type {string} */ phase, /** @type {any} */ rec) => { recorded.push({ phase, ...rec }); } });
    expect(out.exitCode).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ phase: "sgis-map-emd", ok: 0, fail: 1, skip: 0, status: "failure" });
    expect(recorded[0].errorMessage).toMatch(/매핑 실행 예외 — .*sgis_emd_cd does not exist/);
  });
  it("정상 실행도 같은 길로 기록 1행(관문 대기 → FIRST_RUN_PENDING · exit 0)", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01)], []);
    /** @type {any[]} */
    const recorded = [];
    const out = await runAndRecord({
      sb: db.sb, args: parseArgs(["node", "sgis-map-emd.mjs"]), fetchImpl: fakeFetch({}).fetchImpl,
      record: async (/** @type {string} */ _p, /** @type {any} */ rec) => { recorded.push(rec); },
    });
    expect(out.exitCode).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ ok: 0, fail: 0, skip: 1, status: "success", errorMessage: FIRST_RUN_PENDING });
  });
});

describe("W9 시험 사각 2곳", () => {
  it("(a) 계획 ok 2 > 승인 1 → 쓰기 0 · failure · exit 1", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01), apt("a2", "서울", 37.52, 127.02)], []);
    const r = await runMapping({ sb: db.sb, fetchImpl: fakeFetch({ "37.51,127.01": YEOKSAM, "37.52,127.02": YEOKSAM }).fetchImpl, dryRun: false, firstRun: true, expectOk: 1, sleepFn: noSleep });
    expect(r.aborted).toMatch(/승인 1 ≠ 계획 2/);
    expect(db.calls.length).toBe(0);
    expect(runOutcome(r)).toMatchObject({ record: { status: "failure" }, exitCode: 1 });
  });
  it("(b) 대조군이 같은 시도 안 다른 코드(11230641)여도 중단", async () => {
    const db = makeDb([apt("a1", "서울", 37.51, 127.01)]);
    const ff = fakeFetch({ [`${CONTROL.lat},${CONTROL.lng}`]: () => rg("11", "230", "641", "역삼2동"), "37.51,127.01": YEOKSAM });
    const r = await runMapping({ sb: db.sb, fetchImpl: ff.fetchImpl, dryRun: false, sleepFn: noSleep });
    expect(r.aborted).toMatch(/대조군과 다름 .* 받음 11230641/);
    expect(ff.rgeoKeys).toEqual([`${CONTROL.lat},${CONTROL.lng}`]);
    expect(db.calls.length).toBe(0);
  });
});
