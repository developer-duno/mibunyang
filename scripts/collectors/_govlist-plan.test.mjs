// @ts-check
import { describe, it, expect } from "vitest";
import {
  planSource, listedValue, summarize, breaker, comparePlans, buildBackup, buildListRows, changeClass, cityKey,
  GOVLIST_EXPIRY_MONTHS, GOVLIST_BREAKER_MAX_BUNDLES, VALUE_KEYS, RESTORE_EXPECT_KEYS,
} from "./_govlist-plan.mjs";
import { buildBundles } from "./_govlist-match.mjs";

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
  builder: null, developer: null, is_public: false, is_rental: false, total_units: 52, unsold_units: null, unsold_partial: false, hidden: true,
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
  it("숫자 칸이 하나라도 비면(충남 수청2 RH-3 6월 꼴) 비공개와 같은 값", () => {
    expect(listedValue([cx({ hidden: false, unsold_units: null })], AS_OF).kind).toBe("hidden");
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
  it("켜고 조건 전부 → write_absent_zero(0 · 0 · govlist · as_of · listed 칸 비움)", () => {
    const r = byId(run({ absentZero: true }), "ah-2024000009");
    expect(r.action).toBe("write_absent_zero");
    expect(r.after).toEqual({ unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: AS_OF, unsold_listed_as_of: null, unsold_listed_total: null });
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
  it(`차단기: 바뀔 단지 > ${GOVLIST_BREAKER_MAX_BUNDLES} · 행 수 −50%`, () => {
    expect(breaker({ changedBundles: 50, lists: [] }).tripped).toBe(false);
    expect(breaker({ changedBundles: 51, lists: [] }).tripped).toBe(true);
    expect(breaker({ changedBundles: 0, lists: [{ source: "daegu", rows: 146, prevRows: 293 }] }).tripped).toBe(true);
    expect(breaker({ changedBundles: 0, lists: [{ source: "daegu", rows: 147, prevRows: 293 }] }).tripped).toBe(false);
    expect(breaker({ changedBundles: 0, lists: [{ source: "daegu", rows: 1, prevRows: null }] }).tripped).toBe(false);
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
