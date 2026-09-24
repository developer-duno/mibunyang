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
 *   ⑥ VIEW 회귀   — regions 원본은 채워졌는데 apartments_flat VIEW 노출 컬럼만 NULL
 *   ⑦ 시군구 짝 불일치 — apartments.gu 가 regions 시군구 행과 안 이어져 rg 조인 컬럼이 빈칸
 *
 * 모드:
 *   --mode=run    workflow_run 트리거 — 방금 끝난 run 1개만 (①②)
 *   --mode=daily  cron — 전체 스윕 (①②③④⑤⑥⑦)
 *
 * 필요 환경변수:
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — 알림 채널 (없으면 점검만, 전송 스킵)
 *   GITHUB_TOKEN                          — GitHub REST 인증 (Actions 기본 제공)
 *   GITHUB_REPOSITORY                     — "owner/repo" (Actions 기본 제공)
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY   — collector_runs / regions 조회
 */
import { loadEnv, getSupabase, selectAll, viewJoinGu, parseRegionUnresolved, isApplyhomeExpired, APPLYHOME_EXPIRY_MONTHS } from "./collectors/_shared.mjs";
import { computeAudit, fetchAllFromView } from "./collectors/data-audit.mjs";
import { sendTelegram, formatIssueForConsole, buildMessages, toKst, CONCLUSION_LABEL } from "./notify-telegram.mjs";
import { extractMonitoredWorkflows } from "./audit-monitor-coverage.mjs";
import { buildBriefing, extractWarnRuns, splitRuns } from "./monitor-briefing.mjs";
import { CLIENT_WRITE_ALLOWLIST } from "./_rls-allowlist.mjs";
import { groupSharedCoords } from "./fix-placeholder-addresses.mjs";
import {
  DB_PERM_ITEMS_PER_RULE,
  capRuleItems,
  isRestrictive,
  policyBlocksRole,
  evaluatePermissionDrift,
  describeDriftOk,
} from "./_perm-fingerprint.mjs";

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
  // 세션 491: 월간 → 분기(1,4,7,10월) 전환. 빠뜨리면 35일 기준으로 잡혀 거짓 경보.
  // ⚠️ "Housing Permits Data Collection" 은 세션 501 에서 제거했다 — MOLIT 폐기로 KOSIS 이전 +
  //    kosis.kr 해외 IP 차단 때문에 yml 자체를 삭제했다(로컬 러너 매월 11일이 승계).
  //    없는 워크플로를 여기 남겨두면 "분기라서 오래 안 돈 것" 으로 오해할 여지만 남는다.
  // ⚠️ "Collect Building Hub (에너지+인허가)" 도 같은 이유로 세션 515 에서 제거했다 —
  //    MOLIT(1613000) 해외 IP 차단으로 yml 삭제 + 로컬 러너 분기 15일 이전.
  //    ⑤ EXTERNAL_API_COLLECTORS 의 building-hub(stale_days=100) 가 감시를 승계한다.
];
/**
 * 예약(cron)이 아예 없는 워크플로 — ③ 미발화 점검 대상에서 제외.
 *
 * 세션 491 이 이 4개의 schedule 을 지웠다(매일 도는 경로가 같은 스크립트를 무인자로 실행하는 중복이라서).
 * 그런데 monitor.yml 의 workflow_run.workflows 배열에는 그대로 남아 있어야 한다 —
 * `scripts/audit-monitor-coverage.mjs` 가 collect-*.yml 의 등재를 CI 에서 강제하기 때문이다.
 * 목록에서 빼면 exit 1 이 나므로 **코드 쪽에서 예외 처리**하는 것이 유일한 길이다.
 *
 * 이 예외가 없으면 마지막 run 이 35일을 넘는 순간 "월간 cron 1주기를 넘김" 이라는
 * 사실과 다른 진단이 나가고, dedupKey 가 `stale|<name>|<lastRunAt>` 로 고정이라
 * 그 1회 이후 ③ 은 해당 워크플로에 대해 **영구히 침묵**한다(거짓 경보로 검사 하나를 태워 없앰).
 *
 * ⚠️ 이 목록의 워크플로에 schedule 을 다시 넣으면 여기서도 빼야 한다.
 *    monitor-collectors.test.mjs 가 yml 과 대조해 드리프트를 막는다.
 */
export const SCHEDULELESS_WORKFLOWS = [
  "Transport Accessibility Collection",
  "Infra Facilities Collection",
  "School District Collection",
  "Exclusive Ratio Calculation",
];
/** 분기 cron 미발화 판정 임계 — 91 일 1주기 + 9 일 여유. */
const QUARTERLY_STALE_DAYS = 100;
/** ③ 점검 대상 워크플로 목록 출처 — monitor.yml 자신의 workflow_run.workflows 배열. */
const MONITOR_YML_PATH = ".github/workflows/monitor-collectors.yml";
/** NULL 급증 판정 임계 — 핵심 컬럼 NULL 비율이 이 값을 넘으면 이상. */
const NULL_RATE_THRESHOLD = 0.4;
/** 이상 run 으로 보는 conclusion. */
const BAD_CONCLUSIONS = ["failure", "cancelled", "timed_out"];
/**
 * ④ NULL 점검 대상 — regions 핵심 컬럼 + 세는 단위(granularity).
 * ⚠️ 컬럼마다 데이터가 사는 지역 단위가 다르다 (세션 478 실측). 전체행(시도 113 + 시군구 997 = 1110)
 * 으로 일괄 세면 단위 불일치로 오탐 (housing 시도 100% 채움인데 전체행 기준 90% NULL 오탐, 세션 477).
 * granularity 로 total·filled 를 같은 단위로 쌍 계산해야 정확: "sido"=시도(gu IS NULL)만 /
 * "sigungu"=시군구(gu IS NOT NULL)만 / "all"=전체행(VIEW 미노출이라 원본 전체 완결성으로 감시).
 * 신규 regions 컬럼 추가 시: apartments_flat VIEW 가 그 컬럼을 어느 CTE(latest_regions=시도 /
 * latest_regions_gu=시군구)에서 노출하나 확인 → 그 단위 / VIEW 미노출이면 "all". 라이브 채움률
 * (시도/시군구 각각)로 교차 검증 후 박제 (소스 `.is("gu",null)` 여부만으로 단정 금지 — 매칭 실패로
 * 숨는 컬럼 있음). 근거 VIEW: 20260629000000_view_add_housing_supply_level.sql.
 *
 * `nullSurge: false` = ④ NULL 급증 점검에서만 뺀다(⑥ VIEW 회귀 점검에는 그대로 쓴다). 원본 자체가
 * 성기게 채워지는 게 정상인 컬럼용 — ④ 는 "임계(40%)보다 NULL 이 많으면 이상" 이라, 정상 채움률이
 * 애초에 그 아래인 컬럼을 넣으면 고장 0인데 매일 경보가 울린다(그런 경보는 곧 무시당한다).
 * @type {Array<{ column: string, granularity: "sido" | "sigungu" | "all", nullSurge?: boolean }>}
 */
export const REGION_KEY_COLUMNS = [
  { column: "net_migration", granularity: "sido" },         // 양쪽채움이나 VIEW latest_regions(시도)만 손님 노출
  { column: "housing_supply_level", granularity: "sido" },  // 시도 전용 (collect-housing-supply-ratio 17행)
  { column: "crime_grade", granularity: "all" },            // 양쪽채움(collect-crime-safety 전체행 순회·매칭행만 UPDATE), VIEW 미노출
  { column: "doctors_per_1k", granularity: "sigungu" },     // 시군구 전용 (collect-medical-access)
  { column: "hospital_beds_per_1k", granularity: "sigungu" }, // 시군구 전용 (collect-medical-access)
  // 공시가격 (세션 505) — 시군구 전용 (collect-housing-price, VIEW latest_regions_gu 노출).
  //   ④ 제외 이유: MOLIT 공동주택공시가격은 공동주택이 있는 시군구만 나온다. 라이브 실측
  //   252/1533(16.4%) 이 **정상**이라 ④ 임계(NULL 40%)에 늘 걸린다 — 등재하면 매일 거짓 경보.
  //   ⑥(VIEW 회귀)에는 남긴다: 원본 252행 그대로인데 화면만 0% 가 되는 사고는 여전히 잡아야 한다.
  { column: "housing_price", granularity: "sigungu", nullSurge: false },
];
/**
 * ④ apartments 19 카테고리 중 NULL 점검 대상 — 카테고리별 기대 최저 rate(%).
 * 현재 rate 가 이 값 아래로 떨어지면 수집기 고장 의심. 의도적 저율 카테고리
 * (benefits 수기입력 / maintenance·builders·future·energy 부분수집 / naver 로컬전용 /
 * regions VIEW측 미수집컬럼)는 점검 안 함 — 정상인데 매일 오탐 방지.
 * 값 출처: data-audit --json 실측(2026-05-17) - 안전 마진 15~20%p.
 *
 * ⚠️ competition 만 모수가 다르다 — 전체 단지가 아니라 **청약홈(ah-) 시드 단지**로 좁혀 센다.
 *    아래 competition 항목 주석 참조.
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
  // ⚠️ 이 값만 "채울 수 있는 모수"(청약홈 ah- 시드 단지) 기준이다 — scopeCompetitionToAh 참조 (세션 522).
  //   전체 모수로는 영구 거짓 경보였다: apartments_flat 2,211곳 중 네이버 분양 시드(ap-) 1,229곳은
  //   청약홈 공고번호와 이을 키가 구조적으로 없어 채움 0건이고(실측 0/1229), ah- 982곳만 채워진다.
  //   즉 도달 가능 최대 채움률 = 982/2211 = 44.4% < 옛 문턱 45% → 매일 경보.
  //   문턱을 낮추는 처방은 오래 못 간다 — 구성비가 2026-05-17 ah:ap 74:26 → 2026-08-22 55:45 로
  //   계속 드리프트한다(ap- 증가). 모수를 바꿔야 드리프트와 절연된다.
  //   65 = ah- 모수 실측 79.5%(2,341/2,946, 2026-08-22) − 마진 약 15%p (이 표의 기존 산정 관례와 동일).
  //   수집기 자체 고장은 ⑤(EXTERNAL_API_COLLECTORS 의 applyhome-*)가 독립으로 잡는다 —
  //   이 점검의 몫은 "청약홈 단지의 데이터 품질"이다.
  competition: 65,
  // 90 → 95 (세션561 적대검증 🔴): #557 이 채움 판정을 "껍데기가 아니라 알맹이" 로 고친 뒤
  //   실측이 97.3% 다(2,391/2,457). 90 이면 **66곳이 더 비어야** 겨우 울어 부분 유실을 놓친다.
  //   95 = 실측 97.3 − 마진 약 2%p (이 표의 기존 산정 관례와 동일).
  air: 95,
  safety: 60,
};

/** ④ competition 카테고리 키 (data-audit AUDIT_FIELDS 기준). */
export const COMPETITION_CATEGORY = "competition";

/** ④ competition 카테고리를 이루는 필드 3종 — data-audit AUDIT_FIELDS.competition.fields 와 같아야 한다. */
export const COMPETITION_FIELDS = ["competitionRate", "competitionSupply", "competitionApplicants"];

/** ④ competition 모수인 청약홈 시드 단지의 id 접두사 (apartments_flat.id). */
export const AH_ID_PREFIX = "ah-";

/** ④ 모수를 좁혔음을 경보 문구에 드러내는 표식 — collector 라벨 뒤에 붙는다. */
export const COMPETITION_SCOPE_SUFFIX = " · 청약홈 ah- 단지 모수";

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
 * @property {"fail"|"empty"|"stale"|"nulls"|"outage"|"region-unresolved"|"applyhome-unsold"|"check-failed"|"local-failure"} kind
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
// 세션 359: naver-estate-web 측 감시 사각지대 조사(오전 8종) 중 mibunyang 쪽도
// 대조 확인 — 7종(air-quality/applyhome/childcare/emergency/nearby-childcare/
// police/trades)은 대응 GitHub Actions 워크플로가 monitor-collectors.yml 의
// workflow_run.workflows 에 이미 등재돼 ①(실패/취소)·③(미발화) 축이 커버하고
// 있음을 실측 확인(이 배열=EXTERNAL_API_COLLECTORS 는 로컬 러너 등 GH 워크플로
// 자체가 없는 수집기 전용). 진짜 사각지대는 collect-crime-safety.mjs 단
// 하나였다 — 아래 EXEMPT_FROM_STALE_CHECK 참조.
// ⚠️ 위 7종 중 **air-quality·trades·emergency·population 은 그 뒤 GH 워크플로가 삭제**됐다
//   (trades=세션 515, air-quality=세션 519, emergency=세션 525, population(+population-sex-age)=
//   세션 550 — 전부 해외 IP 차단으로 로컬 러너 이전). 즉 "워크플로가 있어 이 배열 대상이 아니다"
//   는 그 넷에 더는 성립하지 않고, 실제로 넷 다 아래에 등재돼 있다.
//   **워크플로를 지울 때 이 배열 등재를 함께 챙기지 않으면 그 수집기는 조용히 죽는다.**
//
// ⚠️ 세션521: 여기 있던 `crime-safety` 를 **뺐다**. 옛 사유는 "자동 실행 경로가 아예 없어
// stale 판정이 항상 참 → 상시 오탐" 이었고 그때는 맞았다. 그런데 그 상태가 만든 결과가
// 실측으로 드러났다 — 수집기가 3월경 이후 안 돌아 regions 2026-04·05·06월 행이 통째로
// NULL, crime_grade NULL 비율이 계속 올라 **NULL 급증 경보가 영구화**됐다(58%→64%).
// 처방은 감시를 끄는 쪽이 아니라 **자동 실행 경로를 만드는 쪽**이었다: 로컬 러너 매월 8일
// 등재(kosis-local-runner.mjs). 이제 stale 판정이 의미를 가지므로 아래 배열에 정식 등재한다.
// 비워 두되 상수는 남긴다 — 같은 상황이 또 생기면 사유를 적고 넣는 자리다.
export const EXEMPT_FROM_STALE_CHECK = new Set([]);

export const EXTERNAL_API_COLLECTORS = [
  // ⚠️ 세션 491: 두 collector 의 cron 이 월간 → **분기**(1,4,7,10월)로 바뀌었다.
  //    stale_days 를 38(월간 기준)로 두면 ⑤-b(미발화) 가 먼저 걸려 `continue` 로
  //    ⑤-a(진짜 outage) 판정을 통째로 덮는다 — housing-permits 는 지금 3회 연속 ok=0 이라
  //    "MOLIT API 장기 중단" 이 울려야 하는데 2026-08-18 부터 그게 사라졌을 것이다.
  //    세션 463 이 반대 방향(월간에 14 를 박음)으로 겪은 것과 **같은 사고**다.
  //    cron 을 월간으로 되돌릴 때 이 값도 38 로 함께 되돌릴 것.
  // 세션 501: MOLIT ArchPmsService_v2 폐기(NO_OPENAPI_SERVICE) → KOSIS DT_MLTM_666 이전.
  // kosis.kr 해외 IP 차단이라 GH yml 삭제 + 로컬 러너 매월 11일 → 분기 100 이 아니라 월간 38.
  { collector: "housing-permits", stale_days: 38, owner: "KOSIS 주택건설 인허가실적 (로컬 매월 11일)" },
  { collector: "building-hub",    stale_days: QUARTERLY_STALE_DAYS, owner: "MOLIT 건축물대장 허브 (로컬 분기 1·4·7·10월 15일 + 9일 여유)" },
  // ── MOLIT(apis.data.go.kr/1613000) 3종 = 세션 515 신규 등재.
  //    1613000 이 해외 IP 를 복불복 차단(2026-08-06~, HTTP 코드 없는 `fetch failed`)해 GH yml 5개를
  //    삭제하고 로컬 러너로 옮겼다 — GH run 이 없어 ①③ 대상에서 빠지므로 collector_runs 신선도가
  //    유일한 "안 돌면 알림" 이다. maintenance·building-hub 는 이미 아래/위에 있어 3건만 추가.
  //    stale_days = 발화주기 + 여유 1주기 (일일=14 / 주간=14 / 월간=38 / 분기=100).
  { collector: "trades",          stale_days: 38, owner: "MOLIT 실거래 (로컬 매월 6일)" },
  // ── 세션521: 외부 API 를 쓰지 않는 유일한 등재분. `data/crime-safety-index.csv` 를 읽어
  //    apartments·regions 를 채운다 — 이 배열의 취지가 "GH run 이 없어 ①③ 이 못 보는 수집기의
  //    신선도" 이므로 출처가 API 든 파일이든 같다. 로컬 러너 매월 8일 → 월간 38.
  { collector: "crime-safety",    stale_days: 38, owner: "행안부 지역안전지수 CSV (로컬 매월 8일)" },
  // ── data.go.kr = 세션 519. 1613000 만의 문제가 아니었다 — www.data.go.kr(공시가격 CSV)·
  //    apis.data.go.kr/B552584(에어코리아)도 해외 IP 를 막는다. 실측: GH 는 `fetch failed`
  //    (HTTP 코드 없음)인데 같은 요청이 로컬 한국 IP 에선 166ms / 92ms 200 OK.
  //    housing-price 7/16·8/16 **연속 실패**, air-quality 8회 중 2회만 성공(25% 복불복).
  //    둘 다 GH yml 삭제 + 로컬 러너 이전. housing-price 는 아래에 이미 등재돼 있어
  //    거기 문구만 갱신했다(중복 추가하면 한쪽을 지워도 가드가 통과한다 — 뮤테이션이 잡음).
  { collector: "air-quality",     stale_days: 14, owner: "에어코리아 대기질 (로컬 매주 화요일 + 1주 여유)" },
  // ── 세션525: apis.data.go.kr/**B552657**(국립중앙의료원 응급의료기관)도 같은 차단.
  //    GH 8/02·8/04 연속 failure 로그가 `[emergency] ERROR: fetch failed`(HTTP 코드 없음)인데
  //    로컬 한국 IP + 같은 키는 `resultCode=00 NORMAL SERVICE`(2026-08-27 실측).
  //    `collect-emergency.yml` 삭제 + 로컬 러너 매월 3일 → GH run 이 없어 ①③ 대상 밖이므로
  //    이 신선도가 유일한 "안 돌면 알림". 옛 cron `0 16 2 * *` 은 UTC 라 KST 로는 3일이었다.
  //    월간이므로 31일 + 1주 여유 = 38 (일일=14 / 주간=14 / 월간=38 / 분기=100 기준표).
  { collector: "emergency",       stale_days: 38, owner: "국립중앙의료원 응급의료기관 (로컬 매월 3일 + 1주 여유)" },
  // ── 세션550: 행안부(MOIS) 주민등록 인구 API 도 GH 해외 러너 IP 를 복불복 차단한다
  //    (세션546 스펙 `2026-09-11-population-sido-aggregation-fix.md` §4-4·§5 PR-F3).
  //    `collect-population.yml` 삭제 + 로컬 러너 매월 5일 → GH run 이 없어 ①③ 대상 밖이므로
  //    이 신선도가 유일한 "안 돌면 알림". 옛 cron `0 20 5 * *` 은 UTC 라 KST 로는 6일이었지만,
  //    population 은 `regions` 행 생성자라 후행(market-stats 6일·migration 7일·crime-safety 8일)
  //    보다 먼저여야 해서 **일부러 하루 앞인 5일**에 뒀다([[regions-multicollector-recorded-at-lag]]).
  //    월간이므로 31일 + 1주 여유 = 38 (일일=14 / 주간=14 / 월간=38 / 분기=100 기준표).
  //    ⚠️ 라벨은 파일명이 아니라 recordCollectorRun 첫 인자다 — population.mjs:731 = "population",
  //    population-sex-age.mjs:311 = "population-sex-age". 두 수집기가 별 행을 남기므로 둘 다 등재.
  { collector: "population",      stale_days: 38, owner: "행안부 주민등록 인구 (로컬 매월 5일 + 1주 여유)" },
  { collector: "population-sex-age", stale_days: 38, owner: "행안부 성별·연령별 인구 (로컬 매월 5일 + 1주 여유)" },
  // ── 세션522: 택지정보시스템 지구단계정보(openapi.jigu.go.kr, 무인증) → dev_plans.progression_step.
  //    GH 워크플로가 없어(로컬 러너 매월 21일) ①③ 이 못 본다 — collector_runs 신선도가 유일한
  //    "안 돌면 알림". 월간이므로 31일 + 1주 여유 = 38 (일일=14 / 주간=14 / 월간=38 / 분기=100).
  { collector: "lhzone-status",   stale_days: 38, owner: "택지정보시스템 지구단계정보 (로컬 매월 21일)" },
  { collector: "molit-building",  stale_days: 38, owner: "MOLIT 건축물대장 상세 (로컬 매월 10일·토요일이면 11일)" },
  // molit-units 만 14 인 이유 = 월간 cron 외에 네이버 로컬 파이프라인(월/목 08:00, run-naver-local)
  // 4/6 단계가 같은 수집기를 돌린다. 정상 최대 간격이 4일이라 월간 38 을 쓰면 정지를 늦게 잡는다.
  { collector: "molit-units",     stale_days: 14, owner: "MOLIT 세대수 보정 (로컬 매월 6일 + 네이버 파이프라인 월/목)" },
  { collector: "transport-tago",  stale_days: 14, owner: "버스정류장 파일(data.go.kr, 세션497부터 TAGO 실시간 API 대체) + Kakao" },
  { collector: "schools",         stale_days: 14, owner: "NEIS 학교정보" },
  { collector: "applyhome-detail", stale_days: 14, owner: "청약홈 분양일정·평형 (주간 월 cron — 세션 467 주간화)" },
  // 세션 496 단계1. collect-applyhome-remndr.yml = 주간 월 13:30 KST cron → 7+7 = 14.
  //   cron 주기를 바꾸면 이 값도 함께 바꿀 것 (일일=14 / 월간=38 / 분기=100).
  //   ok = 적재 행 수(평형 + 취소후재공급). 두 채널 모두 매칭률 90%+ 라 ok=0 이면 진짜 이상 신호다.
  { collector: "applyhome-remndr", stale_days: 14, owner: "청약홈 잔여세대 평형·취소후재공급 (주간 월 cron)" },
  // notify-subscribers: 분양 알림 발송기 (scripts/notify-subscribers.mjs — collectors/ 밖, 주간 월 14:00 KST).
  //   skip=일정 스캔 행 수(984+)를 항상 기록해 대상 0건 주간에도 ⑤-a 빈성공(ok=0&&skip=0) 오탐 없음.
  //   ⑤-b 미발화(14일+)가 "발송기 안 돎"을 잡는 신호 (세션 467).
  { collector: "notify-subscribers", stale_days: 14, owner: "분양 알림 발송기 (주간 월 cron)" },
  // applyhome-seed: ok=신규 등록 수 — 신규 공고 0건 주간 3연속이면 ⑤-a "빈 성공" 경보 가능(주평균 ~7건이라
  //   드묾). 발화해도 "신규 무순위 3주째 0" 자체가 유의미 신호라 수용 (세션 466 plan 명시).
  { collector: "applyhome-seed",   stale_days: 14, owner: "청약홈 무순위 신규 ah-* seeding (주간 월 cron)" },
  // maintenance = 국토부 공동주택 관리비 (collect-maintenance.yml, 월 15~19일 5일 연속 cron — 세션 450). cancelled
  //   run 은 recordCollectorRun 전에 죽어 collector_runs 행 0건 → ③ 워크플로 점검은 GH created_at 으로 "신선" 마스킹.
  //   ⑤-b 미발화 분기(collector_runs.finished_at 기준)가 유일하게 "데이터 N일 stale" 을 잡음 (세션 447).
  //   5일 연속이라도 한 묶음 발화(19일 success→다음달 15일 발화 ~26일 간격)라 stale_days:38(=31일+1주)은 적정.
  //   세션 515: MOLIT 해외 IP 차단으로 GH yml 삭제 → 로컬 러너가 같은 15~19일 배치를 승계(주기 동일 → 38 유지).
  { collector: "maintenance",      stale_days: 38, owner: "국토부 공동주택 관리비 (로컬 매일 15~19일 배치 + 1주 여유)" },
  // housing-price = 공동주택공시가격 (세션 504 등재). 이 항목이 실제로 일을 했다 —
  //   62일 미발화를 매일 알려 세션 519 가 원인(해외 IP 차단)에 도달했다.
  //   ⚠️ 세션 519: `collect-housing-price.yml` **삭제**, 로컬 러너 매월 **17일** 로 이전.
  //   옛 cron `0 22 16 * *` 은 UTC 라 KST 로는 17일이었다(러너 표는 KST 기준).
  //   월간이므로 31일 + 1주 여유 = 38 (일일=14 / 주간=14 / 월간=38 / 분기=100 기준표).
  { collector: "housing-price",    stale_days: 38, owner: "공동주택 공시가격 CSV (로컬 매월 17일 + 1주 여유)" },
  // naver-presale = 네이버 분양정보 pre.land (scripts/collectors/naver-presale.mjs, run-naver-local.sh 3/6 단계).
  //   네이버 IP 차단으로 한국 IP 로컬 PC 에서만 실행 = Windows 스케줄러 `MibunyangNaverCollect` 월/목 08:00.
  //   GH run 이 없어 ③ 워크플로 점검 대상 밖 → collector_runs 신선도가 유일한 "안 돌면 알림".
  //   성공 시 recordCollectorRun("naver-presale") 기록, 실패 시 process.exit(1) 로 행 미기록 →
  //   ⑤-b 미발화(14일+) 가 "스케줄러 정지"(현 근본 원인 = 4/13~ 정지)를 잡는 신호. 주 2회라 최대
  //   간격 ~4일 « 14일이므로 정상 주기엔 오탐 0 (childcare 일일=14 답습).
  { collector: "naver-presale",    stale_days: 14, owner: "네이버 분양정보 pre.land (로컬 월/목 08:00)" },
  // naver-collect = 네이버 매물·시세 수집 1단계 (scripts/collectors/naver-collect.py, run-naver-local.bat 1/6).
  //   ⚠️ 기록 주체가 유일하게 **파이썬**이다 — SB.insert("collector_runs", [{"collector":"naver-collect", ...}]).
  //   .mjs recordCollectorRun 과 같은 스키마이며, monitor-collectors.test.mjs 의 라벨 드리프트 가드가
  //   .py 도 훑도록 함께 넓혔다.
  //   왜 등재하나: 이 1단계만 죽는 유형(스케줄러 정지·제한시간 초과 강제종료)이 세션 493 에서 **한 달**
  //   잠복했다. 2~6단계는 bat 이 아예 실행하지 못했는데 어느 검사도 울리지 않았다 — GH run 이 없어 ③
  //   대상 밖이고, 기록 자체가 없어 ②·⑤ 도 볼 게 없었기 때문. ⑤-b(미발화)가 그 구멍을 메운다.
  //   stale_days=14: 월/목 발화라 정상 최대 간격이 4일(목→월) « 14 → 오탐 0 (자매 naver-presale 답습).
  //   ⑤-a(빈 성공 3연속)는 이 수집기에선 구조적으로 안 울린다 — 시간예산에 잘리면 status="partial" 이라
  //   연속이 끊기고, 3회가 다 success 여도 가장 오래된 행이 7~11일 전이라 14일 임계를 못 넘는다.
  { collector: "naver-collect",    stale_days: 14, owner: "네이버 매물·시세 1단계 (로컬 월/목 08:00)" },
  // naver-pipeline = run-naver-local.bat 6단계 **완주 기록**(세션570, scripts/record-pipeline-run.mjs done/failed).
  //   왜 등재하나: 9/10·9/17·9/24 세 주 연속 4~6단계가 끊겼는데(점심 무렵 PC 재시작 = 예약 작업 결과 267014)
  //   어느 감시도 울리지 않았다 — 단계별 수집기 행만 있고 "끝까지 갔다"는 행이 없었기 때문이다.
  //   ⚠️ 이 값만 4 인 이유: 발화가 월·목 08:00 이라 정상 간격이 월→목 3일·목→월 4일이다. 4 면 한 회차를
  //   놓쳤을 때 **다음 회차 전에** 잡는다(목요일이 끊기면 마지막 완주가 월요일 → 토요일 09:00 감시에서 4일 초과).
  //   14(자매 naver-collect 기준)로 두면 세 회차를 연달아 놓쳐야 울린다 — 이번 사고가 딱 그 모양이었다.
  //   ⑤-b 미발화만 의미가 있다: 재시작으로 죽으면 행 자체가 없고, 치명 실패(failure)는 ⑬ 이 당일 잡는다.
  //   ⚠️ 부작용: 이 배열에 들면 ② 빈 성공 점검(idempotentCollectorSet)에서 빠진다 — naver-pipeline 의
  //   ok 는 6-경고수라 success 로 끝나면 최소 3(치명 단계 1·2·5 는 경고가 될 수 없다)이어서 ② 가 볼 것이 없다.
  //   since = 등재일(세션571). 행이 아직 0개여도 "등재 뒤 stale_days 가 지나도록 기록 0" 이면 울린다 —
  //   첫 정기 실행 9/28(월) 08:00 → 행 기대 12:00. daily 감시 실제 발화 09:48~09:55 KST 라 9/28 아침(3.03일)엔
  //   조용하고 9/29 09:48(4.03일)부터 울린다. 9/24 로 두면 9/28 아침 오탐.
  { collector: "naver-pipeline",   stale_days: 4,  since: "2026-09-25", owner: "네이버 로컬 파이프라인 완주 기록 (월·목 08:00, bat 끝 1행 — 목요일 회차가 끊기면 토요일 09:00 울린다)" },
  // naver-devplan = 네이버 개발계획(도로·철도·역·지구) — 세션 517 에 로컬 러너 매월 20일로 크론 편입.
  //   네이버 IP 가 필요해 GH 러너에서 못 돌리고, 편입 전까지는 **어느 스케줄에도 없어** 사람이
  //   손으로 부를 때만 돌았다(세션 510b 지적 → 516 재확인). GH run 이 없어 ①③ 대상 밖 →
  //   collector_runs 신선도가 유일한 "안 돌면 알림".
  //   월간(매월 20일) 이므로 31일 + 1주 여유 = 38 (일일=14 / 주간=14 / 월간=38 / 분기=100 기준표).
  //   DAY_TABLE 의 발화주기를 바꾸면 이 값도 함께 바꿀 것 — monitor-collectors.test.mjs 가 두 파일을 묶는다.
  { collector: "naver-devplan",    stale_days: 38, owner: "네이버 개발계획 도로·철도·역·지구 (로컬 매월 20일)" },
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
 *
 * `minRegionRate` = "원본이 이만큼은 채워져 있어야 VIEW 쪽 0% 를 회귀로 본다" 는 하한. 생략하면
 * 기본 0.2. 원본 정상 채움률이 20% 아래인 컬럼은 이 값을 낮추지 않으면 **영영 발화하지 않는
 * 껍데기 등재**가 된다 — 등재해 놓고 안 잡히는 게 제일 나쁘다.
 * @type {Array<{ viewKey: string, regionColumn: string, label: string, minRegionRate?: number }>}
 */
export const VIEW_REGION_STALE_TARGETS = [
  { viewKey: "regions.netMigration", regionColumn: "net_migration", label: "순이동 (migration)" },
  { viewKey: "regions.housingSupplyLevel", regionColumn: "housing_supply_level", label: "주택보급률 (KOSIS)" },
  // 공시가격 (세션 505) — 원본 정상 채움이 시군구 252/1533(16.4%) 이라 기본 하한 20% 로는
  //   조건이 성립할 수 없다. 0.1 로 낮춰 실제로 잡히게 한다(수집기가 통째로 죽어 0 이 되면
  //   regionRate 0 < 0.1 이라 조용히 넘어가고, 그건 ⑤·② 가 잡을 몫이다).
  { viewKey: "regions.housingPrice", regionColumn: "housing_price", label: "공시가격 (housing-price)", minRegionRate: 0.1 },
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
    // 세션 491: 예약(cron)이 없는 워크플로는 "미발화"라는 개념 자체가 성립하지 않는다.
    // 수동 전용인데 35일 임계로 재면 설계상 영구히 참이 되어 거짓 경보가 나가고,
    // dedup 때문에 그 1회 이후 ③ 이 해당 워크플로에 대해 영구 침묵한다.
    if (SCHEDULELESS_WORKFLOWS.includes(wf.name)) continue;

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
 * @param {Array<{ column: string, total: number, filled: number, nullSurge?: boolean }>} columnStats
 * @returns {Issue[]}
 */
export function checkNullSurge(columnStats) {
  /** @type {Issue[]} */
  const issues = [];
  for (const stat of columnStats) {
    // REGION_KEY_COLUMNS 에서 nullSurge:false 로 표시한 컬럼은 ④ 대상이 아니다 —
    // 성긴 채움이 정상이라 매일 거짓 경보가 나던 자리(세션 505 housing_price).
    if (stat.nullSurge === false) continue;
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
 * ④ competition 카테고리의 모수를 "채울 수 있는 단지"(청약홈 ah- 시드)로 좁힌 사본을 만든다.
 *
 * 왜 필요한가 (세션 522): apartments_flat 의 ap-(네이버 분양 시드) 단지는 청약홈 공고번호와 이을
 * 키가 구조적으로 없어 competition 3필드가 영구 0% 다. 전체 모수로 재면 도달 가능 최대 채움률이
 * 문턱보다 낮아 매일 거짓 경보가 나고, 문턱을 낮추는 처방은 ah:ap 구성비 드리프트에 다시 뚫린다.
 *
 * 원본은 변형하지 않고 새 객체를 돌려준다(⑥ VIEW 회귀·브리핑이 같은 audit 을 원본 그대로 쓴다).
 * ahCounts 가 null(조회 실패)이거나 total 이 0 이면 원본을 그대로 반환한다 — 감시를 조용히 끄는
 * 것보다 원본 모수로라도 계속 보는 쪽이 안전하다.
 *
 * @param {Record<string, { collector: string, filled: number, total: number, rate: number }>} categories
 *   computeAudit().categories
 * @param {Record<string, { category: string, field: string, filled: number, missing: number }>} fields
 *   computeAudit().fields — key = `${category}.${field}`
 * @param {{ total: number, filled: Record<string, number> } | null | undefined} ahCounts
 *   ah- 단지 총수 + 필드별 채움 수 (fetchAhCompetitionCounts)
 * @returns {{
 *   categories: Record<string, { collector: string, filled: number, total: number, rate: number }>,
 *   fields: Record<string, { category: string, field: string, filled: number, missing: number }>,
 * }}
 */
export function scopeCompetitionToAh(categories, fields, ahCounts) {
  const stat = categories?.[COMPETITION_CATEGORY];
  if (!stat) return { categories, fields };
  const ahTotal = ahCounts?.total;
  if (!Number.isFinite(ahTotal) || Number(ahTotal) <= 0) return { categories, fields };
  const total = Number(ahTotal);

  const nextFields = { ...fields };
  let catFilled = 0;
  let scopedFieldCount = 0;
  for (const f of COMPETITION_FIELDS) {
    const key = `${COMPETITION_CATEGORY}.${f}`;
    const base = fields?.[key];
    if (!base) continue; // data-audit 에 없는 필드는 손대지 않는다 (drift 안전)
    const raw = ahCounts?.filled?.[f];
    // 채움 수가 모수를 넘으면 모수로 자른다 — missing 이 음수가 되는 것보다 낫다.
    const filled = Number.isFinite(raw) ? Math.min(Math.max(Number(raw), 0), total) : 0;
    nextFields[key] = { ...base, filled, missing: total - filled };
    catFilled += filled;
    scopedFieldCount++;
  }
  if (scopedFieldCount === 0) return { categories, fields };

  const catTotal = total * scopedFieldCount;
  return {
    categories: {
      ...categories,
      [COMPETITION_CATEGORY]: {
        ...stat,
        // 경보 문구에 모수가 드러나게 — checkCategoryNullSurge 는 collector 를 그대로 찍는다.
        collector: `${stat.collector}${COMPETITION_SCOPE_SUFFIX}`,
        filled: catFilled,
        total: catTotal,
        rate: Math.round((catFilled / catTotal) * 1000) / 10,
      },
    },
    fields: nextFields,
  };
}

/**
 * ⑤-b 미발화 조치 문구(2줄). naver- 접두 수집기는 KOSIS 로컬 러너가 아니라 네이버 로컬 파이프라인(예약 작업
 * MibunyangNaverCollect, 월·목 08:00)이 돌린다 — 조치 문구도 그쪽을 가리켜야 한다(세션570).
 * @param {string} collector
 * @returns {string[]}
 */
function staleActionLines(collector) {
  return collector.startsWith("naver-")
    ? [
        `[조치 1] 예약 작업 MibunyangNaverCollect(월·목 08:00) 결과 확인 — schtasks /query /tn MibunyangNaverCollect`,
        `[조치 2] naver-collect.log 확인 → 남은 단계 수동 재개 뒤 node scripts/record-pipeline-run.mjs done --collector=naver-pipeline --ok=6 --skip=0`,
      ]
    : [
        `[조치 1] 집서버 작업 확인 — schtasks /query /tn MibunyangKosisLocal (로컬 러너 수집기인 경우)`,
        `[조치 2] 수동 보충 실행 — node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD`,
      ];
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
 * @param {Array<{ collector: string, stale_days: number, owner: string, since?: string }>} targets
 *   since(선택, "YYYY-MM-DD") = 등재일. 행이 0개일 때의 기준 시각으로 쓴다(세션571) — 없으면 종전대로 skip.
 * @param {Record<string, Array<{ status?: string, ok_count?: number|null, skip_count?: number|null, finished_at?: string|null }>>} runsByCollector
 *   collector 별 최근 N행 (finished_at DESC). 빈 배열이면 since 가 있을 때만 "등재 뒤 행 0" 판정, 없으면 skip.
 * @param {Date} [now] 기준 시각 (테스트 주입용).
 * @returns {Issue[]}
 */
export function checkExternalApiStale(targets, runsByCollector, now = new Date()) {
  /** @type {Issue[]} */
  const issues = [];
  for (const { collector, stale_days, owner, since } of targets) {
    const rows = runsByCollector[collector] ?? [];
    // 행이 0개면 기준 시각 자체가 없어 아래 두 분기 다 판정 불가 (세션 504).
    // 단 등재일(since)이 있으면 그것을 기준 시각으로 쓴다(세션571) — 기록 자체가 한 번도 안 남는 사고
    // (bat 끝 호출 누락·.env 로드 실패·쓰기 실패)는 행이 없어서 ⑤-b 가 영영 못 본다.
    if (rows.length === 0) {
      if (!since) continue;
      const sinceIso = `${since}T00:00:00+09:00`;
      const sinceMs = new Date(sinceIso).getTime();
      if (Number.isNaN(sinceMs)) continue;
      const days = (now.getTime() - sinceMs) / 86400000;
      if (days <= stale_days) continue;
      issues.push({
        kind: "stale",
        collector,
        detail: `${owner} 등재(${since}) 뒤 ${Math.floor(days)}일 동안 collector_runs 행 0 — 기록 자체가 안 남고 있음`,
        lines: [
          "등재일 이후 한 번도 기록이 없습니다 — run-naver-local.bat 끝의 record-pipeline-run.mjs 호출·.env 로드·collector_runs 쓰기 여부를 확인",
          ...staleActionLines(collector),
        ],
        at: new Date(sinceMs).toISOString(),
      });
      continue;
    }

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
          // 조치 문구는 naver-/KOSIS 로 갈린다 — staleActionLines(세션570·571).
          lines: [
            `최근 collector_runs 행: ${toKst(latest.finished_at) ?? latest.finished_at} — ${stale_days}일 주기를 넘겼습니다.`,
            ...staleActionLines(collector),
          ],
          at: latest.finished_at,
        });
        continue; // 미발화면 아래 outage 판정은 같은 원인 이중 알림 — skip
      }
    }

    // ⑤-a outage 는 "N회 연속" 이 정의라 N행이 있어야 판정된다 (신규 collector 오탐 차단).
    // ⚠️ 이 가드는 세션 504 이전에 함수 맨 앞(rows 조회 직후)에 있었다. 그 자리에서는
    //    행 1~2개짜리 collector 의 ⑤-b(미발화)까지 함께 막아, 정식 등재돼 있는데도 영영
    //    침묵하는 사각을 만들었다(2026-08-01 입력으로 재현 시 naver-presale·notify-subscribers
    //    두 건이 발화했어야 하는데 [] 였다). ⑤-b 는 최신 1행이면 판정 가능하므로 여기로 내렸다.
    if (rows.length < OUTAGE_MIN_CONSECUTIVE) continue;
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
 * ⑪ 대상 — KOSIS **시도 단위 합계** 표를 `createRegionResolutionTracker` 로 읽는 수집기(세션569).
 * 값 = `recordCollectorRun` 첫 인자(PHASE 상수) 그대로. 파일명과 다르다(주택보급률 = kosis- 접두).
 */
export const REGION_UNRESOLVED_COLLECTORS = ["market-stats", "avg-income", "kosis-housing-supply-ratio"];

/** ⑪ 알림 detail 에 펼칠 이름 수 — 나머지는 "외 N건". */
export const REGION_UNRESOLVED_NAME_LIMIT = 5;

/**
 * ⑪ 수집기별로 읽는 최근 실행 수 — dedup 지문의 "구간 시작"을 찾는 창(월간 수집기 2년치).
 * 마커 구간이 이보다 길면 창이 밀릴 때마다 시작 시각이 바뀌어 한 달에 한 번 다시 알린다(허용).
 */
export const REGION_UNRESOLVED_RUN_WINDOW = 24;

/**
 * ⑪ dedup 구간을 끊는 **깨끗한 실행** = status success 이고 마커가 없는 실행 1회.
 * 실패 실행(마커 없음)은 원천을 못 받아 판정이 없었던 것이라 구간을 끊지 않는다.
 * @param {{ status?: string|null, error_message?: string|null }} run
 * @returns {boolean}
 */
export function isCleanRegionRun(run) {
  return run.status === "success" && !parseRegionUnresolved(run.error_message);
}

/**
 * ⑪ KOSIS 시도 이름 못 맞춤 — 수집기가 남긴 `REGION_UNRESOLVED` 마커(error_message)를 읽는다.
 *
 * 세션568(#595)이 무음 continue 를 **로그**로 바꿨지만 로컬 러너 로그는 사람이 열어야 보인다
 * (data-changing-run-approval.md §4). 그래서 수집기가 collector_runs 에 마커로 남기고 여기서 알린다.
 * **가장 최근 실행만** 본다 — 표기를 반영해 다음 실행이 깨끗하면 경보도 그친다(옛 실행의 마커는 무시).
 * 옛 실행은 dedup 지문의 "구간 시작"을 찾는 데만 쓴다. 사람이 고쳐야 풀리는 종류라 ⑨ 처럼
 * daily 에서도 dedup 한다(`ALWAYS_DEDUP_KINDS`).
 *
 * @param {Record<string, Array<{ status?: string|null, error_message?: string|null, finished_at?: string|null }>>} runsByCollector
 *   collector 별 최근 행(finished_at DESC). [0] 이 최신.
 * @param {readonly string[]} [targets]
 * @returns {Issue[]}
 */
export function checkRegionUnresolved(runsByCollector, targets = REGION_UNRESOLVED_COLLECTORS) {
  /** @type {Issue[]} */
  const issues = [];
  for (const collector of targets) {
    const runs = runsByCollector[collector] ?? [];
    const latest = runs[0];
    if (!latest) continue;
    const parsed = parseRegionUnresolved(latest.error_message);
    if (!parsed) continue;
    // dedup 지문(⑨ 와 같은 monitor_alert_state · dedupKey 재사용, 세션569):
    //   마커 내용(n·이름) 해시 + "마커가 끊기지 않고 이어진 구간"의 첫 실행 시각.
    //   같은 내용이 매달 이어지면 같은 키 → 다음 날부터 침묵 / 내용이 바뀌면 새 키 /
    //   깨끗한 실행이 한 번 끼었다가 다시 생기면 구간이 새로 시작돼 새 키 → 다시 알린다.
    let streakStart = latest.finished_at ?? "";
    for (const r of runs) {
      if (isCleanRegionRun(r)) break; // 구간 끝 — 이 뒤(더 옛날)는 다른 구간
      if (parseRegionUnresolved(r.error_message)) streakStart = r.finished_at ?? streakStart;
      // 마커 없는 실패 실행은 구간을 끊지도 늘리지도 않는다(KOSIS 가 안 와 판정 자체가 없었다)
    }
    // n 은 지문에 넣지 않는다 — market-stats 의 n 은 "지표 × 조회 창 기간 수"라 라벨이 바뀐 뒤
    // 몇 달 동안 매달 늘어 매달 재알림이 된다(검사관 지적). n 은 본문에만, 이름은 정렬해서.
    const fp = fingerprintIds([`${collector}|${[...parsed.names].sort().join(",")}`]);
    const shown = parsed.names.slice(0, REGION_UNRESOLVED_NAME_LIMIT);
    const rest = parsed.names.length - shown.length;
    const nameText = `${shown.join(", ")}${rest > 0 ? ` 외 ${rest}건` : ""}`;
    issues.push({
      kind: "region-unresolved",
      collector,
      detail: `${collector} · KOSIS 시도 이름 못 맞춘 행 ${parsed.n}건 — ${nameText}`,
      lines: [
        "이 행들은 어느 시도에도 넣지 못하고 건너뛰었습니다 — 그 시도 값은 새로 갱신되지 않고 이전 값이 남습니다.",
        ...(parsed.names.some((nm) => nm.startsWith("전남광주"))
          ? ["통합 시도 합계(전남광주)는 시군구로 가를 수 없는 표라, 원천이 광주·전남을 따로 주기 전까지 새 값이 안 들어옵니다."]
          : []),
        ...(toKst(latest.finished_at) ? [`최근 실행: ${toKst(latest.finished_at)}`] : []),
      ],
      at: `${fp}@${streakStart}`,
    });
  }
  return issues;
}

/**
 * ⑫(a) 만료 경보 여유(일) — KOSIS 수집기는 매월 9일 1회라, 만료 뒤 다음 회차까지 applyhome 으로 남는 게
 * 정상이다. 그 한 주기(최대 31일) + 여유를 넘겨도 applyhome 이면 경보.
 */
export const APPLYHOME_EXPIRY_ALERT_GRACE_DAYS = 35;

/** ⑫ 경보 detail 에 펼칠 단지 수 — 나머지는 "외 N곳". */
export const APPLYHOME_UNSOLD_SAMPLE_LIMIT = 8;

/**
 * ⑫(d) 사람 보류(hold) 기준 명단(세션570, 사장님 결정 2026-09-24) — 세션569 가 "자료 없음"으로 비운 11곳.
 * + 세션571 대표 2행(사장님 결정 2026-09-24 ⓐ — 화면 대표 행의 0 도 근거 없음: 마지막 청약홈 기록이 2022 무순위 27/1·8/3, 이후 공고 없음).
 * DB 의 hold 명단이 이것과 다르면(추가·해제) 알린다. 의도한 변경이면 이 상수를 같은 PR 에서 고친다
 * (개수가 아니라 **명단**으로 비교한다 — 하나 풀리고 하나 생기면 개수는 같다, expect-ids-not-counts).
 */
export const HOLD_BASELINE_IDS = Object.freeze([
  "ah-2021910123", "ah-2021910165", "ah-2022910170", "ah-2022910216", "ah-2022910285", "ah-2022910303",
  "ah-2022910320", "ah-2022910325", "ah-2022910363", "ah-2025910235", "ah-2025910236", "ah-2025910250",
  "ah-2025910274",
]);

/** ⑫(e) 보류 재검토 기간(개월) — 보류일(unsold_as_of) + 이 기간이 지나면 재검토 알림. 자동 해제는 없다. */
export const HOLD_REVIEW_MONTHS = 6;

/**
 * ⑫ 청약홈(applyhome) 출처 미분양 값 점검 — 만료 기준 C6(세션569, 사장님 결정 2026-09-24 🟡8).
 *
 * 세 명단을 **id 로** 본다(개수만 비교하면 명단이 뒤바뀐 것을 놓친다 — expect-ids-not-counts):
 *   (a) 공고일 + 6개월 + 여유(35일)가 지났는데 아직 applyhome — KOSIS 가 덮었어야 하는데 못 덮었다
 *       (매칭 실패·50% 보류·임대 등 — 그 값이 영구 동결될 수 있다)
 *   (b) 공고일(unsold_as_of)이 빈 applyhome — 만료를 판정할 수 없어 영구 존중된다
 *   (c) 평형별 미달 0 인데 unsold > 0 인 applyhome — 경쟁률 수집기가 0 으로 안 바꾼 행
 *       (값이 다른 회차 것이라 건너뛴 경우 — 사람이 회차를 확인해야 한다)
 * 사람 보류(hold, 세션570) 두 명단 — (a)(b)(c) 는 applyhome 만 보므로 hold 행이 섞여도 영향 없다:
 *   (d) DB 의 hold 명단 ≠ 기준 명단(`HOLD_BASELINE_IDS`) — 추가·해제된 id 를 펼친다
 *   (e) 보류일(unsold_as_of) + 6개월이 지난 hold — 재검토 알림(자동 해제 없음)
 * `at` 은 시각이 아니라 **명단 지문**이다 — 같은 명단이면 dedup 으로 침묵, 명단이 바뀌면 다시 알린다
 * (`ALWAYS_DEDUP_KINDS`, ⑨ 와 같은 방식).
 *
 * @param {Array<{ id?: string|null, name?: string|null, unsold?: number|null, unsold_source?: string|null, unsold_as_of?: string|null, competition_shortfall?: number|null }>} rows
 *   applyhome·hold 출처 행(다른 출처가 섞여 있어도 걸러낸다).
 * @param {{ now?: Date, holdBaseline?: readonly string[] }} [opts] holdBaseline 없으면 HOLD_BASELINE_IDS
 * @returns {Issue[]}
 */
export function checkApplyhomeUnsold(rows, opts = {}) {
  const now = opts.now ?? new Date();
  const holdBaseline = [...(opts.holdBaseline ?? HOLD_BASELINE_IDS)].sort();
  const graceNow = new Date(now.getTime() - APPLYHOME_EXPIRY_ALERT_GRACE_DAYS * 86400000);
  const ah = rows.filter((r) => r?.unsold_source === "applyhome" && r?.id);
  const expired = ah.filter((r) => isApplyhomeExpired(r.unsold_as_of, graceNow) === true);
  const noDate = ah.filter((r) => isApplyhomeExpired(r.unsold_as_of, now) == null);
  const soldOutPositive = ah.filter((r) => r.competition_shortfall === 0 && (r.unsold ?? 0) > 0);

  /** @param {typeof ah} list */
  const idsOf = (list) => list.map((r) => String(r.id)).sort();
  /** @param {typeof ah} list */
  const sample = (list) => {
    const shown = list.slice(0, APPLYHOME_UNSOLD_SAMPLE_LIMIT).map((r) => `${r.name ?? r.id}(${r.id})`);
    const rest = list.length - shown.length;
    return `${shown.join(" · ")}${rest > 0 ? ` 외 ${rest}곳` : ""}`;
  };

  /** @type {Issue[]} */
  const issues = [];
  if (expired.length > 0) {
    issues.push({
      kind: "applyhome-unsold",
      collector: "unsold-applyhome",
      detail: `(a) 공고 ${APPLYHOME_EXPIRY_MONTHS}개월이 지났는데 아직 청약홈 값인 단지 ${expired.length}곳 — ${sample(expired)}`,
      lines: [
        `KOSIS 수집기(매월 9일)가 공고일 + ${APPLYHOME_EXPIRY_MONTHS}개월이 지난 청약홈 값을 덮었어야 하는데 못 덮었습니다(여유 ${APPLYHOME_EXPIRY_ALERT_GRACE_DAYS}일 포함).`,
        "그 지역 KOSIS 매칭 실패·추정률 50% 이상 보류·임대형이면 값이 그대로 남습니다 — 최근 kosis-unsold 로그의 [C6 만료] 줄을 보세요.",
      ],
      at: `expired:${fingerprintIds(idsOf(expired))}`,
    });
  }
  if (noDate.length > 0) {
    issues.push({
      kind: "applyhome-unsold",
      collector: "unsold-applyhome",
      detail: `(b) 공고일(unsold_as_of)이 빈 청약홈 값 ${noDate.length}곳 — ${sample(noDate)}`,
      lines: [
        "공고일이 없으면 만료를 판정할 수 없어 청약홈 값이 영구히 존중됩니다.",
        "청약홈 공고 원문에서 그 값을 만든 공고의 공고일을 찾아 backfill-unsold-source.mjs --plan= 으로 채우세요.",
      ],
      at: `nodate:${fingerprintIds(idsOf(noDate))}`,
    });
  }
  if (soldOutPositive.length > 0) {
    issues.push({
      kind: "applyhome-unsold",
      collector: "unsold-applyhome",
      detail: `(c) 경쟁률은 평형별 미달 0(완판)인데 미분양 값이 남은 청약홈 단지 ${soldOutPositive.length}곳 — ${sample(soldOutPositive)}`,
      lines: [
        "경쟁률 수집기는 값이 그 경쟁률 회차의 것(값 = 그 회차 공급 수)일 때만 0 으로 바꿉니다.",
        "값이 다른 회차(뒤 회차의 잔여·임의 공고) 것이면 건너뜁니다 — 어느 회차 값인지 사람이 확인하세요.",
      ],
      at: `soldout:${fingerprintIds(idsOf(soldOutPositive))}`,
    });
  }

  // (d)(e) 사람 보류(hold, 세션570)
  const hold = rows.filter((r) => r?.unsold_source === "hold" && r?.id);
  const holdIds = idsOf(hold);
  const holdSet = new Set(holdIds);
  const baseSet = new Set(holdBaseline);
  const added = holdIds.filter((id) => !baseSet.has(id));
  const released = holdBaseline.filter((id) => !holdSet.has(id));
  if (added.length > 0 || released.length > 0) {
    issues.push({
      kind: "applyhome-unsold",
      collector: "unsold-applyhome",
      detail: `(d) 사람 보류(hold) 명단이 기준과 다름 — 추가 ${added.length}: ${added.join(",") || "-"} · 해제 ${released.length}: ${released.join(",") || "-"}`,
      lines: [
        "hold = 사람이 '자료 없음'을 확정해 수집기가 덮지 않는 단지입니다. 기준 명단은 monitor-collectors.mjs 의 HOLD_BASELINE_IDS.",
        "의도한 변경(backfill-unsold-source.mjs 의 mark_hold·release_hold_*)이면 기준 명단을 같은 PR 에서 고치세요. 아니면 누가 출처를 바꿨는지 확인하세요.",
      ],
      at: `hold:${fingerprintIds(holdIds)}`,
    });
  }
  const holdStale = hold.filter((r) => isApplyhomeExpired(r.unsold_as_of, now, HOLD_REVIEW_MONTHS) === true);
  if (holdStale.length > 0) {
    issues.push({
      kind: "applyhome-unsold",
      collector: "unsold-applyhome",
      detail: `(e) 보류 ${HOLD_REVIEW_MONTHS}개월 지남 — 재검토(자동 해제 없음) ${holdStale.length}곳 — ${sample(holdStale)}`,
      lines: [
        `보류일(unsold_as_of) + ${HOLD_REVIEW_MONTHS}개월이 지났습니다. 그 사이 청약홈·KOSIS 에 자료가 생겼는지 사람이 확인하세요.`,
        "해제는 backfill-unsold-source.mjs 계획 파일(release_hold_to_null = 다음 회차가 채움 / release_hold_to_applyhome = 공고 값으로)로만 합니다.",
      ],
      at: `holdstale:${fingerprintIds(idsOf(holdStale))}`,
    });
  }
  return issues;
}

/**
 * ⑫ 대상 행 — applyhome·hold 출처만(전체 3,068행 중 수십 곳). 칸이 없으면(마이그 전) 조회가 실패하고
 * 호출부가 fail-open 으로 넘긴다.
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchApplyhomeUnsoldRows() {
  return /** @type {Array<Record<string, any>>} */ (await selectAll(
    (s) => s.from("apartments").select("id, name, unsold, unsold_source, unsold_as_of, competition_shortfall").in("unsold_source", ["applyhome", "hold"]),
    getSupabase(),
    "id",
  ));
}

/**
 * ⑬ 창(시간) — daily 가 24시간마다 돌지만 GH daily 가 하루 빠지면(실행 실패·수동 스킵) 26시간 창은
 * 그 실패 행을 놓친다. 24시간(하루 공백) + 24시간(정상 주기) + 2시간 여유 = 50시간(세션570).
 * 창이 겹쳐 같은 행을 두 번 보면 `ALWAYS_DEDUP_KINDS`(kind+collector+at=finished_at)가 두 번째를 막는다.
 */
export const LOCAL_FAILURE_WINDOW_HOURS = 50;

/**
 * ⑬ 실패 비율 하한 — 이 비율 이상이 실패여야 울린다. naver-presale 은 1,301건 중 4건(0.3%) 실패로도
 * status=failure 를 남기는데(지역명 못 맞춤 등 개별 건), 그건 수집이 통째로 망가진 게 아니다.
 */
export const LOCAL_FAILURE_RATIO_LIMIT = 0.1;

/**
 * ⑬ 로컬 수집기 실패 명단(세션570).
 *
 * 왜 따로 보나: 로컬 러너(Windows 예약 작업)가 돌리는 수집기가 `collector_runs.status=failure` 로
 * 끝나도 **어느 감시에도 안 보였다** — ① 은 GitHub 실행만, ② 는 success 행만(:521), ⑤ 는 신선도만 본다
 * (failure 도 "돌긴 돌았다" 라 신선하다). 그래서 10/09 미분양 러너가 차단기로 failure 로 끝나도 무음이었다.
 *
 * 판정 = `status === "failure"` 이고 (`ok_count` 0 **또는** 실패 비율 ≥ `LOCAL_FAILURE_RATIO_LIMIT`).
 *   ok 0 은 비율 1 로 계산돼 비율 조건 하나로 합쳐진다(합 0 인 차단기 행도 1).
 *   - 울림: kosis-unsold 차단기(ok 0) · naver-pipeline 치명 단계 실패(STEP_FAILED 마커, ok ≤ 4 · fail 1 → 비율 ≥ 20%)
 *   - 침묵: naver-presale 4/1301(0.3%) · naver-collect `partial`(시간 상한 정상 중단) · success 행
 * ⚠️ GitHub 워크플로 수집기가 failure 행을 남기면 ① 과 겹쳐 두 번 알릴 수 있다(판정은 이름이 아니라 상태로 한다).
 * `at` = `finished_at` 이라 같은 행은 한 번만 알리고(dedup), 창(26시간) 밖으로 나가면 자연 소멸한다.
 *
 * @param {Array<{ collector?: string|null, status?: string|null, ok_count?: number|null, fail_count?: number|null, error_message?: string|null, finished_at?: string|null }>} rows
 *   최근 창 안의 collector_runs 행(status 무관).
 * @param {{ now?: Date, windowHours?: number, ratioLimit?: number }} [opts]
 * @returns {Issue[]}
 */
export function checkLocalFailures(rows, opts = {}) {
  const now = opts.now ?? new Date();
  const windowHours = opts.windowHours ?? LOCAL_FAILURE_WINDOW_HOURS;
  const ratioLimit = opts.ratioLimit ?? LOCAL_FAILURE_RATIO_LIMIT;
  /** @type {Issue[]} */
  const issues = [];
  for (const r of rows) {
    if (r?.status !== "failure" || !r.finished_at) continue;
    const ageH = (now.getTime() - new Date(r.finished_at).getTime()) / 3600000;
    if (!(ageH <= windowHours)) continue;
    const ok = r.ok_count ?? 0;
    const fail = r.fail_count ?? 0;
    // ok 0 이면 비율은 늘 1 이다 — fail>0 이면 fail/fail, 합이 0(차단기처럼 한 건도 안 건드리고 멈춤)이면 1 로 본다.
    const ratio = ok + fail > 0 ? fail / (ok + fail) : 1;
    const msg = (r.error_message ?? "").trim();
    // fail_count 가 null/0 인 예외 종료 — 수집기가 try/catch 로 죽으면 fail_count 를 안 채우고
    // error_message 만 남긴다(_shared.mjs recordCollectorRun). 비율만 보면 이런 행이 침묵한다
    // (market-stats ok17·fail null·error 있음 / compute-scores ok1500·fail0·error 있음, 세션570).
    const isSilentException = (r.fail_count == null || r.fail_count === 0) && msg !== "";
    if (ratio < ratioLimit && !isSilentException) continue;
    const name = r.collector ?? "(이름 없음)";
    const when = toKst(r.finished_at) ?? r.finished_at;
    issues.push({
      kind: "local-failure",
      collector: name,
      detail: `status=failure · 성공 ${ok} · 실패 ${fail}${msg ? ` · ${msg.slice(0, 80)}` : ""} · ${when}`,
      lines: [
        `실패 비율 ${(ratio * 100).toFixed(1)}% (${fail}/${ok + fail}) — 성공 0건이거나 ${Math.round(ratioLimit * 100)}% 이상이면 알립니다.`,
        `[조치] 로그 = ${name} 를 돌린 로컬 러너 로그 파일(naver-collect.log · kosis-local.log · childcare-local.log) / collector_runs.error_message`,
      ],
      at: r.finished_at,
    });
  }
  return issues;
}

/**
 * ⑬ 대상 행 — 최근 `hours` 시간 안에 끝난 collector_runs 중 status=failure 만(하루 0~몇 행).
 * 판정 함수는 status 를 다시 보므로 여기서 거르는 것은 조회량을 줄일 뿐이다.
 * @param {number} [hours]
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchRecentFailureRuns(hours = LOCAL_FAILURE_WINDOW_HOURS) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const { data, error } = await getSupabase()
    .from("collector_runs")
    .select("collector,status,ok_count,fail_count,error_message,finished_at")
    .eq("status", "failure")
    .gte("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`collector_runs 실패 행 조회 실패: ${error.message}`);
  return data ?? [];
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
 * @param {Array<{ viewKey: string, regionColumn: string, label: string, minRegionRate?: number }>} [targets]
 * @returns {Issue[]}
 */
export function checkViewRegionStale(viewFields, regionStats, targets = VIEW_REGION_STALE_TARGETS) {
  /** @type {Issue[]} */
  const issues = [];
  const regionByCol = new Map(regionStats.map((s) => [s.column, s]));
  for (const { viewKey, regionColumn, label, minRegionRate } of targets) {
    const vf = viewFields[viewKey];
    const rs = regionByCol.get(regionColumn);
    if (!vf || !rs) continue;
    const viewTotal = vf.filled + vf.missing;
    if (viewTotal === 0 || (rs.total ?? 0) === 0) continue;
    const viewRate = vf.filled / viewTotal;
    const regionRate = rs.filled / rs.total;
    // 원본은 충분히 채워졌는데(기본 ≥20%, 대상별 minRegionRate 로 조정) VIEW 는 거의 비었으면
    // (≤5%) = VIEW 가 옛 채움값을 못 가져오는 회귀. supply_ratio 처럼 원본부터 0인 경우는
    // regionRate 가 낮아 제외됨.
    if (regionRate >= (minRegionRate ?? 0.2) && viewRate <= 0.05) {
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

/**
 * ⑦ VIEW 의 시군구 조인(`rg`)으로 노출되는 컬럼 목록.
 *
 * `apartments_flat` 은 `LEFT JOIN latest_regions_gu rg ON rg.region = a.region
 *  AND rg.gu = CASE WHEN a.region = '세종' THEN '세종시' ELSE a.gu END` 로 시군구 지표를 붙인다
 * (세션550 — 세종은 `apartments.gu` 가 NULL 이라 '세종시' 로 맞춘다). 이 짝이 안 맞으면
 * **아래 컬럼이 통째로 빈칸**이 된다. JS 쪽 거울은 `viewJoinGu` 하나뿐이다.
 *
 * ⚠️ VIEW 에 `rg.` 로 노출되는 컬럼을 추가하면 **여기에도 1줄 추가**할 것.
 *    빠뜨리면 그 컬럼만 비어도 ⑦-B(빈 껍데기)가 "전부 비었다" 로 안 보고 조용히 넘어간다.
 *    확인 방법: 최신 `supabase/migrations/*view*.sql` 에서 `rg.` 로 시작하는 SELECT 항목 grep.
 */
/**
 * 좌표 부정확 단지의 **기준 명단** — 개수가 아니라 **id 목록**으로 대조한다(감시 ⑨).
 *
 * ⚠️ 세션565 는 "14 · past:6" 을 **개수로만** 대조해, 명단이 3↔3 뒤바뀐 것(고친 3곳↔안 고친
 * 3곳이 자리를 바꿈)을 놓쳤다(`feedback_expect_ids_not_counts.md`). 개수만 맞으면 내용이
 * 뒤바뀌어도 통과하므로, 세션568 부터는 **id 집합**으로 신규·풀림을 각각 잡는다.
 *
 * 2026-09-23 실측 56곳 → 같은 날 세션565 가 **42곳을 사람 대조·승인으로 정정**해 14곳 →
 * 세션566 이 보류 6곳을 청약홈 원 공고·기사로 확인해 정정(`docs/audits/2026-09-23-coord-approvals-session566.json`)
 * 하고 flag 도구를 "증거 있을 때만 끈다" 로 고쳐 **8곳**(전부 준공 전 2027-02~2028-08, `past:0`).
 * 준공되면 저절로 풀리므로 **명단에서 빠지는 것은 정상**이다 — 명단 밖 새 id 가 나타날 때만 본다.
 * 2026-09-24 세션568 재확인: 라이브 조회로 이 8개 id 와 정확히 일치함을 실측.
 *
 * ⚠️ 이 명단을 임의로 줄이면 매일 거짓 경보가 나 감시가 무뎌진다. 실측 후에만 고친다:
 *   node -e "...apartments 에서 coord_shared=true 인 id 를 정렬해 뽑기..."
 */
export const COORD_SHARED_BASELINE_IDS = [
  "ah-2024910225",
  "ah-2025910011",
  "ah-2025910034",
  "ah-2025910268",
  "ah-2025910269",
  "ah-2025930013",
  "ap-6025734",
  "ap-6028554",
].sort();

/**
 * "같은 좌표를 서로 다른 단지가 공유"하는 **후보** 의 기준 명단 — `groupSharedCoords` 가
 * 뽑는 집합 중 `coord_shared` 로 아직 표시되지 않은 id 들이다.
 *
 * ⚠️ "같은 좌표 = 결함" 은 틀린 잣대다(세션556: 후보로 잡힌 115곳 중 45곳이 멀쩡했다,
 * `feedback_same_coordinate_is_not_a_defect.md`). 그래서 이 명단은 "정상"이 아니라
 * **"이미 알고 있는 후보 풀"** 이다 — 여기 없던 id 가 새로 후보에 들어오면 그것만 알린다.
 *
 * 2026-09-24 세션568 실측: 라이브 `groupSharedCoords` 후보 217개 중 `coord_shared=true`
 * 로 이미 표시된 8개(=COORD_SHARED_BASELINE_IDS)를 뺀 **209개**.
 */
export const COORD_CANDIDATE_BASELINE_IDS = [
  "ah-2021910013", "ah-2021910105", "ah-2021910122", "ah-2021910125", "ah-2021910149",
  "ah-2021910156", "ah-2021910159", "ah-2021910166", "ah-2021910177", "ah-2021910187",
  "ah-2021910188", "ah-2021930007", "ah-2022910022", "ah-2022910023", "ah-2022910028",
  "ah-2022910046", "ah-2022910047", "ah-2022910053", "ah-2022910065", "ah-2022910067",
  "ah-2022910075", "ah-2022910087", "ah-2022910095", "ah-2022910098", "ah-2022910099",
  "ah-2022910100", "ah-2022910114", "ah-2022910122", "ah-2022910132", "ah-2022910141",
  "ah-2022910148", "ah-2022910151", "ah-2022910158", "ah-2022910165", "ah-2022910172",
  "ah-2022910175", "ah-2022910182", "ah-2022910189", "ah-2022910190", "ah-2022910194",
  "ah-2022910196", "ah-2022910197", "ah-2022910205", "ah-2022910212", "ah-2022910213",
  "ah-2022910214", "ah-2022910224", "ah-2022910226", "ah-2022910229", "ah-2022910235",
  "ah-2022910239", "ah-2022910253", "ah-2022910257", "ah-2022910259", "ah-2022910261",
  "ah-2022910269", "ah-2022910270", "ah-2022910273", "ah-2022910280", "ah-2022910286",
  "ah-2022910299", "ah-2022910306", "ah-2022910307", "ah-2022910308", "ah-2022910315",
  "ah-2022910316", "ah-2022910318", "ah-2022910321", "ah-2022910323", "ah-2022910327",
  "ah-2022910329", "ah-2022910335", "ah-2022910337", "ah-2022910340", "ah-2022910342",
  "ah-2022910345", "ah-2022910346", "ah-2022910348", "ah-2022910352", "ah-2022910353",
  "ah-2022910359", "ah-2022910360", "ah-2022910362", "ah-2022910372", "ah-2022910375",
  "ah-2022910376", "ah-2022930004", "ah-2022930023", "ah-2023910008", "ah-2023910018",
  "ah-2023910026", "ah-2023910027", "ah-2023910028", "ah-2023910029", "ah-2023910030",
  "ah-2023910033", "ah-2023910035", "ah-2023910036", "ah-2023910039", "ah-2023910040",
  "ah-2023910045", "ah-2023910046", "ah-2023910048", "ah-2023910049", "ah-2023910050",
  "ah-2023910054", "ah-2023910055", "ah-2023910056", "ah-2023910059", "ah-2023910065",
  "ah-2023910068", "ah-2023910069", "ah-2023910070", "ah-2023910072", "ah-2023910076",
  "ah-2023910079", "ah-2023910080", "ah-2023910081", "ah-2023910085", "ah-2023910089",
  "ah-2023910090", "ah-2023910093", "ah-2023910097", "ah-2023910100", "ah-2023910107",
  "ah-2023910110", "ah-2023910112", "ah-2023910113", "ah-2023910114", "ah-2023910120",
  "ah-2023910123", "ah-2023910128", "ah-2023910129", "ah-2023910132", "ah-2023910133",
  "ah-2023930003", "ah-2023930019", "ah-2023930042", "ah-2023930044", "ah-2024910001",
  "ah-2024910002", "ah-2024910005", "ah-2024910014", "ah-2024910018", "ah-2024910022",
  "ah-2024910023", "ah-2024910024", "ah-2024910025", "ah-2024910028", "ah-2024910034",
  "ah-2024910038", "ah-2024910042", "ah-2024910045", "ah-2024910053", "ah-2024910054",
  "ah-2024910056", "ah-2024910064", "ah-2024910065", "ah-2024910068", "ah-2024910078",
  "ah-2024910081", "ah-2024910086", "ah-2024910089", "ah-2024910094", "ah-2024910095",
  "ah-2024910097", "ah-2024910098", "ah-2024910118", "ah-2024910120", "ah-2024910123",
  "ah-2024910127", "ah-2024910144", "ah-2024910166", "ah-2024910170", "ah-2024910184",
  "ah-2024910208", "ah-2024910221", "ah-2024910240", "ah-2024910241", "ah-2024930009",
  "ah-2024930024", "ah-2024930035", "ah-2024930039", "ah-2024930047", "ah-2024930048",
  "ah-2024930060", "ah-2025910074", "ah-2025910104", "ah-2025910156", "ah-2025910157",
  "ah-2025910171", "ah-2025910179", "ah-2025910185", "ah-2025910263", "ah-2025910279",
  "ah-2025910280", "ah-2025930006", "ah-2025930018", "ah-2025930019", "ah-2025930027",
  "ah-2025930028", "ah-2025930031", "ah-2025930042", "ah-2026910003", "ah-2026910004",
  "ah-2026930001", "ah-2026930029", "ap-6026674", "ap-6028058",
].sort();

/**
 * **daily 모드에서도 dedup 을 타는** collector — 사람이 손대야만 풀리는 지속 상태 (세션563).
 *
 * 기본값은 "daily 는 dedup 미적용"(지속 상태를 하루 1회 리마인드하는 게 의도)인데, 여기 든
 * collector 는 그 리마인드가 **영구 도배**가 된다. 짝 규칙: 그 이슈의 `at` 은 시각이 아니라
 * **상태 지문**이어야 한다(안 그러면 키가 매일 달라져 dedup 이 무효다).
 */
export const ALWAYS_DEDUP_COLLECTORS = new Set(["coord-shared"]);

/**
 * daily 에서도 dedup 할 **이슈 종류**(세션569). ⑪ 은 수집기 이름(market-stats 등)이 ②⑤ 와 겹쳐서
 * 수집기 이름으로 묶으면 그쪽 리마인드까지 막힌다 — 그래서 종류로 가른다.
 */
// ⑫ 도 사람이 고쳐야 풀린다(세션569). ⑬ local-failure 는 at=finished_at(행마다 고유)이라 같은 실패 행을
// 창(26시간)이 겹친 이튿날 한 번 더 알리지 않게 dedup 한다(세션570) — 새 실패 행은 새 키라 그대로 울린다.
export const ALWAYS_DEDUP_KINDS = new Set(["region-unresolved", "applyhome-unsold", "local-failure"]);

/**
 * @param {Issue} issue
 * @returns {boolean} daily 에서도 dedup 대상인가
 */
export function isAlwaysDedup(issue) {
  return ALWAYS_DEDUP_COLLECTORS.has(issue.collector) || ALWAYS_DEDUP_KINDS.has(issue.kind);
}

/**
 * dedup 을 거칠(= 이미 보낸 키면 빼고, 보낸 뒤 키를 기록할) 이슈. run 모드 = 전부,
 * daily = "항상 dedup" 대상(⑨·⑪)만 — ①~⑧·⑩ 의 daily 하루 1회 리마인드는 그대로 둔다.
 * main 의 거르기와 기록이 **같은 이 함수**를 쓴다(한쪽만 넓어지면 dedup 이 죽거나 리마인드가 죽는다).
 * @param {Issue[]} issues
 * @param {string} mode
 * @returns {Issue[]}
 */
export function dedupScope(issues, mode) {
  return mode === "run" ? issues : issues.filter(isAlwaysDedup);
}

export const GU_JOIN_COLUMNS = [
  "fertility_rate",
  "doctors_per_1k",
  "hospital_beds_per_1k",
  "housing_price",
];

/** ⑦ 경보 본문에 펼칠 최대 (region,gu) 쌍 수 — 나머지는 "외 N쌍" 으로 접는다. */
const ORPHAN_GU_LINE_LIMIT = 8;

/**
 * ⑦ `apartments.gu` ↔ `regions` 시군구 행의 짝 불일치 탐지 (세션549).
 *
 * 왜 ④(NULL 급증)로는 못 보나: ④ 는 **전국 채움 비율**만 본다. 개편으로 새 구가 4개 생겨
 * 그 행만 비면 0.19%p 라 어떤 임계에도 안 걸린다. 그런데 화면에서는 그 구의 단지들이
 * GU_JOIN_COLUMNS 4칸을 **통째로** 잃는다. 세션545(전남광주)·548(인천)·549(일반구 표기)
 * 세 번 다 사람이 우연히 발견했다 — 구조적으로 보이지 않는 자리라서다.
 *
 * 두 가지 이상:
 *   A "짝 없음"   — 단지는 있는데 그 (region,gu) 의 `regions` 행이 **아예 없다**.
 *                   표기 불일치(`권선구` vs `수원시 권선구`)·개편 직후 미생성이 원인.
 *   B "빈 껍데기" — 행은 있는데 **모든 recorded_at 행에서 GU_JOIN_COLUMNS 가 전부 NULL**.
 *                   개편으로 막 생긴 행이 원천 미갱신으로 비어 있는 상태.
 *
 * ⚠️ B 는 **전부 비었을 때만** 울린다. 일부만 빈 것은 정상이다 — 라이브 실측(2026-09-20):
 *    `housing_price` 는 공동주택 없는 시 단위 8쌍(`충남|천안시` 등)에서, `hospital_beds_per_1k`
 *    는 `강원|고성군` 에서 정상적으로 비어 있다. 이걸 울리면 매일 나가는 소음이 되고,
 *    소음이 되는 경보는 곧 무시당한다(이 파일의 ④ housing_price 제외 사유와 같은 결).
 *
 * 텔레그램 도배를 막으려고 **종류당 1건**으로 모은다(쌍마다 1건이면 34건이 한 번에 나간다).
 *
 * @param {Array<{ region?: string|null, gu?: string|null, count?: number|null }>} aptPairs
 *   apartments 를 region+gu 로 묶은 것 (gu 가 빈 행은 호출부에서 이미 빠져 있어도 무방 — 여기서도 거른다).
 * @param {Array<Record<string, any>>} regionRows
 *   regions 전체 행 (recorded_at 구분 없이). gu 가 있는 행만 의미가 있다.
 * @param {{ columns?: string[] }} [opts] columns 미지정 시 GU_JOIN_COLUMNS.
 * @returns {Issue[]}
 */
export function checkOrphanGuPairs(aptPairs, regionRows, opts = {}) {
  const columns = opts.columns ?? GU_JOIN_COLUMNS;

  /** (region,gu) → 그 짝의 regions 행들이 하나라도 채운 적 있는 컬럼이 있나 */
  /** @type {Map<string, boolean>} */
  const regionHasAnyValue = new Map();
  for (const row of regionRows) {
    const region = row?.region;
    const gu = row?.gu;
    if (!region || !gu) continue;
    const key = `${region}|${gu}`;
    const anyFilled = columns.some((c) => row[c] != null);
    // 한 쌍의 여러 recorded_at 행 중 **하나라도** 값이 있으면 껍데기가 아니다
    // (VIEW latest_regions_gu 가 컬럼별 최신 non-null 을 고르므로 옛 행의 값도 화면에 나온다).
    regionHasAnyValue.set(key, (regionHasAnyValue.get(key) ?? false) || anyFilled);
  }

  /** @type {Array<{ key: string, count: number }>} */
  const missing = [];
  /** @type {Array<{ key: string, count: number }>} */
  const hollow = [];
  for (const p of aptPairs) {
    if (!p?.region || !p?.gu) continue; // 표기 불일치 탐지가 목적이라 trim·정규화는 하지 않는다
    const key = `${p.region}|${p.gu}`;
    const count = Number(p.count ?? 0);
    if (!regionHasAnyValue.has(key)) missing.push({ key, count });
    else if (regionHasAnyValue.get(key) === false) hollow.push({ key, count });
  }

  /** @type {Issue[]} */
  const issues = [];
  /**
   * 쌍 목록 하나를 이슈 1건으로 접는다.
   * @param {Array<{ key: string, count: number }>} pairs
   * @param {"짝 없음" | "빈 껍데기"} kindLabel
   * @param {string} why
   */
  const fold = (pairs, kindLabel, why) => {
    if (pairs.length === 0) return;
    const sorted = [...pairs].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const apts = sorted.reduce((n, p) => n + p.count, 0);
    /** @type {string[]} */
    const lines = [why];
    for (const p of sorted.slice(0, ORPHAN_GU_LINE_LIMIT)) lines.push(`  · ${p.key} ${p.count}곳`);
    const rest = sorted.length - ORPHAN_GU_LINE_LIMIT;
    if (rest > 0) lines.push(`  · 외 ${rest}쌍`);
    lines.push("[조치 1] `normalizeGu` 표기 확인 — apartments.gu 가 regions.gu 와 같은 표기인가");
    lines.push("[조치 2] `.claude/rules/collectors/admin-district-code-reform.md` §2-12 (신설 시군구 지표 승계)");
    issues.push({
      kind: "nulls",
      // dedupKey 는 `kind|collector|at` 이다. collector 에 **쌍 목록 지문**을 넣어 두면, 이 검사가
      // dedup 을 타는 경로(run 모드)로 옮겨져도 두 번째 다른 사고가 첫 경보에 먹혀 침묵하지 않는다.
      // ⚠️ 지금은 ⑦ 이 daily 스윕 전용이고 daily 는 dedup 을 안 탄다(main 의 `mode === "run"` 분기) —
      //    즉 **남아 있는 짝은 매일 다시 알린다**. 알려진 쓰레기 표기는 예외 목록이 아니라 데이터를 고쳐서 없앤다.
      collector: `시군구 지표 ${kindLabel} (${sorted.map((p) => p.key).join(",")})`,
      detail: `${kindLabel} ${sorted.length}쌍 · 단지 ${apts}곳 — apartments.gu 가 regions 시군구 지표와 못 이어져 ${columns.length}칸이 빈칸`,
      lines,
    });
  };

  fold(
    missing,
    "짝 없음",
    `apartments.gu 에 있는데 regions 에 그 시군구 행이 **아예 없습니다** — 화면에서 ${columns.join("·")} 가 빈칸이 됩니다.`,
  );
  fold(
    hollow,
    "빈 껍데기",
    `regions 행은 있는데 ${columns.join("·")} 가 **모든 recorded_at 행에서 전부 NULL** 입니다.`,
  );
  return issues;
}

// ── ⑧ 지역×월 거래 0건 (세션556) ────────────────────────────

/** 0건 판정에 쓰는 직전 개월 수. */
export const TRADE_GAP_LOOKBACK = 3;
/** 직전 평균이 이 값 미만이면 "원래 거래가 드문 곳" 으로 보고 넘어간다. */
export const TRADE_GAP_MIN_BASELINE = 10;
/** 경보 한 건에 넣는 최대 줄 수. */
const TRADE_GAP_LINE_LIMIT = 8;

/**
 * `region × deal_month` 격자에서 **직전 N개월엔 거래가 있었는데 이번 달만 0건**인 칸을 찾는다.
 *
 * ## 왜 필요한가 (세션545 사고)
 *
 * 전남광주 코드 전환(46/29 → 12) 때 옛 코드로 계속 조회해 **전남 202606~08 이 3개월간 0건**
 * 이었는데 아무 알림도 없었다. 외부 API 가 옛 코드에 **에러 대신 0건**을 주기 때문이다 —
 * `collector_runs` 는 success, 수집기 로그는 "0건 수집", 신선도 검사(⑤)는 수집기가 매 회차
 * 잘 도니까 침묵. [[admin-district-code-reform]] §4 가 말하는 그 사각이다.
 *
 * ## 마지막 달은 검사하지 않는다 (거짓 경보 차단)
 *
 * 실거래가는 신고 기한이 있어 **가장 최근 달은 아직 차오르는 중**이다. 세션556 실측:
 * 서울 202607 13,715건 → 202608 8,777건(마지막 달이라 64%). 이 달을 검사하면 매달 경보가 난다.
 * 그래서 `months` 의 **마지막 하나는 제외**한다 — 0건 사고는 한 달 늦게 잡혀도 잡힌다.
 *
 * ⚠️ 0건인 칸이 **연속**이면 경보를 하나로 접는다. 전남 3개월 사고처럼 같은 원인이
 * 여러 달에 걸치는 게 정상이라, 달마다 따로 울리면 dedup 에 먹혀 오히려 묻힌다.
 *
 * @param {Array<{ region?: string|null, deal_month?: string|number|null }>} rows `trades` 행
 * @param {{ lookback?: number, minBaseline?: number }} [opts]
 * @returns {Issue[]}
 */
export function checkTradeMonthGaps(rows, opts = {}) {
  const lookback = opts.lookback ?? TRADE_GAP_LOOKBACK;
  const minBaseline = opts.minBaseline ?? TRADE_GAP_MIN_BASELINE;

  /** @type {Map<string, number>} */
  const grid = new Map();
  /** @type {Set<string>} */
  const monthSet = new Set();
  /** @type {Set<string>} */
  const regionSet = new Set();
  for (const r of rows) {
    const region = r?.region;
    const month = r?.deal_month == null ? "" : String(r.deal_month);
    if (!region || !month) continue;
    grid.set(`${region}|${month}`, (grid.get(`${region}|${month}`) ?? 0) + 1);
    monthSet.add(month);
    regionSet.add(region);
  }
  const months = [...monthSet].sort();
  const regions = [...regionSet].sort();
  // 마지막 달은 아직 차오르는 중 — 검사 대상에서 뺀다(위 주석).
  const checkable = months.slice(0, -1);
  if (checkable.length <= lookback) return [];

  /** @type {Array<{ region: string, months: string[], baseline: number }>} */
  const gaps = [];
  for (const region of regions) {
    /** @type {string[]} */
    let run = [];
    let runBaseline = 0;
    const flush = () => {
      if (run.length) gaps.push({ region, months: [...run], baseline: runBaseline });
      run = [];
      runBaseline = 0;
    };
    for (let i = lookback; i < checkable.length; i++) {
      const cur = grid.get(`${region}|${checkable[i]}`) ?? 0;
      if (cur > 0) {
        flush();
        continue;
      }
      // 직전 lookback 개월 평균. 연속 0 구간에서는 **그 구간 직전**의 값이 기준이 되게
      // 이미 0 으로 센 달도 그대로 넣는다 — 평균이 내려가 minBaseline 밑으로 떨어지면
      // 그 시점부터는 "원래 드문 곳" 과 구분이 안 되므로 run 을 끊는다.
      const prev = [];
      for (let d = 1; d <= lookback; d++) prev.push(grid.get(`${region}|${checkable[i - d]}`) ?? 0);
      const avg = prev.reduce((a, b) => a + b, 0) / lookback;
      if (avg < minBaseline) {
        flush();
        continue;
      }
      if (run.length === 0) runBaseline = avg;
      run.push(checkable[i]);
    }
    flush();
  }

  if (gaps.length === 0) return [];
  const sorted = gaps.sort((a, b) => b.months.length - a.months.length || b.baseline - a.baseline);
  /** @type {string[]} */
  const lines = [
    `직전 ${lookback}개월엔 거래가 있었는데 **이번 달만 0건**인 지역이 있습니다 — 외부 API 가 옛 지역코드에 에러 대신 0건을 주는 사고의 전형입니다.`,
  ];
  for (const g of sorted.slice(0, TRADE_GAP_LINE_LIMIT)) {
    lines.push(`  · ${g.region} ${g.months.join(",")} — 직전 ${lookback}개월 평균 ${g.baseline.toFixed(0)}건`);
  }
  const rest = sorted.length - TRADE_GAP_LINE_LIMIT;
  if (rest > 0) lines.push(`  · 외 ${rest}건`);
  lines.push("[조치 1] `.claude/rules/collectors/admin-district-code-reform.md` §1 — 소비처마다 옛/새 코드를 raw 1회씩 대조");
  lines.push("[조치 2] 그 지역의 LAWD_CD 로 실거래가 API 직접 호출 — 0건이면 코드표, >0 이면 수집기 결함");
  lines.push("[조치 3] 코드표를 고쳤으면 끊긴 기간은 `--months=N --only=<region>` 백필이 필요하다(앞으로만 정상이 된다)");

  return [
    {
      kind: "nulls",
      // dedupKey 는 `kind|collector|at` — 지역·달 지문을 넣어 다른 사고가 첫 경보에 먹히지 않게.
      collector: `지역×월 거래 0건 (${sorted.map((g) => `${g.region}:${g.months.join("/")}`).join(",")})`,
      detail: `${sorted.length}개 지역에서 거래 0건 — 가장 긴 구간 ${sorted[0].region} ${sorted[0].months.length}개월`,
      lines,
    },
  ];
}

// ── ⑩ 주 1회 DB 권한 실측 점검 (세션567) ────────────────────

/**
 * anon/authenticated 가 실행 가능해도 되는 SECURITY DEFINER 함수 — 이름을 알아야 검토가
 * 가능하므로 표에는 이유를 적는다. 현재 이 저장소에 정당한 항목은 없다(비워 둠).
 * @type {Record<string, string>}
 */
export const DEFINER_FUNCTION_ALLOWLIST = {};

/**
 * public 스키마에 설치돼도 되는 확장 — pg_trgm 은 세션566 이 extensions 스키마로 옮겼으므로
 * (`20260923000002_pg_trgm_to_extensions_schema.sql`) public 에는 아무 확장도 없어야 정상이다.
 * @type {string[]}
 */
export const PUBLIC_EXTENSION_ALLOWLIST = [];

/**
 * R4 — anon 이 실제로 공개 읽기 가능해도 되는 표 **이름 명단**(세션567 재실측, 세션568 재설계).
 *
 * 옛 버전은 "표 몇 개"라는 개수만 비교했는데, 그러면 기준 표 하나를 닫고 다른 표 하나를
 * 몰래 열어도(개수가 같으므로) 경보가 안 울린다([[expect-ids-not-counts]] 의 R4 버전).
 * 그래서 **이름 목록**으로 바꾼다 — 개수가 아니라 "이 표들만 anon 공개 읽기여야 한다"는
 * 집합 자체가 진실이다.
 *
 * 도출 방법: `audit_db_permissions()` 실측 스냅샷(2026-09-24, 운영 DB)에서
 * `anon_select === true` 이고 anon 에 적용되는 permissive SELECT/ALL 정책이 있으며 그
 * 정책이 service_role 전용이 아닌 표를 전부 추림(= `evaluateDbPermissions` 의 R4 판정
 * 함수를 그대로 이 스냅샷에 돌린 결과와 동일 — `Public read` 정책 표 20개와 정확히 일치).
 * 이 표들은 손님 화면(apartments_flat 등)이 anon 으로 직접 읽는 구조라 의도된 공개다.
 * 공개 자료 표 이름은 anon key 로 `/rest/v1/` OpenAPI 스키마에서 이미 볼 수 있으므로
 * 저장소에 적어도 새로 드러나는 정보가 없다.
 *
 * R4 는 이 명단 **밖의 표가 새로 공개 읽기**가 되거나, 명단 **안의 표가 닫혀도**(운영
 * 판단 필요) 경보한다 — 개수만 같으면 조용하던 옛 결함을 명단 대조가 막는다.
 * @type {string[]}
 */
export const PUBLIC_READ_TABLES_BASELINE = [
  "air_station_annual", "apartments", "applyhome_cancel_respl", "applyhome_events",
  "applyhome_unit_supply", "builders", "dev_plans", "infra", "market_stats_history",
  "officetel_presale_schedule", "officetel_unit_supply", "presale_schedule_official",
  "prices", "regions", "rental_schedule_official", "rental_unit_supply", "schools",
  "trade_stats", "transport", "unsold_history",
];

/**
 * KST 기준 오늘이 월요일인가. `Intl` 로 시간대를 고정해 서버가 어느 시간대에서 돌든 같은
 * 결과를 낸다([[timezone-consistency]] — UTC/로컬 혼용 금지, 이 저장소는 KST 로 요일을 정한다).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isKstMonday(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);
  return weekday === "Mon";
}

/** 규칙 하나가 텔레그램 메시지에 싣는 항목 줄 상한(세션568). 지문 비교와 같이 쓰려고
 * 세션569 에 `_perm-fingerprint.mjs` 로 옮겼다 — 기존 시험 import 호환을 위해 여기서 다시 내보낸다. */
export { DB_PERM_ITEMS_PER_RULE };

/**
 * R8 — 정의자 뷰(security_invoker 가 참이 아닌 public 뷰)로 둬도 되는 이름 → 이유. 비워 둔다
 * (세션569 — 운영 뷰 2개는 모두 security_invoker=on 이다. 옛 점검 함수가 'on' 을 글자 'true' 로
 * 비교해 정의자 뷰로 잘못 모았는데, 판정 규칙이 없어 경보도 없었다).
 * @type {Record<string, string>}
 */
export const DEFINER_VIEW_ALLOWLIST = {};

/**
 * `audit_db_permissions()` RPC 결과(스냅샷)를 판정 규칙과 대조해 Issue 목록을 만든다.
 * 순수 함수 — DB 호출은 호출부(main)에서 이미 끝낸 뒤 결과만 넘긴다.
 *
 * 판정 R1~R7 (세션568 재설계 — R1/R4 는 "표 권한이 true 인가"가 아니라 "그 역할이 실제로
 * 도달 가능한가"를 본다. Supabase 는 모든 public 표에 anon/authenticated 쓰기 **표 권한**을
 * 기본으로 주므로(GRANT), 표 권한만 보면 거의 모든 표가 걸려 매주 잡음 경보가 된다 — 실제
 * 차단은 RLS 정책이 한다):
 *   R1 anon/authenticated 가 **실제로** 쓸 수 있는 표·칸 — ①표 권한(칸은 column_write_grants)이
 *      있고 ②RLS 가 꺼졌거나 그 역할·명령에 적용되는 permissive 정책이 있는데 그 정책이
 *      service_role 전용이 아니고(anon 은 auth.uid() 요구 정책도 도달 불가로 봄) ③그리고
 *      CLIENT_WRITE_ALLOWLIST 밖이면 경보. TRUNCATE 는 PostgREST 로 호출할 수 없어 제외.
 *      authenticated 가 UPDATE 로 도달 가능하면 갱신 가능한 칸(표 권한이면 전부, 아니면
 *      column_write_grants)을 lines 에 남긴다.
 *   R2 public 기본 표(relkind 'r'/'p') 중 RLS 꺼진 것.
 *   R3 anon/authenticated/public 대상 쓰기 정책 중 조건이 항상 참이거나 로그인 여부만 보는 것
 *      (`_rls-anon-write-policy.test.mjs` 의 `isFlagged`/`ANY_LOGGED_IN` 과 같은 판정을 재사용).
 *   R4 anon 이 실제로 공개 읽기 가능한 표 **명단**이 PUBLIC_READ_TABLES_BASELINE 과 다르면
 *      (늘어도, 줄어도 — 개수가 아니라 집합 대조라 "하나 닫고 하나 여는" 뒤바뀜도 잡는다).
 *   R5 anon/authenticated 실행 가능한 SECURITY DEFINER 함수 — DEFINER_FUNCTION_ALLOWLIST 밖.
 *   R6 public 스키마에 설치된 확장 — PUBLIC_EXTENSION_ALLOWLIST 밖.
 *   R8 정의자 뷰(security_invoker 가 참이 아닌 public 뷰) — DEFINER_VIEW_ALLOWLIST 밖(세션569).
 *   (세션569 보강) R4 는 표 권한뿐 아니라 칸 SELECT 권한(anon_select_any)도 본다 · 제한(RESTRICTIVE)
 *   정책은 도달 근거에서 뺀다 · "로그인 필수"는 정확한 모양 목록일 때만(requiresLogin).
 *   권한 정의 지문(승인 뒤 바뀌었나)은 별도 판정 `evaluatePermissionDrift`(_perm-fingerprint.mjs).
 *
 * @param {Record<string, any> | null} snapshot `audit_db_permissions()` 반환값(RPC 성공 시) 또는 null(R7 — RPC 실패).
 * @param {{
 *   clientWriteAllowlist?: Record<string, string>,
 *   definerAllowlist?: Record<string, string>,
 *   extensionAllowlist?: string[],
 *   definerViewAllowlist?: Record<string, string>,
 *   publicReadTables?: string[],
 *   rpcError?: string | null,
 * }} [rules]
 * @returns {Issue[]}
 */
export function evaluateDbPermissions(snapshot, rules = {}) {
  const clientWriteAllowlist = rules.clientWriteAllowlist ?? CLIENT_WRITE_ALLOWLIST;
  const definerAllowlist = rules.definerAllowlist ?? DEFINER_FUNCTION_ALLOWLIST;
  const extensionAllowlist = rules.extensionAllowlist ?? PUBLIC_EXTENSION_ALLOWLIST;
  const publicReadTables = rules.publicReadTables ?? PUBLIC_READ_TABLES_BASELINE;
  const definerViewAllowlist = rules.definerViewAllowlist ?? DEFINER_VIEW_ALLOWLIST;

  // R7 — RPC 자체가 실패했다. 다른 규칙은 판정할 데이터가 없으므로 여기서 끝낸다.
  if (!snapshot) {
    return [
      {
        kind: "nulls",
        collector: "db-permissions",
        detail: `주간 DB 권한 점검 실행 실패 — ${rules.rpcError ?? "알 수 없는 오류"}`,
        lines: [
          "audit_db_permissions() RPC 호출이 실패했습니다(오류 코드만 기록).",
          "[조치] 함수가 배포됐는지, service_role 에 EXECUTE 권한이 있는지 확인하세요.",
        ],
        at: `rpc-fail:${rules.rpcError ?? "unknown"}`,
      },
    ];
  }

  /** @type {string[]} */
  const lines = [];
  const relations = /** @type {Array<Record<string, any>>} */ (snapshot.relations ?? []);
  const policies = /** @type {Array<Record<string, any>>} */ (snapshot.policies ?? []);
  const definerFunctions = /** @type {Array<Record<string, any>>} */ (snapshot.definer_functions ?? []);
  const publicExtensions = /** @type {string[]} */ (snapshot.public_extensions ?? []);
  const definerViews = /** @type {string[]} */ (snapshot.definer_views ?? []);

  // R1 — anon/authenticated 가 "실제로" 쓸 수 있는 표·칸(표 권한 + RLS 정책 도달 가능성 둘 다 확인).
  // TRUNCATE 는 PostgREST(REST API)로 호출할 수 없으므로 표 권한이 true 여도 실제 위협이 아니다 — 제외.
  const WRITE_CMDS = { insert: "INSERT", update: "UPDATE", delete: "DELETE" };
  /** @type {string[]} */
  const r1 = [];
  for (const rel of relations) {
    if (rel.kind !== "r") continue;
    // ⚠️ 운영 표(OPS_TABLES)도 건너뛰지 않는다 — R4 는 **읽기**만 본다. 운영 표에 공개 쓰기 권한·정책이 다시
    //    열리면 R1 말고는 잡을 규칙이 없다(세션567 메인 검토에서 발견 — 첫 판은 "R4 몫"이라며 건너뛰었다).
    for (const role of /** @type {Array<"anon" | "authenticated">} */ (["anon", "authenticated"])) {
      for (const [priv, cmd] of Object.entries(WRITE_CMDS)) {
        if (rel[`${role}_${priv}`] !== true) continue; // ①표 권한 자체가 없으면 도달 불가
        const reach = reachablePolicy(
          policies,
          rel,
          role,
          /** @type {"SELECT" | "INSERT" | "UPDATE" | "DELETE"} */ (cmd),
        );
        if (!reach.reachable) continue; // ②RLS 가 실제로 막고 있으면 표 권한이 있어도 안전
        const key = `${rel.name}::${reach.policyName ?? "(RLS 꺼짐)"}`;
        if (key in clientWriteAllowlist) continue; // ③검토 완료 목록
        const via = reach.policyName ? `정책="${reach.policyName}"` : "RLS 꺼짐";
        r1.push(`${rel.schema}.${rel.name} — ${role} ${cmd} 실제 도달 가능 (${via})`);
        // authenticated 가 UPDATE 로 도달하면 "무엇을 갱신할 수 있는지"(칸 목록)를 남긴다 —
        // 표 권한이면 사실상 전 칸, column_write_grants 가 있으면 그 칸만(2u 구멍과 같은 모양).
        if (role === "authenticated" && cmd === "UPDATE") {
          const cols = /** @type {Array<Record<string, any>>} */ (rel.column_write_grants ?? [])
            .filter((g) => (g.grantee === "authenticated" || g.grantee === "PUBLIC") && g.privilege === "UPDATE")
            .map((g) => g.column);
          const colList = cols.length > 0 ? cols.join(", ") : "(칸 권한 제한 없음 — 표 전체)";
          r1.push(`  └ 갱신 가능한 칸: ${colList}`);
        }
      }
    }
    for (const grant of rel.column_write_grants ?? []) {
      const key = `${rel.name}::${grant.column}`;
      if (!(key in clientWriteAllowlist)) {
        r1.push(`${rel.schema}.${rel.name}.${grant.column} — ${grant.grantee} ${grant.privilege} (칸 권한, ALLOWLIST 밖)`);
      }
    }
  }
  if (r1.length > 0) {
    lines.push(`[R1] anon/authenticated 쓰기 권한 ${r1.length}건`, ...capRuleItems(r1.map((l) => `  · ${l}`)));
  }

  // R2 — public 기본 표 중 RLS 꺼진 것.
  const r2 = relations.filter((r) => r.kind === "r" && r.rls_enabled !== true).map((r) => r.name);
  if (r2.length > 0) {
    lines.push(`[R2] RLS 꺼진 표 ${r2.length}개`, ...capRuleItems(r2.map((n) => `  · ${n}`)));
  }

  // R3 — anon/authenticated/public 대상 쓰기 정책 중 항상 참(또는 로그인만 하면 참).
  /** @type {string[]} */
  const r3 = [];
  for (const p of policies) {
    if (isRestrictive(p)) continue; // 제한 정책은 스스로 통과시키지 못한다("RESTRICTIVE" 문자열, 세션569 ⑤)
    if (p.cmd === "SELECT") continue;
    const roles = /** @type {string[]} */ (p.roles ?? []).map((r) => String(r).toLowerCase());
    if (!roles.some((r) => RISKY_ROLES_MONITOR.has(r))) continue;
    const key = `${p.table}::${p.name}`;
    if (key in clientWriteAllowlist) continue;
    const usingAlwaysTrue = p.qual == null || isAlwaysTrueForRoles(p.qual, roles);
    const checkAlwaysTrue = p.with_check != null && isAlwaysTrueForRoles(p.with_check, roles);
    const flagged =
      ((p.cmd === "UPDATE" || p.cmd === "DELETE" || p.cmd === "ALL") && usingAlwaysTrue) ||
      checkAlwaysTrue ||
      (p.with_check == null && p.cmd === "INSERT") ||
      (p.with_check == null && (p.cmd === "UPDATE" || p.cmd === "ALL") && usingAlwaysTrue);
    if (flagged) r3.push(`${p.table}::${p.name} (FOR ${p.cmd} TO ${roles.join(",")})`);
  }
  if (r3.length > 0) {
    lines.push(`[R3] 항상 참(또는 로그인만 하면 참) 쓰기 정책 ${r3.length}건`, ...capRuleItems(r3.map((l) => `  · ${l}`)));
  }

  // R4 — anon 이 실제로 공개 읽기 가능한 표 **명단**을 PUBLIC_READ_TABLES_BASELINE 과 대조.
  // 개수만 비교하면 "기준 표 하나를 닫고 다른 표 하나를 여는" 뒤바뀜이 숨는다 — 집합 대조로 막는다.
  const actualPublicRead = new Set(
    relations
      .filter((r) => r.kind === "r")
      // 표 권한 또는 칸 하나라도 SELECT 권한(anon_select_any, 세션569 ⑥) — 칸 권한만으로도 그 칸은 읽힌다.
      .filter((r) => r.anon_select === true || r.anon_select_any === true)
      .filter((r) => reachablePolicy(policies, r, "anon", "SELECT").reachable)
      .map((r) => r.name),
  );
  const baselineSet = new Set(publicReadTables);
  const added = [...actualPublicRead].filter((n) => !baselineSet.has(n)).sort();
  const removed = [...baselineSet].filter((n) => !actualPublicRead.has(n)).sort();
  if (added.length > 0 || removed.length > 0) {
    lines.push(
      `[R4] 공개 읽기 표 명단이 기준과 다릅니다 — 신규 ${added.length}개 / 사라짐 ${removed.length}개`,
      ...capRuleItems(added.map((n) => `  · 신규(명단 밖): ${n}`)),
      ...capRuleItems(removed.map((n) => `  · 사라짐(기준 안): ${n}`)),
    );
  }

  // R5 — anon/authenticated 실행 가능한 SECURITY DEFINER 함수.
  const r5 = definerFunctions
    .filter((f) => (f.anon_execute === true || f.authenticated_execute === true))
    .map((f) => `${f.schema}.${f.name}`)
    .filter((name) => !(name in definerAllowlist));
  if (r5.length > 0) {
    lines.push(`[R5] anon/authenticated 실행 가능 SECURITY DEFINER 함수 ${r5.length}개`, ...capRuleItems(r5.map((n) => `  · ${n}`)));
  }

  // R6 — public 스키마에 설치된 확장.
  const r6 = publicExtensions.filter((e) => !extensionAllowlist.includes(e));
  if (r6.length > 0) {
    lines.push(`[R6] public 스키마에 설치된 확장 ${r6.length}개`, ...capRuleItems(r6.map((n) => `  · ${n}`)));
  }

  // R8 — 정의자 뷰(security_invoker 가 참이 아닌 뷰). 뷰는 만든 사람 권한으로 밑 표를 읽으므로
  // RLS 를 건너뛴다. `CREATE OR REPLACE VIEW` 에서 WITH 를 빼먹으면 옵션이 비워져 이 상태가 된다.
  const r8 = definerViews.filter((n) => !(n in definerViewAllowlist));
  if (r8.length > 0) {
    lines.push(`[R8] 정의자 뷰(security_invoker 아님) ${r8.length}개`, ...capRuleItems(r8.map((n) => `  · ${n}`)));
  }

  if (lines.length === 0) return [];

  return [
    {
      kind: "nulls",
      collector: "db-permissions",
      detail: `주간 DB 권한 점검 — 경보 ${[r1, r2, r3, r5, r6, r8].filter((a) => a.length > 0).length}종` +
        ((added.length > 0 || removed.length > 0) ? " (+R4)" : ""),
      lines,
      at: new Date().toISOString(),
    },
  ];
}

/**
 * 감시 ⑩(db-permissions) 이슈가 있는데 그 전송 결과 중 하나라도 실패했으면 true.
 * 권한 점검 경보는 다른 이슈보다 무겁다 — 텔레그램 전송이 막히면(글자 수 초과·API 오류 등)
 * 사람에게 아무것도 안 가므로, main() 은 이 판정으로 GitHub Actions 자체를 실패시켜
 * Actions 실패 메일을 두 번째 통로로 쓴다(세션568).
 * @param {Array<{ collector: string }>} issues
 * @param {Array<{ sent: boolean }>} sendResults
 * @returns {boolean}
 */
export function permAlertDeliveryFailed(issues, sendResults) {
  const hasPermIssue = issues.some((i) => i.collector === "db-permissions");
  if (!hasPermIssue) return false;
  return sendResults.some((r) => r.sent !== true);
}

/** 감시 ⑩ R1/R4 판정에서 "이미 anon 읽기가 막혔어야 정상"으로 보는 운영 표 4개(세션567). */
export const OPS_TABLES = ["collector_runs", "api_quota_log", "monitor_alert_state", "monitor_daily_snapshot"];

/** 감시 ⑩ R1/R3 에서 위험하다고 보는 역할 — `_rls-anon-write-policy.test.mjs` RISKY_ROLES 와 같은 개념. */
const RISKY_ROLES_MONITOR = new Set(["anon", "authenticated", "public"]);

/**
 * 표현식이 "항상 참"이거나 "로그인만 하면 참"인지 — 정적 가드(`_rls-anon-write-policy.test.mjs`)
 * 의 `isAlwaysTrueFor`/`ANY_LOGGED_IN` 과 같은 판정을 실측 표현식(qual/with_check 문자열)에 적용한다.
 * @param {string} expr
 * @param {string[]} roles
 * @returns {boolean}
 */
function isAlwaysTrueForRoles(expr, roles) {
  const n = String(expr).toLowerCase().replace(/\s+/g, "");
  const ALWAYS_TRUE = new Set(["true", "(true)", "1=1", "(1=1)"]);
  if (ALWAYS_TRUE.has(n)) return true;
  const ANY_LOGGED_IN = new Set([
    "auth.role()='authenticated'",
    "(auth.role()='authenticated')",
    "auth.role()='authenticated'::text",
    "(auth.role()='authenticated'::text)",
    "auth.uid()isnotnull",
    "(auth.uid()isnotnull)",
  ]);
  return ANY_LOGGED_IN.has(n) && roles.some((r) => r === "authenticated" || r === "public");
}

// isServiceRoleOnly(서비스 전용 정확 문구)·requiresLogin(로그인 필수 정확 모양 목록)·isRestrictive 는
// 세션569 에 `_perm-fingerprint.mjs` 로 옮겼다 — 첫 기준선 주의 항목(A1·A9)과 같은 잣대를 쓰기 위해서다.

/**
 * `role` 이 `rel` 표에 `cmd`(SELECT/INSERT/UPDATE/DELETE)로 **실제로** 도달 가능한지 —
 * RLS 가 꺼져 있거나, 그 역할·명령에 적용되는 permissive 정책 중 service_role 전용이
 * 아니고(anon 이면 auth.uid() 요구도 아닌) 정책이 하나라도 있으면 도달 가능.
 * @param {Array<Record<string, any>>} policies
 * @param {Record<string, any>} rel
 * @param {"anon" | "authenticated"} role
 * @param {"SELECT" | "INSERT" | "UPDATE" | "DELETE"} cmd
 * @returns {{ reachable: boolean, policyName: string | null }}
 */
function reachablePolicy(policies, rel, role, cmd) {
  const applicable = policies.filter((p) => {
    if (p.table !== rel.name) return false;
    if (isRestrictive(p)) return false; // "RESTRICTIVE" 문자열(세션569 ⑤) — 옛 `=== false` 비교는 한 번도 안 맞았다
    if (!(p.cmd === cmd || p.cmd === "ALL")) return false;
    const roles = /** @type {string[]} */ (p.roles ?? []).map((r) => String(r).toLowerCase());
    return roles.includes(role) || roles.includes("public");
  });
  if (applicable.length === 0) {
    // 매칭되는 permissive 정책이 없으면 RLS 기본값(deny)이 적용된다 — RLS 가 꺼졌을 때만 도달 가능.
    return { reachable: rel.rls_enabled !== true, policyName: null };
  }
  for (const p of applicable) {
    // 명령에 실제로 걸리는 식만 본다(SELECT=USING, INSERT=WITH CHECK …) — 세션569 검사관 🟡2
    if (policyBlocksRole(p, role, cmd)) continue;
    return { reachable: true, policyName: p.name };
  }
  return { reachable: false, policyName: null };
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
 * regions 핵심 컬럼별 (total, filled) 을 컬럼의 granularity 단위로 조회한다.
 * ⚠️ total·filled 를 같은 단위 필터로 쌍 계산해야 분모 일치 (세션 478 오탐 fix). 단위별 total 은
 * 1회씩만 조회하고 캐시 — 컬럼당 재계산 안 함 (sido/sigungu/all 최대 3회 total + 컬럼당 filled 1회).
 * @returns {Promise<Array<{ column: string, total: number, filled: number }>>}
 */
async function fetchRegionColumnStats() {
  const sb = getSupabase();
  /**
   * granularity 별 단위 필터. @param {any} q PostgrestFilterBuilder (동적 체이닝, TS §4.1 any cast)
   * @param {"sido" | "sigungu" | "all"} g
   */
  const applyGranularity = (q, g) => (g === "sido" ? q.is("gu", null) : g === "sigungu" ? q.not("gu", "is", null) : q);

  /** @type {Partial<Record<"sido" | "sigungu" | "all", number>>} */
  const totalCache = {};
  /** @param {"sido" | "sigungu" | "all"} g */
  const totalFor = async (g) => {
    if (totalCache[g] == null) {
      const { count } = await applyGranularity(sb.from("regions").select("*", { count: "exact", head: true }), g);
      totalCache[g] = count ?? 0;
    }
    return totalCache[g] ?? 0;
  };

  /** @type {Array<{ column: string, total: number, filled: number, nullSurge?: boolean }>} */
  const stats = [];
  for (const { column, granularity, nullSurge } of REGION_KEY_COLUMNS) {
    const total = await totalFor(granularity);
    const { count: filled } = await applyGranularity(
      sb.from("regions").select(column, { count: "exact", head: true }).not(column, "is", null),
      granularity,
    );
    // nullSurge 플래그를 그대로 실어 보낸다 — ④ checkNullSurge 가 이걸 보고 건너뛴다.
    stats.push({ column, total, filled: filled ?? 0, nullSurge });
  }
  return stats;
}

/**
 * ⑧ 이 쓸 `trades` 의 `region`·`deal_month`.
 *
 * ⚠️ 93만 행이라 **고유키 커서**가 필수다 — 무정렬 OFFSET 페이징은 큰 표에서 에러 없이
 *    행을 잃고, 그러면 **있는 거래가 0건으로 보여 거짓 경보**가 난다
 *    (`.claude/rules/collectors/unordered-pagination-loses-rows.md`).
 *
 * @param {any} [sbArg] 테스트 주입용. 생략하면 getSupabase().
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function fetchTradeMonthRows(sbArg) {
  const sb = sbArg ?? getSupabase();
  return await selectAll(
    (s) => s.from("trades").select(["id", "region", "deal_month"].join(", ")),
    sb,
    "id",
  );
}

/**
 * 감시 ⑩ 입력 — `audit_db_permissions()` RPC 1회 호출.
 * 실패해도 throw 하지 않는다(main 이 fail-open 으로 감쌀 필요 없이, 이 함수 자체가
 * `{ snapshot: null, error }` 를 돌려주고 `evaluateDbPermissions` 의 R7 이 그걸 경보로 만든다).
 * @param {any} [sbArg] 테스트 주입용. 생략하면 getSupabase()(service_role).
 * @returns {Promise<{ snapshot: Record<string, any> | null, error: string | null }>}
 */
export async function fetchDbPermissionsSnapshot(sbArg) {
  const sb = sbArg ?? getSupabase();
  const { data, error } = await sb.rpc("audit_db_permissions");
  if (error) return { snapshot: null, error: error.code ?? error.message ?? "unknown" };
  return { snapshot: /** @type {Record<string, any>} */ (data), error: null };
}

/**
 * 감시 ⑩ 지문 입력 — `permission_drift_snapshot()` RPC 1회(현재 지문 + 현재 기준선, 같은 시점).
 * 실패해도 throw 하지 않는다 — `evaluatePermissionDrift` 가 실행 실패 이슈로 만든다.
 * @param {any} [sbArg] 테스트 주입용. 생략하면 getSupabase()(service_role).
 * @returns {Promise<{ snapshot: any, error: string | null }>}
 */
export async function fetchPermissionDriftSnapshot(sbArg) {
  const sb = sbArg ?? getSupabase();
  const { data, error } = await sb.rpc("permission_drift_snapshot");
  // 오류 코드가 빈 문자열로 오는 경우가 있어 ?? 대신 || (빈 코드면 메시지로)
  if (error) return { snapshot: null, error: error.code || error.message || "unknown" };
  return { snapshot: data, error: null };
}

/**
 * 감시 ⑩ 판정 도중 예외(스냅샷 모양이 예상과 다름 등)가 나면 경보도 "이상 없음"도 안 나가 조용해진다 —
 * R7 과 같은 모양의 실행 실패 이슈 1건으로 바꿔 텔레그램으로 보낸다(세션569 검사관 🟡1).
 * @param {string} label
 * @param {unknown} err
 * @returns {Issue}
 */
export function permCheckCrashIssue(label, err) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    kind: "nulls",
    collector: "db-permissions",
    detail: `${label} 실행 실패 — ${msg.slice(0, 120)}`,
    lines: [
      `${label} 판정 중 예외가 났습니다 — 점검 결과를 믿을 수 없습니다.`,
      "[조치] Actions 로그의 ⑩ 줄과 RPC 응답 모양(함수 판)을 확인하세요.",
    ],
    at: `perm-crash:${label}`,
  };
}

/**
 * 감시 ⑩ 두 판정(R1~R8 · 권한 지문)을 각각 try/catch 로 돌린다 — 한쪽 실패가 다른 쪽을 막지 않고,
 * 예외는 `permCheckCrashIssue` 로 이슈가 된다. fetch 함수는 시험 주입용.
 * @param {{ fetchAudit?: typeof fetchDbPermissionsSnapshot, fetchDrift?: typeof fetchPermissionDriftSnapshot }} [deps]
 * @returns {Promise<{ permIssues: Issue[], permCheckCrashed: boolean, driftSnapshot: any }>}
 */
export async function runPermissionChecks(deps = {}) {
  const fetchAudit = deps.fetchAudit ?? fetchDbPermissionsSnapshot;
  const fetchDrift = deps.fetchDrift ?? fetchPermissionDriftSnapshot;
  /** @type {Issue[]} */
  let permIssues = [];
  let permCheckCrashed = false;
  /** @type {any} */
  let driftSnapshot = null;
  try {
    const { snapshot, error } = await fetchAudit();
    permIssues = permIssues.concat(evaluateDbPermissions(snapshot, { rpcError: error }));
  } catch (err) {
    permCheckCrashed = true;
    permIssues.push(permCheckCrashIssue("DB 권한 점검(R 규칙)", err));
    console.log(`[monitor] ⑩ 권한 점검(R 규칙) 실패(감시는 계속): ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const { snapshot: drift, error: driftError } = await fetchDrift();
    driftSnapshot = drift;
    permIssues = permIssues.concat(evaluatePermissionDrift(drift, { rpcError: driftError }));
  } catch (err) {
    permCheckCrashed = true;
    permIssues.push(permCheckCrashIssue("권한 지문 점검", err));
    console.log(`[monitor] ⑩ 권한 지문 점검 실패(감시는 계속): ${err instanceof Error ? err.message : String(err)}`);
  }
  return { permIssues, permCheckCrashed, driftSnapshot };
}

/**
 * 감시 ⑦⑧⑨⑪⑫ 가 조회·판정 도중 예외로 결과를 못 냈을 때의 **실행 실패 이슈** 1건(세션569 최종 검사관 🔴1).
 * 전엔 catch 가 로그만 남겨, 그날 요약이 "이상 없음" 이 됐다 — 칸 이름이 바뀌거나 칸이 빠지는 날
 * 그 감시가 아무 소리 없이 꺼진다. ⑩ 의 `permCheckCrashIssue` 와 같은 결이되, 종류는 `check-failed`
 * (텔레그램 제목 "감시 점검 실행 실패"). daily 하루 1회 리마인드 대상이다(`ALWAYS_DEDUP_*` 아님 —
 * 고치기 전까지 매일 알린다).
 * @param {string} label 어느 점검인지(예: "⑫ 청약홈 미분양 값 점검")
 * @param {unknown} err
 * @returns {Issue}
 */
export function checkFailedIssue(label, err) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    kind: "check-failed",
    collector: "monitor",
    detail: `${label} 실행 실패 — ${msg.slice(0, 120)}`,
    lines: ["이 점검은 오늘 결과를 못 냈습니다 — \"이상 없음\" 이 아닙니다."],
  };
}

/**
 * fail-open 점검 1개를 돌린다 — 예외가 나도 다른 점검은 계속 돌고(감시는 계속), 대신
 * `checkFailedIssue` 1건을 돌려줘 텔레그램으로 나가게 한다.
 * @param {string} label
 * @param {() => Promise<Issue[]>} run
 * @returns {Promise<Issue[]>}
 */
export async function runFailOpenCheck(label, run) {
  try {
    return await run();
  } catch (err) {
    console.log(`[monitor] ${label} 실패(감시는 계속): ${err instanceof Error ? err.message : String(err)}`);
    return [checkFailedIssue(label, err)];
  }
}

/**
 * daily 스윕의 fail-open 점검 여섯(⑦ → ⑨ → ⑧ → ⑪ → ⑫ → ⑬, 옛 main 순서 그대로 + ⑬ 세션570)을 돌려 이슈를 합친다.
 * 조회 함수는 시험 주입용 — 생략하면 운영 조회를 쓴다.
 * @param {{
 *   fetchGuPairs?: () => ReturnType<typeof fetchGuPairStats>,
 *   fetchCoordRows?: () => ReturnType<typeof fetchCoordSharedRows>,
 *   fetchTradeRows?: () => ReturnType<typeof fetchTradeMonthRows>,
 *   fetchRegionRuns?: (names: readonly string[]) => ReturnType<typeof fetchRegionUnresolvedRuns>,
 *   fetchAhRows?: () => ReturnType<typeof fetchApplyhomeUnsoldRows>,
 *   fetchFailureRuns?: () => ReturnType<typeof fetchRecentFailureRuns>,
 * }} [deps]
 * @returns {Promise<Issue[]>}
 */
export async function runDailyGuardedChecks(deps = {}) {
  const fetchGuPairs = deps.fetchGuPairs ?? (() => fetchGuPairStats());
  const fetchCoordRows = deps.fetchCoordRows ?? (() => fetchCoordSharedRows());
  const fetchTradeRows = deps.fetchTradeRows ?? (() => fetchTradeMonthRows());
  const fetchRegionRuns = deps.fetchRegionRuns ?? fetchRegionUnresolvedRuns;
  const fetchAhRows = deps.fetchAhRows ?? fetchApplyhomeUnsoldRows;
  const fetchFailureRuns = deps.fetchFailureRuns ?? (() => fetchRecentFailureRuns());
  /** @type {Issue[]} */
  let issues = [];

  // ⑦ 시군구 짝 불일치 — apartments.gu 가 regions 시군구 행과 안 이어져 rg 조인 4칸이 빈칸 (세션549).
  //    조회 실패가 ①~⑥ 을 통째로 죽이면 안 되므로 fail-open (fetchAhCompetitionCounts 와 같은 결).
  issues = issues.concat(await runFailOpenCheck("⑦ 시군구 짝 점검", async () => {
    const { aptPairs, regionRows } = await fetchGuPairs();
    const orphanIssues = checkOrphanGuPairs(aptPairs, regionRows);
    console.log(`[monitor] ⑦ 시군구 짝 점검: 단지 짝 ${aptPairs.length}개 · regions 행 ${regionRows.length}개 → 이상 ${orphanIssues.length}건`);
    return orphanIssues;
  }));

  // ⑨ 좌표 부정확 단지 — 늘었거나, 준공이 지나 이제 고칠 수 있게 된 것 (세션563, 세션568 명단화).
  //    손님 화면에 경고를 다는 대신 **사장님께 알린다**(사장님 지적 2026-09-23).
  issues = issues.concat(await runFailOpenCheck("⑨ 좌표 부정확 점검", async () => {
    const coordRows = await fetchCoordRows();
    const coordIssues = checkCoordSharedDrift(coordRows);
    const candidateIssues = checkCoordCandidateDrift(coordRows);
    const sharedCount = coordRows.filter((r) => r?.coord_shared === true).length;
    const { candidates } = groupSharedCoords(coordRows);
    const newCandidateCount = candidates.filter((a) => {
      if (a?.coord_shared === true) return false;
      return !new Set(COORD_CANDIDATE_BASELINE_IDS).has(String(a?.id ?? ""));
    }).length;
    console.log(
      `[monitor] ⑨ 좌표 부정확 ${sharedCount}곳(명단 ${COORD_SHARED_BASELINE_IDS.length}) · ` +
      `같은 좌표 후보 ${candidates.length}곳(기준 ${COORD_CANDIDATE_BASELINE_IDS.length}) · ` +
      `새 후보 ${newCandidateCount}`,
    );
    return coordIssues.concat(candidateIssues);
  }));

  // ⑧ 지역×월 거래 0건 — 외부 API 가 옛 지역코드에 **에러 대신 0건**을 주는 사고(세션545 전남 3개월).
  //    ⑤ 신선도는 수집기가 매 회차 잘 돌면 침묵하므로 이 격자를 따로 본다.
  issues = issues.concat(await runFailOpenCheck("⑧ 지역×월 거래 점검", async () => {
    const tradeRows = await fetchTradeRows();
    const gapIssues = checkTradeMonthGaps(tradeRows);
    console.log(`[monitor] ⑧ 지역×월 거래 점검: trades ${tradeRows.length}행 → 이상 ${gapIssues.length}건`);
    return gapIssues;
  }));

  // ⑪ KOSIS 시도 이름 못 맞춤 — 수집기가 collector_runs.error_message 에 남긴 마커(세션569). 매일 본다.
  issues = issues.concat(await runFailOpenCheck("⑪ 시도 이름 못 맞춤 점검", async () => {
    const regionRuns = await fetchRegionRuns(REGION_UNRESOLVED_COLLECTORS);
    const regionIssues = checkRegionUnresolved(regionRuns);
    console.log(`[monitor] ⑪ 시도 이름 못 맞춤 점검: 수집기 ${Object.keys(regionRuns).length}/${REGION_UNRESOLVED_COLLECTORS.length}개 최신 실행 → 이상 ${regionIssues.length}건`);
    return regionIssues;
  }));

  // ⑫ 청약홈 출처 미분양 값 — 만료 기준 C6 의 세 명단(세션569). 매일 본다.
  issues = issues.concat(await runFailOpenCheck("⑫ 청약홈 미분양 값 점검", async () => {
    const ahRows = await fetchAhRows();
    const ahIssues = checkApplyhomeUnsold(ahRows);
    const holdCount = ahRows.filter((r) => r?.unsold_source === "hold").length;
    console.log(`[monitor] ⑫ 청약홈 미분양 값 점검: applyhome ${ahRows.length - holdCount}곳 · hold ${holdCount}곳 → 이상 ${ahIssues.length}건`);
    return ahIssues;
  }));

  // ⑬ 로컬 수집기 실패 명단 — collector_runs.status=failure 는 ①②⑤ 어디에도 안 보였다(세션570).
  issues = issues.concat(await runFailOpenCheck("⑬ 로컬 수집기 실패 점검", async () => {
    const failRows = await fetchFailureRuns();
    const failIssues = checkLocalFailures(failRows);
    console.log(`[monitor] ⑬ 로컬 수집기 실패 점검: 최근 ${LOCAL_FAILURE_WINDOW_HOURS}시간 failure ${failRows.length}행 → 이상 ${failIssues.length}건`);
    return failIssues;
  }));

  return issues;
}

/**
 * id 목록을 **상태 지문**(짧은 해시)으로 접는다 — `at` 은 시각이 아니라 상태를 나타내야
 * dedup(`kind|collector|at`)이 매일 달라지지 않는다(세션563 결). 시각 대신 이 지문을 쓰면
 * id 집합이 같은 동안은 같은 값, 하나라도 달라지면 다른 값이 된다.
 *
 * FNV-1a 32비트 — 암호학적 용도가 아니라 "같은 집합인가" 만 구분하면 되므로 이걸로 충분하다.
 * @param {string[]} ids 정렬 여부는 호출부 책임(정렬 안 하면 순서만 바뀌어도 지문이 달라진다).
 * @returns {string} 8자리 16진수
 */
export function fingerprintIds(ids) {
  let h = 0x811c9dc5;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0; // 구분자 없이도 길이가 다른 id 라 충돌 위험은 실전에서 무시할 수준
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 좌표가 부정확한 단지(`coord_shared`)를 사장님께 알린다 — 감시 ⑨ (세션563, 세션568 명단화)
 *
 * ## 왜 감시인가 (손님 화면이 아니라)
 *
 * 좌표가 남의 단지와 겹치면 지하철·학교·병원·대기질이 **전부 다른 동네 기준**으로 계산된다.
 * 그런데 이건 **우리 데이터 문제**라 손님에게 "정확하지 않을 수 있습니다" 를 보여주는 건
 * 떠넘기기다(사장님 지적 2026-09-23). 고치거나, 못 고치면 **여기서 사장님께 알린다.**
 * 규칙 = `~/.claude/rules/our-defect-is-not-customer-warning.md`.
 *
 * ## 왜 "0건이 될 때까지" 가 아닌가
 *
 * 이 단지들은 **아직 준공 전이라 지도에 없다**. 카카오 POI·청약홈 지번·네이버 실단지 셋 다
 * 못 찾는 게 정상이고(2026-09-23 실측: 정정 대상 0곳), 준공되면 저절로 풀린다. 그래서
 * "있다" 자체는 경보가 아니다. 경보는 **늘었을 때**와 **준공이 지났는데도 안 풀렸을 때**다.
 *
 * ## 왜 개수가 아니라 명단인가 (세션568)
 *
 * 개수만 대조하면 "14곳 → 14곳"처럼 그대로여도 **명단이 3↔3 뒤바뀐** 것을 놓친다
 * (세션565 실사고, `feedback_expect_ids_not_counts.md`). 그래서 이제 명단(id 집합)의
 * **차집합**으로 신규(A-신규)와 풀림(A-풀림)을 각각 잡는다 — 개수가 같아도 내용이 바뀌면
 * 둘 다(신규 N + 풀림 N) 걸린다.
 *
 * @param {Array<{ id?: string|null, name?: string|null, completion?: unknown, coord_shared?: unknown }>} rows
 *   apartments 전체 (coord_shared 포함).
 * @param {{ baselineIds?: string[], now?: Date }} [opts]
 *   baselineIds = 직전에 알려진 id 명단(COORD_SHARED_BASELINE_IDS). now = 준공 경과 판정 기준 시각.
 * @returns {Issue[]}
 */
export function checkCoordSharedDrift(rows, opts = {}) {
  const baselineIds = opts.baselineIds ?? COORD_SHARED_BASELINE_IDS;
  const baselineSet = new Set(baselineIds);
  const now = opts.now ?? new Date();
  const shared = rows.filter((r) => r?.coord_shared === true);
  const sharedIds = shared.map((r) => String(r?.id ?? "")).filter(Boolean);
  const sharedSet = new Set(sharedIds);

  /** @type {Issue[]} */
  const issues = [];

  // (A-신규) 명단에 없던 id 가 새로 표시됐다 — 통로가 다시 뚫렸을 수 있다.
  const newcomers = shared.filter((r) => !baselineSet.has(String(r?.id ?? "")));
  if (newcomers.length > 0) {
    const sample = newcomers.slice(0, 5).map((r) => `${r?.name ?? r?.id}(${r?.id})`).join(" · ");
    issues.push({
      kind: "nulls",
      collector: "coord-shared",
      detail:
        `명단 밖 좌표 부정확 ${newcomers.length}곳 — ${sample} — ` +
        `새 단지가 자리표시 좌표를 받았을 수 있다. scripts/fix-placeholder-addresses.mjs --out=<덤프> 로 판정하라`,
      at: `new:${fingerprintIds(sharedIds.slice().sort())}`,
    });
  }

  // (A-풀림) 명단에 있었는데 이제 표시가 꺼졌다 — 정정됐거나 준공됐다는 뜻. 명단을 갱신하라고 알린다.
  const resolved = baselineIds.filter((id) => !sharedSet.has(id));
  if (resolved.length > 0) {
    issues.push({
      kind: "nulls",
      collector: "coord-shared",
      detail:
        `좌표 부정확 표시가 풀린 곳 ${resolved.length}곳(${resolved.join(" · ")}) — ` +
        `COORD_SHARED_BASELINE_IDS 명단에서 빼라`,
      at: `resolved:${fingerprintIds(sharedIds.slice().sort())}`,
    });
  }

  // (B) 준공일이 지났는데도 안 풀렸다 — 이제는 지도에 있을 테니 **고칠 수 있다**.
  //     이게 이 감시의 핵심이다. 준공 전에는 고칠 재료가 없지만, 준공 후엔 있다.
  const fixable = shared.filter((r) => isPastCompletion(r?.completion, now));
  if (fixable.length > 0) {
    const sample = fixable.slice(0, 5).map((r) => r?.name ?? r?.id).join(" · ");
    issues.push({
      kind: "nulls",
      collector: "coord-shared",
      detail:
        `준공일이 지난 좌표 부정확 단지 ${fixable.length}곳 — 이제 지도에 있으니 **고칠 수 있다**. ` +
        `scripts/fix-placeholder-addresses.mjs --out=<덤프> 후 --apply-from 으로 반영 (예: ${sample})`,
      // ⚠️ `at` 은 **시각이 아니라 상태 지문**이다(세션563 적대검증 🟠, 세션568 명단화 후에도 유지).
      //    이 상태는 사람이 도구를 고쳐야 풀리는데, 시각을 넣으면 `dedupKey`(kind|collector|at)가
      //    매일 달라져 **매일 텔레그램이 온다.** 고칠 방법이 없는 것을 매일 알리면 사장님이
      //    ①~⑧ 까지 통째로 무시하게 된다 — 2차 피해가 1차보다 크다.
      //    id 집합 지문이면 그 집합이 바뀔 때만 새 알림이 간다(= 실제로 진전이 있을 때).
      at: `past:${fingerprintIds(fixable.map((r) => String(r?.id ?? "")).sort())}`,
    });
  }
  return issues;
}

/**
 * 준공일이 지났나 — `completion` 은 `"202407"`(YYYYMM) 꼴이다.
 *
 * ⚠️ **`new Date()` 에 문자열을 그냥 넘기지 마라.** `"202211"` 에 `"-01"` 을 이어 붙이면
 *    자바스크립트가 **서기 202211년 1월**로 읽는다(2026-09-23 실사고 — 그래서 준공 지난 48곳을
 *    "전부 준공 전" 이라 잘못 보고했다). `src/scoring/scorePrice.ts` 의 `parseCompletionMonth`
 *    가 이미 같은 함정을 막아 두었다("20266" 이 서기 20266년으로 통과하는 것) — **그 방식을 따른다**:
 *    정규식으로 형식을 강제하고, 월 범위를 검사하고, Date 생성자에 문자열을 넘기지 않는다.
 *
 * ⚠️ 판독 불가는 **false**. "지났다" 쪽으로 기울면 못 고칠 것을 매일 경보해 감시가 무뎌진다.
 *
 * 2026-09-23 운영 실측 형식 분포: `YYYYMM` 2,609 · 빈값 447 · `"미정"` 9 · `"2029 미…"` 3 ·
 * `YYYY-MM-DD` **0건**. `coord_shared` 56곳은 전부 `YYYYMM`.
 *
 * @param {unknown} completion
 * @param {Date} now
 * @returns {boolean}
 */
export function isPastCompletion(completion, now) {
  const s = String(completion ?? "").trim();
  //                    "202407"                  "2024-07" / "2024-07-01"
  const m = /^(\d{4})(\d{2})$/.exec(s) ?? /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  // 월 범위를 막지 않으면 "202613" 이 Date 생성자에서 조용히 2027-01 로 넘어간다(scorePrice 선례).
  if (month < 1 || month > 12) return false;
  // 월 단위 정수로 비교한다 — Date 생성자를 아예 안 거치므로 위 함정이 원천 차단된다.
  const idx = year * 12 + (month - 1);
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  return idx < nowIdx;
}

/**
 * 감시 ⑨ 입력 — apartments 의 좌표 표시.
 *
 * ⚠️ `fetchGuPairStats` 와 같은 이유로 **고유키 커서**(`selectAll(fn, sb, "id")`)로 훑는다.
 *    정렬 없는 OFFSET 페이징은 1,000행 넘는 표에서 **에러 없이** 행이 샌다
 *    (`.claude/rules/collectors/unordered-pagination-loses-rows.md`). 여기서 행이 새면
 *    `coord_shared` 건수가 실제보다 적게 세어져 **늘어난 것을 놓친다**.
 *
 * `lat, lng` 는 세션568 에서 추가 — `groupSharedCoords` 로 "같은 좌표를 다른 프로젝트가
 * 공유"하는 후보를 이 자리에서 함께 집계하려면 좌표값이 필요하다.
 *
 * @param {any} [sbArg] 테스트 주입용. 생략하면 getSupabase().
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function fetchCoordSharedRows(sbArg) {
  const sb = sbArg ?? getSupabase();
  return await selectAll(
    (s) => s.from("apartments").select(["id", "name", "lat", "lng", "completion", "coord_shared"].join(", ")),
    sb,
    "id",
  );
}

/**
 * "같은 좌표를 서로 다른 프로젝트가 공유"하는 **후보**가 새로 생겼는지 본다 — 감시 ⑨ 보조(세션568).
 *
 * ⚠️ "같은 좌표 = 결함" 은 틀린 잣대다(`feedback_same_coordinate_is_not_a_defect.md` — 세션556
 * 실측: 후보로 잡힌 115곳 중 45곳이 멀쩡했다). 그래서 이 점검은 "후보가 있다" 를 알리지 않는다 —
 * **기준 명단(COORD_CANDIDATE_BASELINE_IDS)에 없던 id 가 새로 후보에 들어왔을 때만** 알린다.
 * 사라진 후보(정정됐거나 더는 겹치지 않게 된 것)는 알리지 않는다 — 정보 손실이 아니라 개선이다.
 *
 * @param {Array<{ id?: string|null, name?: string|null, lat?: unknown, lng?: unknown, coord_shared?: unknown }>} rows
 *   apartments 전체 (lat/lng/coord_shared 포함) — `fetchCoordSharedRows` 결과를 그대로 쓴다.
 * @param {{ baselineIds?: string[] }} [opts] baselineIds = COORD_CANDIDATE_BASELINE_IDS.
 * @returns {Issue[]}
 */
export function checkCoordCandidateDrift(rows, opts = {}) {
  const baselineIds = opts.baselineIds ?? COORD_CANDIDATE_BASELINE_IDS;
  const baselineSet = new Set(baselineIds);

  const { candidates } = groupSharedCoords(rows);
  // "표시 안 된" 후보만 본다 — 이미 coord_shared=true 인 것은 ⑨ 본 점검이 다룬다(중복 회피).
  const notShown = candidates.filter((a) => a?.coord_shared !== true);
  const newcomers = notShown.filter((a) => !baselineSet.has(String(a?.id ?? "")));

  /** @type {Issue[]} */
  const issues = [];
  if (newcomers.length > 0) {
    const sample = newcomers.slice(0, 5).map((a) => `${a?.name ?? a?.id}(${a?.id})`).join(" · ");
    issues.push({
      kind: "nulls",
      collector: "coord-candidate",
      detail:
        `같은 좌표를 다른 프로젝트가 새로 공유 ${newcomers.length}곳 — ${sample} — ` +
        `scripts/fix-placeholder-addresses.mjs --out=<덤프> 로 판정하라`,
      at: `new:${fingerprintIds(notShown.map((a) => String(a?.id ?? "")).sort())}`,
    });
  }
  return issues;
}

/**
 * ⑦ (region,gu) 짝 점검 입력 — apartments 를 region+gu 로 묶은 목록 + regions 시군구 행.
 *
 * ⚠️ 두 조회 다 **고유키 커서**(`selectAll(fn, sb, "id")`)로 훑는다. 정렬 없는 OFFSET 페이징은
 *    1,000행 넘는 표에서 **에러 없이** 행이 샌다 — 여기서 행이 새면 있는 짝이 "짝 없음" 으로
 *    잘못 잡혀 거짓 경보가 된다(`.claude/rules/collectors/unordered-pagination-loses-rows.md`).
 *    apartments 는 2천 행대, regions 는 1천 행대라 둘 다 실제로 페이징이 돈다.
 *
 * @param {any} [sbArg] 테스트 주입용. 생략하면 getSupabase().
 * @returns {Promise<{ aptPairs: Array<{ region: string, gu: string, count: number }>, regionRows: Array<Record<string, any>> }>}
 */
export async function fetchGuPairStats(sbArg) {
  const sb = sbArg ?? getSupabase();
  const apts = await selectAll(
    (s) => s.from("apartments").select("id, region, gu"),
    sb,
    "id",
  );
  // ⚠️ select 는 **배열 join** 으로 조립한다 — 템플릿 리터럴(`` `id, ... ${...}` ``)로 쓰면
  //    정적 가드가 커서 키를 못 읽어 "select 에 id 가 안 보인다" 로 위반 처리한다
  //    (보간 때문에 경계를 못 믿어 건너뛰는 설계 — `_selectall-keycol-coverage.test.mjs` 픽스처 (14)).
  const regionRows = await selectAll(
    (s) => s.from("regions").select(["id", "region", "gu", ...GU_JOIN_COLUMNS].join(", ")),
    sb,
    "id",
  );
  /** @type {Map<string, { region: string, gu: string, count: number }>} */
  const byPair = new Map();
  for (const a of apts) {
    const region = a?.region;
    // ⚠️ VIEW 의 조인 키와 **같은 규칙**으로 만든다(세션550) — `viewJoinGu` 가 SQL CASE 의 거울.
    //    세종은 apartments.gu 가 NULL 이어도 '세종시' 로 조인되므로 여기서도 그 짝을 검사해야 한다.
    //    null(= 세종이 아닌데 gu 가 없는 단지)이면 VIEW 도 조인을 못 하므로 예전처럼 건너뛴다.
    const gu = viewJoinGu(region, a?.gu);
    if (!region || !gu) continue;
    const key = `${region}|${gu}`;
    const cur = byPair.get(key);
    if (cur) cur.count++;
    else byPair.set(key, { region, gu, count: 1 });
  }
  return { aptPairs: [...byPair.values()], regionRows };
}

/**
 * ④ competition 모수(청약홈 ah- 시드 단지)의 총수 + 필드별 채움 수를 센다.
 * apartments_flat 에서 head:true count 4회 (total 1 + 필드 3). 세션 522.
 * 어느 한 쿼리라도 count 를 못 받으면 null — 호출부(scopeCompetitionToAh)가 원본 모수로 되돌린다.
 *
 * @param {any} [sbArg] Supabase 클라이언트. 생략하면 getSupabase() — 테스트에서 주입한다.
 *   기본값 문법 대신 try 안에서 폴백하는 이유: getSupabase() 자체가 던져도 null 로 받아야 한다
 *   (기본 매개변수는 try 밖에서 평가돼 catch 를 못 탄다).
 * @returns {Promise<{ total: number, filled: Record<string, number> } | null>}
 */
export async function fetchAhCompetitionCounts(sbArg) {
  try {
    const sb = sbArg ?? getSupabase();
    /** ah- 단지만 세는 count 쿼리. @param {string | null} field null 이면 total */
    const countAh = async (field) => {
      /** @type {any} */
      let q = sb.from("apartments_flat").select("*", { count: "exact", head: true }).like("id", `${AH_ID_PREFIX}%`);
      if (field) q = q.not(field, "is", null);
      const { count } = await q;
      return count;
    };
    const total = await countAh(null);
    if (total == null) return null;
    /** @type {Record<string, number>} */
    const filled = {};
    for (const f of COMPETITION_FIELDS) {
      const count = await countAh(f);
      if (count == null) return null;
      filled[f] = count;
    }
    return { total, filled };
  } catch (err) {
    // 조회 실패가 감시 자체를 멈추면 안 됨 — 원본 모수로 계속 본다.
    console.log(`[monitor] ah- 모수 조회 실패(원본 모수로 ④ 진행): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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
 * ⑪ 대상 수집기별 최근 `REGION_UNRESOLVED_RUN_WINDOW` 행(error_message 포함, [0] 이 최신 — 판정은
 * 최신 행, 나머지는 dedup 구간 시작 찾기용). collector 별 개별 쿼리 — 전역 최신순 limit 은
 * 매일 도는 수집기가 자리를 차지해 월간 수집기 행이 잘린다(fetchExternalApiRuns 와 같은 이유).
 * @param {readonly string[]} names
 * @returns {Promise<Record<string, Array<{ status: string|null, error_message: string|null, finished_at: string|null }>>>}
 */
async function fetchRegionUnresolvedRuns(names) {
  const sb = getSupabase();
  /** @type {Record<string, Array<{ status: string|null, error_message: string|null, finished_at: string|null }>>} */
  const grouped = {};
  await Promise.all(
    names.map(async (name) => {
      const { data, error } = await sb
        .from("collector_runs")
        .select("collector,status,error_message,finished_at")
        .eq("collector", name)
        .order("finished_at", { ascending: false })
        .limit(REGION_UNRESOLVED_RUN_WINDOW);
      if (error) throw new Error(`collector_runs(${name}) 조회 실패: ${error.message}`);
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

/**
 * ok=0 이 정상인(멱등/삭제형) 수집기 집합 — ② 제외 + 브리핑 "갱신 없음(정상)" 표기에 공용.
 * EXTERNAL_API_COLLECTORS(데이터 부재가 흔한 외부 API 의존) + purge-consults(삭제 대상 0 흔함).
 * @returns {Set<string>}
 */
function idempotentCollectorSet() {
  return new Set([...EXTERNAL_API_COLLECTORS.map((c) => c.collector), "purge-consults"]);
}

/**
 * ★ 매일 아침 현황 브리핑 발송 (세션 478). daily 스윕에서만 호출 — 이상 유무와 무관하게 1통.
 * ⚠️ CI(GitHub Actions)에서만 텔레그램 발송 — 로컬 실행은 콘솔 출력만(운영 채널 오염 차단, ①③ 가드 철학).
 * ⚠️ 시간축 UTC 통일 — 24h 윈도우·snapshot_date 전부 UTC (collector_runs.finished_at 이 UTC DEFAULT NOW()).
 * @param {{ audit: { avgReliability?: number }, externalStaleIssues: Issue[], issueCount: number }} p
 *   audit = 상위 스코프 computeAudit 재사용(새 쿼리 0) / externalStaleIssues = ⑤ 결과(미발화 목록 추출)
 * @returns {Promise<void>}
 */
async function sendDailyBriefing({ audit, externalStaleIssues, issueCount }) {
  try {
    const sb = getSupabase();
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const { data: runs24h } = await sb
      .from("collector_runs")
      .select("collector,status,ok_count,error_message")
      .gte("finished_at", since);

    const todayUtc = now.toISOString().slice(0, 10);
    const yesterdayUtc = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: prevRows } = await sb
      .from("monitor_daily_snapshot")
      .select("fill_rate")
      .eq("snapshot_date", yesterdayUtc)
      .limit(1);
    const prevSnapshot = prevRows?.[0] ?? null;

    const fillRate = audit.avgReliability != null ? Math.round(audit.avgReliability * 10) / 10 : null;
    const staleCollectors = externalStaleIssues.filter((i) => i.kind === "stale").map((i) => i.collector);
    const idempotent = idempotentCollectorSet();
    // 24h 정상 수집 합 — buildBriefing 과 같은 splitRuns 로 1회만 계산(스냅샷 collected_24h 에 재사용).
    const { totalOk } = splitRuns(runs24h ?? [], idempotent);

    const text = buildBriefing({
      runs24h: runs24h ?? [],
      idempotentCollectors: idempotent,
      fillRate,
      prevSnapshot,
      issueCount,
      staleCollectors,
      warnRuns: extractWarnRuns(runs24h ?? []),
      nowIso: now.toISOString(),
    });

    if (process.env.GITHUB_ACTIONS) {
      const result = await sendTelegram(text);
      if (!result.sent) console.log(`[monitor] 브리핑 전송 스킵: ${result.reason}`);
    } else {
      console.log("[monitor] 브리핑(로컬 — 전송 안 함):\n" + text);
    }

    // 오늘 스냅샷 upsert (PK=snapshot_date 라 하루 여러 발화여도 1행). collected_24h = 정상 수집 ok 합.
    const { error } = await sb
      .from("monitor_daily_snapshot")
      .upsert({ snapshot_date: todayUtc, fill_rate: fillRate, collected_24h: totalOk }, { onConflict: "snapshot_date" });
    if (error) console.log(`[monitor] 스냅샷 기록 실패(다음 어제대비 1회 누락 가능): ${error.message}`);
  } catch (err) {
    // 브리핑 실패가 감시 자체를 멈추면 안 됨 (notify-telegram 철학)
    console.log(`[monitor] 브리핑 오류(감시는 계속): ${err instanceof Error ? err.message : String(err)}`);
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
    // daily 스윕 — 전체 점검 (①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬)
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
          "②0건·④NULL·⑤외부API·⑥VIEW·⑦시군구짝 점검은 collector_runs/DB 기반이라 계속 진행.",
      );
    }

    // ② success 인데 0건 — collector_runs 기반이라 로컬에서도 정상 점검.
    // 외부 API 의존 수집기(housing-permits·KOSIS 식)는 0건이 정상이라 ② 에서 제외 — 진짜
    // 장기 중단은 아래 ⑤가 stale_days 임계로 단독 판정(중복 노이즈 차단, 세션 444).
    // purge-consults(삭제 대상 0 흔함)도 멱등 집합에 포함해 제외 — 매일 ok=0 이 정상인데 ② 가 매일
    // 오탐하던 것 정정 (세션 478, 브리핑의 "갱신 없음" 판정과 일치).
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk, { externalApiCollectors: idempotentCollectorSet() }));

    // ④ NULL 급증 — regions 핵심 컬럼 + apartments 19 카테고리
    const regionStats = await fetchRegionColumnStats();
    issues = issues.concat(checkNullSurge(regionStats));
    const audit = computeAudit(await fetchAllFromView(getSupabase(), null));
    // competition 만 모수를 "채울 수 있는 단지"(청약홈 ah- 시드)로 좁혀 판정한다 (세션 522).
    // audit 원본은 그대로 둔다 — ⑥ VIEW 회귀·아침 브리핑이 같은 객체를 쓴다.
    const ahCounts = await fetchAhCompetitionCounts();
    const scoped = scopeCompetitionToAh(audit.categories, audit.fields, ahCounts);
    issues = issues.concat(
      checkCategoryNullSurge(scoped.categories, AUDIT_CATEGORY_BASELINE, scoped.fields),
    );

    // ⑤ 외부 API 장기 중단 — silent fail (success+ok=0) 연속 누적 탐지
    const runsByCollector = await fetchExternalApiRuns(EXTERNAL_API_COLLECTORS);
    const externalStaleIssues = checkExternalApiStale(EXTERNAL_API_COLLECTORS, runsByCollector);
    issues = issues.concat(externalStaleIssues);

    // ⑥ VIEW 회귀 — regions 원본 채움 but VIEW NULL (세션 391 멀티 collector 새-행 lag)
    issues = issues.concat(checkViewRegionStale(audit.fields, regionStats));

    // ⑦ 시군구 짝 · ⑨ 좌표 부정확 · ⑧ 지역×월 거래 · ⑪ 시도 이름 못 맞춤 · ⑫ 청약홈 미분양 값 · ⑬ 로컬 수집기 실패 — 전부 fail-open.
    //    한 점검이 조회 실패해도 나머지는 계속 돌고, 실패한 점검은 "실행 실패" 이슈로 알린다
    //    (세션569 최종 검사관 🔴1 — 전엔 로그만 남아 그날 요약이 "이상 없음" 이 됐다). 본문 = runDailyGuardedChecks.
    issues = issues.concat(await runDailyGuardedChecks());

    // ⑩ 주 1회 DB 권한 실측 점검 — 매일 도는 감시 안에 KST 월요일에만 발화(세션567).
    //    anon key 가 공개된 이 DB 에서 "코드가 이렇게 짜였으니 안전할 것"이 아니라 pg_catalog 를
    //    직접 재는 실측 점검. 기존 서비스 키(getSupabase)만 쓰고 새 비밀값은 만들지 않는다.
    //    다른 점검을 막지 않도록 fail-open — ⑦⑨ 와 같은 패턴.
    const forcePermAudit = process.env.FORCE_DB_PERMISSION_AUDIT === "1";
    //    세션569: R1~R8(지금 위험한 모양인가) 옆에 권한 정의 지문(승인 뒤 바뀌었나)을 병행한다 —
    //    둘은 각각 try/catch(한쪽 실패가 다른 쪽을 막지 않는다). "이상 없음" 은 두 판정 합계 0 이고
    //    둘 다 예외 없이 끝났을 때만 보낸다.
    if (isKstMonday() || forcePermAudit) {
      const { permIssues, permCheckCrashed, driftSnapshot } = await runPermissionChecks();
      if (permIssues.length === 0 && !permCheckCrashed) {
        console.log("[monitor] ⑩ 권한 점검: 통과 (월요일 리마인드)");
        // 경보가 0건이면 issues 에는 안 실리므로(다른 이상이 없으면 "이상 없음"으로 조용히
        // 끝난다), 월요일에 사람이 "점검이 실제로 돌긴 했다"를 알 수 있게 한 줄만 별도 발송.
        if (process.env.GITHUB_ACTIONS) {
          const okInfo = describeDriftOk(driftSnapshot);
          const remindResult = await sendTelegram(`🔎 <b>주간 DB 권한 점검</b> — 이상 없음${okInfo.suffix}${okInfo.notice ? `\n${okInfo.notice}` : ""}`);
          if (!remindResult.sent) {
            console.log(`[monitor] ⑩ 권한 점검 리마인드 전송 실패 — Actions 를 실패로 끝내 실패 메일을 두 번째 통로로 쓴다: ${remindResult.reason}`);
            process.exitCode = 1;
          }
        }
      } else if (permIssues.length > 0) {
        console.log(`[monitor] ⑩ 권한 점검: 경보 ${permIssues.length}건(세부는 텔레그램)`);
      }
      issues = issues.concat(permIssues);
    }

    // ★ 매일 아침 현황 브리핑 (세션 478) — 이상 유무 무관 daily 마다 1통. L1138 early-return 앞에서
    //   별도 발송해야 이상 0건 아침에도 나간다. CI 에서만 발송(로컬은 콘솔).
    await sendDailyBriefing({ audit, externalStaleIssues, issueCount: issues.length });
  }

  if (issues.length === 0) {
    console.log(`[monitor] 이상 없음 (mode=${mode})`);
    return;
  }

  // dedup: run 모드(수집기 ~40개 완료마다 발화)는 같은 이슈를 매번 재알림하므로
  // 이미 보낸 키는 skip. daily(매일 1회 스윕)는 ③stale·④NULL 같은 지속 상태를
  // 하루 1회 리마인드하는 게 의도라 dedup 미적용 — 하루 1회는 도배 아님.
  // ⚠️ daily 라도 `ALWAYS_DEDUP_COLLECTORS` 는 dedup 을 탄다(세션563). ③stale·④NULL 은
  //    "고치면 멈추는" 상태라 하루 1회 리마인드가 옳지만, ⑨ 좌표 부정확은 **사람이 도구를
  //    고쳐야** 풀려서 매일 울면 감시 전체가 무뎌진다. 건수 지문 `at` 과 짝을 이룬다.
  if (mode === "run" || issues.some(isAlwaysDedup)) {
    const scoped = dedupScope(issues, mode);
    const keys = scoped.map(dedupKey);
    const sentKeys = await fetchSentAlertKeys(keys);
    const freshScoped = filterUnsent(scoped, sentKeys);
    const skipped = scoped.length - freshScoped.length;
    if (skipped > 0) console.log(`[monitor] 이미 알린 이상 ${skipped}건 재발송 skip (dedup, mode=${mode})`);
    const fresh = mode === "run" ? freshScoped : issues.filter((i) => !isAlwaysDedup(i) || freshScoped.includes(i));
    issues = fresh;
    if (issues.length === 0) {
      console.log(`[monitor] 새 이상 없음 (전부 이미 알림, mode=${mode})`);
      return;
    }
  }

  console.log(`[monitor] 이상 ${issues.length}건 발견 (mode=${mode})`);
  // 한 통으로 모아 보낸다. 4000자 넘으면 buildMessages 가 이슈 경계에서 나눈다.
  const messages = buildMessages(issues);
  for (const issue of issues) console.log(formatIssueForConsole(issue));
  let anySent = false;
  /** @type {Array<{ sent: boolean, reason?: string }>} */
  const sendResults = [];
  for (const text of messages) {
    const result = await sendTelegram(text);
    sendResults.push(result);
    if (result.sent) anySent = true;
    else console.log(`  [전송 스킵] ${result.reason}`);
  }
  // 발송 성공 시에만 dedup 키 기록 (전송 실패 시 다음 발화에서 재시도되도록).
  // ⚠️ daily 의 "항상 dedup" 대상(⑨·⑪)도 기록해야 dedup 이 산다(세션569). 전엔 run 모드만 기록해
  //    ⑨ 의 키가 monitor_alert_state 에 한 번도 안 쌓였다(운영 coord-shared 행 0건 실측) — 매일 울렸다.
  if (anySent) await recordSentAlerts(dedupScope(issues, mode));
  // 감시 ⑩(db-permissions) 경보는 다른 이슈보다 무겁다 — 전송이 실패하면 Actions 자체를
  // 실패시켜 실패 메일을 두 번째 통로로 쓴다(세션568).
  if (process.env.GITHUB_ACTIONS && permAlertDeliveryFailed(issues, sendResults)) {
    console.log("[monitor] ⑩ 권한 점검 경보 전송 실패 — Actions 를 실패로 끝내 실패 메일을 두 번째 통로로 쓴다");
    process.exitCode = 1;
  }
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("[monitor] 오류:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
