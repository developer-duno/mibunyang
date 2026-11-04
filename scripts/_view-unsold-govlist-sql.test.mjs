// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { GOVLIST_EXPIRY_MONTHS, APPLYHOME_EXPIRY_MONTHS } from "./collectors/_shared.mjs";

// 세션687 PR-1 — 새 VIEW 마이그(20261102000002)가 직전 VIEW(20261031000000) 본문에서 바뀐 자리 3곳만 다른지 잠그고,
// 묶음 미분양 순위(bundle_unsold)를 **SQL 글자 그대로** 작은 해석기로 돌려 규칙을 시험한다(이 레포엔 시험용 DB 가 없다 —
// JS 쌍둥이를 따로 쓰면 SQL 이 바뀌어도 쌍둥이만 초록이 된다. 해석기는 이 CTE 가 쓰는 SQL 조각만 안다 — 모르는 글자를 만나면 던진다).
// 이 PC 의 마이그 파일은 CRLF(autocrlf) — 줄바꿈을 LF 로 맞춰 읽는다.
const readLf = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BASE_NAME = "20261031000000_view_card_builder.sql";
const NEW_NAME = "20261102000002_view_unsold_govlist.sql";
const base = readLf(`../supabase/migrations/${BASE_NAME}`);
const sql = readLf(`../supabase/migrations/${NEW_NAME}`);
const table = readLf("../supabase/migrations/20261102000000_unsold_gov_list.sql");
const rollback = readLf("../supabase/migrations/_rollbacks/20261102000003_rollback_view_unsold_govlist.sql");
const tableRollback = readLf("../supabase/migrations/_rollbacks/20261102000001_rollback_unsold_gov_list.sql");
/** 주석(-- …)을 걷어낸 본문 — 글자 가드가 주석 속 예시에 맞아 통과하지 않게 */
const code = (/** @type {string} */ s) => s.replace(/--[^\n]*/g, "");
const END = ") pso ON pso.bkey = a.bkey;";
/** VIEW 본문을 주석 걷고 줄 단위로 — 빈 줄은 뺀다 */
function viewLines(/** @type {string} */ s, head = "CREATE OR REPLACE VIEW apartments_flat") {
  const start = s.indexOf(head);
  const end = s.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error("VIEW 본문 앵커를 못 찾음");
  return code(s.slice(start + head.length, end + END.length)).split("\n").map((l) => l.trim()).filter(Boolean);
}
/** bundle_unsold CTE 글자(머리 ~ 다음 CTE 앞) */
function cteText(/** @type {string} */ s) {
  const a = s.indexOf("bundle_unsold AS (");
  const b = s.indexOf("\nbundle_ah AS (", a);
  if (a < 0 || b < 0) throw new Error("bundle_unsold 앵커 없음");
  return s.slice(a, b);
}
/** @param {string} s @param {string} old @param {string} neu */
function once(s, old, neu) {
  expect(s.split(old).length - 1, `앵커 1회: ${old.slice(0, 60)}`).toBe(1);
  return s.replace(old, () => neu);
}
/** SELECT 출력 칸 이름(순서대로) — _view-card-builder-sql.test.mjs selectCols 와 같은 규칙 */
function selectCols(/** @type {string} */ s) {
  const start = s.lastIndexOf("\nSELECT\n"), end = s.indexOf("\nFROM deduped a", start);
  /** @type {string[]} */
  const out = [];
  for (const raw of s.slice(start, end).split("\n")) {
    const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
    if (!line || line === "SELECT") continue;
    const as = /\s+AS\s+"?(\w+)"?$/.exec(line);
    if (as) { out.push(as[1]); continue; }
    for (const bare of line.split(",").map((t) => t.trim()).filter(Boolean)) {
      const m = /^[a-z]+\.(\w+)$/.exec(bare);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 작은 SQL 해석기 — bundle_unsold 가 쓰는 조각만(CASE·AND/OR/NOT·비교·IS [NOT] NULL·COALESCE·EXISTS(SELECT 1 FROM members g WHERE …)·
// date + INTERVAL 'N months'·(now() AT TIME ZONE …)::date·정수 * ·COLLATE "C"). SQL 3값 논리(NULL)를 그대로 따른다.
// ─────────────────────────────────────────────────────────────────────────────
/** @typedef {{ t: "id"|"num"|"str"|"qid"|"op", v: string }} Tok */
/** @param {string} s @returns {Tok[]} */
function tokenize(s) {
  /** @type {Tok[]} */
  const out = [];
  const re = /\s+|('(?:[^']|'')*')|("(?:[^"])*")|(\d+)|([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)|(::|>=|<=|<>|[=<>*+(),])/gy;
  let m;
  while (re.lastIndex < s.length) {
    const at = re.lastIndex;
    m = re.exec(s);
    if (!m || m.index !== at) throw new Error(`해석기: 모르는 글자 ${JSON.stringify(s.slice(at, at + 20))}`);
    if (m[1]) out.push({ t: "str", v: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2]) out.push({ t: "qid", v: m[2].slice(1, -1) });
    else if (m[3]) out.push({ t: "num", v: m[3] });
    else if (m[4]) out.push({ t: "id", v: m[4] });
    else if (m[5]) out.push({ t: "op", v: m[5] });
  }
  return out;
}
/** 날짜 'YYYY-MM-DD' + n 개월 — Postgres 처럼 그 달에 없는 날은 말일로 */
function addMonths(/** @type {string} */ d, /** @type {number} */ n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`해석기: 날짜 형식 ${d}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(total / 12), mo = (total % 12) + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), last);
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** @param {Tok[]} toks */
function parser(toks) {
  let i = 0;
  const peek = (k = 0) => toks[i + k];
  const isKw = (/** @type {string} */ w, k = 0) => peek(k)?.t === "id" && peek(k).v.toUpperCase() === w;
  const isOp = (/** @type {string} */ w) => peek()?.t === "op" && peek().v === w;
  const expectKw = (/** @type {string} */ w) => { if (!isKw(w)) throw new Error(`해석기: ${w} 기대, ${JSON.stringify(peek())}`); i++; };
  const expectOp = (/** @type {string} */ w) => { if (!isOp(w)) throw new Error(`해석기: '${w}' 기대, ${JSON.stringify(peek())}`); i++; };
  /** @typedef {(ctx: any) => any} Ev */
  /** @returns {Ev} */
  function orE() {
    let l = andE();
    while (isKw("OR")) { i++; const a = l, b = andE(); l = (c) => { const x = a(c), y = b(c); return x === true || y === true ? true : x === null || y === null ? null : false; }; }
    return l;
  }
  /** @returns {Ev} */
  function andE() {
    let l = notE();
    while (isKw("AND")) { i++; const a = l, b = notE(); l = (c) => { const x = a(c), y = b(c); return x === false || y === false ? false : x === null || y === null ? null : true; }; }
    return l;
  }
  /** @returns {Ev} */
  function notE() {
    if (isKw("NOT")) { i++; const a = notE(); return (c) => { const x = a(c); return x === null ? null : !x; }; }
    return cmpE();
  }
  /** @returns {Ev} */
  function cmpE() {
    const l = addE();
    if (isKw("IS")) {
      i++;
      const neg = isKw("NOT") ? (i++, true) : false;
      expectKw("NULL");
      return (c) => (l(c) === null) !== neg;
    }
    if (peek()?.t === "op" && ["=", ">=", "<=", "<>", "<", ">"].includes(peek().v)) {
      const op = peek().v; i++;
      const r = addE();
      return (c) => {
        const x = l(c), y = r(c);
        if (x === null || y === null) return null;
        if (typeof x !== typeof y) throw new Error(`해석기: 형이 다른 비교 ${typeof x} ${op} ${typeof y}`);
        switch (op) { case "=": return x === y; case "<>": return x !== y; case ">=": return x >= y; case "<=": return x <= y; case ">": return x > y; default: return x < y; }
      };
    }
    return l;
  }
  /** @returns {Ev} */
  function addE() {
    let l = mulE();
    while (isOp("+")) {
      i++;
      const a = l, b = mulE();
      l = (c) => {
        const x = a(c), y = b(c);
        if (x === null || y === null) return null;
        if (typeof y === "object" && y.months != null) return addMonths(x, y.months);
        if (typeof x === "number" && typeof y === "number") return x + y;
        throw new Error("해석기: 모르는 + 형");
      };
    }
    return l;
  }
  /** @returns {Ev} */
  function mulE() {
    let l = postE();
    while (isOp("*")) { i++; const a = l, b = postE(); l = (c) => { const x = a(c), y = b(c); return x === null || y === null ? null : x * y; }; }
    return l;
  }
  /** @returns {Ev} */
  function postE() {
    let p = primE();
    while (isOp("::")) { i++; if (peek()?.t !== "id") throw new Error("해석기: :: 뒤 형 이름"); i++; }   // ::date — 값은 이미 날짜 글자
    return p;
  }
  /** @returns {Ev} */
  function primE() {
    const tk = peek();
    if (!tk) throw new Error("해석기: 식이 끝남");
    if (tk.t === "num") { i++; const n = Number(tk.v); return () => n; }
    if (tk.t === "str") { i++; const s = tk.v; return () => s; }
    if (isOp("(")) { i++; const e = orE(); expectOp(")"); return e; }
    if (isKw("CASE")) {
      i++;
      /** @type {Array<[Ev, Ev]>} */
      const arms = [];
      while (isKw("WHEN")) { i++; const w = orE(); expectKw("THEN"); arms.push([w, orE()]); }
      let els = /** @type {Ev} */ (() => null);
      if (isKw("ELSE")) { i++; els = orE(); }
      expectKw("END");
      return (c) => { for (const [w, v] of arms) if (w(c) === true) return v(c); return els(c); };
    }
    if (isKw("INTERVAL")) {
      i++;
      const s = peek(); if (s?.t !== "str") throw new Error("해석기: INTERVAL 글자");
      i++;
      const m = /^(\d+) months?$/.exec(s.v); if (!m) throw new Error(`해석기: INTERVAL ${s.v}`);
      const months = Number(m[1]);
      return () => ({ months });
    }
    if (isKw("NULL")) { i++; return () => null; }
    if (isKw("TRUE")) { i++; return () => true; }
    if (isKw("FALSE")) { i++; return () => false; }
    if (isKw("COALESCE")) {
      i++; expectOp("(");
      const args = [orE()];
      while (isOp(",")) { i++; args.push(orE()); }
      expectOp(")");
      return (c) => { for (const a of args) { const v = a(c); if (v !== null) return v; } return null; };
    }
    if (isKw("NOW")) {
      i++; expectOp("("); expectOp(")"); expectKw("AT"); expectKw("TIME"); expectKw("ZONE");
      if (peek()?.t !== "str" || peek().v !== "Asia/Seoul") throw new Error("해석기: 시간대");
      i++;
      return (c) => c.today;
    }
    if (isKw("EXISTS")) {
      i++; expectOp("("); expectKw("SELECT");
      if (peek()?.t !== "num") throw new Error("해석기: SELECT 1"); i++;
      expectKw("FROM");
      if (!isKw("MEMBERS")) throw new Error("해석기: EXISTS 는 members 만"); i++;
      const alias = peek(); if (alias?.t !== "id") throw new Error("해석기: 별칭"); i++;
      expectKw("WHERE");
      const w = orE();
      expectOp(")");
      return (c) => c.members.some((/** @type {any} */ g) => w({ ...c, [alias.v]: g }) === true);
    }
    if (tk.t === "id" && tk.v.includes(".")) {
      i++;
      const [al, col] = tk.v.split(".");
      return (c) => {
        const row = c[al];
        if (!row) throw new Error(`해석기: 별칭 ${al} 없음`);
        const v = row[col];
        return v === undefined ? null : v;
      };
    }
    throw new Error(`해석기: 모르는 식 ${JSON.stringify(tk)}`);
  }
  /** ORDER BY 항목들 */
  function orderItems() {
    /** @type {Array<{ ev: Ev, desc: boolean, nullsFirst: boolean }>} */
    const items = [];
    for (;;) {
      const ev = orE();
      if (isKw("COLLATE")) { i++; if (peek()?.t !== "qid" || peek().v !== "C") throw new Error("해석기: COLLATE C 만"); i++; }
      let desc = false;
      if (isKw("ASC")) i++; else if (isKw("DESC")) { i++; desc = true; }
      let nullsFirst = desc;   // Postgres 기본: ASC = NULLS LAST, DESC = NULLS FIRST
      if (isKw("NULLS")) { i++; if (isKw("FIRST")) { nullsFirst = true; i++; } else { expectKw("LAST"); nullsFirst = false; } }
      items.push({ ev, desc, nullsFirst });
      if (isOp(",")) { i++; continue; }
      break;
    }
    if (i !== toks.length) throw new Error(`해석기: ORDER BY 뒤 남은 글자 ${JSON.stringify(peek())}`);
    return items;
  }
  /** SELECT 목록(식 AS 이름, …) */
  function selectItems() {
    /** @type {Record<string, Ev>} */
    const out = {};
    for (;;) {
      const ev = orE();
      let name;
      if (isKw("AS")) { i++; name = peek().v; i++; } else name = "?";
      out[name] = ev;
      if (isOp(",")) { i++; continue; }
      break;
    }
    if (i !== toks.length) throw new Error(`해석기: SELECT 뒤 남은 글자 ${JSON.stringify(peek())}`);
    return out;
  }
  return { orderItems, selectItems };
}
/** bundle_unsold 를 해석기로 만든다 — (묶음 구성원, 재료 행 id, 오늘) → 이긴 행의 SELECT 값 */
function compileBundleUnsold(/** @type {string} */ fileText) {
  const cte = code(cteText(fileText));
  const m = /SELECT DISTINCT ON \(m\.bkey\)([\s\S]*?)FROM members m JOIN bundle_mat bm ON bm\.bkey = m\.bkey\s+ORDER BY([\s\S]*)\n\)/.exec(cte);
  if (!m) throw new Error("bundle_unsold 꼴이 바뀜 — 해석기 앵커");
  const sel = parser(tokenize(m[1])).selectItems();
  const ord = parser(tokenize(m[2])).orderItems();
  /**
   * @param {Array<Record<string, any>>} members 한 묶음(bkey 같음)
   * @param {string} matId 재료 행 id
   * @param {string} today 'YYYY-MM-DD'(KST)
   */
  return (members, matId, today) => {
    const rows = members.map((r) => /** @type {Record<string, any>} */ ({ is_off: false, bkey: "B", competition_supply: null, unsold_listed_total: null, unsold_listed_as_of: null, unsold_as_of: null, unsold_source: null, unsold: null, ...r }));
    const ctxOf = (/** @type {any} */ r) => ({ m: r, bm: { bkey: r.bkey, mat_id: matId }, members: rows, today });
    const keyed = rows.map((r) => ({ r, k: ord.map((o) => o.ev(ctxOf(r))) }));
    keyed.sort((A, B) => {
      for (let j = 0; j < ord.length; j++) {
        const { desc, nullsFirst } = ord[j];
        const x = A.k[j], y = B.k[j];
        if (x === y) continue;
        if (x === null) return nullsFirst ? -1 : 1;
        if (y === null) return nullsFirst ? 1 : -1;
        const cmp = x < y ? -1 : 1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
    const win = keyed[0].r;
    /** @type {Record<string, any>} */
    const out = { id: win.id };
    for (const [name, ev] of Object.entries(sel)) out[name] = ev(ctxOf(win));
    return out;
  };
}

const TODAY = "2026-11-02";
const pickNew = compileBundleUnsold(sql);
const pickBase = compileBundleUnsold(base);

// ─────────────────────────────────────────────────────────────────────────────
describe("20261102000002 VIEW 마이그 — 직전 VIEW 대비 바뀐 자리 3곳만 (세션687 PR-1)", () => {
  it("본문(주석 제거) = 20261031000000 본문 + bundle_unsold 교체 · deduped 두 값 · 끝 새 칸 3 — 그 밖은 한 글자도 다르지 않다", () => {
    let s = base;
    s = once(s, cteText(base), cteText(sql));
    s = once(s, "    bu.b_units, bun.b_unsold, bun.b_unsold_source,\n", "    bu.b_units, bun.b_unsold, bun.b_unsold_source, bun.b_listed_hidden, bun.b_listed_as_of,\n");
    s = once(s, `  ts.complex_jeonse_max AS "complexJeonseMax"\nFROM deduped a\n`,
      `  ts.complex_jeonse_max AS "complexJeonseMax",\n  a.b_unsold_source AS "unsoldSource",\n  COALESCE(a.b_listed_hidden, false) AS "unsoldListedHidden",\n  a.b_listed_as_of AS "unsoldListedAsOf"\nFROM deduped a\n`);
    const now = viewLines(sql);
    expect(now.length).toBeGreaterThan(250); // 추출기가 실제로 세고 있다
    expect(now).toEqual(viewLines(s));
    expect(cteText(sql)).not.toEqual(cteText(base)); // 교체가 실제로 일어났다
  });
  it("출력 칸 187개 = 직전 184칸 그대로 + 끝 새 칸 3(이름·순서 — 42P16 방지)", () => {
    const before = selectCols(base), after = selectCols(sql);
    expect(before).toHaveLength(184);
    expect(after).toHaveLength(187);
    expect(after.slice(0, 184)).toEqual(before);
    expect(after.slice(184)).toEqual(["unsoldSource", "unsoldListedHidden", "unsoldListedAsOf"]);
  });
  it("security_invoker 를 CREATE 에 직접 명시 · DROP 없음 · 마지막은 NOTIFY pgrst · 다음 판(20261104000000) 바로 앞 view 마이그", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    expect(code(sql)).not.toMatch(/DROP\s+VIEW/i);
    expect(sql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
    const views = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql") && f.includes("view") && !f.includes("rollback")).sort();
    // 세션697: 가장 새 판은 FUTURE_NAME(아래 「20261104000000」 묶음이 잠금) — 이 판은 그 직전
    expect(views[views.length - 2]).toBe(NEW_NAME);
    // 칸 마이그가 VIEW 마이그보다 앞 번호(적용 순서 — VIEW 가 새 칸을 읽는다)
    expect("20261102000000_unsold_gov_list.sql" < NEW_NAME).toBe(true);
  });
});

describe("만료 상수 맞대기 — VIEW 의 6개월 = _shared.mjs 상수", () => {
  const cte = code(cteText(sql));
  it("govlist 조건마다 붙은 INTERVAL 'N months' 의 N = GOVLIST_EXPIRY_MONTHS(세 자리 이상: 비공개 표시·순위 0·EXISTS)", () => {
    const ns = [...cte.matchAll(/unsold_source = 'govlist'[^']*?INTERVAL '(\d+) months'/g)].map((m) => Number(m[1]));
    expect(ns.length).toBeGreaterThanOrEqual(3);
    for (const n of ns) expect(n).toBe(GOVLIST_EXPIRY_MONTHS);
    expect(GOVLIST_EXPIRY_MONTHS).toBe(6); // 👤 Q2 「6개월」 — 리터럴로 못 박는다(상수와 VIEW 가 같이 밀리면 위 단언은 초록)
  });
  it("applyhome 조건의 INTERVAL = APPLYHOME_EXPIRY_MONTHS(두 출처가 한 식을 같이 쓰는 자리는 둘이 같을 때만 성립)", () => {
    const ns = [...cte.matchAll(/unsold_source = 'applyhome'[^']*?INTERVAL '(\d+) months'/g)].map((m) => Number(m[1]));
    expect(ns.length).toBeGreaterThanOrEqual(2);
    for (const n of ns) expect(n).toBe(APPLYHOME_EXPIRY_MONTHS);
  });
});

describe("bundle_unsold 순위 — SQL 글자를 해석기로 돌린다", () => {
  // 두류형(세션685 실측 꼴): KOSIS 165 · 조합원 취소분 1세대 재공급 공고 0(청약홈, 공급 1) · 대구 9월말 명단 비공개(총분양 52)
  const duryu = [
    { id: "ah-2025910146", unsold: 165, unsold_source: "kosis" },
    { id: "ah-2025910254", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: 1 },
    { id: "ap-9001", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", unsold_listed_total: 52 },
  ];
  it("양성 대조군: 해석기가 직전 VIEW 의 규칙을 그대로 재현한다(청약홈 유효 0 이 kosis 를 이김 · 만료 청약홈은 값 있음 1순위)", () => {
    const r1 = pickBase([{ id: "a", unsold: 165, unsold_source: "kosis" }, { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15" }], "a", TODAY);
    expect(r1).toMatchObject({ id: "b", b_unsold: 0, b_unsold_source: "applyhome" });
    const r2 = pickBase([{ id: "a", unsold: 165, unsold_source: "kosis" }, { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-04-01" }], "a", TODAY);
    expect(r2.id).toBe("a"); // 만료(4/01 + 6개월 < 11/02) — 재료 행 동점 규칙
  });
  it("두류형: 명단 비공개가 kosis 165 와 재공급 1세대 공고의 0 을 이긴다 → 값 NULL · 출처 govlist · 비공개 true · 기준월", () => {
    const r = pickNew(duryu, "ah-2025910146", TODAY);
    expect(r).toMatchObject({ id: "ap-9001", b_unsold: null, b_unsold_source: "govlist", b_listed_hidden: true, b_listed_as_of: "2026-09-30" });
    // 직전 VIEW 라면 거짓 0 이 이겼다(이 시험이 무엇을 막는지)
    expect(pickBase(duryu, "ah-2025910146", TODAY)).toMatchObject({ id: "ah-2025910254", b_unsold: 0 });
  });
  describe("청약홈 값이 명단 비공개를 이기는 경계 — 공급 × 2 ≥ 명단 총분양 · 기준일 같거나 새로움", () => {
    const pair = (/** @type {Record<string, any>} */ ah, total = /** @type {number|null} */ (52)) => [
      { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", unsold_listed_total: total },
      { id: "h", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", ...ah },
    ];
    it("총분양 52: 공급 26(50%) → 청약홈 이김 · 공급 25(48%) → 명단 비공개", () => {
      expect(pickNew(pair({ competition_supply: 26 }), "g", TODAY).id).toBe("h");
      expect(pickNew(pair({ competition_supply: 25 }), "g", TODAY).id).toBe("g");
    });
    it("총분양 51: 공급 26(51%) → 청약홈 · 공급 25(49%) → 명단 비공개(정수 경계)", () => {
      expect(pickNew(pair({ competition_supply: 26 }, 51), "g", TODAY).id).toBe("h");
      expect(pickNew(pair({ competition_supply: 25 }, 51), "g", TODAY).id).toBe("g");
    });
    it("명단 총분양 NULL → 공급이 아무리 커도 청약홈이 못 이긴다(보수 쪽)", () => {
      expect(pickNew(pair({ competition_supply: 1000 }, null), "g", TODAY).id).toBe("g");
    });
    it("competition_supply 가 없으면 unsold 로 잰다(30 ≥ 26 → 청약홈 · 10 → 명단)", () => {
      expect(pickNew(pair({ competition_supply: null, unsold: 30 }), "g", TODAY).id).toBe("h");
      expect(pickNew(pair({ competition_supply: null, unsold: 10 }), "g", TODAY).id).toBe("g");
    });
    it("청약홈 공고일이 명단 기준월보다 옛날이면 공급 100% 여도 명단(기준일 새 쪽 — Q1)", () => {
      expect(pickNew(pair({ competition_supply: 52, unsold_as_of: "2026-09-01" }), "g", TODAY).id).toBe("g");
    });
    it("같은 날: 50% 이상이면 숫자(청약홈) · 미만이면 명단 비공개", () => {
      expect(pickNew(pair({ competition_supply: 30, unsold: 3, unsold_as_of: "2026-09-30" }), "g", TODAY).id).toBe("h");
      expect(pickNew(pair({ competition_supply: 3, unsold: 3, unsold_as_of: "2026-09-30" }), "g", TODAY).id).toBe("g");
    });
    it("명단 비공개가 만료(기준월 + 6개월 지남)면 판정 대상이 아니다 → 청약홈 유효 값이 이김", () => {
      const rows = pair({ competition_supply: 1 });
      rows[0].unsold_as_of = "2026-04-30";
      expect(pickNew(rows, "g", TODAY)).toMatchObject({ id: "h", b_listed_hidden: false });
    });
  });
  it("G1② 미등재 0(govlist · 0 · 명단 확인 기준월 NULL) + 더 새 청약홈 3 → 청약홈이 이긴다(명단에 실린 행만 청약홈을 막는다)", () => {
    const rows = [
      { id: "z", unsold: 0, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: null, unsold_listed_total: null },
      { id: "h", unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: 1 },
    ];
    expect(pickNew(rows, "z", TODAY)).toMatchObject({ id: "h", b_unsold: 3, b_unsold_source: "applyhome", b_listed_hidden: false });
    // 미등재 0 이 더 새면 기준일 새 쪽(벌점 없이)으로 0 이 이긴다
    const older = [{ ...rows[0] }, { ...rows[1], unsold_as_of: "2026-09-01" }];
    expect(pickNew(older, "z", TODAY)).toMatchObject({ id: "z", b_unsold: 0, b_listed_hidden: false, b_listed_as_of: null });
  });
  it("F1 경기형: 숫자 명단(9/30 미분양 4·총분양 40) vs 10/15 재공급 공급 1·값 0 → 명단 숫자 4 가 이김 · 공급 20(50%) 이면 청약홈", () => {
    const rows = (/** @type {number} */ supply) => [
      { id: "g", unsold: 4, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", unsold_listed_total: 40 },
      { id: "h", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: supply },
    ];
    expect(pickNew(rows(1), "h", TODAY)).toMatchObject({ id: "g", b_unsold: 4, b_unsold_source: "govlist", b_listed_hidden: false, b_listed_as_of: "2026-09-30" });
    expect(pickNew(rows(20), "g", TODAY)).toMatchObject({ id: "h", b_unsold: 0 });
  });
  it("F2 3행: 6월 원 공고(공급 50%↑) + 10월 재공급 소량 + 9월 비공개 → 비공개가 이김", () => {
    const rows = [
      { id: "a", unsold: 30, unsold_source: "applyhome", unsold_as_of: "2026-06-15", competition_supply: 30 },
      { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: 1 },
      { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", unsold_listed_total: 52 },
    ];
    expect(pickNew(rows, "a", TODAY)).toMatchObject({ id: "g", b_listed_hidden: true });
  });
  it("F6 (오) 명단 행은 벌점 근거가 아니다: (오) 비공개가 있어도 비오피스텔 청약홈끼리 기준일 새 쪽", () => {
    const rows = [
      { id: "h", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: 1 },
      { id: "a", unsold: 5, unsold_source: "applyhome", unsold_as_of: "2026-10-01", competition_supply: 30 },
      { id: "o", is_off: true, unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_total: 52 },
    ];
    expect(pickNew(rows, "a", TODAY)).toMatchObject({ id: "h", b_unsold: 0 });
  });
  it("F4 이긴 행이 govlist 가 아니면 unsoldListedAsOf 는 NULL(kosis 가 덮은 행에 옛 기준월이 남아 있어도)", () => {
    expect(pickNew([{ id: "k", unsold: 9, unsold_source: "kosis", unsold_listed_as_of: "2026-03-31", unsold_listed_total: 52 }], "k", TODAY))
      .toMatchObject({ id: "k", b_listed_as_of: null, b_listed_hidden: false });
  });
  it("govlist 숫자 행(경기) vs 청약홈 유효 숫자: 기준일 새 쪽 · 같은 날 govlist 숫자 > govlist 비공개", () => {
    const rows = [
      { id: "a", unsold: 7, unsold_source: "applyhome", unsold_as_of: "2026-08-01", competition_supply: 7 },
      { id: "b", unsold: 4, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_total: 40 },
    ];
    expect(pickNew(rows, "a", TODAY)).toMatchObject({ id: "b", b_unsold: 4, b_listed_hidden: false });
    const sameDay = [
      { id: "z", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_total: 40 },
      { id: "b", unsold: 4, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_total: 40 },
    ];
    expect(pickNew(sameDay, "z", TODAY).id).toBe("b"); // 재료 행·id 큰 쪽(z)보다 숫자가 앞
  });
  it("hold 는 값 있는 행 뒤(지금 VIEW 67~72 와 같음) · 둘 다 hold → 값 NULL", () => {
    expect(pickNew([{ id: "a", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }, { id: "b", unsold: 5, unsold_source: "kosis" }], "a", TODAY))
      .toMatchObject({ id: "b", b_unsold: 5 });
    expect(pickNew([{ id: "a", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }, { id: "b", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }], "a", TODAY))
      .toMatchObject({ b_unsold: null, b_unsold_source: "hold", b_listed_hidden: false });
    // 유효 명단 비공개는 hold 보다 앞(순위 0 vs 2)
    expect(pickNew([{ id: "a", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }, { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30" }], "a", TODAY).id).toBe("g");
  });
  it("만료 지난 govlist: 비공개는 순위 3(kosis 값이 이김) · 숫자는 순위 1(hold 보다 앞)", () => {
    const expiredHidden = { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-04-30", unsold_listed_total: 52 };
    expect(pickNew([expiredHidden, { id: "k", unsold: 10, unsold_source: "kosis" }], "g", TODAY)).toMatchObject({ id: "k", b_listed_hidden: false });
    // 만료 비공개 행이 혼자 남아 이겨도(한 행 묶음) 「비공개」 표시는 꺼진다 — 화면이 옛 명단을 지금 사실처럼 보이지 않게
    expect(pickNew([expiredHidden], "g", TODAY)).toMatchObject({ id: "g", b_unsold: null, b_unsold_source: "govlist", b_listed_hidden: false });
    const expiredNum = { id: "g", unsold: 4, unsold_source: "govlist", unsold_as_of: "2026-04-30" };
    expect(pickNew([expiredNum, { id: "h", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }], "h", TODAY).id).toBe("g");
  });
  it("만료 경계: 기준월 + 6개월 = 오늘이면 유효 · 하루 전 기준월이면 만료(Postgres 말일 맞춤)", () => {
    const at = (/** @type {string} */ asOf) => pickNew([{ id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: asOf }, { id: "k", unsold: 9, unsold_source: "kosis" }], "k", TODAY).id;
    expect(at("2026-05-02")).toBe("g"); // 05-02 + 6개월 = 11-02 ≥ 오늘
    // 경계 당일 이긴 비공개 행은 「비공개」 표시도 켜져야 한다 — 순위와 b_listed_hidden 의 만료 판정이 어긋나면 하루 동안 「자료 없음」으로 보인다(세션691 적대 🟡2)
    expect(pickNew([{ id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-05-02" }, { id: "k", unsold: 9, unsold_source: "kosis" }], "k", TODAY)).toMatchObject({ id: "g", b_listed_hidden: true });
    expect(at("2026-05-01")).toBe("k"); // 11-01 < 오늘
    // 말일: 04-30 + 6개월 = 10-30 · 08-31 + 6개월 = 02-28(해석기 자체 확인)
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
  });
  it("(오) 행의 명단 비공개는 비오피스텔 kosis 값을 못 이긴다(is_off 가 순위보다 앞 — 그대로)", () => {
    expect(pickNew([{ id: "o", is_off: true, unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30" }, { id: "k", unsold: 9, unsold_source: "kosis" }], "k", TODAY).id).toBe("k");
  });
  it("govlist 행이 없는 묶음은 직전 VIEW 와 같은 행을 고른다(오늘 운영 DB = govlist 0행)", () => {
    const cases = [
      [{ id: "a", unsold: 165, unsold_source: "kosis" }, { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15" }],
      [{ id: "a", unsold: 3, unsold_source: "applyhome", unsold_as_of: "2026-06-01" }, { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15" }],
      [{ id: "a", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }, { id: "b", unsold: null }],
      [{ id: "a", unsold: 5, unsold_source: "kosis" }, { id: "c", unsold: 7, unsold_source: "kosis" }, { id: "b", unsold: null }],
      [{ id: "a", unsold: 2, unsold_source: null }, { id: "o", is_off: true, unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15" }],
    ];
    for (const rows of cases) for (const mat of ["a", "b"]) {
      const n = pickNew(rows, mat, TODAY), b = pickBase(rows, mat, TODAY);
      expect(n.id, JSON.stringify(rows)).toBe(b.id);
      expect(n.b_listed_hidden).toBe(false);
    }
  });
});

describe("20261102000000 표·칸·CHECK 마이그", () => {
  const c = code(table);
  it("unsold_source CHECK = 옛 값 셋 + govlist · hold 제약은 안 건드림", () => {
    expect(c).toContain("CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold', 'govlist'))");
    expect(c).not.toMatch(/(?:DROP|ADD) CONSTRAINT (?:IF EXISTS )?apartments_unsold_hold_null_check/);
    expect(c).toContain("WHERE conname = 'apartments_unsold_hold_null_check'"); // 자체검사가 살아 있음을 본다
  });
  it("새 칸 2(DATE·INTEGER, 기본값 없음) · 총분양 > 0 · unsold_notice_kind 는 만들지 않는다(👤 안 A)", () => {
    expect(c).toMatch(/ADD COLUMN IF NOT EXISTS unsold_listed_as_of date;/);
    expect(c).toMatch(/ADD COLUMN IF NOT EXISTS unsold_listed_total integer;/);
    expect(c).toContain("CHECK (unsold_listed_total IS NULL OR unsold_listed_total > 0)");
    expect(c).not.toContain("unsold_notice_kind");
  });
  it("F3 govlist 행 꼴 CHECK 2개(기준월 두 칸 · 비공개면 률도 NULL) + 자체검사가 세 제약을 센다", () => {
    // G1①(세션687 PR-2 보완): 기준일은 늘 필수 · 명단 확인 기준월은 수가 빈칸일 때만 필수(「미등재 0」 표지 허용)
    expect(c).toContain("ADD CONSTRAINT apartments_unsold_govlist_asof_check\n  CHECK (unsold_source IS DISTINCT FROM 'govlist' OR (unsold_as_of IS NOT NULL AND (unsold IS NOT NULL OR unsold_listed_as_of IS NOT NULL)));");
    expect(c).toContain("ADD CONSTRAINT apartments_unsold_govlist_hidden_rate_check\n  CHECK (NOT (unsold_source = 'govlist' AND unsold IS NULL AND unsold_rate IS NOT NULL));");
    expect(c).toMatch(/conname IN \('apartments_unsold_govlist_asof_check', 'apartments_unsold_govlist_hidden_rate_check',\s+'apartments_unsold_listed_total_check'\)\) <> 3 THEN/);
  });
  it("새 표: 설계서 §3-1 칸 전부 · UNIQUE(source, as_of, batch_id, row_no) · source·match_state CHECK", () => {
    for (const col of ["source", "as_of", "batch_id", "row_no", "batch_rows", "raw", "sgg", "emd", "raw_name", "address", "builder", "developer",
      "is_public", "is_rental", "area_band", "total_units", "unsold_units", "hidden", "apartment_id", "match_method", "match_score", "match_state", "file_url", "fetched_at"]) {
      expect(c, col).toMatch(new RegExp(`^\\s+${col}\\s+`, "m"));
    }
    expect(c).toContain("UNIQUE (source, as_of, batch_id, row_no)");
    expect(c).toContain("CHECK (source IN ('daegu', 'chungnam', 'gyeonggi'))");
    expect(c).toContain("CHECK (match_state IN ('strong', 'weak', 'none', 'decided', 'rejected'))");
    expect(c).toMatch(/^\s+unsold_units\s+integer\s+CHECK/m); // NOT NULL 아님(비공개 = NULL)
  });
  it("권한: RLS 켬 · 정책 0 · 네 역할 회수 뒤 service_role 만 S/I/U/D + 시퀀스 USAGE·SELECT · 자체검사", () => {
    expect(c).toMatch(/^ALTER TABLE public\.unsold_gov_list ENABLE ROW LEVEL SECURITY;$/m);
    expect(c).not.toMatch(/CREATE POLICY/i);
    expect(c).toMatch(/^REVOKE ALL ON public\.unsold_gov_list FROM PUBLIC, anon, authenticated, service_role;$/m);
    expect(c).toMatch(/^GRANT SELECT, INSERT, UPDATE, DELETE ON public\.unsold_gov_list TO service_role;$/m);
    expect(c).toContain("'GRANT USAGE, SELECT ON SEQUENCE %s TO service_role'");
    expect(c).toContain("RAISE EXCEPTION 'unsold_gov_list self-check: unexpected policy on %'");
    expect(table.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});

describe("되돌림 2개", () => {
  it("000003(VIEW 까지 적용했을 때): 한 트랜잭션 — govlist 행 있으면 멈춤 → DROP VIEW → 칸·표·CHECK → 직전 VIEW 본문 그대로 → GRANT", () => {
    expect(viewLines(rollback)).toEqual(viewLines(base));
    const c = code(rollback);
    const at = (/** @type {RegExp} */ re) => { const m = re.exec(c); expect(m, String(re)).not.toBeNull(); return m?.index ?? -1; };
    const order = [/^BEGIN;/m, /unsold_source = 'govlist'\) THEN/m, /^DROP VIEW IF EXISTS apartments_flat;/m, /DROP COLUMN IF EXISTS unsold_listed_total;/m,
      /^DROP TABLE IF EXISTS public\.unsold_gov_list;/m, /^CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/m,
      /^GRANT SELECT ON apartments_flat TO anon, authenticated, service_role;$/m, /^COMMIT;/m, /^NOTIFY pgrst/m].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(c).toContain("CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold'))");
    expect(c).not.toContain("b_listed_hidden");
  });
  it("000001(표만 적용했을 때): govlist 행 있으면 멈춤 · CHECK 옛 값 · 칸 2·표 지움 · VIEW 는 안 건드림", () => {
    const c = code(tableRollback);
    expect(c).toContain("CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold'))");
    expect(c).toMatch(/DROP COLUMN IF EXISTS unsold_listed_as_of;/);
    expect(c).toMatch(/DROP COLUMN IF EXISTS unsold_listed_total;/);
    expect(c).toMatch(/^DROP TABLE IF EXISTS public\.unsold_gov_list;/m);
    expect(c).toContain("WHERE unsold_source = 'govlist'");
    expect(c).not.toMatch(/VIEW/);
  });
  it("F3·F5 두 되돌림 모두: 명단 표에 행이 있으면 멈춤(표 없으면 건너뜀) · 새 CHECK 2개 DROP · 머리말에 unsold_listed_* 사본 안내", () => {
    for (const [name, f] of [["000001", tableRollback], ["000003", rollback]]) {
      const c = code(f);
      expect(c, name).toContain("IF pg_catalog.to_regclass('public.unsold_gov_list') IS NOT NULL THEN");
      expect(c, name).toContain("EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.unsold_gov_list)' INTO has_rows;");
      expect(c, name).toMatch(/DROP CONSTRAINT IF EXISTS apartments_unsold_govlist_asof_check;/);
      expect(c, name).toMatch(/DROP CONSTRAINT IF EXISTS apartments_unsold_govlist_hidden_rate_check;/);
      expect(f, name).toContain("govlist 아닌 행에 남은 unsold_listed_as_of·unsold_listed_total 값은 DROP COLUMN 으로 사라진다");
    }
    expect(rollback).toContain("감시 ⑩ 에 apartments_flat 변경 1 이 뜬다 = 예상된 차이");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 세션697 👤 결정 ① 「무시+경보」 — 20261104000000 은 위 판(20261102000002) 본문에서 존중 조건 7곳에만 「기준일 <= 오늘(KST)」를 더한다.
// 같은 해석기로 돌려 미래 기준일 행이 「만료」와 같은 길로 가는지 본다(수집기 쪽 같은 판정 = _shared.mjs asOfRespectState).
// ─────────────────────────────────────────────────────────────────────────────
const FUTURE_NAME = "20261104000000_view_unsold_future_asof.sql";
const futureSql = readLf(`../supabase/migrations/${FUTURE_NAME}`);
const futureRollback = readLf("../supabase/migrations/_rollbacks/20261104000001_rollback_view_unsold_future_asof.sql");
const pickFut = compileBundleUnsold(futureSql);
/** 존중 조건 한 덩어리(INTERVAL 비교) 정규식 — 세는 데 쓴다 */
const RESPECT_RE = /[mg]\.unsold_as_of \+ INTERVAL '6 months' >= \(now\(\) AT TIME ZONE 'Asia\/Seoul'\)::date/g;
const NOT_FUTURE_RE = /[mg]\.unsold_as_of <= \(now\(\) AT TIME ZONE 'Asia\/Seoul'\)::date/g;

describe("20261104000000 VIEW 마이그 — 직전 판(20261102000002) 대비 존중 조건 7곳에 「기준일 <= 오늘」만 (세션697)", () => {
  it("본문(주석 제거) = 직전 판 본문의 존중 조건 7곳 각각 바로 뒤에 같은 별칭의 「<= 오늘」을 붙인 것 — 그 밖은 한 글자도 다르지 않다", () => {
    const hits = code(sql).match(RESPECT_RE) ?? [];
    expect(hits).toHaveLength(7); // 직전 판의 존중 조건 수(리터럴 — 해석기·정규식이 실제로 세고 있다)
    const expected = sql.replace(RESPECT_RE, (all) => `${all} AND ${all[0]}.unsold_as_of <= (now() AT TIME ZONE 'Asia/Seoul')::date`);
    const now = viewLines(futureSql);
    expect(now.length).toBeGreaterThan(250);
    expect(now).toEqual(viewLines(expected));
    expect(cteText(futureSql)).not.toEqual(cteText(sql));
  });
  it("「<= 오늘」 조건 수 = 존중 조건 수 = 7(하나라도 빠지면 그 자리만 미래 기준일을 존중한다)", () => {
    const c = code(cteText(futureSql));
    expect((c.match(RESPECT_RE) ?? []).length).toBe(7);
    expect((c.match(NOT_FUTURE_RE) ?? []).length).toBe(7);
  });
  it("칸 187개 그대로 · security_invoker 명시 · DROP 없음 · NOTIFY 로 끝 · 가장 새 view 마이그", () => {
    expect(selectCols(futureSql)).toEqual(selectCols(sql));
    expect(futureSql).toMatch(/CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    expect(code(futureSql)).not.toMatch(/DROP\s+VIEW/i);
    expect(futureSql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
    const views = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql") && f.includes("view") && !f.includes("rollback")).sort();
    expect(views[views.length - 1]).toBe(FUTURE_NAME);
  });
  it("되돌림 20261104000001 = 직전 판(20261102000002) 본문 그대로 · CREATE OR REPLACE(DROP 없음) · NOTIFY 로 끝", () => {
    expect(viewLines(futureRollback)).toEqual(viewLines(sql));
    expect(code(futureRollback)).not.toMatch(/DROP\s+VIEW/i);
    expect(futureRollback.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});

describe("20261104000000 bundle_unsold — 미래 기준일은 존중하지 않는다(해석기)", () => {
  // TODAY = 2026-11-02(위 묶음과 같은 오늘)
  it("경계: 기준일 = 오늘이면 유효(비공개가 kosis 를 이김 · 표시 켜짐) · 내일이면 미래(kosis 가 이김 · 표시 꺼짐)", () => {
    const rows = (/** @type {string} */ asOf) => [
      { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: asOf, unsold_listed_total: 52 },
      { id: "k", unsold: 9, unsold_source: "kosis" },
    ];
    expect(pickFut(rows("2026-11-02"), "k", TODAY)).toMatchObject({ id: "g", b_listed_hidden: true });
    expect(pickFut(rows("2026-11-03"), "k", TODAY)).toMatchObject({ id: "k", b_unsold: 9, b_listed_hidden: false });
    // 직전 판은 미래 기준일 비공개를 이기게 뒀다(이 시험이 무엇을 막는지)
    expect(pickNew(rows("2027-09-30"), "k", TODAY)).toMatchObject({ id: "g", b_listed_hidden: true });
    expect(pickFut(rows("2027-09-30"), "k", TODAY)).toMatchObject({ id: "k", b_listed_hidden: false });
  });
  it("미래 청약홈 0 은 kosis 165 를 못 이긴다(직전 판은 이겼다)", () => {
    const rows = [{ id: "a", unsold: 165, unsold_source: "kosis" }, { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-12-01" }];
    expect(pickNew(rows, "a", TODAY).id).toBe("b");
    expect(pickFut(rows, "a", TODAY)).toMatchObject({ id: "a", b_unsold: 165 });
  });
  it("미래 명단 행은 청약홈 벌점 근거가 아니다(EXISTS 안 조건) — 유효 청약홈 0 이 이김", () => {
    const rows = [
      { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2027-01-31", unsold_listed_as_of: "2027-01-31", unsold_listed_total: 52 },
      { id: "h", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: 1 },
      { id: "k", unsold: 9, unsold_source: "kosis" },
    ];
    expect(pickFut(rows, "k", TODAY)).toMatchObject({ id: "h", b_unsold: 0, b_unsold_source: "applyhome" });
  });
  it("미래 숫자 명단은 만료 숫자 명단과 같은 순위 1(hold 보다 앞) · 미래 비공개 혼자면 이겨도 표시 꺼짐", () => {
    const futNum = { id: "g", unsold: 4, unsold_source: "govlist", unsold_as_of: "2027-03-31" };
    expect(pickFut([futNum, { id: "h", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }], "h", TODAY).id).toBe("g");
    expect(pickFut([{ id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2027-03-31" }], "g", TODAY)).toMatchObject({ b_listed_hidden: false });
  });
  it("미래 행이 없는 묶음은 직전 판과 같은 행·같은 값(위 묶음의 사례 전부)", () => {
    const cases = [
      [{ id: "a", unsold: 165, unsold_source: "kosis" }, { id: "b", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15" }],
      [{ id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", unsold_listed_total: 52 }, { id: "h", unsold: 0, unsold_source: "applyhome", unsold_as_of: "2026-10-15", competition_supply: 26 }],
      [{ id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-05-02" }, { id: "k", unsold: 9, unsold_source: "kosis" }],
      [{ id: "a", unsold: null, unsold_source: "hold", unsold_as_of: "2026-10-01" }, { id: "g", unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30" }],
      [{ id: "a", unsold: 7, unsold_source: "applyhome", unsold_as_of: "2026-08-01", competition_supply: 7 }, { id: "b", unsold: 4, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_total: 40 }],
    ];
    for (const rows of cases) for (const mat of ["a", "b", "g", "h", "k"]) {
      expect(pickFut(rows, mat, TODAY), JSON.stringify(rows)).toEqual(pickNew(rows, mat, TODAY));
    }
  });
});
