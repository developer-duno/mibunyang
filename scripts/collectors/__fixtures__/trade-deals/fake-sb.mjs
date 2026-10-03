// @ts-check
/**
 * 시험용 메모리 가짜 supabase — `trade_deals` 교체 저장(`saveDealsForKey`)이 쓰는 꼴만 흉내 낸다(세션589).
 * select(cols, {count, head}) · match · neq(여러 번) · lt · order · limit · insert · delete({count}).
 * 모든 연산이 한 틱 양보한다(동시 실행 시험이 두 회차를 실제로 섞이게).
 *
 * 고장 주입(opt):
 *   failInsert(chunk, callNo) → true 면 그 insert 실패 · failDelete(filter) → true 면 그 delete 실패
 *   failSelectTimes = n → 처음 n 번의 select 실패(일시 장애) · missingTable → 모든 호출이 PGRST205
 */

/** @typedef {{ eq: Record<string, any>, ne: Array<[string, any]>, lt: Array<[string, any]> }} Filter */

const tick = () => new Promise((r) => setImmediate(r));

/**
 * @param {any[]} seed
 * `extra` = trade_deals 밖의 표(읽기 전용 — 감시 ⑯ 의 trades·collector_runs 조회용).
 * @param {{ failInsert?: (chunk: any[], callNo: number) => boolean, commitThenError?: (chunk: any[], callNo: number) => boolean, failDelete?: (f: Filter) => boolean, failSelectTimes?: number, missingTable?: boolean, extra?: Record<string, any[]> }} [opt]
 */
export function fakeSb(seed = [], opt = {}) {
  const state = {
    rows: seed.map((r, i) => ({ ...r, id: i + 1 })), nextId: seed.length + 1, insertCalls: 0, deleteCalls: 0, selectCalls: 0, fromCalls: 0,
    /** @type {Array<{ table: string, eq: Record<string, any> }>} */ selectFilters: [],
  };
  const missing = { message: "Could not find the table 'public.trade_deals' in the schema cache", code: "PGRST205" };
  /** @param {any} r @param {Filter} f */
  const hit = (r, f) => Object.entries(f.eq).every(([k, v]) => r[k] === v)
    && f.ne.every(([k, v]) => r[k] !== v)
    && f.lt.every(([k, v]) => String(r[k]) < String(v));
  /** @returns {Filter} */
  const newFilter = () => ({ eq: {}, ne: [], lt: [] });
  const sb = {
    state,
    from(/** @type {string} */ table = "trade_deals") {
      state.fromCalls++;
      const other = table !== "trade_deals";
      const rowsOf = () => (other ? (opt.extra?.[table] ?? []) : state.rows);
      return {
        select(/** @type {string} */ _cols, /** @type {any} */ o) {
          const f = newFilter();
          let desc = false;
          let orderCol = "recorded_at";
          let lim = Infinity;
          /** @type {Array<[string, any]>} */
          const gt = [];
          const q = {
            match(/** @type {any} */ m) { Object.assign(f.eq, m); return q; },
            eq(/** @type {string} */ k, /** @type {any} */ v) { f.eq[k] = v; return q; },
            neq(/** @type {string} */ k, /** @type {any} */ v) { f.ne.push([k, v]); return q; },
            lt(/** @type {string} */ k, /** @type {any} */ v) { f.lt.push([k, v]); return q; },
            gt(/** @type {string} */ k, /** @type {any} */ v) { gt.push([k, v]); return q; },
            order(/** @type {string} */ c, /** @type {any} */ oo) { orderCol = c; desc = !oo?.ascending; return q; },
            limit(/** @type {number} */ n) { lim = n; return q; },
            then(/** @type {any} */ res, /** @type {any} */ rej) {
              return tick().then(() => {
                state.selectCalls++;
                state.selectFilters.push({ table, eq: { ...f.eq } });
                if (opt.missingTable && !other) return { data: null, error: missing, count: null };
                if (!other && (opt.failSelectTimes ?? 0) >= state.selectCalls) return { data: null, error: { message: "일시 장애" }, count: null };
                /** @param {any} a @param {any} b */
                const cmp = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));
                const out = rowsOf().filter((r) => hit(r, f) && gt.every(([k, v]) => cmp(r[k], v) > 0))
                  .sort((a, b) => (desc ? cmp(b[orderCol], a[orderCol]) : cmp(a[orderCol], b[orderCol])));
                if (o?.head) return { data: null, error: null, count: out.length };
                return { data: out.slice(0, lim), error: null };
              }).then(res, rej);
            },
          };
          return q;
        },
        insert(/** @type {any[]} */ chunk) {
          return tick().then(() => {
            const n = state.insertCalls++;
            if (opt.missingTable) return { error: missing };
            if (opt.failInsert?.(chunk, n)) return { error: { message: "boom" } };
            for (const r of chunk) state.rows.push({ ...r, id: state.nextId++ });
            // 서버엔 들어갔는데 응답만 오류(연결 끊김·게이트웨이 시간 초과) — 재시도가 같은 묶음을 또 넣는 꼴
            if (opt.commitThenError?.(chunk, n)) return { error: { message: "upstream timeout" } };
            return { error: null };
          });
        },
        delete() {
          const f = newFilter();
          const q = {
            match(/** @type {any} */ m) { Object.assign(f.eq, m); return q; },
            neq(/** @type {string} */ k, /** @type {any} */ v) { f.ne.push([k, v]); return q; },
            lt(/** @type {string} */ k, /** @type {any} */ v) { f.lt.push([k, v]); return q; },
            then(/** @type {any} */ res, /** @type {any} */ rej) {
              return tick().then(() => {
                state.deleteCalls++;
                if (opt.missingTable) return { error: missing, count: null };
                if (opt.failDelete?.(f)) return { error: { message: "delete boom" }, count: null };
                const before = state.rows.length;
                state.rows = state.rows.filter((r) => !hit(r, f));
                return { error: null, count: before - state.rows.length };
              }).then(res, rej);
            },
          };
          return q;
        },
      };
    },
  };
  return sb;
}

/** 시험용 시계 — 호출마다 1초씩 가는 ISO 시각. @param {number} [start] */
export function fakeClock(start = Date.UTC(2026, 9, 6, 0, 0, 0)) {
  let t = start;
  return () => new Date((t += 1000)).toISOString();
}

/**
 * 열쇠의 batch 별 행 수. @param {any} sb @param {{ sgg_cd: string, deal_month: string, trade_type: string }} key
 * @returns {Record<string, number>}
 */
export function batchCounts(sb, key) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const r of sb.state.rows) {
    if (r.sgg_cd !== key.sgg_cd || r.deal_month !== key.deal_month || r.trade_type !== key.trade_type) continue;
    m[r.batch_id] = (m[r.batch_id] ?? 0) + 1;
  }
  return m;
}
