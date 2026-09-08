// @ts-check
/**
 * 자리표시용(placeholder) 주소로 좌표가 어긋난 단지 — **3출처 교차 검증** 정정 도구 v2 (세션540)
 *
 * ## 무엇이 틀렸나 (원인 — 2026-09-03 실측 확정)
 *
 * `geocode-missing.mjs:163` 의 **키워드 폴백**(`[region, gu, name]`)이 단지 이름을 못 잡으면
 * 구청 같은 **대표 장소의 좌표**를 돌려준다. 그 좌표를 `reverse-geocode.mjs` 가 역지오코딩해
 * `address`·`road_address`·`bjd_code`·`lot_*` 까지 **그럴듯하게** 써넣는다. 그래서 서로 완전히
 * 다른 프로젝트가 **같은 지번·같은 좌표**를 공유하는 무리가 생긴다(세션539 발견: 314곳·최대 131km).
 *
 * 좌표가 어긋나면 교통·학군·인프라·인근시세가 전부 **다른 동네 기준**으로 계산된다.
 * 입지 비중은 실거주 45% · 자녀교육 70% 라 점수 왜곡이 크다.
 *
 * ## 후보 풀 — 의심일 뿐, 판정은 출처로 한다
 *
 * `apartments.address` 를 **2곳 이상이 공유**하는 행(2026-09-03 기준 467그룹·1,811곳)을 후보로 삼는다.
 * ⚠️ 같은 프로젝트의 무순위/임의공급 회차가 **정당하게** 같은 주소를 쓰는 경우가 다수 섞여 있다.
 * 그래서 이 풀은 "여기부터 보자"는 뜻일 뿐이고, 고칠지 말지는 아래 세 출처가 정한다.
 *
 * ## 출처 우선순위 (양성 대조군으로 검증됨 — `probe-must-be-self-verified.md`)
 *
 * | 기호 | 출처 | 무엇을 믿나 |
 * |---|---|---|
 * | **K** | 카카오 키워드 POI(`/v2/local/search/keyword.json`) | 그 이름의 아파트가 실제로 있는 자리 |
 * | **A** | 청약홈 공급주소(`getRemndrLttotPblancDetail`)를 카카오 **주소검색**으로 지오코딩 | 공고에 적힌 공식 지번 |
 * | **C** | `complexes`(네이버 실단지) 이름매칭 | 보조 — 단독으로는 근거가 약하다 |
 *
 * ### 오탐 사례 (지역 필터·차수 게이트가 왜 필요한가)
 *
 * - **시도 필터만 걸면 브랜드명 충돌로 330km** — "힐스테이트"·"두산위브더제니스" 같은 전국 공용
 *   브랜드는 시도 안에서도 55km 떨어진 별개 단지와 매칭된다. 그래서 C 는 **시/군(광역시는 구)**
 *   단위 키로 좁힌다(`cityKey`/`complexKey`).
 * - **2단지 ↔ 1BL 차수 착오** — 이름 유사도만 보면 같은 브랜드의 다른 블록이 최고점을 받는다.
 *   `phaseConsistent` 로 차수/블록 숫자 집합의 교집합을 요구한다.
 * - **센트럴 → 퍼스트 서브브랜드** — 같은 시행사의 인접 프로젝트끼리 0.8대 유사도가 나온다.
 *   C 단독 채택은 `sim ≥ 0.9 + 차수 일관`일 때만 인정하고, 그마저 `--apply` 대상에서 뺐다.
 * - **접미어 때문에 진짜 일치가 떨어진다** — "등촌역한울에이치밸리움" ⊂ "등촌역한울에이치밸리움1차
 *   아파트" 는 sim 0.81 이라 0.85 문턱을 못 넘는다. 공백 제거 **부분문자열**이면 강함으로 구제한다.
 * - **동 중심점 폴백 금지** — 카카오 주소검색이 `address_type: "REGION"`(동 중심점)을 주면 그건
 *   "그 동 어딘가"이지 그 단지가 아니다. `REGION_ADDR`/`ROAD_ADDR` 만 인정한다(`isPreciseGeocode`).
 *
 * ### A 출처의 알려진 한계 (실측 2026-09-05 — 없는 것을 있다고 하지 않기 위해 적는다)
 *
 * 로스터에 주소가 **있어도** 지오코딩이 안 되는 경우가 잦다. 공급주소가 **도로명**일 때 특히
 * 그렇다 — `"서울특별시 강서구 공항대로 533"`·`"대구광역시 수성구 파동로 43-9"` 는 카카오
 * 주소검색이 **0건**을 준다(시도 표기를 약칭으로 바꿔도 같다. 같은 단지의 지번
 * `"서울특별시 강서구 등촌동 665-15"` 는 정상 조회된다). 즉 이건 우리 질의 형식 문제가 아니라
 * 그 도로명 주소가 검색 DB 에 없는 것이다. 그때 A 는 없는 셈 치고 K 로 내려간다.
 * 덤프의 `applyGeocoded` 로 그 비율을 볼 수 있다.
 *
 * ## 판정 (현재 좌표와 300m 기준 — `classify`)
 *
 * | 등급 | 조건 | `--apply` |
 * |---|---|---|
 * | `ok` | **어떤 출처든** 현재 좌표와 ≤300m | 건드리지 않음 |
 * | `A2` | K·A 둘 다 있고 서로 ≤300m, 현재와는 >300m | ✅ |
 * | `B_apply` | A 단독 | ✅ |
 * | `B_kakao_strong` | K 강함 단독 | ✅ |
 * | `B_kakao_weak` | K 약함(0.7~0.85) 단독 | `--include-weak` 일 때만 |
 * | `B_complex` | C 단독이 sim ≥0.9 + 차수 일관 | ❌ 보고만 |
 * | `conflict` | K·A 가 서로 >300m | ❌ 보고만 |
 * | `none` | 출처 없음 | ❌ 보고만 |
 *
 * `none` 중 **다른 핵심이름 2종 이상이 소수 5자리 동일 좌표를 공유**하는 것은 `진짜 자리표시`로
 * 따로 표기한다(고칠 재료가 없다는 사실 자체가 정보다).
 *
 * ## 무엇을 저장하나
 *
 * - `address` — **A 가 있으면 정규화한 청약홈 표기 원문**을 쓴다. 카카오가 돌려주는 명칭
 *   (예: "전남광주통합특별시…")을 쓰면 우리가 재지 않은 행정 개편을 주장하게 된다. A 가 없으면
 *   카카오 `address_name`.
 * - `road_address` — **null**. 도로명은 추측하지 않는다.
 * - `lat`/`lng` — 채택 출처의 좌표. `updated_at` 갱신.
 *
 * ## 파생표 정리 (`--purge-derived`)
 *
 * `transport`·`schools` 는 단일 소유라 행 삭제. **`infra` 는 5개 수집기가 컬럼을 나눠 쓰므로
 * 행 삭제 금지** — `infra-kakao` 소유 9컬럼만 null(세션539 실사고: 행을 지워 13컬럼 유실).
 *
 * ⏰ **시간창** — 화면 정적 JSON 은 `daily-deploy.yml`(KST 03:00)이 재생성하고 재수집은
 * `collect-naver-listings-incremental.yml`(KST 05:30)이 한다. 그 **사이**에서만 지워야 한다.
 * 밖에서 지우면 "지하철 없음·병원 0개"가 최대 하루 화면에 나간다(`purge-to-recollect-timing.md`).
 * `--force-timing` 으로만 강행 가능.
 *
 * ## 정정할 때 함께 — 부속 필드 재정합(`--refit-fields`)
 *
 * 좌표를 옮기면 `dong`·`bjd_code`·`lot_main`·`lot_sub`·`road_address` 가 **옛 자리표시 좌표에서
 * 역산된 값 그대로** 남는다. `bjd_code` 는 건축HUB 조회 키라 그대로 두면 **남의 건물 정보**가 붙는다.
 * 이 모드는 `--ids-file` 의 id 만 골라 새 좌표로 카카오 두 곳(`coord2regioncode`·`coord2address`)을
 * 다시 물어 그 다섯 필드만 갱신한다. **`address` 는 건드리지 않는다** — A 출처(청약홈 표기 원문)를
 * 보존하는 게 위 `## 무엇을 저장하나` 의 규칙이고, 카카오 표기로 덮으면 그 결정이 뒤집힌다.
 * `region`·`gu`·`lat`·`lng` 도 그대로 둔다(파생표를 지우지 않으므로 안전 시간창과 무관).
 *
 * ⚠️ v2 에서는 이미 정정된 행이 `ok` 로 판정돼 정정 목록에서 빠진다. 그래서 **지난번에 고친
 * 행들의 파생표를 지우려면** `--ids-file=<json>` 으로 id 목록을 명시해야 한다
 * (`scripts/data/placeholder-coord-fixes-2026-09.json`).
 *
 * ## 사용법
 *
 *   node scripts/fix-placeholder-addresses.mjs --out=/tmp/v2.json          # 미리보기(기본)
 *   node scripts/fix-placeholder-addresses.mjs --limit=60 --out=…          # 개발용 표본
 *   node scripts/fix-placeholder-addresses.mjs --apply                     # A2+B_apply+B_kakao_strong
 *   node scripts/fix-placeholder-addresses.mjs --apply --include-weak      # + B_kakao_weak
 *   node scripts/fix-placeholder-addresses.mjs --apply --purge-derived     # + 파생표 정리(시간창 확인)
 *   node scripts/fix-placeholder-addresses.mjs --purge-derived --ids-file=scripts/data/placeholder-coord-fixes-2026-09.json --apply
 *   node scripts/fix-placeholder-addresses.mjs --refit-fields --ids-file=scripts/data/…json          # 부속 필드 미리보기
 *   node scripts/fix-placeholder-addresses.mjs --refit-fields --ids-file=…json --apply               # 부속 필드 반영
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 마라 — SIGPIPE 로 중간에 죽는다(`pipe-kills-collector.md`).
 * 파일로 리다이렉트할 것.
 *
 * ⚠️ `--apply` 는 **미리보기 결과를 적용하는 게 아니라 전체를 다시 분석**한다. 그래서 청약홈 로스터가
 * 0건이면 중단한다(fail-close, 세션542) — 외부 출처 하나가 그 순간 비면 판정이 통째로 바뀌기 때문이다.
 * 반영 직후에는 미리보기 JSON 과 **id 집합을 대조**할 것(후속: `--apply-from=<dry-run json>`, BACKLOG).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadEnv,
  getSupabase,
  selectAll,
  stringSimilarity,
  haversineMeters,
  sleep,
  log,
  logError,
  ROOT,
} from "./collectors/_shared.mjs";
// 세션541: 카카오 게이트(POI 선별 `cleanName`·`shortRegion`·`pickKakaoCandidate`·유사도 상수 +
// 주소검색 정밀도 `isPreciseGeocode`)는 `scripts/collectors/_kakao-poi.mjs` 로 옮겼다 — 자동
// 지오코딩 통로들(geocode-missing 키워드, applyhome-seed 주소·키워드)이 이 도구와 **같은 규칙**을
// 쓰게 하기 위해서다. 그 함수들의 가드는 `_kakao-poi.test.mjs` 와 이 도구 테스트가 지킨다.
import { cleanName, shortRegion, pickKakaoCandidate, isPreciseGeocode } from "./collectors/_kakao-poi.mjs";

loadEnv();
const PHASE = "fix-placeholder";

/** 현재 좌표와 이만큼 떨어져 있으면 "다른 자리"로 본다. */
export const NEAR_M = 300;
/** complexes 이름매칭 최소 유사도. */
export const COMPLEX_MIN_SIM = 0.75;
/** C 단독 채택에 필요한 유사도. */
export const COMPLEX_SOLO_SIM = 0.9;
/** 차수 정보가 한쪽에만 있을 때 C 에 요구하는 유사도. */
export const COMPLEX_ONE_SIDED_SIM = 0.85;
/** 카카오 요청 간 간격(ms). */
const KAKAO_GAP_MS = 200;

/** 광역시·특별시 — 시/군이 아니라 **구(군)** 단위로 키를 만든다. */
export const METRO_REGIONS = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산"]);

/** `--apply` 가 실제로 반영하는 등급. */
export const APPLY_TIERS = new Set(["A2", "B_apply", "B_kakao_strong"]);

/** infra-kakao 가 소유한 컬럼 — purge 시 이 컬럼만 null(행 삭제 금지). */
export const INFRA_KAKAO_COLUMNS = [
  "hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park", "subway_dist",
];
/** 단일 소유 테이블 — purge 시 행 삭제 가능. */
export const SOLE_OWNER_TABLES = ["transport", "schools"];

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";
// `--refit-fields` 전용 — 좌표를 고친 뒤 부속 필드를 새 좌표로 다시 뽑는다.
const KAKAO_REGION_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";
const KAKAO_COORD2ADDR_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
const APPLYHOME_URL =
  "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail";

// ────────────────────────────── 순수 함수 ──────────────────────────────

/**
 * 주소 앞의 시도 토큰을 떼어낸다.
 *
 * ⚠️ **이게 없으면 "대구 달성군 …" 이 `"대구 대구"` 가 된다** — `대구`·`대구광역시` 자체가
 * `구` 로 끝나기 때문이다(테스트가 잡은 실제 결함). 시도 토큰은 우리가 이미 `region` 으로
 * 알고 있으니 주소에서 지우고 시작한다.
 * @param {string} addr
 * @param {string | null} short 시도 약칭
 * @returns {string}
 */
function stripSidoToken(addr, short) {
  if (!short) return addr;
  const parts = addr.trim().split(/\s+/);
  if (parts.length > 1 && shortRegion(parts[0]) === short) return parts.slice(1).join(" ");
  return addr;
}

/**
 * apartments 쪽 지역 키. `complexKey` 와 **같은 문자열**을 내야 매칭된다.
 *
 * - 세종 → `"세종"`
 * - 광역시/특별시 → `"<시도약칭> <구|군>"` — 구 이름만 쓰면 "남구·중구"가 여러 광역시에 있어 오탐.
 * - 도 → address 의 `시|군` 토큰(예: "경기도 부천시 오정구 원종동" → `"부천시"`).
 *   ⚠️ 광역시 주소는 첫 토큰이 "부산광역시"라 이 규칙을 쓰면 안 된다(그래서 분기가 있다).
 * @param {unknown} address
 * @param {unknown} region
 * @returns {string | null}
 */
export function cityKey(address, region) {
  const short = shortRegion(region);
  const addr = stripSidoToken(String(address ?? ""), short);
  if (short === "세종") return "세종";
  if (short && METRO_REGIONS.has(short)) {
    const m = addr.match(/(\S+?[구군])(?=\s|$)/);
    return m ? `${short} ${m[1]}` : null;
  }
  const m = addr.match(/(\S+?시|\S+?군)(?=\s|$)/);
  return m ? m[1] : null;
}

/**
 * complexes 쪽 지역 키(`cityKey` 와 짝).
 * @param {unknown} sido
 * @param {unknown} sigungu
 * @returns {string | null}
 */
export function complexKey(sido, sigungu) {
  const short = shortRegion(sido);
  const sgg = String(sigungu ?? "").trim();
  if (short === "세종") return "세종";
  if (short && METRO_REGIONS.has(short)) {
    const m = sgg.match(/(\S+?[구군])(?=\s|$)/);
    return m ? `${short} ${m[1]}` : null;
  }
  if (!sgg) return null;
  const m = sgg.match(/^(\S+?시|\S+?군)/);
  return m ? m[1] : sgg;
}

/**
 * 청약홈 `HSSPLY_ADRES` 를 지오코딩 가능한 한 필지 주소로 정규화한다.
 *
 * `"인천광역시 연수구 송도동 109, 109-2번지(F20-1BL)"` → `"인천광역시 연수구 송도동 109"`
 * @param {unknown} addr
 * @returns {string}
 */
export function normalizeApplyhomeAddress(addr) {
  let s = String(addr ?? "").replace(/\([^)]*\)/g, " ");
  s = s.replace(/\s*외\s*\d+\s*필지.*$/, " ");
  const comma = s.indexOf(",");
  if (comma >= 0) s = s.slice(0, comma);
  s = s.replace(/번지/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*(일원|일대)$/, "").trim();
  return s;
}

/** 차수/블록 숫자 추출용. */
const PHASE_RE = /(\d+)\s*(차|단지|BL|블록|블럭)/gi;

/**
 * 이름에서 차수·블록 숫자 집합을 뽑는다("힐스테이트 오룡 2단지" → `{"2"}`).
 * @param {unknown} name
 * @returns {Set<string>}
 */
export function extractPhases(name) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of String(name ?? "").matchAll(PHASE_RE)) {
    out.add(m[1].replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/**
 * 두 이름의 차수 일관성.
 * - `"ok"` — 둘 다 차수가 없거나, 있는데 교집합이 있다
 * - `"one-sided"` — 한쪽에만 차수가 있다(더 높은 유사도를 요구한다)
 * - `"conflict"` — 둘 다 있는데 겹치지 않는다(**거부**: 2단지 ↔ 1BL)
 * @param {unknown} aName
 * @param {unknown} cName
 * @returns {"ok" | "one-sided" | "conflict"}
 */
export function phaseConsistent(aName, cName) {
  const a = extractPhases(aName);
  const c = extractPhases(cName);
  if (a.size === 0 && c.size === 0) return "ok";
  if (a.size === 0 || c.size === 0) return "one-sided";
  for (const v of a) if (c.has(v)) return "ok";
  return "conflict";
}

/**
 * 세 출처와 현재 좌표를 놓고 등급을 매긴다.
 *
 * ⚠️ **가장 먼저 "이미 정상"을 가른다** — 어떤 출처든 현재 좌표 근처면 건드리지 않는다.
 * 세션539 소사역 사고에서 이미 맞는 21곳을 다시 옮길 뻔했다.
 * @param {{
 *   cur: { lat: number | null, lng: number | null } | null,
 *   K?: { lat: number, lng: number, strong: boolean } | null,
 *   A?: { lat: number, lng: number } | null,
 *   C?: { lat: number, lng: number, solo: boolean } | null,
 * }} input
 * @returns {{ tier: string, source: "A" | "K" | "C" | null, reason: string }}
 */
export function classify({ cur, K = null, A = null, C = null }) {
  if (!cur || cur.lat == null || cur.lng == null) {
    return { tier: "none", source: null, reason: "현재 좌표 없음" };
  }
  const lat = cur.lat, lng = cur.lng;
  /** @param {{lat:number,lng:number}|null} p */
  const near = (p) => !!p && haversineMeters(lat, lng, p.lat, p.lng) <= NEAR_M;
  if (near(K) || near(A) || near(C)) {
    return { tier: "ok", source: null, reason: "출처 좌표가 현재와 300m 이내" };
  }
  if (K && A) {
    const d = haversineMeters(K.lat, K.lng, A.lat, A.lng);
    if (d <= NEAR_M) return { tier: "A2", source: "A", reason: `K↔A ${Math.round(d)}m 일치` };
    return { tier: "conflict", source: null, reason: `K↔A ${Math.round(d)}m 불일치` };
  }
  if (A) return { tier: "B_apply", source: "A", reason: "청약홈 공급주소 단독" };
  if (K) {
    return K.strong
      ? { tier: "B_kakao_strong", source: "K", reason: "카카오 POI 강함 단독" }
      : { tier: "B_kakao_weak", source: "K", reason: "카카오 POI 약함 단독" };
  }
  if (C) {
    return C.solo
      ? { tier: "B_complex", source: "C", reason: "complexes 단독(sim≥0.9·차수 일관) — 보고만" }
      : { tier: "none", source: null, reason: "complexes 매칭이 단독 근거로는 약함" };
  }
  return { tier: "none", source: null, reason: "출처 없음" };
}

/**
 * `apartments.address` 를 2곳 이상이 공유하는 그룹만 남긴다.
 * @param {any[]} apts
 * @returns {{ groups: Map<string, any[]>, candidates: any[] }}
 */
export function groupSharedAddresses(apts) {
  /** @type {Map<string, any[]>} */
  const byAddr = new Map();
  for (const a of apts) {
    if (!a?.address) continue;
    const list = byAddr.get(a.address);
    if (list) list.push(a);
    else byAddr.set(a.address, [a]);
  }
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  /** @type {any[]} */
  const candidates = [];
  for (const [addr, list] of byAddr) {
    if (list.length < 2) continue;
    groups.set(addr, list);
    candidates.push(...list);
  }
  return { groups, candidates };
}

/**
 * "핵심 이름" — 차수/블록/숫자를 뗀 브랜드+프로젝트 이름. 같은 좌표를 **다른 프로젝트**가
 * 공유하는지 보는 데 쓴다.
 * @param {unknown} name
 * @returns {string}
 */
export function coreName(name) {
  return cleanName(name)
    .replace(PHASE_RE, " ")
    .replace(/[A-Za-z]?\d+\s*(BL|블록|블럭)?/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * `none` 등급 중 **다른 핵심이름 2종 이상이 소수 5자리 동일 좌표를 공유**하는 것 = 진짜 자리표시.
 * @param {{ id: string, name: string, lat: number | null, lng: number | null, tier: string }[]} rows
 * @returns {Set<string>} 해당 id 집합
 */
export function findTruePlaceholders(rows) {
  /** @type {Map<string, { ids: string[], names: Set<string> }>} */
  const byCoord = new Map();
  for (const r of rows) {
    if (r.tier !== "none" || r.lat == null || r.lng == null) continue;
    const key = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    let e = byCoord.get(key);
    if (!e) { e = { ids: [], names: new Set() }; byCoord.set(key, e); }
    e.ids.push(r.id);
    e.names.add(coreName(r.name));
  }
  /** @type {Set<string>} */
  const out = new Set();
  for (const e of byCoord.values()) {
    if (e.names.size >= 2) for (const id of e.ids) out.add(id);
  }
  return out;
}

/** 안전한 KST 시간창(03:00~05:30) 안인지 — `purge-to-recollect-timing.md`. */
export function inSafeWindow(now = new Date()) {
  const minutes = ((now.getUTCHours() + 9) % 24) * 60 + now.getUTCMinutes();
  return minutes >= 3 * 60 && minutes <= 5 * 60 + 30;
}

/**
 * `--limit=60` 같은 숫자 인자 파싱.
 * @param {string[]} argv
 * @param {string} flag
 * @returns {number | null}
 */
export function numArg(argv, flag) {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  if (!hit) return null;
  const n = Number(hit.slice(flag.length + 1));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * `--out=path` 같은 문자열 인자 파싱.
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string | null}
 */
export function strArg(argv, flag) {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

/**
 * 좌표를 고친 뒤 **부속 필드만** 새 좌표로 다시 만든다(`--refit-fields`).
 *
 * 규칙은 `scripts/collectors/reverse-geocode.mjs` 를 **직독하고 그대로** 옮겼다 — 같은 좌표에
 * 두 도구가 서로 다른 값을 쓰면 어느 쪽이 맞는지 아무도 모르게 된다.
 * - `dong` = **행정동(H) doc** 의 `region_3depth_name` (`reverse-geocode.mjs` L131·L134: `admin` =
 *   `region_type === "H"` 인 doc, 거기서 `region_3depth_name` 를 뽑는다). 법정동(B)의 3depth 가
 *   아니다 — 실측 `송도 센트럴파크 리버리치` 의 dong 은 `"송도2동"`(행정동)인데 `bjd_code` 는
 *   `2818510600`(법정동 "송도동")이다. 둘을 바꿔 쓰면 화면의 동 이름이 통째로 틀어진다.
 * - `bjd_code` = **법정동(B) doc** 의 `code` (같은 파일 L152 `geo?.legal?.code`).
 * - `road_address`·`lot_main`·`lot_sub` = `coord2address` 의 `documents[0]` (같은 파일 L62~68).
 *   `lot_sub` 는 비었거나 `"0"` 이면 **0**(null 아님) — 원본과 같은 계약이다.
 *
 * ⚠️ **반환 객체에 `address` 키를 넣지 않는다.** 이 도구는 A 출처(청약홈 표기 원문)를 `address` 에
 * 남기기로 한 규칙 위에서 돈다(`## 무엇을 저장하나`). 카카오 표기로 덮으면 그 결정이 조용히 뒤집힌다.
 * @param {any[] | null | undefined} regionDocs `coord2regioncode` 의 documents 전체
 * @param {any} addrDoc `coord2address` 의 documents[0]
 * @returns {{ dong: string|null, bjd_code: string|null, road_address: string|null, lot_main: number|null, lot_sub: number } | null}
 *   H·B·addrDoc 이 전부 없으면 `null`(호출자가 skip). 일부만 없으면 그 필드만 `null` — 억지로 채우지 않는다.
 */
export function buildRefitUpdates(regionDocs, addrDoc) {
  const docs = Array.isArray(regionDocs) ? regionDocs : [];
  const admin = docs.find((d) => d?.region_type === "H") ?? null;
  const legal = docs.find((d) => d?.region_type === "B") ?? null;
  if (!admin && !legal && !addrDoc) return null;
  const mainNo = addrDoc?.address?.main_address_no;
  const subNo = addrDoc?.address?.sub_address_no;
  return {
    dong: admin?.region_3depth_name || null,
    bjd_code: legal?.code || null,
    road_address: addrDoc?.road_address?.address_name || null,
    lot_main: mainNo ? parseInt(String(mainNo), 10) || null : null,
    lot_sub: subNo && subNo !== "" && subNo !== "0" ? parseInt(String(subNo), 10) : 0,
  };
}

// ────────────────────────────── 외부 호출 ──────────────────────────────

/**
 * @param {string} url
 * @returns {Promise<any[]>}
 */
async function kakaoFetch(url) {
  const key = process.env.KAKAO_KEY;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    logError(PHASE, `카카오 HTTP ${res.status}`);
    return [];
  }
  const json = /** @type {any} */ (await res.json());
  return json?.documents ?? [];
}

/**
 * 카카오 키워드 POI 검색.
 * @param {string} query
 * @returns {Promise<any[]>}
 */
async function kakaoKeyword(query) {
  return kakaoFetch(`${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(query)}&size=5`);
}

/**
 * 카카오 주소 검색.
 * @param {string} query
 * @returns {Promise<any[]>}
 */
async function kakaoAddress(query) {
  return kakaoFetch(`${KAKAO_ADDRESS_URL}?query=${encodeURIComponent(query)}&size=1`);
}

/**
 * 청약홈 무순위/잔여세대 공고 로스터 — `HOUSE_MANAGE_NO` → `HSSPLY_ADRES`.
 * `ah-*` id 는 `ah-${HOUSE_MANAGE_NO}` 형식이라 그대로 이어붙는다(실측 1,556/1,556).
 * @returns {Promise<Map<string, string>>}
 */
async function fetchApplyhomeRoster() {
  const key = process.env.MOLIT_KEY;
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!key) {
    logError(PHASE, "MOLIT_KEY 없음 — 청약홈 출처(A) 없이 진행한다");
    return map;
  }
  let page = 1;
  let total = 0;
  while (true) {
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: key });
    const res = await fetch(`${APPLYHOME_URL}?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      logError(PHASE, `청약홈 HTTP ${res.status} (page ${page}) — A 출처 부분 수집`);
      break;
    }
    const json = /** @type {{ data?: any[], totalCount?: number }} */ (await res.json());
    const rows = json.data ?? [];
    for (const r of rows) {
      const no = String(r?.HOUSE_MANAGE_NO ?? "").trim();
      const addr = String(r?.HSSPLY_ADRES ?? "").trim();
      if (no && addr) map.set(no, addr);
    }
    total += rows.length;
    log(PHASE, `  청약홈 page ${page}: ${rows.length}건 (누적 ${total}/${json.totalCount ?? "?"})`);
    if (rows.length < 1000 || total >= (json.totalCount ?? 0)) break;
    page++;
  }
  return map;
}

// ────────────────────────────── 본체 ──────────────────────────────

/**
 * `--ids-file` 로 넘긴 JSON 에서 id 목록을 읽는다. 배열이거나 `{ids:[...]}` 둘 다 받는다.
 * @param {string} p
 * @returns {string[]}
 */
function readIdsFile(p) {
  const abs = resolve(ROOT, p);
  if (!existsSync(abs)) throw new Error(`--ids-file 없음: ${abs}`);
  const j = /** @type {any} */ (JSON.parse(readFileSync(abs, "utf8")));
  const arr = Array.isArray(j) ? j : j?.ids;
  if (!Array.isArray(arr)) throw new Error(`--ids-file 형식 오류(배열 또는 {ids:[...]}): ${abs}`);
  return arr.map((x) => (typeof x === "string" ? x : String(x?.id ?? ""))).filter(Boolean);
}

/**
 * 파생표 정리 — transport/schools 행 삭제 + infra 의 kakao 소유 컬럼만 null.
 * @param {any} sb
 * @param {string[]} ids
 */
async function purgeDerived(sb, ids) {
  for (const table of SOLE_OWNER_TABLES) {
    const { error } = await sb.from(table).delete().in("apartment_id", ids);
    if (error) logError(PHASE, `${table} 삭제 실패: ${error.message}`);
    else log(PHASE, `파생 ${table} 삭제 완료 (${ids.length}건 대상)`);
  }
  const nullPayload = Object.fromEntries(INFRA_KAKAO_COLUMNS.map((c) => [c, null]));
  const { error } = await sb.from("infra").update(nullPayload).in("apartment_id", ids);
  if (error) logError(PHASE, `infra 컬럼 null 처리 실패: ${error.message}`);
  else log(PHASE, `infra 의 kakao 소유 ${INFRA_KAKAO_COLUMNS.length}컬럼 null 처리 완료 (행 유지)`);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const purge = argv.includes("--purge-derived");
  const refit = argv.includes("--refit-fields");
  const includeWeak = argv.includes("--include-weak");
  const forceTiming = argv.includes("--force-timing");
  const limit = numArg(argv, "--limit");
  const outPath = strArg(argv, "--out");
  const idsFile = strArg(argv, "--ids-file");

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 — 반영하려면 --apply ===");
  if (purge && !apply) {
    logError(PHASE, "--purge-derived 는 --apply 와 함께만 쓴다");
    process.exit(1);
  }
  if (refit && purge) {
    logError(PHASE, "--refit-fields 와 --purge-derived 는 한 번에 한 모드만 쓴다");
    process.exit(1);
  }
  if (refit && !idsFile) {
    logError(PHASE, "--refit-fields 는 --ids-file=<json> 이 있어야 한다 (대상 없이 전 단지를 건드리지 않는다)");
    process.exit(1);
  }
  if (purge && !inSafeWindow() && !forceTiming) {
    logError(PHASE, "지금은 안전 시간창(KST 03:00~05:30) 밖이다 — 지금 지우면 화면에 빈칸이 노출된다.");
    logError(PHASE, "그래도 강행하려면 --force-timing 을 추가하라(권장하지 않음).");
    process.exit(1);
  }

  const sb = getSupabase();

  // ── refit 전용 경로: 좌표를 고친 뒤 부속 필드를 새 좌표로 재정합한다 ──
  // 파생표를 지우지 않으므로 안전 시간창과 무관하다(화면에 빈칸이 생기지 않는다).
  if (refit) {
    if (!process.env.KAKAO_KEY) {
      logError(PHASE, "KAKAO_KEY 환경변수 필요");
      process.exit(1);
    }
    const ids = readIdsFile(/** @type {string} */ (idsFile));
    log(PHASE, `--refit-fields: ${ids.length}건`);

    // 29~300건 규모라 단발 조회로 충분하다. 그보다 커지면 URL 길이 때문에 끊어 묻는다.
    const chunk = ids.length > 900 ? 300 : Math.max(ids.length, 1);
    /** @type {any[]} */
    const targetRows = [];
    for (let i = 0; i < ids.length; i += chunk) {
      const { data, error } = await sb
        .from("apartments")
        .select("id,name,lat,lng,address,dong,bjd_code,lot_main,lot_sub,road_address")
        .in("id", ids.slice(i, i + chunk));
      if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
      targetRows.push(...(data ?? []));
    }
    log(PHASE, `조회 ${targetRows.length}행 (요청 ${ids.length}건)`);

    let refitted = 0, same = 0, skipped = 0, failed = 0;
    for (const row of targetRows) {
      const label = `${String(row.id).padEnd(16)} ${String(row.name ?? "").slice(0, 26).padEnd(28)}`;
      if (row.lat == null || row.lng == null) {
        skipped++;
        log(PHASE, `  ${label} skip — 좌표가 없다(재정합할 기준이 없다)`);
        continue;
      }
      const regionDocs = await kakaoFetch(`${KAKAO_REGION_URL}?x=${row.lng}&y=${row.lat}`);
      await sleep(KAKAO_GAP_MS);
      const addrDocs = await kakaoFetch(`${KAKAO_COORD2ADDR_URL}?x=${row.lng}&y=${row.lat}`);
      await sleep(KAKAO_GAP_MS);
      const updates = buildRefitUpdates(regionDocs, addrDocs[0]);
      if (!updates) {
        skipped++;
        log(PHASE, `  ${label} skip — 카카오 응답에 행정구역·주소가 없다`);
        continue;
      }
      const unchanged =
        updates.dong === (row.dong ?? null) &&
        updates.bjd_code === (row.bjd_code ?? null) &&
        updates.road_address === (row.road_address ?? null) &&
        updates.lot_main === (row.lot_main ?? null) &&
        updates.lot_sub === (row.lot_sub ?? 0);
      log(
        PHASE,
        `  ${label} | dong ${row.dong ?? "-"}→${updates.dong ?? "-"}` +
          ` | bjd ${row.bjd_code ?? "-"}→${updates.bjd_code ?? "-"}` +
          ` | lot ${updates.lot_main ?? "-"}-${updates.lot_sub}` +
          ` | road ${updates.road_address ?? "-"}` +
          (unchanged ? " (변화 없음)" : ""),
      );
      if (unchanged) { same++; continue; }
      if (apply) {
        const { error } = await sb
          .from("apartments")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (error) { logError(PHASE, `${row.id}: ${error.message}`); failed++; continue; }
      }
      refitted++;
    }
    log(PHASE, `\n재정합 ${refitted}건 · 변화 없음 ${same} · skip ${skipped} · 실패 ${failed}`);
    if (!apply) log(PHASE, "=== 미리보기 종료 — 반영하려면 --apply ===");
    if (failed > 0) process.exit(1);
    return;
  }

  // ── ids-file 전용 경로: 이미 고친 행들의 파생표만 정리한다 ──
  if (idsFile) {
    const ids = readIdsFile(idsFile);
    log(PHASE, `--ids-file: ${ids.length}건`);
    if (!purge) {
      log(PHASE, "purge 없이 --ids-file 만 주면 할 일이 없다(--purge-derived 를 함께 쓰라).");
      return;
    }
    await purgeDerived(sb, ids);
    log(PHASE, "=== 완료 (ids-file purge) ===");
    return;
  }

  if (!process.env.KAKAO_KEY) {
    logError(PHASE, "KAKAO_KEY 환경변수 필요");
    process.exit(1);
  }

  const apts = /** @type {any[]} */ (
    await selectAll((s) => s.from("apartments").select("id, name, region, gu, address, lat, lng"), sb, "id")
  );
  const complexes = /** @type {any[]} */ (
    await selectAll(
      (s) => s.from("complexes").select("complex_no, complex_name, latitude, longitude, sido, sigungu"),
      sb,
      "complex_no",
    )
  );
  log(PHASE, `apartments ${apts.length}행, complexes ${complexes.length}행`);

  const { groups, candidates } = groupSharedAddresses(apts);
  log(PHASE, `주소 공유 그룹 ${groups.size}개 · 후보 ${candidates.length}곳`);

  /** @type {Map<string, any[]>} */
  const cpxByKey = new Map();
  for (const c of complexes) {
    const key = complexKey(c.sido, c.sigungu);
    if (!key) continue;
    const list = cpxByKey.get(key);
    if (list) list.push(c);
    else cpxByKey.set(key, [c]);
  }

  const roster = await fetchApplyhomeRoster();
  log(PHASE, `청약홈 로스터 ${roster.size}건`);
  // 세션542 실사고: 청약홈 API 가 이 순간 0건을 주자 A 출처가 통째로 빠진 채 재분석이 돌아, 15분 전
  // dry-run 에서 "청약홈 주소가 현재 좌표와 300m 이내 = 이미 정상" 이던 6곳이 카카오 POI 단독으로
  // 옮겨졌다(리버카운티 3곳은 39km 밖 다른 단지). 눈으로 본 목록과 다른 것을 반영하면 검토가 무의미하다.
  if (roster.size === 0) {
    if (apply) {
      logError(PHASE, "청약홈 로스터 0건 — A 출처 없이 --apply 하면 dry-run 과 다른 판정이 난다(세션542: 승인 29 대신 33곳). 미리보기로 다시 확인하라.");
      process.exit(1);
    }
    logError(PHASE, "⚠️ 청약홈 로스터 0건 — 이 미리보기는 A 출처가 빠진 판정이다(정상 1,500건+). 결과를 근거로 쓰지 마라.");
  }

  let targets = candidates.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (limit) {
    targets = targets.slice(0, limit);
    log(PHASE, `⚠️ --limit=${limit} — 개발용 표본이다. 전체 판정이 아니다.`);
  }

  /** @type {Map<string, {lat:number,lng:number}|null>} 같은 주소를 여러 번 지오코딩하지 않는다 */
  const geoCache = new Map();
  /** @type {any[]} */
  const rows = [];
  let done = 0;

  for (const apt of targets) {
    done++;
    if (done % 50 === 0) log(PHASE, `  진행 ${done}/${targets.length}`);
    const name = cleanName(apt.name);
    const sidoPrefix = shortRegion(apt.region);

    // ── C: complexes 이름매칭 (보조) ──
    /** @type {{lat:number,lng:number,solo:boolean}|null} */
    let C = null;
    /** @type {any} */
    let cBest = null;
    let cSim = 0;
    /** @type {string} */
    let cPhase = "ok";
    const key = cityKey(apt.address, apt.region);
    for (const c of key ? (cpxByKey.get(key) ?? []) : []) {
      if (c.latitude == null || c.longitude == null) continue;
      const sim = stringSimilarity(apt.name, c.complex_name);
      if (sim > cSim) { cSim = sim; cBest = c; }
    }
    if (cBest && cSim >= COMPLEX_MIN_SIM) {
      cPhase = phaseConsistent(apt.name, cBest.complex_name);
      const passesPhase =
        cPhase === "ok" || (cPhase === "one-sided" && cSim >= COMPLEX_ONE_SIDED_SIM);
      if (passesPhase) {
        C = {
          lat: Number(cBest.latitude),
          lng: Number(cBest.longitude),
          solo: cSim >= COMPLEX_SOLO_SIM && cPhase === "ok",
        };
      } else {
        cBest = null;
      }
    } else {
      cBest = null;
    }

    // ── A: 청약홈 공급주소 → 카카오 주소검색 ──
    /** @type {{lat:number,lng:number}|null} */
    let A = null;
    let applyAddr = "";
    const ahNo = String(apt.id ?? "").startsWith("ah-") ? String(apt.id).slice(3) : null;
    const rawApply = ahNo ? roster.get(ahNo) : undefined;
    if (rawApply) {
      applyAddr = normalizeApplyhomeAddress(rawApply);
      if (applyAddr) {
        if (geoCache.has(applyAddr)) {
          A = geoCache.get(applyAddr) ?? null;
        } else {
          const docs = await kakaoAddress(applyAddr);
          await sleep(KAKAO_GAP_MS);
          const doc = docs[0];
          A = isPreciseGeocode(doc, applyAddr)
            ? { lat: Number(doc.y), lng: Number(doc.x) }
            : null;
          geoCache.set(applyAddr, A);
        }
      }
    }

    // ── K: 카카오 키워드 POI ──
    /** @type {{lat:number,lng:number,strong:boolean}|null} */
    let K = null;
    /** @type {{doc:any,sim:number,strong:boolean}|null} */
    let kPick = null;
    if (name) {
      const docs = await kakaoKeyword(name);
      await sleep(KAKAO_GAP_MS);
      kPick = pickKakaoCandidate(name, docs, sidoPrefix);
      if (kPick) K = { lat: Number(kPick.doc.y), lng: Number(kPick.doc.x), strong: kPick.strong };
    }

    const verdict = classify({ cur: { lat: apt.lat, lng: apt.lng }, K, A, C });
    /** @type {{lat:number,lng:number}|null} */
    const picked = verdict.source === "A" ? A : verdict.source === "K" ? K : verdict.source === "C" ? C : null;
    const distM =
      picked && apt.lat != null && apt.lng != null
        ? Math.round(haversineMeters(apt.lat, apt.lng, picked.lat, picked.lng))
        : null;

    rows.push({
      id: apt.id,
      name: apt.name,
      region: apt.region ?? null,
      tier: verdict.tier,
      reason: verdict.reason,
      source: verdict.source,
      lat: apt.lat,
      lng: apt.lng,
      oldAddress: apt.address ?? null,
      newLat: picked?.lat ?? null,
      newLng: picked?.lng ?? null,
      newAddress:
        verdict.source === "A"
          ? applyAddr
          : verdict.source === "K"
            ? String(kPick?.doc?.address_name ?? "")
            : null,
      distM,
      kakaoName: kPick ? String(kPick.doc.place_name) : null,
      kakaoSim: kPick ? Number(kPick.sim.toFixed(3)) : null,
      kakaoStrong: kPick ? kPick.strong : null,
      applyAddress: applyAddr || null,
      // 로스터에는 있는데 지오코딩이 안 된 경우를 눈에 보이게 남긴다 — 실측(2026-09-05)상
      // 공급주소가 **도로명**이면 카카오 주소검색이 못 찾는 일이 잦다(예: "서울특별시 강서구
      // 공항대로 533" → 결과 0건). 그때 A 는 없고 K 로 내려간다.
      applyGeocoded: applyAddr ? A != null : null,
      complexNo: cBest?.complex_no ?? null,
      complexName: cBest?.complex_name ?? null,
      complexSim: cBest ? Number(cSim.toFixed(3)) : null,
      complexPhase: cBest ? cPhase : null,
      complexSupports:
        C && picked ? haversineMeters(C.lat, C.lng, picked.lat, picked.lng) <= NEAR_M : null,
    });
  }

  const truePlaceholders = findTruePlaceholders(rows);
  for (const r of rows) if (truePlaceholders.has(r.id)) r.truePlaceholder = true;

  // ── 보고 ──
  /** @type {Record<string, number>} */
  const tally = {};
  for (const r of rows) tally[r.tier] = (tally[r.tier] ?? 0) + 1;
  log(PHASE, "\n=== 등급별 ===");
  for (const [t, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    log(PHASE, `  ${t.padEnd(16)} ${String(n).padStart(5)}`);
  }
  log(PHASE, `  ${"(그중 진짜 자리표시)".padEnd(16)} ${String(truePlaceholders.size).padStart(5)}`);

  const applyTiers = new Set(APPLY_TIERS);
  if (includeWeak) applyTiers.add("B_kakao_weak");
  const fixList = rows.filter((r) => applyTiers.has(r.tier) && r.newLat != null);

  log(PHASE, `\n=== 정정 대상 ${fixList.length}곳 (거리순 상위 30) ===`);
  for (const f of fixList.slice().sort((a, b) => (b.distM ?? 0) - (a.distM ?? 0)).slice(0, 30)) {
    log(
      PHASE,
      `  ${String(f.id).padEnd(16)} ${String(f.name).slice(0, 26).padEnd(28)} ${f.tier.padEnd(16)} ${String(f.distM).padStart(7)}m  → ${f.newAddress ?? ""}`,
    );
  }

  const conflicts = rows.filter((r) => r.tier === "conflict");
  if (conflicts.length) {
    log(PHASE, `\n=== conflict ${conflicts.length}곳 (보고만) ===`);
    for (const f of conflicts.slice(0, 15)) {
      log(PHASE, `  ${String(f.id).padEnd(16)} ${String(f.name).slice(0, 26).padEnd(28)} ${f.reason}`);
    }
  }

  if (outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), tally, rows }, null, 2), "utf8");
    log(PHASE, `\nJSON 덤프: ${outPath}`);
  }

  if (!apply) {
    log(PHASE, "\n=== 미리보기 종료 — 반영하려면 --apply ===");
    return;
  }
  if (fixList.length === 0) {
    log(PHASE, "정정할 것이 없다.");
    return;
  }

  let ok = 0, fail = 0;
  for (const f of fixList) {
    const { error } = await sb
      .from("apartments")
      .update({
        address: f.newAddress || f.oldAddress,
        road_address: null,
        lat: f.newLat,
        lng: f.newLng,
        updated_at: new Date().toISOString(),
      })
      .eq("id", f.id);
    if (error) { logError(PHASE, `${f.id}: ${error.message}`); fail++; }
    else ok++;
  }
  log(PHASE, `\n좌표·주소 정정: 성공 ${ok} · 실패 ${fail}`);

  if (purge) await purgeDerived(sb, fixList.map((f) => f.id));

  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
