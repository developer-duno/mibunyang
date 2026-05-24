// @ts-check
/**
 * 수집기 감시 스크립트 (수집기 실패 텔레그램 알림 시스템).
 *
 * 4가지 이상을 점검해 발견 시 텔레그램으로 알린다:
 *   ① 실패/취소  — GitHub Actions run conclusion
 *   ② 데이터 0건 — collector_runs 의 ok/skip 모두 0
 *   ③ 미발화      — 마지막 run 이 35일+ 전 (월간 cron 1주기 초과)
 *   ④ NULL 급증   — regions 핵심 컬럼 + apartments 19 카테고리 NULL 비율 점검
 *
 * 모드:
 *   --mode=run    workflow_run 트리거 — 방금 끝난 run 1개만 (①②)
 *   --mode=daily  cron — 전체 스윕 (①②③④)
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
 * 세션 292 박제: dart-builders + sale-price-index 2 개로 출발 (`0 3 15 1,4,7,10 *`, `30 20 16 1,4,7,10 *`).
 */
export const QUARTERLY_CRON_WORKFLOWS = [
  "DART 시공사 재무 수집",
  "KOSIS Sale Price Index Collection",
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
const REGION_KEY_COLUMNS = ["net_migration", "crime_grade", "doctors_per_1k", "hospital_beds_per_1k"];
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
 * @property {"fail"|"empty"|"stale"|"nulls"} kind
 * @property {string} collector
 * @property {string} detail 한 줄 요약 (콘솔 로그·하위호환용)
 * @property {"failure"|"cancelled"|"timed_out"} [conclusion] fail 일 때만 — 워크플로 conclusion
 * @property {string} [url]
 * @property {string[]} [lines] 본문에 펼칠 상세 줄 (점검 함수가 만든 사람 말 문장)
 * @property {string} [at] 이슈 발생 ISO 시각 (formatIssue 가 KST 로 변환)
 */

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
 * @returns {Issue[]}
 */
export function checkEmptyRuns(rows, prevByCollector = {}) {
  /** @type {Issue[]} */
  const issues = [];
  for (const row of rows) {
    if (row.status !== "success") continue;
    const ok = row.ok_count ?? 0;
    const skip = row.skip_count ?? 0;
    if (ok === 0 && skip === 0) {
      const name = row.collector ?? "(이름 없음)";
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
        const sinceCreated = (now.getTime() - new Date(wf.createdAt).getTime()) / 86400000;
        if (sinceCreated <= threshold) continue;
      }
      issues.push({ kind: "stale", collector: wf.name, detail: "실행 기록이 한 번도 없음" });
      continue;
    }
    const ageDays = (now.getTime() - new Date(wf.lastRunAt).getTime()) / 86400000;
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

// ── I/O 래퍼 (실제 API·DB 호출) ─────────────────────────────

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
    // run 모드도 collector_runs 최근분으로 0건 점검 (방금 끝난 수집기 반영)
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk));
  } else {
    // daily 스윕 — 전체 점검 (①②③④)
    // monitor.yml 감시 대상 — ① 실패 알림을 이 목록 워크플로로 한정 (CI 등 비-수집기 제외).
    const monitoredNames = await fetchMonitoredWorkflowNames();
    const runs = await fetchRecentRuns(100); // 50→100: ①탐지 폭 + ③시각 병합 모수 확대
    issues = issues.concat(checkFailedRuns(runs, monitoredNames));
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk));

    // ③ 미발화 — monitor.yml workflows 배열(점검 대상 전체) 기준.
    // 최근 run 에 흔적이 없는 워크플로(=오래 죽은 월간 cron)는 개별 조회로 보충.
    // 워크플로 생성일도 조회 — 신규 워크플로(첫 cron 대기)를 오탐에서 제외.
    const seenNames = new Set(runs.map((r) => r.name).filter(Boolean));
    const missingNames = monitoredNames.filter((n) => !seenNames.has(n));
    const supplement = await fetchLastRunForWorkflows(missingNames);
    const createdAtByWf = await fetchWorkflowCreatedAt();
    const wfList = buildStaleCheckList(monitoredNames, runs, supplement, createdAtByWf);
    issues = issues.concat(checkStaleWorkflows(wfList));

    // ④ NULL 급증 — regions 핵심 컬럼 + apartments 19 카테고리
    issues = issues.concat(checkNullSurge(await fetchRegionColumnStats()));
    const audit = computeAudit(await fetchAllFromView(getSupabase(), null));
    issues = issues.concat(
      checkCategoryNullSurge(audit.categories, AUDIT_CATEGORY_BASELINE, audit.fields),
    );
  }

  if (issues.length === 0) {
    console.log(`[monitor] 이상 없음 (mode=${mode})`);
    return;
  }

  console.log(`[monitor] 이상 ${issues.length}건 발견 (mode=${mode})`);
  // 한 통으로 모아 보낸다. 4000자 넘으면 buildMessages 가 이슈 경계에서 나눈다.
  const messages = buildMessages(issues);
  for (const issue of issues) console.log(formatIssue(issue));
  for (const text of messages) {
    const result = await sendTelegram(text);
    if (!result.sent) console.log(`  [전송 스킵] ${result.reason}`);
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
