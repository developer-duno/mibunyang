// @ts-check
/**
 * 지자체 단지별 미분양 명단 xlsx 의 「업체별 현황」 시트 → 원문 행(면적대 1줄 = 1행) + 단지 묶음. 설계서 §3-1·§5-⑦.
 *
 * 입력은 엑셀 라이브러리에서 뽑은 **격자**(`_govlist-xlsx.mjs` `workbookToGrids`)다 — 이 파일은 DB·네트워크·라이브러리를 보지 않는다.
 *
 * 규칙(세션687 실물 머리줄 직독 — 대구 2026-09 · 충남 2026-02·06):
 * - 칸 뜻은 **머리줄 글자로** 정한다(칸 순서·개수는 출처·달마다 다르다 — 충남은 지구명·택지종류 2칸이 더 있다).
 *   머리줄 = 「소재지」가 처음 나오는 줄부터, 총분양 칸이 숫자가 아닌 줄까지(대구·충남 모두 3줄). 병합된 머리 칸은 펼쳐서 이어 붙인다.
 * - 한 단지 = 면적대 줄 여러 개 + 「소 계」 줄. **원문 행 = 면적대 줄 하나**(경기 표와 같은 결) · 소계·합계 줄은 저장하지 않는다(파생값 —
 *   대신 소계의 총분양이 면적대 합과 같은지 대조해 `checks.subtotalMismatch` 에 남긴다).
 * - 병합 셀: 세로 병합은 아래 줄로 채운다(구군·읍면동·소재지·시공사…) · 가로 병합의 오른쪽 칸은 비운다(같은 값 두 번 금지)
 *   · **숫자 칸(총분양·미분양)의 세로 병합은 첫 줄에만**(한 단지 값이 면적대마다 겹쳐 세지지 않게).
 * - `raw` = 머리줄 글자 → 셀 값 전부(빈 칸만 빠짐 · 단지 공통 칸은 그 단지 첫 줄 값으로 채움).
 * - 비공개: 대구 = 미분양 칸 「건설사 요청으로 비공개」 · 충남 = 소재지 글자 안 「(비공개 요청)」(미분양 칸은 비고 **소계 줄엔 0 이 찍힌다**
 *   — 그래서 소계를 쓰지 않는다). 둘 중 하나라도 있으면 그 단지 전체 `hidden=true`·`unsold_units=null`.
 * - 소재지 글자에서 단지명·주소를 가른다: 괄호 `( )`·`[ ]` 안과 밖을 조각으로 나눠 지번 꼴은 주소, 나머지는 이름 후보(여럿일 수 있다 —
 *   매칭이 후보마다 비교한다). 이름이 없는 행도 있다(충남 「서북구 백석동 658-69번지 (비공개 요청)」).
 */

/** @typedef {string | number | null} CellValue */
/** @typedef {{ r1: number; c1: number; r2: number; c2: number }} Merge 0 기준·양끝 포함 */
/** @typedef {{ name: string; cells: CellValue[][]; merges: Merge[] }} Grid */
/**
 * @typedef {{ row_no: number; sheet_row: number; complex_no: number; raw: Record<string, CellValue>;
 *   sgg: string | null; emd: string | null; raw_name: string | null; name_candidates: string[]; address: string | null;
 *   builder: string | null; developer: string | null; is_public: boolean | null; is_rental: boolean | null;
 *   area_band: string | null; total_units: number | null; unsold_units: number | null; hidden: boolean; approval_date: string | null }} GovRow
 * @typedef {{ complex_no: number; list_key: string; sgg: string | null; emd: string | null; location: string | null; raw_name: string | null;
 *   name_candidates: string[]; address: string | null; builder: string | null; developer: string | null; is_public: boolean | null;
 *   is_rental: boolean | null; total_units: number; unsold_units: number | null; unsold_partial: boolean; hidden: boolean;
 *   approval_date: string | null; row_nos: number[] }} GovComplex
 * @typedef {{ sheet: string; asOf: string; titleText: string; columns: Array<{ key: string; col: number }>; currentUnsoldKey: string;
 *   rows: GovRow[]; complexes: GovComplex[]; sggUniverse: string[];
 *   checks: { subtotalMismatch: Array<{ complex_no: number; sheet_row: number; subtotal: number; sum: number }>;
 *     sectionMismatch: Array<{ sheet_row: number; total: number; sum: number }>; sggFilled: Array<{ complex_no: number; sgg: string; from: string }>;
 *     unlabeledRows: number[]; nonNumericUnsold: number[] } }} ParsedList
 */

/** 머리줄·서식이 기대와 다르다 — 수집기가 `GOVLIST_SKIP <source> header(...)` 로 기록하고 그 출처를 건너뛴다. */
export class GovlistParseError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = "GovlistParseError"; }
}

/** @param {unknown} v */
const text = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
/** 머리 칸 글자 — 공백·줄바꿈 전부 뺀다(「총분양\n가구수」 → 「총분양가구수」). @param {unknown} v */
const headText = (v) => (v == null ? "" : String(v).replace(/\s+/g, ""));

/** 시공사·시행사 글자 — 괄호 전화번호를 뗀다(「주식회사\n동부건설\n(02-3484-2397)」 → 「주식회사 동부건설」). raw 는 원문 그대로. @param {unknown} v */
const party = (v) => text(String(v ?? "").replace(/\(\s*0\d{1,3}\s*-\s*\d{3,4}\s*-\s*\d{4}\s*\)/g, " ")) || null;

/** @param {CellValue} v @returns {number | null} */
function toInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*-?\d+(?:,\d{3})*\s*$/.test(v)) return Number(v.replace(/[,\s]/g, ""));
  return null;
}

/**
 * 날짜 글자 → "YYYY-MM-DD". 「2025-02-11」·「2016.01.27」·「2016.5.9.」·「2024. 11. 6.」 · 일 00 은 1일로. 못 읽으면 null.
 * @param {CellValue} v
 * @returns {string | null}
 */
export function parseListDate(v) {
  const m = /(\d{4})\s*[-.]\s*(\d{1,2})\s*[-.]\s*(\d{1,2})/.exec(text(v));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  const d = Math.max(1, Number(m[3]));
  if (mo < 1 || mo > 12 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** @param {number} y @param {number} m 1~12 */
function monthEnd(y, m) {
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 시트 제목 줄의 기준일 → "YYYY-MM-DD".
 * 「□ 2026년 9월말 단지별 미분양 현황」 → 2026-09-30 · 「□ 업체별 현황 ('26. 6. 30. 기준)」 → 2026-06-30.
 * @param {string} title
 * @returns {string | null}
 */
export function parseAsOfText(title) {
  const t = text(title);
  let m = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*말/.exec(t);
  if (m) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? monthEnd(Number(m[1]), mo) : null;
  }
  m = /['`’‘]\s*(\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*기준/.exec(t) ?? /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*기준/.exec(t);
  if (m) {
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/**
 * 미분양 칸 머리 글자의 기준월 → "YYYY-MM". 「당해월('26.9월)」 → 2026-09 · 「(26.6.30)」 → 2026-06. 못 읽으면 null.
 * @param {string} key
 * @returns {string | null}
 */
export function headerMonth(key) {
  const m = /['`’‘]?(\d{2})\.(\d{1,2})(?:월|\.\d{1,2})/.exec(headText(key));
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `20${m[1]}-${String(mo).padStart(2, "0")}` : null;
}

/** 지번 꼴 조각인가(「두류동 638-19」·「삼덕동2가 5번지 일원」·「탕정면 용두리 720」). @param {string} p */
export function isAddressLike(p) {
  if (!/\d/.test(p)) return false;
  return /\d+\s*-\s*\d+/.test(p) || /\d+\s*번지/.test(p) || /(?:동|리|가|읍|면|로|길)\s*\d/.test(p) || /^\s*산?\d+(?:\s*일원)?\s*$/.test(p);
}

/**
 * 소재지 글자 → 이름 후보·주소·비공개 표시.
 * @param {CellValue} v
 * @returns {{ names: string[]; address: string | null; hidden: boolean }}
 */
export function parseLocation(v) {
  let s = String(v ?? "").replace(/\r/g, "");
  const hidden = /비\s*공\s*개/.test(s);
  /** @type {string[]} */ const pieces = [];
  // 가장 안쪽 괄호부터 떼어 낸다(「[배방읍 북수리 1577 (배방 필하우스 리버시티)]」).
  for (let i = 0; i < 10; i++) {
    let found = false;
    s = s.replace(/[(\[]([^()[\]]*)[)\]]/g, (_, inner) => { pieces.push(inner); found = true; return "\n"; });
    if (!found) break;
  }
  pieces.unshift(...s.split("\n"));
  const parts = pieces.map(text).filter((p) => p.length >= 2 && !/비\s*공\s*개/.test(p));
  /** @type {string[]} */ const names = [];
  /** @type {string | null} */ let address = null;
  for (const p of parts) {
    if (isAddressLike(p)) { if (address == null) address = p; } else if (!names.includes(p)) names.push(p);
  }
  // 괄호 안 이름(대구 꼴 「주소\n(단지명)」)이 바깥 조각보다 앞에 오게 — 바깥 첫 줄이 주소면 이미 빠졌다.
  return { names, address, hidden };
}

/** list_key — 달이 바뀌어도 같은 단지 줄을 같은 열쇠로(공백·비공개 표기 차이 무시). @param {string} source @param {string | null} sgg @param {string | null} loc */
export function listKeyOf(source, sgg, loc) {
  const l = String(loc ?? "").replace(/[(\[]\s*비\s*공\s*개[^)\]]*[)\]]/g, "").replace(/\s+/g, "");
  return `${source}|${String(sgg ?? "").replace(/\s+/g, "")}|${l}`;
}

/**
 * @param {Grid} grid
 * @returns {{ at: (r: number, c: number) => Merge | undefined }}
 */
function mergeIndex(grid) {
  /** @type {Map<string, Merge>} */ const m = new Map();
  for (const g of grid.merges) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) m.set(`${r},${c}`, g);
  return { at: (r, c) => m.get(`${r},${c}`) };
}

/** 「업체별 현황」 시트 고르기 — 위 10줄에 「소재지」와 「총분양」이 있는 첫 시트. @param {Grid[]} grids */
export function pickCompanySheet(grids) {
  return grids.find((g) => {
    const top = g.cells.slice(0, 10).flat().map(headText).join("|");
    return top.includes("소재지") && top.includes("총분양");
  }) ?? null;
}

/**
 * 「총괄표」 시트의 시군구 이름(명단 행이 0 인 시군구도 실려 있다 — 미등재→0 판정의 "그 시군구를 명단이 덮는가" 재료).
 * @param {Grid[]} grids
 * @returns {string[]}
 */
export function parseSggUniverse(grids) {
  const g = grids.find((x) => x.cells.slice(0, 4).flat().map(headText).join("|").includes("총괄"));
  if (!g) return [];
  /** @type {Set<string>} */ const out = new Set();
  for (const row of g.cells) {
    const t = text(row[0]);
    if (/^[가-힣]+(?:\s[가-힣]+)?[시군구]$/.test(t)) out.add(t);
  }
  return [...out];
}

/** 칸 역할 — 머리 글자 정규식. pubType 은 충남 「택지종류(민간/공공)」와 가른다. */
const ROLE = /** @type {const} */ ({
  sido: /시도/, sgg: /시군구/, emd: /읍면동/, loc: /소재지/, builder: /시공사/, developer: /시행사/,
  area: /규모/, total: /총분양/, approval: /분양승인/,
});
const REQUIRED = /** @type {const} */ (["sgg", "loc", "builder", "developer", "area", "total"]);

/**
 * @param {Grid[]} grids 통합 문서 전체(업체별 시트 + 총괄표)
 * @param {{ source: string }} opts
 * @returns {ParsedList}
 */
export function parseGovlistWorkbook(grids, { source }) {
  const grid = pickCompanySheet(grids);
  if (!grid) throw new GovlistParseError("업체별 현황 시트(소재지·총분양 머리줄) 없음");
  const { cells } = grid;
  const mi = mergeIndex(grid);
  const nCols = Math.max(0, ...cells.map((r) => r.length));
  /** @param {number} r @param {number} c */
  const own = (r, c) => cells[r]?.[c] ?? null;
  /** 병합이면 주인 칸 값. @param {number} r @param {number} c */
  const master = (r, c) => { const g = mi.at(r, c); return g ? own(g.r1, g.c1) : own(r, c); };

  // ── 머리줄 ──
  const r0 = cells.findIndex((row, r) => r < 15 && row.some((_, c) => headText(master(r, c)).includes("소재지")));
  if (r0 < 0) throw new GovlistParseError("머리줄(소재지) 없음");
  const totalCol = [...Array(nCols).keys()].find((c) => [0, 1, 2, 3].some((k) => headText(master(r0 + k, c)).includes("총분양")));
  if (totalCol == null) throw new GovlistParseError("머리줄(총분양) 없음");
  let headerEnd = r0;
  while (headerEnd + 1 < cells.length && headerEnd - r0 < 4 && toInt(master(headerEnd + 1, totalCol)) == null) headerEnd++;
  const dataStart = headerEnd + 1;

  const titleText = cells.slice(0, r0).flat().map(text).find((t) => t.length > 0) ?? "";
  const asOf = parseAsOfText(titleText);
  if (!asOf) throw new GovlistParseError(`제목 줄에서 기준일을 못 읽음: ${JSON.stringify(titleText)}`);

  /** 칸 c 의 머리 글자. @param {number} c */
  const keyOf = (c) => {
    /** @type {string[]} */ const parts = [];
    for (let r = r0; r <= headerEnd; r++) {
      const t = headText(master(r, c));
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    return parts.join(" / ");
  };

  /** 숫자 칸(세로 병합을 첫 줄에만) — 총분양·미분양. @type {Set<number>} */
  const countCols = new Set([totalCol]);
  for (let c = 0; c < nCols; c++) if (/미분양/.test(keyOf(c))) countCols.add(c);
  /** 데이터 칸 값: 가로 병합 오른쪽은 null · 세로 병합은 채움(숫자 칸은 첫 줄만). @param {number} r @param {number} c */
  const dataValue = (r, c) => {
    const g = mi.at(r, c);
    if (!g) return own(r, c);
    if (c !== g.c1) return null;
    if (r !== g.r1 && countCols.has(c)) return null;
    return own(g.r1, g.c1);
  };

  // ── 칸 고르기(빈 칸 버림 · 같은 글자는 #2) ──
  /** @type {Array<{ key: string; col: number }>} */ const columns = [];
  /** @type {Map<string, number>} */ const seenKey = new Map();
  for (let c = 0; c < nCols; c++) {
    let hasData = false;
    for (let r = dataStart; r < cells.length && !hasData; r++) if (dataValue(r, c) != null && text(dataValue(r, c)) !== "") hasData = true;
    if (!hasData) continue;
    let key = keyOf(c) || `칸${c + 1}`;
    const n = (seenKey.get(key) ?? 0) + 1;
    seenKey.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    columns.push({ key, col: c });
  }
  /** @param {RegExp} re @param {(k: string) => boolean} [extra] */
  const find = (re, extra = () => true) => columns.find((x) => re.test(x.key) && extra(x.key)) ?? null;
  const col = {
    sido: find(ROLE.sido), sgg: find(ROLE.sgg), emd: find(ROLE.emd), loc: find(ROLE.loc), builder: find(ROLE.builder),
    developer: find(ROLE.developer), area: find(ROLE.area), total: find(ROLE.total), approval: find(ROLE.approval),
    pubType: find(/민간\/공공/, (k) => !/택지/.test(k)), rentType: find(/임대\/분양/),
  };
  const missing = REQUIRED.filter((k) => !col[k]);
  if (!col.pubType) missing.push(/** @type {any} */ ("민간/공공"));
  if (!col.rentType) missing.push(/** @type {any} */ ("임대/분양"));
  if (missing.length) throw new GovlistParseError(`머리줄 칸 없음: ${missing.join(",")}`);

  // 미분양 칸: 「당해」가 있으면 그 칸, 없으면 머리 글자의 기준월이 가장 새 칸. 기준월이 asOf 와 달라야 하면 거부.
  const unsoldCols = columns.filter((x) => /미분양/.test(x.key) && !/총분양/.test(x.key));
  if (!unsoldCols.length) throw new GovlistParseError("머리줄 칸 없음: 미분양가구수");
  const cur = unsoldCols.find((x) => /당해/.test(x.key))
    ?? [...unsoldCols].sort((a, b) => String(headerMonth(b.key) ?? "").localeCompare(String(headerMonth(a.key) ?? "")))[0];
  const curMonth = headerMonth(cur.key);
  if (curMonth != null && curMonth !== asOf.slice(0, 7)) throw new GovlistParseError(`미분양 칸 기준월(${curMonth}) ≠ 제목 기준일(${asOf})`);

  /** 단지 공통 칸이 아닌 것(면적대마다 다른 칸). */
  const bandCols = new Set([col.area?.col, ...unsoldCols.map((x) => x.col), col.total?.col]);

  /** @type {GovRow[]} */ const rows = [];
  /** @type {GovComplex[]} */ const complexes = [];
  const checks = {
    subtotalMismatch: /** @type {ParsedList["checks"]["subtotalMismatch"]} */ ([]),
    sectionMismatch: /** @type {ParsedList["checks"]["sectionMismatch"]} */ ([]),
    sggFilled: /** @type {ParsedList["checks"]["sggFilled"]} */ ([]),
    unlabeledRows: /** @type {number[]} */ ([]), nonNumericUnsold: /** @type {number[]} */ ([]),
  };
  let sectionStart = 0;
  /**
   * 시군구 칸이 빈 단지 채우기(세션687 실측: 대구 9월 동구 구간 B53:B139 는 병합만 있고 글자가 없다 — 「동구」는 합계 줄
   * 「합 계(동구지역)」에만 · 충남 6월 부여 구간도 시군구 칸이 비고 소재지가 「부여군 부여읍 …」). 채운 근거는 checks.sggFilled 에.
   * 못 채우면 null 로 남긴다 — 그 출처의 미등재→0 은 계획이 통째로 끈다(_govlist-plan `d_list_sgg_missing`).
   * @param {GovComplex[]} cxs @param {string | null} fromTotal
   */
  const fillMissingSgg = (cxs, fromTotal) => {
    for (const c of cxs) {
      if (c.sgg) continue;
      const fromLoc = String(c.location ?? "").trim().split(/\s+/)[0];
      const sgg = fromTotal ?? (/^[가-힣]{1,6}[시군구]$/.test(fromLoc) ? fromLoc : null);
      if (!sgg) continue;
      c.sgg = sgg;
      c.list_key = listKeyOf(source, sgg, c.location);
      for (const row of rows) if (row.complex_no === c.complex_no) row.sgg = sgg;
      checks.sggFilled.push({ complex_no: c.complex_no, sgg, from: fromTotal ? "합계 줄" : "소재지 첫 낱말" });
    }
  };
  /** @type {Record<string, CellValue>} */ let carry = {}; // 시도·시군구 — 단지를 넘어 이어진다(합계 줄에서 끊음)
  /** @type {{ cx: GovComplex; base: Record<string, CellValue>; bands: GovRow[]; hiddenMark: boolean } | null} */ let open = null;

  const close = () => {
    if (!open) return;
    const { cx, bands } = open;
    const hidden = open.hiddenMark;
    const nums = bands.map((b) => b.unsold_units);
    cx.hidden = hidden;
    cx.total_units = bands.reduce((s, b) => s + (b.total_units ?? 0), 0);
    cx.unsold_partial = !hidden && nums.some((n) => n == null) && nums.some((n) => n != null);
    cx.unsold_units = hidden || nums.some((n) => n == null) ? null : nums.reduce((/** @type {number} */ s, n) => s + Number(n), 0);
    for (const b of bands) { b.hidden = hidden; if (hidden) b.unsold_units = null; }
    if (bands.length) complexes.push(cx);
    open = null;
  };

  for (let r = dataStart; r < cells.length; r++) {
    const vals = columns.map(({ col: c }) => dataValue(r, c));
    if (vals.every((v) => v == null || text(v) === "")) continue;
    const labels = [...Array(nCols).keys()].map((c) => text(own(r, c)));
    const totalLabel = labels.find((t) => /^(?:소|합|총)\s*계/.test(t));
    if (totalLabel) {
      if (/^소\s*계/.test(totalLabel) && open) {
        const st = toInt(dataValue(r, totalCol));
        const sum = open.bands.reduce((s, b) => s + (b.total_units ?? 0), 0);
        if (st != null && st !== sum) checks.subtotalMismatch.push({ complex_no: open.cx.complex_no, sheet_row: r + 1, subtotal: st, sum });
      }
      close();
      if (!/^소\s*계/.test(totalLabel)) {
        // 합계 줄 = 그 시군구 구간의 총분양 합 — 단지를 빠뜨리거나 두 번 세면 여기서 어긋난다(파서 자기 검증).
        const st = toInt(dataValue(r, totalCol));
        const sum = complexes.slice(sectionStart).reduce((s, c) => s + c.total_units, 0);
        if (st != null && st !== sum) checks.sectionMismatch.push({ sheet_row: r + 1, total: st, sum });
        fillMissingSgg(complexes.slice(sectionStart), /\(\s*([가-힣]+)\s*지역\s*\)/.exec(totalLabel)?.[1] ?? null);
        sectionStart = complexes.length;
        carry = {};
      }
      continue;
    }
    for (const k of ["sido", "sgg"]) {
      const c = col[/** @type {"sido" | "sgg"} */ (k)];
      if (c && dataValue(r, c.col) != null && text(dataValue(r, c.col)) !== "") carry[c.key] = dataValue(r, c.col);
    }
    const locCell = col.loc ? mi.at(r, col.loc.col) : undefined;
    const startsComplex = col.loc != null && own(locCell ? locCell.r1 : r, col.loc.col) != null && (!locCell || locCell.r1 === r);
    const area = col.area ? dataValue(r, col.area.col) : null;
    if (area == null || text(area) === "") {
      if (startsComplex || vals.some((v, i) => bandCols.has(columns[i].col) && v != null)) checks.unlabeledRows.push(r + 1);
      continue;
    }
    if (startsComplex || !open) {
      close();
      /** @type {Record<string, CellValue>} */ const base = { ...carry };
      columns.forEach(({ key, col: c }, i) => { if (!bandCols.has(c) && vals[i] != null && text(vals[i]) !== "") base[key] = vals[i]; });
      const loc = col.loc ? base[col.loc.key] ?? null : null;
      const parsed = parseLocation(loc);
      const sgg = col.sgg ? text(base[col.sgg.key]) || null : null;
      const pub = col.pubType ? text(base[col.pubType.key]) : "";
      const rent = col.rentType ? text(base[col.rentType.key]) : "";
      open = {
        base, bands: [], hiddenMark: parsed.hidden,
        cx: {
          complex_no: complexes.length + 1, list_key: listKeyOf(source, sgg, /** @type {string | null} */ (loc)),
          sgg, emd: col.emd ? text(base[col.emd.key]) || null : null, location: loc == null ? null : String(loc),
          raw_name: parsed.names[0] ?? null, name_candidates: parsed.names, address: parsed.address,
          builder: col.builder ? party(base[col.builder.key]) : null, developer: col.developer ? party(base[col.developer.key]) : null,
          is_public: pub ? pub === "공공" : null, is_rental: rent ? rent === "임대" : null,
          total_units: 0, unsold_units: null, unsold_partial: false, hidden: false, // 비공개 판정은 hiddenMark 한 길로만(닫을 때 정함)
          approval_date: col.approval ? parseListDate(base[col.approval.key] ?? null) : null, row_nos: [],
        },
      };
    }
    const o = /** @type {NonNullable<typeof open>} */ (open);
    /** @type {Record<string, CellValue>} */ const raw = { ...o.base };
    columns.forEach(({ key, col: c }, i) => { if (bandCols.has(c) && vals[i] != null && text(vals[i]) !== "") raw[key] = vals[i]; });
    const curVal = raw[cur.key] ?? null;
    // 대구는 「건설사 요청으로 비공개」가 전월·당월 두 칸에 **가로 병합**이라 글자가 전월 칸에만 있다 → 미분양 칸 전부를 본다.
    if (unsoldCols.some((x) => /비\s*공\s*개/.test(text(raw[x.key])))) o.hiddenMark = true;
    const unsoldNum = toInt(curVal);
    if (curVal != null && unsoldNum == null && !/비\s*공\s*개/.test(text(curVal))) checks.nonNumericUnsold.push(r + 1);
    /** @type {GovRow} */
    const row = {
      row_no: rows.length + 1, sheet_row: r + 1, complex_no: o.cx.complex_no, raw,
      sgg: o.cx.sgg, emd: o.cx.emd, raw_name: o.cx.raw_name, name_candidates: o.cx.name_candidates, address: o.cx.address,
      builder: o.cx.builder, developer: o.cx.developer, is_public: o.cx.is_public, is_rental: o.cx.is_rental,
      area_band: text(area) || null, total_units: col.total ? toInt(raw[col.total.key] ?? null) : null, unsold_units: unsoldNum,
      hidden: false, approval_date: o.cx.approval_date,
    };
    rows.push(row);
    o.bands.push(row);
    o.cx.row_nos.push(row.row_no);
  }
  close();
  fillMissingSgg(complexes.slice(sectionStart), null); // 마지막 구간(합계 줄 없음)
  return { sheet: grid.name, asOf, titleText, columns, currentUnsoldKey: cur.key, rows, complexes, sggUniverse: parseSggUniverse(grids), checks };
}
