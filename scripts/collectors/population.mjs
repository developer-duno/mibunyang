// @ts-check
/**
 * 행안부 주민등록 인구 API → 시군구별 인구 증감률 + 시도 인구/세대 수집
 *
 * API: 행정안전부_법정동별 주민등록 인구 및 세대현황 (data.go.kr #15108071)
 *
 * 사용법:
 *   node scripts/collectors/population.mjs                      (Supabase regions 테이블 업데이트)
 *   node scripts/collectors/population.mjs --dry-run            (미리보기만)
 *   node scripts/collectors/population.mjs --target=202607      (대상 연월 재지정, 기본 = 실행일 −2개월)
 *   node scripts/collectors/population.mjs --dry-run --focus=경기:화성시,인천:제물포구
 *
 * 필요 환경변수:
 *   MOIS_POP_KEY     — data.go.kr 인증키
 *   SUPABASE_URL     — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, createReporter, REGION_MAP, today, recordApiQuota, recordCollectorRun, normalizeGu, resolveRegionName } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOIS_POP_KEY;

// 신 API: 행정안전부_법정동별 주민등록 인구 및 세대현황 (#15108071)
const BASE_URL = "https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus";

// 전국 시도 법정동코드 (10자리) — **16개** (17 시도이나 광주·전남이 한 코드를 공유)
// 세션 285 raw API 응답 검증 박제 — 3 코드 정정 (영구 누락 사고):
//   3600000000 → 3611000000 (세종, 이전 빈 응답)
//   4200000000 → 5100000000 (강원, 이전 빈 응답)
//   4500000000 → 5200000000 (전북, 이전 빈 응답)
// 세션 545 — 2026-07-01 전남광주통합특별시 출범 (raw 실측 2026-09-10):
//   2900000000·4600000000 은 202607~ NODATA_ERROR → 1200000000 하나로 통합
//   (응답 27 시군구 · ctpvNm "전남광주통합특별시" → parseGu 가 sggNm 으로 광주/전남을 가른다)
const SIDO_CODES = [
  "1100000000","2600000000","2700000000","2800000000","1200000000",
  "3000000000","3100000000","3611000000","4100000000","5100000000",
  "4300000000","4400000000","5200000000","4700000000",
  "4800000000","5000000000",
];

// 시도행(lv=1) 값과 시군구 합의 허용 오차. 이보다 벌어지면 시끄럽게 남긴다.
// 두 값은 **다른 집계 단위**(lv=1 API 총계 vs 우리가 더한 시군구 합)라 반올림·기준시점 차이가
// 섞일 수 있으므로 비율 오차를 둔다.
export const CROSS_CHECK_TOLERANCE = 0.005;

// 통합 시도행(못 가른 lv=1 행)을 분할 합과 대조할 때의 허용 오차 — **명(名) 단위 절대값**.
// 위와 달리 이쪽은 같은 응답 안의 같은 사람들을 두 방식으로 센 것이라 **정확히 같아야 한다**
// (실측 2026-09: 전남광주통합특별시 3,157,777 = 광주 1,384,801 + 전남 1,772,976, 차이 0).
// 0.5% 를 그대로 쓰면 통합 시도 기준 약 1.6만 명이 어긋나도 조용히 통과한다.
export const SPLIT_SUM_MAX_DIFF = 1;

// ── API 응답 items 정규화 ────────────────────────────────────
/**
 * 행안부 API items.item — 다행이면 배열, 1행이면 단일 객체(양형).
 * 배열일 때만 처리하면 1행 응답(세종 등)을 통째로 버린다. parsegu-normalization.md §3 답습.
 * @param {any} json
 * @returns {Array<Record<string, any>>}
 */
function normalizeItems(json) {
  const items = json?.Response?.items?.item;
  if (Array.isArray(items)) return items;
  if (items && typeof items === "object") return [items];
  return [];
}

/**
 * @param {string} ym `YYYYMM`
 * @param {string} stdgCd
 * @param {"1" | "2"} lv
 * @returns {URLSearchParams}
 */
function buildParams(ym, stdgCd, lv) {
  return new URLSearchParams({
    serviceKey: API_KEY ?? "",
    stdgCd,
    srchFrYm: ym,
    srchToYm: ym,
    type: "json",
    numOfRows: "100",
    pageNo: "1",
    lv,
    regSeCd: "1",   // 전체
  });
}

// ── 인구 데이터 조회 (시도코드별 순회, lv=2 시군구) ───────────
/**
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchPopulation(year, month) {
  const ym = `${year}${String(month).padStart(2, "0")}`;
  log("fetch", `${year}년 ${month}월 인구 데이터 조회 (${SIDO_CODES.length} 시도코드)...`);

  /** @type {Array<Record<string, any>>} */
  const allItems = [];
  for (const stdgCd of SIDO_CODES) {
    try {
      const res = await fetch(`${BASE_URL}?${buildParams(ym, stdgCd, "2")}`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) { log("fetch", `  ${stdgCd}: HTTP ${res.status} — skip`); continue; }
      allItems.push(...normalizeItems(await res.json()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("fetch", `  ${stdgCd}: ${msg} — skip`);
    }
    // data.go.kr rate limit 대비 150ms 딜레이
    await new Promise(r => setTimeout(r, 150));
  }

  log("fetch", `${year}년 ${month}월: ${allItems.length}건`);
  return allItems;
}

// ── 시도 합계 조회 (lv=1, 1회) ───────────────────────────────
/**
 * 시도 합계행을 API 가 **직접 준다**. 우리가 시군구를 손으로 더하면 접힘(화성 5행)·신설구
 * 유실로 세 번 틀렸다 — 이제 시도행은 이 값을 쓴다(세션546).
 *
 * ⚠️ `lv=1` 은 `stdgCd` 를 **완전히 무시**하고 전국 시도행을 한 번에 준다(실측 2026-09-11:
 *    존재하지 않는 코드를 줘도 같은 응답). 202607~ = 16행(전남광주 통합 1행), 202606 이전 = 17행.
 * ⚠️ 자료 없는 달은 **HTTP 200 + resultCode "10" + 0행** — `res.ok` 만 보면 못 잡는다.
 *    그래서 실패 판정 = `!res.ok` **또는** 0행이고, 둘 다 빈 배열로 돌려 호출자가 fallback 을 탄다.
 *
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchSidoTotals(year, month) {
  const ym = `${year}${String(month).padStart(2, "0")}`;
  try {
    const res = await fetch(`${BASE_URL}?${buildParams(ym, SIDO_CODES[0], "1")}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) { logError("fetch", `${ym} 시도합계(lv=1): HTTP ${res.status}`); return []; }
    const items = normalizeItems(await res.json());
    if (items.length === 0) { logError("fetch", `${ym} 시도합계(lv=1): 0행 (자료 없는 달일 수 있다)`); return []; }
    log("fetch", `${ym} 시도합계(lv=1): ${items.length}행`);
    return items;
  } catch (e) {
    logError("fetch", `${ym} 시도합계(lv=1): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

// ── API 응답 hhCnt → households 정수 ─────────────────────────
/**
 * 행안부 stdgPpltnHhStus API 응답 `hhCnt` 필드 → 세대수 정수.
 * 0 또는 음수 / 빈 값 / NaN 시 null 폴백 (DB 컬럼 nullable).
 * @param {unknown} hhCnt
 * @returns {number | null}
 */
function parseHouseholds(hhCnt) {
  const n = parseInt(String(hhCnt ?? "0").replace(/,/g, ""), 10);
  return n > 0 ? n : null;
}

/**
 * 행안부 응답 행 → 인구 정수. 값이 없으면 0 (호출자가 버린다).
 * @param {Record<string, any> | null | undefined} item
 * @returns {number}
 */
function parsePopulation(item) {
  const n = parseInt(String(item?.totNmprCnt || item?.totPpltn || "0").replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// ── 시도명 → 약칭 변환 ──────────────────────────────────────
/**
 * @param {string | null | undefined} fullName
 * @returns {string | null}
 */
function resolveRegion(fullName) {
  if (!fullName) return null;
  // 정확 매칭
  if (Object.prototype.hasOwnProperty.call(REGION_MAP, fullName)) return REGION_MAP[fullName];
  // ⚠️ 부분 매칭은 **둘 이상이 걸리면 판정하지 않는다** (세션545 적대검증).
  //    `"전남광주통합특별시".includes("광주")` 도 `.includes("전남")` 도 참이라, 먼저 걸린 쪽이
  //    이기면 27 시군구 **전부**가 그 지역으로 오라벨된다. 처음엔 `/통합특별시/` 로 그 이름만
  //    막았는데, 표기가 한 글자만 달라도(예: "전남광주특별시") 가드를 빠져나가 광주로 굳는 것을
  //    적대검증이 재현했다. 이름을 열거해 막는 대신 **모호하면 포기**한다 — 시도 이름만으로
  //    못 가르는 게 사실이고, `parseGu` 가 `sggNm` 을 보고 `resolveRegionName` 으로 가른다.
  const hits = new Set();
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) hits.add(v);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

// ── 시군구명 파싱 ────────────────────────────────────────────
/**
 * 행안부 API 응답 (ctpvNm + sggNm) → region 약칭 + gu 표기 + 접힘 여부.
 * population-sex-age.mjs L111-125 와 같은 꼴. sggNm 그대로 박힘 (자치구 분리 유지).
 *
 * 입력 예:
 *   ("경기도", "수원시")        → { region: "경기", gu: "수원시", folded: false }        (시 합계)
 *   ("경기도", "수원시 팔달구") → { region: "경기", gu: "수원시 팔달구", folded: false } (자치구)
 *   ("경기도", "화성시 동탄구") → { region: "경기", gu: "화성시", folded: true }         (별칭표가 접음)
 *   ("서울특별시", "강남구")    → { region: "서울", gu: "강남구", folded: false }
 *   ("세종특별자치시", "")      → { region: "세종", gu: "세종시", folded: false }
 *
 *   ("전남광주통합특별시", "순천시") → { region: "전남", gu: "순천시", folded: false }
 *   ("전남광주통합특별시", "북구")   → { region: "광주", gu: "북구", folded: false }
 *
 * `folded` = 원문 표기가 통일 과정에서 **바뀌었는가**. 아래 `pickCanonicalPopulationRows` 가 쓴다:
 * 화성시는 시 합계행과 신설 4구가 **같은 키로 모이는데**, 접힌 구 값으로 시 값을 덮으면
 * 화성 전체 인구가 구 하나의 값이 된다(세션546 이전 실제 DB 상태 = 동탄구 값).
 *
 * @param {string | null | undefined} ctpvNm
 * @param {string | null | undefined} sggNm
 * @returns {{region: string, gu: string, folded: boolean} | null}
 */
function parseGu(ctpvNm, sggNm) {
  // 통합 시도(전남광주)는 sggNm 으로만 갈린다 — 분할 헬퍼를 먼저.
  const region = resolveRegionName(ctpvNm, sggNm) ?? resolveRegion(ctpvNm);
  if (!region) return null;
  if (region === "세종") return { region, gu: "세종시", folded: false };
  if (!sggNm) return null;
  // 세션510 ①: 행안부가 "장안구" 처럼 시 이름 없이 주는 경우가 있어 표기를 통일한다.
  // 이 통일이 없으면 같은 동네가 `regions` 안에서 두 행으로 갈리고, 그중 한 행만 채워져
  // 화면에서는 "미수집"으로 뜬다(2026-08-11 실측: 4지표가 310곳·19.4%에서 값이 있는데도 안 보였다).
  // 진실의 원천은 `src/data/sigungu-aliases.json` 하나 — 여기에 표를 복사하지 않는다.
  // `?? sggNm` — normalizeGu 는 빈 값을 그대로 돌려주는 계약이라 여기선 항상 문자열이지만,
  // 시그니처상 null 이 열려 있어 원문 폴백을 명시한다(조용히 undefined 가 들어가는 것보다 낫다).
  const gu = normalizeGu(region, sggNm) ?? sggNm;
  return { region, gu, folded: gu !== sggNm };
}

// ── 시도 집계에서 제외할 "구 보유 시" 추출 (원문 ∪ 정규화 앞 토큰) ──
/**
 * 행안부 API 는 같은 시도에 시 합계("수원시")와 그 자치구("수원시 팔달구")를 **둘 다** 응답한다.
 * 그대로 더하면 수원시 인구가 두 번 셈되므로 시 합계행을 빼야 하는데, 뺄 대상은
 * **자치구를 실제로 가진 그 시**뿐이다.
 *
 * ⚠️ 세션 501 사고: 옛 코드는 "한 시도에 공백 든 이름이 하나라도 있으면 그 시도의 공백 없는
 * 이름을 전부 제외" 했다. 그 결과 구가 없는 시·군(김포시·양평군·안동시…)까지 통째로 날아가
 * **6개 시도에서 111개 시·군이 누락**됐다.
 *
 * ⚠️ 세션 546 사고: 그 정정판(`pickParentCities`)은 **접힌 이름**(별칭 정규화를 거친 gu)을 봤다.
 * 별칭표가 "화성시 동탄구" → "화성시" 로 접으므로 공백이 사라져 부모 시가 안 잡히고,
 * 같은 키 5행이 시도 집계에 **다섯 번** 더해졌다(경기 +999,673 = 14,767,830). 그래서 이 함수는
 * **원문 `sggNm`** 을 본다 — 접기 전 이름에만 "화성시 만세구" 같은 공백이 남아 있다.
 *
 * ⚠️ 세션 546 독립 리뷰: 원문만 보면 반대 구멍이 열린다. 행안부가 시 이름 없이 **"장안구"** 로
 * 주는 형태(별칭표에 `forms` 로 실재)에서는 원문에 공백이 없어 부모가 하나도 안 잡히고
 * 수원시가 두 번 셈된다(실측 재현 1,190,000 → 2,380,000). 그래서 부모 후보를
 * **원문 앞 토큰 ∪ 정규화된 gu 앞 토큰**(둘 다 공백이 있을 때만)으로 모으고,
 * **제외 판정은 호출자가 원문 `sggNm` 으로만** 한다 — 접힌 화성 4구가 사라지지 않게.
 *
 * @param {Array<Record<string, any>>} items 행안부 원본 행
 * @returns {Set<string>} 제외 대상 키 집합 (`"경기:수원시"` 형식). 값은 **원문 sggNm** 또는
 *   **정규화된 gu** 의 앞 토큰이며, 어느 쪽이든 제외 판정은 원문 `sggNm` 과 맞대 본다.
 */
export function rawParents(items) {
  /** @type {Set<string>} */
  const parents = new Set();
  for (const item of items ?? []) {
    const parsed = parseGu(item?.ctpvNm, item?.sggNm);
    if (!parsed) continue;
    const sgg = String(item?.sggNm ?? "").trim();
    // ① 원문 sggNm 의 앞 토큰 — "수원시 팔달구" → "수원시", "화성시 동탄구" → "화성시"
    const rawSp = sgg.indexOf(" ");
    if (rawSp > 0) parents.add(`${parsed.region}:${sgg.slice(0, rawSp)}`);
    // ② 정규화된 gu 의 앞 토큰 — 원문이 **bare 구**("장안구")로 와서 ①이 아무것도 못 잡는 경우.
    //    별칭표(`sigungu-aliases.json`)에 `forms: [… , "장안구"]` 로 실제 등재돼 있고, 그때
    //    `parseGu` 가 "수원시 장안구" 로 펴 준다. ①만 보면 부모("수원시")가 안 잡혀 시 합계행이
    //    남고, 그 시 인구가 시도 합에 **두 번** 들어간다(실측 재현: 경기 1,190,000 → 2,380,000).
    //    현재 응답은 공백 든 형태라 주경로는 무사하지만 `resolveSidoTotals` 의 fallback/split 이
    //    이 합을 그대로 시도행으로 저장하므로, 형태가 바뀌는 날 조용히 거짓이 된다.
    // ⚠️ **공백이 있을 때만** 더한다. 화성 신설구는 접힌 gu 가 "화성시"(공백 없음)라 여기서
    //    안 잡히고 ①이 잡는다. 공백 없는 gu 까지 더하면 구가 없는 시("김포시")·시 합계행이
    //    자기 자신을 부모로 등록해 통째로 사라진다(세션501 사고의 재발).
    const canonSp = parsed.gu.indexOf(" ");
    if (canonSp > 0) parents.add(`${parsed.region}:${parsed.gu.slice(0, canonSp)}`);
  }
  return parents;
}

// ── 시군구 canonical 행 (키당 1행) ───────────────────────────
/**
 * 행안부 lv=2 응답 → `regions` 시군구행. **한 키에 여럿이 모이면 시 단위 원문을 남긴다.**
 *
 * ⚠️ 표기 통일은 서로 다른 원문을 **한 키로 모은다**(화성시 + 신설 4구 = "경기|화성시" 5행).
 * 접힌 결과를 그대로 UPDATE 루프에 넘기면 같은 행을 다섯 번 덮어써 **시 전체 인구가 구 하나의
 * 값이 된다** — 채운 것처럼 보이지만 거짓이다(세션546 DB 실측: 화성시 = 동탄구 429,477).
 * 그래서 겹치면 접히지 않은 원문(= 시 단위)을 남긴다. `population-sex-age.mjs pickCanonicalRows` 답습.
 *
 * @param {Array<Record<string, any>>} items 행안부 원본 행 (lv=2)
 * @returns {{rows: Array<{region: string, gu: string, population: number, households: number | null, folded: boolean}>, collapsed: number, foldedOnly: string[]}}
 */
export function pickCanonicalPopulationRows(items) {
  /** @type {Map<string, {region: string, gu: string, population: number, households: number | null, folded: boolean}>} */
  const byKey = new Map();
  let collapsed = 0;
  /** @type {Set<string>} */
  const foldedOnly = new Set();

  for (const item of items ?? []) {
    const parsed = parseGu(item?.ctpvNm, item?.sggNm);
    if (!parsed) continue;

    const population = parsePopulation(item);
    if (population <= 0) continue;

    const key = `${parsed.region}|${parsed.gu}`;
    const prev = byKey.get(key);
    if (prev) {
      collapsed++;
      // 접히지 않은 원문(= 시 단위)이 접힌 것보다 우선한다. 같은 등급끼리는 기존 동작(나중 것이 이김).
      if (!prev.folded && parsed.folded) continue;                          // 시 단위를 구 값으로 덮지 않는다
      if (prev.folded && parsed.folded) { foldedOnly.add(key); continue; }  // 둘 다 접힘 — 먼저 온 것 유지
    }
    byKey.set(key, {
      region: parsed.region,
      gu: parsed.gu,
      population,
      households: parseHouseholds(item?.hhCnt),
      folded: parsed.folded,
    });
    // 접힌 것들 뒤에 시 단위 원문이 오면 경고를 거둔다(입력 순서와 무관하게 같은 결과여야 한다).
    if (!parsed.folded) foldedOnly.delete(key);
  }

  return { rows: [...byKey.values()], collapsed, foldedOnly: [...foldedOnly] };
}

// ── 시군구 원문에서 시도 합 (부모 시 제외) ────────────────────
/**
 * 원문 행을 **원문 sggNm 기준 부모 제외**로 더한 시도별 합. lv=1 교차검증과 fallback 이 쓴다.
 *
 * ⚠️ canonical 행이 아니라 **원문 행**을 더한다. canonical 은 화성 5행을 1행(시 합계)으로 접는데,
 * 거기에 원문 부모 집합(화성시 포함)을 적용하면 화성이 통째로 사라진다. 원문에 적용하면
 * "화성시" 합계행만 빠지고 4구가 남아 총합이 정확히 같다(실측: 경기 20,927,874 → 13,768,157).
 *
 * @param {Array<Record<string, any>>} items 행안부 원본 행 (lv=2)
 * @returns {Record<string, {population: number, households: number}>}
 */
export function sumSidoFromRaw(items) {
  const parents = rawParents(items);
  /** @type {Record<string, {population: number, households: number}>} */
  const agg = {};
  for (const item of items ?? []) {
    const parsed = parseGu(item?.ctpvNm, item?.sggNm);
    if (!parsed) continue;
    const sgg = String(item?.sggNm ?? "").trim();
    if (sgg && parents.has(`${parsed.region}:${sgg}`)) continue;
    const population = parsePopulation(item);
    if (population <= 0) continue;
    if (!agg[parsed.region]) agg[parsed.region] = { population: 0, households: 0 };
    agg[parsed.region].population += population;
    agg[parsed.region].households += parseHouseholds(item?.hhCnt) ?? 0;
  }
  return agg;
}

/**
 * @typedef {{level: "warn" | "error", message: string}} Check
 */

/**
 * lv=1 응답 + 시군구 합 → 그 연도의 시도별 총계.
 *
 * lv=1 이 **이름을 못 가르는 행**(통합 시도)과 **lv=1 자체가 빈 경우**(fallback)를 한 경로로 처리한다:
 * 어느 쪽이든 "lv=1 이 채우지 못한 지역"을 시군구 합에서 가져온다.
 *
 * @param {Array<Record<string, any>>} sidoItems
 * @param {Record<string, {population: number, households: number}>} rawSums
 * @param {string} label
 * @returns {{totals: Record<string, {population: number, households: number, source: string}>, checks: Check[], fallback: boolean}}
 */
function resolveSidoTotals(sidoItems, rawSums, label) {
  /** @type {Record<string, {population: number, households: number, source: string}>} */
  const totals = {};
  /** @type {Check[]} */
  const checks = [];
  let unresolvedPop = 0;
  let unresolvedCount = 0;
  const items = sidoItems ?? [];

  for (const item of items) {
    const population = parsePopulation(item);
    if (population <= 0) continue;
    const sgg = String(item?.sggNm ?? "").trim();
    if (sgg.includes(" ")) {
      // lv=1 은 시군구를 안 준다(실측 sggNm 빈값). 공백 든 값이 오면 형식이 바뀐 것이므로 남긴다.
      checks.push({ level: "warn", message: `${label}: lv=1 행에 시군구 표기 "${sgg}" — 응답 형식 변화 의심` });
    }
    const region = resolveRegion(item?.ctpvNm);
    if (!region) { unresolvedPop += population; unresolvedCount++; continue; }
    totals[region] = { population, households: parseHouseholds(item?.hhCnt) ?? 0, source: "lv1" };
  }

  const fallback = items.length === 0;
  const missing = Object.keys(rawSums).filter((r) => !(r in totals));
  for (const r of missing) {
    totals[r] = { population: rawSums[r].population, households: rawSums[r].households, source: fallback ? "fallback" : "split" };
  }

  if (unresolvedCount > 0) {
    const splitSum = missing.reduce((s, r) => s + (rawSums[r]?.population ?? 0), 0);
    if (splitSum <= 0) {
      checks.push({ level: "error", message: `${label}: 못 가른 시도행 ${unresolvedCount}개(${unresolvedPop.toLocaleString()}명)를 나눌 시군구 합이 없다` });
    } else {
      // 같은 응답 안의 같은 사람들을 두 방식으로 센 것이라 **정확히 같아야 한다** — 명 단위 절대값.
      const diff = Math.abs(splitSum - unresolvedPop);
      if (diff > SPLIT_SUM_MAX_DIFF) {
        checks.push({ level: "error", message: `${label}: 통합 시도행 ${unresolvedPop.toLocaleString()} vs 분할 합 ${splitSum.toLocaleString()} (${diff.toLocaleString()}명 차이)` });
      }
    }
  }

  if (fallback) {
    checks.push({ level: "warn", message: `${label}: lv=1 실패 — 시군구 합(원문 부모 제외)으로 시도행 ${missing.length}개 생성` });
  }

  return { totals, checks, fallback };
}

/**
 * lv=1 값 ↔ 시군구 합 대조. **lv=1 로 확정된 지역만** — fallback/split 지역은 자기 자신과의 비교다.
 * 값을 바꾸지는 않는다(fail-open). 어긋남을 시끄럽게 남겨 사람이 보게 하는 것이 목적.
 *
 * @param {Record<string, {population: number, households: number, source: string}>} totals
 * @param {Record<string, {population: number, households: number}>} sums
 * @param {string} label
 * @returns {Check[]}
 */
function crossCheck(totals, sums, label) {
  /** @type {Check[]} */
  const checks = [];
  for (const [region, t] of Object.entries(totals)) {
    if (t.source !== "lv1") continue;
    const raw = sums[region];
    if (!raw || raw.population <= 0) {
      checks.push({ level: "warn", message: `${label} ${region}: 시군구 합이 비어 교차검증 생략` });
      continue;
    }
    const diff = Math.abs(raw.population - t.population) / t.population;
    if (diff > CROSS_CHECK_TOLERANCE) {
      checks.push({ level: "error", message: `${label} ${region}: lv=1 ${t.population.toLocaleString()} vs 시군구합 ${raw.population.toLocaleString()} (${(diff * 100).toFixed(2)}% 차이)` });
    }
  }
  return checks;
}

// ── 시도행 만들기 ────────────────────────────────────────────
/**
 * 시도행 = **lv=1 API 값**. prev 도 lv=1 작년 값(작년은 광주·전남이 따로 오므로 그대로 쓴다).
 * 시군구 합은 교차검증과 fallback 에만 쓴다.
 *
 * @param {{sidoCur: Array<Record<string, any>>, sidoPrev: Array<Record<string, any>>, rawCur: Array<Record<string, any>>, rawPrev: Array<Record<string, any>>, recordedAt: string}} input
 * @returns {{rows: Array<{region: string, gu: null, pop_growth: number | null, population: number, households: number | null, recorded_at: string}>, checks: Check[], fallbackCur: boolean, fallbackPrev: boolean}}
 */
export function buildSidoRows({ sidoCur, sidoPrev, rawCur, rawPrev, recordedAt }) {
  const sumCur = sumSidoFromRaw(rawCur);
  const sumPrev = sumSidoFromRaw(rawPrev);
  const cur = resolveSidoTotals(sidoCur, sumCur, "올해");
  const prev = resolveSidoTotals(sidoPrev, sumPrev, "작년");
  /** @type {Check[]} */
  const checks = [...cur.checks, ...prev.checks];

  // 교차검증 — 올해·작년 **둘 다**. 작년이 틀리면 값이 아니라 증감률이 조용히 거짓이 된다.
  checks.push(...crossCheck(cur.totals, sumCur, "올해"));
  checks.push(...crossCheck(prev.totals, sumPrev, "작년"));

  /** @type {Array<{region: string, gu: null, pop_growth: number | null, population: number, households: number | null, recorded_at: string}>} */
  const rows = [];
  for (const region of Object.keys(cur.totals).sort()) {
    const c = cur.totals[region];
    const p = prev.totals[region];
    /** @type {number | null} */
    let growth = null;
    if (p && p.population > 0) {
      growth = Math.round(((c.population - p.population) / p.population) * 100 * 10) / 10;
    } else {
      // 시도행 pop_growth null 은 VIEW 가 지난달 값을 이번 달인 양 보여주는 lag 를 연다(세션391 역방향).
      checks.push({ level: "error", message: `${region}: 작년 시도 인구 없음 — pop_growth null (VIEW lag 위험)` });
    }
    rows.push({
      region,
      gu: null,
      pop_growth: growth,
      population: c.population,
      households: c.households > 0 ? c.households : null,
      recorded_at: recordedAt,
    });
  }

  return { rows, checks, fallbackCur: cur.fallback, fallbackPrev: prev.fallback };
}

// ── 시군구행 만들기 (전년 없어도 저장) ───────────────────────
/**
 * canonical 올해/작년 → `regions` 시군구행.
 *
 * ⚠️ 전년 키가 없어도 **인구·세대는 저장하고 증감률만 null** 이다(D3). 옛 코드는
 * `if (!curPop || !prevPop) continue;` 로 행째 버려서, 2026 인천 개편으로 신설된 4구
 * (제물포·영종·서해·검단) **903,298명**이 통째로 사라졌다 — 개편 첫 해엔 전년 값이
 * 없는 게 정상이므로 "없다고 버리기"는 인구를 지우는 일이다.
 *
 * @param {{curRows: Array<{region: string, gu: string, population: number, households: number | null}>, prevRows: Array<{region: string, gu: string, population: number}>, recordedAt: string}} input
 * @returns {{rows: Array<{region: string, gu: string, pop_growth: number | null, population: number, households: number | null, recorded_at: string}>, noPrev: string[]}}
 */
export function buildGuRows({ curRows, prevRows, recordedAt }) {
  /** @type {Map<string, number>} */
  const prevMap = new Map();
  for (const r of prevRows ?? []) prevMap.set(`${r.region}:${r.gu}`, r.population);

  /** @type {Array<{region: string, gu: string, pop_growth: number | null, population: number, households: number | null, recorded_at: string}>} */
  const rows = [];
  /** @type {string[]} */
  const noPrev = [];
  for (const r of curRows ?? []) {
    const prevPop = prevMap.get(`${r.region}:${r.gu}`);
    /** @type {number | null} */
    let growth = null;
    if (prevPop && prevPop > 0) growth = Math.round(((r.population - prevPop) / prevPop) * 100 * 10) / 10;
    else noPrev.push(`${r.region} ${r.gu}`);
    rows.push({
      region: r.region,
      gu: r.gu,
      pop_growth: growth,
      population: r.population,
      households: r.households ?? null,
      recorded_at: recordedAt,
    });
  }
  return { rows, noPrev };
}

// ── 요약 (pop_growth null 은 분모에서 뺀다) ──────────────────
/**
 * ⚠️ 전년 키가 없는 신설구는 `pop_growth: null` 로 **저장한다**(D3). 그 행을 평균 분모에 넣으면
 * `null%` 가 찍히고 평균이 0 쪽으로 끌려간다 — 분모는 값 있는 행만.
 *
 * @param {Array<{pop_growth: number | null}>} guRows
 * @returns {{withGrowth: number, positive: number, negative: number, noPrev: number, avg: string}}
 */
export function summarizeGrowth(guRows) {
  const withGrowth = (guRows ?? []).filter((r) => r.pop_growth != null);
  const positive = withGrowth.filter((r) => (r.pop_growth ?? 0) > 0).length;
  const negative = withGrowth.filter((r) => (r.pop_growth ?? 0) < 0).length;
  const sum = withGrowth.reduce((s, r) => s + (r.pop_growth ?? 0), 0);
  return {
    withGrowth: withGrowth.length,
    positive,
    negative,
    noPrev: (guRows ?? []).length - withGrowth.length,
    avg: withGrowth.length > 0 ? (sum / withGrowth.length).toFixed(2) : "N/A",
  };
}

// ── CLI 인자 ─────────────────────────────────────────────────
/**
 * `--target=YYYYMM` — 대상 연월 재지정. 없으면 null (호출자가 실행일 −2개월을 쓴다).
 * @param {string[]} argv
 * @returns {{year: number, month: number} | null}
 */
export function parseTargetArg(argv) {
  const arg = (argv ?? []).find((a) => a.startsWith("--target="));
  if (!arg) return null;
  const m = /^--target=(\d{4})(\d{2})$/.exec(arg);
  if (!m) throw new Error(`--target 형식은 YYYYMM 입니다 (받은 값: ${arg})`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`--target 월이 1~12 밖입니다: ${arg}`);
  return { year, month };
}

/**
 * `--focus=경기:화성시,인천:제물포구` — dry-run 에서 이 시군구행을 통째로 찍는다.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function parseFocusArg(argv) {
  const arg = (argv ?? []).find((a) => a.startsWith("--focus="));
  if (!arg) return [];
  return arg.slice("--focus=".length).split(",").map((s) => s.trim()).filter(Boolean);
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) { logError("init", "MOIS_POP_KEY 환경변수 필요 (data.go.kr 인증키)"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");
  const focus = parseFocusArg(process.argv);
  const target = parseTargetArg(process.argv);

  // 현재 연월, 전년 동월. API 데이터는 보통 2개월 지연 → 2개월 전 데이터 사용.
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const curYear = target ? target.year : targetDate.getFullYear();
  const curMonth = target ? target.month : targetDate.getMonth() + 1;
  const prevYear = curYear - 1;
  const recordedAt = `${curYear}-${String(curMonth).padStart(2, "0")}-01`;

  log("init", `대상: ${curYear}년 ${curMonth}월 vs ${prevYear}년 ${curMonth}월${target ? " (--target 지정)" : ""}`);

  // API 호출 카운트 (시도코드 수 × 2회 + 시도합계 2회)
  let apiCalls = 0;

  // 1. 올해/작년 데이터 가져오기 (시군구 lv=2 + 시도합계 lv=1)
  const [curItems, prevItems, sidoCur, sidoPrev] = await Promise.all([
    fetchPopulation(curYear, curMonth),
    fetchPopulation(prevYear, curMonth),
    fetchSidoTotals(curYear, curMonth),
    fetchSidoTotals(prevYear, curMonth),
  ]);
  apiCalls += SIDO_CODES.length * 2 + 2;

  if (!curItems.length || !prevItems.length) {
    logError("data", "인구 데이터가 비어있습니다. API 키를 확인하세요.");
    process.exit(1);
  }

  // 2. canonical 시군구행 (키당 1행 — 화성 5행 이중계상 차단)
  const canonCur = pickCanonicalPopulationRows(curItems);
  const canonPrev = pickCanonicalPopulationRows(prevItems);
  log("calc", `canonical: 올해 ${canonCur.rows.length}행(접힘 ${canonCur.collapsed}, 경고 ${canonCur.foldedOnly.length}) / 작년 ${canonPrev.rows.length}행(접힘 ${canonPrev.collapsed}, 경고 ${canonPrev.foldedOnly.length})`);
  for (const key of canonCur.foldedOnly) logError("calc", `접힌 원문만 모인 키 — 시 단위 원문 없음: ${key}`);

  // 3. 시군구행 — 전년 키가 없어도 인구·세대는 저장한다(D3)
  const gu = buildGuRows({ curRows: canonCur.rows, prevRows: canonPrev.rows, recordedAt });
  /** @type {Array<{region: string, gu: string | null, pop_growth: number | null, population: number, households: number | null, recorded_at: string}>} */
  const rows = [...gu.rows];
  const noPrevList = gu.noPrev;

  // 4. 시도행 — API 가 직접 주는 lv=1 값 (우리가 더하지 않는다)
  const sido = buildSidoRows({ sidoCur, sidoPrev, rawCur: curItems, rawPrev: prevItems, recordedAt });
  for (const c of sido.checks) {
    if (c.level === "error") logError("check", c.message);
    else log("check", c.message);
  }
  rows.push(...sido.rows);

  log("calc", `${rows.length}건 계산 완료`);

  // 요약 출력
  const guRows = rows.filter(r => r.gu);
  const regionRows = rows.filter(r => !r.gu);
  const sum = summarizeGrowth(guRows);
  log("summary", `시도: ${regionRows.length}건, 시군구: ${guRows.length}건`);
  log("summary", `양수: ${sum.positive}건, 음수: ${sum.negative}건, 전년없음: ${sum.noPrev}건, 평균: ${sum.avg}%`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");

    console.log(`\n시도행 ${regionRows.length}개 (population | households | pop_growth):`);
    for (const r of [...regionRows].sort((a, b) => a.region.localeCompare(b.region))) {
      const hh = r.households == null ? "null" : r.households.toLocaleString();
      const g = r.pop_growth == null ? "null" : `${r.pop_growth > 0 ? "+" : ""}${r.pop_growth}%`;
      console.log(`  ${r.region.padEnd(4)} | ${String(r.population.toLocaleString()).padStart(12)} | ${hh.padStart(11)} | ${g}`);
    }

    if (focus.length > 0) {
      console.log(`\n지정 시군구 (--focus ${focus.length}개):`);
      for (const key of focus) {
        const r = guRows.find((x) => `${x.region}:${x.gu}` === key);
        if (!r) { console.log(`  ${key}: (없음)`); continue; }
        const hh = r.households == null ? "null" : r.households.toLocaleString();
        const g = r.pop_growth == null ? "null" : `${r.pop_growth > 0 ? "+" : ""}${r.pop_growth}%`;
        console.log(`  ${key}: population ${r.population.toLocaleString()} | households ${hh} | pop_growth ${g}`);
      }
    }

    console.log(`\n전년없음 ${noPrevList.length}건:`);
    console.log(noPrevList.length ? `  ${noPrevList.join(", ")}` : "  (없음)");

    console.log(`\ncanonical 접힘: 올해 ${canonCur.collapsed}건(경고 ${canonCur.foldedOnly.length}) / 작년 ${canonPrev.collapsed}건(경고 ${canonPrev.foldedOnly.length})`);

    const errs = sido.checks.filter((c) => c.level === "error");
    const warns = sido.checks.filter((c) => c.level === "warn");
    console.log(`\n교차검증: 오류 ${errs.length}건 / 경고 ${warns.length}건 (fallback 올해=${sido.fallbackCur} 작년=${sido.fallbackPrev})`);
    for (const c of [...errs, ...warns]) console.log(`  [${c.level}] ${c.message}`);

    const ranked = guRows.filter((r) => r.pop_growth != null);
    console.log("\n상위 10 시군구:");
    for (const r of [...ranked].sort((a, b) => (b.pop_growth ?? 0) - (a.pop_growth ?? 0)).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${(r.pop_growth ?? 0) > 0 ? "+" : ""}${r.pop_growth}%`);
    }
    console.log("\n하위 10 시군구:");
    for (const r of [...ranked].sort((a, b) => (a.pop_growth ?? 0) - (b.pop_growth ?? 0)).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${r.pop_growth}%`);
    }
    return;
  }

  // 5. Supabase 저장 (Approach C: UPDATE 소유 컬럼만 + conditional INSERT)
  // population.mjs는 pop_growth, population, households 소유. 다른 수집기 컬럼은 보존.
  const sb = getSupabase();
  const rpt = createReporter("population");
  let saved = 0;
  for (const row of rows) {
    if (rpt.interrupted()) break;
    // population 소유 컬럼만 업데이트 (다른 수집기 컬럼 보존)
    let q = sb.from("regions")
      .update({ pop_growth: row.pop_growth, population: row.population, households: row.households })
      .eq("region", row.region)
      .eq("recorded_at", row.recorded_at);
    if (row.gu) q = q.eq("gu", row.gu);
    else q = q.is("gu", null);

    const { data: updated, error: updErr } = await q.select("id");
    if (updErr) {
      logError("regions", `UPDATE 실패 ${row.region} ${row.gu || '(시도)'}: ${updErr.message}`);
      rpt.fail(1);
      continue;
    }

    if (!updated || updated.length === 0) {
      // 행이 없으면 새로 생성 (supply_ratio 등 미소유 컬럼은 생략 → DB default null)
      const { error: insErr } = await sb.from("regions").insert([{
        region: row.region,
        gu: row.gu,
        pop_growth: row.pop_growth,
        population: row.population,
        households: row.households,
        recorded_at: row.recorded_at,
      }]);
      if (insErr) {
        logError("regions", `INSERT 실패 ${row.region} ${row.gu || '(시도)'}: ${insErr.message}`);
        rpt.fail(1);
        continue;
      }
    }
    saved++;
    rpt.success(1);
  }
  log("done", `regions 테이블 ${saved}/${rows.length}건 저장 완료 (${today()})`);
  const result = rpt.summary();

  if (!dryRun) await recordApiQuota("population", "MOIS_POP_KEY", apiCalls);
  await recordCollectorRun("population", result);
  if (result.fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

// 테스트용 순수 함수 export
export { resolveRegion, parseGu, parseHouseholds, parsePopulation };
