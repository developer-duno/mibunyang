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
 * - 법정동 이름 사다리(`resolveDongName`, 보완 F2): ① 우리 bjd_code 10자리 → 매매 행 (sgg_cd+umd_cd → umd_nm)
 *   ② `apartments.address` 안에 같은 시군구 거래의 umd_nm 이 낱말 경계로 있음(이름 뒤 = 공백·끝·닫는 괄호·쉼표 「(작전동)」「(장현동, …)」 · 가장 긴 이름이 동률이면 포기)
 *   ③ `apartments.dong` 이 그 집합에 있음
 *   ④ 동 이름을 끝내 못 얻은 단지만: 같은 시군구에서 정리한 이름이 완전히 같은 열쇠(6글자 이상 · 한 동에만 있을 때 · 맨 앞의 자기 지역 낱말은
 *   떼고 비교 — 2차 보완 G7·G7-b) ⑤ 모름(dropped).
 *   `apartments.dong` 은 대개 행정동이다(`reverse-geocode.mjs:90` region_type "H" — 세션590 표본 5행 중 4행이 거래 umd_nm 과 다름)
 * - 지번 경로: 같은 법정동 + 지번 일치 → namesCompatible + 우리만 차수 아님 + 유사도 ≥ JIBUN_NAME_MIN(정확 일치) 또는
 *   ≥ NAME_ONLY_MIN(우리 부번 0 = 부번 없음인데 같은 본번의 다른 부번에 맞은 와일드카드, 보완 F1-a) + 연도 → `jibun+name`
 *   연도: 기본 |차| ≤ YEAR_GAP_MAX. 지번 경로 + 유사도 ≥ 0.85 일 때만 "거래가 우리보다 늦게 지어진 경우만 버림"(C-1 · F1-b)
 * - 이름 경로(지번 없음 · 가짜 지번 · 지번 후보가 0개였거나 **지번 후보가 있었지만 이름 검사를 통과한 것이 0개**):
 *   같은 법정동 + namesCompatible + 우리만 차수 아님 + (유사도 ≥ NAME_ONLY_MIN 또는 공백 뗀 부분문자열) + |연도 차| ≤ 2 → `name`
 * - 정확 일치 우선(G9): 이름 경로에서 같은 kind 에 정리 이름이 같은(≥ EXACT_NAME_SIM) 후보가 있으면 덜 닮은 남의 이름 후보(부분문자열 아님)는 버림
 *   — G9 는 사람이 rejected 한 후보도 정확 일치 증거로 센다(일부러 — 세션591 검사: 빼면 덜 닮은 남의 단지가 붙어 묶음에 퍼진다)
 * - 우리 이름에 차수·블록 번호 없음(F1-c · G1 — `extractPhases` + 로마 숫자 = `namesCompatible` 과 같은 추출 · 후보 쪽 `phases` 는
 *   `extractPhases` 만이라 로마 숫자를 안 센다, 세션591): 차수 있는 후보는 **같은 kind** 에 차수 없는 후보가
 *   있으면 버리고(G6), 없거나 다른 kind 에만 있으면 hold("phase")
 * - 묶음 전파(F9): 같은 complex_key 묶음(임대 제외) 행들의 active 열쇠 합집합을 묶음 모든 행에 준다(`method: bundle`) —
 *   묶음 안 어느 행이든 사람이 rejected 한 열쇠는 빼고(G2), 사람 active(manual) 줄은 전파 대상
 * - 창 밖 기존 줄(F5): 지금 표의 active·hold 줄 중 열쇠가 이번 12개월 사전에 없는 줄은 그대로 둔다(지우지 않고 세지 않음)
 * - 가짜 지번(지번 경로 안 씀): `coord_shared` 이거나, 같은 (bjd_code·본번·부번)을 쓰는 우리 단지 두 이름이
 *   지번 경로 이름 검사(namesCompatible + 유사도 ≥ 0.6)로도 같은 단지일 수 없을 때(메인 승인 2026-10-03 —
 *   이름이 바뀐 같은 단지 "어울림파밀리에 ↔ 아테라 파밀리에" 는 가짜가 아니고, "금강펜테리움 6차 ↔ 7차" 는 가짜)
 * - 입주 여부와 상관없이 apt_seq·분양권 둘 다 묶는다(갓 입주한 단지는 12개월 거래가 분양권뿐일 수 있다 — 운암 1단지).
 *   판정에 쓸 종류(입주 후 매매 / 입주 전 분양권, R2)는 통계 쪽 `_trade-scope.mjs` 가 고른다
 * - hold: 한 열쇠가 서로 다른 complex_key 묶음 둘 이상(임대 행 제외, 빈 열쇠는 `withComputedComplexKeys` 로 채움 — 그래도 비면 자기 id)에 붙으면 sibling ·
 *   한 단지에 차수가 서로 다른 후보 둘 이상이면 phase
 * - 사람 판정 파일(docs/audits/trade-link-decisions.json)이 계산을 이긴다(active → manual · rejected 는 남겨 다시 제안 안 함).
 *   순서(G2): rejected 쌍은 매칭 직후 후보에서 빼고(형제·차수 셈 밖) · active 판정은 hold 판정 뒤·전파 앞 · rejected 줄은 맨 끝
 *   (매칭 안의 G9 는 사람이 rejected 한 후보도 정확 일치 증거로 센다 — 일부러, 세션591 검사)
 *
 * ⚠️ `_` 접두 = 라이브러리(DB 접근 0). graceful/exit/orphan 감사가 자동 제외한다.
 */
import { stringSimilarity, HWASEONG_LAWD_CODES } from "./_shared.mjs";
import { cleanMatchName, namesCompatible, completionMonthIndex, romanPhaseNumbers } from "./_match-gates.mjs";
import { extractPhases, stripRoundWords } from "./_kakao-poi.mjs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";
import { assignComplexKeys } from "./_same-complex.mjs";

/** 지번 경로의 정리한 이름 유사도 하한(설계서 §5-1 2). */
export const JIBUN_NAME_MIN = 0.6;
/** 이름 경로의 정리한 이름 유사도 하한(설계서 §5-1 3). */
export const NAME_ONLY_MIN = 0.85;
/** 동 이름 사다리 ④(G7 "시군구 안 정확한 이름")에서 우리 정리 이름(공백 뗀)의 최소 글자 수. */
export const SGG_NAME_MIN_LEN = 6;
/** 화성 옛 시군구 코드 — 2026 개편 뒤 거래는 `HWASEONG_LAWD_CODES` 4코드로 온다(`_shared.mjs:827`). */
const HWASEONG_OLD_SGG = "41590";
/** 이름 경로 "정확 일치 우선"(보완 G9)의 정확 일치 하한 — 정리 이름이 사실상 같다. */
export const EXACT_NAME_SIM = 0.99;
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
 *   completion?: unknown; coord_shared?: boolean | null; complex_key?: string | null; presale_type?: string | null;
 *   address?: string | null; lat?: number | null; lng?: number | null }} LinkApt
 * @typedef {{ trade_type: string; sgg_cd: string; umd_cd?: string | null; umd_nm?: string | null; jibun?: string | null;
 *   jibun_main?: string | null; jibun_sub?: string | null; apt_seq?: string | null; apt_name?: string | null;
 *   build_year?: number | null }} LinkDeal
 * @typedef {{ kind: "apt_seq" | "presale"; key: string; sgg_cd: string; umd_cd: string | null; umd_nm: string | null;
 *   jibuns: Set<string>; rawJibuns: Set<string>; name: string | null; build_year: number | null; n: number;
 *   _norm: string; _nospace: string }} Entry
 * @typedef {{ aptSeq: Map<string, Entry>; presale: Map<string, Entry>; umdName: Map<string, string>; byDong: Map<string, Entry[]>;
 *   umdBySgg: Map<string, Set<string>>; bySggName: Map<string, Entry[]> }} KeyDictionary
 *   bySggName = `sgg_cd|공백 뗀 cleanMatchName(거래 이름)` → 열쇠들(동 이름 사다리 ④, G7)
 * @typedef {"umd_cd" | "address" | "dong" | "sgg_name"} DongVia
 * @typedef {{ apartment_id: string; link_kind: "apt_seq" | "presale"; link_key: string; method: "jibun+name" | "name" | "manual" | "bundle";
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

/** 동 이름 사다리 ④(G7)의 이름 비교 열쇠 — NFKC → `cleanMatchName` → 공백 전부 떼기. @param {unknown} name */
const cleanNospace = (name) => cleanMatchName(nfkc(name)).replace(/\s+/g, "");

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
  const dict = { aptSeq: new Map(), presale: new Map(), umdName: new Map(), byDong: new Map(), umdBySgg: new Map(), bySggName: new Map() };
  // 시군구마다 거래에 나온 법정동 이름 집합(매매·전세·분양권 전부) — 매매가 없는 동의 이름을 주소에서 찾는 재료(F2)
  for (const d of deals) {
    if (!d.sgg_cd || !d.umd_nm) continue;
    let s = dict.umdBySgg.get(d.sgg_cd);
    if (!s) { s = new Set(); dict.umdBySgg.set(d.sgg_cd, s); }
    s.add(d.umd_nm);
  }
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
    const sk = `${entry.sgg_cd}|${cleanNospace(name)}`;
    const sl = dict.bySggName.get(sk);
    if (sl) sl.push(entry); else dict.bySggName.set(sk, [entry]);
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
 * ⚠️ F1-c 의 `ourHasPhase`(블록·괄호 번호까지 셈)와 일부러 다르다 — 여기서 블록을 세면 위 진짜 짝이 "우리만 차수"로 버려진다(G1, 메인 승인).
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

/** 정규식 글자 이스케이프. @param {string} s */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 단지의 **법정동 이름**(거래 `umd_nm` 과 같은 표기)을 사다리로 얻는다(보완 F2 — 그 동에 매매가 0건이면 단지를 통째로 버리던 구멍).
 * ① 매매 행의 (sgg_cd+umd_cd → umd_nm) 사전에 우리 bjd_code 10자리가 있으면 그 이름
 * ② `apartments.address` 안에 같은 시군구 거래(매매·전세·분양권)의 `umd_nm` 이 **낱말 경계로** 들어 있으면 그 이름
 *    (여럿이면 가장 긴 것 — 가장 긴 것이 둘 이상 동률이면 ② 포기(G4) · 2글자 이상만 · "포곡읍 금어리" 같은 띄어쓴 이름도 그대로 ·
 *    "중동로" 안의 "중동" · "중앙동2가" 안의 "중앙동" 은 안 셈 — 이름 뒤는 공백·끝·닫는 괄호·쉼표만: "주부토로 356(작전동)"·"(장현동, 골드클래스)" 은 셈, 나) 후속 ⑤)
 * ③ `apartments.dong` 이 같은 시군구 거래의 `umd_nm` 집합에 있으면 그 이름(행정동 = 법정동인 곳)
 * 모름 → null(그 뒤 `matchApartment` 가 사다리 ④ "시군구 안 정확한 이름"을 본다 — G7)
 * 화성 옛 코드 41590 단지는 새 4코드를 같은 시군구로 본다(`sggCodesOf`). `sggs` = 그 이름이 나온 거래 시군구 코드들(후보 풀 열쇠).
 * @param {LinkApt} apt
 * @param {KeyDictionary} dict
 * @returns {{ name: string; via: DongVia; sggs: string[] } | null}
 */
export function resolveDongName(apt, dict) {
  const bjd = String(apt.bjd_code ?? "");
  if (!/^\d{10}$/.test(bjd)) return null;
  const codes = sggCodesOf(bjd);
  // ① (화성 41590 이면 새 4코드 + 같은 법정동 5자리로 — 이름이 하나로 모일 때만)
  /** @type {Map<string, string[]>} */
  const byCode = new Map();
  for (const c of codes) {
    const nm = dict.umdName.get(`${c}${bjd.slice(5)}`);
    if (nm) byCode.set(nm, [...(byCode.get(nm) ?? []), c]);
  }
  if (byCode.size === 1) { const [[name, sggs]] = [...byCode]; return { name, via: "umd_cd", sggs }; }
  /** 이 단지 시군구(화성은 4코드)의 거래 법정동 이름 → 그 이름이 나온 시군구 코드들. @type {Map<string, string[]>} */
  const nameSggs = new Map();
  for (const c of codes) for (const nm of dict.umdBySgg.get(c) ?? []) nameSggs.set(nm, [...(nameSggs.get(nm) ?? []), c]);
  if (nameSggs.size === 0) return null;
  const addr = nfkc(apt.address).replace(/\s+/g, " ");
  if (addr) {
    // 이름 뒤는 공백·끝·닫는 괄호·쉼표만(G4 — "중앙동2가" 안의 "중앙동" 은 안 셈 · 나) 후속 ⑤ — "주부토로 356(작전동)" ·
    // 도로명주소 참고항목 "종가로 760 (장현동, 골드클래스)" 의 동 이름은 셈 · "중동-12"·"중동·1"·"중동(1)" 은 안 셈)
    // · 가장 긴 이름이 둘 이상 동률이면 ② 포기(③으로)
    /** @type {string[]} */
    let best = [];
    for (const nm of nameSggs.keys()) {
      if (nm.length < 2 || (best.length && nm.length < best[0].length)) continue;
      const re = new RegExp(`(^|[^가-힣A-Za-z0-9])${reEscape(nm)}(?=$|[\\s),])`);
      if (!re.test(addr)) continue;
      best = best.length && nm.length === best[0].length ? [...best, nm] : [nm];
    }
    if (best.length === 1) return { name: best[0], via: "address", sggs: nameSggs.get(best[0]) ?? [] };
  }
  const d = String(apt.dong ?? "").trim();
  if (d && nameSggs.has(d)) return { name: d, via: "dong", sggs: nameSggs.get(d) ?? [] };
  return null;
}

/**
 * 우리 bjd_code 의 시군구 코드들 — 화성 옛 코드 41590 이면 거래가 오는 새 4코드(`HWASEONG_LAWD_CODES`, G7)를 같은 시군구로 본다.
 * @param {string} bjd 10자리
 * @returns {string[]}
 */
export function sggCodesOf(bjd) {
  const p = bjd.slice(0, 5);
  return p === HWASEONG_OLD_SGG ? [...HWASEONG_LAWD_CODES] : [p];
}

/**
 * 사다리 ④ 지역 접두 낱말(G7-b) — 우리 행 `region` 약칭("경기") + `gu` 의 각 토큰에서 끝의 시/군/구 를 뗀 것
 * ("화성시" → "화성" · "용인시 처인구" → "용인"·"처인"). 글자 그대로 쓴다(NFKC·공백 없음).
 * **2글자 이상 낱말만** 낸다(나) 후속 ③, 세션591) — "중구" → "중" 을 떼면 「중앙하이츠빌리지」 가 「앙하이츠빌리지」 와 같아진다.
 * @param {{ region?: string | null; gu?: string | null }} apt
 * @returns {string[]}
 */
export function regionPrefixWords(apt) {
  /** @type {string[]} */
  const out = [];
  const r = nfkc(apt.region).replace(/\s+/g, "");
  if (r.length >= 2) out.push(r);
  for (const tok of nfkc(apt.gu).split(/\s+/)) {
    const w = tok.replace(/[시군구]$/, "");
    if (w.length >= 2 && !out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * 공백 뗀 정리 이름의 **맨 앞**에서 지역 낱말을 뗀다 — 정확히 그 낱말로 시작할 때만, 낱말마다 한 번(연달아 "경기화성…" 이면 둘 다).
 * @param {string} key @param {readonly string[]} words
 * @returns {string}
 */
export function stripRegionPrefix(key, words) {
  let s = key;
  const used = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const w of words) {
      if (used.has(w) || !s.startsWith(w)) continue;
      s = s.slice(w.length);
      used.add(w);
      changed = true;
    }
  }
  return s;
}

/** 지역 낱말을 서로 다르게 이어 붙인 모든 접두(빈 접두 포함) — 거래 쪽에만 접두가 붙은 꼴을 사전에서 찾을 때. @param {readonly string[]} words */
function prefixSequences(words) {
  /** @type {string[]} */
  const out = [""];
  const walk = (/** @type {string} */ acc, /** @type {Set<string>} */ used) => {
    for (const w of words) {
      if (used.has(w)) continue;
      out.push(acc + w);
      walk(acc + w, new Set([...used, w]));
    }
  };
  walk("", new Set());
  return out;
}

/**
 * 단지 하나의 후보(판정 근거 포함). 가짜 지번이면 `placeholder: true` 로 넘긴다(`findPlaceholderJibunIds`).
 * @param {LinkApt} apt
 * @param {KeyDictionary} dict
 * @param {{ now: Date; placeholder?: boolean }} opts
 * @returns {{ candidates: Candidate[]; dropped: Dropped[]; dongVia?: DongVia; prefixStripped?: string[] }}
 *   prefixStripped = 사다리 ④ 에서 지역 접두를 떼서 붙은 후보의 `kind:key`(G7-b, 눈 검수용)
 */
export function matchApartment(apt, dict, { now, placeholder = false }) {
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Candidate[]} */
  const candidates = [];
  const bjd = String(apt.bjd_code ?? "");
  if (!/^\d{10}$/.test(bjd)) return { candidates, dropped: [{ apartment_id: apt.id, key: null, why: "법정동코드 없음" }] };
  // 입주 여부와 상관없이 apt_seq·분양권 둘 다 묶는다 — 갓 입주한 단지는 12개월 거래가 분양권뿐일 수 있다(운암 1단지 202604).
  // 판정에 어느 종류를 쓸지는 통계 쪽(_trade-scope.mjs: 입주 후 매매 / 입주 전 분양권)이 고른다.
  void now;

  const idx = completionMonthIndex(apt.completion);
  const ourYear = idx == null ? null : Math.floor(idx / 12);
  const ourNorm = normLinkName(apt.name);
  const ourNospace = ourNorm.replace(/\s+/g, "");
  const ourRaw = nfkc(apt.name);
  /** 공백 뗀 이름이 한쪽에 통째로 들어 있는가(짧은 쪽 SUBSTRING_MIN_LEN 이상). @param {Entry} e */
  const isSubstr = (e) => {
    const [short, long] = ourNospace.length <= e._nospace.length ? [ourNospace, e._nospace] : [e._nospace, ourNospace];
    return short.length >= SUBSTRING_MIN_LEN && long.includes(short);
  };

  /**
   * @param {Entry} e @param {"jibun+name" | "name"} method
   * @param {number} minSim 유사도 하한 — 지번 경로 정확 일치 0.6 · 부번 와일드카드 0.85(F1-a) · 이름 경로 0.85
   * @returns {Candidate | string} 통과면 후보, 아니면 탈락 사유
   */
  const judge = (e, method, minSim) => {
    if (!namesCompatible(ourRaw, nfkc(e.name))) return "차수·블록 다름";
    if (phaseOnlyOneSide(apt.name, e.name)) return "우리만 차수";
    const sim = stringSimilarity(ourNorm, e._norm);
    let ok = sim >= minSim;
    if (!ok && method === "name") ok = isSubstr(e);
    if (!ok) return `유사도 ${sim.toFixed(2)}${minSim > JIBUN_NAME_MIN && method === "jibun+name" ? "(부번 와일드카드 — 0.85 요구)" : ""}`;
    const gap = ourYear != null && e.build_year != null ? Math.abs(ourYear - e.build_year) : null;
    // 연도(메인 승인 C-1 · 보완 F1-b, 2026-10-03): 기본은 |차| ≤ 2 대칭. 지번 경로에서 유사도 ≥ 0.85 일 때만 비대칭 —
    // 거래 건축년도가 우리 완공연도보다 YEAR_GAP_MAX 넘게 **뒤**일 때만 버린다(우리 완공월은 무순위·재공고 날짜로 늦게
    // 적히는 일이 있다 — 반정 아이파크 캐슬 5단지: 우리 202509 · 거래 2022, 지번 637·이름 1.0). 유사도가 낮으면 대칭
    // (청라웰카운티19단지(2차) ↔ 청라웰카운티 2차: 차 11 · 0.667 → 버림).
    if (gap != null && ourYear != null && e.build_year != null) {
      const asym = method === "jibun+name" && sim >= NAME_ONLY_MIN;
      const tooFar = asym ? e.build_year - ourYear > YEAR_GAP_MAX : gap > YEAR_GAP_MAX;
      if (tooFar) return `연도 차 ${gap}(우리 ${ourYear} · 거래 ${e.build_year})`;
    }
    return {
      link_kind: e.kind, link_key: e.key, method, similarity: Math.round(sim * 1000) / 1000, build_year_gap: gap,
      trade_apt_name: e.name, trade_jibun: [...e.rawJibuns].slice(0, 5).join(",") || null, phases: extractPhases(nfkc(e.name)),
    };
  };

  const dong = resolveDongName(apt, dict);
  if (!dong) {
    const why0 = "동 이름 모름(그 법정동에 매매 0 · 주소·dong 에서도 그 시군구 거래의 법정동 이름을 못 찾음 — apartments.dong 은 대개 행정동)";
    // 동 이름 사다리 ④(보완 G7) — 동 이름을 끝내 못 얻은 단지만: 같은 시군구(화성 41590 은 새 4코드) 전체 열쇠 중
    // 공백 뗀 cleanMatchName 이 우리와 **완전히 같고**(SGG_NAME_MIN_LEN 글자 이상) namesCompatible · |연도 차| ≤ 2 인 후보 → name.
    // 그 후보들의 법정동이 둘 이상이면 붙이지 않는다(봉담자이 라젠느: 주소 상기리 · 거래 동화리 — 주소와 거래의 동이 다른 곳).
    // 지역 접두(G7-b, 메인 승인 2026-10-03): 비교 전에 양쪽 정리 이름 **맨 앞**의 이 단지 지역 낱말(`regionPrefixWords`)을 떼고
    // 다시 완전 일치를 본다(「화성 봉담자이 라젠느」 ↔ 「봉담자이라젠느」). 뗀 뒤에도 SGG_NAME_MIN_LEN 이상 · 부분문자열 허용 안 함
    // ("힐스테이트동탄" ⊂ "힐스테이트동탄역센트릭" 같은 같은 시군구 남의 단지). 접두 없이 원래 이름이 완전히 같은 짝은 그대로 받는다.
    const ourKey = cleanNospace(apt.name);
    const words = regionPrefixWords(apt);
    const ourBare = stripRegionPrefix(ourKey, words);
    /** @type {Set<string>} 찾아볼 거래 쪽 열쇠 — 원래 이름 · 접두 뗀 이름 앞에 지역 낱말을 붙인 모든 꼴 */
    const tryKeys = new Set();
    if (ourKey.length >= SGG_NAME_MIN_LEN) tryKeys.add(ourKey);
    if (ourBare.length >= SGG_NAME_MIN_LEN) for (const p of prefixSequences(words)) tryKeys.add(p + ourBare);
    /** @type {Set<Entry>} */
    const hitSet = new Set();
    for (const c of sggCodesOf(bjd)) for (const k of tryKeys) for (const e of dict.bySggName.get(`${c}|${k}`) ?? []) hitSet.add(e);
    /** @type {Entry[]} */
    const hits = [];
    /** @type {string[]} 접두를 떼서 붙은 열쇠(`kind:key`) */
    const prefixStripped = [];
    for (const e of hitSet) {
      const theirKey = cleanNospace(e.name);
      if (ourKey.length >= SGG_NAME_MIN_LEN && theirKey === ourKey) { hits.push(e); continue; }
      if (ourBare.length >= SGG_NAME_MIN_LEN && stripRegionPrefix(theirKey, words) === ourBare) { hits.push(e); prefixStripped.push(`${e.kind}:${e.key}`); }
    }
    /** @type {Candidate[]} */
    const passed = [];
    /** @type {Set<string>} */
    const umds = new Set();
    for (const e of hits) {
      const r = judge(e, "name", NAME_ONLY_MIN);
      if (typeof r === "string") { dropped.push({ apartment_id: apt.id, key: `${e.kind}:${e.key}`, why: `시군구 이름 일치 후보 ${e.name} — ${r}` }); continue; }
      passed.push(r);
      umds.add(e.umd_nm ?? "");
    }
    if (!passed.length) return { candidates, dropped: [...dropped, { apartment_id: apt.id, key: null, why: hits.length ? `${why0} · 시군구 이름 일치 후보도 탈락` : why0 }] };
    if (umds.size > 1) return { candidates, dropped: [...dropped, { apartment_id: apt.id, key: null, why: `동 이름 모름 · 시군구 이름 일치가 여러 동(${[...umds].join("·")})` }] };
    const kept = new Set(passed.map((c) => `${c.link_kind}:${c.link_key}`));
    return { candidates: passed, dropped, dongVia: "sgg_name", prefixStripped: prefixStripped.filter((k) => kept.has(k)) };
  }
  const dongName = dong.name;
  const pool = dong.sggs.flatMap((s) => dict.byDong.get(`${s}|${dongName}`) ?? []);
  if (!pool.length) return { candidates, dropped: [{ apartment_id: apt.id, key: null, why: `후보 없음(${dongName} 에 거래 열쇠 0)` }], dongVia: dong.via };

  // 지번 경로
  const main = lotNum(apt.lot_main);
  const sub = lotNum(apt.lot_sub) ?? 0;
  let jibunHits = 0;
  if (!placeholder && main) {
    const want = `${main}-${sub}`;
    for (const e of pool) {
      // 정확 일치(본번-부번)는 0.6. 우리 부번이 0(= 부번 없음, reverse-geocode 가 없으면 0 을 쓴다)인데 같은 본번의
      // 다른 부번에 맞은 와일드카드 후보는 0.85 를 요구한다(F1-a — 연수 서해그랑블 에듀파크 1131 ↔ 1단지 1131-1, 0.667)
      const exact = e.jibuns.has(want);
      const wild = !exact && sub === 0 && [...e.jibuns].some((j) => j.startsWith(`${main}-`));
      if (!exact && !wild) continue;
      jibunHits++;
      const r = judge(e, "jibun+name", exact ? JIBUN_NAME_MIN : NAME_ONLY_MIN);
      if (typeof r === "string") dropped.push({ apartment_id: apt.id, key: `${e.kind}:${e.key}`, why: `지번 ${want} 후보 ${e.name} — ${r}` });
      else candidates.push(r);
    }
  }
  if (candidates.length) return { candidates, dropped, dongVia: dong.via };

  // 이름 경로 — 지번 없음 · 가짜 지번 · 지번 후보 0 · 지번 후보가 이름 검사를 하나도 못 통과
  /** @type {Map<Candidate, { sim: number; sub: boolean }>} */
  const nameInfo = new Map();
  for (const e of pool) {
    const r = judge(e, "name", NAME_ONLY_MIN);
    if (typeof r !== "string") { candidates.push(r); nameInfo.set(r, { sim: stringSimilarity(ourNorm, e._norm), sub: isSubstr(e) }); continue; }
    // 이름이 비슷한(유사도 ≥ 0.6) 후보만 사유를 남긴다 — 전부 적으면 dropped 가 동네 단지 목록이 된다
    if (stringSimilarity(ourNorm, e._norm) >= JIBUN_NAME_MIN) {
      dropped.push({ apartment_id: apt.id, key: `${e.kind}:${e.key}`, why: `이름 경로 후보 ${e.name} — ${r}` });
    }
  }
  // 정확 일치 우선(보완 G9): 같은 link_kind 에 정리 이름이 완전히 같은(≥ EXACT_NAME_SIM) 후보가 있으면, 그 kind 의 이름 경로
  // 후보 중 유사도 < EXACT_NAME_SIM 이고 부분문자열도 아닌 것은 버린다 — 자기 열쇠를 두고 이름 비슷한 남의 단지가 남지 않게
  // (에코델타 트레파크(11BL) ↔ 「…센터파크」 0.857). 지번 경로 후보는 여기까지 오지 않는다(지번 후보가 있으면 위에서 돌아감).
  const exactKinds = new Set([...nameInfo].filter(([, v]) => v.sim >= EXACT_NAME_SIM).map(([c]) => c.link_kind));
  if (exactKinds.size) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const c = candidates[i];
      const info = nameInfo.get(c);
      if (!info || !exactKinds.has(c.link_kind) || info.sim >= EXACT_NAME_SIM || info.sub) continue;
      dropped.push({ apartment_id: apt.id, key: `${c.link_kind}:${c.link_key}`, why: `정확 일치 후보 있음 — ${c.trade_apt_name}(${info.sim.toFixed(3)}) 버림` });
      candidates.splice(i, 1);
    }
  }
  if (!candidates.length) {
    const path = placeholder ? "가짜 지번 → 이름 경로" : !main ? "지번 없음 → 이름 경로" : jibunHits ? "지번 후보 이름 불일치 → 이름 경로" : "지번 후보 0 → 이름 경로";
    dropped.push({ apartment_id: apt.id, key: null, why: `${path}에서도 0건` });
  }
  return { candidates, dropped, dongVia: dong.via };
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

/** 판정 파일에만 있는 줄(계산 근거 없음) — method manual. @param {Decision} dec @param {KeyDictionary} dict @returns {Link} */
function newDecisionLink(dec, dict) {
  const entry = (dec.link_kind === "apt_seq" ? dict.aptSeq : dict.presale).get(dec.link_key);
  return {
    apartment_id: dec.apartment_id, link_kind: dec.link_kind, link_key: dec.link_key, method: "manual", similarity: null,
    build_year_gap: null, trade_apt_name: entry?.name ?? null, trade_jibun: entry ? [...entry.rawJibuns].slice(0, 5).join(",") || null : null,
    status: "active", hold_reason: null, verified_at: null, verified_by: null,
  };
}

/** 사람 판정을 줄에 덮어쓴다(active → method manual). @param {Link} l @param {Decision} dec @returns {Link} */
function applyDecision(l, dec) {
  l.status = dec.status;
  l.hold_reason = null;
  if (dec.status === "active") l.method = "manual";
  l.verified_at = dec.verified_at ?? null;
  l.verified_by = dec.verified_by ?? null;
  return l;
}

/**
 * `complex_key` 가 빈 행(그날 들어와 아직 열쇠 배치가 안 돈 행)에 열쇠 규칙으로 계산한 값을 채운다(보완 F7).
 * DB 값이 있는 행은 DB 값 그대로. 규칙은 `_same-complex.mjs assignComplexKeys`(전 행을 같이 넣어야 묶음 맥락이 맞다).
 * 열쇠 깔기(03:00)보다 묶기(01:00)가 먼저 도는 날, 새 행이 자기 id 로 셈해져 기존 짝이 형제 hold 로 2주 묶이는 것을 막는다.
 * @template {LinkApt} A
 * @param {readonly A[]} apts
 * @param {unknown} exceptions `parseComplexExceptions` 결과
 * @returns {A[]}
 */
export function withComputedComplexKeys(apts, exceptions) {
  if (!apts.some((a) => !a.complex_key)) return [...apts];
  const keys = assignComplexKeys(/** @type {any} */ (apts), /** @type {any} */ (exceptions));
  return apts.map((a) => (a.complex_key ? a : { ...a, complex_key: keys.get(a.id) ?? null }));
}

/**
 * 우리 이름에 차수·블록 번호가 있는가(F1-c 세 갈래 · 보완 G1) — `namesCompatible` 과 **같은 추출**이다(세션591):
 * N차·N단지·NBL·N블록, 괄호 안 포함 + 로마 숫자(공고 회차 낱말과 "(N차)"를 푼 회차는 뗀다 = `namesCompatible` 전처리).
 * 후보 쪽(`extractPhases(nfkc(e.name))`)은 같은 `extractPhases` 를 쓰지만 로마 숫자는 안 센다(아래 ⚠️).
 * ⚠️ `phaseOnlyOneSide` 의 우리 쪽(N차·N단지만, 괄호 지움)과 **일부러 다르다** — 그쪽은 "우리만 차수면 버림"이라 블록까지
 * 세면 블록을 뗀 거래 이름("화성비봉호반써밋")과의 진짜 짝(B2블록·A106블록)이 버려진다. 이쪽은 "우리에게 번호가 있으니
 * 번호 있는 후보를 차수 없음 취급으로 hold·버림 하지 마라"는 판정이라 블록·괄호 번호까지 봐야 한다(1BL ↔ 1BL · (2차) ↔ 2단지).
 * 로마 숫자(Ⅲ·III — NFKC 가 Ⅲ 를 III 로 바꿔도 `romanPhaseNumbers` 가 읽는다)도 번호로 센다 = `namesCompatible` 과 같은 추출(나) 후속 ①, 세션591).
 * ⚠️ 후보 쪽(`judge` 의 `phases` = `extractPhases(nfkc(e.name))`)은 로마 숫자를 안 센다 — 그래서 우리 무차수 + 후보 「X Ⅲ」 는
 * 무차수 후보로 남는다(알려진 비대칭, 미리보기 수는 세션591 보고). `phaseOnlyOneSide` 도 로마 숫자를 우리 쪽·거래 쪽 어디서도
 * 세지 않는다 — 우리 「X 2차」 는 무차수 후보를 "우리만 차수"로 버리지만 우리 「X Ⅱ」 는 안 버린다(후속, 메인 판정 세션591).
 */
const ourHasPhase = (/** @type {unknown} */ name) => {
  const s = stripRoundWords(nfkc(name).replace(/\(\s*(\d+\s*차)\s*\)/g, " $1"));
  return extractPhases(s).size > 0 || romanPhaseNumbers(s).size > 0;
};

/**
 * 연결 계획 — 판정 파일 나누기 → 단지마다 후보(rejected 쌍 빼기) → 차수 거르기·hold → 형제 hold → 사람 active(manual)
 * → 묶음 전파(active · rejected 열쇠 제외) → 창 밖 기존 줄 유지 → 사람 rejected 줄.
 * @param {readonly LinkApt[]} apts `complex_key` 가 빈 행은 `withComputedComplexKeys` 로 먼저 채워 넘긴다(빈 채로 오면 자기 id)
 * @param {KeyDictionary} dict
 * @param {readonly Decision[]} decisions
 * @param {{ now: Date; current?: ReadonlyArray<{ apartment_id: string; link_kind: string; link_key: string; method: string; similarity: unknown; status: string; hold_reason?: string | null }> }} opts
 *   current = 지금 연결 표(창 밖 열쇠 유지 F5 용, 없으면 빈 표)
 * @returns {{ desired: Link[]; dropped: Dropped[]; dongVia: Map<string, DongVia>; skippedDecisions: number; prefixStripped: Set<string> }}
 *   prefixStripped = 사다리 ④ 에서 지역 접두를 떼서 붙은 줄의 `linkId`(G7-b)
 */
export function planLinks(apts, dict, decisions, { now, current = [] }) {
  const placeholderIds = findPlaceholderJibunIds(apts);
  /** @type {Map<string, LinkApt>} */
  const aptById = new Map(apts.map((a) => [a.id, a]));
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Map<string, DongVia>} */
  const dongVia = new Map();
  /** @type {Set<string>} */
  const prefixStripped = new Set();
  /** @type {Map<string, Link>} */
  const byId = new Map();
  // 사람 판정(B4 · 보완 G2)을 맨 앞에서 두 집합으로 — 표에 없는 단지 id 는 건너뛴다(F6 — FK 위반 방지).
  // rejected 쌍은 매칭 직후 후보에서 빼서 형제·차수 셈에 안 들어가게 하고, active 판정은 hold 판정 뒤·전파 앞에 넣는다.
  let skippedDecisions = 0;
  /** @type {Map<string, Decision>} */
  const rejectedDec = new Map();
  /** @type {Decision[]} */
  const activeDec = [];
  for (const dec of decisions) {
    if (!aptById.has(dec.apartment_id)) {
      skippedDecisions++;
      dropped.push({ apartment_id: dec.apartment_id, key: `${dec.link_kind}:${dec.link_key}`, why: "판정 파일 id 가 표에 없음" });
      continue;
    }
    if (dec.status === "rejected") rejectedDec.set(linkId(dec), dec);
    else activeDec.push(dec);
  }
  /** 후보에서 뺀 rejected 쌍의 계산 줄(rejected 줄의 method·이름 근거로 쓴다). @type {Map<string, Link>} */
  const rejectedComputed = new Map();
  for (const apt of apts) {
    const { candidates: raw, dropped: d, dongVia: via, prefixStripped: ps } = matchApartment(apt, dict, { now, placeholder: placeholderIds.has(apt.id) });
    for (const k of ps ?? []) { const i = k.indexOf(":"); prefixStripped.add(linkId({ apartment_id: apt.id, link_kind: k.slice(0, i), link_key: k.slice(i + 1) })); }
    dropped.push(...d);
    if (via) dongVia.set(apt.id, via);
    let candidates = raw.filter((c) => {
      const l = toLink(c, apt.id);
      if (!rejectedDec.has(linkId(l))) return true;
      rejectedComputed.set(linkId(l), l);
      return false;
    });
    /** @type {Set<Candidate>} */
    const phaseHold = new Set();
    // 차수(보완 F1-c · G6): 우리 이름에 차수·블록 번호가 없을 때(`ourHasPhase`) — 차수 있는 후보는
    // · **같은 link_kind** 에 차수 없는 후보가 있으면 버린다(힐스테이트 대명 센트럴 ↔ 2차)
    // · 차수 없는 후보가 없거나 다른 kind 에만 있으면 hold("phase") — 입주한 단지의 단지별 매매 열쇠(청주 동일하이빌 파크레인:
    //   무차수 분양권 + 1단지·2단지 apt_seq)를 버리지 않게, "래미안그레이튼 ↔ (진달래2차)" 처럼 옛 이름일 수 있어 사람 판정.
    if (!ourHasPhase(apt.name)) {
      const plainKinds = new Set(candidates.filter((c) => c.phases.size === 0).map((c) => c.link_kind));
      /** @type {Candidate[]} */
      const kept = [];
      for (const c of candidates) {
        if (c.phases.size === 0) { kept.push(c); continue; }
        if (plainKinds.has(c.link_kind)) {
          dropped.push({ apartment_id: apt.id, key: `${c.link_kind}:${c.link_key}`, why: `우리 차수 없음·차수 없는 후보 있음 — ${c.trade_apt_name} 버림` });
          continue;
        }
        phaseHold.add(c);
        kept.push(c);
      }
      candidates = kept;
    }
    // 차수: 차수 숫자가 있는 후보 둘이 서로 겹치지 않으면 그 후보들 = hold("phase")
    const phased = candidates.filter((c) => c.phases.size > 0);
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
  // 사람 active 판정(B4 · G2) — 형제·차수 hold 판정 뒤, 전파 앞(그래서 manual 줄도 묶음에 전파된다). hold 였으면 active·manual 로.
  // 판정 파일에만 있는 줄도 넣는다(manual).
  for (const dec of activeDec) {
    const id = linkId(dec);
    byId.set(id, applyDecision(byId.get(id) ?? newDecisionLink(dec, dict), dec));
  }
  // 묶음 전파(보완 F9 · 계획서 B7): 같은 complex_key 묶음 안 임대 아닌 행들의 **active** 열쇠 합집합을 묶음의 모든 임대 아닌
  // 행에 준다(hold 는 전파 안 함). 한 실제 단지가 회차·출처별로 여러 행인데 연결이 행마다 달랐다(대표 행이 연결 0 인 묶음).
  /** @type {Map<string, LinkApt[]>} */
  const bundleRows = new Map();
  for (const a of apts) {
    if (!a.complex_key || isLeaseUnit({ presale_type: a.presale_type, name: a.name })) continue;
    const list = bundleRows.get(a.complex_key);
    if (list) list.push(a); else bundleRows.set(a.complex_key, [a]);
  }
  /** @type {Map<string, Link[]>} */
  const activeByApt = new Map();
  for (const l of byId.values()) {
    if (l.status !== "active") continue;
    const list = activeByApt.get(l.apartment_id);
    if (list) list.push(l); else activeByApt.set(l.apartment_id, [l]);
  }
  for (const rows of bundleRows.values()) {
    if (rows.length < 2) continue;
    /** @type {Map<string, Link>} */
    const union = new Map();
    for (const a of rows) for (const l of activeByApt.get(a.id) ?? []) if (!union.has(`${l.link_kind}\u0000${l.link_key}`)) union.set(`${l.link_kind}\u0000${l.link_key}`, l);
    // 묶음 안 어느 행이든 사람이 rejected 한 열쇠는 그 묶음에 전파하지 않는다(G2 — a·S1 rejected 인데 b 가 S1 을 bundle 로 받던 구멍)
    for (const a of rows) {
      for (const k of [...union.keys()]) {
        const [kind, key] = k.split("\u0000");
        if (rejectedDec.has(linkId({ apartment_id: a.id, link_kind: kind, link_key: key }))) union.delete(k);
      }
    }
    for (const a of rows) {
      for (const src of union.values()) {
        const nl = { ...src, apartment_id: a.id };
        if (byId.has(linkId(nl))) continue;
        // 전파도 이름 충돌 관문(G10): 받는 행 이름과 열쇠의 거래 이름이 차수·로마·블록으로 충돌하면 안 준다(유사도는 안 본다 —
        // 전파의 뜻이 "이름이 달라도 같은 단지"). 「금빛 그랑메종(2차)」 행에 같은 묶음 3단지 열쇠가 퍼지던 구멍.
        if (!namesCompatible(nfkc(a.name), nfkc(src.trade_apt_name))) {
          dropped.push({ apartment_id: a.id, key: `${src.link_kind}:${src.link_key}`, why: `전파 — 차수 충돌(${src.trade_apt_name})` });
          continue;
        }
        byId.set(linkId(nl), { ...nl, method: "bundle", similarity: null, build_year_gap: null, status: "active", hold_reason: null, verified_at: null, verified_by: null });
      }
    }
  }
  // 창 밖 기존 줄 유지(보완 F5): 지금 표의 active·hold 줄 중 열쇠가 이번 사전(12개월 창)에 없는 줄은 그대로 둔다 —
  // 단지↔apt_seq 는 만료되는 사실이 아니다. 지우거나 차단기에 세지 않는다(사람 판정 rejected 는 아래에서 그대로 적용).
  for (const c of current) {
    if (c.status !== "active" && c.status !== "hold") continue;
    if (!aptById.has(c.apartment_id)) continue;
    if ((c.link_kind === "apt_seq" ? dict.aptSeq : dict.presale).has(c.link_key)) continue;
    const id = linkId(c);
    if (byId.has(id)) continue;
    byId.set(id, {
      apartment_id: c.apartment_id, link_kind: /** @type {"apt_seq" | "presale"} */ (c.link_kind), link_key: c.link_key,
      method: /** @type {Link["method"]} */ (c.method), similarity: numOrNull(c.similarity), build_year_gap: null,
      trade_apt_name: null, trade_jibun: null, status: /** @type {"active" | "hold"} */ (c.status),
      hold_reason: /** @type {Link["hold_reason"]} */ (c.hold_reason ?? null), verified_at: null, verified_by: null,
    });
  }
  // 사람 rejected 판정(B4) — 맨 끝에 rejected 줄로 남긴다(다시 제안 안 함). 계산 근거가 있으면 그 줄(method 등)을, 창 밖 기존 줄이면 그 줄을,
  // 없으면 판정 파일에만 있는 줄(manual)로.
  for (const [id, dec] of rejectedDec) {
    byId.set(id, applyDecision(byId.get(id) ?? rejectedComputed.get(id) ?? newDecisionLink(dec, dict), dec));
  }
  const desired = [...byId.values()].sort((a, b) => linkId(a).localeCompare(linkId(b)));
  return { desired, dropped, dongVia, skippedDecisions, prefixStripped };
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
