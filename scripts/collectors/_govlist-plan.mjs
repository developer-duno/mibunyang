// @ts-check
/**
 * 명단 매칭 결과 → apartments 미분양 6칸 계획(값 규칙 ①②③) · 전이표 · 차단기 · 승인 계획 대조 · 사본·역계획 · 명단 표 행.
 * 설계서 §3-2·§5 ①②③⑥ · 사장님 결정 11/02(Q2 「6개월」 · Q9 「명단 총분양」 · 01:4x `unsold_listed_total`). 순수 함수 — DB·시각을 보지 않는다.
 *
 * 6칸 = unsold · unsold_rate · unsold_source · unsold_as_of · unsold_listed_as_of · unsold_listed_total.
 * - ② 등재 + 비공개(또는 미분양 칸 빈칸): `unsold NULL · rate NULL · source 'govlist' · as_of · listed_as_of = as_of · listed_total = 명단 총분양 Σ`.
 * - ① 등재 + 숫자 공개(면적대 전부 숫자): `unsold = Σ · rate = Σ / 명단 총분양 Σ(Q9) · 나머지 ②와 같음`.
 * - 묶음 단위로 계산해 받는 행 전부에 같은 값 — 단 **hold 행 · 유효 청약홈 행 · 임대 행 · 더 새 명단 값 행은 그 행만 건너뛴다**
 *   (§5-① 「hold 행은 건드리지 않음」 · 청약홈 유효 값과의 우열은 VIEW 순위 0 이 기준일로 가린다 — 행 값을 덮지 않는다).
 * - ③ 미등재 → 0: 기본 꺼짐 · 대구·충남만 · 조건 (a)~(e) 전부(§5-③ 원문). dry-run 은 꺼짐·켬 두 계획을 같이 만든다.
 * - 만료(Q2 6개월): 이번 명단 기준일 + 6개월이 이미 지났으면 쓰지 않는다(`skip_expired_source`). 지난 명단 값의 만료 뒤 처리는 KOSIS(PR-4).
 */
import { clampUnsoldRate, isApplyhomeExpired } from "./_shared.mjs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";

/** @typedef {import("./_govlist-match.mjs").AptRow} AptRow */
/** @typedef {import("./_govlist-match.mjs").Bundle} Bundle */
/** @typedef {import("./_govlist-match.mjs").MatchResult} MatchResult */
/** @typedef {import("./_govlist-parse.mjs").GovComplex} GovComplex */
/** @typedef {import("./_govlist-parse.mjs").GovRow} GovRow */
/**
 * @typedef {{ unsold: number | null; unsold_rate: number | null; unsold_source: string | null; unsold_as_of: string | null;
 *   unsold_listed_as_of: string | null; unsold_listed_total: number | null }} Six
 * @typedef {{ source: string; id: string; name: string | null; region: string | null; gu: string | null; bundle_key: string; action: string;
 *   reasons: string[]; before: Six; after: Six | null; list_keys: string[] }} PlanRow
 */

/**
 * govlist 값 존중 기간(개월) — 사장님 결정 Q2 「6개월」(11/02 01:1x).
 * ⚠️ PR-1 이 `_shared.mjs` 에 같은 값 `GOVLIST_EXPIRY_MONTHS` 를 넣는다(VIEW SQL 과 맞대는 시험 포함) — 합친 뒤 이 줄을 그 import 로 바꾼다.
 */
export const GOVLIST_EXPIRY_MONTHS = 6;
/** 바뀔 단지(묶음) 수 차단기(설계서 §5-⑥). */
export const GOVLIST_BREAKER_MAX_BUNDLES = 50;
/** 명단 행 수 급감 차단기 — 전 회차 대비 이 비율 미만이면 막는다(−50%). */
export const GOVLIST_DROP_RATIO = 0.5;
/** 미등재 → 0 을 판정할 수 있는 출처(경기는 비공개 행을 단지로 못 모아 "없다"를 말할 수 없다 — §5-③). */
export const ABSENT_ZERO_SOURCES = Object.freeze(["daegu", "chungnam"]);
export const VALUE_KEYS = /** @type {const} */ (["unsold", "unsold_rate", "unsold_source", "unsold_as_of", "unsold_listed_as_of", "unsold_listed_total"]);
/** 역계획 expect 칸 — `backfill-unsold-source.mjs` 가 DB 에서 읽어 맞대는 4칸(그 도구는 새 2칸을 읽지 않는다 → 새 2칸은 set 에만). */
export const RESTORE_EXPECT_KEYS = /** @type {const} */ (["unsold", "unsold_rate", "unsold_source", "unsold_as_of"]);
/** (d) 해소로 치는 매칭 상태. */
const RESOLVED = new Set(["strong", "decided", "rejected"]);

/** @param {AptRow} r @returns {Six} */
export function sixOf(r) {
  return {
    unsold: r.unsold ?? null, unsold_rate: r.unsold_rate ?? null, unsold_source: r.unsold_source ?? null, unsold_as_of: r.unsold_as_of ?? null,
    unsold_listed_as_of: r.unsold_listed_as_of ?? null, unsold_listed_total: r.unsold_listed_total ?? null,
  };
}
/** @param {Six | null} a @param {Six | null} b */
export const sameSix = (a, b) => !!a && !!b && VALUE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

/** 「천안시 서북구」 → 「천안시」(시 아래 구는 시로 접는다 — 총괄표가 시 단위). @param {string | null | undefined} s */
export const cityKey = (s) => String(s ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * 묶음에 붙은 명단 단지 → 쓸 값(②/①). 명단 단지가 둘(사람 판정 decided 합산)이면 Σ.
 * @param {GovComplex[]} cxs @param {string} asOf
 * @returns {{ six: Six; kind: "hidden" | "number" }}
 */
export function listedValue(cxs, asOf) {
  const T = cxs.reduce((s, c) => s + (c.total_units ?? 0), 0);
  const allNum = cxs.every((c) => !c.hidden && c.unsold_units != null);
  if (!allNum) {
    return { kind: "hidden", six: { unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: asOf, unsold_listed_total: T > 0 ? T : null } };
  }
  const U = cxs.reduce((s, c) => s + Number(c.unsold_units), 0);
  const rate = T > 0 ? clampUnsoldRate(Math.round((U / T) * 1000) / 10) : null;
  return { kind: "number", six: { unsold: U, unsold_rate: rate, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: asOf, unsold_listed_total: T > 0 ? T : null } };
}

/**
 * 그 행을 이번 명단이 건드리면 안 되는 이유(없으면 null) — hold · 임대 · 유효 청약홈 · 더 새(또는 같은 날 이후) 유효 명단 값.
 * @param {AptRow} m @param {string} asOf @param {Date} now
 */
export function skipReason(m, asOf, now) {
  if (m.unsold_source === "hold") return "skip_hold";
  if (isLeaseUnit(m)) return "skip_lease";
  if (m.unsold_source === "applyhome" && isApplyhomeExpired(m.unsold_as_of, now) !== true) return "skip_applyhome";
  if (m.unsold_source === "govlist" && typeof m.unsold_as_of === "string" && m.unsold_as_of > asOf) return "skip_newer_govlist";
  return null;
}

/**
 * 미등재 → 0 조건 (a)~(e) 중 못 넘은 것(전부 넘으면 빈 배열). (e) 의 hold·청약홈·govlist 는 `skipReason`·유효 govlist 검사로 먼저 거른다.
 * @param {{ m: AptRow; b: Bundle; asOf: string; now: Date; listOk: boolean; covered: Set<string>; unresolvedCities: Set<string> }} p
 * @returns {string[]}
 */
export function absentZeroFails({ m, b, asOf, now, listOk, covered, unresolvedCities }) {
  /** @type {string[]} */ const f = [];
  if (!listOk) f.push("a_list_abnormal");
  if (isLeaseUnit(m) || /공공|임대/.test(String(m.presale_type ?? ""))) f.push("b_not_private_sale");
  const dates = b.notices.map((n) => n.recruit_date).filter((d) => typeof d === "string").sort();
  const yearOf = (/** @type {string} */ id) => { const x = /^ah-(\d{4})\d{6}$/.exec(id); return x ? Number(x[1]) : null; };
  const before = dates.length ? /** @type {string} */ (dates[0]) <= asOf : b.members.some((x) => { const y = yearOf(x.id); return y != null && y < Number(asOf.slice(0, 4)); });
  if (!before) f.push("c_notice_not_before");
  const ck = cityKey(m.gu);
  if (!covered.has(ck)) f.push("d_sgg_not_covered");
  else if (unresolvedCities.has(ck)) f.push("d_sgg_unresolved");
  // (e) 유효한 명단 값은 덮지 않는다 — 단 이 수집기가 지난 회차에 쓴 「미등재 0」(listed_as_of 없음 · 더 옛 기준일)은 기준일만 새로 한다
  // (안 그러면 6개월 뒤 만료 → KOSIS 가 채움 → 다음 회차 다시 0 으로 오락가락한다).
  const ownOldZero = m.unsold === 0 && m.unsold_listed_as_of == null && typeof m.unsold_as_of === "string" && m.unsold_as_of < asOf;
  if (m.unsold_source === "govlist" && !ownOldZero && isApplyhomeExpired(m.unsold_as_of, now, GOVLIST_EXPIRY_MONTHS) !== true) f.push("e_govlist_valid");
  return f;
}

/**
 * 한 출처의 계획.
 * @param {{ source: string; asOf: string; now: Date; complexes: GovComplex[]; results: MatchResult[]; bundles: Bundle[];
 *   sggUniverse: string[]; listRowCount: number; prevRowCount: number | null; absentZero: boolean }} p
 * @returns {PlanRow[]}
 */
export function planSource(p) {
  const { source, asOf, now, complexes, results, bundles } = p;
  const cxByNo = new Map(complexes.map((c) => [c.complex_no, c]));
  /** @type {Map<string, GovComplex[]>} */ const attached = new Map();
  /** @type {Map<string, string[]>} */ const keysOf = new Map();
  for (const r of results) {
    if (!r.bundle_key || (r.state !== "strong" && r.state !== "decided")) continue;
    const cx = /** @type {GovComplex} */ (cxByNo.get(r.complex_no));
    attached.set(r.bundle_key, [...(attached.get(r.bundle_key) ?? []), cx]);
    keysOf.set(r.bundle_key, [...(keysOf.get(r.bundle_key) ?? []), cx.list_key]);
  }
  const expiredSource = isApplyhomeExpired(asOf, now, GOVLIST_EXPIRY_MONTHS) === true;
  const listOk = p.listRowCount > 0 && (p.prevRowCount == null || p.listRowCount >= p.prevRowCount * GOVLIST_DROP_RATIO);
  const covered = new Set([...p.sggUniverse.map(cityKey), ...complexes.map((c) => cityKey(c.sgg))].filter(Boolean));
  const unresolvedCities = new Set(results.filter((r) => !RESOLVED.has(r.state)).map((r) => cityKey(cxByNo.get(r.complex_no)?.sgg)));
  const zeroOn = p.absentZero && ABSENT_ZERO_SOURCES.includes(source);
  // 시군구를 못 읽은 명단 단지가 하나라도 있으면 "그 시군구엔 명단 행이 없다"를 말할 수 없다 — 그 출처 전체의 미등재→0 을 끈다
  // (세션687 실 dry-run: 대구 동구 구간 시군구 칸이 비어 동구 명단 12단지가 매칭 0 → (d) 가 「동구 명단 0 = 해소」로 통과해
  //  명단에 실린 아츠베르 1·2단지에 0 을 쓰는 계획이 나왔다. 파서가 합계 줄로 채우게 고친 뒤에도 이중 방어로 둔다).
  const sggMissing = complexes.some((c) => !c.sgg);

  /** @type {PlanRow[]} */ const out = [];
  for (const b of bundles) {
    const cxs = attached.get(b.key);
    const listed = cxs ? listedValue(cxs, asOf) : null;
    for (const m of b.members) {
      const before = sixOf(m);
      const head = { source, id: m.id, name: m.name, region: m.region, gu: m.gu, bundle_key: b.key, before, list_keys: keysOf.get(b.key) ?? [] };
      const skip = skipReason(m, asOf, now);
      if (listed) {
        if (expiredSource) { out.push({ ...head, action: "skip_expired_source", reasons: [`as_of ${asOf} + ${GOVLIST_EXPIRY_MONTHS}개월 지남`], after: null }); continue; }
        if (skip) { out.push({ ...head, action: skip, reasons: [], after: null }); continue; }
        if (sameSix(before, listed.six)) { out.push({ ...head, action: "unchanged", reasons: [listed.kind], after: listed.six }); continue; }
        out.push({ ...head, action: listed.kind === "hidden" ? "write_listed_hidden" : "write_listed_number", reasons: [], after: listed.six });
        continue;
      }
      if (m.unsold_source === "govlist" && typeof m.unsold_listed_as_of === "string") {
        out.push({ ...head, action: "dropped_from_list", reasons: ["지난 명단엔 있었고 이번엔 없음 — 만료·KOSIS 는 PR-4"], after: null });
        continue;
      }
      if (!zeroOn) { out.push({ ...head, action: "not_listed", reasons: [p.absentZero ? "absent_zero_not_for_source" : "absent_zero_off"], after: null }); continue; }
      if (expiredSource) { out.push({ ...head, action: "skip_expired_source", reasons: [], after: null }); continue; }
      if (skip) { out.push({ ...head, action: skip, reasons: ["absent"], after: null }); continue; }
      const fails = absentZeroFails({ m, b, asOf, now, listOk, covered, unresolvedCities });
      if (sggMissing) fails.unshift("d_list_sgg_missing");
      if (fails.length) { out.push({ ...head, action: "not_listed", reasons: fails, after: null }); continue; }
      /** @type {Six} */ const zero = { unsold: 0, unsold_rate: 0, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: null, unsold_listed_total: null };
      if (sameSix(before, zero)) { out.push({ ...head, action: "unchanged", reasons: ["absent_zero"], after: zero }); continue; }
      out.push({ ...head, action: "write_absent_zero", reasons: [], after: zero });
    }
  }
  return out;
}

/** 쓰는 행인가. @param {PlanRow} r */
export const isWrite = (r) => r.action.startsWith("write_");

/**
 * 값 변화 꼴(data-changing-run-approval §1 — 규칙 이름이 아니라 값의 변화로 센다).
 * @param {PlanRow} r
 */
export function changeClass(r) {
  if (!isWrite(r) || !r.after) return "변화 없음";
  const a = r.before.unsold, b = r.after.unsold;
  if (a == null && b != null) return "빈칸→값";
  if (a != null && b == null) return a > 0 ? "값>0→빈칸" : "0→빈칸";
  if (a != null && b != null && a > 0 && b === 0) return "값>0→0";
  if (a !== b) return "값→다른 값";
  return "값 같음·칸만 바뀜";
}

/**
 * 전이표 요약(시도별 · 행동별 · 값 변화 꼴 · 출처 전이 · 바뀔 단지 수).
 * @param {PlanRow[]} plan
 */
export function summarize(plan) {
  /** @type {Record<string, Record<string, number>>} */ const byAction = {};
  /** @type {Record<string, Record<string, number>>} */ const byChange = {};
  /** @type {Record<string, number>} */ const sourceShift = {};
  /** @type {Set<string>} */ const bundles = new Set();
  for (const r of plan) {
    const reg = r.region ?? "?";
    (byAction[reg] ??= {})[r.action] = (byAction[reg][r.action] ?? 0) + 1;
    if (!isWrite(r)) continue;
    const c = changeClass(r);
    (byChange[reg] ??= {})[c] = (byChange[reg][c] ?? 0) + 1;
    const k = `${r.before.unsold_source ?? "null"}→${r.after?.unsold_source ?? "null"}`;
    sourceShift[k] = (sourceShift[k] ?? 0) + 1;
    bundles.add(`${r.source}|${r.bundle_key}`);
  }
  return { byAction, byChange, sourceShift, writeRows: plan.filter(isWrite).length, changedBundles: bundles.size };
}

/**
 * 차단기(설계서 §5-⑥): 바뀔 단지 > 50곳 · 명단 행 수가 전 회차의 50% 미만.
 * @param {{ changedBundles: number; lists: Array<{ source: string; rows: number; prevRows: number | null }> }} p
 * @returns {{ tripped: boolean; reasons: string[] }}
 */
export function breaker({ changedBundles, lists }) {
  /** @type {string[]} */ const reasons = [];
  if (changedBundles > GOVLIST_BREAKER_MAX_BUNDLES) reasons.push(`바뀔 단지 ${changedBundles}곳 > ${GOVLIST_BREAKER_MAX_BUNDLES}곳`);
  for (const l of lists) if (l.prevRows != null && l.rows < l.prevRows * GOVLIST_DROP_RATIO) reasons.push(`${l.source} 명단 행 ${l.rows} < 전 회차 ${l.prevRows} × ${GOVLIST_DROP_RATIO}`);
  return { tripped: reasons.length > 0, reasons };
}

/** @param {PlanRow} r */
const sig = (r) => JSON.stringify([r.action, VALUE_KEYS.map((k) => r.before[k] ?? null), VALUE_KEYS.map((k) => r.after?.[k] ?? null)]);

/**
 * 다시 세운 계획이 승인한 계획과 **쓰는 행의 id·행동·이전 값·새 값까지** 같은가(data-changing-run-approval §2 — 명단 반영은 개수 일치로 부족).
 * @param {PlanRow[]} current @param {PlanRow[]} approved
 */
export function comparePlans(current, approved) {
  const cur = new Map(current.filter(isWrite).map((r) => [r.id, r]));
  const apr = new Map(approved.filter(isWrite).map((r) => [r.id, r]));
  const onlyCurrent = [...cur.keys()].filter((id) => !apr.has(id));
  const onlyApproved = [...apr.keys()].filter((id) => !cur.has(id));
  const changed = [...cur.keys()].filter((id) => apr.has(id) && sig(/** @type {PlanRow} */ (cur.get(id))) !== sig(/** @type {PlanRow} */ (apr.get(id))));
  return { same: !onlyCurrent.length && !onlyApproved.length && !changed.length, onlyCurrent, onlyApproved, changed };
}

/**
 * 바꾸기 전 사본 + 역계획(`backfill-unsold-source.mjs --plan=` 꼴 — expect = 새 값 4칸, set = 옛 값 6칸).
 * @param {PlanRow[]} plan @param {{ asOf: string; source: string; generatedAt: string }} meta
 */
export function buildBackup(plan, meta) {
  const rows = plan.filter(isWrite);
  return {
    before: { ...meta, kind: "govlist-before", rows: rows.map((r) => ({ id: r.id, name: r.name, ...r.before })) },
    restore: {
      ...meta, kind: "govlist-restore",
      note: "되돌리기 = node scripts/backfill-unsold-source.mjs --plan=<이 파일>(미리보기) → --apply. expect 는 그 도구가 읽는 4칸만 — 새 2칸(unsold_listed_*)은 set 에만 있다.",
      plan: rows.map((r) => ({
        id: r.id, name: r.name ?? undefined, op: "restore_govlist",
        expect: Object.fromEntries(RESTORE_EXPECT_KEYS.map((k) => [k, r.after?.[k] ?? null])),
        set: Object.fromEntries(VALUE_KEYS.map((k) => [k, r.before[k] ?? null])),
      })),
    },
  };
}

/**
 * `unsold_gov_list` 에 넣을 행(원문 행 = 면적대 줄 하나 · 매칭 상태는 그 단지의 결과).
 * @param {{ source: string; asOf: string; batchId: string; fileUrl: string; fetchedAt: string; rows: GovRow[]; results: MatchResult[] }} p
 */
export function buildListRows({ source, asOf, batchId, fileUrl, fetchedAt, rows, results }) {
  const byNo = new Map(results.map((r) => [r.complex_no, r]));
  return rows.map((r) => {
    const m = byNo.get(r.complex_no);
    return {
      source, as_of: asOf, batch_id: batchId, row_no: r.row_no, batch_rows: rows.length, raw: r.raw,
      sgg: r.sgg, emd: r.emd, raw_name: r.raw_name, address: r.address, builder: r.builder, developer: r.developer,
      is_public: r.is_public, is_rental: r.is_rental, area_band: r.area_band, total_units: r.total_units, unsold_units: r.unsold_units, hidden: r.hidden,
      apartment_id: m?.apartment_id ?? null, match_method: m?.method ?? "none", match_score: m?.score ?? null, match_state: m?.state ?? "none",
      file_url: fileUrl, fetched_at: fetchedAt,
    };
  });
}
