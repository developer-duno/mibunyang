#!/usr/bin/env node
// @ts-check
/**
 * clean-naver-match-pollution.mjs — 일회성: sync-naver-complex 오매칭 오염값 NULL 정리 (세션536)
 *
 * 사고 (세션536 선행 실측): `matchApartments`(이름 유사도 0.6, 거리 무제한)가 만드는
 * (단지,아파트) 짝의 **92.07%가 500m 밖**(짝 거리 중앙값 85km)이었다. 그 결과 대조 가능한
 * 표본만 세어도 floor_area_ratio 20.5%·building_coverage_ratio 36.5%·max_floor 14.8%가
 * 어긋나 있었다 — 먼 곳의 동명(또는 유사명) 단지 값이 그대로 apartments 에 들어와 있었다.
 *
 * 재오염 방지(앞으로 채울 때만 거리 게이트)는 `sync-naver-complex.mjs`(withinMatchRange,
 * MATCH_MAX_M=500)에 이미 박혀 있다. 이 스크립트는 **이미 저장된** 오염값만 정리한다 —
 * 사장님 결정 ②(기존 값은 건드리지 않는다)에 따라, 자의성 낮은 기준으로 "확정" 가능한
 * 것만 지우고 나머지는 그대로 둔다.
 *
 * 오염 판정 기준 (선행 실측이 확정 — probes/tight.mjs, .claude/rules/collectors/
 * external-file-duplicate-rows.md 의 "더 나은 기준" 절):
 *   apt 로부터 500m 이내에, 괄호 없는(=주상복합 등 접미사 없는) **완전동명**(정규화 후 유사도
 *   1.0) 후보가 **정확히 1개**이고, 그 후보의 값과 apt 저장값이 **1.5배 이상** 어긋난다.
 *   → 거리·유사도 임계는 완만한 구간(300~1000m 어긋남 208~249건)이라 자의성이 낮고,
 *     "완전동명 유일 후보"는 주상복합 혼입(괄호 접미사)과 다른 후보 존재(모호함)를 구조적으로
 *     배제한다.
 *
 * ⚠️ 세 항목 모두 지운다(용적률·건폐율·최고층) — 사장님 명시 결정. 단 건폐율은 선행 실측에서
 *    완전동명 유일후보 470건 중 **어긋남이 57%(268건)** 로 다른 두 항목보다 훨씬 높았고
 *    (점수에는 안 쓰이는 표시 전용 필드라 급하지 않다는 leftover 권고도 있었다) — dry-run
 *    출력을 사람이 먼저 보고 `--apply` 여부를 판단하라고 이 사실을 남긴다.
 *
 * ⚠️ 쌍둥이 신뢰도 게이트 (적대검증 반례 정정 — 브이티스타일 사례):
 *   "완전동명 유일 후보"만으로 확정하던 위 기준은 한 자리(부지)에 네이버 단지가 **여러 개**
 *   (주상복합 등 접미사로 갈라진 동일 부지) 등재된 경우를 놓친다. "괄호 있는 후보 제외"
 *   규칙이 진짜 판매 중인 주동을 통째로 배제해, 세대수·매물 활동이 거의 없는 부속동/저층동만
 *   "유일 후보"로 남을 수 있다. 실사례: 브이티스타일 — apt.max_floor=23, 3m 거리에 네이버
 *   단지 둘: 배제된 '브이티스타일(주상복합)'(15층·75세대·활성매물18건, 실제 판매 중인 주동)
 *   vs 채택된 '브이티스타일'(2층·13세대·활성매물0건, 부속동으로 보임). 값 비교(23 vs 2)가
 *   압도적으로 벌어져 "오염"으로 오판됐다.
 *
 *   전수 실측(apartments 2,905 × complexes 64,104, 베이스라인 오염 대상 450건)으로 셋을 비교:
 *     (a) 괄호 포함 후보까지 풀에 넣고 "세대수 큰 쪽"을 무조건 채택 — 대상이 450→489건으로
 *         오히려 늘고(선택 폭을 넓히면 오탐도 함께 늘어난다), 브이티스타일도 구제 못한다
 *         (23 vs 15 = 1.53배, 여전히 임계 이상). **채택 안 함.**
 *     (b) 채택된 유일 후보의 신뢰도가 낮으면(세대수 작고 *그리고* 활성 매물도 0) 보류.
 *         "활성매물0" **단독**이면 176건(39.1%)이 걸리는데, 그 중 다수(용적률 41/61·건폐율
 *         71/97)가 세대수 100+ 인 정상 대형단지였다(과제 지시 "매물 0건이 곧 부실은 아니다"
 *         와 일치 — 지금 안 팔릴 뿐인 진짜 단지를 세대수까지 같이 봐야 걸러낼 수 있다).
 *         세대수 문턱은 complexes.total_household_count 양수 분포의 p25(≈19)에 근접한 20
 *         채택 — 문턱 10 은 브이티스타일(hh=13)을 구제 못하고(13≥10), 문턱 50 은 보류가
 *         37건으로 20(18건)보다 과하게 넓어진다. **AND(세대수<20, 활성매물0) → 18건 보류.**
 *     (c) 신뢰도는 통과했어도, 괄호 때문에 배제된 다른 후보의 값이 apt 저장값에 더 가까우면
 *         (그 후보를 썼다면 애초에 "정상" 판정이었을 경우) 보류. **3건 추가 구제**(전부
 *         최고층 필드) — (b)와 겹치지 않는다.
 *   → (b)+(c) 를 함께 적용 = 최종 450건 중 21건(4.7%) 보류, 429건 잔존. 브이티스타일은
 *     (b)에서 걸린다(twin hh=13<20, 활성매물0).
 *
 * ⚠️ 물리적 타당성 게이트 (d) — 다음 감사에서 추가된 반례: (b)+(c) 를 다 통과해도(쌍둥이
 *   세대수·활성매물이 충분해 "믿을 만해 보여도") 쌍둥이의 **저장값 자체**가 물리적으로
 *   말이 안 되는 경우가 남는다. 예: 중앙로역 푸르지오 더 센트럴(우리 259% vs 쌍둥이 880%,
 *   쌍둥이 세대수 70·매물 0 — hh=70≥20 이라 게이트(b) 를 안 걸린다), 힐스테이트 대구역
 *   퍼스트(375% vs 883%), 태왕디아너스 오페라(건폐율 38% vs 67% — 아파트 건폐율 67%는
 *   사실상 불가능). 이 값들을 "우리 값이 틀렸다"는 근거로 쓰면 멀쩡한 값을 지운다.
 *
 *   FIELD_SPECS 의 validMin/validMax(타당 범위)가 이 게이트의 기준이다. 판정:
 *     - 우리 값이 타당 범위 안, 쌍둥이 값이 범위 밖 → **보류** (쌍둥이를 신뢰할 근거 없음).
 *       이게 유일한 신규 동작이다.
 *     - 그 외(우리 값이 범위 밖인 모든 경우, 또는 둘 다 범위 안) → 기존 로직 그대로
 *       진행(우리 값이 범위 밖이면 그 자체로 지울 근거가 있으므로 쌍둥이 신뢰도와 무관하게
 *       기존 1.5배 판정을 따른다).
 *
 *   범위 근거(라이브 실측, 세션536 후속 — complexes N=64,104 · apartments N=2,905, 0 이하는
 *   sentinel 이라 제외):
 *     - 용적률: complexes(>0, n=56,916) p1=79·p5=139·p50=269·p95=812·p99=998·max=2071(오류값)
 *       / apartments(>0, n=1,826) p1=130·p5=165·p50=254·p95=817·p99=1000·max=1296.
 *       하한 30 — complexes 중 <30 인 값은 14건(0.02%)뿐, 극단 소수만 배제. 상한 800 —
 *       국내 최고 수준으로 알려진 실사례(해운대 엘시티 더샵, FAR ≈ 799%)를 포함하도록 근접
 *       하게 잡되, 반례의 쌍둥이 값(880%·883%)은 초과해 배제한다. 법정 상한(국토계획법
 *       시행령 §85, 중심상업지역 최대 1500%)보다는 훨씬 낮지만, 그 상한은 초고층 상업용
 *       빌딩 기준이라 "아파트/주상복합 단지" 실측치와는 거리가 멀다.
 *     - 건폐율: complexes(>0, n=56,569) p1=12·p5=15·p50=46·p95=76·p99=79·max=385(물리적으로
 *       불가능 — 건폐율은 정의상 100 초과 불가) / apartments(>0, n=2,485) p1=13·p5=15·
 *       p50=44·p95=68·p99=76·max=84. 하한 5 — complexes 중 <5 인 값은 21건(0.04%)뿐. 상한
 *       60 — 국토계획법 시행령 §84 의 제1·2종일반주거지역 법정 상한(60%)과 일치시키면서
 *       반례(67%)를 배제한다. 준주거·상업지역 법정 상한은 70~90% 로 더 높지만, 실제 아파트
 *       단지는 고층·좁은 대지 구조상 건폐율이 통상 10~40%대에 머물러(complexes p50=46 은
 *       비주거 용도 혼입 가능성 포함) 그보다 높은 값은 근거가 약하다.
 *     - 최고층: complexes(>0) p1=2·p5=4·p50=12·p95=27·p99=38·max=84 / apartments(>0)
 *       p1=4·p5=10·p50=24·p95=43·p99=49·max=90. 하한 3 — 공동주택 중 "아파트"는 법정으로
 *       5개층 이상(4층 이하는 연립·다세대)이나, 데이터 하위 꼬리(p1=2~4)를 안전하게 포함
 *       하도록 3으로 완만하게 잡는다. 상한 100 — 국내 최고층 주거용 실사례(부산 엘시티
 *       더샵 랜드마크타워 레지던스 85층, 롯데월드타워 시그니엘 레지던스 등)와 라이브
 *       데이터 최대값(90)을 여유 있게 포함하는 반올림 상한. (이 필드는 반례 표에서 "둘 다
 *       타당" 19건뿐이라 어느 상한을 잡아도 결과가 갈리지 않음 — 여유 있게 잡는다.)
 *
 * 안전장치:
 *   - 0 이하 값은 비교하지 않는다(complexes 에 0 이 "미수집" sentinel 로 섞여 있어 — 세션536
 *     실측 floor_area_ratio 0값 7,025건 · building_coverage_ratio 0값 7,372건 — 0 대 0/양수
 *     비교는 무의미한 무한/0 배율을 만든다).
 *   - 좌표 없는 apt/twin 후보는 건너뛴다(거리를 모르면 확정할 수 없다).
 *   - 활성 매물(articles) 조회가 실패해도 fail-open(빈 Map + 로그) — 신뢰도 게이트가
 *     완화될 뿐 전체 정리 작업 자체는 막지 않는다.
 *
 * collector_runs 기록은 하지 않는다(판단: 이 스크립트는 cron 도 workflow 도 없는 **일회성**
 * 실행이라 monitor-collectors.mjs 감시 대상이 아니다 — `backfill-completion-from-movein.mjs`
 * 등 최근 일회성 backfill 스크립트도 같은 이유로 recordCollectorRun 을 안 쓴다).
 *
 * 사용법:
 *   node scripts/clean-naver-match-pollution.mjs             (기본 = DRY-RUN, 미리보기만)
 *   node scripts/clean-naver-match-pollution.mjs --apply     (실제 UPDATE)
 */
import { loadEnv, getMibuyangSupabase, log, logError, selectAll, sleep, stringSimilarity } from "./collectors/_shared.mjs";
import { buildSpatialGrid, findNearbyComplexes, distanceM, flushUpdates, fetchAllPages } from "./collectors/sync-naver-complex.mjs";

loadEnv();

const PHASE = "clean-naver-match-pollution";

/** 500m — sync-naver-complex.mjs MATCH_MAX_M 과 동일 근거(선행 실측 공통 기준선). */
export const RADIUS_M = 500;
/** 1.5배 — 선행 실측 "값이 1.5배 이상 어긋남" 오염 확정 기준. */
export const RATIO_THRESHOLD = 1.5;
/**
 * 쌍둥이 신뢰도 문턱 — 세대수(complexes.total_household_count)가 이 값 미만이면서 *동시에*
 * 활성 매물(articles.is_active=true)도 0건이면 "값을 비교할 근거가 약하다"로 보고 삭제
 * 대상에서 제외한다(판정 보류). 세대수만으로 판단하지 않는 이유 — 활성매물0 단독 기준은
 * 세대수 100+ 인 정상 대형단지(그저 지금 안 팔릴 뿐)까지 대거 걸려 과했다(전수 실측
 * 176건 중 다수가 세대수 100+). 반대로 세대수만 보고 활성매물을 무시하면 실제 거래 중인
 * 소규모 단지까지 보류시켜 지나치게 보수적이다 — 두 신호가 *둘 다* 약할 때만 보류한다.
 *
 * 문턱값 20 근거 — complexes.total_household_count 양수 분포(전수)의 p25 ≈ 19 에 근접,
 * "하위 25% 규모"를 소형/부속동 신호로 삼는다는 뜻. 경쟁 후보값 비교(전수 실측, 베이스라인
 * 450건 기준 보류 건수): 10 → 4건(브이티스타일 twin hh=13 을 구제 못함, 13≥10) · 20 → 18건
 * (채택) · 50 → 37건(과함). @type {number}
 */
export const TWIN_HOUSEHOLD_MIN = 20;

/**
 * articles(활성매물) 조회 재시도 횟수. 세션537 실측 = 활성 262,336행 전량 33.4초(COUNT 정확
 * 일치)로 평소엔 통과하지만, 세션536 실행 때는 같은 조회가 statement timeout 으로 죽었다.
 * 즉 **복불복 실패**라 재시도로 대부분 풀린다.
 * @type {number}
 */
export const ARTICLES_MAX_ATTEMPTS = 3;
/** 재시도 사이 대기(ms) — DB 부하가 지나가길 기다리는 것이 목적이라 짧게 두지 않는다. @type {number} */
export const ARTICLES_RETRY_DELAY_MS = 5000;

/**
 * @typedef {{ key: string; label: string; aptField: string; cpxField: string; validMin: number; validMax: number; unit: string }} FieldSpec
 */

/**
 * 물리적 타당성 범위(validMin~validMax, 포함) — 근거·라이브 실측 수치는 파일 상단 "물리적
 * 타당성 게이트 (d)" 절 참조. unit 은 보고 문구용(퍼센트/층).
 * @type {FieldSpec[]}
 */
export const FIELD_SPECS = [
  { key: "floor_area_ratio", label: "용적률", aptField: "floor_area_ratio", cpxField: "floor_area_ratio", validMin: 30, validMax: 800, unit: "%" },
  { key: "building_coverage_ratio", label: "건폐율", aptField: "building_coverage_ratio", cpxField: "building_coverage_ratio", validMin: 5, validMax: 60, unit: "%" },
  // ⚠️ apartments 는 max_floor, complexes 는 high_floor — 이름이 다르다(sync-naver-complex.mjs
  // Phase 1 채움 라인과 동일 매핑: `apt.max_floor == null && cpx.high_floor != null`).
  { key: "max_floor", label: "최고층", aptField: "max_floor", cpxField: "high_floor", validMin: 3, validMax: 100, unit: "층" },
];

/**
 * 괄호(주상복합 등 접미사) 제거 — isExactNameTwin 과 신뢰도 게이트(c)가 공유.
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function stripBrackets(raw) {
  return String(raw ?? "").replace(/\([^)]*\)/g, "").trim();
}

/**
 * 단지명 정규화 매칭 — 괄호(주상복합 등 접미사) 제거 후 stringSimilarity 로 완전일치(=1) 판정.
 * stringSimilarity 는 공백 제거 후 `sa === sb` 면 정확히 1 을 반환하므로, 괄호를 미리 벗기면
 * "완전동명(정규화 후 유사도 1.0)" 조건과 정확히 같다.
 * @param {string | null | undefined} cpxRawName
 * @param {string | null | undefined} aptName
 * @returns {boolean}
 */
export function isExactNameTwin(cpxRawName, aptName) {
  const raw = String(cpxRawName ?? "");
  if (raw.includes("(")) return false; // 괄호 있는 후보 제외(주상복합 혼입 방지)
  return stringSimilarity(stripBrackets(raw), aptName) === 1;
}

/**
 * scanPollution 이 "보류" 결과를 사유별로 집계할 때 쓰는 카테고리 — dry-run 보고에서
 * "쌍둥이 부실 / 쌍둥이 값 비타당 / 배제후보가 더 가까움" 을 갈라 보이기 위한 키.
 */
export const HOLD_CATEGORY = {
  /** 게이트(b): 쌍둥이 세대수 작고 그리고 활성매물도 0 — "쌍둥이 부실". */
  TWIN_WEAK: "twin_weak",
  /** 게이트(d): 쌍둥이 값이 물리적 타당 범위 밖 — "쌍둥이 값 비타당". */
  TWIN_IMPLAUSIBLE: "twin_implausible",
  /** 게이트(c): 괄호로 배제됐던 다른 후보가 저장값에 더 가까움 — "배제후보가 더 가까움". */
  CLOSER_EXCLUDED: "closer_excluded",
};

/**
 * 값이 spec 의 물리적 타당 범위(validMin~validMax, 포함) 안에 있는지.
 * @param {number} value
 * @param {FieldSpec} spec
 * @returns {boolean}
 */
export function isPlausible(value, spec) {
  return value >= spec.validMin && value <= spec.validMax;
}

/**
 * apt 하나 × field 하나의 오염 여부 판정.
 *
 * @param {{ id: string; name: string | null; lat: number | null; lng: number | null; [k: string]: unknown }} apt
 * @param {import("./collectors/sync-naver-complex.mjs").SpatialGrid} spatialGrid
 * @param {Map<string, { complex_no: string; complex_name: string | null; latitude: number | null; longitude: number | null; total_household_count: number | null; [k: string]: unknown }>} complexByNo
 * @param {FieldSpec} spec
 * @param {Map<string, number>} [activeCounts]  complex_no → 활성 매물(articles.is_active=true) 개수. 쌍둥이 신뢰도 게이트(b)용 — 생략 시 전부 0 취급.
 * @returns {{ polluted: boolean; twin: { complex_no: string; complex_name: string | null } | null; twinValue: number | null; distanceM: number | null; ratio: number | null; reason: string; twinHousehold: number | null; twinActiveListings: number | null; holdCategory: string | null }}
 */
export function detectPollution(apt, spatialGrid, complexByNo, spec, activeCounts = new Map()) {
  const aptVal = /** @type {number | null | undefined} */ (apt[spec.aptField]);
  const empty = { polluted: false, twin: null, twinValue: null, distanceM: null, ratio: null, twinHousehold: null, twinActiveListings: null, holdCategory: null };
  if (aptVal == null) return { ...empty, reason: "값 없음" };
  if (apt.lat == null || apt.lng == null) return { ...empty, reason: "apt 좌표 없음" };

  const nearbyIds = findNearbyComplexes(/** @type {any} */ (apt), spatialGrid, RADIUS_M / 1000);
  /** @type {Array<{ complex_no: string; complex_name: string | null; latitude: number | null; longitude: number | null; total_household_count: number | null; [k: string]: unknown }>} */
  const exactTwins = [];
  // 괄호 때문에 isExactNameTwin 에서 배제됐지만(주상복합 등) 벗긴 이름은 apt 와 완전히
  // 같은 후보 — 신뢰도 게이트(c)가 "이 후보가 더 가까우면 보류"에 쓴다.
  /** @type {Array<{ complex_no: string; complex_name: string | null; [k: string]: unknown }>} */
  const bracketedSameName = [];
  for (const cno of nearbyIds) {
    const cpx = complexByNo.get(cno);
    if (!cpx) continue;
    if (isExactNameTwin(cpx.complex_name, apt.name)) {
      exactTwins.push(cpx);
    } else if (stringSimilarity(stripBrackets(cpx.complex_name), apt.name) === 1) {
      bracketedSameName.push(cpx);
    }
  }

  if (exactTwins.length !== 1) {
    const reason = exactTwins.length === 0 ? "완전동명 후보 없음" : `완전동명 후보 ${exactTwins.length}개(모호)`;
    return { ...empty, reason };
  }

  const twin = exactTwins[0];
  const twinVal = /** @type {number | null | undefined} */ (twin[spec.cpxField]);
  const dist = twin.latitude != null && twin.longitude != null ? distanceM(apt.lat, apt.lng, twin.latitude, twin.longitude) : null;
  const twinHousehold = twin.total_household_count ?? null;
  const twinActiveListings = activeCounts.get(twin.complex_no) ?? 0;

  if (twinVal == null || twinVal <= 0 || aptVal <= 0 || dist == null) {
    return { polluted: false, twin, twinValue: twinVal ?? null, distanceM: dist, ratio: null, reason: "비교 불가(0 이하 또는 좌표 없음)", twinHousehold, twinActiveListings, holdCategory: null };
  }

  const ratio = Math.max(aptVal, twinVal) / Math.min(aptVal, twinVal);
  if (ratio < RATIO_THRESHOLD) {
    return { polluted: false, twin, twinValue: twinVal, distanceM: dist, ratio, reason: `${ratio.toFixed(2)}배 — 임계 미만`, twinHousehold, twinActiveListings, holdCategory: null };
  }

  // ── 신뢰도 게이트 (d) ── 물리적 타당성: 우리 값은 타당 범위 안인데 쌍둥이 값이 범위
  // 밖이면, 쌍둥이 쪽을 신뢰할 근거가 없다 — 판정을 보류한다. 우리 값이 범위 밖이면(이
  // 조건에 안 걸리면) 그 자체로 지울 근거가 있으므로 쌍둥이 타당성과 무관하게 아래 게이트로
  // 그대로 진행한다(파일 상단 "물리적 타당성 게이트 (d)" 절 — 4가지 경우의 표).
  if (isPlausible(aptVal, spec) && !isPlausible(twinVal, spec)) {
    return {
      polluted: false, twin, twinValue: twinVal, distanceM: dist, ratio,
      reason: `판정 보류(쌍둥이 값 비타당: ${spec.label} ${twinVal}${spec.unit} — 타당범위 ${spec.validMin}~${spec.validMax}${spec.unit} 밖)`,
      twinHousehold, twinActiveListings, holdCategory: HOLD_CATEGORY.TWIN_IMPLAUSIBLE,
    };
  }

  // ── 신뢰도 게이트 (b) ── 세대수 작고 *그리고* 활성 매물도 0인 쌍둥이는 "값을 비교할
  // 근거가 약하다"로 보고 판정을 보류한다(단독 신호 금지 — 위 상수 주석의 실측 근거).
  if ((twinHousehold == null || twinHousehold < TWIN_HOUSEHOLD_MIN) && twinActiveListings === 0) {
    return {
      polluted: false, twin, twinValue: twinVal, distanceM: dist, ratio,
      reason: `판정 보류(쌍둥이 신뢰도 낮음: 세대수 ${twinHousehold ?? "미상"}·활성매물 0)`,
      twinHousehold, twinActiveListings, holdCategory: HOLD_CATEGORY.TWIN_WEAK,
    };
  }

  // ── 신뢰도 게이트 (c) ── 괄호 때문에 배제됐던 다른 후보의 값이 apt 저장값에 더 가까우면
  // (그 후보를 썼다면 애초에 "정상" 판정이었을 경우) 판정을 보류한다.
  for (const other of bracketedSameName) {
    const otherVal = /** @type {number | null | undefined} */ (other[spec.cpxField]);
    if (otherVal == null || otherVal <= 0) continue;
    const otherRatio = Math.max(aptVal, otherVal) / Math.min(aptVal, otherVal);
    if (otherRatio < RATIO_THRESHOLD) {
      return {
        polluted: false, twin, twinValue: twinVal, distanceM: dist, ratio,
        reason: `판정 보류(배제된 다른 후보 '${other.complex_name}'가 저장값에 더 가까움)`,
        twinHousehold, twinActiveListings, holdCategory: HOLD_CATEGORY.CLOSER_EXCLUDED,
      };
    }
  }

  return {
    polluted: true, twin, twinValue: twinVal, distanceM: dist, ratio,
    reason: `${ratio.toFixed(2)}배 어긋남 (>= ${RATIO_THRESHOLD})`,
    twinHousehold, twinActiveListings, holdCategory: null,
  };
}

/**
 * 전체 apartments × FIELD_SPECS 를 훑어 필드별 오염 대상을 모으고, 보류(hold)된 건은
 * 사유별로 집계한다(dry-run 보고용 — "쌍둥이 부실 / 쌍둥이 값 비타당 / 배제후보가 더 가까움").
 *
 * @param {Array<{ id: string; name: string | null; lat: number | null; lng: number | null; [k: string]: unknown }>} apartments
 * @param {import("./collectors/sync-naver-complex.mjs").SpatialGrid} spatialGrid
 * @param {Map<string, any>} complexByNo
 * @param {Map<string, number>} [activeCounts]  complex_no → 활성 매물 개수(신뢰도 게이트용)
 * @returns {{
 *   targetsByField: Record<string, Array<{ id: string; name: string | null; storedValue: number; twinName: string | null; twinValue: number; distanceM: number; ratio: number; twinHousehold: number | null; twinActiveListings: number | null }>>;
 *   holdsByField: Record<string, { twin_weak: number; twin_implausible: number; closer_excluded: number }>;
 * }}
 */
export function scanPollution(apartments, spatialGrid, complexByNo, activeCounts = new Map()) {
  /** @type {Record<string, Array<{ id: string; name: string | null; storedValue: number; twinName: string | null; twinValue: number; distanceM: number; ratio: number; twinHousehold: number | null; twinActiveListings: number | null }>>} */
  const targetsByField = {};
  /** @type {Record<string, { twin_weak: number; twin_implausible: number; closer_excluded: number }>} */
  const holdsByField = {};
  for (const spec of FIELD_SPECS) {
    targetsByField[spec.key] = [];
    holdsByField[spec.key] = { twin_weak: 0, twin_implausible: 0, closer_excluded: 0 };
  }

  for (const apt of apartments) {
    for (const spec of FIELD_SPECS) {
      const result = detectPollution(apt, spatialGrid, complexByNo, spec, activeCounts);
      if (result.polluted) {
        targetsByField[spec.key].push({
          id: apt.id,
          name: apt.name,
          storedValue: /** @type {number} */ (apt[spec.aptField]),
          twinName: result.twin?.complex_name ?? null,
          twinValue: /** @type {number} */ (result.twinValue),
          distanceM: /** @type {number} */ (result.distanceM),
          ratio: /** @type {number} */ (result.ratio),
          twinHousehold: result.twinHousehold,
          twinActiveListings: result.twinActiveListings,
        });
      } else if (result.holdCategory) {
        holdsByField[spec.key][/** @type {"twin_weak" | "twin_implausible" | "closer_excluded"} */ (result.holdCategory)] += 1;
      }
    }
  }
  return { targetsByField, holdsByField };
}

/**
 * apartments 전량 조회 — 고유키(id) 커서 (unordered-pagination-loses-rows.md §1).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function fetchApartments(sb) {
  return /** @type {any[]} */ (
    await selectAll(
      (s) => s.from("apartments").select("id, name, lat, lng, floor_area_ratio, building_coverage_ratio, max_floor"),
      sb,
      "id",
    )
  );
}

/**
 * complexes 전량 조회 — 고유키(complex_no) 커서. complexes 는 id 컬럼이 없다.
 * total_household_count 는 쌍둥이 신뢰도 게이트(b)용.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function fetchComplexes(sb) {
  return /** @type {any[]} */ (
    await selectAll(
      (s) => s.from("complexes").select("complex_no, complex_name, latitude, longitude, floor_area_ratio, building_coverage_ratio, high_floor, total_household_count"),
      sb,
      "complex_no",
    )
  );
}

/**
 * complex_no 별 활성 매물(articles.is_active=true) 개수 — 쌍둥이 신뢰도 게이트(b)용.
 * 고유키(article_no) 커서로 전량 조회(unordered-pagination-loses-rows.md §1, sync-naver-complex.mjs
 * 의 동일 패턴 답습 — 활성 매물이 큰 article_no(최신)에 몰려 있어 desc+lt 커서가 더 빠르다).
 *
 * **fail-close (세션537 정정)**: 재시도 후에도 실패하면 throw 한다.
 *
 * 옛 주석은 "fail-open — 신뢰도 게이트가 완화될 뿐"이라 적혀 있었는데 **방향이 반대**였다.
 * 이 신호가 없으면 twinActiveListings 가 전부 0 이 되어 게이트(b)의 AND 뒤쪽이 항상 참이
 * 되고, 세대수 20 미만인 쌍둥이가 **전부 보류**된다 — 완화가 아니라 **과보류**다. 즉 위험은
 * "멀쩡한 값을 지운다"가 아니라 "**지워야 할 오염을 놓친다**" 쪽이다. 방향이 안전하다고
 * 조용히 진행하면 판정이 부실해진 것을 아무도 모르므로(세션536 때 실제로 timeout 이 났는데
 * 결과가 dry-run 과 우연히 같아 넘어갔다) 근거가 불완전하면 아예 멈춘다.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {typeof fetchAllPages} [fetcher] 조회 함수(테스트 주입용, 기본 fetchAllPages)
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchActiveArticleCounts(sb, fetcher = fetchAllPages) {
  let lastError = null;
  for (let attempt = 1; attempt <= ARTICLES_MAX_ATTEMPTS; attempt++) {
    const { rows, error } = await fetcher(
      (s) => s.from("articles").select("article_no, complex_no").eq("is_active", true),
      sb,
      { keyCol: "article_no", desc: true },
    );
    if (!error) {
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const r of rows) counts.set(r.complex_no, (counts.get(r.complex_no) ?? 0) + 1);
      return counts;
    }
    lastError = error;
    if (attempt < ARTICLES_MAX_ATTEMPTS) {
      logError(PHASE, `articles(활성매물) 조회 실패 ${attempt}/${ARTICLES_MAX_ATTEMPTS} — ${ARTICLES_RETRY_DELAY_MS / 1000}초 후 재시도: ${error}`);
      await sleep(ARTICLES_RETRY_DELAY_MS);
    }
  }
  // ⚠️ fail-close. 이 신호 없이 진행하면 twinActiveListings 가 전부 0 이 되어 게이트(b)의
  //    AND 조건 뒤쪽이 항상 참이 된다 — 세대수 20 미만인 쌍둥이가 **전부** 보류되므로
  //    "멀쩡한 값을 지운다"가 아니라 **지워야 할 오염을 놓친다**(과보류). 방향은 안전하지만
  //    판정이 조용히 부실해지는 것은 같아서, 근거가 불완전한 채로는 아예 진행하지 않는다.
  //    세션536 실행 때 statement timeout 이 났는데 결과가 dry-run 과 우연히 같아 넘어갔다.
  throw new Error(`articles(활성매물) 조회가 ${ARTICLES_MAX_ATTEMPTS}회 모두 실패 — 신뢰도 게이트(b)의 판정 근거가 없어 중단한다: ${lastError}`);
}

/**
 * dry-run 표 출력 — 대상 곳수 + 상위 20곳(단지명/저장값/쌍둥이값/거리/쌍둥이 신뢰도 신호).
 * 세대수·활성매물 열은 사람이 "이 쌍둥이를 믿어도 되는가"를 눈으로 바로 판단할 수 있게 한다
 * (신뢰도 게이트를 통과한 것만 여기 나오지만, 경계값 근처는 사람이 한 번 더 볼 가치가 있다).
 * @param {string} label
 * @param {ReturnType<typeof scanPollution>["targetsByField"][string]} rows
 */
function printReport(label, rows) {
  log(PHASE, `\n── [${label}] 정리 대상: ${rows.length}건 ──`);
  if (rows.length === 0) return;
  const sorted = [...rows].sort((a, b) => b.ratio - a.ratio); // 가장 심하게 어긋난 순
  const top = sorted.slice(0, 20);
  log(PHASE, `  단지명 | 저장값 | 쌍둥이값 | 거리(m) | 쌍둥이세대수 | 쌍둥이활성매물`);
  for (const r of top) {
    log(PHASE, `  ${r.name ?? "(이름없음)"} | ${r.storedValue} | ${r.twinValue} | ${Math.round(r.distanceM)}m | ${r.twinHousehold ?? "미상"} | ${r.twinActiveListings ?? 0}`);
  }
  if (rows.length > 20) log(PHASE, `  … 외 ${rows.length - 20}건 생략`);
}

/**
 * 판정 보류 사유별 집계 출력 — "판정 보류 N건" 한 줄로는 사람이 무엇 때문에 보류됐는지
 * 모른다. 세 사유(쌍둥이 부실=게이트b·쌍둥이 값 비타당=게이트d·배제후보가 더 가까움=게이트c)
 * 를 갈라 보인다.
 * @param {string} label
 * @param {{ twin_weak: number; twin_implausible: number; closer_excluded: number }} holds
 */
function printHoldReport(label, holds) {
  const total = holds.twin_weak + holds.twin_implausible + holds.closer_excluded;
  log(PHASE, `  [${label}] 판정 보류: ${total}건 (쌍둥이 부실 ${holds.twin_weak} · 쌍둥이 값 비타당 ${holds.twin_implausible} · 배제후보가 더 가까움 ${holds.closer_excluded})`);
}

export async function main() {
  const apply = process.argv.includes("--apply");
  log(PHASE, apply ? "=== 실행 모드 (--apply, 실제 UPDATE) ===" : "=== DRY-RUN 모드 (미리보기만, --apply 없이는 저장 안 함) ===");

  const sb = getMibuyangSupabase();

  const [apartments, complexes, activeCounts] = await Promise.all([fetchApartments(sb), fetchComplexes(sb), fetchActiveArticleCounts(sb)]);
  log(PHASE, `apartments: ${apartments.length}건, complexes: ${complexes.length}건, 활성매물 보유 단지: ${activeCounts.size}건 조회`);

  const spatialGrid = buildSpatialGrid(/** @type {any} */ (complexes));
  /** @type {Map<string, any>} */
  const complexByNo = new Map(complexes.map((c) => [c.complex_no, c]));

  const { targetsByField, holdsByField } = scanPollution(apartments, spatialGrid, complexByNo, activeCounts);

  let totalRows = 0;
  for (const spec of FIELD_SPECS) {
    printReport(spec.label, targetsByField[spec.key]);
    printHoldReport(spec.label, holdsByField[spec.key]);
    totalRows += targetsByField[spec.key].length;
  }

  // id 별로 지울 필드를 합친다 — 한 아파트가 여러 필드에서 동시에 걸릴 수 있음.
  /** @type {Map<string, { id: string; name: string | null; row: Record<string, unknown> }>} */
  const updatesById = new Map();
  for (const spec of FIELD_SPECS) {
    for (const t of targetsByField[spec.key]) {
      if (!updatesById.has(t.id)) updatesById.set(t.id, { id: t.id, name: t.name, row: {} });
      const entry = updatesById.get(t.id);
      if (entry) entry.row[spec.aptField] = null;
    }
  }
  const affectedApts = updatesById.size;

  log(PHASE, `\n=== 요약: 총 ${totalRows}건 오염(중복 apt 포함), 실제 영향 아파트 ${affectedApts}곳 ===`);

  if (totalRows === 0) {
    log(PHASE, "정리 대상 없음 — 종료");
    return;
  }

  if (!apply) {
    log(PHASE, "[DRY-RUN] 위 대상을 NULL 로 UPDATE 예정(실행 안 함). 실제 반영하려면 --apply 로 재실행");
    return;
  }

  const updates = [...updatesById.values()].map((u) => ({ id: u.id, name: u.name ?? "", row: { ...u.row, updated_at: new Date().toISOString() } }));
  const { ok, fail } = await flushUpdates(sb, updates, "오염정리");
  log(PHASE, `✅ 정리 완료 — 성공 ${ok}건 / 실패 ${fail}건`);
  if (fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트가 순수 함수만 import 할 수 있게)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ e) => {
    console.error(`[${PHASE}] 실패:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
