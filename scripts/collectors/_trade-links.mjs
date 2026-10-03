// @ts-check
/**
 * 우리 단지 ↔ 실거래 열쇠 묶기 — **순수 함수 모음** (시세 비교 범위 좁히기 나, 세션590)
 *
 * 설계서: docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md §4-2 · §5-1
 * 계획서: docs/superpowers/plans/2026-10-03-trade-scope-b-links-stats.md Task 3 (B3·B4)
 * CLI(읽기·쓰기): assign-trade-links.mjs · 통계(읽는 쪽): trade-stats.mjs + _trade-scope.mjs
 *
 * ## 규칙 요약
 * - 열쇠: 매매·전세 = 국토부 `apt_seq` / 분양권 = `sgg_cd|umd_nm|jibun|정리이름`(분양권 원문엔 apt_seq 가 없다 — `presaleKeyOf`)
 * - 법정동 이름은 **우리 bjd_code 10자리 → 매매 행 (sgg_cd+umd_cd → umd_nm)** 으로만 얻는다.
 *   `apartments.dong` 은 행정동이다(`reverse-geocode.mjs:90` region_type "H" — 세션590 표본 5행 중 4행이 거래 umd_nm 과 다름)
 *   → 그 동에 매매가 하나도 없으면 "동 이름 모름"으로 버린다(사유는 dropped).
 * - 지번 경로: 같은 법정동 + 지번(본번-부번, 우리 부번 0/없음이면 본번만) 일치 → namesCompatible + 우리만 차수 아님
 *   + 유사도 ≥ JIBUN_NAME_MIN + 연도 차 ≤ YEAR_GAP_MAX → `jibun+name`
 * - 이름 경로(지번 없음 · 가짜 지번 · 지번 후보가 0개였거나 **지번 후보가 있었지만 이름 검사를 통과한 것이 0개**):
 *   같은 법정동 + namesCompatible + 우리만 차수 아님 + (유사도 ≥ NAME_ONLY_MIN 또는 공백 뗀 부분문자열) + 연도 차 → `name`
 * - 가짜 지번(지번 경로 안 씀): `coord_shared` 이거나, 같은 (bjd_code·본번·부번)을 쓰는 우리 단지 두 이름이
 *   지번 경로 이름 검사(namesCompatible + 유사도 ≥ 0.6)로도 같은 단지일 수 없을 때(메인 승인 2026-10-03 —
 *   이름이 바뀐 같은 단지 "어울림파밀리에 ↔ 아테라 파밀리에" 는 가짜가 아니고, "금강펜테리움 6차 ↔ 7차" 는 가짜)
 * - 입주 여부와 상관없이 apt_seq·분양권 둘 다 묶는다(갓 입주한 단지는 12개월 거래가 분양권뿐일 수 있다 — 운암 1단지).
 *   판정에 쓸 종류(입주 후 매매 / 입주 전 분양권, R2)는 통계 쪽 `_trade-scope.mjs` 가 고른다
 * - hold: 한 열쇠가 서로 다른 complex_key 묶음 둘 이상(임대 행 제외, 빈 열쇠 = 자기 id)에 붙으면 sibling ·
 *   한 단지에 차수가 서로 다른 후보 둘 이상이면 phase
 * - 사람 판정 파일(docs/audits/trade-link-decisions.json)이 계산을 이긴다(active → manual · rejected 는 남겨 다시 제안 안 함)
 *
 * ⚠️ `_` 접두 = 라이브러리(DB 접근 0). graceful/exit/orphan 감사가 자동 제외한다.
 */
import { stringSimilarity } from "./_shared.mjs";
import { cleanMatchName, namesCompatible, completionMonthIndex } from "./_match-gates.mjs";
import { extractPhases } from "./_kakao-poi.mjs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";

/** 지번 경로의 정리한 이름 유사도 하한(설계서 §5-1 2). */
export const JIBUN_NAME_MIN = 0.6;
/** 이름 경로의 정리한 이름 유사도 하한(설계서 §5-1 3). */
export const NAME_ONLY_MIN = 0.85;
/** 우리 완공연도 ↔ 거래 최빈 건축년도 허용 차(둘 다 있을 때만). */
export const YEAR_GAP_MAX = 2;
/** 이름 경로 "공백 뗀 부분문자열" 에서 안에 든 쪽의 최소 글자 수 — "자이"·"개포자이" 같은 짧은 이름이 아무 데나 들어가지 않게. */
export const SUBSTRING_MIN_LEN = 5;
/**
 * 차단기(매일·정기 `--apply`): 바뀌거나 지워지는 줄이 이 수를 넘거나 지금 줄의 이 비율을 넘으면,
 * 또는 새로 넣는 줄이 지금 줄보다 많으면(첫 채우기) 쓰지 않는다 — 열쇠 깔기(`assign-complex-keys.mjs`)와 같은 값으로 시작.
 * 첫 실행 뒤 실측으로 다시 정한다(`data-changing-run-approval.md` §2).
 */
export const LINK_BREAKER_MAX_ROWS = 30;
export const LINK_BREAKER_RATIO = 0.1;

/**
 * @typedef {{ id: string; name: string; region?: string | null; gu?: string | null; dong?: string | null;
 *   bjd_code?: string | null; lot_main?: number | string | null; lot_sub?: number | string | null;
 *   completion?: unknown; coord_shared?: boolean | null; complex_key?: string | null; presale_type?: string | null }} LinkApt
 * @typedef {{ trade_type: string; sgg_cd: string; umd_cd?: string | null; umd_nm?: string | null; jibun?: string | null;
 *   jibun_main?: string | null; jibun_sub?: string | null; apt_seq?: string | null; apt_name?: string | null;
 *   build_year?: number | null }} LinkDeal
 * @typedef {{ kind: "apt_seq" | "presale"; key: string; sgg_cd: string; umd_cd: string | null; umd_nm: string | null;
 *   jibuns: Set<string>; rawJibuns: Set<string>; name: string | null; build_year: number | null; n: number;
 *   _norm: string; _nospace: string }} Entry
 * @typedef {{ aptSeq: Map<string, Entry>; presale: Map<string, Entry>; umdName: Map<string, string>; byDong: Map<string, Entry[]> }} KeyDictionary
 * @typedef {{ apartment_id: string; link_kind: "apt_seq" | "presale"; link_key: string; method: "jibun+name" | "name" | "manual";
 *   similarity: number | null; build_year_gap: number | null; trade_apt_name: string | null; trade_jibun: string | null;
 *   status: "active" | "hold" | "rejected"; hold_reason: "sibling" | "phase" | null;
 *   verified_at: string | null; verified_by: string | null }} Link
 * @typedef {{ apartment_id: string; link_kind: "apt_seq" | "presale"; link_key: string; status: "active" | "rejected";
 *   verified_by?: string | null; verified_at?: string | null; names?: string }} Decision
 * @typedef {{ apartment_id: string; key: string | null; why: string }} Dropped
 */

/** 전각 글자(Ｍ４블록（…）)를 반각으로 — 청약홈 이름에 섞여 온다. */
const nfkc = (/** @type {unknown} */ s) => String(s ?? "").normalize("NFKC");

/**
 * 유사도 비교용 이름 — NFKC → 회차 낱말·괄호 떼기(`cleanMatchName`) → "아파트" 떼기.
 * @param {unknown} name
 * @returns {string}
 */
export function normLinkName(name) {
  return cleanMatchName(nfkc(name)).replace(/아파트/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 분양권 열쇠 — `sgg_cd|umd_nm|jibun|정리이름`. 묶기와 통계(trade-stats)가 **같은 함수**로 만든다.
 * @param {{ sgg_cd: string; umd_nm?: string | null; jibun?: string | null; apt_name?: string | null }} row
 * @returns {string}
 */
export function presaleKeyOf(row) {
  return `${row.sgg_cd}|${row.umd_nm ?? ""}|${row.jibun ?? ""}|${cleanMatchName(row.apt_name)}`;
}

/** 최빈값(동점이면 먼저 센 것). @template T @param {Map<T, number>} m @returns {T | null} */
function modeOf(m) {
  /** @type {any} */
  let best = null;
  let bn = -1;
  for (const [v, n] of m) if (n > bn) { best = v; bn = n; }
  return best;
}

/**
 * `trade_deals`(완성 batch 만) → 열쇠 사전.
 * @param {readonly LinkDeal[]} deals
 * @returns {KeyDictionary}
 */
export function buildKeyDictionary(deals) {
  /** @type {Map<string, { kind: "apt_seq" | "presale"; key: string; sgg: string; umdCd: Map<string, number>; umdNm: Map<string, number>; names: Map<string, number>; years: Map<number, number>; jibuns: Set<string>; raw: Set<string>; n: number }>} */
  const acc = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const umdAcc = new Map();
  for (const d of deals) {
    const type = d.trade_type;
    /** @type {"apt_seq" | "presale" | null} */
    let kind = null;
    let key = "";
    if ((type === "sale" || type === "jeonse") && d.apt_seq) { kind = "apt_seq"; key = d.apt_seq; }
    else if (type === "presale") { kind = "presale"; key = presaleKeyOf(d); }
    if (type === "sale" && d.umd_cd && d.umd_nm) {
      const code = `${d.sgg_cd}${d.umd_cd}`;
      let m = umdAcc.get(code);
      if (!m) { m = new Map(); umdAcc.set(code, m); }
      m.set(d.umd_nm, (m.get(d.umd_nm) ?? 0) + 1);
    }
    if (!kind) continue;
    const ak = `${kind}\u0000${key}`;
    let e = acc.get(ak);
    if (!e) {
      e = { kind, key, sgg: d.sgg_cd, umdCd: new Map(), umdNm: new Map(), names: new Map(), years: new Map(), jibuns: new Set(), raw: new Set(), n: 0 };
      acc.set(ak, e);
    }
    e.n++;
    if (type === "sale" && d.umd_cd) e.umdCd.set(d.umd_cd, (e.umdCd.get(d.umd_cd) ?? 0) + 1);
    if (d.umd_nm) e.umdNm.set(d.umd_nm, (e.umdNm.get(d.umd_nm) ?? 0) + 1);
    if (d.apt_name) e.names.set(d.apt_name, (e.names.get(d.apt_name) ?? 0) + 1);
    if (d.build_year) e.years.set(Number(d.build_year), (e.years.get(Number(d.build_year)) ?? 0) + 1);
    if (d.jibun_main) e.jibuns.add(`${d.jibun_main}-${d.jibun_sub ?? "0"}`);
    if (d.jibun) e.raw.add(d.jibun);
  }
  /** @type {KeyDictionary} */
  const dict = { aptSeq: new Map(), presale: new Map(), umdName: new Map(), byDong: new Map() };
  for (const [code, m] of umdAcc) {
    const nm = modeOf(m);
    if (nm) dict.umdName.set(code, nm);
  }
  for (const e of acc.values()) {
    const name = modeOf(e.names);
    const norm = normLinkName(name);
    /** @type {Entry} */
    const entry = {
      kind: e.kind, key: e.key, sgg_cd: e.sgg, umd_cd: modeOf(e.umdCd), umd_nm: modeOf(e.umdNm),
      jibuns: e.jibuns, rawJibuns: e.raw, name, build_year: modeOf(e.years), n: e.n,
      _norm: norm, _nospace: norm.replace(/\s+/g, ""),
    };
    (e.kind === "apt_seq" ? dict.aptSeq : dict.presale).set(e.key, entry);
    if (entry.umd_nm) {
      const dk = `${entry.sgg_cd}|${entry.umd_nm}`;
      let list = dict.byDong.get(dk);
      if (!list) { list = []; dict.byDong.set(dk, list); }
      list.push(entry);
    }
  }
  return dict;
}

/**
 * 우리 이름에만 차수(N차·N단지 — 괄호 안·공고 회차 낱말 제외)가 있고 거래 이름엔 차수·블록(N차·N단지·BL·블록·블럭)이 없는가
 * → 버린다(시제품 틀린 짝의 대부분 — `.omc/artifacts/session589/scope/proto/10-proto.mjs:164-165` 정의, 메인 승인 2026-10-03).
 * 우리 쪽 블록(B2블록·A106블록)은 차수로 세지 않는다 — 거래 이름은 블록을 흔히 뗀다("화성비봉호반써밋").
 * @param {unknown} ours
 * @param {unknown} theirs
 * @returns {boolean}
 */
export function phaseOnlyOneSide(ours, theirs) {
  const ourPh = /\d+\s*(차|단지)/.test(cleanMatchName(nfkc(ours)));
  if (!ourPh) return false;
  return !/\d+\s*(차|단지|BL|블록|블럭)/i.test(nfkc(theirs));
}

/** @param {unknown} v @returns {number | null} 양의 정수 지번 조각 */
function lotNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 두 이름이 지번 경로 이름 검사로 같은 단지일 수 있는가(namesCompatible + 유사도 ≥ JIBUN_NAME_MIN). */
function couldBeSameComplex(/** @type {string} */ a, /** @type {string} */ b) {
  return namesCompatible(nfkc(a), nfkc(b)) && stringSimilarity(normLinkName(a), normLinkName(b)) >= JIBUN_NAME_MIN;
}

/**
 * 가짜 지번 단지 id 집합 — `coord_shared` 이거나, 같은 (bjd_code·본번·부번)을 쓰는 우리 단지 중
 * **같은 단지일 수 없는 이름**(namesCompatible 거부 또는 유사도 < 0.6)이 하나라도 있으면.
 * @param {readonly LinkApt[]} apts
 * @returns {Set<string>}
 */
export function findPlaceholderJibunIds(apts) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {Map<string, LinkApt[]>} */
  const byLot = new Map();
  for (const a of apts) {
    if (a.coord_shared === true) out.add(a.id);
    const main = lotNum(a.lot_main);
    if (!/^\d{10}$/.test(String(a.bjd_code ?? "")) || !main) continue;
    const k = `${a.bjd_code}|${main}-${lotNum(a.lot_sub) ?? 0}`;
    let list = byLot.get(k);
    if (!list) { list = []; byLot.set(k, list); }
    list.push(a);
  }
  for (const list of byLot.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!couldBeSameComplex(list[i].name, list[j].name)) { out.add(list[i].id); out.add(list[j].id); }
      }
    }
  }
  return out;
}

/**
 * @typedef {{ link_kind: "apt_seq" | "presale"; link_key: string; method: "jibun+name" | "name"; similarity: number;
 *   build_year_gap: number | null; trade_apt_name: string | null; trade_jibun: string | null; phases: Set<string> }} Candidate
 */

/**
 * 단지 하나의 후보(판정 근거 포함). 가짜 지번이면 `placeholder: true` 로 넘긴다(`findPlaceholderJibunIds`).
 * @param {LinkApt} apt
 * @param {KeyDictionary} dict
 * @param {{ now: Date; placeholder?: boolean }} opts
 * @returns {{ candidates: Candidate[]; dropped: Dropped[] }}
 */
export function matchApartment(apt, dict, { now, placeholder = false }) {
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Candidate[]} */
  const candidates = [];
  const bjd = String(apt.bjd_code ?? "");
  if (!/^\d{10}$/.test(bjd)) return { candidates, dropped: [{ apartment_id: apt.id, key: null, why: "법정동코드 없음" }] };
  const sgg = bjd.slice(0, 5);
  const dongName = dict.umdName.get(bjd) ?? null;
  if (!dongName) return { candidates, dropped: [{ apartment_id: apt.id, key: null, why: "동 이름 모름(그 법정동에 매매 0 — apartments.dong 은 행정동이라 대신 쓰지 않음)" }] };
  // 입주 여부와 상관없이 apt_seq·분양권 둘 다 묶는다 — 갓 입주한 단지는 12개월 거래가 분양권뿐일 수 있다(운암 1단지 202604).
  // 판정에 어느 종류를 쓸지는 통계 쪽(_trade-scope.mjs: 입주 후 매매 / 입주 전 분양권)이 고른다.
  void now;
  const pool = dict.byDong.get(`${sgg}|${dongName}`) ?? [];
  if (!pool.length) return { candidates, dropped: [{ apartment_id: apt.id, key: null, why: `후보 없음(${dongName} 에 거래 열쇠 0)` }] };

  const idx = completionMonthIndex(apt.completion);
  const ourYear = idx == null ? null : Math.floor(idx / 12);
  const ourNorm = normLinkName(apt.name);
  const ourNospace = ourNorm.replace(/\s+/g, "");
  const ourRaw = nfkc(apt.name);

  /**
   * @param {Entry} e @param {"jibun+name" | "name"} method
   * @returns {Candidate | string} 통과면 후보, 아니면 탈락 사유
   */
  const judge = (e, method) => {
    if (!namesCompatible(ourRaw, nfkc(e.name))) return "차수·블록 다름";
    if (phaseOnlyOneSide(apt.name, e.name)) return "우리만 차수";
    const sim = stringSimilarity(ourNorm, e._norm);
    let ok = sim >= (method === "jibun+name" ? JIBUN_NAME_MIN : NAME_ONLY_MIN);
    if (!ok && method === "name") {
      const [short, long] = ourNospace.length <= e._nospace.length ? [ourNospace, e._nospace] : [e._nospace, ourNospace];
      ok = short.length >= SUBSTRING_MIN_LEN && long.includes(short);
    }
    if (!ok) return `유사도 ${sim.toFixed(2)}`;
    const gap = ourYear != null && e.build_year != null ? Math.abs(ourYear - e.build_year) : null;
    // 연도(메인 승인 C-1, 2026-10-03): 이름 경로는 |차| ≤ 2 대칭. 지번 경로는 거래 건축년도가 우리 완공연도보다
    // YEAR_GAP_MAX 넘게 **뒤**일 때만 버린다 — 우리 완공월은 무순위·재공고 날짜로 늦게 적히는 일이 있다
    // (반정 아이파크 캐슬 5단지: 우리 202509 · 거래 2022, 지번 637·이름 1.0). 거래가 우리보다 늦게 지어졌을 수는 없다.
    if (gap != null && ourYear != null && e.build_year != null) {
      const tooFar = method === "name" ? gap > YEAR_GAP_MAX : e.build_year - ourYear > YEAR_GAP_MAX;
      if (tooFar) return `연도 차 ${gap}(우리 ${ourYear} · 거래 ${e.build_year})`;
    }
    return {
      link_kind: e.kind, link_key: e.key, method, similarity: Math.round(sim * 1000) / 1000, build_year_gap: gap,
      trade_apt_name: e.name, trade_jibun: [...e.rawJibuns].slice(0, 5).join(",") || null, phases: extractPhases(nfkc(e.name)),
    };
  };

  // 지번 경로
  const main = lotNum(apt.lot_main);
  const sub = lotNum(apt.lot_sub) ?? 0;
  let jibunHits = 0;
  if (!placeholder && main) {
    const want = `${main}-${sub}`;
    for (const e of pool) {
      const hit = e.jibuns.has(want) || (sub === 0 && [...e.jibuns].some((j) => j.startsWith(`${main}-`)));
      if (!hit) continue;
      jibunHits++;
      const r = judge(e, "jibun+name");
      if (typeof r === "string") dropped.push({ apartment_id: apt.id, key: `${e.kind}:${e.key}`, why: `지번 ${want} 후보 ${e.name} — ${r}` });
      else candidates.push(r);
    }
  }
  if (candidates.length) return { candidates, dropped };

  // 이름 경로 — 지번 없음 · 가짜 지번 · 지번 후보 0 · 지번 후보가 이름 검사를 하나도 못 통과
  for (const e of pool) {
    const r = judge(e, "name");
    if (typeof r !== "string") { candidates.push(r); continue; }
    // 이름이 비슷한(유사도 ≥ 0.6) 후보만 사유를 남긴다 — 전부 적으면 dropped 가 동네 단지 목록이 된다
    if (stringSimilarity(ourNorm, e._norm) >= JIBUN_NAME_MIN) {
      dropped.push({ apartment_id: apt.id, key: `${e.kind}:${e.key}`, why: `이름 경로 후보 ${e.name} — ${r}` });
    }
  }
  if (!candidates.length) {
    const path = placeholder ? "가짜 지번 → 이름 경로" : !main ? "지번 없음 → 이름 경로" : jibunHits ? "지번 후보 이름 불일치 → 이름 경로" : "지번 후보 0 → 이름 경로";
    dropped.push({ apartment_id: apt.id, key: null, why: `${path}에서도 0건` });
  }
  return { candidates, dropped };
}

/** @param {Candidate} c @param {string} id @returns {Link} */
function toLink(c, id) {
  return {
    apartment_id: id, link_kind: c.link_kind, link_key: c.link_key, method: c.method, similarity: c.similarity,
    build_year_gap: c.build_year_gap, trade_apt_name: c.trade_apt_name, trade_jibun: c.trade_jibun,
    status: "active", hold_reason: null, verified_at: null, verified_by: null,
  };
}

/** 줄 열쇠. @param {{ apartment_id: string; link_kind: string; link_key: string }} l */
export const linkId = (l) => `${l.apartment_id}\u0000${l.link_kind}\u0000${l.link_key}`;

/**
 * 연결 계획 — 단지마다 후보 → 차수 hold → 형제 hold → 사람 판정 덮어쓰기.
 * @param {readonly LinkApt[]} apts
 * @param {KeyDictionary} dict
 * @param {readonly Decision[]} decisions
 * @param {{ now: Date }} opts
 * @returns {{ desired: Link[]; dropped: Dropped[] }}
 */
export function planLinks(apts, dict, decisions, { now }) {
  const placeholderIds = findPlaceholderJibunIds(apts);
  /** @type {Map<string, LinkApt>} */
  const aptById = new Map(apts.map((a) => [a.id, a]));
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Map<string, Link>} */
  const byId = new Map();
  for (const apt of apts) {
    const { candidates, dropped: d } = matchApartment(apt, dict, { now, placeholder: placeholderIds.has(apt.id) });
    dropped.push(...d);
    // 차수: 차수 숫자가 있는 후보 둘이 서로 겹치지 않으면 그 후보들 = hold("phase")
    const phased = candidates.filter((c) => c.phases.size > 0);
    /** @type {Set<Candidate>} */
    const phaseHold = new Set();
    for (let i = 0; i < phased.length; i++) {
      for (let j = i + 1; j < phased.length; j++) {
        if (![...phased[i].phases].some((v) => phased[j].phases.has(v))) { phaseHold.add(phased[i]); phaseHold.add(phased[j]); }
      }
    }
    for (const c of candidates) {
      const l = toLink(c, apt.id);
      if (phaseHold.has(c)) { l.status = "hold"; l.hold_reason = "phase"; }
      byId.set(linkId(l), l);
    }
  }
  // 형제(B3): 한 열쇠가 서로 다른 묶음(complex_key, 빈 열쇠 = 자기 id) 둘 이상에 붙으면 그 열쇠의 모든 짝 = hold("sibling").
  // 임대 행(isLeaseUnit)은 묶음 셈에서 뺀다 — 같은 단지 분양·임대가 거래를 공유하는 것은 정상.
  /** @type {Map<string, { bundles: Set<string>; links: Link[] }>} */
  const byKey = new Map();
  for (const l of byId.values()) {
    const k = `${l.link_kind}\u0000${l.link_key}`;
    let g = byKey.get(k);
    if (!g) { g = { bundles: new Set(), links: [] }; byKey.set(k, g); }
    g.links.push(l);
    const a = aptById.get(l.apartment_id);
    if (a && !isLeaseUnit({ presale_type: a.presale_type, name: a.name })) g.bundles.add(a.complex_key || `id:${a.id}`);
  }
  for (const g of byKey.values()) {
    if (g.bundles.size < 2) continue;
    for (const l of g.links) { l.status = "hold"; l.hold_reason = "sibling"; }
  }
  // 사람 판정(B4) — 계산을 이긴다. 판정 파일에만 있는 줄도 넣는다(manual).
  for (const dec of decisions) {
    const id = linkId(dec);
    const cur = byId.get(id);
    const entry = (dec.link_kind === "apt_seq" ? dict.aptSeq : dict.presale).get(dec.link_key);
    /** @type {Link} */
    const l = cur ?? {
      apartment_id: dec.apartment_id, link_kind: dec.link_kind, link_key: dec.link_key, method: "manual", similarity: null,
      build_year_gap: null, trade_apt_name: entry?.name ?? null, trade_jibun: entry ? [...entry.rawJibuns].slice(0, 5).join(",") || null : null,
      status: "active", hold_reason: null, verified_at: null, verified_by: null,
    };
    l.status = dec.status;
    l.hold_reason = null;
    if (dec.status === "active") l.method = "manual";
    l.verified_at = dec.verified_at ?? null;
    l.verified_by = dec.verified_by ?? null;
    byId.set(id, l);
  }
  const desired = [...byId.values()].sort((a, b) => linkId(a).localeCompare(linkId(b)));
  return { desired, dropped };
}

/**
 * @typedef {Link & { id: number | string }} CurrentLink
 * @typedef {{ id: number | string; prev: { status: string; method: string; similarity: number | null; hold_reason: string | null }; next: Link }} LinkChange
 */

/** @param {unknown} v */
const numOrNull = (v) => (v == null || v === "" ? null : Number(v));

/**
 * 지금 표 ↔ 계획. change = status·method·similarity·hold_reason 이 바뀐 줄(similarity 는 DB 가 글자로 줄 수 있어 숫자로 맞댄다).
 * @param {readonly CurrentLink[]} current
 * @param {readonly Link[]} desired
 * @returns {{ add: Link[]; remove: CurrentLink[]; change: LinkChange[]; unchanged: number }}
 */
export function diffLinks(current, desired) {
  /** @type {Map<string, CurrentLink>} */
  const cur = new Map(current.map((c) => [linkId(c), c]));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Link[]} */
  const add = [];
  /** @type {LinkChange[]} */
  const change = [];
  let unchanged = 0;
  for (const d of desired) {
    const id = linkId(d);
    seen.add(id);
    const c = cur.get(id);
    if (!c) { add.push(d); continue; }
    const same = c.status === d.status && c.method === d.method && numOrNull(c.similarity) === numOrNull(d.similarity)
      && (c.hold_reason ?? null) === (d.hold_reason ?? null);
    if (same) { unchanged++; continue; }
    change.push({ id: c.id, prev: { status: c.status, method: c.method, similarity: numOrNull(c.similarity), hold_reason: c.hold_reason ?? null }, next: d });
  }
  const remove = current.filter((c) => !seen.has(linkId(c)));
  return { add, remove, change, unchanged };
}

/**
 * 차단기 판정(정기 `--apply`). DB 접근 없는 순수 함수.
 * @param {{ add: number; remove: number; change: number; existing: number }} counts
 * @returns {{ tripped: boolean; reason: string | null }}
 */
export function evaluateLinkBreaker({ add, remove, change, existing }) {
  const moved = remove + change;
  const ratio = existing > 0 ? moved / existing : 0;
  /** @type {string[]} */
  const reasons = [];
  if (moved > LINK_BREAKER_MAX_ROWS || ratio > LINK_BREAKER_RATIO) {
    reasons.push(`지워지거나 바뀌는 줄 ${moved}/${existing} = ${(ratio * 100).toFixed(1)}% — 한도(${LINK_BREAKER_MAX_ROWS}줄 또는 ${LINK_BREAKER_RATIO * 100}%) 초과`);
  }
  if (add > existing) reasons.push(`새로 넣는 줄 ${add} 이 지금 줄 ${existing} 보다 많음 — 첫 채우기(승인한 계획 파일로만 반영)`);
  return { tripped: reasons.length > 0, reason: reasons.length ? reasons.join(" · ") : null };
}

/**
 * 계획 줄 — 승인 대조용(개수가 아니라 내용으로 맞댄다). 줄 = JSON 배열.
 * @param {{ add: readonly Link[]; remove: readonly CurrentLink[]; change: readonly LinkChange[] }} plan
 * @returns {string[]}
 */
export function planLines(plan) {
  const out = [
    ...plan.add.map((l) => JSON.stringify(["add", l.apartment_id, l.link_kind, l.link_key, l.status, l.method, l.hold_reason ?? null])),
    ...plan.remove.map((l) => JSON.stringify(["remove", l.apartment_id, l.link_kind, l.link_key, l.status, l.method, l.hold_reason ?? null])),
    ...plan.change.map((c) => JSON.stringify(["change", c.next.apartment_id, c.next.link_kind, c.next.link_key, `${c.prev.status}>${c.next.status}`, `${c.prev.method}>${c.next.method}`, `${c.prev.hold_reason ?? ""}>${c.next.hold_reason ?? ""}`])),
  ];
  return out.sort();
}

/**
 * 다시 계산한 계획이 승인한 계획 파일과 **줄 단위로** 같은가.
 * @param {readonly string[]} current `planLines` 결과
 * @param {unknown} approved 계획 파일의 `planLines`
 * @returns {{ same: boolean; onlyCurrent: string[]; onlyApproved: string[] }}
 */
export function compareLinkPlanToApproved(current, approved) {
  if (!Array.isArray(approved) || approved.some((x) => typeof x !== "string")) throw new Error("승인한 계획 파일에 planLines(글자 배열)가 없습니다");
  const cur = new Set(current);
  const app = new Set(/** @type {string[]} */ (approved));
  const onlyCurrent = [...cur].filter((x) => !app.has(x)).sort();
  const onlyApproved = [...app].filter((x) => !cur.has(x)).sort();
  return { same: onlyCurrent.length === 0 && onlyApproved.length === 0, onlyCurrent, onlyApproved };
}

/**
 * 사람 판정 파일 `{ "decisions": [...] }` 를 읽는다. 형식이 틀리면 던진다(조용히 무시하면 사람 판정이 사라진다).
 * @param {unknown} json
 * @returns {Decision[]}
 */
export function parseLinkDecisions(json) {
  const list = /** @type {any} */ (json)?.decisions;
  if (!Array.isArray(list)) throw new Error("판정 파일에 decisions 배열이 없습니다");
  /** @type {Set<string>} */
  const seen = new Set();
  return list.map((d, i) => {
    if (!d || typeof d !== "object") throw new Error(`판정 ${i}: 객체가 아닙니다`);
    if (typeof d.apartment_id !== "string" || !d.apartment_id) throw new Error(`판정 ${i}: apartment_id 없음`);
    if (d.link_kind !== "apt_seq" && d.link_kind !== "presale") throw new Error(`판정 ${i}: link_kind 는 apt_seq/presale — ${d.link_kind}`);
    if (typeof d.link_key !== "string" || !d.link_key) throw new Error(`판정 ${i}: link_key 없음`);
    if (d.status !== "active" && d.status !== "rejected") throw new Error(`판정 ${i}: status 는 active/rejected — ${d.status}`);
    const id = linkId(d);
    if (seen.has(id)) throw new Error(`판정 ${i}: 같은 줄이 두 번 — ${d.apartment_id} ${d.link_kind} ${d.link_key}`);
    seen.add(id);
    return {
      apartment_id: d.apartment_id, link_kind: d.link_kind, link_key: d.link_key, status: d.status,
      verified_by: typeof d.verified_by === "string" ? d.verified_by : null,
      verified_at: typeof d.verified_at === "string" ? d.verified_at : null,
    };
  });
}
