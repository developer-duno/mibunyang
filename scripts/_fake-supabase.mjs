// @ts-check
/**
 * 테스트용 가짜 Supabase 클라이언트 (세션550 리뷰 #1).
 *
 * ## 왜 모듈 mock 이 아니라 주입인가
 *
 * `vi.mock` 으로 `getSupabase` 를 가로채면 **실제 코드 경로가 바뀐다**(무엇을 import 했는지에
 * 따라 갈린다). 여기서 지켜야 하는 것은 "쓰기 경로가 무엇을 지우고 무엇을 고치는가" 라서,
 * 그 경로를 **그대로 태우고** 호출만 기록하는 편이 정직하다. 그래서 `runApplyFrom(sb, args)` 가
 * 클라이언트를 인자로 받고, 여기서 만든 가짜를 넣는다.
 *
 * ## 기록하는 것
 *
 * 모든 `delete`/`update` 호출을 `calls` 에 남긴다 — **어떤 필터로** 불렸는지까지(`byId:false` 면
 * id 아닌 필터로 지웠다는 뜻이고, 그건 그 자체로 사고다).
 *
 * 지원하는 것은 이 도구가 실제로 쓰는 조합뿐이다: `.select(cols)` · `.select("*", {count,head})` ·
 * `.eq` · `.is` · `.in` · `.delete().in().select()` · `.update().in().select()` · `.order().limit().gt()`.
 */

/**
 * @typedef {{ id: string|number, region: string|null, gu: string|null, [k: string]: any }} Row
 * @typedef {{ op: "delete"|"update", ids: Array<string|number>, byId: boolean,
 *   payload?: Record<string, any>, filters: Array<[string, any]> }} Call
 */

/**
 * 두 값을 **진짜 DB 처럼** 견준다 — 둘 다 유한한 수면 수로, 아니면 문자열로.
 *
 * ⚠️ 문자열로만 견주면 `[9, 10, 100]` 이 `10, 100, 9` 로 정렬되고 `gt(9)` 가 아무것도 안 돌려준다.
 * 이 가짜가 지금은 커서를 쓰지 않는 `runApplyFrom` 만 태우므로 무해하지만, 나중에 누가
 * keyset 경로(`selectAll(..., "id")`)를 이 가짜로 검사하면 **행이 새는 결함을 초록불로 덮는다**
 * (`unordered-pagination-loses-rows.md` 가 말하는 바로 그 사고를 테스트가 못 보게 된다).
 *
 * @param {any} a
 * @param {any} b
 * @returns {number} a<b 면 음수, 같으면 0, a>b 면 양수
 */
export function compareValues(a, b) {
  const na = Number(a);
  const nb = Number(b);
  // `Number(null)` 은 0 이라 빈 값이 숫자로 둔갑한다 — 먼저 걷어낸다(probe-must-be-self-verified §2).
  const bothNumeric =
    a != null && b != null && a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb);
  if (bothNumeric) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = String(a);
  const sb2 = String(b);
  return sa === sb2 ? 0 : sa < sb2 ? -1 : 1;
}

/**
 * @param {Row[]} rows 초기 행 (복사해서 쓴다)
 * @param {{ failDeleteAtCall?: number, countError?: string, selectError?: string,
 *   deleteOnlyIds?: Array<string|number> }} [opts]
 *   `deleteOnlyIds` = 삭제 요청이 와도 **이 id 만** 실제로 지운다(나머지는 조용히 남는다).
 *   진짜 DB 가 권한·경합으로 일부만 지우는 상황을 흉내 낸다(세션550 리뷰 N3).
 */
export function makeFakeSupabase(rows, opts = {}) {
  /** @type {Row[]} */
  let table = rows.map((r) => ({ ...r }));
  /** @type {Call[]} */
  const calls = [];
  let deleteCallNo = 0;

  /**
   * @param {Array<[string, any]>} filters
   * @returns {Row[]}
   */
  function apply(filters) {
    return table.filter((r) =>
      filters.every(([kind, arg]) => {
        if (kind === "eq") return r[arg.col] === arg.val;
        if (kind === "is") return (r[arg.col] ?? null) === arg.val;
        if (kind === "in") return arg.vals.some((/** @type {any} */ v) => String(v) === String(r[arg.col]));
        if (kind === "gt") return compareValues(r[arg.col], arg.val) > 0;
        if (kind === "lt") return compareValues(r[arg.col], arg.val) < 0;
        return true;
      }),
    );
  }

  /**
   * @param {"select"|"delete"|"update"} mode
   * @param {{ count?: boolean, payload?: Record<string, any>, limit?: number, order?: string,
   *   desc?: boolean, returning?: boolean }} state
   * @param {Array<[string, any]>} filters
   */
  function builder(mode, state, filters) {
    /** @type {any} */
    const b = {
      eq: (/** @type {string} */ col, /** @type {any} */ val) => builder(mode, state, [...filters, ["eq", { col, val }]]),
      is: (/** @type {string} */ col, /** @type {any} */ val) => builder(mode, state, [...filters, ["is", { col, val }]]),
      in: (/** @type {string} */ col, /** @type {any[]} */ vals) => builder(mode, state, [...filters, ["in", { col, vals }]]),
      gt: (/** @type {string} */ col, /** @type {any} */ val) => builder(mode, state, [...filters, ["gt", { col, val }]]),
      lt: (/** @type {string} */ col, /** @type {any} */ val) => builder(mode, state, [...filters, ["lt", { col, val }]]),
      // 진짜 클라이언트와 같은 모양: `.order(col, { ascending })`. 이 도구는 오름차순만 쓴다.
      order: (/** @type {string} */ col, /** @type {{ ascending?: boolean }} */ o = {}) =>
        builder(mode, { ...state, order: col, desc: o.ascending === false }, filters),
      limit: (/** @type {number} */ n) => builder(mode, { ...state, limit: n }, filters),
      // delete/update 뒤의 `.select("id")` = "실제로 바뀐 행을 돌려달라"
      select: (/** @type {string} */ _cols, /** @type {any} */ o = undefined) =>
        mode === "select"
          ? builder("select", { ...state, count: !!o?.count }, filters)
          : builder(mode, { ...state, returning: true }, filters),
      then: (/** @type {any} */ resolve, /** @type {any} */ reject) => run().then(resolve, reject),
    };
    return b;

    async function run() {
      const idFilter = filters.find(([k]) => k === "in" && true);
      const byId = !!filters.find(([k, a]) => k === "in" && a.col === "id");
      /** @type {Array<string|number>} */
      const ids = byId ? /** @type {any} */ (filters.find(([k, a]) => k === "in" && a.col === "id"))[1].vals : [];

      if (mode === "select") {
        if (opts.selectError) return { data: null, error: { message: opts.selectError }, count: null };
        let hit = apply(filters);
        if (state.count) {
          if (opts.countError) return { data: null, error: { message: opts.countError }, count: null };
          return { data: null, error: null, count: hit.length };
        }
        if (state.order) {
          const col = String(state.order);
          const dir = state.desc ? -1 : 1;
          hit = [...hit].sort((a, b2) => dir * compareValues(a[col], b2[col]));
        }
        if (state.limit) hit = hit.slice(0, state.limit);
        return { data: hit.map((r) => ({ ...r })), error: null, count: null };
      }

      if (mode === "delete") {
        deleteCallNo++;
        if (opts.failDeleteAtCall && deleteCallNo === opts.failDeleteAtCall) {
          return { data: null, error: { message: "주입된 삭제 실패" }, count: null };
        }
        let hit = apply(filters);
        // `deleteOnlyIds` 가 있으면 그 id 만 실제로 지운다 — 나머지는 **조용히 남는다**
        // (에러도 없이 요청보다 적게 지워지는 상황). 진짜 사고의 모양이다.
        if (opts.deleteOnlyIds) {
          const allow = new Set(opts.deleteOnlyIds.map(String));
          hit = hit.filter((r) => allow.has(String(r.id)));
        }
        calls.push({ op: "delete", ids, byId, filters: filters.map(([k, a]) => [k, a.col ?? null]) });
        const goneIds = new Set(hit.map((r) => String(r.id)));
        table = table.filter((r) => !goneIds.has(String(r.id)));
        return { data: hit.map((r) => ({ id: r.id })), error: null, count: null };
      }

      // update
      const hit = apply(filters);
      calls.push({ op: "update", ids, byId, payload: state.payload, filters: filters.map(([k, a]) => [k, a.col ?? null]) });
      for (const r of hit) Object.assign(r, state.payload);
      return { data: hit.map((r) => ({ id: r.id })), error: null, count: null };
    }
  }

  return {
    from: (/** @type {string} */ _t) => ({
      select: (/** @type {string} */ _cols, /** @type {any} */ o = undefined) => builder("select", { count: !!o?.count }, []),
      delete: () => builder("delete", {}, []),
      update: (/** @type {Record<string, any>} */ payload) => builder("update", { payload }, []),
    }),
    /** 호출 기록 */
    calls,
    /** 현재 표 상태 */
    snapshot: () => table.map((r) => ({ ...r })),
    /** 삭제·표기변경으로 실제 건드린 id 전부 */
    touched: (/** @type {"delete"|"update"} */ op) =>
      calls.filter((c) => c.op === op).flatMap((c) => c.ids.map(String)),
  };
}
