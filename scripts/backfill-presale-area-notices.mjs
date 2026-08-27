#!/usr/bin/env node
// @ts-check
/**
 * backfill-presale-area-notices.mjs
 *
 * 손님에게 보이는 단지 중 **전용면적이 비어 있는데 청약홈 주택형 표(`applyhome_unit_supply`)도
 * 없는** 곳을, 공고 원문 두 갈래에서 이름으로 찾아 채운다.
 *
 *   ① 청약홈 공고 — 일반 APT(`getAPTLttotPblancDetail/Mdl`) + 무순위(`getRemndrLttotPblancDetail/Mdl`)
 *   ② LH 공고     — 목록(`lhLeaseNoticeInfo1`) + 공급정보(`getLeaseNoticeSplInfo1`)
 *
 * 왜 필요한가 (세션531 → 532 → 이번):
 *   면적이 없으면 `scorePrice` 가 평형별 실거래 버킷 경로를 못 타고 "구 전체 거래 중위 총액"과
 *   비교하는 폴백으로 떨어진다. 그러면 괴리도가 "비싼가"가 아니라 **"큰가"** 를 잰다
 *   (`.claude/rules/meta/score-meaning-and-wording-are-a-pair.md` §세션531).
 *
 *   세션531이 네이버 `scale` 로, 세션532가 **이미 DB 에 있는** 청약홈 표로 채웠다. 남은 무리가
 *   "청약홈 표 자체가 없는" 곳이라, 이 스크립트만 **공고 원문을 새로 받아** 이름으로 잇는다.
 *
 * ⚠️ 이름 매칭을 0.60 까지 푸는 대신 **정체성 게이트 3중 + 가격 교차검증**을 건다:
 *   세션532의 `applyhome_unit_supply` 경로는 `apartment_id` 가 이미 같은 단지를 가리켜서 이름을
 *   볼 필요가 없었다. 여기는 아니다 — 이름만으로 이으면 남의 단지가 들어온다.
 *
 *     ① 시도  — 다르면 거부 (못 알아본 공고도 거부)
 *     ② 시군구 — 양쪽 다 알 때만 비교, 머리가 다르면 거부 (`districtHead`/`targetDistrict`)
 *     ③ 차수  — 양쪽 다 표식이 있을 때만 비교, 겹치지 않으면 거부 (`phaseConflict`)
 *     ④ 블록  — 같은 방식으로 `A1BL` ↔ `A2BL` 을 가른다 (`blockConflict`)
 *     ⑤ 가격  — 저장 분양가와 공고 주택형 분양가가 30%(`MAX_PRICE_GAP_RATIO`) 안에 들 때만
 *
 *   ⑤를 못 쓰면(저장가 없음 / 공고가 임대라 분양가 칸이 없음) **엄격 이름(0.85) + 주택형이
 *   하나뿐**일 때만 채운다. 여러 후보가 남으면 **이름이 가장 닮은 것**을 고른다 — 이름이
 *   정체성이고 가격은 검문이라, 검문으로 정체성을 이기게 하면 뒤집힌다(`chooseBest` 주석).
 *
 * 실측 (2026-08-27):
 *   - 대상 73곳 = 손님 노출 1,754 중 면적 미상 110 → 청약홈 표 없음 73.
 *     그 중 **`prices` 행 자체가 없는 35곳은 건드리지 않는다**(행 생성은 사장님 보류 결정).
 *     남은 38곳이 실제 후보이고 전부 가격이 있다 → (b) 규칙은 오늘 0건이다.
 *   - dry-run 결과 **채움 후보 5건 / 스킵 33건**(후보없음 31 · 가격이격 2).
 *     게이트가 실제로 걸러낸 것 — 병점역서해스카이팰리스3단지(화성) ↔ "여주 서해 스카이팰리스"는
 *     ②가, 영종 라메르Ⅱ ↔ 라메르Ⅰ은 ③이 잡았다. ②③④는 **엉뚱한 짝을 지우기만 하는 게 아니라
 *     제 짝을 찾아 준다** — 대전 하늘채 루시에르는 ③이 (2회차)를 걷어낸 덕분에 같은 (1회차)
 *     공고를, 안양 A2BL 단지는 ④가 (A1BL)을 걷어낸 덕분에 제 (A2BL) 공고를 만났다.
 *   - **LH 는 오늘 고유 기여가 0이다** — LH 후보 중 0.60 을 넘는 것은 1곳뿐이고(고양창릉 우미린
 *     그레니티 0.629) 그 단지는 청약홈이 더 높은 유사도(0.786)로 이미 잡는다. 그래도 경로를
 *     남기는 이유는 공공분양(LH 단독 공고) 단지가 앞으로 대상에 들어올 수 있어서다.
 *     급하면 `--no-lh` 로 목록 15,921건 내려받기(약 70초)를 건너뛴다.
 *
 * 블록 코드(A1BL/A2BL)도 가른다 — `normName` 이 괄호를 지워 "안양 …(A1BL)" 과 "…(A2BL)" 이 같은
 *   이름이 되고 두 단지의 저장가마저 같아(100,730) 가격으로도 안 갈리던 자리다. 그래서 차수와
 *   같은 꼴로 ④를 두었다(`blockConflict`). 이 게이트가 없으면 A2BL 단지가 A1BL 공고의 95.36㎡ 를
 *   받는다 — 있으면 제 공고를 찾아 84.98㎡(이격 20.4%)가 된다.
 */
import {
  loadEnv,
  getSupabase,
  sleep,
  stringSimilarity,
  VALID_REGIONS,
  GU_LAWD_MAP,
} from "./collectors/_shared.mjs";
import { fetchAllByCursor } from "./backfill-presale-area.mjs";
import {
  MAX_PRICE_GAP_RATIO,
  parseHouseTy,
  pickUnitByPrice,
} from "./backfill-presale-area-applyhome.mjs";
import { normName, addrToRegion } from "./collectors/collect-applyhome-detail.mjs";
import { parseIntLoose, parseRealLoose, normHouseTy } from "./collectors/collect-applyhome-remndr.mjs";
import { excludeLeaseUnits } from "../src/constants/leaseTypes.mjs";

loadEnv();

const PHASE = "backfill-area-notices";
const API_KEY = process.env.MOLIT_KEY;

const ODCLOUD_BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
const LH_LIST = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1";
const LH_SPL = "https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1";

/**
 * LH 목록에서 받아올 상위매물유형 — 05=분양주택 / 06=임대주택 (2026-08-27 실측).
 * 토지·상가·주거복지 등 나머지는 아파트가 아니라 받지 않는다(전 유형 21,271건 중 이 둘이 15,921건).
 */
const LH_UPPER_TYPES = ["05", "06"];
const LH_LIST_FROM = "20150101";

/**
 * 이름 유사도 하한 — **가격 교차검증이 걸리는 경로**에만 쓴다.
 *
 * 0.85(청약홈 detail 수집기의 값)로 잡으면 오늘 대상 38곳 중 5곳만 후보가 생긴다. 반대로
 * 0.60 까지 풀면 후보는 늘지만 사전 조사에서 본 것처럼 엉뚱한 짝이 섞인다
 * (예: "병점역서해스카이팰리스3단지" ↔ "여주 서해 스카이팰리스" 0.667).
 * 그래서 **이 하한 자체를 안전장치로 삼지 않는다** — 안전장치는 아래 가격 게이트다.
 */
export const NAME_SIM_MIN = 0.6;

/**
 * 가격 교차검증을 못 쓸 때(저장가 없음 / 공고가 임대라 분양가 칸이 없음)의 이름 유사도 하한.
 * 이때는 이름이 유일한 근거라 청약홈 detail 수집기와 같은 0.85 를 쓰고, 거기에 더해
 * **주택형이 하나뿐**일 것까지 요구한다(여러 개면 어느 것을 고를 근거가 없다).
 */
export const NAME_SIM_STRICT = 0.85;

/** 한 단지가 LH 공급정보를 조회할 후보 공고 수 상한 — 이름순 상위 N (API 호출 폭발 차단). */
export const LH_CANDIDATE_CAP = 5;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipLh = args.includes("--no-lh");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;

/** @param {string} msg */
function log(msg) {
  console.log(`[${PHASE}] ${msg}`);
}

// ── 순수 함수 (테스트 대상) ─────────────────────────────────────────────

/**
 * 공고의 시도(광역) 이름 — **확실할 때만** 돌려준다.
 *
 * `addrToRegion` 은 못 알아본 머리말을 접미사만 떼어 그대로 돌려준다("김포 풍무역세권…" → "김포",
 * "전남광주통합특별시" → "전남광주통합특별"). 그 값을 게이트에 그대로 쓰면 ① 시도가 아닌 문자열과
 * 비교하게 되고 ② "전남광주통합특별" 처럼 두 시도 이름이 섞인 값은 어느 쪽으로도 판정할 수 없다.
 * 그래서 17개 시도 목록에 든 것만 통과시키고 나머지는 null 로 만들어 **후보에서 뺀다**.
 *
 * 한 걸음 더 — **머리말에 시도 이름이 둘 이상 섞이면 그것도 null** 로 만든다. LH 가 실제로
 * 쓰는 `"전남광주통합특별시"` 가 그런 값인데, 접두 일치로 풀면 "전남" 이 나온다. 그러면 광주
 * 단지와 전남 단지를 가르지 못해 게이트가 한쪽으로 조용히 열린다. 어느 쪽인지 모를 때는
 * 여는 게 아니라 닫는다.
 *
 * 실측(2026-08-27): 공고 20,440건 중 2,115건(10.3%)이 빠진다 — 거의 전부가 두 값이다.
 *   "전남광주통합특별시" 1,455건(LH, 두 시도가 섞인 이름) · "전국" 607건(시도가 아예 없음).
 *   나머지 53건은 "김포"·"수원시"·"안양동" 처럼 시도가 아니라 시군구·동을 머리말로 쓴 주소다.
 *
 * @param {string | null | undefined} v 주소(청약홈 HSSPLY_ADRES) 또는 시도명(LH CNP_CD_NM)
 * @returns {string | null} 약칭 시도명("경기") 또는 null
 */
export function noticeRegion(v) {
  const r = addrToRegion(v);
  if (r == null || !VALID_REGIONS.includes(r)) return null;
  // addrToRegion 과 같은 머리말 규칙(첫 토큰). 그 안에 시도 약칭이 둘 이상이면 판정 불가.
  const head = String(v ?? "").trim().split(/\s+/)[0] || "";
  const hits = VALID_REGIONS.filter((x) => head.includes(x));
  return hits.length > 1 ? null : r;
}

/**
 * 시군구 이름에서 행정 접미를 뗀 "머리". `"화성특례시" → "화성"` · `"여주시" → "여주"` · `"강서구" → "강서"`.
 * @param {unknown} s
 * @returns {string}
 */
export function stripDistrictSuffix(s) {
  return String(s ?? "").replace(/(특례시|시|군|구)$/, "");
}

/**
 * 시군구 머리를 뽑는다 — **사전(`GU_LAWD_MAP[region]`)에 있는 이름만** 인정한다.
 *
 * 접미(시·군·구)로 훑는 방식은 주소 안의 다른 말에 걸린다: `"공공주택지구"` → "공공주택지",
 * `"고덕신도시"` → "고덕신도". 그 쓰레기 값으로 게이트를 돌리면 **맞는 짝을 거부**한다.
 * 그래서 실제 행정구역 이름표(256개)와 정확히 일치하는 토큰만 받는다.
 *
 * 우리 단지의 `gu` 는 `"수원시 권선구"` 처럼 복합일 수 있어 **앞 토막**을 쓴다 — 공고 주소도
 * `"경기도 수원시 권선구 …"` 라 같은 자리를 가리킨다.
 *
 * 실측(2026-08-27): 청약홈 주소 2,824건 중 2,751건(97.4%) 추출. 못 뽑은 73건은 사전에 없는
 * 군(가평·양평)·특수 지구 표기라, 게이트가 **열린 채로** 지나간다(모름은 막지 않는다).
 *
 * @param {string | null} region 약칭 시도("경기") — 사전을 시도별로 좁혀 동명 구를 가른다
 * @param {string | null | undefined} text 주소(공고) 또는 gu 값(우리 단지)
 * @returns {string | null}
 */
export function districtHead(region, text) {
  if (!region || !text) return null;
  const keys = Object.keys(GU_LAWD_MAP[region] ?? {});
  if (keys.length === 0) return null;
  for (const raw of String(text).split(/[\s(),]+/)) {
    if (!raw) continue;
    // "화성특례시" 는 사전에 "화성시" 로 있다 — 특례시 승격 표기를 맞춰 준다.
    const tok = raw.replace(/특례시$/, "시");
    for (const k of keys) {
      const first = k.split(" ")[0];
      if (tok === k || tok === first) return stripDistrictSuffix(first);
    }
  }
  return null;
}

/**
 * 우리 단지의 시군구 머리 — `address` → `roadAddress` → `gu` 순으로 **처음 잡히는 것**.
 *
 * `gu` 만 보면 안 된다. 이 표의 `gu` 는 일반구 이름 하나만 들어 있는 경우가 많은데
 * (`"병점구"`·`"덕양구"`·`"동안구"`), 사전은 `"안양시 동안구"` 처럼 시를 붙여 갖고 있어
 * 맨 구 이름은 안 잡힌다. 게다가 `"병점구"` 는 화성시에 아예 없는 이름이다.
 * 반면 `address` 는 `"경기도 화성시 병점구 병점동"` 이라 **시**가 그대로 들어 있다.
 *
 * 2026-08-27 실측: 이 폴백이 없으면 병점역 단지(화성)가 여주 공고와 짝지어진 채 남는다.
 * 사전에 없는 말은 `districtHead` 가 알아서 null 을 주므로 순서만 정해 주면 된다.
 *
 * @param {{ region: string | null; gu?: string | null; address?: string | null; roadAddress?: string | null }} target
 * @returns {string | null}
 */
export function targetDistrict(target) {
  const region = target.region;
  for (const src of [target.address, target.roadAddress, target.gu]) {
    const hit = districtHead(region, src);
    if (hit) return hit;
  }
  return null;
}

/** 차수 표식으로 쓰이는 로마숫자 — 대문자 Ⅰ~Ⅹ(U+2160~) / 소문자 ⅰ~ⅹ(U+2170~). */
const ROMAN_UPPER = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ";
const ROMAN_LOWER = "ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ";

/**
 * 이름에서 차수·단지 표식을 숫자 집합으로 뽑는다.
 *
 * ⚠️ **원본 이름에서 뽑는다** — `normName` 이 괄호를 통째로 지워서 `"대전 하늘채 루시에르(2회차)"`
 * 가 `"대전하늘채루시에르"` 가 되어 표식이 사라지기 때문이다(2026-08-27 실측).
 *
 * `N회차` 도 센다. 청약홈이 같은 단지의 다른 회차를 그렇게 쓰는데(`1회차` ↔ `(2회차)`),
 * `(\d+)차` 만 보면 "회" 가 끼어 있어 하나도 못 잡는다.
 *
 * @param {string | null | undefined} name
 * @returns {Set<number>}
 */
export function phaseMarkers(name) {
  const s = String(name ?? "");
  /** @type {Set<number>} */
  const out = new Set();
  for (const ch of s) {
    const u = ROMAN_UPPER.indexOf(ch);
    if (u >= 0) out.add(u + 1);
    const l = ROMAN_LOWER.indexOf(ch);
    if (l >= 0) out.add(l + 1);
  }
  for (const m of s.matchAll(/(\d+)\s*(?:회)?차/g)) out.add(Number(m[1]));
  for (const m of s.matchAll(/(\d+)\s*단지/g)) out.add(Number(m[1]));
  return out;
}

/**
 * 블록 토큰 — `A1BL` / `A-1블록` / `1BL` 처럼 **접미(BL·BLK·블록·블럭)가 붙은 것만** 센다.
 *
 * 접미를 요구하는 이유: 접미 없는 `"A-1"` 은 주소·생활권 표기(`"5-2생활권"`)와 구별이 안 돼
 * 쓰레기 토큰을 만든다. 실측(2026-08-27) 표기 빈도 — 공고명 고유 토큰 481종:
 *   `A-1블록` 217 · `A-2블록` 130 · `1블록` 129 · `A-3BL` 122 · `A-1BL` 114 · `A1블록` 84 ·
 *   `A1BL` 69 · `1BL` 65 · `S-1블록` 61 · `B-2블록` 55 · `RC4-1,2BL`
 * 대상 38곳 쪽은 붙여 쓰는 형태뿐이다 — `A1BL` · `A2BL` · `A4BL`.
 * 그래서 문자 접두(A/B/S/RC…)·붙임표·공백을 모두 흡수해 `"A1"`(문자 있음) 또는 `"1"`(없음)로 모은다.
 *
 * @param {string | null | undefined} name
 * @returns {Set<string>}
 */
export function blockMarkers(name) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of String(name ?? "").matchAll(/([A-Za-z]{1,3})?\s*-?\s*(\d+)\s*(?:BLK|BL|블록|블럭)/gi)) {
    const letter = m[1] ? m[1].toUpperCase() : "";
    out.add(`${letter}${Number(m[2])}`);
  }
  return out;
}

/**
 * 이 표식 집합에 문자 접두가 붙은 것이 있는가.
 * @param {Set<string>} set
 * @returns {boolean}
 */
function hasLetteredBlock(set) {
  for (const s of set) if (/^[A-Z]/.test(s)) return true;
  return false;
}

/**
 * 두 이름의 블록이 **서로 어긋나는가**. 한쪽에 표식이 없으면 false(통과).
 *
 * ⚠️ **문자 접두는 양쪽 다 있을 때만 본다.** 공고는 같은 블록을 `"A1BL"` 로도 `"1블록"` 으로도
 * 쓴다(실측 각각 69회·129회). 문자를 항상 비교하면 `A1` ↔ `1` 이 어긋난 것으로 읽혀 **맞는 짝을
 * 거부**한다. 한쪽에 문자가 없으면 숫자만 맞대고, 둘 다 있을 때만 `A1` ↔ `A2` 를 가른다.
 * (그래서 `A1BL` ↔ `B1BL` 은 못 가른다 — 모를 때는 여는 쪽으로 둔 자리다.)
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean} true 면 다른 블록 = 거부
 */
export function blockConflict(a, b) {
  const A = blockMarkers(a);
  const B = blockMarkers(b);
  if (A.size === 0 || B.size === 0) return false;
  const bothLettered = hasLetteredBlock(A) && hasLetteredBlock(B);
  /** @param {string} s */
  const key = (s) => (bothLettered ? s : s.replace(/^[A-Z]+/, ""));
  const bKeys = new Set([...B].map(key));
  for (const x of A) if (bKeys.has(key(x))) return false;
  return true;
}

/**
 * 두 이름의 차수가 **서로 어긋나는가**. 한쪽에 표식이 없으면 false(통과) — 표기 생략이 흔하다.
 *
 * 겹치는 표식이 하나라도 있으면 같은 차수로 본다(`"3차 2단지"` 처럼 표식이 둘일 수 있다).
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean} true 면 다른 차수 = 거부
 */
export function phaseConflict(a, b) {
  const A = phaseMarkers(a);
  const B = phaseMarkers(b);
  if (A.size === 0 || B.size === 0) return false;
  for (const x of A) if (B.has(x)) return false;
  return true;
}

/**
 * @typedef {{ house_ty: string | null; top_amount: number | null; supply_area: number | null }} UnitRow
 * @typedef {{ amountRows: UnitRow[]; allRows: UnitRow[] }} UnitTable
 */

/**
 * 청약홈 주택형 한 줄(`getAPTLttotPblancMdl` / `getRemndrLttotPblancMdl`) → 공통 형태.
 *
 * 실측 행(2026-08-27):
 *   APT     { HOUSE_TY: "055.9700A", SUPLY_AR: "83.6488",  LTTOT_TOP_AMOUNT: "79831" }
 *   무순위  { HOUSE_TY: "082.4015B", SUPLY_AR: "117.2282", LTTOT_TOP_AMOUNT: "87710" }
 * `LTTOT_TOP_AMOUNT` 는 **만원** 단위이고 채널에 따라 콤마가 섞인다(그래서 parseIntLoose).
 *
 * @param {Record<string, unknown>} row
 * @returns {UnitRow}
 */
export function toApplyhomeUnit(row) {
  return {
    house_ty: normHouseTy(row.HOUSE_TY),
    top_amount: parseIntLoose(row.LTTOT_TOP_AMOUNT),
    supply_area: parseRealLoose(row.SUPLY_AR),
  };
}

/**
 * 라벨 사전에서 정규식에 맞는 **칸 이름**을 찾는다.
 * @param {Record<string, unknown> | null | undefined} labels
 * @param {RegExp} re
 * @returns {string | null}
 */
function findLabeledKey(labels, re) {
  if (!labels || typeof labels !== "object") return null;
  for (const [key, label] of Object.entries(labels)) {
    if (typeof label === "string" && re.test(label)) return key;
  }
  return null;
}

/** LH 금액은 **원** 단위다. 우리 `prices.price` 는 만원이라 나눠서 맞춘다. */
export const LH_WON_PER_MANWON = 10000;

/**
 * LH 공급정보 응답 → 공통 주택형 형태.
 *
 * ⚠️ **칸 이름만 보면 안 된다.** 같은 `LS_GMY` 가 분양 공고에서는 "평균분양가격(원)", 임대 공고에서는
 * "임대보증금(원)" 이다. 그래서 같은 응답이 함께 주는 라벨 사전(`dsListNNNm`)을 읽어 **라벨에
 * "분양가" 가 들어간 칸만** 분양가로 쓴다. 임대보증금을 분양가 자리에 넣으면 가격 교차검증이
 * 통째로 거짓이 된다.
 *
 * 실측 응답 2형(2026-08-27, `CCR_CNNT_SYS_DS_CD` 로 갈린다):
 *   "02" dsList01 { RSDN_DDO_AR:"59.74", SPL_AR:"82.6719", SIL_AMT:"353694000", HTY_NM:"59.7400A" }
 *        dsList01Nm { RSDN_DDO_AR:"전용면적(㎡)", SPL_AR:"공급면적", SIL_AMT:"평균분양가격(원)" }
 *   "03" dsList01 { DDO_AR:"59.89", SPL_AR:"78.754", LS_GMY:"공고문 참조", HTY_NNA:"59.89B" }
 *        dsList01Nm { DDO_AR:"전용면적(㎡)", SPL_AR:"공급면적", LS_GMY:"평균분양가격(원)" }
 *   임대 dsList01Nm { LS_GMY:"임대보증금(원)", RFE:"월임대료(원)", DDO_AR:"전용면적(㎡)" }
 *
 * ⚠️ 금액이 **"공고문 참조"** 라는 글자로 오는 행이 흔하다 → 숫자가 아니면 금액 없음으로 둔다
 *    (그 행은 `allRows` 에만 남아 (b) 규칙에서 면적으로만 쓰인다).
 *
 * @param {unknown} json `getLeaseNoticeSplInfo1` 원문
 * @returns {UnitTable}
 */
export function parseLhSupplyInfo(json) {
  /** @type {UnitRow[]} */
  const amountRows = [];
  /** @type {UnitRow[]} */
  const allRows = [];
  if (!Array.isArray(json)) return { amountRows, allRows };

  // 응답은 [{dsSch}, {dsList01, dsList01Nm, ...}] 처럼 조각난 객체 배열이라 한 자루에 모은다.
  /** @type {Record<string, unknown>} */
  const bag = {};
  for (const el of json) {
    if (el && typeof el === "object" && !Array.isArray(el)) Object.assign(bag, el);
  }

  for (const key of Object.keys(bag)) {
    const m = /^dsList(\d+)$/.exec(key);
    if (!m) continue;
    const rows = bag[key];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const nm = bag[`dsList${m[1]}Nm`];
    const labels = Array.isArray(nm) && nm.length > 0 ? /** @type {Record<string, unknown>} */ (nm[0]) : null;
    const areaKey = findLabeledKey(labels, /전용면적/);
    if (!areaKey) continue; // 전용면적 칸이 없는 목록은 쓸 수 없다
    const supplyKey = findLabeledKey(labels, /공급면적/);
    const amountKey = findLabeledKey(labels, /분양가/); // 임대보증금·월임대료·초기분납금은 제외

    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (r);
      const area = parseRealLoose(rec[areaKey]);
      if (area == null || area <= 0) continue;
      const won = amountKey ? parseRealLoose(rec[amountKey]) : null;
      /** @type {UnitRow} */
      const unit = {
        house_ty: String(area),
        top_amount: won != null && won > 0 ? won / LH_WON_PER_MANWON : null,
        supply_area: supplyKey ? parseRealLoose(rec[supplyKey]) : null,
      };
      allRows.push(unit);
      if (unit.top_amount != null) amountRows.push(unit);
    }
  }
  return { amountRows, allRows };
}

/**
 * 주택형 목록에 **서로 다른 전용면적이 몇 가지** 있는가.
 *
 * (b) 규칙이 "주택형이 정확히 하나"를 요구하는 이유는 **고를 근거가 없어서**다. 그러니 세는 것은
 * 행 수가 아니라 서로 다른 면적 값이다 — 같은 면적이 model_no 만 달리해 여러 줄로 오는 경우가
 * 있는데, 그때는 무엇을 골라도 답이 같으므로 모호하지 않다.
 *
 * @param {UnitRow[]} rows
 * @returns {number[]} 상식 범위 안의 서로 다른 전용면적(오름차순)
 */
export function distinctAreas(rows) {
  /** @type {Set<number>} */
  const seen = new Set();
  for (const r of rows) {
    const a = parseHouseTy(r?.house_ty);
    if (a != null) seen.add(Math.round(a * 10000)); // 부동소수 흔들림 차단
  }
  return [...seen].map((v) => v / 10000).sort((a, b) => a - b);
}

/**
 * @typedef {{ ok: true; rule: "price" | "single"; area: number; supplyArea: number | null;
 *   matchedAmount: number | null; gapRatio: number | null }} FillOk
 * @typedef {{ ok: false; reason: "noValidUnit" | "farGap" | "weakSimNoPrice" | "multiType";
 *   gapRatio?: number; typeCount?: number }} FillNo
 */

/**
 * 이 공고 하나로 이 단지의 면적을 채워도 되는가.
 *
 * (a) **가격 경로** — 저장가가 있고 공고에 분양가 칸이 있을 때. 저장가에 가장 가까운 주택형을 고르고
 *     차이가 30%(`MAX_PRICE_GAP_RATIO`)를 넘으면 버린다. 완화된 이름 매칭(0.60)의 교차검증이다.
 * (b) **단일 주택형 경로** — 가격을 못 쓰는 경우(저장가 없음 / 임대 공고라 분양가 칸 없음).
 *     이름이 0.85 이상이고 주택형이 하나뿐일 때만 채운다.
 *
 * @param {number | null} price 저장된 분양가(만원)
 * @param {number} sim 이름 유사도
 * @param {UnitTable} units
 * @returns {FillOk | FillNo}
 */
export function evaluateCandidate(price, sim, units) {
  const p = price == null ? NaN : Number(price);
  const hasPrice = Number.isFinite(p) && p > 0;

  if (hasPrice && units.amountRows.length > 0) {
    const picked = pickUnitByPrice(units.amountRows, p);
    if (picked == null) return { ok: false, reason: "noValidUnit" };
    const gapRatio = picked.gap / p;
    if (gapRatio > MAX_PRICE_GAP_RATIO) return { ok: false, reason: "farGap", gapRatio };
    return {
      ok: true,
      rule: "price",
      area: picked.area,
      supplyArea: picked.supplyArea,
      matchedAmount: picked.matchedAmount,
      gapRatio,
    };
  }

  // 가격 교차검증을 못 쓴다 → 이름이 유일한 근거라 문턱을 올리고 모호함을 금지한다.
  if (sim < NAME_SIM_STRICT) return { ok: false, reason: "weakSimNoPrice" };
  const areas = distinctAreas(units.allRows);
  if (areas.length === 0) return { ok: false, reason: "noValidUnit" };
  if (areas.length > 1) return { ok: false, reason: "multiType", typeCount: areas.length };

  const area = areas[0];
  const row = units.allRows.find((r) => {
    const a = parseHouseTy(r?.house_ty);
    return a != null && Math.round(a * 10000) === Math.round(area * 10000);
  });
  const supply = row ? Number(row.supply_area) : NaN;
  return {
    ok: true,
    rule: "single",
    area,
    supplyArea: Number.isFinite(supply) && supply > 0 ? supply : null,
    matchedAmount: null,
    gapRatio: null,
  };
}

/**
 * 여러 후보 중 채택 1건 — **이름이 가장 닮은 것 우선**, 동률이면 가격 차이가 작은 것.
 *
 * **이름이 정체성이고 가격은 검문이다.** 가격은 "이 짝이 말이 되는가"를 되묻는 장치라
 * (게이트 30%) 통과 여부만 쓰고, *누구인가*는 이름이 정한다. 순서를 반대로 두면 검문이
 * 정체성을 이겨 뒤집힌다 — 2026-08-27 dry-run 에서 실제로 그랬다:
 *
 *   힐스테이트고덕센트럴(저장가 56,628)
 *     sim 1.000 "힐스테이트 고덕 센트럴"(무순위)      gap  6.2% → 84.39㎡   ← 지금은 채택
 *     sim 0.696 "힐스테이트 평택역센트럴시티"          gap  1.9% → 74.99㎡   ← 옛 순서가 고르던 것(다른 단지)
 *   안양에버포레자연&e편한세상 A1BL(저장가 100,730)
 *     sim 0.813 "안양 에버포레 자연앤 e편한세상(A1BL)" gap  5.2% → 95.36㎡   ← 지금은 채택
 *     sim 0.688 "안양 어반포레 자연앤 e편한세상(민영)" gap  0.5% → 98.996㎡  ← 옛 순서가 고르던 것(다른 단지)
 *
 * 정렬이 완전 결정적이라 재실행해도 같은 답이 나온다(마지막 tie-break 로 공고 키까지 본다).
 * 가격 없는 (b) 경로는 `gapRatio` 가 없으므로 같은 sim 안에서는 가격이 붙은 쪽이 앞선다.
 *
 * @param {Array<{ sim: number; verdict: FillOk | FillNo; notice: Notice }>} evaluated
 * @returns {{ sim: number; verdict: FillOk; notice: Notice } | null}
 */
export function chooseBest(evaluated) {
  const ok = evaluated.filter((e) => e.verdict.ok);
  if (ok.length === 0) return null;
  ok.sort((a, b) => {
    if (a.sim !== b.sim) return b.sim - a.sim;
    const av = /** @type {FillOk} */ (a.verdict);
    const bv = /** @type {FillOk} */ (b.verdict);
    const ar = av.gapRatio == null ? Number.POSITIVE_INFINITY : av.gapRatio;
    const br = bv.gapRatio == null ? Number.POSITIVE_INFINITY : bv.gapRatio;
    if (ar !== br) return ar - br;
    return a.notice.key.localeCompare(b.notice.key);
  });
  return /** @type {{ sim: number; verdict: FillOk; notice: Notice }} */ (ok[0]);
}

/**
 * @typedef {{ src: "applyhome" | "remndr" | "lh"; key: string; name: string; norm: string;
 *   region: string | null; addrText: string;
 *   lh?: { panId: string; upp: string; ais: string; spl: string; ccr: string } }} Notice
 */

/**
 * 공고 한 건을 매칭용 형태로 — 이름 정규화와 시도 판정을 **한 곳에서만** 한다.
 * 테스트도 이 함수를 지나므로 정규화 규칙이 바뀌면 가드가 같이 움직인다.
 *
 * @param {Notice["src"]} src
 * @param {unknown} key 공고 키(청약홈 HOUSE_MANAGE_NO · LH PAN_ID)
 * @param {unknown} name 공고명
 * @param {unknown} regionSource 주소(청약홈 HSSPLY_ADRES) 또는 시도명(LH CNP_CD_NM).
 *   시군구 게이트도 이 글자에서 뽑는다 — LH 는 시도만 주므로 시군구가 null 이 되어 게이트가 열린다.
 * @param {Notice["lh"]} [lh]
 * @returns {Notice | null} 키나 이름이 비면 null(매칭 불가)
 */
export function toNotice(src, key, name, regionSource, lh) {
  const k = String(key ?? "").trim();
  const nm = String(name ?? "");
  const norm = normName(nm);
  if (!k || !norm) return null;
  return {
    src,
    key: k,
    name: nm,
    norm,
    region: noticeRegion(/** @type {string} */ (regionSource)),
    addrText: String(regionSource ?? ""),
    ...(lh ? { lh } : {}),
  };
}

/**
 * 이 단지의 후보 공고 — **정체성 게이트 3중**을 통과하고 이름 유사도가 하한을 넘는 것만,
 * 유사도 내림차순.
 *
 *   ① 시도  — 다르면 거부. 못 알아본 공고(`region === null`)도 거부(검증할 방법이 없다).
 *   ② 시군구 — 양쪽 다 알 때만 비교하고 머리가 다르면 거부. 한쪽이라도 모르면 통과.
 *   ③ 차수  — 양쪽 다 표식이 있을 때만 비교하고 겹치지 않으면 거부. 한쪽만 있으면 통과.
 *   ④ 블록  — 같은 방식. `A1BL` ↔ `A2BL` 처럼 단지가 갈리는 자리를 가른다.
 *
 * ②③④가 ①과 다르게 **모르면 여는** 이유: 시도는 거의 모든 공고가 갖고 있어 닫아도 잃는 게
 * 적지만(10.3%), 시군구·차수는 표기 생략이 흔해 닫으면 맞는 짝까지 죽는다. 1차 방어는 ①이다.
 *
 * 하한이 두 개인 이유: 저장가가 있으면 뒤에서 가격으로 교차검증할 수 있어 이름을 0.60 까지
 * 풀고, 없으면 이름이 유일한 근거라 0.85 를 요구한다(`NAME_SIM_MIN` / `NAME_SIM_STRICT` 주석).
 *
 * @param {{ name: string; region: string | null; gu?: string | null; address?: string | null;
 *   roadAddress?: string | null; price: number | null }} target
 * @param {Notice[]} notices
 * @returns {Array<{ notice: Notice; sim: number }>}
 */
export function selectCandidates(target, notices) {
  /** @type {Array<{ notice: Notice; sim: number }>} */
  const out = [];
  const tn = normName(target.name);
  if (!tn || !target.region) return out;
  const minSim = target.price != null ? NAME_SIM_MIN : NAME_SIM_STRICT;
  const myDistrict = targetDistrict(target);
  for (const n of notices) {
    if (!n.region || n.region !== target.region) continue;
    const theirDistrict = districtHead(n.region, n.addrText);
    if (myDistrict && theirDistrict && myDistrict !== theirDistrict) continue;
    if (phaseConflict(target.name, n.name)) continue;
    if (blockConflict(target.name, n.name)) continue;
    const sim = stringSimilarity(tn, n.norm);
    if (sim < minSim) continue;
    out.push({ notice: n, sim });
  }
  // 유사도 내림차순 + 키 사전순 = 재실행해도 같은 순서(LH 후보 상한이 흔들리지 않게).
  out.sort((a, b) => b.sim - a.sim || a.notice.key.localeCompare(b.notice.key));
  return out;
}

/**
 * 백필 대상 선별 — **손님에게 보이는 단지** 중, VIEW 가 고르는 행이 비어 있는 것만.
 *
 * `latest_prices` 는 `apartment_id` 별로 `(presale_% 가 뒤로, recorded_at DESC)` 순의 첫 행을 쓴다.
 * 그러니 `seed` 행이 하나라도 있으면 그쪽이 이기고, 없을 때만 `presale_%` 중 가장 최근 행이
 * 화면에 닿는다(`backfill-presale-area{,-applyhome}.mjs` 와 같은 규칙).
 *
 * 순수 함수로 뽑아 둔 이유: DB 없이 회귀 가드를 걸기 위해서다.
 *
 * @param {Array<{ id: string; name: string | null; region: string | null; gu?: string | null;
 *   address?: string | null; roadAddress?: string | null; area: unknown }>} visible
 *   `apartments_flat` 에서 임대형을 걷어낸 목록(= 손님이 보는 단지)
 * @param {Array<{ id: number; apartment_id: string; area: unknown; price: unknown; house_type: string | null; recorded_at: string | null }>} priceRows
 * @param {Set<string>} hasSupply `applyhome_unit_supply` 를 가진 apartment_id
 * @returns {{
 *   targets: Array<{ rowId: number; aptId: string; name: string; region: string | null; gu: string | null;
 *     address: string | null; roadAddress: string | null; price: number | null }>;
 *   alreadyFilled: number; hasSupplyRows: number; seedWins: number; noPriceRow: number;
 * }}
 */
export function selectNoticeAreaTargets(visible, priceRows, hasSupply) {
  /** @type {Map<string, { seed: boolean; best: { id: number; price: unknown; recorded_at: string | null } | null }>} */
  const byApt = new Map();
  for (const r of priceRows) {
    const key = String(r.apartment_id);
    let e = byApt.get(key);
    if (!e) {
      e = { seed: false, best: null };
      byApt.set(key, e);
    }
    if (!String(r.house_type ?? "").startsWith("presale_")) {
      e.seed = true;
      continue;
    }
    if (e.best == null || String(r.recorded_at ?? "") > String(e.best.recorded_at ?? "")) {
      e.best = { id: r.id, price: r.price, recorded_at: r.recorded_at ?? null };
    }
  }

  /** @type {Array<{ rowId: number; aptId: string; name: string; region: string | null; gu: string | null; address: string | null; roadAddress: string | null; price: number | null }>} */
  const targets = [];
  let alreadyFilled = 0;
  let hasSupplyRows = 0;
  let seedWins = 0;
  let noPriceRow = 0;

  for (const a of visible) {
    const aptId = String(a.id);
    const area = Number(a.area);
    if (Number.isFinite(area) && area > 0) {
      alreadyFilled++;
      continue;
    }
    // 청약홈 표가 있으면 backfill-presale-area-applyhome.mjs 소관 — 여기서 두 번 손대지 않는다.
    if (hasSupply.has(aptId)) {
      hasSupplyRows++;
      continue;
    }
    const e = byApt.get(aptId);
    if (e && e.seed) {
      seedWins++;
      continue;
    }
    if (!e || e.best == null) {
      // prices 행 자체가 없다 → 행 생성은 사장님 보류 결정이라 건드리지 않는다.
      noPriceRow++;
      continue;
    }
    const p = Number(e.best.price);
    targets.push({
      rowId: e.best.id,
      aptId,
      name: a.name ?? "",
      region: a.region ?? null,
      gu: a.gu ?? null,
      address: a.address ?? null,
      roadAddress: a.roadAddress ?? null,
      price: Number.isFinite(p) && p > 0 ? p : null,
    });
  }
  return { targets, alreadyFilled, hasSupplyRows, seedWins, noPriceRow };
}

// ── 외부 조회 ───────────────────────────────────────────────────────────

/**
 * odcloud 페이지네이션 (`collect-applyhome-detail.mjs:57-74` 답습).
 * @param {string} op
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchOdcloud(op) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: API_KEY || "" });
    const res = await fetch(`${ODCLOUD_BASE}/${op}?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${op})`);
    const json = /** @type {{ data?: Record<string, unknown>[]; totalCount?: number }} */ (await res.json());
    const data = json.data || [];
    all.push(...data);
    if (all.length >= (json.totalCount || 0) || data.length < 1000) break;
    page++;
    await sleep(200);
  }
  log(`  ${op}: ${all.length}건`);
  return all;
}

/**
 * LH 공고 목록. `UPP_AIS_TP_CD` 를 목록 API 가 받는다(2026-08-27 실측: 전 유형 21,271 →
 * 05 분양주택 1,161 / 06 임대주택 14,760) — 토지·상가를 안 받아 절반 이하로 줄인다.
 *
 * @param {string} upp
 * @param {string} endDate YYYYMMDD
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchLhNotices(upp, endDate) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({
      PG_SZ: "100",
      PAGE: String(page),
      PAN_ST_DT: LH_LIST_FROM,
      PAN_ED_DT: endDate,
      UPP_AIS_TP_CD: upp,
    });
    const res = await fetch(`${LH_LIST}?serviceKey=${encodeURIComponent(API_KEY || "")}&${params}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} (LH 목록 ${upp})`);
    const json = await res.json();
    const rows = Array.isArray(json)
      ? /** @type {Record<string, unknown>[]} */ (
          /** @type {any} */ (json.find((x) => x && typeof x === "object" && "dsList" in x))?.dsList ?? []
        )
      : [];
    if (rows.length === 0) break;
    all.push(...rows);
    const total = Number(rows[0]?.ALL_CNT ?? 0);
    if (all.length >= total || rows.length < 100) break;
    page++;
    await sleep(400);
  }
  log(`  LH 목록 UPP=${upp}: ${all.length}건`);
  return all;
}

/**
 * LH 공급정보 1건. **목록 행이 들고 있는 코드 4개를 그대로 실어 보내야 한다** — 임의 코드로
 * 찌르면 `dsList` 가 빈 채로 200 이 돌아온다(2026-08-27 실측).
 * 공식 요청변수: ServiceKey · PAN_ID · UPP_AIS_TP_CD · SPL_INF_TP_CD · CCR_CNNT_SYS_DS_CD (필수) · AIS_TP_CD (선택)
 * (data.go.kr 15056765 상세기능 표. `serviceKey` 소문자로도 동작함을 실측.)
 *
 * @param {{ panId: string; upp: string; ais: string; spl: string; ccr: string }} n
 * @returns {Promise<UnitTable>}
 */
async function fetchLhSupply(n) {
  const params = new URLSearchParams({
    PAN_ID: n.panId,
    UPP_AIS_TP_CD: n.upp,
    AIS_TP_CD: n.ais,
    SPL_INF_TP_CD: n.spl,
    CCR_CNNT_SYS_DS_CD: n.ccr,
  });
  const res = await fetch(`${LH_SPL}?serviceKey=${encodeURIComponent(API_KEY || "")}&${params}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (LH 공급정보 ${n.panId})`);
  return parseLhSupplyInfo(await res.json());
}

// ── 메인 ────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error(`[${PHASE}] MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)`);
    process.exit(1);
  }
  const sb = getSupabase();
  log(dryRun ? "DRY-RUN 모드 (저장 안 함)" : "실행 모드 — ⚠️ --dry-run 매칭표를 먼저 검수했는지 확인할 것");

  // 1. 대상 도출 (손님이 보는 단지 = apartments_flat − 임대형)
  const flat =
    /** @type {Array<{ id: string; name: string | null; region: string | null; gu: string | null; address: string | null; roadAddress: string | null; area: unknown; presaleType: string | null }>} */ (
      await fetchAllByCursor(sb, "apartments_flat", "id, name, region, gu, address, roadAddress, area, presaleType", "id")
    );
  const visible = excludeLeaseUnits(flat);
  log(`apartments_flat ${flat.length}행 → 임대형 ${flat.length - visible.length}건 제외 = 손님 노출 ${visible.length}건`);

  const priceRows =
    /** @type {Array<{ id: number; apartment_id: string; area: unknown; price: unknown; house_type: string | null; recorded_at: string | null }>} */ (
      await fetchAllByCursor(sb, "prices", "id, apartment_id, area, price, house_type, recorded_at", "id")
    );
  const supplyRows = /** @type {Array<{ apartment_id: string }>} */ (
    await fetchAllByCursor(sb, "applyhome_unit_supply", "id, apartment_id", "id")
  );
  const hasSupply = new Set(supplyRows.map((r) => String(r.apartment_id)));
  log(`prices ${priceRows.length}행 · applyhome_unit_supply ${supplyRows.length}행(${hasSupply.size}단지) 조회`);

  const { targets, alreadyFilled, hasSupplyRows, seedWins, noPriceRow } = selectNoticeAreaTargets(
    visible,
    priceRows,
    hasSupply,
  );
  log(
    `대상 ${targets.length}건 | 이미 면적 있음 ${alreadyFilled} | 청약홈 표 있음(다른 스크립트 소관) ${hasSupplyRows} | ` +
      `청약홈 행 우선 ${seedWins} | prices 행 자체 없음 ${noPriceRow}`,
  );
  if (targets.length === 0) {
    log("백필 대상 없음 — 종료");
    return;
  }

  // 2. 공고 원문 수집
  log("공고 원문 조회 시작...");
  /** @type {Notice[]} */
  const notices = [];

  const aptDetail = await fetchOdcloud("getAPTLttotPblancDetail");
  const remDetail = await fetchOdcloud("getRemndrLttotPblancDetail");
  const aptMdl = await fetchOdcloud("getAPTLttotPblancMdl");
  const remMdl = await fetchOdcloud("getRemndrLttotPblancMdl");

  for (const [src, rows] of /** @type {Array<["applyhome" | "remndr", Record<string, unknown>[]]>} */ ([
    ["applyhome", aptDetail],
    ["remndr", remDetail],
  ])) {
    for (const r of rows) {
      const n = toNotice(src, r.HOUSE_MANAGE_NO, r.HOUSE_NM, r.HSSPLY_ADRES);
      if (n) notices.push(n);
    }
  }

  /** @type {Map<string, UnitTable>} 청약홈 주택형 표 (house_manage_no → 표). src 별로 키가 겹치지 않게 접두사를 붙인다. */
  const applyhomeUnits = new Map();
  for (const [src, rows] of /** @type {Array<["applyhome" | "remndr", Record<string, unknown>[]]>} */ ([
    ["applyhome", aptMdl],
    ["remndr", remMdl],
  ])) {
    for (const r of rows) {
      const key = `${src}:${String(r.HOUSE_MANAGE_NO ?? "").trim()}`;
      let t = applyhomeUnits.get(key);
      if (!t) {
        t = { amountRows: [], allRows: [] };
        applyhomeUnits.set(key, t);
      }
      const u = toApplyhomeUnit(r);
      t.allRows.push(u);
      if (u.top_amount != null && u.top_amount > 0) t.amountRows.push(u);
    }
  }

  if (!skipLh) {
    const today = new Date();
    const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    for (const upp of LH_UPPER_TYPES) {
      for (const r of await fetchLhNotices(upp, endDate)) {
        const panId = String(r.PAN_ID ?? "").trim();
        const n = toNotice("lh", panId, r.PAN_NM, r.CNP_CD_NM, {
          panId,
          upp: String(r.UPP_AIS_TP_CD ?? ""),
          ais: String(r.AIS_TP_CD ?? ""),
          spl: String(r.SPL_INF_TP_CD ?? ""),
          ccr: String(r.CCR_CNNT_SYS_DS_CD ?? ""),
        });
        if (n) notices.push(n);
      }
      await sleep(400);
    }
  } else {
    log("  LH 목록 생략(--no-lh)");
  }
  log(`공고 후보 ${notices.length}건 (시도 미해석 ${notices.filter((n) => !n.region).length}건은 매칭에서 제외)`);

  // 3. 매칭 + 판정
  let interrupted = false;
  const onSig = () => {
    interrupted = true;
    log("중단 신호 — 현재 단지까지 마치고 종료");
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  /** @type {Map<string, UnitTable>} LH 공급정보 조회 캐시 (PAN_ID 중복 조회 차단) */
  const lhCache = new Map();
  /** @type {Array<{ t: typeof targets[number]; best: NonNullable<ReturnType<typeof chooseBest>>; topSim: number }>} */
  const decided = [];
  /** @type {Record<string, number>} */
  const skipped = {};
  /** @type {string[]} */
  const skipLines = [];
  let lhCalls = 0;
  let lhFailed = 0;

  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  log(`매칭 시작 — 대상 ${slice.length}건${limit > 0 ? ` (--limit=${limit})` : ""}`);

  for (const t of slice) {
    if (interrupted) break;
    const cands = selectCandidates(t, notices);

    if (cands.length === 0) {
      skipped.noCandidate = (skipped.noCandidate ?? 0) + 1;
      skipLines.push(`  [스킵:후보없음] ${t.aptId} ${t.name} (${t.region}, 가격 ${t.price ?? "없음"})`);
      continue;
    }

    // LH 는 후보마다 API 1회라 상위 N 개로 묶는다(청약홈은 이미 메모리에 있어 전부 본다).
    let lhSeen = 0;
    /** @type {Array<{ sim: number; verdict: FillOk | FillNo; notice: Notice }>} */
    const evaluated = [];
    for (const c of cands) {
      if (interrupted) break;
      /** @type {UnitTable | null} */
      let units = null;
      if (c.notice.src === "lh") {
        if (lhSeen >= LH_CANDIDATE_CAP) continue;
        lhSeen++;
        const cached = lhCache.get(c.notice.key);
        if (cached) {
          units = cached;
        } else {
          try {
            units = await fetchLhSupply(/** @type {NonNullable<Notice["lh"]>} */ (c.notice.lh));
            lhCalls++;
            lhCache.set(c.notice.key, units);
            await sleep(400);
          } catch (e) {
            lhFailed++;
            console.error(`[${PHASE}] LH 공급정보 실패 ${c.notice.key}: ${e instanceof Error ? e.message : String(e)}`);
            continue;
          }
        }
      } else {
        units = applyhomeUnits.get(`${c.notice.src}:${c.notice.key}`) ?? { amountRows: [], allRows: [] };
      }
      evaluated.push({ sim: c.sim, verdict: evaluateCandidate(t.price, c.sim, units), notice: c.notice });
    }

    const best = chooseBest(evaluated);
    if (!best) {
      // 왜 하나도 못 썼는지 — 가장 흔한 사유를 대표로 남긴다.
      const reasons = evaluated.map((e) => /** @type {FillNo} */ (e.verdict).reason);
      const reason = reasons.includes("farGap")
        ? "farGap"
        : reasons.includes("multiType")
          ? "multiType"
          : reasons.includes("weakSimNoPrice")
            ? "weakSimNoPrice"
            : reasons.includes("noValidUnit")
              ? "noValidUnit"
              : "noCandidate";
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      const top = evaluated[0];
      skipLines.push(
        `  [스킵:${reason}] ${t.aptId} ${t.name} (${t.region}, 가격 ${t.price ?? "없음"}) ` +
          `← 최고유사 ${top ? `${top.sim.toFixed(3)} [${top.notice.src}] ${top.notice.name}` : "-"}`,
      );
      continue;
    }
    decided.push({ t, best, topSim: cands[0].sim });
  }

  // 4. 매칭표 (사람 검수용)
  log("");
  log("=== 매칭표 (채움 후보) ===");
  log("단지id | 단지명 | 시군구 | 출처 | sim | 공고명 | 면적(전용/공급) | 가격(저장↔공고, 차이) | 판정");
  for (const d of decided) {
    const v = d.best.verdict;
    const gap = v.gapRatio == null ? "주택형 1개(가격 미사용)" : `${(v.gapRatio * 100).toFixed(1)}%`;
    const priceCol =
      v.matchedAmount == null ? `${d.t.price ?? "없음"} ↔ -` : `${d.t.price} ↔ ${Math.round(v.matchedAmount)}`;
    // 채택은 sim 최댓값이라 역전이 날 수 없다. 그래도 정렬이 뒤집히면 바로 보이게 남겨 둔다.
    const inv = d.best.sim < d.topSim - 1e-9 ? " ⚠️sim역전(있으면 안 됨)" : "";
    const weak = d.best.sim < NAME_SIM_STRICT ? " ⚠️저신뢰이름" : "";
    const mine = targetDistrict(d.t);
    const theirs = districtHead(d.best.notice.region, d.best.notice.addrText);
    log(
      `  ${d.t.aptId} | ${d.t.name} | ${mine ?? "?"}↔${theirs ?? "?"} | ${d.best.notice.src} | ${d.best.sim.toFixed(3)} | ` +
        `${d.best.notice.name} | ${v.area}㎡ / ${v.supplyArea ?? "-"} | ${priceCol}, ${gap} | ${v.rule}${inv}${weak}`,
    );
  }
  log("");
  log("=== 스킵 내역 ===");
  for (const line of skipLines) log(line);
  log("");
  const bySrc = /** @type {Record<string, number>} */ ({});
  const byRule = /** @type {Record<string, number>} */ ({});
  for (const d of decided) {
    bySrc[d.best.notice.src] = (bySrc[d.best.notice.src] ?? 0) + 1;
    byRule[d.best.verdict.rule] = (byRule[d.best.verdict.rule] ?? 0) + 1;
  }
  log(`채움 후보 ${decided.length}건 — 출처별 ${JSON.stringify(bySrc)} / 게이트별 ${JSON.stringify(byRule)}`);
  log(`스킵 ${Object.values(skipped).reduce((a, b) => a + b, 0)}건 — 사유별 ${JSON.stringify(skipped)}`);
  log(`LH 공급정보 호출 ${lhCalls}회 (실패 ${lhFailed})`);

  if (dryRun) {
    log(`[DRY-RUN] 저장 0건 — 위 매칭표를 검수한 뒤 --dry-run 없이 다시 실행할 것`);
    return;
  }

  // 5. 저장 — NULL 인 칸만 채운다
  let filled = 0;
  let failed = 0;
  for (const d of decided) {
    if (interrupted) break;
    const v = d.best.verdict;
    const { error } = await sb.from("prices").update({ area: v.area, supply_area: v.supplyArea }).eq("id", d.t.rowId);
    if (error) {
      failed++;
      console.error(`[${PHASE}] row ${d.t.rowId} 갱신 실패: ${error.message}`);
    } else {
      filled++;
      log(`  row ${d.t.rowId} ${d.t.aptId} ← 전용 ${v.area}㎡ (${v.rule}, ${d.best.notice.src})`);
    }
  }
  log(`✅ 완료 — 채움 ${filled} · 실패 ${failed}${interrupted ? " · 중단됨" : ""}`);
  if (failed > 0) process.exitCode = 1;
  await sleep(0);
}

// CLI 직접 실행 시에만 main() 호출 (테스트가 순수 함수만 import 할 수 있게)
const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ e) => {
    console.error(`[${PHASE}] 실패:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
