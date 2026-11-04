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
import { clampUnsoldRate, isApplyhomeExpired, GOVLIST_EXPIRY_MONTHS } from "./_shared.mjs";
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
 * govlist 값 존중 기간(개월) — 사장님 결정 Q2 「6개월」(11/02 01:1x). 정본 = `_shared.mjs` GOVLIST_EXPIRY_MONTHS 하나(VIEW SQL ·
 * KOSIS 수집기 · 감시 ⑫(h) 가 같은 상수 — `_view-unsold-govlist-sql.test.mjs` 가 VIEW 와 맞댄다). 세션692 PR-4 에서 이 파일의 쌍둥이 상수를 지우고
 * 다시 내보내기만 한다(이 모듈에서 가져다 쓰던 시험·도구 호환).
 */
export { GOVLIST_EXPIRY_MONTHS };
/** 바뀔 단지(묶음) 수 차단기 — 경기 기준(설계서 §5-⑥ · :85 「경기만으로 50곳을 넘을 수 있어」). */
export const GOVLIST_BREAKER_MAX_BUNDLES = 50;
/**
 * 출처별 차단 기준 — **값이 바뀌는** 묶음 수(「값 같음·칸만 바뀜」 = 이미 govlist 인 행의 기준월만 새로 쓰는 묶음은 안 센다 ·
 * 「빈칸→비공개(새 등재)」·「값 같음·출처·비율 바뀜」은 센다)가 이 값을 넘으면 막는다.
 * 대구·충남 = 10곳 **임시** — 12/08 첫 평시 회차 뒤 실측해 다시 정함(BACKLOG A-28). 👤 「기준은 첫 반영 실측 뒤 정함」 —
 * 실측 전에는 멈춤이 더 잦은 쪽(사장님 승인이 늘 뿐 데이터는 안전)으로 둔다(세션693 검사 adv🟠1·blind🟠1).
 * 표에 없는 출처는 가장 작은 기준(10)을 쓴다.
 */
export const GOVLIST_BREAKER_LIMITS = Object.freeze({ daegu: 10, chungnam: 10, gyeonggi: GOVLIST_BREAKER_MAX_BUNDLES });
/** @param {string} source */
export const breakerLimitOf = (source) => /** @type {Record<string, number>} */ (GOVLIST_BREAKER_LIMITS)[source] ?? Math.min(...Object.values(GOVLIST_BREAKER_LIMITS));
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
 * - 총분양 Σ 는 단지 하나라도 못 읽혔으면 NULL(일부만 더한 합 금지 — G7①) · 0 이어도 NULL(CHECK > 0)
 * - kind `blank` = 원문에 비공개 표시가 없는데 미분양 칸이 빈칸·「-」(쓰지 않는다 — 「비공개」로 둔갑 금지, G7③)
 * - kind `over` = 미분양 > 총분양(원본 오기 — 쓰지 않는다, G7②)
 * @param {GovComplex[]} cxs @param {string} asOf
 * @returns {{ six: Six; kind: "hidden" | "number" | "blank" | "over" }}
 */
export function listedValue(cxs, asOf) {
  const sumT = cxs.some((c) => c.total_units == null) ? null : cxs.reduce((s, c) => s + Number(c.total_units), 0);
  const T = sumT != null && sumT > 0 ? sumT : null;
  const kind = cxs.some((c) => c.unsold_over_total) ? "over"
    : cxs.some((c) => !c.hidden && c.unsold_units == null) ? "blank"
      : cxs.some((c) => c.hidden) ? "hidden" : "number";
  if (kind !== "number") {
    return { kind, six: { unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: asOf, unsold_listed_total: T } };
  }
  const U = cxs.reduce((s, c) => s + Number(c.unsold_units), 0);
  const rate = T != null ? clampUnsoldRate(Math.round((U / T) * 1000) / 10) : null;
  return { kind, six: { unsold: U, unsold_rate: rate, unsold_source: "govlist", unsold_as_of: asOf, unsold_listed_as_of: asOf, unsold_listed_total: T } };
}

/**
 * apartments 의 미분양 꼴 CHECK 4개 — 마이그 `20261102000000_unsold_gov_list.sql` 의 식과 **글자가 같다**
 * (`_govlist-plan.test.mjs` 가 SQL 파일에서 `CHECK (<식>)` 을 찾아 맞대고, 같은 식을 3값 논리로 돌려 아래 JS 판정과 비교한다).
 * 수집기는 쓰기 전에 계획의 모든 쓰는 행을 `rowCheckViolations` 로 돌려 DB 가 거부할 행을 미리 막는다(G1③).
 */
export const GOVLIST_ROW_CHECKS = Object.freeze({
  apartments_unsold_source_check: "unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold', 'govlist')",
  apartments_unsold_listed_total_check: "unsold_listed_total IS NULL OR unsold_listed_total > 0",
  apartments_unsold_govlist_asof_check: "unsold_source IS DISTINCT FROM 'govlist' OR (unsold_as_of IS NOT NULL AND (unsold IS NOT NULL OR unsold_listed_as_of IS NOT NULL))",
  apartments_unsold_govlist_hidden_rate_check: "NOT (unsold_source = 'govlist' AND unsold IS NULL AND unsold_rate IS NOT NULL)",
});

/**
 * 6칸 값이 위 CHECK 를 어기는 제약 이름(없으면 빈 배열). SQL CHECK 는 결과가 NULL 이어도 통과 — 여기 식은 그 결과와 같게 쓴다.
 * @param {Six} s
 * @returns {string[]}
 */
export function rowCheckViolations(s) {
  /** @type {string[]} */ const v = [];
  if (!(s.unsold_source == null || ["kosis", "applyhome", "hold", "govlist"].includes(s.unsold_source))) v.push("apartments_unsold_source_check");
  if (!(s.unsold_listed_total == null || s.unsold_listed_total > 0)) v.push("apartments_unsold_listed_total_check");
  if (!(s.unsold_source !== "govlist" || (s.unsold_as_of != null && (s.unsold != null || s.unsold_listed_as_of != null)))) v.push("apartments_unsold_govlist_asof_check");
  if (s.unsold_source === "govlist" && s.unsold == null && s.unsold_rate != null) v.push("apartments_unsold_govlist_hidden_rate_check");
  return v;
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
 *   sggUniverse: string[]; sggTotals?: Record<string, number | null>; listRowCount: number; prevRowCount: number | null; absentZero: boolean }} p
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
  // G4: 총괄표엔 미분양이 있는데 명단 행이 0 인 시군구 — 명단이 그 구를 빠뜨렸을 수 있다 → 미해소
  const listCities = new Set(complexes.map((c) => cityKey(c.sgg)));
  for (const [name, n] of Object.entries(p.sggTotals ?? {})) if (n != null && n > 0 && !listCities.has(cityKey(name))) unresolvedCities.add(cityKey(name));
  // G4: 명단 단지의 시군구가 총괄표에 없으면(표기 어긋남 — 「달서」 vs 「달서구」) 어느 구를 덮는지 못 믿는다 → 출처 전체 끔
  const universeCities = new Set(p.sggUniverse.map(cityKey));
  const sggUnknown = complexes.some((c) => c.sgg && !universeCities.has(cityKey(c.sgg)));
  // G3: 어느 명단 단지의 후보(유사도 ≥ WEAK_SIM)였던 묶음은 「명단에 없다」고 말할 수 없다 — 쌍둥이 묶음·이름 비슷한 진짜 짝이 0 을 받는 길 차단
  const candidateBundles = new Set(results.flatMap((r) => r.candidates.map((c) => c.bundle_key)));
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
        if (listed.kind === "blank") { out.push({ ...head, action: "skip_unsold_blank", reasons: ["명단에 실렸으나 미분양 칸 빈칸·「-」 — 비공개 표시 없음"], after: null }); continue; }
        if (listed.kind === "over") { out.push({ ...head, action: "skip_list_inconsistent", reasons: ["명단 미분양 > 총분양(원본 오기)"], after: null }); continue; }
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
      if (candidateBundles.has(b.key)) fails.unshift("d_candidate_of_list");
      if (sggUnknown) fails.unshift("d_list_sgg_unknown");
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
  // 여기부터 unsold 가 같다(둘 다 빈칸이거나 같은 수). 세션693 2차 보완 C1(재검사 adv🟠1): 「칸만 바뀜」은
  //   앞이 이미 govlist + 비공개 여부 같음 + 비율 같음일 때만 — 나머지(새 비공개 등재 · 출처·비율만 바뀜)는 손님 화면이 바뀌므로 따로 센다.
  const hiddenBefore = isHiddenSix(r.before), hiddenAfter = isHiddenSix(r.after);
  if (!hiddenBefore && hiddenAfter) return NEW_HIDDEN_CLASS;
  if (r.before.unsold_source === "govlist" && hiddenBefore === hiddenAfter && (r.before.unsold_rate ?? null) === (r.after.unsold_rate ?? null)) return SAME_VALUE_CLASS;
  return "값 같음·출처·비율 바뀜";
}
/** govlist 비공개 등재(값 빈칸)인가. @param {Six | null} s */
const isHiddenSix = (s) => !!s && s.unsold_source === "govlist" && s.unsold == null;
/**
 * 앞이 이미 govlist 이고 값·비율·비공개 여부가 그대로이며 기준월 등 칸만 바뀌는 쓰는 행의 꼴 이름 — 차단기는 이 꼴만 있는 묶음을 세지 않는다.
 * (빈칸 → 비공개 = `NEW_HIDDEN_CLASS` · 다른 출처 → govlist 같은 값 = 「값 같음·출처·비율 바뀜」은 센다)
 */
export const SAME_VALUE_CLASS = "값 같음·칸만 바뀜";
/** 모름(빈칸 — kosis·null·hold) → 등재·수 비공개(govlist 빈칸) — 새 비공개 등재. 칩·필터·점수 문구가 바뀌므로 차단기가 센다(C1). */
export const NEW_HIDDEN_CLASS = "빈칸→비공개(새 등재)";

/**
 * 전이표 요약(시도별 · 행동별 · 값 변화 꼴 · 출처 전이 · 바뀔 단지 수).
 * @param {PlanRow[]} plan
 */
export function summarize(plan) {
  /** @type {Record<string, Record<string, number>>} */ const byAction = {};
  /** @type {Record<string, Record<string, number>>} */ const byChange = {};
  /** @type {Record<string, number>} */ const sourceShift = {};
  /** @type {Set<string>} */ const bundles = new Set();
  /** 값이 바뀌는 묶음(출처별) — 「값 같음·칸만 바뀜」만 있는 묶음은 뺀다(차단기 재료). @type {Map<string, Set<string>>} */ const valueBundles = new Map();
  for (const r of plan) {
    const reg = r.region ?? "?";
    (byAction[reg] ??= {})[r.action] = (byAction[reg][r.action] ?? 0) + 1;
    if (!isWrite(r)) continue;
    const c = changeClass(r);
    (byChange[reg] ??= {})[c] = (byChange[reg][c] ?? 0) + 1;
    const k = `${r.before.unsold_source ?? "null"}→${r.after?.unsold_source ?? "null"}`;
    sourceShift[k] = (sourceShift[k] ?? 0) + 1;
    bundles.add(`${r.source}|${r.bundle_key}`);
    if (c !== SAME_VALUE_CLASS) {
      const s = valueBundles.get(r.source) ?? new Set();
      s.add(r.bundle_key);
      valueBundles.set(r.source, s);
    }
  }
  /** @type {Record<string, number>} */ const valueChangedBySource = {};
  for (const [s, set] of [...valueBundles].sort(([a], [b]) => a.localeCompare(b))) valueChangedBySource[s] = set.size;
  return { byAction, byChange, sourceShift, writeRows: plan.filter(isWrite).length, changedBundles: bundles.size, valueChangedBySource };
}

/**
 * 차단기(설계서 §5-⑥ · 세션693 보완 B1): 출처마다 **값이 바뀌는** 묶음 수 > 출처 기준(`GOVLIST_BREAKER_LIMITS` — 대구·충남 10 임시 · 경기 50)
 * · 명단 행 수가 전 회차의 50% 미만. 기준월만 새로 쓰는 묶음(「값 같음·칸만 바뀜」)은 평시 달마다 있는 일이라 세지 않는다(쓰기는 그대로).
 * @param {{ valueChangedBySource: Record<string, number>; lists: Array<{ source: string; rows: number; prevRows: number | null }> }} p
 * @returns {{ tripped: boolean; reasons: string[] }}
 */
export function breaker({ valueChangedBySource, lists }) {
  /** @type {string[]} */ const reasons = [];
  for (const [source, n] of Object.entries(valueChangedBySource)) {
    const limit = breakerLimitOf(source);
    if (n > limit) reasons.push(`${source} 값 바뀔 단지 ${n}곳 > ${limit}곳`);
  }
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
