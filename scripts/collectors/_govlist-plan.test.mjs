// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  planSource, listedValue, summarize, breaker, comparePlans, buildBackup, buildListRows, changeClass, cityKey, rowCheckViolations,
  GOVLIST_EXPIRY_MONTHS, GOVLIST_BREAKER_MAX_BUNDLES, GOVLIST_BREAKER_LIMITS, SAME_VALUE_CLASS, NEW_HIDDEN_CLASS, VALUE_KEYS, RESTORE_EXPECT_KEYS, GOVLIST_ROW_CHECKS,
} from "./_govlist-plan.mjs";
import { buildBundles, matchComplexes } from "./_govlist-match.mjs";

// ── SQL CHECK 식을 3값 논리(참·거짓·NULL)로 돌리는 작은 해석기 — 마이그 글자를 그대로 평가해 JS 판정과 맞댄다(G1③) ──
// 문법: OR · AND · NOT · 괄호 · <칸> IS [NOT] NULL · <칸> IS DISTINCT FROM '<글자>' · <칸> = '<글자>' · <칸> > <수> · <칸> IN ('a', …)
/** @param {string} expr @param {Record<string, any>} row @returns {boolean} CHECK 통과(결과가 참 또는 NULL) */
function sqlCheck(expr, row) {
  const toks = expr.match(/'[^']*'|\(|\)|,|>|=|[A-Za-z_][A-Za-z_0-9]*|\d+/g) ?? [];
  let i = 0;
  const peek = () => toks[i], eat = (/** @type {string} */ t) => { if (toks[i]?.toUpperCase() !== t) throw new Error(`해석기: ${t} 기대, ${toks[i]}`); i++; };
  const kw = (/** @type {string} */ t) => toks[i]?.toUpperCase() === t;
  /** @returns {boolean | null} */ const orE = () => { let a = andE(); while (kw("OR")) { i++; const b = andE(); a = a === true || b === true ? true : a === null || b === null ? null : false; } return a; };
  /** @returns {boolean | null} */ const andE = () => { let a = notE(); while (kw("AND")) { i++; const b = notE(); a = a === false || b === false ? false : a === null || b === null ? null : true; } return a; };
  /** @returns {boolean | null} */ const notE = () => { if (kw("NOT")) { i++; const a = notE(); return a === null ? null : !a; } return prim(); };
  /** @returns {boolean | null} */ const prim = () => {
    if (peek() === "(") { i++; const a = orE(); eat(")"); return a; }
    const col = toks[i++];
    const v = row[col] ?? null;
    if (kw("IS")) {
      i++;
      if (kw("NOT")) { i++; eat("NULL"); return v != null; }
      if (kw("NULL")) { i++; return v == null; }
      eat("DISTINCT"); eat("FROM"); const lit = toks[i++].slice(1, -1); return v !== lit; // IS DISTINCT FROM 는 NULL 을 안 낸다
    }
    if (peek() === "=") { i++; const lit = toks[i++].slice(1, -1); return v == null ? null : v === lit; }
    if (peek() === ">") { i++; const n = Number(toks[i++]); return v == null ? null : v > n; }
    if (kw("IN")) { i++; eat("("); const xs = []; while (peek() !== ")") { const t = toks[i++]; if (t !== ",") xs.push(t.slice(1, -1)); } eat(")"); return v == null ? null : xs.includes(v); }
    throw new Error(`해석기: 모르는 꼴 ${col} ${peek()}`);
  };
  const r = orE();
  if (i !== toks.length) throw new Error(`해석기: 남은 글자 ${toks.slice(i).join(" ")}`);
  return r !== false;
}
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261102000000_unsold_gov_list.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** @typedef {import("./_govlist-match.mjs").AptRow} AptRow */
/** @typedef {import("./_govlist-match.mjs").MatchResult} MatchResult */
/** @typedef {import("./_govlist-parse.mjs").GovComplex} GovComplex */

/** @param {Partial<AptRow> & { id: string }} o @returns {AptRow} */
const apt = (o) => ({
  name: "단지", region: "대구", gu: "달서구", dong: null, address: null, road_address: null, builder: null, units: 100, unit_source: null,
  unsold: 30, unsold_rate: 30, unsold_source: "kosis", unsold_as_of: null, unsold_listed_as_of: null, unsold_listed_total: null,
  presale_type: null, complex_key: null, competition_supply: null, completion: null, ...o,
});
/** @param {Partial<GovComplex>} o @returns {GovComplex} */
const cx = (o) => ({
  complex_no: 1, list_key: "daegu|달서구|a", sgg: "달서구", emd: null, location: null, raw_name: "a", name_candidates: ["a"], address: null,
  builder: null, developer: null, is_public: false, is_rental: false, total_units: 52, unsold_units: null, unsold_partial: false, unsold_over_total: false, hidden: true,
  approval_date: null, row_nos: [1], ...o,
});
/** @param {Partial<MatchResult>} o @returns {MatchResult} */
const res = (o) => ({ complex_no: 1, list_key: "daegu|달서구|a", state: "strong", bundle_key: "K", apartment_id: "ah-2024000001", method: "name+units", score: 1, best: null, candidates: [], reasons: [], ...o });

const AS_OF = "2026-09-30";
const NOW = new Date("2026-11-02T00:00:00+09:00");
const sched = (/** @type {string} */ id, /** @type {string} */ date) => ({ apartment_id: id, house_manage_no: id.slice(3), recruit_date: date });

/**
 * 붙은 묶음 K(행 3: kosis · hold · 유효 applyhome) + 안 붙은 묶음 Z(같은 달서구 · kosis 30 · 공고 2024).
 * @param {{ absentZero?: boolean; results?: MatchResult[]; zRow?: Partial<AptRow>; complexes?: GovComplex[]; now?: Date; listRowCount?: number; prevRowCount?: number | null; sggUniverse?: string[]; zSched?: string | null }} [o]
 */
function run(o = {}) {
  const rows = [
    apt({ id: "ah-2024000001", complex_key: "K" }),
    apt({ id: "ah-2024000002", complex_key: "K", unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2026-11-01" }),
    apt({ id: "ah-2024000003", complex_key: "K", unsold: 0, unsold_rate: 0, unsold_source: "applyhome", unsold_as_of: "2026-08-01" }),
    apt({ id: "ah-2024000009", complex_key: "Z", ...(o.zRow ?? {}) }),
  ];
  const z = o.zSched === undefined ? "2024-03-01" : o.zSched;
  const bundles = buildBundles(rows, [], z ? [sched("ah-2024000009", z)] : []);
  return planSource({
    source: "daegu", asOf: AS_OF, now: o.now ?? NOW, complexes: o.complexes ?? [cx({})], results: o.results ?? [res({})], bundles,
    sggUniverse: o.sggUniverse ?? ["중구", "달서구"], listRowCount: o.listRowCount ?? 293, prevRowCount: o.prevRowCount ?? null, absentZero: o.absentZero ?? false,
  });
}
const byId = (/** @type {ReturnType<typeof run>} */ p, /** @type {string} */ id) => /** @type {any} */ (p.find((r) => r.id === id));

describe("② 등재 + 비공개", () => {
  it("kosis 행 → unsold NULL · rate NULL · govlist · as_of · listed_as_of · listed_total 52", () => {
    const r = byId(run(), "ah-2024000001");
    expect(r.action).toBe("write_listed_hidden");
    expect(r.after).toEqual({ unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: AS_OF, unsold_listed_as_of: AS_OF, unsold_listed_total: 52 });
    expect(r.list_keys).toEqual(["daegu|달서구|a"]);
  });
  it("hold 행은 건드리지 않음(두류 2행이 지금 hold — release_hold_to_govlist 는 PR-4)", () => {
    expect(byId(run(), "ah-2024000002")).toMatchObject({ action: "skip_hold", after: null });
  });
  it("유효 청약홈 행은 덮지 않는다 · 만료된 청약홈(공고 + 6개월 지남)은 덮는다", () => {
    expect(byId(run(), "ah-2024000003").action).toBe("skip_applyhome");
    const late = byId(run({ now: new Date("2027-02-05T00:00:00+09:00") }), "ah-2024000003");
    expect(late.action).toBe("write_listed_hidden");
  });
  it("두 명단 단지가 사람 판정으로 한 묶음 → 총분양 Σ", () => {
    const p = run({ complexes: [cx({}), cx({ complex_no: 2, list_key: "daegu|달서구|b", total_units: 48 })], results: [res({ state: "decided" }), res({ complex_no: 2, list_key: "daegu|달서구|b", state: "decided" })] });
    expect(byId(p, "ah-2024000001").after.unsold_listed_total).toBe(100);
  });
  it("weak·none 결과는 붙지 않는다", () => {
    expect(byId(run({ results: [res({ state: "weak", bundle_key: null })] }), "ah-2024000001").action).toBe("not_listed");
  });
  it("값이 이미 같으면 unchanged(쓰지 않음)", () => {
    const already = { unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: AS_OF, unsold_listed_as_of: AS_OF, unsold_listed_total: 52 };
    const rows = [apt({ id: "ah-2024000001", complex_key: "K", ...already })];
    const p = planSource({ source: "daegu", asOf: AS_OF, now: NOW, complexes: [cx({})], results: [res({})], bundles: buildBundles(rows, [], []), sggUniverse: [], listRowCount: 1, prevRowCount: null, absentZero: false });
    expect(p[0].action).toBe("unchanged");
  });
});

describe("① 숫자 공개 · 분모 = 명단 총분양(Q9)", () => {
  it("면적대 전부 숫자 → unsold Σ · rate = Σ/총분양", () => {
    expect(listedValue([cx({ hidden: false, unsold_units: 25, total_units: 31 })], AS_OF)).toEqual({
      kind: "number", six: { unsold: 25, unsold_rate: 80.6, unsold_source: "govlist", unsold_as_of: AS_OF, unsold_listed_as_of: AS_OF, unsold_listed_total: 31 },
    });
    const r = byId(run({ complexes: [cx({ hidden: false, unsold_units: 2, total_units: 12 })] }), "ah-2024000001");
    expect(r).toMatchObject({ action: "write_listed_number", after: { unsold: 2, unsold_rate: 16.7 } });
  });
  it("명단 총분양 합이 0 이거나 못 읽었으면 listed_total = NULL(PR-1 CHECK > 0) · 률도 NULL", () => {
    expect(listedValue([cx({ total_units: 0 })], AS_OF).six.unsold_listed_total).toBeNull();
    expect(listedValue([cx({ hidden: false, unsold_units: 0, total_units: 0 })], AS_OF).six).toMatchObject({ unsold: 0, unsold_rate: null, unsold_listed_total: null });
    expect(byId(run({ complexes: [cx({ total_units: 0 })] }), "ah-2024000001").after.unsold_listed_total).toBeNull();
  });
  it("G7③ 비공개 표시 없이 미분양 칸이 빈칸(충남 수청2 RH-3 6월 꼴) → kind blank · 계획은 쓰지 않음(skip_unsold_blank — 「비공개」 둔갑 금지)", () => {
    expect(listedValue([cx({ hidden: false, unsold_units: null })], AS_OF).kind).toBe("blank");
    expect(byId(run({ complexes: [cx({ hidden: false, unsold_units: null })] }), "ah-2024000001")).toMatchObject({ action: "skip_unsold_blank", after: null });
  });
  it("G7② 미분양 > 총분양 단지 → 쓰지 않음(skip_list_inconsistent)", () => {
    expect(byId(run({ complexes: [cx({ hidden: false, unsold_units: 169, total_units: 81, unsold_over_total: true })] }), "ah-2024000001").action).toBe("skip_list_inconsistent");
  });
  it("G7① 총분양 NULL 단지가 섞이면 listed_total NULL(일부만 더하지 않음)", () => {
    expect(listedValue([cx({ total_units: 52 }), cx({ complex_no: 2, total_units: null })], AS_OF).six.unsold_listed_total).toBeNull();
  });
});

describe("만료 경계(Q2 6개월)", () => {
  it(`기준일 + ${GOVLIST_EXPIRY_MONTHS}개월 당일까지는 쓴다 · 다음 날부터 skip_expired_source`, () => {
    expect(byId(run({ now: new Date("2027-03-30T12:00:00+09:00") }), "ah-2024000001").action).toBe("write_listed_hidden");
    expect(byId(run({ now: new Date("2027-03-31T00:30:00+09:00") }), "ah-2024000001").action).toBe("skip_expired_source");
  });
});

describe("③ 미등재 → 0 — 기본 꺼짐 · 조건 (a)~(e) 전부", () => {
  it("꺼짐이면 not_listed(absent_zero_off)", () => {
    expect(byId(run(), "ah-2024000009")).toMatchObject({ action: "not_listed", reasons: ["absent_zero_off"] });
  });
  it("켜고 조건 전부 → write_absent_zero(0 · 0 · govlist · as_of · listed 칸 비움) — G1① 새 CHECK(수가 있으면 listed_as_of 면제)를 지킨다", () => {
    const r = byId(run({ absentZero: true }), "ah-2024000009");
    expect(r.action).toBe("write_absent_zero");
    expect(r.after).toEqual({ unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: AS_OF, unsold_listed_as_of: null, unsold_listed_total: null });
    expect(rowCheckViolations(r.after)).toEqual([]);
    // 옛 CHECK(listed_as_of 늘 필수)라면 이 값은 거부됐다 — 그 사고를 다시 막는다
    expect(sqlCheck("unsold_source IS DISTINCT FROM 'govlist' OR (unsold_as_of IS NOT NULL AND unsold_listed_as_of IS NOT NULL)", r.after)).toBe(false);
  });
  /** @type {Array<[string, Parameters<typeof run>[0], string]>} */
  const cases = [
    ["(a) 명단 행 0", { listRowCount: 0 }, "a_list_abnormal"],
    ["(a) 전 회차 대비 −50% 넘게 줄음", { listRowCount: 140, prevRowCount: 293 }, "a_list_abnormal"],
    ["(b) 공공분양", { zRow: { presale_type: "공공분양" } }, "b_not_private_sale"],
    ["(c) 분양 공고가 기준월 뒤", { zSched: "2026-10-15" }, "c_notice_not_before"],
    ["(c) 공고 날짜도 id 연도도 없음", { zSched: null, zRow: { id: "ap-123" } }, "c_notice_not_before"],
    ["(d) 그 시군구 명단 행에 weak 1건 잔존", { complexes: [cx({}), cx({ complex_no: 2, list_key: "daegu|달서구|w" })], results: [res({}), res({ complex_no: 2, list_key: "daegu|달서구|w", state: "weak", bundle_key: null })] }, "d_sgg_unresolved"],
    ["(d) 명단이 그 시군구를 안 덮음", { zRow: { gu: "군위군" }, sggUniverse: ["달서구"] }, "d_sgg_not_covered"],
    ["(e) 유효한 명단 값", { zRow: { unsold: null, unsold_source: "govlist", unsold_as_of: "2026-08-31", unsold_listed_as_of: null } }, "e_govlist_valid"],
  ];
  for (const [label, o, reason] of cases) {
    it(`조건 하나 빼기: ${label} → 쓰지 않음(${reason})`, () => {
      const p = run({ absentZero: true, ...o });
      const r = p.find((x) => x.id.endsWith("009") || x.id === "ap-123");
      expect(r?.action).toBe("not_listed");
      expect(r?.reasons).toContain(reason);
    });
  }
  it("(d) 시군구를 못 읽은 명단 단지가 하나라도 있으면 그 출처 전체 미등재→0 끔(세션687 대구 동구 사고형)", () => {
    const p = run({ absentZero: true, complexes: [cx({}), cx({ complex_no: 2, list_key: "daegu||x", sgg: null })], results: [res({}), res({ complex_no: 2, list_key: "daegu||x", state: "none", bundle_key: null })] });
    expect(byId(p, "ah-2024000009")).toMatchObject({ action: "not_listed" });
    expect(byId(p, "ah-2024000009").reasons[0]).toBe("d_list_sgg_missing");
    expect(p.filter((r) => r.action === "write_absent_zero")).toHaveLength(0);
  });
  it("(d) weak 1건 잔존 → 그 시군구의 미등재 판정 0건", () => {
    const p = run({ absentZero: true, complexes: [cx({}), cx({ complex_no: 2, list_key: "daegu|달서구|w" })], results: [res({}), res({ complex_no: 2, list_key: "daegu|달서구|w", state: "none", bundle_key: null })] });
    expect(p.filter((r) => r.action === "write_absent_zero")).toHaveLength(0);
  });
  it("(b) 임대 유형은 그보다 먼저 skip_lease(어느 쪽이든 안 씀)", () => {
    expect(byId(run({ absentZero: true, zRow: { presale_type: "공공지원민간임대리츠" } }), "ah-2024000009").action).toBe("skip_lease");
  });
  it("(e) hold · 유효 청약홈은 켬에서도 그대로", () => {
    expect(byId(run({ absentZero: true, zRow: { unsold: null, unsold_source: "hold" } }), "ah-2024000009").action).toBe("skip_hold");
    expect(byId(run({ absentZero: true, zRow: { unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-09-01" } }), "ah-2024000009").action).toBe("skip_applyhome");
  });
  it("(e) 예외: 이 수집기가 지난 회차에 쓴 「미등재 0」은 기준일만 새로(오락가락 방지)", () => {
    const r = byId(run({ absentZero: true, zRow: { unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: "2026-08-31", unsold_listed_as_of: null } }), "ah-2024000009");
    expect(r).toMatchObject({ action: "write_absent_zero", after: { unsold_as_of: AS_OF } });
  });
  it("경기 같은 다른 출처에는 켜도 안 쓴다", () => {
    const rows = [apt({ id: "ah-2024000009", complex_key: "Z", region: "경기", gu: "오산시" })];
    const p = planSource({ source: "gyeonggi", asOf: AS_OF, now: NOW, complexes: [], results: [], bundles: buildBundles(rows, [], [sched("ah-2024000009", "2024-01-01")]), sggUniverse: ["오산시"], listRowCount: 10, prevRowCount: null, absentZero: true });
    expect(p[0]).toMatchObject({ action: "not_listed", reasons: ["absent_zero_not_for_source"] });
  });
  it("지난 명단엔 있었고 이번엔 없는 행 → dropped_from_list(쓰지 않음)", () => {
    expect(byId(run({ absentZero: true, zRow: { unsold: null, unsold_source: "govlist", unsold_as_of: "2026-08-31", unsold_listed_as_of: "2026-08-31" } }), "ah-2024000009").action).toBe("dropped_from_list");
  });
});

describe("전이표 · 차단기 · 승인 대조 · 사본·역계획 · 명단 행", () => {
  it("값 변화 꼴과 바뀔 단지 수", () => {
    const p = run({ absentZero: true });
    const s = summarize(p);
    expect(s.byChange["대구"]).toEqual({ "값>0→빈칸": 1, "값>0→0": 1 });
    expect(s.changedBundles).toBe(2);
    expect(s.sourceShift).toEqual({ "kosis→govlist": 2 });
    expect(changeClass(/** @type {any} */ ({ action: "write_x", before: { unsold: null }, after: { unsold: 3 } }))).toBe("빈칸→값");
  });
  it(`차단기: 출처별 값 바뀔 단지 > 기준(대구·충남 10 임시 · 경기 ${GOVLIST_BREAKER_MAX_BUNDLES}) · 행 수 −50%`, () => {
    expect(GOVLIST_BREAKER_LIMITS).toEqual({ daegu: 10, chungnam: 10, gyeonggi: 50 }); // 임시값 — 12/08 첫 평시 회차 뒤 실측(BACKLOG A-28)
    expect(breaker({ valueChangedBySource: { daegu: 10 }, lists: [] }).tripped).toBe(false);
    expect(breaker({ valueChangedBySource: { daegu: 11 }, lists: [] })).toEqual({ tripped: true, reasons: ["daegu 값 바뀔 단지 11곳 > 10곳"] });
    expect(breaker({ valueChangedBySource: { chungnam: 11 }, lists: [] }).tripped).toBe(true);
    expect(breaker({ valueChangedBySource: { gyeonggi: 50 }, lists: [] }).tripped).toBe(false);
    expect(breaker({ valueChangedBySource: { gyeonggi: 51 }, lists: [] }).tripped).toBe(true);
    expect(breaker({ valueChangedBySource: { 모르는출처: 11 }, lists: [] }).tripped).toBe(true); // 표에 없으면 가장 작은 기준
    expect(breaker({ valueChangedBySource: {}, lists: [{ source: "daegu", rows: 146, prevRows: 293 }] }).tripped).toBe(true);
    expect(breaker({ valueChangedBySource: {}, lists: [{ source: "daegu", rows: 147, prevRows: 293 }] }).tripped).toBe(false);
    expect(breaker({ valueChangedBySource: {}, lists: [{ source: "daegu", rows: 1, prevRows: null }] }).tripped).toBe(false);
  });
  it("세션693 B1 — 차단기 재료는 값이 바뀌는 묶음만: 「값 같음·칸만 바뀜」 51곳 → 안 걸림 · 대구 값 변화 11곳 → 걸림 · 10곳 → 안 걸림 · 섞인 묶음은 셈", () => {
    const six = (/** @type {number | null} */ unsold, /** @type {string} */ asOf) => ({ unsold, unsold_rate: unsold == null ? null : 10, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: asOf, unsold_listed_total: 100 });
    const row = (/** @type {string} */ source, /** @type {string} */ bk, /** @type {number | null} */ from, /** @type {number | null} */ to) =>
      /** @type {any} */ ({ source, id: `${bk}-${from}-${to}`, name: bk, region: "대구", gu: "달서구", bundle_key: bk, action: "write_listed_number", reasons: [], before: six(from, "2026-09-30"), after: six(to, "2026-10-31"), list_keys: [] });
    const onlyFields = Array.from({ length: 51 }, (_, i) => row("daegu", `b${i}`, 5, 5));
    const s51 = summarize(onlyFields);
    expect(s51.changedBundles).toBe(51); // 전이표의 「바뀔 단지」(쓰는 묶음)는 그대로
    expect(s51.valueChangedBySource).toEqual({});
    expect(breaker({ valueChangedBySource: s51.valueChangedBySource, lists: [] }).tripped).toBe(false);
    const real = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => row("daegu", `v${i}`, 5, 6));
    expect(breaker({ valueChangedBySource: summarize([...onlyFields, ...real(11)]).valueChangedBySource, lists: [] }).tripped).toBe(true);
    expect(breaker({ valueChangedBySource: summarize([...onlyFields, ...real(10)]).valueChangedBySource, lists: [] }).tripped).toBe(false);
    // 한 묶음에 칸만 바뀜 행 + 값 바뀜 행이 섞이면 그 묶음은 센다 · 출처마다 따로
    const mixed = summarize([row("daegu", "m", 5, 5), row("daegu", "m", 5, 0), row("chungnam", "c", null, 3)]);
    expect(mixed.valueChangedBySource).toEqual({ chungnam: 1, daegu: 1 });
    // C1(2차 보완): 모름(빈칸 — kosis·null·hold) → 등재·수 비공개 = 새 꼴 「빈칸→비공개(새 등재)」로 세고, 차단기 수에 든다
    const hid = (/** @type {string | null} */ src, /** @type {string} */ asOf) => ({ unsold: null, unsold_rate: null, unsold_source: src, unsold_as_of: src === "govlist" ? asOf : null, unsold_listed_as_of: src === "govlist" ? asOf : null, unsold_listed_total: src === "govlist" ? 52 : null });
    const toHidden = (/** @type {string} */ bk, /** @type {string | null} */ from) => /** @type {any} */ ({ source: "daegu", id: bk, name: bk, region: "대구", gu: "달서구", bundle_key: bk, action: "write_listed_hidden", reasons: [], before: hid(from, "2026-09-30"), after: hid("govlist", "2026-10-31"), list_keys: [] });
    expect(changeClass(toHidden("x", "kosis"))).toBe(NEW_HIDDEN_CLASS);
    expect(changeClass(toHidden("x", null))).toBe(NEW_HIDDEN_CLASS);
    expect(changeClass(toHidden("x", "hold"))).toBe(NEW_HIDDEN_CLASS);
    expect(changeClass(toHidden("x", "govlist"))).toBe(SAME_VALUE_CLASS); // 이미 비공개 → 같은 비공개(기준월만)
    const newHidden = (/** @type {number} */ k) => Array.from({ length: k }, (_, i) => toHidden(`h${i}`, "kosis"));
    const s11 = summarize(newHidden(11));
    expect(s11.byChange["대구"]).toEqual({ [NEW_HIDDEN_CLASS]: 11 }); // 전이표에도 그 이름
    expect(breaker({ valueChangedBySource: s11.valueChangedBySource, lists: [] }).tripped).toBe(true);
    expect(breaker({ valueChangedBySource: summarize(newHidden(10)).valueChangedBySource, lists: [] }).tripped).toBe(false);
    const sameHidden = Array.from({ length: 51 }, (_, i) => toHidden(`s${i}`, "govlist"));
    expect(summarize(sameHidden).valueChangedBySource).toEqual({});
    // 같은 값인데 앞이 govlist 가 아니거나(kosis 5 → govlist 5) 비율만 바뀌면 「값 같음·출처·비율 바뀜」 — 센다
    const kosisSame = /** @type {any} */ ({ ...row("daegu", "k", 5, 5), before: { ...six(5, "2026-09-30"), unsold_source: "kosis" } });
    expect(changeClass(kosisSame)).toBe("값 같음·출처·비율 바뀜");
    const rateOnly = /** @type {any} */ ({ ...row("daegu", "r", 5, 5), after: { ...six(5, "2026-10-31"), unsold_rate: 11 } });
    expect(changeClass(rateOnly)).toBe("값 같음·출처·비율 바뀜");
    expect(summarize([kosisSame, rateOnly]).valueChangedBySource).toEqual({ daegu: 2 });
    const gg = Array.from({ length: 51 }, (_, i) => row("gyeonggi", `g${i}`, 5, 6));
    expect(breaker({ valueChangedBySource: summarize(gg).valueChangedBySource, lists: [] }).tripped).toBe(true);
    expect(breaker({ valueChangedBySource: summarize(gg.slice(1)).valueChangedBySource, lists: [] }).tripped).toBe(false);
  });
  it("--apply-from 대조: 같으면 same · 새 값 하나만 달라도 changed · 행 하나 빠져도 다름", () => {
    const a = run({ absentZero: true });
    expect(comparePlans(a, JSON.parse(JSON.stringify(a))).same).toBe(true);
    const b = JSON.parse(JSON.stringify(a));
    b.find((/** @type {any} */ r) => r.action === "write_listed_hidden").after.unsold_listed_total = 53;
    expect(comparePlans(a, b)).toMatchObject({ same: false, changed: ["ah-2024000001"] });
    const c = JSON.parse(JSON.stringify(a)).filter((/** @type {any} */ r) => r.action !== "write_absent_zero");
    expect(comparePlans(a, c)).toMatchObject({ same: false, onlyCurrent: ["ah-2024000009"] });
    const d = JSON.parse(JSON.stringify(a));
    d.find((/** @type {any} */ r) => r.id === "ah-2024000001").before.unsold = 31;
    expect(comparePlans(a, d).changed).toEqual(["ah-2024000001"]);
  });
  it("사본 = 쓰는 행의 옛 6칸 · 역계획 = expect 새 값 4칸 → set 옛 값 6칸", () => {
    const { before, restore } = buildBackup(run({ absentZero: true }), { asOf: AS_OF, source: "daegu", generatedAt: "t" });
    expect(before.rows.map((r) => r.id).sort()).toEqual(["ah-2024000001", "ah-2024000009"]);
    const row = restore.plan.find((r) => r.id === "ah-2024000001");
    expect(Object.keys(row?.expect ?? {})).toEqual([...RESTORE_EXPECT_KEYS]);
    expect(row?.expect).toEqual({ unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: AS_OF });
    expect(Object.keys(row?.set ?? {})).toEqual([...VALUE_KEYS]);
    expect(row?.set).toMatchObject({ unsold: 30, unsold_rate: 30, unsold_source: "kosis", unsold_as_of: null, unsold_listed_total: null });
  });
  it("명단 표 행: batch_rows = 행 수 · 매칭 상태는 그 단지의 결과", () => {
    const rows = /** @type {any[]} */ ([{ row_no: 1, complex_no: 1, raw: { a: 1 }, sgg: "달서구", emd: null, raw_name: "a", address: null, builder: null, developer: null, is_public: false, is_rental: false, area_band: "59A", total_units: 19, unsold_units: null, hidden: true },
      { row_no: 2, complex_no: 2, raw: {}, sgg: "달서구", emd: null, raw_name: "b", address: null, builder: null, developer: null, is_public: false, is_rental: false, area_band: "84", total_units: 5, unsold_units: 1, hidden: false }]);
    const out = buildListRows({ source: "daegu", asOf: AS_OF, batchId: "B", fileUrl: "u", fetchedAt: "t", rows, results: [res({})] });
    expect(out.map((r) => [r.batch_rows, r.match_state, r.apartment_id])).toEqual([[2, "strong", "ah-2024000001"], [2, "none", null]]);
  });
  it("cityKey: 시 아래 구는 시로 접는다", () => {
    expect(cityKey("천안시 서북구")).toBe("천안시");
    expect(cityKey("달서구")).toBe("달서구");
  });
});

describe("G1③ 쓰기 값 ↔ DB CHECK 맞대기(마이그 글자 그대로 3값 논리로 평가)", () => {
  it("GOVLIST_ROW_CHECKS 의 식 4개가 마이그에 `CONSTRAINT <이름>\\n  CHECK (<식>);` 꼴로 글자 그대로 있다", () => {
    for (const [name, expr] of Object.entries(GOVLIST_ROW_CHECKS)) {
      expect(MIGRATION.includes(`ADD CONSTRAINT ${name}\n  CHECK (${expr});`), name).toBe(true);
    }
  });
  it("JS 판정(rowCheckViolations) = SQL 식 평가 — 6칸 값 조합 전부(출처 6 × 수 3 × 률 2 × 기준일 2 × 확인월 2 × 총분양 3 = 432)", () => {
    let n = 0;
    for (const unsold_source of [null, "kosis", "applyhome", "hold", "govlist", "weird"])
      for (const unsold of [null, 0, 5]) for (const unsold_rate of [null, 10]) for (const unsold_as_of of [null, "2026-09-30"])
        for (const unsold_listed_as_of of [null, "2026-09-30"]) for (const unsold_listed_total of [null, 0, 52]) {
          const six = { unsold, unsold_rate, unsold_source, unsold_as_of, unsold_listed_as_of, unsold_listed_total };
          const sql = Object.entries(GOVLIST_ROW_CHECKS).filter(([, e]) => !sqlCheck(e, six)).map(([k]) => k);
          expect(rowCheckViolations(six), JSON.stringify(six)).toEqual(sql);
          n++;
        }
    expect(n).toBe(432);
  });
  it("계획이 내는 모든 쓰는 행(꺼짐·켬 · 비공개·숫자·미등재 0 · 총분양 0)이 CHECK 4개를 지킨다", () => {
    const plans = [
      run(), run({ absentZero: true }), run({ complexes: [cx({ hidden: false, unsold_units: 2, total_units: 12 })] }),
      run({ complexes: [cx({ total_units: 0 })] }), run({ complexes: [cx({ hidden: false, unsold_units: 0, total_units: 0 })] }),
      run({ absentZero: true, zRow: { unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: "2026-08-31", unsold_listed_as_of: null } }),
    ];
    const writes = plans.flat().filter((r) => r.action.startsWith("write_"));
    expect(writes.length).toBeGreaterThanOrEqual(7);
    for (const r of writes) {
      for (const [name, expr] of Object.entries(GOVLIST_ROW_CHECKS)) expect(sqlCheck(expr, /** @type {any} */ (r.after)), `${r.id} ${r.action} ${name}`).toBe(true);
      expect(rowCheckViolations(/** @type {any} */ (r.after))).toEqual([]);
    }
  });
  it("G1④ ownOldZero·dropped_from_list 가 이 표지로 맞게 돈다: 지난 회차 미등재 0(listed NULL) → 기준일 갱신 · 지난 회차 등재(listed 있음) → dropped", () => {
    expect(byId(run({ absentZero: true, zRow: { unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: "2026-08-31", unsold_listed_as_of: null } }), "ah-2024000009").action).toBe("write_absent_zero");
    expect(byId(run({ absentZero: true, zRow: { unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: "2026-08-31", unsold_listed_as_of: "2026-08-31", unsold_listed_total: 40 } }), "ah-2024000009").action).toBe("dropped_from_list");
    // 같은 기준일 미등재 0 은 유효한 명단 값 → 다시 쓰지 않음(e_govlist_valid)
    const same = byId(run({ absentZero: true, zRow: { unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: AS_OF, unsold_listed_as_of: null } }), "ah-2024000009");
    expect(same).toMatchObject({ action: "not_listed", after: null });
    expect(same.reasons).toContain("e_govlist_valid");
  });
});

describe("G3·G4 거짓 0 길 막기(검사관 탐침 A·B·E 꼴)", () => {
  const sup = (/** @type {string} */ id, /** @type {number} */ n) => ({ apartment_id: id, house_manage_no: id.slice(3), model_no: "1", general_supply: n, special_supply: 0, source: "apt" });
  const sch = (/** @type {string} */ id, /** @type {string} */ d) => ({ apartment_id: id, house_manage_no: id.slice(3), recruit_date: d });
  /** @param {AptRow[]} rows @param {any[]} sups @param {any[]} schs @param {GovComplex[]} cxs @param {string[]} universe @param {Record<string, number | null>} [totals] */
  const go = (rows, sups, schs, cxs, universe, totals = {}) => {
    const bundles = buildBundles(rows, sups, schs);
    const results = matchComplexes(cxs, bundles);
    return { results, plan: planSource({ source: "daegu", asOf: AS_OF, now: NOW, complexes: cxs, results, bundles, sggUniverse: universe, sggTotals: totals, listRowCount: 100, prevRowCount: null, absentZero: true }) };
  };
  it("A 쌍둥이 묶음: 한 단지가 K(원 공고 · strong)·Z(재공고만 · 세대 어긋남)로 갈리면 Z 는 후보였으므로 0 을 받지 않는다", () => {
    const { results, plan } = go(
      [apt({ id: "ah-2024000001", name: "행복마을아파트", complex_key: "K" }), apt({ id: "ah-2024000077", name: "행복마을 아파트", complex_key: "Z" })],
      [sup("ah-2024000001", 500), sup("ah-2024000077", 30)], [sch("ah-2024000001", "2024-01-15"), sch("ah-2024000077", "2024-06-01")],
      [cx({ raw_name: "행복마을", name_candidates: ["행복마을"], total_units: 500, approval_date: "2024-01-10" })], ["달서구"]);
    // 두 묶음 다 0.9 이상 후보라 strong 도 주지 않는다(G3 — 1등 + 0.9 이상 하나뿐)
    expect(results[0].state).toBe("weak");
    expect(plan.filter((r) => r.action === "write_absent_zero")).toEqual([]);
    expect(byId(plan, "ah-2024000077").reasons).toContain("d_candidate_of_list");
  });
  it("E 포함 규칙: 명단 「힐스테이트감삼」 ↔ 엉뚱한 「…감삼센트럴」(0.9·세대 맞음) + 진짜 「힐스테이트 감삼」(1.0·세대 어긋남) → strong 아님 · 진짜 짝 0 아님", () => {
    const { results, plan } = go(
      [apt({ id: "ah-2024000001", name: "힐스테이트감삼센트럴", complex_key: "K" }), apt({ id: "ah-2024000002", name: "힐스테이트 감삼", complex_key: "Z" })],
      [sup("ah-2024000001", 500), sup("ah-2024000002", 30)], [sch("ah-2024000001", "2024-01-15"), sch("ah-2024000002", "2024-06-01")],
      [cx({ raw_name: "힐스테이트감삼", name_candidates: ["힐스테이트감삼"], total_units: 500, approval_date: "2024-01-10" })], ["달서구"]);
    expect(results[0]).toMatchObject({ state: "weak", bundle_key: null });
    expect(plan.filter((r) => r.action.startsWith("write_"))).toEqual([]);
  });
  it("E′ 1등이 strong 이고 0.9 이상이 그 하나뿐이면 strong 은 그대로", () => {
    const { results } = go(
      [apt({ id: "ah-2024000001", name: "힐스테이트 감삼", complex_key: "K" }), apt({ id: "ah-2024000002", name: "감삼 래미안", complex_key: "Z" })],
      [sup("ah-2024000001", 500)], [sch("ah-2024000001", "2024-01-15")],
      [cx({ raw_name: "힐스테이트감삼", name_candidates: ["힐스테이트감삼"], total_units: 500, approval_date: "2024-01-10" })], ["달서구"]);
    expect(results[0]).toMatchObject({ state: "strong", bundle_key: "K" });
  });
  it("B 명단 시군구 표기가 총괄표와 다름(「달서」) → 출처 전체 미등재→0 끔(d_list_sgg_unknown)", () => {
    const { plan } = go([apt({ id: "ah-2024000001", name: "행복마을아파트", complex_key: "K" })], [sup("ah-2024000001", 500)], [sch("ah-2024000001", "2024-01-15")],
      [cx({ sgg: "달서", raw_name: "행복마을", name_candidates: ["행복마을"], total_units: 500 })], ["달서구"]);
    expect(plan[0]).toMatchObject({ action: "not_listed" });
    expect(plan[0].reasons).toContain("d_list_sgg_unknown");
  });
  it("G4 총괄표엔 그 구 미분양 > 0 인데 명단 행 0 → 그 구는 미해소(d_sgg_unresolved) · 총괄표 0 이면 해소", () => {
    const rows = [apt({ id: "ah-2024000001", name: "다른단지", gu: "중구", complex_key: "K" })];
    const args = /** @type {const} */ ([[sup("ah-2024000001", 10)], [sch("ah-2024000001", "2024-01-15")]]);
    const list = [cx({ sgg: "달서구", raw_name: "행복마을", name_candidates: ["행복마을"], total_units: 500 })];
    const r1 = go(rows, [...args[0]], [...args[1]], list, ["달서구", "중구"], { 달서구: 10, 중구: 641 }).plan[0];
    expect(r1.action).toBe("not_listed");
    expect(r1.reasons).toContain("d_sgg_unresolved");
    // 달서구 명단 단지가 none(미해소)이라도 중구는 별개 — 총괄표 중구 0 이면 중구 행은 0 을 받는다
    const r2 = go(rows, [...args[0]], [...args[1]], list, ["달서구", "중구"], { 달서구: 10, 중구: 0 }).plan[0];
    expect(r2.action).toBe("write_absent_zero");
  });
});

describe("만료 상수 정본 하나 (세션692 PR-4 · 691 적대 🟡3)", () => {
  it("이 모듈의 GOVLIST_EXPIRY_MONTHS 는 _shared.mjs 것을 다시 내보낸 것 — 쌍둥이 상수가 돌아오면 빨강", async () => {
    const shared = /** @type {any} */ (await import("./_shared.mjs"));
    const plan = /** @type {any} */ (await import("./_govlist-plan.mjs"));
    expect(plan.GOVLIST_EXPIRY_MONTHS).toBe(shared.GOVLIST_EXPIRY_MONTHS);
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./_govlist-plan.mjs", import.meta.url)), "utf8");
    expect(src).not.toMatch(/export\s+const\s+GOVLIST_EXPIRY_MONTHS\s*=/);
    expect(src).toMatch(/import \{[^}]*\bGOVLIST_EXPIRY_MONTHS\b[^}]*\} from "\.\/_shared\.mjs";/);
  });
});

describe("미래 기준일(세션697 👤 결정 ① 「무시+경보」) — 만료와 같은 길 · 사유는 「미래 기준일」", () => {
  it("이번 명단 기준일이 오늘(KST) 뒤면 skip_expired_source · 사유 = `as_of <기준일> = 미래 기준일(오늘 <KST 날짜>)`", () => {
    const r = byId(run({ now: new Date("2026-09-29T12:00:00+09:00") }), "ah-2024000001");
    expect(r.action).toBe("skip_expired_source");
    expect(r.reasons).toEqual([`as_of ${AS_OF} = 미래 기준일(오늘 2026-09-29)`]);
    expect(r.reasons[0]).not.toContain("개월 지남");
  });
  it("경계: 기준일 당일(KST 09-30 00:30)은 미래 아님 → 씀 · 하루 전 밤(KST 09-29 23:59)은 미래", () => {
    expect(byId(run({ now: new Date("2026-09-30T00:30:00+09:00") }), "ah-2024000001").action).toBe("write_listed_hidden");
    expect(byId(run({ now: new Date("2026-09-29T23:59:00+09:00") }), "ah-2024000001").action).toBe("skip_expired_source");
  });
  it("미등재 길(켬)도 미래 명단이면 skip_expired_source + 같은 사유 · 만료 사유 글자는 그대로", () => {
    const fut = byId(run({ absentZero: true, now: new Date("2026-09-29T12:00:00+09:00") }), "ah-2024000009");
    expect(fut).toMatchObject({ action: "skip_expired_source", reasons: [`as_of ${AS_OF} = 미래 기준일(오늘 2026-09-29)`] });
    const exp = byId(run({ now: new Date("2027-03-31T00:30:00+09:00") }), "ah-2024000001");
    expect(exp.reasons).toEqual([`as_of ${AS_OF} + ${GOVLIST_EXPIRY_MONTHS}개월 지남`]);
  });
  it("기존 행의 미래 기준일 값은 존중하지 않는다 — 미래 청약홈은 skip_applyhome 아님 · 미래 명단은 「더 새 명단」·(e) 유효 명단이 아님", () => {
    // 대조군(NOW = KST 11/02): 9월 청약홈은 지금처럼 skip_applyhome
    expect(byId(run({ absentZero: true, zRow: { unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-09-01" } }), "ah-2024000009").action).toBe("skip_applyhome");
    expect(byId(run({ absentZero: true, zRow: { unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-12-01" } }), "ah-2024000009").action).toBe("write_absent_zero");
    // 「미등재 0」 꼴 명단 값(listed_as_of 없음) — 옛 판정이면 기준일이 이번 명단보다 「더 새」라 skip_newer_govlist, 그다음 (e) 유효 명단
    const futGov = { unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: "2027-01-31", unsold_listed_as_of: null };
    const r = byId(run({ absentZero: true, zRow: futGov }), "ah-2024000009");
    expect(r.action).toBe("write_absent_zero");
    expect(r.reasons).not.toContain("e_govlist_valid");
    // 대조군: 같은 꼴의 과거(유효) 명단 값은 (e) 로 막힌다(옛 0 이라도 기준일이 이번과 같으면 ownOldZero 아님)
    expect(byId(run({ absentZero: true, zRow: { ...futGov, unsold_as_of: AS_OF } }), "ah-2024000009").reasons).toContain("e_govlist_valid");
  });
});
