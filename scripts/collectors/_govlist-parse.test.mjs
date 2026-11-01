// @ts-check
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { workbookToGrids, normalizeCell } from "./_govlist-xlsx.mjs";
import {
  parseGovlistWorkbook, parseLocation, parseAsOfText, headerMonth, parseListDate, isAddressLike, listKeyOf, GovlistParseError,
} from "./_govlist-parse.mjs";

/** @typedef {import("./_govlist-parse.mjs").Grid} Grid */
/** @typedef {import("./_govlist-parse.mjs").ParsedList} ParsedList */

const FX = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/govlist");
/** @type {Record<string, Grid[]>} */ const grids = {};
/** @type {Record<string, ParsedList>} */ const P = {};
beforeAll(async () => {
  for (const [k, f, s] of [["dg09", "daegu_2026-09.xlsx", "daegu"], ["cn06", "chungnam_2026-06.xlsx", "chungnam"], ["cn02", "chungnam_2026-02.xlsx", "chungnam"]]) {
    grids[k] = await workbookToGrids(readFileSync(resolve(FX, f)));
    P[k] = parseGovlistWorkbook(grids[k], { source: s });
  }
}, 60_000);
const byName = (/** @type {ParsedList} */ p, /** @type {RegExp} */ re) => p.complexes.filter((c) => c.name_candidates.some((n) => re.test(n)));

// 기대값 출처 = 원본 xlsx 를 openpyxl 로 직접 읽은 칸(세션687 02:0x — 「업체별현황」 시트 실물) · 소계·합계 줄 대조.
describe("대구 2026-09 (픽스처 daegu_2026-09.xlsx 66,299B = 누리집 FILE_000000000728147 sn1)", () => {
  it("기준일·칸·행 수 · 소계·합계 대조 전부 일치", () => {
    const p = P.dg09;
    expect(p).toMatchObject({ sheet: "업체별현황", asOf: "2026-09-30", currentUnsoldKey: "분양결과 / 미분양가구수 / 당해월('26.9월)" });
    expect(p.columns.map((c) => c.key)).toEqual([
      "지역 / 시군구", "지역 / 읍면동", "소재지", "사업자 / 시공사", "사업자 / 시행사", "유형 / (민간/공공)", "유형 / (임대/분양)", "분양내용 / 규모별(전용㎡)",
      "분양결과 / 총분양가구수", "분양결과 / 미분양가구수 / 전월('26.8월)", "분양결과 / 미분양가구수 / 당해월('26.9월)", "분양승인일", "계약마감일", "입주예정(준공)월", "준공여부(준공/미준공)",
    ]);
    expect([p.rows.length, p.complexes.length, p.complexes.filter((c) => c.hidden).length]).toEqual([293, 60, 57]);
    expect(p.checks.subtotalMismatch).toEqual([]);
    expect(p.checks.sectionMismatch).toEqual([]);
    expect(p.checks.unlabeledRows).toEqual([42, 320, 326]); // 이름표 없는 소계 줄 3 — 57 + 3 = 60단지
    expect(p.sggUniverse).toEqual(expect.arrayContaining(["중구", "달서구", "달성군", "군위군"]));
  });
  it("두류 센트레빌 더파크 = 달서구·두류동·총분양 52(19·1·32)·비공개·승인일 2025-02-11", () => {
    const [d] = byName(P.dg09, /두류\s*센트레빌/);
    expect(d).toMatchObject({
      sgg: "달서구", emd: "두류동", raw_name: "두류 센트레빌 더파크", address: "두류동 638-19", builder: "주식회사 동부건설",
      developer: "두류야외음악당 지역주택조합", total_units: 52, unsold_units: null, hidden: true, approval_date: "2025-02-11",
    });
    const bands = P.dg09.rows.filter((r) => r.complex_no === d.complex_no);
    expect(bands.map((b) => [b.area_band, b.total_units, b.hidden, b.unsold_units])).toEqual([["59A", 19, true, null], ["59B", 1, true, null], ["78", 32, true, null]]);
    // raw = 원문 그대로(줄바꿈·전화번호 포함) · 단지 공통 칸은 면적대 줄마다 채워짐 · 버리는 칸 없음
    expect(bands[2].raw["소재지"]).toBe("두류동 638-19\n(두류 센트레빌 더파크)");
    expect(String(bands[2].raw["사업자 / 시공사"])).toContain("(02-3484-2397)");
    expect(bands[0].raw["분양결과 / 미분양가구수 / 전월('26.8월)"]).toBe("건설사 요청으로\n비공개");
    // 15칸 중 당해월 칸만 빠진다 — 「비공개」 글자가 전월·당월 가로 병합이라 당월 칸은 원본에서 비어 있다(빈 칸만 빠지는 규칙)
    expect(Object.keys(bands[0].raw).sort()).toEqual(P.dg09.columns.map((c) => c.key).filter((k) => !/당해월/.test(k)).sort());
  });
  it("동구 구간은 원본 시군구 칸이 비어 있다(B53:B139 병합만) → 합계 줄 「(동구지역)」로 12단지를 채운다", () => {
    const dong = P.dg09.complexes.filter((c) => c.sgg === "동구");
    expect(dong).toHaveLength(12);
    expect(byName(P.dg09, /아츠베르 1단지/)[0]).toMatchObject({ sgg: "동구", list_key: expect.stringMatching(/^daegu\|동구\|/) });
    expect(P.dg09.checks.sggFilled).toHaveLength(12);
    expect(P.dg09.checks.sggFilled.every((x) => x.sgg === "동구" && x.from === "합계 줄")).toBe(true);
    expect(P.dg09.rows.filter((r) => r.sgg === "동구").length).toBeGreaterThan(12);
    for (const p of [P.dg09, P.cn06, P.cn02]) expect(p.complexes.filter((c) => !c.sgg)).toEqual([]);
  });
  it("숫자 공개 단지는 3곳 · 미분양 = 당해월 칸 합", () => {
    const pub = P.dg09.complexes.filter((c) => !c.hidden);
    expect(pub.map((c) => c.name_candidates[0]).sort()).toEqual(["나나바루아", "대명 헤리티지", "수성 골드클래스"]);
    expect(pub.every((c) => c.unsold_units != null)).toBe(true);
    // 원본 줄(대명 헤리티지 84㎡ 30세대 당월 24 + 1세대 줄) — 당해월 칸 합
    expect(byName(P.dg09, /대명 헤리티지/)[0]).toMatchObject({ total_units: 31, unsold_units: 25 });
  });
});

describe("충남 2026-06 · 2026-02 (서식 다름 — 비공개 표시가 소재지 글자 안 · 소계 줄 0 은 버림)", () => {
  it("6월: 기준일·행 수 · 미분양 칸 = (26.6.30)", () => {
    const p = P.cn06;
    expect(p.asOf).toBe("2026-06-30");
    expect(p.currentUnsoldKey).toBe("분양결과 / 미분양가구수 / (26.6.30)");
    expect([p.rows.length, p.complexes.length, p.complexes.filter((c) => c.hidden).length]).toEqual([252, 69, 46]);
    expect(p.columns.map((c) => c.key)).toEqual(expect.arrayContaining(["지구명(OO지구)", "택지종류(민간/공공)"]));
  });
  it("음성 대조군: 호반써밋 포레센트(삼룡동)는 2·6월 모두 명단에 없다", () => {
    for (const p of [P.cn06, P.cn02]) {
      expect(p.complexes.filter((c) => /포레센트|삼룡/.test(String(c.location)))).toEqual([]);
    }
    // 양성: 같은 천안의 비공개 단지는 이름이 실려 있다
    expect(byName(P.cn06, /천안역 스카이움/)[0]).toMatchObject({ sgg: "천안시 서북구", hidden: true, unsold_units: null, total_units: 999 });
  });
  it("소계 줄의 0 을 쓰지 않는다 — 비공개 단지 미분양은 null", () => {
    const sky = byName(P.cn06, /천안역 스카이움/)[0];
    expect(P.cn06.rows.filter((r) => r.complex_no === sky.complex_no).every((r) => r.unsold_units === null && r.hidden)).toBe(true);
  });
  it("숫자 단지 · 0 단지 잔존 · 빈칸 단지", () => {
    expect(byName(P.cn06, /월송지구 B-2BL/)[0]).toMatchObject({ hidden: false, total_units: 560, unsold_units: 2 });
    expect(byName(P.cn02, /수청2지구 RH-3/)[0]).toMatchObject({ hidden: false, unsold_units: 0 });
    expect(byName(P.cn06, /수청2지구 RH-3/)[0]).toMatchObject({ hidden: false, unsold_units: null }); // 6월은 칸이 비었다
  });
  it("원본 합계 수식이 소계를 빠뜨린 곳은 경고로만 남는다(천안 행 162 · 논산 행 264) · 당진 290 은 총분양 NULL 단지 때문", () => {
    expect(P.cn06.checks.sectionMismatch.map((x) => x.sheet_row)).toEqual([162, 264, 290]);
    expect(P.cn06.checks.subtotalMismatch).toEqual([{ complex_no: expect.any(Number), sheet_row: 112, subtotal: 2518, sum: 977 }]);
  });
  it("부여 구간도 시군구 칸이 비어 있다 → 소재지 첫 낱말 「부여군」", () => {
    expect(P.cn06.checks.sggFilled).toEqual([{ complex_no: expect.any(Number), sgg: "부여군", from: "소재지 첫 낱말" }]);
    expect(P.cn06.complexes.find((c) => c.complex_no === P.cn06.checks.sggFilled[0].complex_no)).toMatchObject({ total_units: 413, emd: "부여읍" });
  });
  it("G7① 면적대 총분양이 하나라도 빈 단지는 총분양 NULL(일부 합 금지) — 한경크리스탈 84㎡ 45 + 빈칸 2줄", () => {
    const h = byName(P.cn06, /한경크리스탈/)[0];
    expect(h.total_units).toBeNull();
    expect(P.cn06.rows.filter((r) => r.complex_no === h.complex_no).map((r) => r.total_units)).toEqual([45, null, null]);
  });
  it("G7② 미분양 > 총분양(원본 오기 · 공주 석남리 270-1 169/81 · 393-1 30/10) → checks 경고 · unsold_over_total", () => {
    expect(P.cn06.checks.unsoldOverTotal.map((x) => [x.unsold, x.total])).toEqual([[169, 81], [30, 10]]);
    expect(P.cn06.complexes.filter((c) => c.unsold_over_total)).toHaveLength(2);
  });
  it("G4 총괄표 시군구별 당월 미분양 「계」 — 시도 합계 줄은 뺀다", () => {
    expect(P.dg09.sggTotals).toMatchObject({ 중구: 641, 동구: 455, 서구: 48, 남구: 512, 북구: 688, 수성구: 503, 달서구: 1021, 달성군: 21 });
    expect(Object.keys(P.dg09.sggTotals)).not.toContain("대구");
    expect(P.cn06.sggTotals).toMatchObject({ 천안시: 3939, 공주시: 201, 당진시: 13 });
  });
  it("2월: 기준일 2026-02-28 · 행 수", () => {
    expect([P.cn02.asOf, P.cn02.rows.length, P.cn02.complexes.length, P.cn02.complexes.filter((c) => c.hidden).length]).toEqual(["2026-02-28", 234, 66, 40]);
  });
});

describe("머리줄이 바뀌면 GovlistParseError(→ GOVLIST_SKIP header)", () => {
  /** @param {(g: Grid[]) => void} f */
  const mutate = (f) => { const g = /** @type {Grid[]} */ (JSON.parse(JSON.stringify(grids.dg09))); f(g); return g; };
  it("총분양 머리 글자가 사라짐", () => {
    const g = mutate((x) => { for (const s of x) for (const row of s.cells) for (let i = 0; i < row.length; i++) if (typeof row[i] === "string" && /총분양/.test(String(row[i]))) row[i] = "세대"; });
    expect(() => parseGovlistWorkbook(g, { source: "daegu" })).toThrow(GovlistParseError);
  });
  it("시공사 칸이 사라짐", () => {
    const g = mutate((x) => { for (const s of x) for (const row of s.cells) for (let i = 0; i < row.length; i++) if (row[i] === "시공사") row[i] = "업체"; });
    expect(() => parseGovlistWorkbook(g, { source: "daegu" })).toThrow(/시공사|builder/);
  });
  it("G7④ 미분양 칸 머리에 「당해」도 기준월도 없으면 어느 칸이 당월인지 모른다 → 거부(첫 칸 = 전월을 집지 않음)", () => {
    const g = mutate((x) => { for (const s of x) for (const row of s.cells) for (let i = 0; i < row.length; i++) {
      if (typeof row[i] === "string" && /당해월/.test(String(row[i]))) row[i] = "이번";
      else if (typeof row[i] === "string" && /전월\s*\(/.test(String(row[i]))) row[i] = "지난";
    } });
    expect(() => parseGovlistWorkbook(g, { source: "daegu" })).toThrow(/당월을 못 정함/);
  });
  it("당해월 칸의 달이 제목 기준일과 다름", () => {
    const g = mutate((x) => { for (const s of x) for (const row of s.cells) for (let i = 0; i < row.length; i++) if (typeof row[i] === "string" && /당해월/.test(String(row[i]))) row[i] = "당해월\n('26.8월)"; });
    expect(() => parseGovlistWorkbook(g, { source: "daegu" })).toThrow(/기준월/);
  });
});

describe("작은 함수", () => {
  it("소재지 → 이름 후보·주소·비공개", () => {
    expect(parseLocation("두류동 638-19\n(두류 센트레빌 더파크)")).toEqual({ names: ["두류 센트레빌 더파크"], address: "두류동 638-19", hidden: false });
    expect(parseLocation("천안역 스카이움\n(서북구 성정동 209-1)\n(비공개 요청)")).toEqual({ names: ["천안역 스카이움"], address: "서북구 성정동 209-1", hidden: true });
    expect(parseLocation("[배방읍 북수리 1577 \n(배방 필하우스 리버시티)]\n(비공개 요청)")).toEqual({ names: ["배방 필하우스 리버시티"], address: "배방읍 북수리 1577", hidden: true });
    expect(parseLocation("서북구 백석동 658-69번지\n(비공개 요청)").names).toEqual([]);
    expect(parseLocation("용화동 480-3\n[용화줌파크]").names).toEqual(["용화줌파크"]);
  });
  it("지번 꼴", () => {
    for (const s of ["두류동 638-19", "삼덕동2가 5번지 일원", "탕정면 용두리 720", "유구읍 석남리 270-1"]) expect(isAddressLike(s)).toBe(true);
    for (const s of ["두류 센트레빌 더파크", "수청1지구 44B-1L", "월송지구 B-2BL", "e편한세상 금산센터하임"]) expect(isAddressLike(s)).toBe(false);
  });
  it("기준일·달·날짜 글자", () => {
    expect(parseAsOfText(" □ 2026년 9월말 단지별 미분양 현황")).toBe("2026-09-30");
    expect(parseAsOfText(" □ 업체별 현황 ('26. 6. 30. 기준)")).toBe("2026-06-30");
    expect(parseAsOfText("□ 현황")).toBeNull();
    expect(headerMonth("분양결과 / 미분양가구수 / 당해월('26.9월)")).toBe("2026-09");
    expect(headerMonth("분양결과 / 미분양가구수 / (26.5.31.)")).toBe("2026-05");
    expect(parseListDate("2016.5.9.")).toBe("2016-05-09");
    expect(parseListDate("2024. 11. 6.")).toBe("2024-11-06");
    expect(parseListDate("2015.01.00")).toBe("2015-01-01");
    expect(parseListDate("분양완료일까지")).toBeNull();
  });
  it("list_key — 공백·비공개 표기 차이를 무시", () => {
    expect(listKeyOf("chungnam", "천안시 서북구", "업성 푸르지오 레이크시티\n(업성3구역 A1BL)\n(비공개요청)"))
      .toBe(listKeyOf("chungnam", "천안시서북구", "업성 푸르지오 레이크시티 (업성3구역 A1BL) (비공개 요청)"));
  });
  it("xlsx 격자: 병합 딸린 칸은 null · 주인 칸에만 값 · 병합 범위는 따로", () => {
    const sheet = /** @type {Grid} */ (grids.dg09.find((g) => g.name === "업체별현황"));
    const r = sheet.cells.findIndex((row) => String(row[3] ?? "").includes("두류 센트레빌"));
    expect(sheet.cells[r][12]).toBe("건설사 요청으로\n비공개"); // M(전월) = 주인
    expect(sheet.cells[r][13]).toBeNull(); // N(당해월) = 가로 병합 딸린 칸
    expect(sheet.cells[r + 1][3]).toBeNull(); // 다음 면적대 줄의 소재지 = 세로 병합 딸린 칸
    expect(sheet.merges).toContainEqual({ r1: r, c1: 12, r2: r + 2, c2: 13 });
  });
  it("엑셀 셀 값 정규화", () => {
    expect(normalizeCell({ richText: [{ text: "가" }, { text: "나" }] })).toBe("가나");
    expect(normalizeCell({ formula: "SUM(A1)", result: 3 })).toBe(3);
    expect(normalizeCell(new Date(Date.UTC(2025, 1, 11)))).toBe("2025-02-11");
    expect(normalizeCell({ error: "#REF!" })).toBeNull();
  });
});
