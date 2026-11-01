// @ts-check
/**
 * xlsx(Buffer) → 격자(`_govlist-parse.mjs` 의 Grid[]). 라이브러리 = exceljs(MIT · 설계서 §5-⑦).
 *
 * ⚠️ zip 을 직접 풀어 읽지 않는다 — 지자체 xlsx 는 sharedStrings 순번이 어긋나 보이는 함정이 있었다(세션685 함정 ③).
 * 병합 칸: exceljs 는 병합된 **딸린 칸**에도 주인 값을 돌려주므로, 딸린 칸은 null 로 두고 병합 범위를 따로 넘긴다
 * (어느 칸을 채울지는 파서가 정한다 — 세로 병합 채움 · 가로 병합 오른쪽 비움).
 */
import ExcelJS from "exceljs";

/** @typedef {import("./_govlist-parse.mjs").Grid} Grid */
/** @typedef {import("./_govlist-parse.mjs").CellValue} CellValue */

/** "A1" → {r, c}(0 기준). @param {string} a */
function addr(a) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(a.trim());
  if (!m) throw new Error(`셀 주소 형식 불량: ${a}`);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

/**
 * exceljs 셀 값 → 글자·숫자·날짜("YYYY-MM-DD")·null.
 * @param {unknown} v
 * @returns {CellValue}
 */
export function normalizeCell(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = /** @type {Record<string, any>} */ (v);
    if (Array.isArray(o.richText)) return o.richText.map((t) => String(t?.text ?? "")).join("");
    if ("result" in o) return normalizeCell(o.result);
    if ("formula" in o || "sharedFormula" in o) return null;
    if ("text" in o) return normalizeCell(o.text);
    if ("error" in o) return null;
  }
  return String(v);
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<Grid[]>}
 */
export async function workbookToGrids(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(/** @type {any} */ (buffer));
  /** @type {Grid[]} */ const out = [];
  for (const ws of wb.worksheets) {
    const nRows = ws.rowCount, nCols = ws.columnCount;
    /** @type {CellValue[][]} */ const cells = [];
    for (let r = 1; r <= nRows; r++) {
      /** @type {CellValue[]} */ const row = [];
      for (let c = 1; c <= nCols; c++) {
        const cell = ws.getCell(r, c);
        const slave = cell.isMerged && cell.master && cell.master.address !== cell.address;
        row.push(slave ? null : normalizeCell(cell.value));
      }
      cells.push(row);
    }
    const rawMerges = /** @type {any} */ (ws.model)?.merges ?? [];
    const merges = rawMerges.map((/** @type {any} */ m) => {
      const s = typeof m === "string" ? m : String(m?.range ?? m);
      const [a, b] = s.split(":");
      const p = addr(a), q = addr(b ?? a);
      return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
    });
    out.push({ name: ws.name, cells, merges });
  }
  return out;
}
