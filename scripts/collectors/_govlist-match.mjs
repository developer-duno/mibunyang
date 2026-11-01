// @ts-check
/**
 * 명단 단지(면적대 줄 묶음) → 우리 묶음(같은 단지 열쇠) 매칭. 설계서 §4 표 1줄(대구·충남) 그대로.
 *
 * - 1차 열쇠: 소재지 글자에서 뽑은 이름 후보 ↔ `apartments.name`(`normalizeComplexName` 뼈대끼리 `stringSimilarity`).
 * - 게이트: 시도(출처가 정함) + **구군 정확 일치**(공백 무시 · 우리 행 gu 가 「천안시」뿐이면 주소에 명단의 구가 있을 때만)
 *   · 읍면동이 있으면 우리 행 dong(숫자 뗀 것)·주소·도로명 주소에 그 동(또는 명단 소재지 지번의 동)이 들어 있어야 한다.
 * - 뒷받침 1 — 세대: 묶음 안 공고를 공고 번호로 중복 제거 → 명단 분양승인일에 **모집공고일이 가장 가까운**(없으면 가장 이른) 공고 하나의
 *   `applyhome_unit_supply` 일반+특별 합(면적형 중복 제거 · 없으면 그 공고 행의 `competition_supply`) ±10%. 어긋나면 weak(none 아님).
 *   (묶음 세대수 `pickBundleUnits` 는 재건축·조합분 때문에 안 맞는다 — 두류 433 vs 명단 52.)
 * - 뒷받침 2 — 시공사: `resolveBuilder` 로 명단 시공사·시행사 둘 다를 우리 행 builder 와 맞댄다(두류는 우리 builder 칸 = 명단 시행사 ·
 *   충남은 시공사/시행사 칸이 뒤바뀐 행이 있다). 등급을 올리지는 않고 근거로만 남긴다.
 * - 등급: strong = 이름 ≥0.9 + 세대 일치 + 차수 일치(한쪽만 차수 표기면 weak) + 블록 이름 아님 · weak = 그 밖에 이름 ≥0.75(또는 뼈대 포함)
 *   · none = 후보 없음. 차수 어긋남(`phaseConsistent` conflict)·블록 어긋남(`blockConflict`)은 후보에서 뺀다.
 * - 한 명단 단지가 두 묶음에 strong → 둘 다 안 붙임(weak·`two_bundles`) · 두 명단 단지가 한 묶음에 strong → 둘 다 안 붙임(`bundle_shared`).
 * - 블록 이름(RH-3·B-2BL·44B-1L) · weak · 충돌은 사람 판정 파일 `docs/audits/govlist-match-decisions.json` 에 있는 것만 반영한다
 *   (active = 그 묶음에 붙임 → decided · rejected + bundle_key = 그 짝 금지 · rejected + bundle_key null = 우리 목록에 없는 단지 → rejected).
 *
 * 순수 함수 — DB·시각을 보지 않는다.
 */
import { normalizeComplexName, pickRepresentativeId } from "./_same-complex.mjs";
import { phaseConsistent, blockConflict, normalizeDongToken } from "./_kakao-poi.mjs";
import { resolveBuilder, stringSimilarity } from "./_shared.mjs";
import { bundleKeyOf } from "./_unsold-bundle.mjs";

/** @typedef {import("./_govlist-parse.mjs").GovComplex} GovComplex */
/**
 * @typedef {{ id: string; name: string | null; region: string | null; gu: string | null; dong: string | null; address: string | null;
 *   road_address?: string | null; builder: string | null; units: number | null; unit_source?: string | null; unsold: number | null;
 *   unsold_rate: number | null; unsold_source: string | null; unsold_as_of: string | null; unsold_listed_as_of?: string | null;
 *   unsold_listed_total?: number | null; presale_type: string | null; complex_key: string | null; naver_presale_no?: string | null;
 *   competition_supply?: number | null; completion?: string | null }} AptRow
 * @typedef {{ apartment_id: string; house_manage_no: string; model_no: string | null; general_supply: number | null; special_supply: number | null; source?: string | null }} SupplyRow
 * @typedef {{ apartment_id: string; house_manage_no: string; recruit_date: string | null }} ScheduleRow
 * @typedef {{ house_manage_no: string; recruit_date: string | null; supply: number | null; kind: string | null }} Notice
 * @typedef {{ key: string; members: AptRow[]; repId: string; notices: Notice[] }} Bundle
 * @typedef {{ list_key: string; bundle_key: string | null; status: "active" | "rejected"; names?: string; why?: string; decided_at?: string }} MatchDecision
 * @typedef {{ bundle_key: string; score: number; sim: number; unitsOk: boolean | null; supply: number | null; notice: string | null;
 *   builderOk: boolean; phase: string; contain: boolean; reasons: string[] }} Candidate
 * @typedef {{ complex_no: number; list_key: string; state: "strong" | "weak" | "none" | "decided" | "rejected"; bundle_key: string | null;
 *   apartment_id: string | null; method: string; score: number | null; best: Candidate | null; candidates: Candidate[]; reasons: string[] }} MatchResult
 */

export const STRONG_SIM = 0.9;
export const WEAK_SIM = 0.75;
export const UNITS_TOL = 0.1;
/** 뼈대 포함(한쪽이 다른 쪽 안에 통째로)을 이름 일치로 볼 최소 글자 수 — 「센트레빌」 같은 짧은 상표 하나로는 안 붙는다. */
export const CONTAIN_MIN_LEN = 6;

/** 블록 이름 — 「RH-3블럭」·「B-2BL」·「44B-1L」·「A1BL」. 자동으로 strong 을 주지 않는다. @param {string} name */
export function isBlockName(name) {
  const s = String(name ?? "").normalize("NFKC").toUpperCase();
  return /[A-Z]{1,3}\s*-\s*\d+\s*(?:BL|블럭|블록|L)?/.test(s) || /\d+[A-Z]-\d+L\b/.test(s) || /(?<![A-Z])[A-Z]{0,3}\d+\s*(?:BL|블럭|블록)/.test(s);
}

/** 공백 뺀 소문자. @param {unknown} s */
const squash = (s) => String(s ?? "").replace(/\s+/g, "");

/**
 * 명단 구군 ↔ 우리 행 gu. 정확 일치(공백 무시), 또는 우리 gu 가 명단의 시(첫 낱말)뿐이고 주소에 명단의 구가 있을 때.
 * @param {string | null} listSgg @param {AptRow} apt
 */
export function guMatches(listSgg, apt) {
  if (!listSgg || !apt.gu) return false;
  if (squash(listSgg) === squash(apt.gu)) return true;
  const t = listSgg.trim().split(/\s+/);
  if (t.length === 2 && squash(apt.gu) === t[0]) {
    const addr = `${apt.address ?? ""} ${apt.road_address ?? ""}`;
    return addr.split(/\s+/).includes(t[1]);
  }
  return false;
}

/**
 * 읍면동 게이트 — 명단 읍면동(또는 소재지 지번 조각의 첫 동·읍·면) 중 하나가 우리 행의 dong(숫자 뗀 것)·주소 낱말에 있다.
 * 명단에 읍면동이 없으면 통과.
 * @param {GovComplex} cx @param {AptRow} apt
 */
export function emdMatches(cx, apt) {
  /** @type {string[]} */ const want = [];
  if (cx.emd) want.push(normalizeDongToken(cx.emd.trim()));
  const addrTok = String(cx.address ?? "").split(/\s+/).find((w) => /(?:동|읍|면|가)$/.test(w) && !/구$/.test(w));
  if (addrTok) want.push(normalizeDongToken(addrTok.replace(/\d+가$/, "")));
  if (!want.length) return true;
  /** @type {Set<string>} */ const have = new Set();
  if (apt.dong) have.add(normalizeDongToken(apt.dong.trim()));
  for (const w of `${apt.address ?? ""} ${apt.road_address ?? ""}`.split(/\s+/)) if (w) { have.add(w); have.add(normalizeDongToken(w)); have.add(w.replace(/\d+가$/, "")); }
  return want.some((w) => have.has(w));
}

/**
 * 묶음의 공고 목록(공고 번호로 중복 제거 · 면적형 중복 제거 뒤 일반+특별 합).
 * @param {AptRow[]} members @param {SupplyRow[]} supplies @param {ScheduleRow[]} schedules
 * @returns {Notice[]}
 */
export function buildNotices(members, supplies, schedules) {
  const ids = new Set(members.map((m) => m.id));
  /** @type {Map<string, { date: string | null; models: Map<string, number>; kind: string | null }>} */ const by = new Map();
  const get = (/** @type {string} */ no) => {
    let n = by.get(no);
    if (!n) { n = { date: null, models: new Map(), kind: null }; by.set(no, n); }
    return n;
  };
  for (const s of schedules) {
    if (!ids.has(s.apartment_id) || !s.house_manage_no) continue;
    const n = get(String(s.house_manage_no));
    if (s.recruit_date && (!n.date || s.recruit_date < n.date)) n.date = s.recruit_date;
  }
  for (const u of supplies) {
    if (!ids.has(u.apartment_id) || !u.house_manage_no) continue;
    const n = get(String(u.house_manage_no));
    const mk = String(u.model_no ?? "");
    if (!n.models.has(mk)) n.models.set(mk, Number(u.general_supply ?? 0) + Number(u.special_supply ?? 0));
    if (u.source && !n.kind) n.kind = u.source;
  }
  /** @type {Notice[]} */ const out = [];
  for (const [no, n] of by) {
    let supply = n.models.size ? [...n.models.values()].reduce((a, b) => a + b, 0) : null;
    if (supply == null) {
      const own = members.find((m) => m.id === `ah-${no}`);
      supply = own?.competition_supply ?? null;
    }
    out.push({ house_manage_no: no, recruit_date: n.date, supply, kind: n.kind });
  }
  return out.sort((a, b) => (a.house_manage_no < b.house_manage_no ? -1 : 1));
}

/** "YYYY-MM-DD" → 일 수(비교용). @param {string} d */
const dayNo = (d) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd) / 86400000; };

/**
 * 명단 분양승인일에 모집공고일이 가장 가까운 공고(같으면 이른 쪽) · 승인일이 없으면 가장 이른 공고 · 날짜 있는 공고가 없으면 번호가 가장 작은 공고.
 * @param {Notice[]} notices @param {string | null} approval
 * @returns {Notice | null}
 */
export function pickNotice(notices, approval) {
  const dated = notices.filter((n) => n.recruit_date);
  if (dated.length) {
    if (approval) {
      return [...dated].sort((a, b) => {
        const da = Math.abs(dayNo(/** @type {string} */ (a.recruit_date)) - dayNo(approval));
        const db = Math.abs(dayNo(/** @type {string} */ (b.recruit_date)) - dayNo(approval));
        return da - db || (String(a.recruit_date) < String(b.recruit_date) ? -1 : 1);
      })[0];
    }
    return [...dated].sort((a, b) => (String(a.recruit_date) < String(b.recruit_date) ? -1 : 1))[0];
  }
  return notices[0] ?? null;
}

/**
 * 우리 행 → 묶음(`bundleKeyOf` — 임대·(오) 행은 자기 묶음).
 * @param {AptRow[]} rows @param {SupplyRow[]} supplies @param {ScheduleRow[]} schedules
 * @returns {Bundle[]}
 */
export function buildBundles(rows, supplies, schedules) {
  /** @type {Map<string, AptRow[]>} */ const by = new Map();
  for (const r of rows) {
    const k = bundleKeyOf(r);
    const a = by.get(k);
    if (a) a.push(r); else by.set(k, [r]);
  }
  return [...by].map(([key, members]) => ({ key, members, repId: pickRepresentativeId(members), notices: buildNotices(members, supplies, schedules) }));
}

/**
 * 시공사·시행사 비교 열쇠 — `resolveBuilder` 별칭 뒤 띄어쓰기·법인 표기를 뗀다(세션687 시험이 잡음: 명단 「두류야외음악당 지역주택조합」 ↔
 * 우리 「두류야외음악당지역주택조합」 · 「주식회사 동부건설」 ↔ 「동부건설」 을 resolveBuilder 만으로는 다른 회사로 봤다).
 * @param {string} name
 */
export const builderKey = (name) => squash(resolveBuilder(name)).replace(/주식회사|㈜|\(주\)|\(유\)|유한회사|\(재\)/g, "");

/** 이름 뼈대. @param {string} n */
const skel = (n) => normalizeComplexName(n).skel;

/**
 * 한 명단 단지 × 한 묶음 → 후보(게이트를 못 넘거나 이름이 너무 멀면 null).
 * @param {GovComplex} cx @param {Bundle} b
 * @returns {Candidate | null}
 */
export function scoreCandidate(cx, b) {
  const gated = b.members.filter((m) => guMatches(cx.sgg, m));
  if (!gated.length) return null;
  const emdOk = gated.some((m) => emdMatches(cx, m));
  if (!emdOk) return null;
  let best = { sim: 0, contain: false, phase: "ok", cand: "", member: "" };
  for (const c of cx.name_candidates) {
    const cs = skel(c);
    if (!cs) continue;
    for (const m of gated) {
      if (!m.name) continue;
      if (blockConflict(c, m.name)) continue;
      const ph = phaseConsistent(c, m.name);
      if (ph === "conflict") continue;
      const ms = skel(m.name);
      let sim = stringSimilarity(cs, ms);
      const shorter = cs.length <= ms.length ? cs : ms;
      const contain = shorter.length >= CONTAIN_MIN_LEN && (ms.includes(cs) || cs.includes(ms));
      if (contain && sim < STRONG_SIM) sim = STRONG_SIM;
      if (sim > best.sim || (sim === best.sim && ph === "ok" && best.phase !== "ok")) best = { sim, contain, phase: ph, cand: c, member: m.name };
    }
  }
  if (best.sim < WEAK_SIM) return null;
  const notice = pickNotice(b.notices, cx.approval_date);
  const supply = notice?.supply ?? null;
  const unitsOk = supply == null || !(cx.total_units > 0) ? null : Math.abs(cx.total_units - supply) <= UNITS_TOL * cx.total_units;
  const lb = [cx.builder, cx.developer].filter(Boolean).map((x) => builderKey(/** @type {string} */ (x)));
  const builderOk = b.members.some((m) => m.builder && lb.includes(builderKey(m.builder)));
  /** @type {string[]} */ const reasons = [];
  if (best.contain) reasons.push("name_contain");
  if (best.phase === "one-sided") reasons.push("phase_one_sided");
  if (unitsOk === false) reasons.push(`units_mismatch(${cx.total_units}≠${supply})`);
  if (unitsOk == null) reasons.push("units_unknown");
  if (builderOk) reasons.push("builder_ok");
  return {
    bundle_key: b.key, score: Math.round(best.sim * 1000) / 1000, sim: best.sim, unitsOk, supply,
    notice: notice?.house_manage_no ?? null, builderOk, phase: best.phase, contain: best.contain, reasons,
  };
}

/** @param {Candidate} c @param {boolean} block */
const isStrong = (c, block) => c.sim >= STRONG_SIM && c.unitsOk === true && c.phase === "ok" && !block;

/**
 * 명단 단지 전부 → 매칭 결과(같은 순서).
 * @param {GovComplex[]} complexes @param {Bundle[]} bundles @param {MatchDecision[]} [decisions]
 * @returns {MatchResult[]}
 */
export function matchComplexes(complexes, bundles, decisions = []) {
  const byKey = new Map(bundles.map((b) => [b.key, b]));
  /** @type {MatchResult[]} */ const out = [];
  for (const cx of complexes) {
    const mine = decisions.filter((d) => d.list_key === cx.list_key);
    const banned = new Set(mine.filter((d) => d.status === "rejected" && d.bundle_key).map((d) => /** @type {string} */ (d.bundle_key)));
    const active = mine.find((d) => d.status === "active");
    const noTwin = mine.find((d) => d.status === "rejected" && !d.bundle_key);
    const candidates = bundles.map((b) => (banned.has(b.key) ? null : scoreCandidate(cx, b))).filter((c) => c != null)
      .sort((a, b) => b.sim - a.sim || (a.bundle_key < b.bundle_key ? -1 : 1));
    const base = { complex_no: cx.complex_no, list_key: cx.list_key, candidates, best: candidates[0] ?? null };
    if (active) {
      const b = active.bundle_key ? byKey.get(active.bundle_key) : undefined;
      if (b) { out.push({ ...base, state: "decided", bundle_key: b.key, apartment_id: b.repId, method: "decision", score: null, reasons: ["decision_active"] }); continue; }
      out.push({ ...base, state: "weak", bundle_key: null, apartment_id: null, method: "decision_bundle_missing", score: null, reasons: [`decision_bundle_missing(${active.bundle_key})`] });
      continue;
    }
    if (noTwin) { out.push({ ...base, state: "rejected", bundle_key: null, apartment_id: null, method: "decision", score: null, reasons: ["decision_rejected_no_twin"] }); continue; }
    if (!candidates.length) { out.push({ ...base, state: "none", bundle_key: null, apartment_id: null, method: "none", score: null, reasons: [] }); continue; }
    const block = cx.name_candidates.some(isBlockName);
    const strongs = candidates.filter((c) => isStrong(c, block));
    if (strongs.length === 1) {
      const b = /** @type {Bundle} */ (byKey.get(strongs[0].bundle_key));
      out.push({ ...base, state: "strong", bundle_key: b.key, apartment_id: b.repId, method: strongs[0].contain ? "name_contain+units" : "name+units", score: strongs[0].score, reasons: strongs[0].reasons });
      continue;
    }
    /** @type {string[]} */ const reasons = [...(candidates[0].reasons ?? [])];
    if (strongs.length > 1) reasons.unshift("two_bundles");
    if (block) reasons.unshift("block_name");
    out.push({ ...base, state: "weak", bundle_key: null, apartment_id: null, method: strongs.length > 1 ? "conflict" : "weak", score: candidates[0].score, reasons });
  }
  // 두 명단 단지가 한 묶음에 strong → 둘 다 내린다(사람 판정 decided 끼리는 합산 허용).
  /** @type {Map<string, MatchResult[]>} */ const claim = new Map();
  for (const r of out) if (r.bundle_key && (r.state === "strong" || r.state === "decided")) {
    const a = claim.get(r.bundle_key);
    if (a) a.push(r); else claim.set(r.bundle_key, [r]);
  }
  for (const rs of claim.values()) {
    if (rs.length < 2 || rs.every((r) => r.state === "decided")) continue;
    for (const r of rs) if (r.state === "strong") {
      r.state = "weak"; r.bundle_key = null; r.apartment_id = null; r.method = "conflict"; r.reasons = ["bundle_shared", ...r.reasons];
    }
  }
  return out;
}

/**
 * 사람 판정 파일 읽기(모양 검사 — 깨지면 던진다: 수집기가 API 호출 전에 멈춘다).
 * @param {unknown} json
 * @returns {MatchDecision[]}
 */
export function parseMatchDecisions(json) {
  const o = /** @type {any} */ (json);
  if (!o || typeof o !== "object" || !Array.isArray(o.decisions)) throw new Error("govlist-match-decisions: decisions 배열 없음");
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {Set<string>} */ const activeKeys = new Set();
  return o.decisions.map((/** @type {any} */ d, /** @type {number} */ i) => {
    if (!d || typeof d.list_key !== "string" || !d.list_key.includes("|")) throw new Error(`govlist-match-decisions[${i}]: list_key 형식 불량`);
    if (d.status !== "active" && d.status !== "rejected") throw new Error(`govlist-match-decisions[${i}]: status 는 active|rejected`);
    if (d.bundle_key != null && typeof d.bundle_key !== "string") throw new Error(`govlist-match-decisions[${i}]: bundle_key 는 문자열|null`);
    if (d.status === "active" && !d.bundle_key) throw new Error(`govlist-match-decisions[${i}]: active 는 bundle_key 필요`);
    const k = `${d.list_key}#${d.status}#${d.bundle_key ?? ""}`;
    if (seen.has(k)) throw new Error(`govlist-match-decisions[${i}]: 같은 줄 두 번`);
    seen.add(k);
    if (d.status === "active") {
      if (activeKeys.has(d.list_key)) throw new Error(`govlist-match-decisions[${i}]: ${d.list_key} 에 active 둘 이상`);
      activeKeys.add(d.list_key);
    }
    return { list_key: d.list_key, bundle_key: d.bundle_key ?? null, status: d.status, names: d.names, why: d.why, decided_at: d.decided_at };
  });
}
