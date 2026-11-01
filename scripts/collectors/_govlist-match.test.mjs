// @ts-check
import { describe, it, expect } from "vitest";
import {
  buildBundles, matchComplexes, pickNotice, buildNotices, guMatches, emdMatches, isBlockName, parseMatchDecisions, scoreCandidate,
} from "./_govlist-match.mjs";

/** @typedef {import("./_govlist-match.mjs").AptRow} AptRow */
/** @typedef {import("./_govlist-parse.mjs").GovComplex} GovComplex */

/** @param {Partial<AptRow> & { id: string }} o @returns {AptRow} */
const apt = (o) => ({
  name: null, region: "대구", gu: "달서구", dong: null, address: null, road_address: null, builder: null, units: null, unit_source: null,
  unsold: null, unsold_rate: null, unsold_source: null, unsold_as_of: null, unsold_listed_as_of: null, unsold_listed_total: null,
  presale_type: null, complex_key: null, competition_supply: null, completion: null, ...o,
});
/** @param {Partial<GovComplex>} o @returns {GovComplex} */
const cx = (o) => ({
  complex_no: 1, list_key: "daegu|달서구|x", sgg: "달서구", emd: null, location: null, raw_name: null, name_candidates: [], address: null,
  builder: null, developer: null, is_public: false, is_rental: false, total_units: 0, unsold_units: null, unsold_partial: false, unsold_over_total: false, hidden: true,
  approval_date: null, row_nos: [1], ...o,
});

// ── 양성 대조군: 두류 센트레빌 더파크 — 운영 DB 실측 값 그대로(세션687 02:0x · 두 행 hold · 묶음 열쇠 같음) ──
const DURYU_KEY = "두류센트레빌더파크###L0#대구#달서구";
const duryuRows = [
  apt({ id: "ah-2025910146", name: "두류센트레빌 더 파크(조합원 취소분)", dong: "두류3동", address: "대구 달서구 두류동 638-19", road_address: "대구광역시 달서구 당산로36길 37", builder: "두류야외음악당지역주택조합", units: 9, unsold_source: "hold", unsold_as_of: "2026-11-01", complex_key: DURYU_KEY, competition_supply: 9 }),
  apt({ id: "ah-2025910254", name: "두류센트레빌 더 파크(조합원 취소분)(2회차)", dong: "두류3동", address: "대구 달서구 두류동 638-19", road_address: "대구광역시 달서구 당산로36길 37", builder: "두류야외음악당지역주택조합", units: 433, unsold_source: "hold", unsold_as_of: "2026-11-01", complex_key: DURYU_KEY, competition_supply: 1 }),
];
// 같은 공고 줄이 두 행에 겹쳐 실려 있다(행마다 같은 공고·면적형) — 중복 제거가 안 되면 104 가 된다.
const sup = (/** @type {string} */ id, /** @type {string} */ no, /** @type {string} */ model, /** @type {number} */ g, /** @type {number} */ s, src = "apt") => ({ apartment_id: id, house_manage_no: no, model_no: model, general_supply: g, special_supply: s, source: src });
const duryuSupply = ["ah-2025910146", "ah-2025910254"].flatMap((id) => [
  sup(id, "2025000017", "01", 8, 11), sup(id, "2025000017", "02", 1, 0), sup(id, "2025000017", "03", 14, 18),
  sup(id, "2025000282", "01", 4, 5), sup(id, "2025000282", "02", 8, 10), sup(id, "2025000535", "01", 1, 0),
]).concat([sup("ah-2025910146", "2025910146", "01", 9, 0, "remndr"), sup("ah-2025910254", "2025910254", "01", 1, 0, "remndr")]);
const duryuSched = ["ah-2025910146", "ah-2025910254"].flatMap((id) => [
  { apartment_id: id, house_manage_no: "2025000017", recruit_date: "2025-02-13" },
  { apartment_id: id, house_manage_no: "2025000282", recruit_date: "2025-07-04" },
  { apartment_id: id, house_manage_no: "2025000535", recruit_date: "2025-10-31" },
]);
const duryuCx = cx({ complex_no: 58, list_key: "daegu|달서구|두류동638-19(두류센트레빌더파크)", sgg: "달서구", emd: "두류동", raw_name: "두류 센트레빌 더파크", name_candidates: ["두류 센트레빌 더파크"], address: "두류동 638-19", builder: "주식회사 동부건설", developer: "두류야외음악당 지역주택조합", total_units: 52, approval_date: "2025-02-11", hidden: true });

describe("세대 게이트 재료 — 공고 하나의 일반+특별 합", () => {
  it("두류: 공고 2025000017 = 52 (면적형 중복 제거 · 두 행에 겹친 줄을 한 번만)", () => {
    const n = buildNotices(duryuRows, duryuSupply, duryuSched);
    expect(n.find((x) => x.house_manage_no === "2025000017")?.supply).toBe(52);
    expect(n.find((x) => x.house_manage_no === "2025000282")?.supply).toBe(27);
    expect(n.find((x) => x.house_manage_no === "2025000535")?.supply).toBe(1);
  });
  it("분양승인일 2025-02-11 에 가장 가까운 공고 = 2025000017(모집 02-13) · 승인일 없으면 가장 이른 공고", () => {
    const n = buildNotices(duryuRows, duryuSupply, duryuSched);
    expect(pickNotice(n, "2025-02-11")?.house_manage_no).toBe("2025000017");
    expect(pickNotice(n, "2025-10-20")?.house_manage_no).toBe("2025000535");
    expect(pickNotice(n, null)?.house_manage_no).toBe("2025000017");
    // 날짜 있는 공고가 없으면 번호가 가장 작은 공고
    expect(pickNotice([{ house_manage_no: "B", recruit_date: null, supply: 1, kind: null }, { house_manage_no: "A", recruit_date: null, supply: 2, kind: null }], "2025-01-01")?.house_manage_no).toBe("B");
  });
  it("공급 줄이 없으면 그 공고 행의 competition_supply", () => {
    const n = buildNotices([apt({ id: "ah-2024000001", competition_supply: 77 })], [], [{ apartment_id: "ah-2024000001", house_manage_no: "2024000001", recruit_date: "2024-01-01" }]);
    expect(n[0].supply).toBe(77);
  });
});

describe("matchComplexes — 대조군", () => {
  const bundles = buildBundles(duryuRows, duryuSupply, duryuSched);
  it("두류 → strong(이름 1.0 + 52 = 52) · 대표 행 · 시공사 근거(우리 builder = 명단 시행사)", () => {
    const [r] = matchComplexes([duryuCx], bundles);
    expect(r).toMatchObject({ state: "strong", bundle_key: DURYU_KEY });
    expect(["ah-2025910146", "ah-2025910254"]).toContain(r.apartment_id);
    expect(r.best).toMatchObject({ supply: 52, notice: "2025000017", unitsOk: true, builderOk: true });
  });
  it("반대 방향: 같은 이름이 다른 구(서구)에 있으면 안 붙는다", () => {
    const other = duryuRows.map((r) => ({ ...r, id: `${r.id}x`, gu: "서구", address: "대구 서구 내당동 1", dong: "내당동", complex_key: "다른#서구" }));
    const [r] = matchComplexes([duryuCx], buildBundles(other, [], []));
    expect(r.state).toBe("none");
    expect(r.candidates).toHaveLength(0);
  });
  it("반대 방향: 같은 구라도 읍면동이 다르면 안 붙는다", () => {
    const other = duryuRows.map((r) => ({ ...r, address: "대구 달서구 본리동 1", road_address: null, dong: "본리동" }));
    expect(matchComplexes([duryuCx], buildBundles(other, duryuSupply, duryuSched))[0].state).toBe("none");
  });
  it("세대가 ±10% 밖이면 weak(none 아님)", () => {
    const [r] = matchComplexes([{ ...duryuCx, total_units: 80 }], bundles);
    expect(r.state).toBe("weak");
    expect(r.reasons.join(",")).toContain("units_mismatch(80≠52)");
    // 경계: 52 × 1.1 ≈ 57.2 → 57 은 통과, 58 은 weak
    expect(matchComplexes([{ ...duryuCx, total_units: 57 }], bundles)[0].state).toBe("strong");
    expect(matchComplexes([{ ...duryuCx, total_units: 58 }], bundles)[0].state).toBe("weak");
  });
  it("공고 재료가 없으면 weak(units_unknown)", () => {
    const [r] = matchComplexes([duryuCx], buildBundles(duryuRows, [], []));
    expect(r.state).toBe("weak");
    expect(r.reasons).toContain("units_unknown");
  });
});

describe("블록 이름 · 충돌 · 판정 파일", () => {
  const blockRows = [apt({ id: "ah-2022000001", region: "충남", gu: "당진시", name: "당진 수청2지구 RH-3블록 호반써밋 시그니처 3차", address: "충남 당진시 수청동 1543", complex_key: "수청#당진" })];
  const blockSup = [sup("ah-2022000001", "2022000001", "01", 800, 53)];
  const blockSched = [{ apartment_id: "ah-2022000001", house_manage_no: "2022000001", recruit_date: "2022-03-01" }];
  const blockCx = cx({ list_key: "chungnam|당진시|수청2지구RH-3블럭", sgg: "당진시", emd: "수청동", name_candidates: ["수청2지구 RH-3블럭 호반써밋 시그니처 3차"], total_units: 853, approval_date: "2022-02-28", hidden: false, unsold_units: 0 });
  const bb = buildBundles(blockRows, blockSup, blockSched);
  it("블록 이름은 세대가 맞아도 자동 strong 아님 → weak(block_name)", () => {
    expect(isBlockName("수청2지구 RH-3블럭")).toBe(true);
    expect(isBlockName("월송지구 B-2BL")).toBe(true);
    expect(isBlockName("수청1지구 44B-1L")).toBe(true);
    expect(isBlockName("두류 센트레빌 더파크")).toBe(false);
    const [r] = matchComplexes([blockCx], bb);
    expect(r.state).toBe("weak");
    expect(r.reasons[0]).toBe("block_name");
    expect(r.best?.unitsOk).toBe(true);
  });
  it("판정 파일 active → decided(그 묶음) · rejected+null → rejected · rejected+묶음 → 그 짝 금지", () => {
    const dec = parseMatchDecisions({ decisions: [{ list_key: blockCx.list_key, bundle_key: "수청#당진", status: "active" }] });
    expect(matchComplexes([blockCx], bb, dec)[0]).toMatchObject({ state: "decided", bundle_key: "수청#당진", apartment_id: "ah-2022000001" });
    const rej = parseMatchDecisions({ decisions: [{ list_key: blockCx.list_key, bundle_key: null, status: "rejected" }] });
    expect(matchComplexes([blockCx], bb, rej)[0].state).toBe("rejected");
    const ban = parseMatchDecisions({ decisions: [{ list_key: duryuCx.list_key, bundle_key: DURYU_KEY, status: "rejected" }] });
    expect(matchComplexes([duryuCx], buildBundles(duryuRows, duryuSupply, duryuSched), ban)[0].state).toBe("none");
  });
  it("active 의 묶음이 사라졌으면 weak(decision_bundle_missing) — 조용히 붙이지 않는다", () => {
    const dec = parseMatchDecisions({ decisions: [{ list_key: blockCx.list_key, bundle_key: "없는열쇠", status: "active" }] });
    expect(matchComplexes([blockCx], bb, dec)[0]).toMatchObject({ state: "weak", method: "decision_bundle_missing" });
  });
  it("한 명단 단지가 두 묶음에 strong → 둘 다 안 붙음(two_bundles)", () => {
    const twin = duryuRows.map((r) => ({ ...r, id: `${r.id}b`, complex_key: "쌍둥이#달서" }));
    const twinSup = duryuSupply.map((s) => ({ ...s, apartment_id: `${s.apartment_id}b` }));
    const twinSch = duryuSched.map((s) => ({ ...s, apartment_id: `${s.apartment_id}b` }));
    const [r] = matchComplexes([duryuCx], buildBundles([...duryuRows, ...twin], [...duryuSupply, ...twinSup], [...duryuSched, ...twinSch]));
    expect(r).toMatchObject({ state: "weak", method: "conflict", bundle_key: null, apartment_id: null });
    expect(r.reasons[0]).toBe("two_bundles");
  });
  it("두 명단 단지가 한 묶음에 strong → 둘 다 내림(bundle_shared)", () => {
    const rs = matchComplexes([duryuCx, { ...duryuCx, complex_no: 59, list_key: "daegu|달서구|두번째" }], buildBundles(duryuRows, duryuSupply, duryuSched));
    expect(rs.map((r) => r.state)).toEqual(["weak", "weak"]);
    expect(rs.every((r) => r.reasons[0] === "bundle_shared")).toBe(true);
  });
  it("차수 어긋남(2차 ↔ 3차)은 후보에서 빠진다", () => {
    const rows = [apt({ id: "ah-1", name: "힐스테이트 대구역 퍼스트3차", gu: "중구", address: "대구 중구 태평로3가 1", complex_key: "k" })];
    const c = cx({ sgg: "중구", emd: "태평로3가", name_candidates: ["힐스테이트 대구역 퍼스트2차"], total_units: 10 });
    expect(scoreCandidate(c, buildBundles(rows, [], [])[0])).toBeNull();
  });
});

describe("게이트 함수", () => {
  it("구군: 공백 무시 정확 일치 · 우리 gu 가 시뿐이면 주소에 구가 있을 때만", () => {
    expect(guMatches("천안시 서북구", apt({ id: "a", gu: "천안시 서북구" }))).toBe(true);
    expect(guMatches("천안시 서북구", apt({ id: "a", gu: "천안시서북구" }))).toBe(true);
    expect(guMatches("천안시 서북구", apt({ id: "a", gu: "천안시", address: "충남 천안시 서북구 두정동 1" }))).toBe(true);
    expect(guMatches("천안시 서북구", apt({ id: "a", gu: "천안시", address: "충남 천안시 동남구 신부동 1" }))).toBe(false);
    expect(guMatches("서구", apt({ id: "a", gu: "달서구" }))).toBe(false);
  });
  it("읍면동: 행정동 숫자 떼기 · 주소 낱말 · 소재지 지번의 동", () => {
    expect(emdMatches(cx({ emd: "두류동" }), apt({ id: "a", dong: "두류3동" }))).toBe(true);
    expect(emdMatches(cx({ emd: "부대동", address: "성성동 60-9" }), apt({ id: "a", dong: "성성동" }))).toBe(true);
    expect(emdMatches(cx({ emd: "부대동" }), apt({ id: "a", dong: "성정동", address: "충남 천안시 서북구 성정동 1" }))).toBe(false);
    expect(emdMatches(cx({ emd: null }), apt({ id: "a" }))).toBe(true);
  });
  it("판정 파일 모양 검사", () => {
    expect(() => parseMatchDecisions({})).toThrow(/decisions/);
    expect(() => parseMatchDecisions({ decisions: [{ list_key: "x", status: "active", bundle_key: "k" }] })).toThrow(/list_key/);
    expect(() => parseMatchDecisions({ decisions: [{ list_key: "a|b|c", status: "maybe" }] })).toThrow(/status/);
    expect(() => parseMatchDecisions({ decisions: [{ list_key: "a|b|c", status: "active" }] })).toThrow(/bundle_key/);
    expect(() => parseMatchDecisions({ decisions: [{ list_key: "a|b|c", status: "active", bundle_key: "k1" }, { list_key: "a|b|c", status: "active", bundle_key: "k2" }] })).toThrow(/active 둘/);
    expect(parseMatchDecisions({ decisions: [] })).toEqual([]);
  });
});
