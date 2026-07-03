// @ts-check
/**
 * 수집기 감시 스크립트 (수집기 실패 텔레그램 알림 시스템).
 *
 * 5가지 이상을 점검해 발견 시 텔레그램으로 알린다:
 *   ① 실패/취소  — GitHub Actions run conclusion
 *   ② 데이터 0건 — collector_runs 의 ok/skip 모두 0
 *   ③ 미발화      — 마지막 run 이 35일+ 전 (월간 cron 1주기 초과)
 *   ④ NULL 급증   — regions 핵심 컬럼 + apartments 19 카테고리 NULL 비율 점검
 *   ⑤ 외부 API 장기 중단 — 최근 3회 success+ok=0 누적 + stale_days 초과 (silent fail)
 *
 * 모드:
 *   --mode=run    workflow_run 트리거 — 방금 끝난 run 1개만 (①②)
 *   --mode=daily  cron — 전체 스윕 (①②③④⑤)
 *
 * 필요 환경변수:
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — 알림 채널 (없으면 점검만, 전송 스킵)
 *   GITHUB_TOKEN                          — GitHub REST 인증 (Actions 기본 제공)
 *   GITHUB_REPOSITORY                     — "owner/repo" (Actions 기본 제공)
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY   — collector_runs / regions 조회
 */
import { loadEnv, getSupabase } from "./collectors/_shared.mjs";
import { computeAudit, fetchAllFromView } from "./collectors/data-audit.mjs";
import { sendTelegram, formatIssue, buildMessages, toKst, CONCLUSION_LABEL } from "./notify-telegram.mjs";
import { extractMonitoredWorkflows } from "./audit-monitor-coverage.mjs";

loadEnv();

/** 미발화 판정 임계 — 마지막 run 이 이 일수보다 오래되면 이상 (월간 cron 1주기+여유). */
const STALE_DAYS = 35;
/**
 * 분기 cron 워크플로 — STALE_DAYS=35 단순 비교로 false positive 발생 (분기 = 91 일 간격).
 * 본 화이트리스트에 박힌 워크플로는 QUARTERLY_STALE_DAYS(=100) 임계 적용.
 * 신규 분기 cron 워크플로 추가 시 이 배열에 workflow `name` 1 줄 박제 + monitor-collectors.test.mjs 회귀 답습.
 * 세션 292 박제: dart-builders + sale-price-index 2 개로 출발. sale-price-index 는 세션 289 에
 * kosis.kr 차단으로 GH yml 삭제 = 로컬 러너 이전 (EXTERNAL_API_COLLECTORS stale_days 100 이 감시 승계).
 */
export const QUARTERLY_CRON_WORKFLOWS = [
  "DART 시공사 재무 수집",
];
/** 분기 cron 미발화 판정 임계 — 91 일 1주기 + 9 일 여유. */
const QUARTERLY_STALE_DAYS = 100;
/** ③ 점검 대상 워크플로 목록 출처 — monitor.yml 자신의 workflow_run.workflows 배열. */
const MONITOR_YML_PATH = ".github/workflows/monitor-collectors.yml";
/** NULL 급증 판정 임계 — 핵심 컬럼 NULL 비율이 이 값을 넘으면 이상. */
const NULL_RATE_THRESHOLD = 0.4;
/** 이상 run 으로 보는 conclusion. */
const BAD_CONCLUSIONS = ["failure", "cancelled", "timed_out"];
/** ④ NULL 점검 대상 — regions 핵심 컬럼. */
const REGION_KEY_COLUMNS = ["net_migration", "housing_supply_level", "crime_grade", "doctors_per_1k", "hospital_beds_per_1k"];
/**
 * ④ apartments 19 카테고리 중 NULL 점검 대상 — 카테고리별 기대 최저 rate(%).
 * 현재 rate 가 이 값 아래로 떨어지면 수집기 고장 의심. 의도적 저율 카테고리
 * (benefits 수기입력 / maintenance·builders·future·energy 부분수집 / naver 로컬전용 /
 * regions VIEW측 미수집컬럼)는 점검 안 함 — 정상인데 매일 오탐 방지.
 * 값 출처: data-audit --json 실측(2026-05-17) - 안전 마진 15~20%p.
 */
export const AUDIT_CATEGORY_BASELINE = {
  core: 70,
  price: 75,
  building: 50,
  risk: 90,
  infra: 70,
  transport: 45,
  schools: 90,
  trade_stats: 75,
  environment: 65,
  competition: 45,
  air: 90,
  safety: 60,
};

/**
 * ④ NULL 점검에서 의도적으로 제외하는 카테고리 — 수기입력·부분수집·로컬전용.
 * AUDIT_CATEGORY_BASELINE(점검 12) + 이 배열(제외 7) = data-audit AUDIT_FIELDS
 * 19 카테고리 전체. 둘의 합집합 정합은 monitor-collectors.test.mjs 가 강제한다.
 * data-audit 에 카테고리 추가 시 둘 중 하나에 반드시 등재해야 테스트 통과.
 */
export const EXCLUDED_AUDIT_CATEGORIES = [
  "benefits", "maintenance", "builders", "energy", "future", "naver", "regions",
];

/**
 * ④ 알림 표시용 한글 라벨 — 카테고리(점검 대상 12개)·regions 컬럼.
 * data-audit 에는 라벨이 없어 알림 레이어에서만 한글화한다. 누락 시 영어 키 그대로.
 * @type {Record<string, string>}
 */
const KO_CATEGORY = {
  core: "기본정보",
  price: "분양가",
  building: "건물정보",
  risk: "규제·대출",
  infra: "생활인프라",
  transport: "교통",
  schools: "학군",
  trade_stats: "실거래 통계",
  environment: "주거환경",
  competition: "청약경쟁률",
  air: "대기질",
  safety: "안전·치안",
  // regions 핵심 컬럼 (checkNullSurge)
  net_migration: "순이동인구",
  crime_grade: "범죄안전등급",
  doctors_per_1k: "인구천명당 의사수",
  hospital_beds_per_1k: "인구천명당 병상수",
};

/**
 * ④ 알림 표시용 한글 라벨 — 점검 대상 12개 카테고리에 속한 필드.
 * 알림의 "채움률 낮은 필드" 목록에 쓰인다. 누락 시 영어 키 그대로.
 * @type {Record<string, string>}
 */
const KO_FIELD = {
  // core
  name: "단지명", region: "시도", gu: "시군구", dong: "읍면동", address: "지번주소",
  roadAddress: "도로명주소", district: "행정구역", lat: "위도", lng: "경도",
  builder: "시공사", units: "세대수", completion: "준공연도", layout: "평면구성",
  // price
  area: "공급면적", price: "분양가", pp: "평당가",
  // building
  maxFloor: "최고층", parkingRatio: "주차대수비", floorAreaRatio: "용적률",
  exclusiveRatio: "전용률", energyGrade: "에너지등급", heating: "난방방식",
  corridorType: "복도유형", heatFuel: "난방연료", avgMaintenanceCost: "평균관리비",
  primaryDirection: "주향", floors: "층수정보", hasPool: "수영장유무",
  // risk
  isRegulated: "규제지역여부", dsr40pass: "DSR40통과",
  // infra
  hospital: "병원수", mart: "마트수", conv: "편의점수", cafe: "카페수",
  culture: "문화시설수", bank: "은행수", pharmacy: "약국수", park: "공원수",
  hospitalDist: "병원거리", martDist: "마트거리", convDist: "편의점거리",
  cafeDist: "카페거리", cultureDist: "문화시설거리", bankDist: "은행거리",
  pharmacyDist: "약국거리", parkDist: "공원거리", nearbyFacilities: "주변시설",
  // transport
  subwayDist: "지하철거리", busRoutes: "버스노선수", icDist: "IC거리", ktxDist: "KTX거리",
  subwayName: "지하철역명", subwayLines: "지하철노선", busStopNames: "버스정류장명",
  // schools
  schoolScore: "학군점수", schoolGrade: "학군등급", nearbySchools: "주변학교",
  // trade_stats
  nearbyMedian: "주변실거래중위가", recentTrades6m: "최근6개월거래수",
  jeonseRate: "전세가율", pir: "PIR", psr: "PSR", avgFloor: "평균거래층",
  nearbyBuildYear: "주변연식", floorRange: "거래층범위", priceByArea: "면적별매매가",
  rentByArea: "면적별월세", jeonseByArea: "면적별전세가", priceByFloor: "층별매매가",
  cancelRatio6m: "최근6개월해제율",
  // environment
  view: "조망", sunlight: "일조", noise: "소음", noxious: "유해시설", noxiousDist: "유해시설거리",
  // competition
  competitionRate: "청약경쟁률", competitionSupply: "공급세대", competitionApplicants: "청약자수",
  // air
  airQuality: "대기질지수",
  // safety
  crimeSafetyGrade: "범죄안전등급", emergency: "응급의료시설", emergencyDist: "응급의료시설거리",
  emergencyName: "응급의료시설명", emergencyType: "응급의료시설종류",
};

/**
 * @typedef {object} Issue
 * @property {"fail"|"empty"|"stale"|"nulls"|"outage"} kind
 * @property {string} collector
 * @property {string} detail 한 줄 요약 (콘솔 로그·하위호환용)
 * @property {"failure"|"cancelled"|"timed_out"} [conclusion] fail 일 때만 — 워크플로 conclusion
 * @property {string} [url]
 * @property {string[]} [lines] 본문에 펼칠 상세 줄 (점검 함수가 만든 사람 말 문장)
 * @property {string} [at] 이슈 발생 ISO 시각 (formatIssue 가 KST 로 변환)
 */

/**
 * ⑤ 점검 대상 외부 API 의존 collector — silent fail (status=success + ok_count=0 + skip_count=0)
 * 누적 탐지 + 미발화 (최신 행이 stale_days 초과 = 안 돌고 있음) 탐지.
 * 컬럼 진실의 원천 = collector_runs.collector (NOT phase). ⚠️ collector 키는 각 .mjs 의
 * recordCollectorRun 첫 인자와 정확히 일치해야 함 — 대부분 PHASE 상수이나 일부(transport-tago 등)는
 * 리터럴을 따로 박으니 PHASE 값과 다를 수 있음. 신규/수정 시 recordCollectorRun 인자 직독 의무
 * (세션 439: "transport" 라벨 ≠ 기록명 "transport-tago" 드리프트로 ⑤ 영구 무력 사고).
 * stale_days = 해당 collector cron 주기 + 1주 여유 (일일=14, 월간=38, 분기=100). NEIS schools = incremental yml 매일 발화 + 월간 collect-schools.yml 자매 = 14 (세션 339 정정, 세션 338 3주 cancelled 사고가 35일 한계 안에 묻힌 진앙 해소).
 * ⚠️ 월간 cron 에 14 를 박으면 ⑤-b 미발화 분기가 발화일+14일부터 다음 발화까지 매일 거짓 경보 + continue 로 진짜 outage 판정까지 가림 (세션 463 정정: housing-permits·building-hub 14→38).
 * 신규 외부 API collector 추가 시 이 배열 1줄 박힘 + checkExternalApiStale 회귀 답습 의무.
 */
export const EXTERNAL_API_COLLECTORS = [
  { collector: "housing-permits", stale_days: 38, owner: "MOLIT 주택건설실적 (월 10일 cron + 1주 여유)" },
  { collector: "building-hub",    stale_days: 38, owner: "MOLIT 건축물대장 허브 (월 15일 cron + 1주 여유)" },
  { collector: "transport-tago",  stale_days: 14, owner: "TAGO 대중교통" },
  { collector: "schools",         stale_days: 14, owner: "NEIS 학교정보" },
  { collector: "applyhome-detail", stale_days: 38, owner: "청약홈 분양일정·평형 (월 13일 cron + 1주 여유)" },
  // applyhome-seed: ok=신규 등록 수 — 신규 공고 0건 주간 3연속이면 ⑤-a "빈 성공" 경보 가능(주평균 ~7건이라
  //   드묾). 발화해도 "신규 무순위 3주째 0" 자체가 유의미 신호라 수용 (세션 466 plan 명시).
  { collector: "applyhome-seed",   stale_days: 14, owner: "청약홈 무순위 신규 ah-* seeding (주간 월 cron)" },
  // maintenance = 국토부 공동주택 관리비 (collect-maintenance.yml, 월 15~19일 5일 연속 cron — 세션 450). cancelled
  //   run 은 recordCollectorRun 전에 죽어 collector_runs 행 0건 → ③ 워크플로 점검은 GH created_at 으로 "신선" 마스킹.
  //   ⑤-b 미발화 분기(collector_runs.finished_at 기준)가 유일하게 "데이터 N일 stale" 을 잡음 (세션 447).
  //   5일 연속이라도 한 묶음 발화(19일 success→다음달 15일 발화 ~26일 간격)라 stale_days:38(=31일+1주)은 적정.
  { collector: "maintenance",      stale_days: 38, owner: "국토부 공동주택 관리비 (월 15~19일 cron + 1주 여유)" },
  // ── KOSIS 10종 = 집서버 로컬 러너 수집기 (kosis-local-runner.mjs, 매일 05:30 KST 일자 디스패치).
  //    kosis.kr 해외 IP 차단으로 GH collect-*.yml 10개 삭제 (세션 288~289) — GH run 이 없어
  //    ③ 워크플로 미발화 점검 대상에서 빠지므로 collector_runs 신선도가 유일한 "안 돌면 알림".
  //    월간 38 = 31일 주기 + 1주 여유 / sale-price 분기 100 = QUARTERLY_STALE_DAYS 답습.
  { collector: "kosis-housing-supply-ratio", stale_days: 38,  owner: "KOSIS 주택보급률 (로컬 매월 2일)" },
  { collector: "market-stats",               stale_days: 38,  owner: "KOSIS 시장통계 (로컬 매월 6일)" },
  { collector: "migration",                  stale_days: 38,  owner: "KOSIS 순이동 (로컬 매월 7일)" },
  { collector: "kosis-unsold",               stale_days: 38,  owner: "KOSIS 미분양 (로컬 매월 9일)" },
  { collector: "kosis-fertility-rate",       stale_days: 38,  owner: "KOSIS 출산율 (로컬 매월 10일)" },
  { collector: "kosis-regional-economy",     stale_days: 38,  owner: "KOSIS 지역경제 (로컬 매월 12일)" },
  { collector: "avg-income",                 stale_days: 38,  owner: "KOSIS 평균소득 (로컬 매월 13일)" },
  { collector: "kosis-medical-access",       stale_days: 38,  owner: "KOSIS 의료접근성 (로컬 매월 14일)" },
  { collector: "kosis-sale-price-index",     stale_days: 100, owner: "KOSIS 매매가격지수 (로컬 1·4·7·10월 17일)" },
  { collector: "kosis-jeonse-price-index",   stale_days: 38,  owner: "KOSIS 전세가격지수 (로컬 매월 18일)" },
  // ── childcare 3종 = 집서버 로컬 러너 수집기 (childcare-local-runner.mjs, 매일 04:30 KST 전부 실행).
  //    api.childcare.go.kr 해외 IP 차단으로 GH collect-childcare-detail/jeju.yml 삭제 +
  //    collect-childcare.yml info step 제거 (세션 399) — GH run 이 없어 collector_runs 신선도가
  //    유일한 "안 돌면 알림". 매일 발화 = 14 (1주 여유).
  { collector: "childcare-detail",     stale_days: 14, owner: "어린이집 상세 cpmsapi030 (로컬 매일)" },
  { collector: "childcare-info",       stale_days: 14, owner: "어린이집 정보 cpmsapi021 (로컬 매일)" },
  { collector: "childcare-info-jeju",  stale_days: 14, owner: "제주 어린이집 cpmsapi017 (로컬 매일)" },
];

/** ⑤ 외부 API 장기 중단 판정 — 최근 N회 연속 success+ok=0 = silent fail 의심. */
const OUTAGE_MIN_CONSECUTIVE = 3;

/**
 * ⑥ VIEW 회귀 점검 대상 — apartments_flat VIEW 노출 컬럼(camelCase viewKey) ↔ regions 원본(snake_case).
 * regions 를 여러 collector 가 나눠 채우고 VIEW latest_regions 가 그 컬럼을 노출하는 경우만 등재.
 * net_migration = migration.mjs(후행) 가 population 새 행을 못 채우면 VIEW NULL (세션 391 회귀).
 * 신규 multi-collector regions 컬럼이 VIEW 에 노출되고 새 recorded_at 행을 후행 collector 가
 * 채우는 구조면 이 배열에 1줄 추가 의무. regionColumn 은 REGION_KEY_COLUMNS 에도 있어야 조회됨.
 * @type {Array<{ viewKey: string, regionColumn: string, label: string }>}
 */
export const VIEW_REGION_STALE_TARGETS = [
  { viewKey: "regions.netMigration", regionColumn: "net_migration", label: "순이동 (migration)" },
  { viewKey: "regions.housingSupplyLevel", regionColumn: "housing_supply_level", label: "주택보급률 (KOSIS)" },
];

// ── 알림 dedup (텔레그램 스팸 차단) ──────────────
// monitor 는 workflow_run(수집기 ~40개 완료마다) + 매일 cron 으로 발화 → dedup 없으면
// 같은 stale 이슈(예: housing-permits 5/26 0건)를 매번 재알림. 안정 키로 1회만 발송.

/**
 * 이슈의 안정 dedup 키. 같은 사실(같은 kind·collector·발생시각)은 같은 키 → 1회만 알림.
 * at(발생 ISO 시각)이 핵심: 같은 stale 행은 at 불변이라 같은 키, 새 run(at 변경)이 다시 0건이면 새 키.
 * at 없는 이슈(nulls 등)는 kind|collector 만으로 dedup(하루 단위 daily 스윕이라 충분).
 * @param {Issue} issue
 * @returns {string}
 */
export function dedupKey(issue) {
  return `${issue.kind}|${issue.collector}|${issue.at ?? ""}`;
}

/**
 * 이미 발송한 키(sentKeys)에 없는 이슈만 남긴다. 새 이슈(미발송)만 반환.
 * @param {Issue[]} issues
 * @param {Set<string>} sentKeys 이미 보낸 dedupKey 집합
 * @returns {Issue[]}
 */
export function filterUnsent(issues, sentKeys) {
  return issues.filter((i) => !sentKeys.has(dedupKey(i)));
}

// ── 순수 점검 함수 (fake 데이터로 테스트 가능) ──────────────

/**
 * ① GitHub Actions run 목록에서 실패/취소를 찾는다.
 * @param {Array<{ name?: string, conclusion?: string|null, status?: string, html_url?: string, created_at?: string }>} runs
 * @param {string[]} [allowedNames] 주면 이 목록(monitor.yml 감시 대상)에 든
 *   워크플로만 점검 — CI 등 비-수집기 실패를 "수집기 실패" 로 오인하지 않음.
 *   미지정 시 전체 점검 (하위호환).
 * @returns {Issue[]}
 */
export function checkFailedRuns(runs, allowedNames) {
  /** @type {Issue[]} */
  const issues = [];
  const allowSet = allowedNames ? new Set(allowedNames) : null;
  for (const run of runs) {
    if (run.status !== "completed") continue;
    if (!run.conclusion || !BAD_CONCLUSIONS.includes(run.conclusion)) continue;
    if (allowSet && !(run.name && allowSet.has(run.name))) continue;
    issues.push({
      kind: "fail",
      collector: run.name ?? "(이름 없음)",
      conclusion: /** @type {"failure"|"cancelled"|"timed_out"} */ (run.conclusion),
      detail: `워크플로 실행이 ${/** @type {any} */ (CONCLUSION_LABEL)[run.conclusion] ?? run.conclusion} 상태로 끝났습니다.`,
      url: run.html_url,
      at: run.created_at,
    });
  }
  return issues;
}

/**
 * ② collector_runs 행에서 데이터 0건 수집을 찾는다.
 * status 가 success 인데 ok·skip 모두 0 이면 "성공처럼 보이지만 빈손".
 * @param {Array<{ collector?: string, status?: string, ok_count?: number|null, skip_count?: number|null, fail_count?: number|null, finished_at?: string|null }>} rows
 * @param {Record<string, { okCount: number, finishedAt: string }>} [prevByCollector]
 *   수집기별 직전 정상 실행(ok>0). 있으면 "지난번엔 N건" 비교 문장을 만든다.
 * @param {{ maxAgeHours?: number, now?: Date, externalApiCollectors?: Set<string> }} [opts]
 *   maxAgeHours 주면 최신 0건 행이 그보다 오래됐을 때 ② 에서 제외(→ ⑤ checkExternalApiStale 또는 ③ stale 이 단독 처리).
 *   외부 API 장기 중단(housing-permits 식)으로 새 run 자체가 없는 stale 0건 행을 매번 ② 로 재알림하던 스팸 차단.
 *   externalApiCollectors 주면 그 집합에 든 collector 의 0건은 ② 에서 제외 — 외부 API 의존 수집기
 *   (housing-permits·KOSIS 식)는 "데이터 부재가 정상"이라 0건이 흔하고, 진짜 장기 중단은 ⑤
 *   (checkExternalApiStale)가 stale_days 임계로 단독 판정한다. 둘 다 울리면 매일 중복 노이즈
 *   (세션 444: 운영 daily 가 housing-permits·kosis 2종을 정상 0건인데 매일 ② 로 알림하던 사고).
 *   미지정 시 나이 무관 전부 점검(하위호환 — 기존 daily 동작).
 * @returns {Issue[]}
 */
export function checkEmptyRuns(rows, prevByCollector = {}, opts = {}) {
  const { maxAgeHours, now = new Date(), externalApiCollectors } = opts;
  /** @type {Issue[]} */
  const issues = [];
  for (const row of rows) {
    if (row.status !== "success") continue;
    const ok = row.ok_count ?? 0;
    const skip = row.skip_count ?? 0;
    if (ok === 0 && skip === 0) {
      const name = row.collector ?? "(이름 없음)";
      // 외부 API 의존 수집기는 0건이 정상(데이터 부재). 진짜 장기 중단은 ⑤가 단독 판정 → ② 제외.
      if (externalApiCollectors && externalApiCollectors.has(name)) continue;
      // 신선도 가드: 최신 0건 행이 너무 오래됐으면 ② 가 매번 재알림하지 않도록 제외.
      if (maxAgeHours != null && row.finished_at) {
        const ageH = Math.max(0, (now.getTime() - new Date(row.finished_at).getTime()) / 3600000);
        if (ageH > maxAgeHours) continue;
      }
      const fail = row.fail_count ?? 0;
      /** @type {string[]} */
      const lines = [
        `이번 실행은 success 로 끝났지만 처리 건수가 0건입니다 (성공 ${ok} · 건너뜀 ${skip} · 실패 ${fail}).`,
      ];
      const prev = prevByCollector[name];
      if (prev) {
        const when = toKst(prev.finishedAt);
        lines.push(
          `지난 정상 실행${when ? `(${when})` : ""}에서는 ${prev.okCount}건을 처리했는데, 이번엔 0건입니다.`,
        );
      }
      issues.push({
        kind: "empty",
        collector: name,
        detail: `success 인데 처리 0건 (ok ${ok} · skip ${skip} · fail ${fail})`,
        lines,
        at: row.finished_at ?? undefined,
      });
    }
  }
  return issues;
}

/**
 * ③ 워크플로별 마지막 run 시각에서 미발화를 찾는다.
 * @param {Array<{ name: string, lastRunAt: string|null, createdAt?: string|null }>} workflows
 *   createdAt = 워크플로 파일 생성일. lastRunAt=null 이어도 생성이 35일 이내면
 *   첫 cron 대기 중인 신규 워크플로 → 미발화 아님 (오탐 차단).
 * @param {Date} now 기준 시각 (테스트 주입용)
 * @returns {Issue[]}
 */
export function checkStaleWorkflows(workflows, now = new Date()) {
  /** @type {Issue[]} */
  const issues = [];
  for (const wf of workflows) {
    // 분기 cron 워크플로면 100일 임계, 그 외 35일 임계 (분기 cron false positive 차단, 세션 292).
    const isQuarterly = QUARTERLY_CRON_WORKFLOWS.includes(wf.name);
    const threshold = isQuarterly ? QUARTERLY_STALE_DAYS : STALE_DAYS;
    if (!wf.lastRunAt) {
      // 신규 워크플로 — 생성 임계 이내면 첫 cron 아직, 미발화 아님.
      if (wf.createdAt) {
        const sinceCreated = Math.max(0, (now.getTime() - new Date(wf.createdAt).getTime()) / 86400000);
        if (sinceCreated <= threshold) continue;
      }
      issues.push({ kind: "stale", collector: wf.name, detail: "실행 기록이 한 번도 없음" });
      continue;
    }
    const ageDays = Math.max(0, (now.getTime() - new Date(wf.lastRunAt).getTime()) / 86400000);
    if (ageDays > threshold) {
      const cycleLabel = isQuarterly ? "분기 cron 1주기" : "월간 cron 1주기";
      issues.push({
        kind: "stale",
        collector: wf.name,
        detail: `마지막 실행이 ${Math.floor(ageDays)}일 전입니다 (${threshold}일 초과 — ${cycleLabel}를 넘김).`,
        at: wf.lastRunAt,
      });
    }
  }
  return issues;
}

/**
 * ③ 점검 대상 집합 + run 시각을 병합해 checkStaleWorkflows 입력을 만든다.
 * 점검 대상은 "최근에 돈 워크플로"가 아니라 monitor.yml 이 감시하는 전체 집합이라,
 * 월간 워크플로가 오래 죽어 최근 run 에서 사라져도 lastRunAt=null 로 남아 stale 로 잡힌다.
 * @param {string[]} monitoredNames monitor.yml workflow_run.workflows 배열
 * @param {Array<{ name?: string, created_at?: string }>} recentRuns fetchRecentRuns 결과
 * @param {Record<string, string>} supplement fetchLastRunForWorkflows 결과 (누락분 보충)
 * @param {Record<string, string>} [createdAtByWf] 워크플로 생성일 맵 (신규 워크플로 오탐 차단)
 * @returns {Array<{ name: string, lastRunAt: string|null, createdAt: string|null }>}
 */
export function buildStaleCheckList(monitoredNames, recentRuns, supplement, createdAtByWf = {}) {
  /** @type {Map<string, string>} */
  const lastRunByWf = new Map();
  for (const run of recentRuns) {
    if (run.name && run.created_at && !lastRunByWf.has(run.name)) {
      lastRunByWf.set(run.name, run.created_at);
    }
  }
  return monitoredNames.map((name) => ({
    name,
    lastRunAt: lastRunByWf.get(name) ?? supplement[name] ?? null,
    createdAt: createdAtByWf[name] ?? null,
  }));
}

/**
 * ④ 컬럼별 (total, filled) 카운트에서 NULL 급증을 찾는다.
 * @param {Array<{ column: string, total: number, filled: number }>} columnStats
 * @returns {Issue[]}
 */
export function checkNullSurge(columnStats) {
  /** @type {Issue[]} */
  const issues = [];
  for (const stat of columnStats) {
    if (stat.total === 0) continue;
    const nullRate = (stat.total - stat.filled) / stat.total;
    if (nullRate > NULL_RATE_THRESHOLD) {
      const ko = KO_CATEGORY[stat.column];
      const label = ko ? `${ko} (regions.${stat.column})` : `regions.${stat.column}`;
      issues.push({
        kind: "nulls",
        collector: label,
        detail: `NULL ${(nullRate * 100).toFixed(0)}% (${stat.total - stat.filled}/${stat.total}) — 임계 ${(NULL_RATE_THRESHOLD * 100).toFixed(0)}% 초과`,
      });
    }
  }
  return issues;
}

/** ④ 필드별 상세 줄에 담을 최대 필드 수 (채움률 낮은 순). */
const NULL_DETAIL_FIELD_LIMIT = 6;

/**
 * ④ data-audit 카테고리 통계에서 NULL 급증을 찾는다.
 * baseline 에 등재된 카테고리만 점검하고, rate 가 기대 최저값 아래면 이상.
 * fields 가 주어지면 그 카테고리의 필드별 채움률을 상세 줄로 펼친다.
 * @param {Record<string, { collector: string, filled: number, total: number, rate: number }>} categories
 * @param {Record<string, number>} baseline 카테고리별 기대 최저 rate(%)
 * @param {Record<string, { category: string, field: string, filled: number, missing: number }>} [fields]
 *   data-audit computeAudit().fields — 필드별 채움/누락 수
 * @returns {Issue[]}
 */
export function checkCategoryNullSurge(categories, baseline, fields = {}) {
  /** @type {Issue[]} */
  const issues = [];
  for (const [cat, minRate] of Object.entries(baseline)) {
    const stat = categories[cat];
    if (!stat || stat.total === 0) continue;
    if (stat.rate >= minRate) continue;

    // 이 카테고리에 속한 필드별 채움률 — 낮은 순 정렬
    const catFields = Object.values(fields)
      .filter((f) => f.category === cat)
      .map((f) => {
        const fieldTotal = f.filled + f.missing;
        const fieldRate = fieldTotal > 0 ? Math.round((f.filled / fieldTotal) * 1000) / 10 : 0;
        return { field: f.field, filled: f.filled, total: fieldTotal, rate: fieldRate };
      })
      .sort((a, b) => a.rate - b.rate);

    /** @type {string[]} */
    const lines = [];
    if (catFields.length > 0) {
      lines.push(`이 항목은 ${catFields.length}개 세부 데이터로 이뤄집니다. 채움률이 낮은 것:`);
      for (const f of catFields.slice(0, NULL_DETAIL_FIELD_LIMIT)) {
        const koField = KO_FIELD[f.field] ?? f.field;
        lines.push(`  · ${koField} ${f.rate}% (${f.filled}/${f.total})`);
      }
    }

    const koCat = KO_CATEGORY[cat] ?? cat;
    issues.push({
      kind: "nulls",
      collector: `${koCat} (${stat.collector})`,
      detail: `전체 채움률 ${stat.rate}% (${stat.filled}/${stat.total}) — 기대 최저 ${minRate}% 미달`,
      lines,
    });
  }
  return issues;
}

/**
 * ⑤ 외부 API 의존 collector 의 "정상 실행 + 데이터 갱신 0건 연속 N회" 탐지.
 * collector_runs 컬럼 진실의 원천 = `collector` (NOT phase). status=success 인데
 * ok_count=0 행이 OUTAGE_MIN_CONSECUTIVE 회 누적되면 외부 API 장기 중단 의심.
 *
 * checkEmptyRuns 와의 차이:
 *   - checkEmptyRuns: 최신 1행만 점검 (단발 0건 = 즉시 알림)
 *   - checkExternalApiStale: 최근 N행 모두 ok=0 + 첫 ok=0 시각 stale_days 초과 시만 알림
 *     (housing-permits 식 silent partial 누적을 잡되 단발 0건 오탐은 ②가 잡으니 중복 회피)
 *
 * @param {Array<{ collector: string, stale_days: number, owner: string }>} targets
 * @param {Record<string, Array<{ status?: string, ok_count?: number|null, skip_count?: number|null, finished_at?: string|null }>>} runsByCollector
 *   collector 별 최근 N행 (finished_at DESC). 빈 배열이면 점검 skip.
 * @param {Date} [now] 기준 시각 (테스트 주입용).
 * @returns {Issue[]}
 */
export function checkExternalApiStale(targets, runsByCollector, now = new Date()) {
  /** @type {Issue[]} */
  const issues = [];
  for (const { collector, stale_days, owner } of targets) {
    const rows = runsByCollector[collector] ?? [];
    if (rows.length < OUTAGE_MIN_CONSECUTIVE) continue; // 신규 collector 오탐 차단

    // ⑤-b 미발화 — 최신 행이 stale_days 초과 = collector 가 안 돌고 있음.
    //    GH yml 없는 로컬 러너 수집기(KOSIS 10종)는 ③ 워크플로 점검 대상 밖이라
    //    이 분기가 유일한 "안 돌면 알림" (세션 289 — 작업 비활성·로그인 안 됨·드라이브 미마운트 무음 차단).
    const latest = rows[0];
    if (latest.finished_at) {
      const idleDays = Math.max(0, (now.getTime() - new Date(latest.finished_at).getTime()) / 86400000);
      if (idleDays > stale_days) {
        issues.push({
          kind: "stale",
          collector,
          detail: `${owner} 마지막 실행 ${Math.floor(idleDays)}일 전 — ${stale_days}일 주기 초과 (미발화 의심)`,
          lines: [
            `최근 collector_runs 행: ${toKst(latest.finished_at) ?? latest.finished_at} — ${stale_days}일 주기를 넘겼습니다.`,
            `[조치 1] 집서버 작업 확인 — schtasks /query /tn MibunyangKosisLocal (로컬 러너 수집기인 경우)`,
            `[조치 2] 수동 보충 실행 — node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD`,
          ],
          at: latest.finished_at,
        });
        continue; // 미발화면 아래 outage 판정은 같은 원인 이중 알림 — skip
      }
    }

    const recent = rows.slice(0, OUTAGE_MIN_CONSECUTIVE);
    // success 인데 ok=0 & skip=0 만 점검 — failure 는 ①, 단발 0건은 ②가 잡음.
    // skip>0 = 원천 정상 응답 + 변경분만 0 (연간 통계 수집기 fertility 등 평상시 ok=0·skip>0) → outage 아님 (세션 289).
    const allEmptySuccess = recent.every(
      (r) => r.status === "success" && (r.ok_count ?? 0) === 0 && (r.skip_count ?? 0) === 0,
    );
    if (!allEmptySuccess) continue;
    // 첫 ok=0 시각 = 외부 API 장애 시작 추정 시각
    const oldest = recent[recent.length - 1];
    if (!oldest.finished_at) continue;
    const daysSince = Math.max(0, (now.getTime() - new Date(oldest.finished_at).getTime()) / 86400000);
    if (daysSince <= stale_days) continue;
    const days = Math.floor(daysSince);
    issues.push({
      kind: "outage",
      collector,
      detail: `${owner} API ${days}일+ 정상실행+0건 (${OUTAGE_MIN_CONSECUTIVE}회 연속) — 외부 API 장기 중단 의심`,
      lines: [
        `최근 ${OUTAGE_MIN_CONSECUTIVE}회 collector_runs 모두 status=success / ok_count=0 입니다.`,
        `첫 이상 발화: ${toKst(oldest.finished_at) ?? oldest.finished_at} — 외부 ${owner} API 장애 시작 추정.`,
        `[조치 1] raw API 1회 호출 (curl) — 500/503/타임아웃 확인`,
        `[조치 2] ${owner} 공식 공지 grep — "점검"/"장애" 키워드`,
        `[조치 3] 의심 확정 시 BACKLOG.md "외부 API 사고" 1줄 박힘`,
      ],
      at: oldest.finished_at,
    });
  }
  return issues;
}

/**
 * ⑥ VIEW 회귀 — regions 원본엔 채워졌는데 apartments_flat VIEW 노출 컬럼은 NULL.
 *
 * 진앙 패턴 (세션 391): population(매월 5일)이 net_migration 없는 새 recorded_at 행을
 * INSERT → migration(후행 collector)이 그 행을 못 채움 → VIEW latest_regions CTE 가
 * 최신 recorded_at 행을 골라 NULL 노출. "regions 원본 채움률 ≥ 임계 인데 VIEW 채움률 ≈ 0"
 * = 멀티 collector 새-recorded_at-행 lag 회귀 신호.
 *
 * @param {Record<string, { filled: number, missing: number }>} viewFields
 *   computeAudit 의 fields — key 예: "regions.netMigration". VIEW(apartments_flat) 기준 채움.
 * @param {Array<{ column: string, total: number, filled: number }>} regionStats
 *   fetchRegionColumnStats — regions 원본 테이블 컬럼별 채움 (column = snake_case).
 * @param {Array<{ viewKey: string, regionColumn: string, label: string }>} [targets]
 * @returns {Issue[]}
 */
export function checkViewRegionStale(viewFields, regionStats, targets = VIEW_REGION_STALE_TARGETS) {
  /** @type {Issue[]} */
  const issues = [];
  const regionByCol = new Map(regionStats.map((s) => [s.column, s]));
  for (const { viewKey, regionColumn, label } of targets) {
    const vf = viewFields[viewKey];
    const rs = regionByCol.get(regionColumn);
    if (!vf || !rs) continue;
    const viewTotal = vf.filled + vf.missing;
    if (viewTotal === 0 || (rs.total ?? 0) === 0) continue;
    const viewRate = vf.filled / viewTotal;
    const regionRate = rs.filled / rs.total;
    // 원본은 충분히 채워졌는데(≥20%) VIEW 는 거의 비었으면(≤5%) = VIEW 가 옛 채움값을
    // 못 가져오는 회귀. supply_ratio 처럼 원본부터 0인 경우는 regionRate 가 낮아 제외됨.
    if (regionRate >= 0.2 && viewRate <= 0.05) {
      issues.push({
        kind: "nulls",
        collector: label,
        detail: `${label} VIEW 채움 ${(viewRate * 100).toFixed(1)}% 인데 regions 원본 ${(regionRate * 100).toFixed(1)}% — VIEW latest_regions 최신행 미커버 회귀 의심`,
        lines: [
          `apartments_flat.${viewKey} 채움 ${vf.filled}/${viewTotal} 인데 regions.${regionColumn} 원본은 ${rs.filled}/${rs.total} 채워짐.`,
          `진앙 추정 = population 이 만든 새 recorded_at 행을 ${label} collector 가 못 채움 (세션 391 패턴).`,
          `[조치 1] 해당 collector 운영 1회 실행 → VIEW 회복 확인`,
          `[조치 2] VIEW latest_regions 가 컬럼별 최신 non-null 인지 확인 (20260609000000 마이그)`,
        ],
      });
    }
  }
  return issues;
}

// ── I/O 래퍼 (실제 API·DB 호출) ─────────────────────────────

/**
 * GitHub Actions REST(actions/runs·workflows)를 호출할 인증이 있는지 — Actions 러너는
 * GITHUB_REPOSITORY/GITHUB_TOKEN 을 기본 주입하지만 로컬 PC 에는 없다. 둘 다 있어야
 * ①실패·③미발화 점검이 의미 있다(없으면 빈 결과 → 전 워크플로 미발화 오탐).
 * @returns {boolean}
 */
export function hasGithubApiAuth() {
  return Boolean(process.env.GITHUB_REPOSITORY && process.env.GITHUB_TOKEN);
}

/**
 * GitHub REST 로 최근 워크플로 run 목록을 가져온다.
 * @param {number} perPage
 * @returns {Promise<any[]>}
 */
async function fetchRecentRuns(perPage = 50) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return [];
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs?per_page=${perPage}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  // 조용히 [] 반환 금지 — 403(권한 누락) 을 "실행 0건" 으로 오판해 미발화 오탐 발생.
  if (!res.ok) {
    throw new Error(`GitHub API /actions/runs ${res.status} — actions:read 권한 확인`);
  }
  const json = /** @type {{ workflow_runs?: any[] }} */ (await res.json());
  return json.workflow_runs ?? [];
}

/**
 * monitor.yml 의 workflow_run.workflows 배열(③ 점검 대상 전체)을 읽는다.
 * 파일 읽기·파싱 실패 시 빈 배열 — 점검을 막지 않는 안전 degrade.
 * @returns {Promise<string[]>}
 */
async function fetchMonitoredWorkflowNames() {
  try {
    const { readFile } = await import("node:fs/promises");
    return extractMonitoredWorkflows(await readFile(MONITOR_YML_PATH, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * 최근 run 목록에 흔적이 없는 워크플로의 마지막 run 시각을 개별 조회한다.
 * 워크플로 id 매핑 1회 + 누락 이름별 runs?per_page=1 호출. run 0건이면 결과에서 누락.
 * @param {string[]} names 보충 조회할 워크플로 name 목록
 * @returns {Promise<Record<string, string>>} name → 마지막 run created_at
 */
async function fetchLastRunForWorkflows(names) {
  if (names.length === 0) return {};
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return {};
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  // name → workflow id 매핑 (1회)
  const wfRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows?per_page=100`,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  // 조용히 {} 반환 금지 — 403 을 "전 워크플로 미발화" 로 오판 (세션 271 사고).
  if (!wfRes.ok) {
    throw new Error(`GitHub API /actions/workflows ${wfRes.status} — actions:read 권한 확인`);
  }
  const wfJson = /** @type {{ workflows?: Array<{ id: number, name: string }> }} */ (
    await wfRes.json()
  );
  /** @type {Map<string, number>} */
  const idByName = new Map();
  for (const wf of wfJson.workflows ?? []) idByName.set(wf.name, wf.id);

  /** @type {Record<string, string>} */
  const result = {};
  for (const name of names) {
    const id = idByName.get(name);
    if (id === undefined) continue; // 워크플로 자체가 없음 → null 로 남음
    const runRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${id}/runs?per_page=1`,
      { headers, signal: AbortSignal.timeout(20000) },
    );
    // HTTP 에러는 throw — continue 로 삼키면 그 워크플로가 미발화로 오판된다.
    // (워크플로가 진짜 run 0건이면 200 + workflow_runs:[] 이라 아래에서 정상 처리)
    if (!runRes.ok) {
      throw new Error(`GitHub API /workflows/${id}/runs ${runRes.status} — actions:read 권한 확인`);
    }
    const runJson = /** @type {{ workflow_runs?: Array<{ created_at?: string }> }} */ (
      await runRes.json()
    );
    const last = (runJson.workflow_runs ?? [])[0];
    if (last?.created_at) result[name] = last.created_at;
  }
  return result;
}

/**
 * 워크플로별 파일 생성일(created_at)을 조회한다.
 * 신규 워크플로(첫 cron 대기 중)를 미발화 오탐에서 제외하는 데 쓴다.
 * @returns {Promise<Record<string, string>>} name → 워크플로 created_at
 */
async function fetchWorkflowCreatedAt() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return {};
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows?per_page=100`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20000),
    },
  );
  // 조용히 {} 반환 금지 — 403 을 "전 워크플로 신규 아님" 으로 오판 (세션 271 사고).
  if (!res.ok) {
    throw new Error(`GitHub API /actions/workflows ${res.status} — actions:read 권한 확인`);
  }
  const json = /** @type {{ workflows?: Array<{ name: string, created_at: string }> }} */ (
    await res.json()
  );
  /** @type {Record<string, string>} */
  const result = {};
  for (const wf of json.workflows ?? []) result[wf.name] = wf.created_at;
  return result;
}

/**
 * regions 핵심 컬럼별 (total, filled) 을 조회한다.
 * @returns {Promise<Array<{ column: string, total: number, filled: number }>>}
 */
async function fetchRegionColumnStats() {
  const sb = getSupabase();
  const { count: total } = await sb.from("regions").select("*", { count: "exact", head: true });
  /** @type {Array<{ column: string, total: number, filled: number }>} */
  const stats = [];
  for (const col of REGION_KEY_COLUMNS) {
    const { count: filled } = await sb
      .from("regions")
      .select(col, { count: "exact", head: true })
      .not(col, "is", null);
    stats.push({ column: col, total: total ?? 0, filled: filled ?? 0 });
  }
  return stats;
}

/**
 * collector_runs 에서 수집기별 최근 1행과 직전 정상 실행(ok>0)을 가져온다.
 * 같은 300행 안에서 둘 다 뽑으므로 추가 쿼리는 없다.
 * @returns {Promise<{ latest: any[], prevOk: Record<string, { okCount: number, finishedAt: string }> }>}
 */
async function fetchLatestCollectorRuns() {
  const sb = getSupabase();
  const { data } = await sb
    .from("collector_runs")
    .select("collector,status,ok_count,skip_count,fail_count,finished_at")
    .order("finished_at", { ascending: false })
    .limit(300);
  const rows = data ?? [];
  /** @type {Map<string, any>} */
  const latest = new Map();
  /** @type {Record<string, { okCount: number, finishedAt: string }>} */
  const prevOk = {};
  for (const row of rows) {
    if (!latest.has(row.collector)) {
      latest.set(row.collector, row);
      continue; // 최신 행은 비교 대상이 아니라 점검 대상
    }
    // 최신 행 이후의 행 중 ok>0 인 첫 행 = 직전 정상 실행
    if (!prevOk[row.collector] && (row.ok_count ?? 0) > 0) {
      prevOk[row.collector] = { okCount: row.ok_count, finishedAt: row.finished_at };
    }
  }
  return { latest: [...latest.values()], prevOk };
}

/**
 * ⑤ 외부 API collector 별 최근 N행을 collector_runs 에서 가져온다.
 * collector 별 개별 쿼리 (Promise.all) — 전역 최신순 IN 쿼리 + limit 은 빈발 collector
 * (schools 매일 등) 행이 limit 을 점유해 월간 collector 의 최근 3행이 잘리는 silent skip
 * 결함이 있어 폐기 (세션 289, 대상 5→15 확대로 실재화). 호출은 monitor run 당 1회뿐.
 * @param {ReadonlyArray<{ collector: string }>} targets
 * @param {number} [limitPer]
 * @returns {Promise<Record<string, Array<{ status: string, ok_count: number|null, skip_count: number|null, finished_at: string|null }>>>}
 */
async function fetchExternalApiRuns(targets, limitPer = OUTAGE_MIN_CONSECUTIVE) {
  const sb = getSupabase();
  const names = targets.map((t) => t.collector);
  if (names.length === 0) return {};
  /** @type {Record<string, Array<{ status: string, ok_count: number|null, skip_count: number|null, finished_at: string|null }>>} */
  const grouped = {};
  await Promise.all(
    names.map(async (name) => {
      const { data } = await sb
        .from("collector_runs")
        .select("collector,status,ok_count,skip_count,finished_at")
        .eq("collector", name)
        .order("finished_at", { ascending: false })
        .limit(limitPer);
      if (data && data.length > 0) grouped[name] = data;
    }),
  );
  return grouped;
}

/**
 * 이미 발송한 알림 키 집합을 monitor_alert_state 에서 읽는다.
 * 조회 실패(테이블 없음 등)는 throw 하지 않고 빈 Set 반환 — dedup 실패가 알림 자체를 막으면 안 됨
 * (notify-telegram 철학: 알림 인프라 오류가 감시를 멈추면 안 됨).
 * @param {string[]} keys 이번에 점검된 이슈 키들 (이 중 이미 보낸 것만 조회)
 * @returns {Promise<Set<string>>}
 */
async function fetchSentAlertKeys(keys) {
  if (keys.length === 0) return new Set();
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("monitor_alert_state")
      .select("alert_key")
      .in("alert_key", keys);
    if (error) {
      console.log(`[monitor] dedup 상태 조회 실패(알림은 계속): ${error.message}`);
      return new Set();
    }
    return new Set((data ?? []).map((r) => r.alert_key));
  } catch (err) {
    console.log(`[monitor] dedup 상태 조회 오류(알림은 계속): ${err instanceof Error ? err.message : String(err)}`);
    return new Set();
  }
}

/**
 * 발송한 이슈 키를 monitor_alert_state 에 upsert. 기록 실패는 무시(다음에 중복 알림 1회 가능할 뿐).
 * @param {Issue[]} issues 실제 발송한 이슈들
 * @returns {Promise<void>}
 */
async function recordSentAlerts(issues) {
  if (issues.length === 0) return;
  try {
    const sb = getSupabase();
    const rows = issues.map((i) => ({ alert_key: dedupKey(i), kind: i.kind, collector: i.collector }));
    const { error } = await sb.from("monitor_alert_state").upsert(rows, { onConflict: "alert_key" });
    if (error) console.log(`[monitor] dedup 상태 기록 실패(다음 중복 1회 가능): ${error.message}`);
  } catch (err) {
    console.log(`[monitor] dedup 상태 기록 오류: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── 메인 ────────────────────────────────────────────────────

async function main() {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "daily";

  /** @type {Issue[]} */
  let issues = [];

  if (mode === "test") {
    // 전송 경로 검증용 — 점검 없이 새 알림 포맷 샘플을 보낸다.
    // 실제 이상이 아니라 "알림이 이렇게 보인다" 를 확인하는 예시 데이터.
    const nowIso = new Date().toISOString();
    /** @type {Issue[]} */
    const samples = [
      {
        kind: "fail",
        collector: "School District Collection",
        conclusion: "failure",
        detail: "워크플로 실행이 실패 상태로 끝났습니다.",
        url: "https://github.com/developer-duno/mibunyang/actions",
        at: nowIso,
      },
      {
        kind: "fail",
        collector: "Fill Missing Data",
        conclusion: "cancelled",
        detail: "워크플로 실행이 취소 상태로 끝났습니다.",
        url: "https://github.com/developer-duno/mibunyang/actions",
        at: nowIso,
      },
      {
        kind: "fail",
        collector: "Building Info Collection (MOLIT)",
        conclusion: "timed_out",
        detail: "워크플로 실행이 시간 초과 상태로 끝났습니다.",
        url: "https://github.com/developer-duno/mibunyang/actions",
        at: nowIso,
      },
      {
        kind: "empty",
        collector: "molit-units",
        detail: "success 인데 처리 0건 (ok 0 · skip 0 · fail 0)",
        lines: [
          "이번 실행은 success 로 끝났지만 처리 건수가 0건입니다 (성공 0 · 건너뜀 0 · 실패 0).",
          "지난 정상 실행(5/13 17:21 KST)에서는 1263건을 처리했는데, 이번엔 0건입니다.",
        ],
        at: nowIso,
      },
      {
        kind: "nulls",
        collector: "교통 (transport-tago)",
        detail: "전체 채움률 61.7% (8641/14007) — 기대 최저 95% 미달",
        lines: [
          "이 항목은 7개 세부 데이터로 이뤄집니다. 채움률이 낮은 것:",
          "  · KTX거리 0% (0/2001)",
          "  · IC거리 6.9% (139/2001)",
          "  · 지하철노선 78% (1560/2001)",
        ],
      },
      {
        kind: "outage",
        collector: "housing-permits",
        detail: "MOLIT 주택건설실적 API 48일+ 정상실행+0건 (3회 연속) — 외부 API 장기 중단 의심",
        lines: [
          "최근 3회 collector_runs 모두 status=success / ok_count=0 입니다.",
          "첫 이상 발화: 4/10 09:00 KST — 외부 MOLIT 주택건설실적 API 장애 시작 추정.",
          "[조치 1] raw API 1회 호출 (curl) — 500/503/타임아웃 확인",
          "[조치 2] MOLIT 주택건설실적 공식 공지 grep — \"점검\"/\"장애\" 키워드",
          "[조치 3] 의심 확정 시 BACKLOG.md \"외부 API 사고\" 1줄 박힘",
        ],
        at: nowIso,
      },
    ];
    // 운영 알림과 동일하게 한 통으로 합쳐 보낸다. 맨 앞에 테스트 안내를 덧붙임.
    const messages = buildMessages(samples);
    messages[0] =
      "✅ <b>수집기 감시 알림 — 테스트</b>\n아래는 실제 이상이 아니라 알림이 어떻게 보이는지 확인하는 예시입니다.\n\n" +
      messages[0];
    let allSent = true;
    for (const text of messages) {
      const result = await sendTelegram(text);
      if (!result.sent) {
        allSent = false;
        console.log(`[monitor] 전송 실패: ${result.reason}`);
      }
    }
    console.log(allSent ? "[monitor] 테스트 샘플 전송 성공" : "[monitor] 일부 전송 실패");
    if (!allSent) process.exit(1);
    return;
  }

  if (mode === "run") {
    // workflow_run 트리거 — 방금 끝난 run 1개만 점검 (①②)
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
      const { readFile } = await import("node:fs/promises");
      const event = JSON.parse(await readFile(eventPath, "utf8"));
      const wr = event.workflow_run;
      if (wr && wr.name !== "Monitor Collectors") {
        issues = issues.concat(checkFailedRuns([wr]));
      }
    }
    // run 모드도 collector_runs 최근분으로 0건 점검 (방금 끝난 수집기 반영).
    // 신선도 가드 36h: 다른 수집기 완료로 트리거됐을 때 housing-permits 식 옛 stale 0건 행을
    // 매번 ② 로 재알림하던 스팸 차단. 옛 행은 daily 스윕의 ⑤(checkExternalApiStale)가 단독 처리.
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk, { maxAgeHours: 36 }));
  } else {
    // daily 스윕 — 전체 점검 (①②③④⑤⑥)
    // ⚠️ ①③ 은 GitHub Actions REST(actions/runs·workflows)에 의존한다. 로컬 PC 처럼
    //    GITHUB_REPOSITORY/GITHUB_TOKEN 이 없으면 fetchRecentRuns 가 [] 를 반환해
    //    "모든 워크플로가 한 번도 안 돔" 으로 오판 → 미발화 알림이 전부 오탐 발송된다
    //    (로컬 점검이 운영 텔레그램으로 가짜 알림을 쏘는 사고). 인증이 있을 때만 ①③ 실행.
    if (hasGithubApiAuth()) {
      // monitor.yml 감시 대상 — ① 실패 알림을 이 목록 워크플로로 한정 (CI 등 비-수집기 제외).
      const monitoredNames = await fetchMonitoredWorkflowNames();
      const runs = await fetchRecentRuns(100); // 50→100: ①탐지 폭 + ③시각 병합 모수 확대
      issues = issues.concat(checkFailedRuns(runs, monitoredNames));

      // ③ 미발화 — monitor.yml workflows 배열(점검 대상 전체) 기준.
      // 최근 run 에 흔적이 없는 워크플로(=오래 죽은 월간 cron)는 개별 조회로 보충.
      // 워크플로 생성일도 조회 — 신규 워크플로(첫 cron 대기)를 오탐에서 제외.
      const seenNames = new Set(runs.map((r) => r.name).filter(Boolean));
      const missingNames = monitoredNames.filter((n) => !seenNames.has(n));
      const supplement = await fetchLastRunForWorkflows(missingNames);
      const createdAtByWf = await fetchWorkflowCreatedAt();
      const wfList = buildStaleCheckList(monitoredNames, runs, supplement, createdAtByWf);
      issues = issues.concat(checkStaleWorkflows(wfList));
    } else {
      console.log(
        "[monitor] GITHUB_REPOSITORY/GITHUB_TOKEN 없음 — ①실패·③미발화 점검 skip " +
          "(로컬 실행: GitHub run 이력을 못 읽어 미발화 오탐이 나므로 건너뜀). " +
          "②0건·④NULL·⑤외부API·⑥VIEW 점검은 collector_runs/DB 기반이라 계속 진행.",
      );
    }

    // ② success 인데 0건 — collector_runs 기반이라 로컬에서도 정상 점검.
    // 외부 API 의존 수집기(housing-permits·KOSIS 식)는 0건이 정상이라 ② 에서 제외 — 진짜
    // 장기 중단은 아래 ⑤가 stale_days 임계로 단독 판정(중복 노이즈 차단, 세션 444).
    const externalApiNames = new Set(EXTERNAL_API_COLLECTORS.map((c) => c.collector));
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk, { externalApiCollectors: externalApiNames }));

    // ④ NULL 급증 — regions 핵심 컬럼 + apartments 19 카테고리
    const regionStats = await fetchRegionColumnStats();
    issues = issues.concat(checkNullSurge(regionStats));
    const audit = computeAudit(await fetchAllFromView(getSupabase(), null));
    issues = issues.concat(
      checkCategoryNullSurge(audit.categories, AUDIT_CATEGORY_BASELINE, audit.fields),
    );

    // ⑤ 외부 API 장기 중단 — silent fail (success+ok=0) 연속 누적 탐지
    const runsByCollector = await fetchExternalApiRuns(EXTERNAL_API_COLLECTORS);
    issues = issues.concat(checkExternalApiStale(EXTERNAL_API_COLLECTORS, runsByCollector));

    // ⑥ VIEW 회귀 — regions 원본 채움 but VIEW NULL (세션 391 멀티 collector 새-행 lag)
    issues = issues.concat(checkViewRegionStale(audit.fields, regionStats));
  }

  if (issues.length === 0) {
    console.log(`[monitor] 이상 없음 (mode=${mode})`);
    return;
  }

  // dedup: run 모드(수집기 ~40개 완료마다 발화)는 같은 이슈를 매번 재알림하므로
  // 이미 보낸 키는 skip. daily(매일 1회 스윕)는 ③stale·④NULL 같은 지속 상태를
  // 하루 1회 리마인드하는 게 의도라 dedup 미적용 — 하루 1회는 도배 아님.
  if (mode === "run") {
    const keys = issues.map(dedupKey);
    const sentKeys = await fetchSentAlertKeys(keys);
    const fresh = filterUnsent(issues, sentKeys);
    const skipped = issues.length - fresh.length;
    if (skipped > 0) console.log(`[monitor] 이미 알린 이상 ${skipped}건 재발송 skip (dedup)`);
    issues = fresh;
    if (issues.length === 0) {
      console.log("[monitor] 새 이상 없음 (전부 이미 알림, mode=run)");
      return;
    }
  }

  console.log(`[monitor] 이상 ${issues.length}건 발견 (mode=${mode})`);
  // 한 통으로 모아 보낸다. 4000자 넘으면 buildMessages 가 이슈 경계에서 나눈다.
  const messages = buildMessages(issues);
  for (const issue of issues) console.log(formatIssue(issue));
  let anySent = false;
  for (const text of messages) {
    const result = await sendTelegram(text);
    if (result.sent) anySent = true;
    else console.log(`  [전송 스킵] ${result.reason}`);
  }
  // 발송 성공 시에만 dedup 키 기록 (전송 실패 시 다음 발화에서 재시도되도록).
  if (mode === "run" && anySent) await recordSentAlerts(issues);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("[monitor] 오류:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
