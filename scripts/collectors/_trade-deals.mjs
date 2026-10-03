// @ts-check
/**
 * 실거래 원문 → `trade_deals` 행 (시세 비교 범위 좁히기 가, 세션589)
 *
 * `trades`(2u 가 읽는 표)는 구 전체 비교용이라 단지 일련번호(aptSeq)·지번·법정동코드·거래일을 버리고,
 * 고유 색인이 서로 다른 거래를 한 행으로 접는다. 이 모듈은 **같은 원문 item** 에서 원문 한 건 = 한 행을
 * 만든다. `trades` 쪽 행 만들기·중복 제거는 `collect-trades.mjs` 에 그대로 있다(여기서 손대지 않는다).
 *
 * 교체 방식(열쇠 = sgg_cd · deal_month · trade_type, 마이그 20261003000000 머리 주석):
 *   ① 지난 회차 흔적이 둘 이상이면 가장 새 것만 남긴다 ② 새 batch_id 로 insert
 *   ③ 그 열쇠의 batch_id <> 새 것 을 지운다 · 새 행 0건이면 아무것도 안 한다(0건 응답은 지우지 않음).
 *   insert 가 중간에 실패하면 이번 batch 를 지워 "옛 회차 그대로" 로 되돌린다.
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
 *   apt_seq: string | null; apt_name: string | null; apt_dong: string | null;
 *   deal_month: string; deal_day: number | null; area: number;
 *   floor: number | null; build_year: number | null; price: number;
 *   contract_type: string | null; dealing_type: string | null; cancel_date: string | null;
 * }} DealRow
 * @typedef {{ batch_id: string; recorded_at: string | number | null }} BatchMark
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
 * 숫자로만 된 지번 조각의 앞 0 을 뗀다("0493" → "493", "0000" → "0"). 숫자가 아니면 null.
 * `apartments.lot_main/lot_sub`(숫자, 부번 없으면 0)와 바로 맞대려는 표기다.
 * @param {string} s
 * @returns {string | null}
 */
function lotPart(s) {
  if (!/^\d+$/.test(s)) return null;
  return String(parseInt(s, 10));
}

/**
 * 지번 본번·부번. 매매는 원문 `bonbun`·`bubun`, 그 밖(전월세·분양권·옛 매매 창구)은 `jibun` 을 '-' 로 가른다.
 * "734" → ["734","0"] · "660-1" → ["660","1"] · "A4BL"·"산12" 처럼 숫자 지번이 아니면 [null, null].
 * @param {any} item
 * @param {DealType} type
 * @param {GetTag} getTag
 * @returns {[string | null, string | null]}
 */
function splitLot(item, type, getTag) {
  if (type === "sale") {
    const main = lotPart(getTag(item, "bonbun"));
    if (main != null) return [main, lotPart(getTag(item, "bubun")) ?? "0"];
  }
  const m = /^(\d+)(?:-(\d+))?$/.exec(getTag(item, "jibun"));
  if (!m || !m[1]) return [null, null];
  return [String(parseInt(m[1], 10)), m[2] ? String(parseInt(m[2], 10)) : "0"];
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
    dealing_type: type === "sale" ? orNull("dealingGbn") : null,
    cancel_date: type === "sale" ? orNull("cdealDay") : null,
  };
}

/**
 * 교체 계획. 기존 batch 목록(같은 열쇠) → 저장 전에 지울 지난 회차 흔적 · 저장 뒤 지울 것 전부.
 *
 * - `keepBatchId` = 기존 중 가장 새 recorded_at(저장 전엔 이것만 남긴다 — 지난 회차가 죽은 흔적 치우기)
 * - `staleBatchIds` = 기존 중 그 밖(저장 **전** 지운다)
 * - `deleteBatchIds` = 새 것 제외 전부(저장 **뒤** 지운다)
 *
 * @param {BatchMark[]} existingBatches
 * @param {string} newBatchId
 * @returns {{ keepBatchId: string | null; staleBatchIds: string[]; deleteBatchIds: string[] }}
 */
export function planReplace(existingBatches, newBatchId) {
  /** @type {Map<string, number>} */
  const latest = new Map();
  for (const b of existingBatches) {
    if (!b || !b.batch_id || b.batch_id === newBatchId) continue;
    const t = b.recorded_at == null ? -Infinity : new Date(b.recorded_at).getTime();
    const prev = latest.get(b.batch_id);
    if (prev === undefined || t > prev) latest.set(b.batch_id, Number.isNaN(t) ? -Infinity : t);
  }
  const ordered = [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return {
    keepBatchId: ordered[0] ?? null,
    staleBatchIds: ordered.slice(1),
    deleteBatchIds: ordered,
  };
}

/**
 * 열쇠 하나를 교체 저장한다(①②③). sb 는 supabase 클라이언트(시험은 가짜).
 *
 * @param {any} sb
 * @param {{ sgg_cd: string; deal_month: string; trade_type: string }} key
 * @param {DealRow[]} rows
 * @param {string} batchId
 * @param {{ batchSize?: number; retries?: number; sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {Promise<{ status: "empty" | "ok" | "fail"; inserted: number; deleted: number; staleDeleted: number; error?: string }>}
 */
export async function saveDealsForKey(sb, key, rows, batchId, opts = {}) {
  const { batchSize = 500, retries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  // 0건 응답은 지우지 않는다 — 옛 코드·장애가 에러 대신 0건으로 온다(admin-district-code-reform.md §4).
  if (!rows.length) return { status: "empty", inserted: 0, deleted: 0, staleDeleted: 0 };
  const T = "trade_deals";

  // ① 기존 batch 찾기 — 가장 새 것 1행, 그다음 "그것이 아닌 것" 1행(둘 다 limit 1 — 열쇠당 수천 행을 안 읽는다)
  /** @type {BatchMark[]} */
  const existing = [];
  const q1 = await sb.from(T).select("batch_id, recorded_at").match(key)
    .order("recorded_at", { ascending: false }).limit(1);
  if (q1.error) return { status: "fail", inserted: 0, deleted: 0, staleDeleted: 0, error: `기존 회차 조회: ${q1.error.message}` };
  if (q1.data?.[0]) {
    existing.push(q1.data[0]);
    const q2 = await sb.from(T).select("batch_id, recorded_at").match(key).neq("batch_id", q1.data[0].batch_id)
      .order("recorded_at", { ascending: false }).limit(1);
    if (q2.error) return { status: "fail", inserted: 0, deleted: 0, staleDeleted: 0, error: `기존 회차 조회: ${q2.error.message}` };
    if (q2.data?.[0]) existing.push(q2.data[0]);
  }
  const plan = planReplace(existing, batchId);
  let staleDeleted = 0;
  if (plan.staleBatchIds.length && plan.keepBatchId) {
    const d0 = await sb.from(T).delete({ count: "exact" }).match(key).neq("batch_id", plan.keepBatchId);
    if (d0.error) return { status: "fail", inserted: 0, deleted: 0, staleDeleted: 0, error: `지난 흔적 지우기: ${d0.error.message}` };
    staleDeleted = d0.count ?? 0;
  }

  // ② 새 batch insert(배치 500, 배치마다 재시도)
  const tagged = rows.map((r) => ({ ...r, batch_id: batchId }));
  let inserted = 0;
  for (let i = 0; i < tagged.length; i += batchSize) {
    const chunk = tagged.slice(i, i + batchSize);
    /** @type {string | null} */
    let err = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      const res = await sb.from(T).insert(chunk);
      err = res.error ? (res.error.message ?? "insert 실패") : null;
      if (!err) break;
      await sleep((attempt + 1) * 1000);
    }
    if (err) {
      // 반쯤 들어간 새 batch 가 "가장 새 것" 으로 읽히면 안 된다 → 이번 batch 를 지워 옛 회차 그대로 둔다
      const rb = await sb.from(T).delete().match({ ...key, batch_id: batchId });
      const rbNote = rb.error ? ` · 되돌리기도 실패(${rb.error.message}) — 감시 ⑯ 가 중복 batch 로 알린다` : " · 이번 회차분 되돌림";
      return { status: "fail", inserted: 0, deleted: 0, staleDeleted, error: `insert ${i}~${i + chunk.length}: ${err}${rbNote}` };
    }
    inserted += chunk.length;
  }

  // ③ 이번 것이 아닌 것 지우기
  const d1 = await sb.from(T).delete({ count: "exact" }).match(key).neq("batch_id", batchId);
  if (d1.error) {
    return { status: "fail", inserted, deleted: 0, staleDeleted, error: `옛 회차 지우기: ${d1.error.message} — 새 batch 가 가장 새 것이라 읽기는 정상, 감시 ⑯ 가 중복으로 알린다` };
  }
  return { status: "ok", inserted, deleted: d1.count ?? 0, staleDeleted };
}
