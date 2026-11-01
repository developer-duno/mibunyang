// @ts-check
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main, parseArgs, PHASE } from "./collect-unsold-govlist.mjs";

const FX = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/govlist");

// ── 작은 메모리 DB(Supabase 사슬 흉내 — 이 수집기가 부르는 메서드만) ──
/** @param {Record<string, any[] | undefined>} tables */
function fakeDb(tables) {
  /** @type {any[]} */ const writes = [];
  let seq = 1000;
  const from = (/** @type {string} */ t) => {
    /** @type {any} */ const q = { t, op: "select", f: [], ord: null, lim: null, head: false, count: false, set: null, rows: null, ret: false };
    const add = (/** @type {(r: any) => boolean} */ fn) => { q.f.push(fn); return api; };
    /** @type {any} */ const api = {
      select: (/** @type {string} */ _c, /** @type {any} */ o) => { if (q.op === "select") { q.head = !!o?.head; q.count = o?.count === "exact"; } else q.ret = true; return api; },
      eq: (/** @type {string} */ k, /** @type {any} */ v) => add((r) => r[k] === v),
      neq: (/** @type {string} */ k, /** @type {any} */ v) => add((r) => r[k] !== v),
      is: (/** @type {string} */ k, /** @type {any} */ v) => add((r) => (r[k] ?? null) === v),
      in: (/** @type {string} */ k, /** @type {any[]} */ v) => add((r) => v.includes(r[k])),
      gt: (/** @type {string} */ k, /** @type {any} */ v) => add((r) => r[k] > v),
      lt: (/** @type {string} */ k, /** @type {any} */ v) => add((r) => r[k] < v),
      order: (/** @type {string} */ k, /** @type {any} */ o) => { q.ord = q.ord ?? []; q.ord.push([k, o?.ascending !== false]); return api; },
      limit: (/** @type {number} */ n) => { q.lim = n; return api; },
      update: (/** @type {any} */ s) => { q.op = "update"; q.set = s; return api; },
      insert: (/** @type {any} */ rows) => { q.op = "insert"; q.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      delete: (/** @type {any} */ o) => { q.op = "delete"; q.count = o?.count === "exact"; return api; },
      then: (/** @type {any} */ ok, /** @type {any} */ bad) => Promise.resolve(run()).then(ok, bad),
    };
    const run = () => {
      const tb = tables[t];
      if (!tb) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${t}'` }, count: null };
      const hit = tb.filter((r) => q.f.every((/** @type {any} */ fn) => fn(r)));
      if (q.op === "insert") { for (const r of q.rows) tb.push({ id: seq++, ...r }); writes.push({ op: "insert", t, n: q.rows.length }); return { data: null, error: null }; }
      if (q.op === "update") { for (const r of hit) Object.assign(r, q.set); writes.push({ op: "update", t, n: hit.length, set: q.set }); return { data: q.ret ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
      if (q.op === "delete") { tables[t] = tb.filter((r) => !hit.includes(r)); writes.push({ op: "delete", t, n: hit.length }); return { data: null, error: null, count: hit.length }; }
      let out = [...hit];
      for (const [k, asc] of [...(q.ord ?? [])].reverse()) out.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
      if (q.lim != null) out = out.slice(0, q.lim);
      return { data: q.head ? null : out, error: null, count: q.count ? hit.length : null };
    };
    return api;
  };
  return { client: { from }, writes, tables };
}

// ── 대구 서식을 흉내 낸 격자(머리줄 3단 · 병합 · 단지 2개 · 소계 · 합계) ──
/** @param {number} r1 @param {number} c1 @param {number} r2 @param {number} c2 */
const M = (r1, c1, r2, c2) => ({ r1, c1, r2, c2 });
function daeguGrid() {
  const N = null;
  const cells = [
    ["□ 2026년 9월말 단지별 미분양 현황", N, N, N, N, N, N, N, N, N, N, N, N],
    ["지역", N, N, "소재지", "사업자", N, "유형", N, "분양내용", "분양결과", N, N, "분양 \n승인일"],
    ["시도", "시군구", "읍면동", N, "시공사", "시행사", "(민간\n/공공)", "(임대\n/분양)", "규모별\n(전용 ㎡)", "총분양\n가구수", "미분양가구수", N, N],
    [N, N, N, N, N, N, N, N, N, N, "전월\n('26.8월)", "당해월\n('26.9월)", N],
    [N, "달서구", "두류동", "두류동 638-19\n(두류 센트레빌 더파크)", "주식회사\n동부건설\n(02-3484-2397)", "두류야외음악당\n지역주택조합", "민간", "분양", "59A", 19, "건설사 요청으로\n비공개", N, "2025-02-11"],
    [N, N, N, N, N, N, N, N, "59B", 1, N, N, N],
    [N, N, N, N, N, N, N, N, "78", 32, N, N, N],
    [N, N, N, N, "소 계", N, N, N, N, 52, N, N, N],
    [N, N, "본리동", "본리동 1\n(테스트 헤리티지)", "㈜시온건설", "㈜시온건설", "민간", "분양", "84", 30, 25, 24, "2022-07-19"],
    [N, N, N, N, "소 계", N, N, N, N, 30, 25, 24, N],
    [N, "합     계(달서구지역)", N, N, N, N, N, N, N, 82, N, N, N],
  ];
  const merges = [M(0, 0, 0, 12), M(1, 0, 1, 2), M(1, 3, 3, 3), M(1, 4, 1, 5), M(1, 6, 1, 7), M(1, 9, 1, 11), M(1, 12, 3, 12), M(2, 8, 3, 8), M(2, 9, 3, 9), M(2, 10, 2, 11),
    M(4, 1, 9, 1), M(4, 2, 6, 2), M(4, 3, 6, 3), M(4, 4, 6, 4), M(4, 5, 6, 5), M(4, 6, 6, 6), M(4, 7, 6, 7), M(4, 10, 6, 11), M(4, 12, 6, 12), M(7, 4, 7, 8), M(9, 4, 9, 8), M(10, 1, 10, 8)];
  const total = { name: "총괄표", cells: [["□ 대구광역시 민간/분양 미분양주택 현황(총괄)"], ["시군별"], [N], ["대구"], ["중구"], ["달서구"]], merges: [] };
  return [total, { name: "업체별현황", cells, merges }];
}

const DURYU_KEY = "두류센트레빌더파크###L0#대구#달서구";
/** @param {any} o */
const A = (o) => ({ region: "대구", gu: "달서구", dong: null, address: null, road_address: null, builder: null, units: 100, unit_source: null, unsold: 30, unsold_rate: 30, unsold_source: "kosis", unsold_as_of: null, unsold_listed_as_of: null, unsold_listed_total: null, presale_type: null, naver_presale_no: null, competition_supply: null, completion: null, updated_at: "2026-11-01T00:00:00Z", ...o });
function seed(/** @type {{ listTable?: boolean }} */ o = {}) {
  const ids = ["ah-2025910146", "ah-2025910254"];
  const sup = (/** @type {string} */ id, /** @type {string} */ no, /** @type {string} */ m, /** @type {number} */ g, /** @type {number} */ s) => ({ id: `${id}-${no}-${m}`, apartment_id: id, house_manage_no: no, model_no: m, general_supply: g, special_supply: s, source: "apt" });
  return {
    apartments: [
      A({ id: ids[0], name: "두류센트레빌 더 파크(조합원 취소분)", dong: "두류3동", address: "대구 달서구 두류동 638-19", builder: "두류야외음악당지역주택조합", unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2026-11-01", complex_key: DURYU_KEY }),
      A({ id: ids[1], name: "두류센트레빌 더 파크(조합원 취소분)(2회차)", dong: "두류3동", address: "대구 달서구 두류동 638-19", builder: "두류야외음악당지역주택조합", unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2026-11-01", complex_key: DURYU_KEY }),
      A({ id: "ah-2022000777", name: "테스트 헤리티지", dong: "본리동", address: "대구 달서구 본리동 1", builder: "시온건설", complex_key: "테스트헤리티지#달서" }),
      A({ id: "ah-2023000888", name: "다른 단지", dong: "월성동", address: "대구 달서구 월성동 9", complex_key: "다른단지#달서" }),
    ],
    applyhome_unit_supply: [
      ...ids.flatMap((id) => [sup(id, "2025000017", "01", 8, 11), sup(id, "2025000017", "02", 1, 0), sup(id, "2025000017", "03", 14, 18)]),
      sup("ah-2022000777", "2022000777", "01", 20, 10),
    ],
    presale_schedule_official: [
      ...ids.map((id) => ({ id: `s-${id}`, apartment_id: id, house_manage_no: "2025000017", recruit_date: "2025-02-13" })),
      { id: "s-777", apartment_id: "ah-2022000777", house_manage_no: "2022000777", recruit_date: "2022-07-20" },
      { id: "s-888", apartment_id: "ah-2023000888", house_manage_no: "2023000888", recruit_date: "2023-05-01" },
    ],
    collector_runs: [],
    ...(o.listTable ? { unsold_gov_list: [] } : {}),
  };
}
/** 대구 목록 → 글 → 첨부(zip 머리 4바이트) — 3회. */
function fakeFetch() {
  let n = 0;
  return /** @type {typeof fetch} */ (/** @type {any} */ (async (/** @type {string} */ url) => {
    n++;
    if (url.includes("FileDown")) return new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
    return new Response(readFileSync(resolve(FX, n === 1 ? "daegu-list.html" : "daegu-view.html"), "utf8"));
  }));
}
const NOW = new Date("2026-11-02T02:00:00+09:00");

/** @type {string} */ let dir;
/** @type {string} */ let decisions;
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "govlist-"));
  decisions = resolve(dir, "decisions.json");
  writeFileSync(decisions, JSON.stringify({ decisions: [] }));
});
/** @param {string[]} argv @param {ReturnType<typeof fakeDb>} db */
const go = (argv, db) => main({ argv, sb: db.client, fetchImpl: fakeFetch(), now: NOW, decisionsPath: decisions, artifactsRoot: resolve(dir, "art"), loadGrids: async () => daeguGrid() });

describe("parseArgs — 허용 목록", () => {
  it("모르는 인자 · 둘 다/둘 다 아님 · dry-run 에 impact-out 없음 · apply 에 apply-from 없음 · 같은 파일 · apply 에 --file", () => {
    expect(() => parseArgs(["--dry-run", "--impact-out=a", "--force"])).toThrow(/모르는 인자/);
    expect(() => parseArgs(["--dry-run", "--apply", "--impact-out=a"])).toThrow(/정확히 하나/);
    expect(() => parseArgs(["--impact-out=a"])).toThrow(/정확히 하나/);
    expect(() => parseArgs(["--dry-run"])).toThrow(/impact-out/);
    expect(() => parseArgs(["--apply"])).toThrow(/apply-from/);
    expect(() => parseArgs(["--apply", "--apply-from=x.json", "--impact-out=x.json"])).toThrow(/같은 파일/);
    expect(() => parseArgs(["--apply", "--apply-from=x.json", "--file=daegu:a.xlsx"])).toThrow(/미리보기/);
    expect(() => parseArgs(["--dry-run", "--impact-out=a", "--source=gyeonggi"])).toThrow(/--source/);
    expect(parseArgs(["--dry-run", "--impact-out=a"]).sources).toEqual(["daegu", "chungnam"]);
  });
});

describe("main — dry-run", () => {
  it("쓰기 0 · impact 에 꺼짐·켬 두 계획 · 대조군(두류 strong · hold 라 건너뜀)", async () => {
    const db = fakeDb(seed());
    const out = resolve(dir, "impact.json");
    const r = await go(["--dry-run", `--impact-out=${out}`, "--source=daegu"], db);
    expect(db.writes).toEqual([]);
    expect(db.tables.collector_runs).toHaveLength(0);
    const impact = JSON.parse(readFileSync(out, "utf8"));
    expect(impact.externalCalls).toBe(3);
    const src = impact.sources[0];
    expect(src).toMatchObject({ source: "daegu", asOf: "2026-09-30", rows: 4, complexes: 2, hidden: 1 });
    expect(src.match.counts).toEqual({ strong: 2 });
    expect(src.controls[0].list[0]).toMatchObject({ state: "strong", bundle_key: DURYU_KEY, total: 52, hidden: true });
    expect(src.controls[0].plan_off.map((/** @type {any} */ p) => p.action)).toEqual(["skip_hold", "skip_hold"]);
    const act = (/** @type {string} */ mode) => Object.fromEntries(impact.modes[mode].plan.map((/** @type {any} */ p) => [p.id, p.action]));
    expect(act("off")).toEqual({ "ah-2025910146": "skip_hold", "ah-2025910254": "skip_hold", "ah-2022000777": "write_listed_number", "ah-2023000888": "not_listed" });
    expect(act("on")["ah-2023000888"]).toBe("write_absent_zero");
    expect(impact.modes.off.plan.find((/** @type {any} */ p) => p.id === "ah-2022000777").after).toEqual({ unsold: 24, unsold_rate: 80, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", unsold_listed_total: 30 });
    expect(r.wrote).toBe(0);
  });
  it("머리줄이 바뀌면 GOVLIST_SKIP daegu header(...) · 계획 0", async () => {
    const db = fakeDb(seed());
    const out = resolve(dir, "impact.json");
    const broken = daeguGrid();
    broken[1].cells[2][9] = "분양세대"; // 총분양 → 다른 글자
    broken[1].cells[1][9] = "결과";
    await main({ argv: ["--dry-run", `--impact-out=${out}`, "--source=daegu"], sb: db.client, fetchImpl: fakeFetch(), now: NOW, decisionsPath: decisions, artifactsRoot: dir, loadGrids: async () => broken });
    const impact = JSON.parse(readFileSync(out, "utf8"));
    expect(impact.markers[0]).toMatch(/^GOVLIST_SKIP daegu header\(/);
    expect(impact.modes.off.plan).toHaveLength(0);
  });
  it("판정 파일이 깨졌으면 누리집·DB 를 부르기 전에 던진다", async () => {
    writeFileSync(decisions, JSON.stringify({ decisions: [{ list_key: "x", status: "active" }] }));
    const db = fakeDb(seed());
    let called = 0;
    await expect(main({ argv: ["--dry-run", `--impact-out=${resolve(dir, "i.json")}`], sb: db.client, fetchImpl: /** @type {any} */ (async () => { called++; }), now: NOW, decisionsPath: decisions, loadGrids: async () => daeguGrid() })).rejects.toThrow(/list_key/);
    expect(called).toBe(0);
  });
});

describe("main — --apply --apply-from", () => {
  it("승인 계획과 새 값 하나만 달라도 쓰기 0 · failure GOVLIST_PLAN_MISMATCH", async () => {
    const pre = fakeDb(seed({ listTable: true }));
    const approvedPath = resolve(dir, "approved.json");
    await go(["--dry-run", `--impact-out=${approvedPath}`, "--source=daegu"], pre);
    const ap = JSON.parse(readFileSync(approvedPath, "utf8"));
    ap.modes.off.plan.find((/** @type {any} */ p) => p.id === "ah-2022000777").after.unsold = 23;
    writeFileSync(approvedPath, JSON.stringify(ap));
    const db = fakeDb(seed({ listTable: true }));
    const r = await go(["--apply", `--apply-from=${approvedPath}`, "--source=daegu"], db);
    expect(r.wrote).toBe(0);
    expect(db.writes.filter((w) => w.t !== "collector_runs")).toEqual([]);
    expect(db.tables.collector_runs).toHaveLength(1);
    expect(db.tables.collector_runs?.[0]).toMatchObject({ collector: PHASE, status: "failure" });
    expect(String(db.tables.collector_runs?.[0].error_message)).toMatch(/GOVLIST_PLAN_MISMATCH .*값 다름 1/);
    expect(existsSync(resolve(dir, "art", "2026-09-30"))).toBe(false); // 사본도 안 만든다
  });
  it("승인 계획과 같으면: 사본·역계획 → 명단 표(batch) → apartments 조건부 갱신 · hold 그대로", async () => {
    const pre = fakeDb(seed({ listTable: true }));
    const approvedPath = resolve(dir, "approved.json");
    await go(["--dry-run", `--impact-out=${approvedPath}`, "--source=daegu"], pre);
    const db = fakeDb(seed({ listTable: true }));
    const r = await go(["--apply", `--apply-from=${approvedPath}`, "--source=daegu"], db);
    expect(r.wrote).toBe(1);
    const bk = readdirSync(resolve(dir, "art", "2026-09-30")).sort();
    expect(bk).toHaveLength(2);
    expect(bk[0]).toMatch(/^before-daegu-\d{8}-\d{6}\.json$/);
    expect(bk[1]).toMatch(/^restore-daegu-\d{8}-\d{6}\.json$/);
    const restore = JSON.parse(readFileSync(resolve(dir, "art", "2026-09-30", bk[1]), "utf8"));
    expect(restore.plan).toEqual([{ id: "ah-2022000777", name: "테스트 헤리티지", op: "restore_govlist",
      expect: { unsold: 24, unsold_rate: 80, unsold_source: "govlist", unsold_as_of: "2026-09-30" },
      set: { unsold: 30, unsold_rate: 30, unsold_source: "kosis", unsold_as_of: null, unsold_listed_as_of: null, unsold_listed_total: null } }]);
    expect(db.tables.unsold_gov_list).toHaveLength(4);
    expect(new Set(db.tables.unsold_gov_list?.map((x) => x.batch_rows))).toEqual(new Set([4]));
    const apts = /** @type {any[]} */ (db.tables.apartments);
    expect(apts.find((a) => a.id === "ah-2022000777")).toMatchObject({ unsold: 24, unsold_source: "govlist", unsold_listed_total: 30 });
    expect(apts.find((a) => a.id === "ah-2025910146")).toMatchObject({ unsold: null, unsold_source: "hold" });
    expect(apts.find((a) => a.id === "ah-2023000888")).toMatchObject({ unsold: 30, unsold_source: "kosis" }); // 꺼짐 모드라 미등재→0 안 씀
    expect(db.tables.collector_runs?.[0]).toMatchObject({ status: "success" });
  });
  it("명단 표가 없으면(PR-1 전) apartments 를 쓰지 않는다", async () => {
    const pre = fakeDb(seed());
    const approvedPath = resolve(dir, "approved.json");
    await go(["--dry-run", `--impact-out=${approvedPath}`, "--source=daegu"], pre);
    const db = fakeDb(seed());
    await go(["--apply", `--apply-from=${approvedPath}`, "--source=daegu"], db);
    expect(db.writes.filter((w) => w.t === "apartments")).toEqual([]);
    expect(String(db.tables.collector_runs?.[0].error_message)).toMatch(/GOVLIST_WRITE daegu list_table/);
  });
});
