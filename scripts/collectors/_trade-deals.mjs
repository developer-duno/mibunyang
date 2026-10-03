// @ts-check
/**
 * 실거래 원문 → `trade_deals` 행 (시세 비교 범위 좁히기 가, 세션589)
 *
 * `trades`(2u 가 읽는 표)는 구 전체 비교용이라 단지 일련번호(aptSeq)·지번·법정동코드·거래일을 버리고,
 * 고유 색인이 서로 다른 거래를 한 행으로 접는다. 이 모듈은 **같은 원문 item** 에서 원문 한 건 = 한 행을
 * 만든다. `trades` 쪽 행 만들기·중복 제거는 `collect-trades.mjs` 에 그대로 있다(여기서 손대지 않는다).
 *
 * 교체 방식(열쇠 = sgg_cd · deal_month · trade_type, 마이그 20261003000000 머리 주석):
 *   행마다 `batch_rows`(그 열쇠에 이번 회차가 넣으려던 행 수)를 함께 넣는다 — **행 수 = batch_rows 인 batch 만 완성**.
 *   ① 지난 회차 흔적 정리: 가장 새 **완성** batch 하나만 남기고 나머지(미완성·더 옛 완성)를 지운다
 *   ② 급감 차단기: 남긴 완성본이 있고 새 행이 그 절반 미만이면 교체하지 않는다(보류 — 옛 것 유지)
 *   ③ 새 batch_id 로 insert(배치 500) → 자기 batch 행 수가 batch_rows 와 같은지 센다(다르면 되돌리고 fail — 옛 것 유지)
 *   ④ **이번 회차 시작보다 먼저 들어간** 옛 batch 를 지운다
 *     (동시에 도는 다른 회차의 새 행은 안 지운다 — 남은 중복은 감시 ⑯(a)가 잡는다)
 *   새 행 0건이면 아무것도 안 한다(0건 응답은 지우지 않음). insert 가 중간에 실패하면 이번 batch 를 지워
 *   되돌린다 — 되돌리기도 실패해 반쪽이 남아도 완성 표시가 없으니 "가장 새 완성 batch" 로 읽히지 않는다.
 *
 * 순수 함수(`buildDealRow`·`isOwnershipRight`·`dealKey`·`planReplace`)는 원문 item 이 XML 문자열이든
 * 조사 2차가 받아 둔 JSON 사본(칸 객체)이든 같은 결과를 내도록 `getTag` 를 주입받는다.
 */

/**
 * @typedef {"sale" | "jeonse" | "presale"} DealType
 * @typedef {(item: any, tag: string) => string} GetTag
 * @typedef {{
 *   trade_type: DealType; region: string; gu: string | null; sgg_cd: string;
 *   umd_cd: string | null; umd_nm: string | null; jibun: string | null;
 *   jibun_main: string | null; jibun_sub: string | null;
 *   road_nm: string | null; road_bonbun: string | null; road_bubun: string | null;
 *   apt_seq: string | null; apt_name: string | null; apt_dong: string | null;
 *   deal_month: string; deal_day: number | null; area: number;
 *   floor: number | null; build_year: number | null; price: number;
 *   contract_type: string | null; dealing_type: string | null; cancel_date: string | null;
 * }} DealRow
 * @typedef {{ batch_id: string; recorded_at: string | number | null; batch_rows?: number | null; count?: number | null }} BatchMark
 */

/** @type {Record<string, RegExp>} */
const TAG_RE = {};

/**
 * 원문 item 에서 칸 하나 — XML 문자열(`<tag>값</tag>`)과 칸 객체(JSON 사본) 둘 다 받는다. 없으면 "".
 * @type {GetTag}
 */
export function getTagAny(item, tag) {
  if (typeof item === "string") {
    if (!TAG_RE[tag]) TAG_RE[tag] = new RegExp("<" + tag + ">([^<]*)</" + tag + ">");
    const r = item.match(TAG_RE[tag]);
    return r && r[1] ? r[1].trim() : "";
  }
  if (item && typeof item === "object") {
    const v = item[tag];
    return v == null ? "" : String(v).trim();
  }
  return "";
}

/**
 * 분양권 원문의 `ownershipGbn` 이 "입"(입주권)인가. 빈칸 = 분양권으로 **추정**(공식 문서 미확인 — BACKLOG).
 * 매매·전월세 원문엔 이 칸이 없어 항상 false 다.
 * @param {any} item
 * @param {GetTag} [getTag]
 * @returns {boolean}
 */
export function isOwnershipRight(item, getTag = getTagAny) {
  return getTag(item, "ownershipGbn").replace(/\s+/g, "") === "입";
}

/**
 * 교체 방식의 열쇠 글자.
 * @param {string} sggCd
 * @param {string} month
 * @param {string} type
 */
export function dealKey(sggCd, month, type) {
  return `${sggCd}|${month}|${type}`;
}

/**
 * 숫자 조각의 앞 0 을 뗀다("0493" → "493"). 숫자가 아니면 null. `zeroAsNull` 이면 0 도 null.
 * @param {string} s
 * @param {boolean} [zeroAsNull]
 * @returns {string | null}
 */
function numPart(s, zeroAsNull = false) {
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (zeroAsNull && n === 0) return null;
  return String(n);
}

/**
 * 지번 본번·부번 — `apartments.lot_main/lot_sub`(숫자, 부번 없으면 0)와 바로 맞대려는 표기.
 * **세 종류가 같은 원문에 같은 답**을 내야 한다(검사관 A 지적 3):
 *   - 매매 원문은 `landCd`(1 = 대지 · 2 = 산 · 3·5·7 = 가-·블록 등)가 있다 — "1" 이고 본번 > 0 일 때만 `bonbun`/`bubun`.
 *     "1" 이 아니면(산 96-8 · BL-7 · 가- · 지구BL) 둘 다 null(사본 매매 36,788행 중 206행 — 숫자 지번은 전부 landCd 1).
 *   - `landCd` 가 없는 원문(전월세·분양권·옛 매매 창구 폴백)은 `jibun` 이 "숫자" 또는 "숫자-숫자" 이고 본번 > 0 일 때만.
 *   "734" → ["734","0"] · "660-1" → ["660","1"] · "산12"·"A4BL"·"가-"·"0" → [null, null].
 * @param {any} item
 * @param {DealType} type
 * @param {GetTag} getTag
 * @returns {[string | null, string | null]}
 */
function splitLot(item, type, getTag) {
  const landCd = type === "sale" ? getTag(item, "landCd") : "";
  if (landCd) {
    if (landCd !== "1") return [null, null];
    const main = numPart(getTag(item, "bonbun"), true);
    if (main != null) return [main, numPart(getTag(item, "bubun")) ?? "0"];
    return [null, null];
  }
  const m = /^(\d+)(?:-(\d+))?$/.exec(getTag(item, "jibun"));
  if (!m || !m[1] || parseInt(m[1], 10) === 0) return [null, null];
  return [String(parseInt(m[1], 10)), m[2] ? String(parseInt(m[2], 10)) : "0"];
}

/**
 * 도로명·건물 본번·부번 — 지번이 빈 단지의 두 번째 묶기 길(검사관 C 2절).
 * 원문 칸 이름이 종류마다 **글자 크기가 다르다**: 매매 `roadNm`·`roadNmBonbun`·`roadNmBubun` /
 * 전월세 `roadnm`·`roadnmbonbun`·`roadnmbubun`. 분양권 원문엔 없다 → null.
 * 전월세 `roadnm` 은 "광평로10길 15" 처럼 건물번호를 붙여 주므로, 끝의 번호가 본번(·부번)과 같으면 떼어
 * 매매와 같은 꼴("광평로10길")로 맞춘다. 번호는 앞 0 을 떼고 0 이면 null.
 * @param {any} item
 * @param {DealType} type
 * @param {GetTag} getTag
 * @returns {{ road_nm: string | null, road_bonbun: string | null, road_bubun: string | null }}
 */
function roadParts(item, type, getTag) {
  if (type === "presale") return { road_nm: null, road_bonbun: null, road_bubun: null };
  const [nmTag, bonTag, subTag] = type === "sale"
    ? ["roadNm", "roadNmBonbun", "roadNmBubun"]
    : ["roadnm", "roadnmbonbun", "roadnmbubun"];
  const bon = numPart(getTag(item, bonTag), true);
  const sub = numPart(getTag(item, subTag), true);
  let nm = getTag(item, nmTag).replace(/\s+/g, " ").trim();
  if (nm && bon) {
    const tail = sub ? `${bon}-${sub}` : bon;
    if (nm.endsWith(" " + tail)) nm = nm.slice(0, -(tail.length + 1)).trim();
  }
  return { road_nm: nm || null, road_bonbun: bon, road_bubun: sub };
}

/**
 * 원문 item 하나 → `trade_deals` 행. 저장하지 않을 행이면 null.
 *
 * null 조건(설계서 §4-1 "저장 안 함"): 금액·면적 0 · 전세인데 월세 > 0 · 분양권인데 `ownershipGbn` === "입".
 * 금액·면적·월세 판정은 `collect-trades.mjs` 의 `TRADE_CONFIGS[type].validate` 와 같은 식이다.
 *
 * @param {any} item
 * @param {{ type: DealType; region: string; gu: string | null; sggCd: string; month: string; getTag?: GetTag }} ctx
 * @returns {DealRow | null}
 */
export function buildDealRow(item, { type, region, gu, sggCd, month, getTag = getTagAny }) {
  const priceTag = type === "jeonse" ? "deposit" : "dealAmount";
  const price = parseInt((getTag(item, priceTag) || "0").replace(/,/g, ""));
  const area = parseFloat(getTag(item, "excluUseAr") || "0");
  if (!(price > 0 && area > 0)) return null;
  if (type === "jeonse") {
    const monthlyRent = parseInt((getTag(item, "monthlyRent") || "0").replace(/,/g, ""));
    if (monthlyRent !== 0) return null;
  }
  if (type === "presale" && isOwnershipRight(item, getTag)) return null;

  const [jibunMain, jibunSub] = splitLot(item, type, getTag);
  const dealDay = parseInt(getTag(item, "dealDay") || "0") || null;
  const orNull = (/** @type {string} */ tag) => getTag(item, tag) || null;

  return {
    trade_type: type,
    region,
    gu,
    sgg_cd: sggCd,
    umd_cd: type === "sale" ? orNull("umdCd") : null,
    umd_nm: orNull("umdNm"),
    jibun: orNull("jibun"),
    jibun_main: jibunMain,
    jibun_sub: jibunSub,
    ...roadParts(item, type, getTag),
    apt_seq: type === "presale" ? null : orNull("aptSeq"),
    apt_name: orNull("aptNm"),
    apt_dong: type === "sale" ? orNull("aptDong") : null,
    deal_month: month,
    deal_day: dealDay,
    area: Math.round(area * 100) / 100,
    floor: parseInt(getTag(item, "floor") || "0") || null,
    build_year: parseInt(getTag(item, "buildYear") || "0") || null,
    price,
    contract_type: type === "jeonse" ? orNull("contractType") : null,
    // 매매·분양권 원문 둘 다 dealingGbn·cdealDay 가 있다(검사관 C1 — 분양권 해제 거래도 나) 단계에서 빼야 한다)
    dealing_type: type !== "jeonse" ? orNull("dealingGbn") : null,
    cancel_date: type !== "jeonse" ? orNull("cdealDay") : null,
  };
}

/**
 * 교체 계획. 기존 batch 목록(같은 열쇠 · `batch_rows`·`count` 포함) → 남길 완성본 · 저장 전에 지울 흔적 · 저장 뒤 지울 것.
 *
 * - **완성** = `count === batch_rows`(행 수가 그 회차가 넣으려던 수와 같다)
 * - `keepBatchId` = 완성 batch 중 가장 새 recorded_at(없으면 null) · `keepRows` = 그 행 수
 * - `staleBatchIds` = 그 밖 전부(미완성 + 더 옛 완성) — 저장 **전** 지운다
 * - `deleteBatchIds` = 새 것 제외 전부 — 저장 **뒤** 지울 대상(실제 지우기는 회차 시작 시각으로 좁힌다)
 *
 * @param {BatchMark[]} existingBatches
 * @param {string} newBatchId
 * @returns {{ keepBatchId: string | null; keepRows: number; staleBatchIds: string[]; deleteBatchIds: string[] }}
 */
export function planReplace(existingBatches, newBatchId) {
  /** @type {Map<string, { t: number, complete: boolean, n: number }>} */
  const latest = new Map();
  for (const b of existingBatches) {
    if (!b || !b.batch_id || b.batch_id === newBatchId) continue;
    const raw = b.recorded_at == null ? NaN : new Date(b.recorded_at).getTime();
    const t = Number.isNaN(raw) ? -Infinity : raw;
    const n = Number(b.count ?? NaN);
    const complete = b.batch_rows != null && Number.isFinite(n) && n === Number(b.batch_rows);
    const prev = latest.get(b.batch_id);
    if (!prev || t > prev.t) latest.set(b.batch_id, { t, complete, n: Number.isFinite(n) ? n : 0 });
  }
  const ordered = [...latest.entries()].sort((a, b) => b[1].t - a[1].t);
  const keep = ordered.find(([, v]) => v.complete) ?? null;
  return {
    keepBatchId: keep ? keep[0] : null,
    keepRows: keep ? keep[1].n : 0,
    staleBatchIds: ordered.filter(([id]) => !keep || id !== keep[0]).map(([id]) => id),
    deleteBatchIds: ordered.map(([id]) => id),
  };
}

/** 표가 없을 때(마이그 적용 전)의 오류 — PostgREST PGRST205 · Postgres 42P01. */
export function isMissingTable(/** @type {any} */ error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  return code === "PGRST205" || code === "42P01" || /Could not find the table|relation .* does not exist/i.test(String(error.message ?? ""));
}

/** 한 열쇠에서 찾아볼 옛 batch 수 상한(보통 1, 죽은 흔적이 있어도 2~3). */
const MAX_BATCH_SCAN = 5;
/** ② 급감 차단기 — 새 행이 남긴 완성본의 이 비율 미만이면 교체하지 않는다. */
export const DEAL_DROP_RATIO = 0.5;

/**
 * 열쇠 하나를 교체 저장한다. sb 는 supabase 클라이언트(시험은 가짜).
 *
 * 상태: "empty"(새 행 0 — 아무것도 안 함) · "ok" · "held"(급감 차단기 — 옛 것 유지) · "fail"(이번 회차분 되돌림)
 * · "no-table"(표 없음 — 호출자가 이 회차의 나머지 저장을 멈춘다). `warn` = ④ 옛 batch 지우기 실패
 * (실패로 안 센다 — 새 batch 가 가장 새 완성본이라 읽기는 정상, 다음 회차가 지운다).
 *
 * @param {any} sb
 * @param {{ sgg_cd: string; deal_month: string; trade_type: string }} key
 * @param {DealRow[]} rows
 * @param {string} batchId
 * @param {{ batchSize?: number; retries?: number; sleep?: (ms: number) => Promise<void>; runStartedAt?: string; now?: () => string; dropRatio?: number }} [opts]
 * @returns {Promise<{ status: "empty" | "ok" | "held" | "fail" | "no-table"; inserted: number; deleted: number; staleDeleted: number; keepRows?: number; warn?: string; error?: string }>}
 */
export async function saveDealsForKey(sb, key, rows, batchId, opts = {}) {
  const {
    batchSize = 500, retries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => new Date().toISOString(), dropRatio = DEAL_DROP_RATIO,
  } = opts;
  const runStartedAt = opts.runStartedAt ?? now();
  /** @type {{ status: "empty" | "ok" | "held" | "fail" | "no-table"; inserted: number; deleted: number; staleDeleted: number; keepRows?: number; warn?: string; error?: string }} */
  const res = { status: "ok", inserted: 0, deleted: 0, staleDeleted: 0 };
  // 0건 응답은 지우지 않는다 — 옛 코드·장애가 에러 대신 0건으로 온다(admin-district-code-reform.md §4).
  if (!rows.length) return { ...res, status: "empty" };
  const T = "trade_deals";

  /**
   * 같은 꼴 재시도(조회·지우기·insert 공통 — 검사관 C7). 표 없음은 재시도하지 않는다.
   * @param {() => PromiseLike<any>} fn
   */
  const attempt = async (fn) => {
    /** @type {any} */
    let r = { error: { message: "시도 0회" } };
    for (let i = 0; i < retries; i++) {
      r = await fn();
      if (!r?.error || isMissingTable(r.error)) return r;
      if (i < retries - 1) await sleep((i + 1) * 1000);
    }
    return r;
  };
  /** @param {any} r @param {string} what */
  const bad = (r, what) => {
    if (isMissingTable(r.error)) return { ...res, status: /** @type {const} */ ("no-table"), error: `${what}: ${r.error.message}` };
    return { ...res, status: /** @type {const} */ ("fail"), error: `${what}: ${r.error?.message ?? "?"}` };
  };

  // ① 기존 batch 찾기 — 가장 새 것부터 "그것들이 아닌 것" 을 1행씩(열쇠당 수천 행을 안 읽는다) + batch 마다 행 수
  /** @type {BatchMark[]} */
  const existing = [];
  for (let i = 0; i < MAX_BATCH_SCAN; i++) {
    const r = await attempt(() => {
      let q = sb.from(T).select("batch_id, batch_rows, recorded_at").match(key);
      for (const b of existing) q = q.neq("batch_id", b.batch_id);
      return q.order("recorded_at", { ascending: false }).limit(1);
    });
    if (r.error) return bad(r, "기존 회차 조회");
    const hit = r.data?.[0];
    if (!hit) break;
    const c = await attempt(() => sb.from(T).select("id", { count: "exact", head: true }).match({ ...key, batch_id: hit.batch_id }));
    if (c.error) return bad(c, "기존 회차 행 수");
    existing.push({ ...hit, count: c.count ?? null });
  }
  const plan = planReplace(existing, batchId);
  res.keepRows = plan.keepRows;

  // ① 정리 — 가장 새 완성본 하나만 남긴다. 이번 회차 시작 **뒤에** 들어온 batch(동시에 도는 다른 회차)는 안 지운다.
  for (const stale of plan.staleBatchIds) {
    const d = await attempt(() => sb.from(T).delete({ count: "exact" }).match({ ...key, batch_id: stale }).lt("recorded_at", runStartedAt));
    if (d.error) return bad(d, "지난 흔적 지우기");
    res.staleDeleted += d.count ?? 0;
  }

  // ② 급감 차단기 — 완성본이 있고 새 행이 그 절반 미만이면 보류(옛 창구 폴백·부분 응답이 덮어쓰지 않게)
  if (plan.keepBatchId && rows.length < plan.keepRows * dropRatio) {
    return { ...res, status: "held" };
  }

  // ③ 새 batch insert(배치 500, 배치마다 재시도) — batch_rows = 이번에 넣으려는 행 수(완성 표시)
  const total = rows.length;
  for (let i = 0; i < total; i += batchSize) {
    const at = now();
    const chunk = rows.slice(i, i + batchSize).map((r) => ({ ...r, batch_id: batchId, batch_rows: total, recorded_at: at }));
    const r = await attempt(() => sb.from(T).insert(chunk));
    if (r.error) {
      if (isMissingTable(r.error)) return bad(r, "insert");
      // 반쪽 새 batch 는 완성 표시가 안 맞아 읽히지 않지만, 흔적을 남기지 않게 지운다(열쇠 3칸 + batch_id)
      const rb = await attempt(() => sb.from(T).delete().match({ ...key, batch_id: batchId }));
      const note = rb.error ? ` · 되돌리기도 실패(${rb.error.message}) — 미완성 batch 로 남는다(읽히지 않음, 감시 ⑯(a))` : " · 이번 회차분 되돌림";
      return { ...res, status: "fail", inserted: 0, error: `insert ${i}~${i + chunk.length}: ${r.error.message ?? "insert 실패"}${note}` };
    }
    res.inserted += chunk.length;
  }

  // ③-확인 자기 batch 행 수 = batch_rows 인가(검사관 B 지적 1) — insert 가 서버엔 들어갔는데 응답만 오류로 와서
  // 재시도가 같은 묶음을 또 넣으면 행 수가 넘친다(미완성). 그대로 ④ 로 가면 옛 완성본까지 지워 열쇠가 통째로 빈다.
  // 어긋나면 ④ 전에 자기 batch 를 지우고 fail — 옛 완성본은 남는다.
  const own = await attempt(() => sb.from(T).select("id", { count: "exact", head: true }).match({ ...key, batch_id: batchId }));
  if (own.error || own.count !== total) {
    const why = own.error ? `행 수 확인 실패(${own.error.message})` : `행 수 ${own.count} ≠ batch_rows ${total}`;
    const rb = await attempt(() => sb.from(T).delete().match({ ...key, batch_id: batchId }));
    const note = rb.error ? ` · 되돌리기도 실패(${rb.error.message}) — 미완성 batch 로 남는다(읽히지 않음, 감시 ⑯(a))` : " · 이번 회차분 되돌림";
    return { ...res, status: "fail", inserted: 0, error: `넣은 뒤 확인: ${why}${note}` };
  }

  // ④ 이번 회차 시작보다 먼저 들어간 옛 batch 지우기(자기 batch 는 절대 안 지운다)
  const d1 = await attempt(() => sb.from(T).delete({ count: "exact" }).match(key).lt("recorded_at", runStartedAt).neq("batch_id", batchId));
  if (d1.error) {
    return { ...res, status: "ok", warn: `옛 회차 지우기 실패: ${d1.error.message} — 새 batch 가 가장 새 완성본이라 읽기는 정상, 다음 회차가 지운다` };
  }
  res.deleted = d1.count ?? 0;
  return res;
}

// ── 읽는 쪽 (시세 비교 범위 좁히기 나, 세션590) ─────────────────────────────

/**
 * 열쇠(sgg_cd · deal_month · trade_type)마다 **가장 새 완성 batch** 의 행만 남긴다. DB 접근 없는 순수 함수.
 *
 * - 완성 = 그 batch 의 행 수 === `batch_rows`(수집기가 넣으려던 수 — 위 머리 주석 교체 방식)
 * - 가장 새 = batch 행들의 `recorded_at` 최댓값이 가장 늦은 것(같으면 batch_id 글자 큰 쪽 — 결과가 흔들리지 않게)
 * - 완성 batch 가 하나도 없는 열쇠는 통째로 뺀다(`droppedKeys` — 호출자가 로그). 반쪽 batch 를 읽으면 건수가 틀어진다.
 * ⚠️ 행 수를 세려면 그 열쇠의 행이 **전부** 들어와 있어야 한다 — 열쇠에 deal_month 가 들어 있으므로
 *    `deal_month >= X` 로 거른 조회는 열쇠를 자르지 않는다. 다른 칸(지역·동)으로 거른 조회에는 쓰지 않는다.
 * @template {{ sgg_cd: string; deal_month: string; trade_type: string; batch_id: string; batch_rows: number | null; recorded_at?: string | number | null }} R
 * @param {readonly R[]} rows
 * @returns {{ rows: R[]; droppedKeys: string[] }}
 */
export function keepNewestCompleteBatches(rows) {
  /** @type {Map<string, Map<string, { n: number; expect: number | null; t: number }>>} */
  const byKey = new Map();
  for (const r of rows) {
    const k = dealKey(r.sgg_cd, r.deal_month, r.trade_type);
    let batches = byKey.get(k);
    if (!batches) { batches = new Map(); byKey.set(k, batches); }
    const raw = r.recorded_at == null ? NaN : new Date(r.recorded_at).getTime();
    const t = Number.isNaN(raw) ? -Infinity : raw;
    const b = batches.get(r.batch_id);
    if (!b) batches.set(r.batch_id, { n: 1, expect: r.batch_rows == null ? null : Number(r.batch_rows), t });
    else { b.n++; if (t > b.t) b.t = t; }
  }
  /** @type {Map<string, string>} */
  const chosen = new Map();
  /** @type {string[]} */
  const droppedKeys = [];
  for (const [k, batches] of byKey) {
    /** @type {{ id: string; t: number } | null} */
    let best = null;
    for (const [id, b] of batches) {
      if (b.expect == null || b.n !== b.expect) continue;
      if (!best || b.t > best.t || (b.t === best.t && id > best.id)) best = { id, t: b.t };
    }
    if (best) chosen.set(k, best.id);
    else droppedKeys.push(k);
  }
  const kept = rows.filter((r) => chosen.get(dealKey(r.sgg_cd, r.deal_month, r.trade_type)) === r.batch_id);
  return { rows: kept, droppedKeys: droppedKeys.sort() };
}

/** 읽기 도우미가 늘 함께 받는 칸(완성 batch 판정 재료 + 커서). */
const WINDOW_BASE_COLS = ["id", "sgg_cd", "deal_month", "trade_type", "batch_id", "batch_rows", "recorded_at"];

/**
 * `trade_deals` 에서 `deal_month >= fromMonth` 의 **완성 batch** 행만 받는다(시세 비교 범위 좁히기 나 — 묶기·통계 공용).
 *
 * - 고유 키 커서(id 오름차순, 1,000행) — 정렬 없는 OFFSET 은 큰 표에서 행을 잃는다(`unordered-pagination-loses-rows.md`)
 * - `cols` 에 위 기본 칸을 늘 덧붙인다
 * - 받은 뒤 `keepNewestCompleteBatches`. 조회 실패는 **던진다** — 조용한 [] 는 "거래 0건"처럼 보인다(호출자가 기록)
 * - batch_id·recorded_at 글자는 같은 값끼리 한 문자열로 모은다(100만 행이 각자 사본을 들고 있지 않게)
 * @param {any} sb supabase 클라이언트
 * @param {{ fromMonth: string; cols: string; pageSize?: number }} opts
 * @returns {Promise<{ rows: Array<Record<string, any>>; droppedKeys: string[]; total: number }>}
 */
export async function fetchTradeDealsWindow(sb, { fromMonth, cols, pageSize = 1000 }) {
  if (!/^\d{6}$/.test(String(fromMonth))) throw new Error(`fetchTradeDealsWindow: fromMonth 는 YYYYMM 이어야 합니다: ${fromMonth}`);
  const want = new Set(String(cols).split(",").map((s) => s.trim()).filter(Boolean));
  for (const c of WINDOW_BASE_COLS) want.add(c);
  const select = [...want].join(",");
  /** @type {Map<string, string>} */
  const intern = new Map();
  const same = (/** @type {any} */ v) => {
    if (typeof v !== "string") return v;
    const hit = intern.get(v);
    if (hit !== undefined) return hit;
    intern.set(v, v);
    return v;
  };
  /** @type {Array<Record<string, any>>} */
  const all = [];
  /** @type {any} */
  let cursor = null;
  while (true) {
    let q = sb.from("trade_deals").select(select).gte("deal_month", fromMonth).order("id", { ascending: true }).limit(pageSize);
    if (cursor != null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`trade_deals 조회 실패: ${error.message ?? error.code ?? "?"}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      r.batch_id = same(r.batch_id);
      r.recorded_at = same(r.recorded_at);
      all.push(r);
    }
    cursor = data[data.length - 1].id;
    if (cursor == null) throw new Error("trade_deals 조회: 커서(id)가 비었습니다");
    if (data.length < pageSize) break;
  }
  const { rows, droppedKeys } = keepNewestCompleteBatches(/** @type {any} */ (all));
  return { rows, droppedKeys, total: all.length };
}
