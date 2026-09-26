// @ts-check
/**
 * 시험용 가짜 Supabase 클라이언트 (세션578) — DB 없이 정리 도구의 `run()` 을 끝까지 돌린다.
 * 지원: from().select/update/delete + eq/in/gt/is/order/limit + (update·delete 뒤) select 로 돌아온 행.
 * `failUpdateIds`·`failDeleteIds` 에 든 id 는 UPDATE·DELETE 가 그 행을 건드리지도 돌려주지도 않는다
 * (= "보낸 수가 아니라 돌아온 행" 시험용).
 */

/**
 * @param {Record<string, Array<Record<string, any>>>} tables
 * @param {{ failUpdateIds?: Set<string>; failDeleteIds?: Set<string | number> }} [opts]
 */
export function makeFakeSupabase(tables, opts = {}) {
  /** @type {Array<{ table: string; op: string; payload: unknown }>} */
  const calls = [];
  const failUpdateIds = opts.failUpdateIds ?? new Set();
  const failDeleteIds = opts.failDeleteIds ?? new Set();

  /** @param {string} table */
  function from(table) {
    /** @type {{ op: string; payload: any; filters: Array<(r: any) => boolean>; order: string | null; asc: boolean; limit: number | null; returning: boolean }} */
    const st = { op: "select", payload: null, filters: [], order: null, asc: true, limit: null, returning: false };
    /** @type {any} */
    const b = {
      select() { if (st.op !== "select") st.returning = true; return b; },
      update(/** @type {any} */ p) { st.op = "update"; st.payload = p; return b; },
      delete() { st.op = "delete"; return b; },
      eq(/** @type {string} */ c, /** @type {any} */ v) { st.filters.push((r) => r[c] === v); return b; },
      in(/** @type {string} */ c, /** @type {any[]} */ vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      gt(/** @type {string} */ c, /** @type {any} */ v) { st.filters.push((r) => r[c] > v); return b; },
      is(/** @type {string} */ c, /** @type {any} */ v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
      order(/** @type {string} */ c, /** @type {{ ascending?: boolean }} */ o = {}) { st.order = c; st.asc = o.ascending !== false; return b; },
      limit(/** @type {number} */ n) { st.limit = n; return b; },
      then(/** @type {any} */ res, /** @type {any} */ rej) { return Promise.resolve().then(runQuery).then(res, rej); },
    };
    function runQuery() {
      calls.push({ table, op: st.op, payload: st.payload });
      const rows = tables[table] ?? (tables[table] = []);
      let hit = rows.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "select") {
        if (st.order) {
          const k = st.order;
          hit = [...hit].sort((x, y) => (x[k] < y[k] ? -1 : x[k] > y[k] ? 1 : 0) * (st.asc ? 1 : -1));
        }
        if (st.limit != null) hit = hit.slice(0, st.limit);
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (st.op === "update") {
        const done = hit.filter((r) => !failUpdateIds.has(r.id));
        for (const r of done) Object.assign(r, st.payload);
        return { data: st.returning ? done.map((r) => ({ ...r })) : null, error: null };
      }
      if (st.op === "delete") {
        const gone = hit.filter((r) => !failDeleteIds.has(r.id));
        tables[table] = rows.filter((r) => !gone.includes(r));
        return { data: st.returning ? gone.map((r) => ({ ...r })) : null, error: null };
      }
      return { data: null, error: { message: `지원 안 함: ${st.op}` } };
    }
    return b;
  }
  return { from, calls, tables };
}

/**
 * 메모리 파일시스템 — run() 의 readFile/writeFile/exists 주입용.
 * @param {Record<string, string>} [initial]
 */
export function makeMemFs(initial = {}) {
  /** @type {Map<string, string>} */
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: (/** @type {string} */ p) => {
      const v = files.get(p);
      if (v == null) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: (/** @type {string} */ p, /** @type {string} */ s) => { files.set(p, s); },
    exists: (/** @type {string} */ p) => files.has(p),
  };
}
