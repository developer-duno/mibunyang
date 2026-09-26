// @ts-check
/**
 * 네이버 분양정보 수집기 — pre.land.naver.com 분양 데이터
 *
 * 수집 대상: 전국 분양 아파트/주상복합의 분양가·단계·일정·기본정보
 * ⚠️ 한국 IP 필수 (네이버 부동산 데이터센터 IP 차단)
 *
 * 사용법:
 *   node scripts/collectors/naver-presale.mjs                    # 전체 수집
 *   node scripts/collectors/naver-presale.mjs --dry-run          # DB 미저장
 *   node scripts/collectors/naver-presale.mjs --limit=10         # N개만
 *   node scripts/collectors/naver-presale.mjs --region=서울      # 특정 시도만
 *   node scripts/collectors/naver-presale.mjs --probe            # API 접근성 테스트
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * 매칭 게이트(세션578): 2~4순위(bjd·좌표·이름) 매칭은 분양 주소와 **같은 시도·같은 시군구**(`sameDistrict`)
 * 단지에만 붙는다 — 주소로 시군구를 못 가르면 신규 생성 경로로. 1순위(번호 일치)는 지역 무관.
 */
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import {
  loadEnv, getSupabase, log, logError, createReporter, recordCollectorRun,
  upsertBatch, stringSimilarity, sleep, VALID_REGIONS,
  resolveBuilder, today, resolveRegionName, selectAll, normalizeGu, GU_LAWD_MAP,
} from "./_shared.mjs";
import { isLeaseName, isLeasePresale } from "../../src/constants/leaseTypes.mjs";
import {
  cleanName, stripRoundWords, phaseConsistent, blockConflict, KAKAO_STRONG_SIM, KAKAO_SUB_MIN_LEN,
} from "./_kakao-poi.mjs";

/** @typedef {{ name: string; tier: number; sim: number; reason: "차수충돌" | "이름약함" }} GateBlocked */
/** @typedef {{ id: string; name: string; region: string | null; gu: string | null; dong: string | null; lat: number | null; lng: number | null; bjd_code: string | null; naver_presale_no: string | null; units: number | null; builder: string | null; max_floor: number | null; completion: string | null }} AptForMatch */
/** @typedef {{ byPresaleNo: Map<string, AptForMatch>; byBjd: Map<string, AptForMatch[]>; byId: Map<string, AptForMatch> }} AptIndexes */
/** @typedef {{ build_dtl_cd?: number | string | null; supp_cd?: number | string | null; build_nm?: string; min_price?: number | null; max_price?: number | null; pyper_price?: number | null; supp_sclass?: string | null; supp_proc_step_nm?: string | null; preview_image?: string | null; house_supp_cnt?: number | null; dong_cnt?: number | null; parking_cnt?: number | null; sell_office_phone?: string | null; build_point?: string | null; mvi_date?: string | null; recruit_date?: string | null; schdl_info?: unknown; bclass_nm?: string | null; total_house_cnt?: number | null; cmpy_nm?: string | null; max_flr_cnt?: number | null; ypos?: number | string | null; xpos?: number | string | null; bubdong_code?: string | null; address?: string | null }} ComplexData */
/** @typedef {{ dong_cnt?: number | null; parking_cnt?: number | null; inquiry_tel?: string | null; features?: string | null; move_in_date?: string | null }} DetailData */
/** @typedef {{ preSaleComplexNumber?: number | string | null; announcementPreSaleSequence?: number | string | null; preSaleComplexName?: string | null; preSaleStageCode?: string | null; scheduleName?: string | null; dateInfo?: string | null; _region?: string | null }} ListItem */
/** @typedef {{ presale_min_price: number | null; presale_max_price: number | null; presale_pp: number | null; presale_type: string | null; presale_stage: string | null; presale_stage_code: string | null; presale_image_url: string | null; naver_presale_no: string; naver_presale_seq: string; presale_general_supply: number | null; presale_buildings: number | null; presale_parking: number | null; presale_inquiry: string | null; presale_features: string | null; presale_move_in: string | null; presale_recruit_date: string | null; presale_schedule: unknown; presale_housing_type: string | null; presale_fetched_at: string; _enrich: { units: number | null; builder: string | null; max_floor: number | null; lat: number | null; lng: number | null; completion: string | null; bjd_code: string | null; address: string | null }; _name?: string }} PresaleRow */

// loadEnv + 환경변수 검증은 main()에서 수행 (테스트 시 import 안전)

// ── 상수 ────────────────────────────────────────────────────
const PHASE = "naver-presale";
const PRESALE_BASE = "https://pre.land.naver.com";
const MIN_INTERVAL = 2000;        // 2초 (보수적)
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 20000];

// 17개 시도 cortarNo (naver-collect.py와 동일, 행안부 법정동코드 표준)
// 세션 286 자매 fix — 세종 환각 정정 (population.mjs 세션 285 답습)
//   3600000000 → 3611000000 (세종, 이전 빈 응답 추정)
//   강원/전북은 이미 정정 박제 (5100/5200)
// 세션 545 — 2026-07-01 전남광주통합특별시 출범: 광주 2900000000·전남 4600000000 은 0건,
//   1200000000 하나가 46건(raw 실측 2026-09-10). **두 지역이 같은 코드**라 아래 buildCortarQueries
//   가 중복 호출을 접고, 그 코드로 받은 항목은 시도만으로 지역을 못 가르므로 _region 을 null 로 둔다.
/** @type {Record<string, string>} */
const REGION_CORTAR = {
  "서울": "1100000000", "경기": "4100000000", "인천": "2800000000",
  "부산": "2600000000", "대전": "3000000000", "대구": "2700000000",
  "울산": "3100000000", "세종": "3611000000", "광주": "1200000000",
  "강원": "5100000000", "충북": "4300000000", "충남": "4400000000",
  "경북": "4700000000", "경남": "4800000000", "전북": "5200000000",
  "전남": "1200000000", "제주": "5000000000",
};

/**
 * Phase 1 목록 조회 계획 — cortarNo 로 **중복을 접는다**.
 *
 * 세션545: 광주·전남이 같은 cortarNo("1200000000")를 쓰게 되어, 지역 목록을 그대로 돌면
 * 같은 46건을 두 번 받는다. 접은 뒤 `region` 은 **그 코드를 혼자 쓰는 지역일 때만** 남긴다 —
 * 공유 코드의 항목은 시도만으로 지역을 못 가르므로 `null` 을 넣고, `buildNewApartment` 의
 * `region ?? regionFallback` 폴백 대신 주소 파서(`parsePresaleAddress`)가 가르게 한다.
 *
 * @param {string[]} regions 지역 약칭 목록
 * @param {Record<string, string>} [cortarMap]
 * @returns {Array<{ cortarNo: string, region: string | null, regions: string[] }>}
 */
export function buildCortarQueries(regions, cortarMap = REGION_CORTAR) {
  // ⚠️ "공유 코드인가" 는 **표 전체**로 판정한다. 요청 목록만 보면 `--region=광주` 처럼
  //    한쪽만 돌릴 때 rs.length === 1 이라 region 이 "광주" 로 남고, 그 코드가 실어 오는
  //    전남 단지까지 전부 광주로 오라벨된다(폴백이 주소 파서를 이겨버린다).
  //    코드를 두 지역이 쓰면 **누가 요청했든** 시도만으로는 못 가른다.
  /** @type {Map<string, number>} */
  const useCount = new Map();
  for (const code of Object.values(cortarMap)) useCount.set(code, (useCount.get(code) ?? 0) + 1);

  /** @type {Map<string, string[]>} */
  const byCode = new Map();
  for (const r of regions) {
    const code = cortarMap[r];
    if (!code) continue;
    const hit = byCode.get(code);
    if (hit) hit.push(r);
    else byCode.set(code, [r]);
  }
  return [...byCode.entries()].map(([cortarNo, rs]) => ({
    cortarNo,
    region: (useCount.get(cortarNo) ?? 0) === 1 && rs.length === 1 ? rs[0] : null,
    regions: rs,
  }));
}

const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

// 이미지 URL 허용 도메인
const IMAGE_DOMAINS = ["naver-file.ebunyang.co.kr", "landthumb-phinf.pstatic.net"];

// 매칭 임계값
const MATCH_THRESHOLD_BJD = 0.5;       // 2순위: bjd_code + 이름 유사도
const MATCH_THRESHOLD_GEO = 0.4;       // 3순위: 좌표 근접 + 이름 유사도
const MATCH_THRESHOLD_REGION = 0.7;    // 4순위: 동일 region + 이름 유사도
const MATCH_DISTANCE_M = 500;          // 3순위: 좌표 반경 (미터)
const METERS_PER_DEGREE = 111000;      // 위도 1도 ≈ 111km (근사)
const MIN_UNITS_FOR_INSERT = 20;       // 신규 아파트 최소 세대수
const LIST_PAGE_SIZE = 100;            // 분양 목록 페이지 크기
// 전용면적 상식 범위 — `pickScaleArea` 가 계약면적 오입력·임대 행을 거르는 데 쓴다.
// 실측(2026-08-24, 최저가 주택형 31곳 표본): p05 46.9 · p50 74.8 · p95 113.3 ㎡.
const AREA_MIN_M2 = 20;
const AREA_MAX_M2 = 250;

// ── CLI 인자 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const probeOnly = args.includes("--probe");
// 이미 면적을 아는 단지도 강제로 다시 조회한다(최저가 주택형이 완판돼 바뀐 경우 등).
// 기본값은 이월 — 단지당 요청 1개(2초)를 아낀다.
const refreshArea = args.includes("--refresh-area");
const limitArg = args.find(a => a.startsWith("--limit="));
const complexLimit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;
const regionArg = args.find(a => a.startsWith("--region="));
const regionFilter = regionArg ? regionArg.replace("--region=", "") : null;

// ── JWT 토큰 (레거시: 현재 POST API는 JWT 불필요, 향후 인증 변경 시 fallback용) ──
/** @type {string | null} */
let jwtToken = null;
let jwtTokenTime = 0;
const JWT_LIFETIME = 2800 * 1000; // 47분
const JWT_TOKEN_PATTERN = /"token":"(eyJ[A-Za-z0-9._-]+)"/;
let lastRequestTime = 0;

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) await sleep(MIN_INTERVAL - elapsed);
  lastRequestTime = Date.now();
}

/** Python curl_cffi 헬퍼로 JWT 추출 시도 */
export function tryPythonJwt() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const scriptPath = resolve(__dirname, "naver-presale-jwt.py");
  try {
    const stdout = execFileSync("python3", [scriptPath], {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const token = stdout.trim();
    if (token && token.startsWith("eyJ")) {
      log(PHASE, `JWT 획득 via Python (${token.slice(0, 20)}...)`);
      return token;
    }
    log(PHASE, "Python JWT 출력이 유효하지 않음 — fetch fallback 사용");
    return null;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === "ENOENT") {
      log(PHASE, "Python 미설치 — fetch fallback 사용");
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      log(PHASE, `Python 헬퍼 실패: ${msg?.slice(0, 80)} — fetch fallback 사용`);
    }
    return null;
  }
}

/** fetch로 JWT 추출 (Python 실패 시 fallback)
 * @returns {Promise<string | null>}
 */
async function fetchJwtFallback() {
  await throttle();
  try {
    const res = await fetch(`${PRESALE_BASE}/complexes/6025041/9033181`, {
      headers: { ...HEADERS, "Accept": "text/html" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`JWT 페이지 ${res.status}`);
    const html = await res.text();

    const patterns = [
      JWT_TOKEN_PATTERN,
      /token\s*[:=]\s*["'](eyJ[A-Za-z0-9._-]+)["']/,
      /"accessToken"\s*:\s*"(eyJ[A-Za-z0-9._-]+)"/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        log(PHASE, `JWT 획득 via fetch (${m[1].slice(0, 20)}...)`);
        return m[1];
      }
    }
    log(PHASE, "JWT 미발견 (fetch) — 인증 없이 시도");
    return null;
  } catch (err) {
    log(PHASE, `JWT 추출 실패 (fetch): ${err instanceof Error ? err.message : String(err)} — 인증 없이 시도`);
    return null;
  }
}

// 세션578: 읽기 전용 탐침(.omc/artifacts)이 같은 호출 규칙(JWT·간격·재시도)을 쓰도록 export — 동작 변화 0
export async function ensureJwt() {
  if (jwtToken && (Date.now() - jwtTokenTime) < JWT_LIFETIME) return jwtToken;

  // 1차: Python curl_cffi (TLS fingerprint 우회)
  const pyToken = tryPythonJwt();
  if (pyToken) {
    jwtToken = pyToken;
    jwtTokenTime = Date.now();
    return jwtToken;
  }

  // 2차: 네이티브 fetch (fallback)
  const fetchToken = await fetchJwtFallback();
  if (fetchToken) {
    jwtToken = fetchToken;
    jwtTokenTime = Date.now();
    return jwtToken;
  }

  return null;
}

/** POST API 요청 (재시도, JWT 불필요 — 2026-03 신규 API)
 * @param {string} endpoint
 * @param {Record<string, unknown>} [body]
 * @returns {Promise<any>}
 */
async function presalePost(endpoint, body = {}) {
  const url = `${PRESALE_BASE}${endpoint}`;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await throttle();
      const res = await fetch(url, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", "Origin": PRESALE_BASE },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429) {
        await sleep(RETRY_DELAYS[i]);
        continue;
      }
      if (res.status >= 500 && i < MAX_RETRIES - 1) {
        logError(PHASE, `서버 에러 ${res.status} ${endpoint} (재시도 ${i + 1}/${MAX_RETRIES})`);
        await sleep(RETRY_DELAYS[i]);
        continue;
      }
      if (!res.ok) {
        logError(PHASE, `HTTP ${res.status} ${endpoint} (non-retryable)`);
        return null;
      }

      const data = await res.json();
      if (data?.isSuccess === false) {
        logError(PHASE, `API 오류 ${endpoint}: ${data.message ?? data.errorCode ?? "unknown"}`);
        return null;
      }
      return data?.result ?? data;
    } catch (err) {
      if (i === MAX_RETRIES - 1) {
        logError(PHASE, `요청 실패 ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
      await sleep(RETRY_DELAYS[i]);
    }
  }
  return null;
}

// ── 핵심 함수 (export하여 테스트 가능) ──────────────────────

/** 원(won) → 만원 변환, null-safe
 * @param {number | string | null | undefined} wonPrice
 * @returns {number | null}
 */
export function parsePresalePrice(wonPrice) {
  if (wonPrice == null) return null;
  const n = Number(wonPrice);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 10000);
}

/** 이미지 URL 검증 + 프로토콜 보정
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function sanitizeImageUrl(url) {
  if (!url || typeof url !== "string") return null;
  let normalized = url.startsWith("//") ? `https:${url}` : url;
  try {
    const parsed = new URL(normalized);
    if (IMAGE_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return normalized;
    }
    // naver.com 서브도메인도 허용
    if (parsed.hostname.endsWith(".naver.com") || parsed.hostname.endsWith(".pstatic.net")) {
      return normalized;
    }
    return null;
  } catch {
    return null;
  }
}

/** `completion` 규약(YYYYMM) 을 만족하는가. 저장 전 검증·기존 값 판정 공용.
 * @param {unknown} v
 * @returns {v is string}
 */
export function isCompletionYm(v) {
  return typeof v === "string" && /^\d{6}$/.test(v);
}

/**
 * 네이버 `mvi_date`(입주예정) 원문 → `completion`(YYYYMM). 확실할 때만 값을 낸다.
 *
 * 옛 코드는 `replace(/[-./]/g, "").slice(0, 6)` 로 **검증 없이 앞 6자를 잘라**
 * `"2030 미정"` → `"2030 미"`, `"[1회]2026.06"` → `"[1회]20"` 같은 깨진 값을 저장했고,
 * 그게 그대로 손님 화면에 `"2030년  미월"` 로 나갔다 (세션530).
 *
 * 버려도 잃는 게 없다 — 원문은 `presale_move_in` 이 무손실 보존하므로, 확실하지 않으면
 * null 을 내고 복구는 원문에서 다시 한다. 실측(정적 1,730행)상 네이버가 주는 꼴은
 * `YYYY-MM`/`YYYY.MM` 970건 + `"미정"` 계열뿐이라 한 자리 월 같은 변종은 없다.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function parsePresaleCompletion(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/(\d{4})[-./]?(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return `${m[1]}${m[2]}`;
}

/** 주소 파싱 → { region, gu, dong }
 * @param {string | null | undefined} address
 * @returns {{ region: string | null; gu: string | null; dong: string | null }}
 */
export function parsePresaleAddress(address) {
  if (!address) return { region: null, gu: null, dong: null };
  const parts = address.trim().split(/\s+/);
  /** @type {string | null} */
  let region = null;
  /** @type {string | null} */
  let gu = null;
  /** @type {string | null} */
  let dong = null;

  // 세션545: 첫 토큰(시도) + 둘째 토큰(시군구)만 본다.
  //
  // ⚠️ 옛 코드는 `address.includes(full)` 로 **주소 전체**를 훑었다. `REGION_MAP` 키에 약칭이
  // 있어서 `"경기도 광주시 양벌동".includes("광주")` 가 참이 되고, 그게 경기 광주시 단지 5곳이
  // 광주광역시로 오라벨된 원인이다(세션545 실측). 시도는 첫 토큰이 결정한다 — 전수 순회 제거.
  region = resolveRegionName(parts[0], parts[1]) ?? null;
  // 직접 매칭: "서울시" → "서울"
  if (!region && parts[0]) {
    const p0 = parts[0].replace(/(특별자치|특별|광역)?(시|도)$/, "");
    if (VALID_REGIONS.includes(p0)) region = p0;
  }

  // gu 추출: "구"가 있으면 우선, 없으면 "시/군".
  // 세션578: 후보는 **시도 뒤 두 토큰(parts[1], parts[2])만**, "…지구" 는 제외한다. 옛 코드는 주소의 아무
  // 토큰이나 봐서 `고덕국제화계획지구`·`탕정지구`·`운정3지구`·`일광지구` 를 시군구로 읽었고, 시군구 게이트가
  // 그 가짜 gu 로 정당한 매칭을 끊었다(검사관 실측 4건). "N공구"(공사 구역)도 같은 이유로 제외한다.
  // 단, 진짜 시군구 표(GU_LAWD_MAP)에 있는 이름은 제외 규칙에 걸려도 구로 본다 — "용인시 수지구"(…지구)가 그 예.
  const regionGus = region && Object.prototype.hasOwnProperty.call(GU_LAWD_MAP, region)
    ? /** @type {Record<string, string>} */ (/** @type {any} */ (GU_LAWD_MAP)[region])
    : null;
  /** @param {string} p */
  const isRealGu = (p) => !!regionGus && Object.prototype.hasOwnProperty.call(regionGus, normalizeGu(/** @type {string} */ (region), p) ?? "");
  const guCands = parts.slice(1, 3);
  gu = guCands.find((p) => /구$/.test(p) && (!/(지|공)구$/.test(p) || isRealGu(p)))
    ?? guCands.find((p) => /[시군]$/.test(p))
    ?? null;
  for (const p of parts) {
    if (/[읍면동가리로]$/.test(p) && p !== gu) { dong = p; break; }
  }

  return { region, gu, dong };
}

/**
 * 단지 상세(complex) 응답이 비어 실패로 센 단지를 로그 한 줄로 설명한다(세션571).
 * 전엔 `reporter.fail()` 만 해서 "실패 N" 숫자만 남고 **어느 단지인지** 알 수 없었다.
 * @param {number | string | null | undefined} no preSaleComplexNumber
 * @param {number | string | null | undefined} seq announcementPreSaleSequence
 * @param {ListItem | null | undefined} item 목록 항목(단지 이름 출처)
 * @returns {string}
 */
export function describeComplexFailure(no, seq, item) {
  return `단지 상세 응답 없음 — no=${no} seq=${seq} ${item?.preSaleComplexName ?? "(이름 없음)"}`;
}

/** [실패 명단] 로그에 펼칠 최대 건수 — 넘으면 앞 20 + ", …" */
const FAILED_COMPLEX_LOG_LIMIT = 20;

/**
 * [실패 명단] 로그 한 줄을 만든다(세션572 — naver-presale.mjs 루프 뒤 로그와 글자 하나 다르지 않게 동일).
 * entries 가 0건이면 빈 문자열(호출자가 그 경우 로그를 안 찍는 기존 동작 유지).
 * @param {string[]} entries
 * @param {number} [limit]
 * @returns {string}
 */
export function formatFailedComplexList(entries, limit = FAILED_COMPLEX_LOG_LIMIT) {
  if (entries.length === 0) return "";
  const shown = entries.slice(0, limit);
  const more = entries.length > shown.length ? ", …" : "";
  return `[실패 명단] ${entries.length}건: ${shown.join(" / ")}${more}`;
}

/** complex + detail 응답 → DB 행 변환
 * @param {ComplexData | null | undefined} complex
 * @param {DetailData | null | undefined} detail
 * @param {ListItem | null | undefined} listItem
 * @returns {PresaleRow}
 */
export function toPresaleRow(complex, detail, listItem) {
  const minPrice = parsePresalePrice(complex?.min_price);
  const maxPrice = parsePresalePrice(complex?.max_price);

  return {
    // 분양 전용 필드 (19개)
    presale_min_price: minPrice,
    presale_max_price: maxPrice,
    presale_pp: parsePresalePrice(complex?.pyper_price),
    presale_type: complex?.supp_sclass ?? null,
    presale_stage: complex?.supp_proc_step_nm ?? null,
    presale_stage_code: listItem?.preSaleStageCode ?? null,
    presale_image_url: sanitizeImageUrl(complex?.preview_image),
    naver_presale_no: String(listItem?.preSaleComplexNumber ?? complex?.build_dtl_cd ?? ""),
    naver_presale_seq: String(listItem?.announcementPreSaleSequence ?? complex?.supp_cd ?? ""),
    presale_general_supply: complex?.house_supp_cnt ?? null,
    presale_buildings: complex?.dong_cnt ?? detail?.dong_cnt ?? null,
    presale_parking: complex?.parking_cnt ?? detail?.parking_cnt ?? null,
    presale_inquiry: (complex?.sell_office_phone?.trim() || detail?.inquiry_tel?.trim()) || null,
    presale_features: (complex?.build_point?.trim() || detail?.features?.trim()) || null,
    presale_move_in: (complex?.mvi_date?.trim() || detail?.move_in_date?.trim()) || null,
    presale_recruit_date: complex?.recruit_date?.trim() || null,
    presale_schedule: listItem ? {
      scheduleName: listItem.scheduleName ?? null,
      dateInfo: listItem.dateInfo ?? null,
      schdl_info: complex?.schdl_info ?? null,
    } : (complex?.schdl_info ?? null),
    presale_housing_type: complex?.bclass_nm ?? null,
    presale_fetched_at: new Date().toISOString(),

    // enrichment 후보 (null인 기존 컬럼만 채울 때 사용)
    _enrich: {
      units: complex?.total_house_cnt ?? null,
      builder: complex?.cmpy_nm
        ? resolveBuilder(complex.cmpy_nm.trim())
        : null,
      max_floor: complex?.max_flr_cnt ?? null,
      lat: complex?.ypos != null ? parseFloat(String(complex.ypos)) : null,
      lng: complex?.xpos != null ? parseFloat(String(complex.xpos)) : null,
      completion: parsePresaleCompletion(complex?.mvi_date),
      bjd_code: complex?.bubdong_code ?? null,
      address: complex?.address ?? null,
    },
  };
}

/**
 * 주택형 목록(`/api/complex/scale`)에서 **대표 주택형의 전용·공급 면적**을 고른다.
 *
 * 왜 필요한가 (세션531): 이 수집기가 만드는 `presale_min` 가격 행은 `area: null` 이었다. 그
 * 단지들은 `apartments_flat.area` 가 비어 `scorePrice` 의 평형별 실거래 버킷 경로를 못 타고
 * **"구 전체 거래 중위 총액"과 비교**되는 폴백으로 떨어진다. 그러면 괴리도가 "비싼가"가 아니라
 * **"큰가"** 를 재게 된다 — 같은 단지 892곳을 경로만 바꿔 잰 대조 실험에서 면적↔괴리도 상관이
 * 버킷 −0.097 vs 폴백 **−0.699**, 대형(115㎡+) 괴리도 중앙이 −35.6% vs **−182.1%** 였다.
 * 그 편향이 손님 노출 1,730곳 중 833곳(48.2%)에 걸려 괴리도 점수를 양 끝(0점·만점)으로 몰았다.
 *
 * **왜 최저 분양가 주택형인가** — 이 행의 `price` 가 `min_price`(최저가)라 면적도 **같은 주택형**
 * 것이어야 짝이 맞는다. 다른 주택형 면적을 붙이면 비싼 집을 싼 값으로 재는 새 거짓이 된다.
 *
 * ⚠️ **역산·다른 대체 경로는 실측으로 기각했다**(같은 세션). 되살리려면 근거를 새로 들고 올 것:
 *   - `prices` 에 숨은 면적: 해당 833곳 중 **0곳**
 *   - `price ÷ 평당가` 역산: 공급/전용 중앙비율로 보정해도 오차 중앙 13.5%, 진짜 괴리도와
 *     맞대보면 폴백 대비 **승률 53.1%**(동전던지기)에 평균오차는 오히려 악화
 *   - 평당가끼리 비교(`presale_pp` vs `avg_price_sqm`): 버킷 경로 값과 상관 **0.149**(무관)
 *   - 상세 응답의 `min_size`/`max_size`: 전용면적 아님(DB 전용 대비 비율 0.95~1.93 산포,
 *     서로 다른 단지가 같은 값을 반환하는 사례도 있음)
 *
 * @param {Array<Record<string, unknown>> | null | undefined} list `/api/complex/scale` 의 `result.list`
 * @returns {{ area: number, supplyArea: number | null } | null} 후보가 없으면 null (지어내지 않는다)
 */
export function pickScaleArea(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  /** @type {{ area: number, supplyArea: number | null, price: number } | null} */
  let best = null;
  for (const it of list) {
    if (it == null || typeof it !== "object") continue;
    const area = Number(it.use_area_size);
    const price = Number(it.supp_price);
    // 전용면적이 상식 범위 밖이면 버린다 — 0·빈값뿐 아니라 계약면적이 잘못 들어온 행도 거른다.
    if (!Number.isFinite(area) || area < AREA_MIN_M2 || area > AREA_MAX_M2) continue;
    // 분양가가 없으면 "최저가 주택형"을 고를 수 없다. 임대(보증금/월세)형 행도 여기서 걸린다.
    if (!Number.isFinite(price) || price <= 0) continue;
    if (best == null || price < best.price) {
      const supply = Number(it.supp_size);
      best = { area, supplyArea: Number.isFinite(supply) && supply > 0 ? supply : null, price };
    }
  }
  return best ? { area: best.area, supplyArea: best.supplyArea } : null;
}

/**
 * complex 응답 → prices 테이블 행 변환 (house_type='presale_min')
 * price 커버리지 갭 보정용. recorded_at은 수집일 + (apartment_id, house_type, recorded_at) 복합키로 자연 멱등.
 *
 * `areaInfo` 는 `pickScaleArea` 결과이거나, 이전 회차에 이미 확보해 둔 같은 단지의 면적이다
 * (main 이 이월한다). **null 을 넣어도 옛 동작 그대로**라 호출처를 하나씩 옮길 수 있다.
 *
 * ⚠️ 이월이 필요한 이유: `latest_prices` 는 `presale_%` 행 중 `recorded_at` 이 가장 늦은 것을
 * 고른다. 면적이 이미 있다고 이번 회차 요청만 건너뛰면 **면적 없는 새 행이 옛 행을 덮어**
 * 화면에서 면적이 사라진다. 요청을 아끼되 값은 이어 붙인다.
 *
 * @param {ComplexData | null | undefined} complex
 * @param {string | null | undefined} apartmentId
 * @param {{ area: number, supplyArea: number | null } | null} [areaInfo]
 */
export function toPresalePriceRow(complex, apartmentId, areaInfo = null) {
  const price = parsePresalePrice(complex?.min_price);
  if (price == null || price <= 0 || !apartmentId) return null;
  const pp = parsePresalePrice(complex?.pyper_price);
  return {
    apartment_id: apartmentId,
    area: areaInfo?.area ?? null,
    supply_area: areaInfo?.supplyArea ?? null,
    price,
    pp: pp ?? null,
    house_type: "presale_min",
    supply_count: null,
    recorded_at: today(), // KST 고정 (presale_fetched_at datetime 은 timestamptz 라 그대로)
  };
}

/** presale_* / naver_presale_* 필드만 추출 (DRY: update·insert 공용)
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function extractPresaleFields(row) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("presale_") || k.startsWith("naver_presale")) {
      picked[k] = v;
    }
  }
  return picked;
}

/**
 * 같은 아파트에 붙은 여러 공고를 한 행으로 합친다 (id 기준, 마지막 값 우선).
 *
 * 왜 필요한가: 분양 공고는 회차·평형별로 여러 건이 같은 단지에 매칭된다. 옛 코드는 공고 수만큼
 * UPDATE 를 순서대로 쐈고, 로그·collector_runs 의 "1,113건" 은 **공고 수**였는데 실제로 값이 바뀐
 * 단지는 916곳뿐이었다 (세션 495 실측). 같은 뜻의 숫자로 착각하면 "왜 197건이 사라졌지" 를 헛짚는다.
 *
 * 필드 단위 병합인 이유: 순차 UPDATE 의 최종 DB 상태와 같게 만들기 위해서다. 앞 공고가 채운
 * enrichment(units·builder 등)를 뒷 공고가 안 들고 있으면 옛 코드에서도 그 값은 남았다.
 * 통째로 교체하면 그 값이 사라져 동작이 달라진다.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<Record<string, unknown>>}
 */
export function dedupUpdateRows(rows) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id);
    const prev = byId.get(id);
    byId.set(id, prev ? { ...prev, ...row } : row);
  }
  return [...byId.values()];
}

/**
 * 두 시군구 표기가 같은 시군구를 가리키는가 (세션578 — 분양 매칭 게이트와 정리 도구가 **같은 잣대**를 쓴다).
 *
 * 규칙:
 *   - `region === "세종"` → 참 (세종은 구·군이 없는 단일 시라 DB gu 가 null)
 *   - 둘 중 하나라도 비면(null·빈 문자열) → 거짓 (모르면 같다고 보지 않는다)
 *   - 둘 다 두 낱말 이상 → 전체 일치 (`"수원시 권선구"` ≠ `"수원시 영통구"`)
 *   - 한쪽이 한 낱말 → 첫 낱말 일치 (`"청주시"` = `"청주시 서원구"` — 청약홈 출처 행은 구 없이 시만 갖는다)
 *
 * ⚠️ 이 함수를 고치면 `scripts/cleanup-presale-links.mjs` 의 오염 판정도 같이 바뀐다 — 일부러 한 함수다.
 * 둘이 갈리면 도구가 끊은 링크를 수집기가 다음 회차에 다시 붙인다.
 *
 * @param {string | null | undefined} region
 * @param {string | null | undefined} guA
 * @param {string | null | undefined} guB
 * @returns {boolean}
 */
export function sameDistrict(region, guA, guB) {
  if (region === "세종") return true;
  const a = typeof guA === "string" ? guA.trim() : "";
  const b = typeof guB === "string" ? guB.trim() : "";
  if (!a || !b) return false;
  const wa = a.split(/\s+/);
  const wb = b.split(/\s+/);
  if (wa.length >= 2 && wb.length >= 2) return wa.join(" ") === wb.join(" ");
  return wa[0] === wb[0];
}

/** 4단계 매칭: presale → 기존 apartments (indexes 옵션: Map 기반 O(1) 룩업)
 *
 * 세션578 시군구 게이트:
 *   - 왜: 2~4순위가 브랜드 낱말 유사도만으로 **다른 시군구** 단지에 붙어 ap-* 279곳 + 그 외 140곳이
 *     남의 분양 번호·분양가를 떠안았다(음성아이파크 ← 서울원아이파크 88km).
 *   - 무엇: 2·3·4순위 후보는 분양 주소의 시도와 같고 `sameDistrict` 로 시군구가 같아야 한다.
 *     주소로 시도·시군구를 못 가르면 2~4순위를 전부 건너뛰고 null(→ 호출자가 신규 생성 경로로 간다).
 *   - 예외: 1순위(번호 일치)는 지역 무관 그대로 — 이미 박힌 오염 링크는 `cleanup-presale-links.mjs` 가 끊는다.
 *     세종은 DB gu 가 null 이라 시도만 맞으면 통과.
 *
 * 세션579 후보 게이트(시군구 게이트를 지난 후보에만):
 *   - 왜: 같은 시군구 안에서 ① ap-* 행(id 뒤 숫자 = 자기 네이버 단지 번호)에 같은 단지의 장기전세·행복주택 공고가
 *     덮어씌워지고 ② 임대 공고가 분양 행에 붙어 그 단지가 손님 목록에서 사라졌다(세션579 정리 79개 중 32개 재부착 흉내).
 *   - 무엇: 2~4순위 후보에서 ap-* 는 뺀다. 공고의 임대 여부(유형 `isLeasePresale` **또는** 공고 이름 `isLeaseName`)와
 *     후보 **이름**의 임대 낱말(`isLeaseName`)이 다르면 뺀다 — 후보의 presale_type 은 남의 링크로 덮인 행이 있어 보지 않는다.
 *   - 1순위는 id 주인(`ap-<공고 번호>` 행)을 번호 필드보다 먼저 본다 — ap-* 행을 만드는 곳은 이 수집기의 `ap-${no}` 한 곳뿐이라
 *     그 행이 번호의 주인이다. 번호 필드를 남의 링크로 잃은 ap-* 도 이 길로 자기 공고에 다시 붙는다(`idHealed`).
 *   - 남는 구멍(세션579 시점): ah-* 행 + 임대 여부가 같은 공고 + 같은 시군구 + 비슷한 이름은 여전히 붙었다
 *     (예: 분양 이안센트럴제기동역 → 제기동역 아이파크 3순위 0.47 — 세션581 이름 게이트가 막는다 ·
 *     임대 신정3지구 국민임대 → ah 신정3지구 장기전세 2순위 0.56).
 *
 * 세션581 이름·차수 게이트(세션579 후보 게이트 **뒤**, 2~4순위에만):
 *   - 왜: 캐시 257건 흉내에서 ah-* 후보에 2·3순위 오답 7건 — 곤지암(힐스테이트광주곤지암역 → 곤지암역 제일풍경채)·
 *     화성비봉 B1→B2·순천·제기동역·에코델타·센트리폴 3BL→1BL·첨단3지구 A6→A7. 원 유사도 기준(0.4~0.7)이 브랜드·지명 낱말만
 *     겹쳐도 넘고, 차수·블록이 다른 옆 단지도 막지 못했다.
 *   - G-A 차수·블록 충돌: 공고·후보 이름에 `stripRoundWords`(괄호는 남기고 회차 낱말만 뗌 — `cleanName` 은 `(A7BL)` 을
 *     잃는다)를 적용해 `phaseConsistent === "conflict"` 또는 `blockConflict` 면 후보 제외(`phaseConflict`).
 *   - G-B 이름 약함: `cleanName` 후 공백 제거 이름의 유사도가 `KAKAO_STRONG_SIM`(0.85) 미만이고, 짧은 쪽이
 *     `KAKAO_SUB_MIN_LEN`(8자) 이상이면서 한쪽이 다른 쪽을 품는 부분문자열 구제도 없으면 후보 제외(`nameWeak`).
 *     카카오 POI '강함' 기준 재사용(사장님 결정 2026-09-27).
 *   - 남는 구멍: 영문 표기 차이(`SK뷰` ↔ `SK VIEW`, `아이파크` ↔ `IPARK`)는 다른 이름으로 보여 G-B 에 막히고
 *     신규 행이 될 수 있다 — 정상 링크 대리 표본 143쌍 중 2쌍. 짧은 이름에 차수만 붙은 쌍(`OO아파트` ↔ `OO아파트 1단지`,
 *     짧은 쪽 8자 미만·정리 유사도 0.85 미만)도 부분문자열 구제를 못 받아 신규 행으로 간다. 임대 **유형** 공고인데
 *     이름에 임대 낱말이 없고 후보 이름엔 있는 짝(`은평뉴타운`[행복주택] ↔ `은평뉴타운 행복주택`)도 이름약함으로
 *     신규 행 — 대리 표본 143쌍 중 0건.
 *
 * @param {PresaleRow} presale
 * @param {AptForMatch[]} apartments
 * @param {AptIndexes} [indexes]
 * @param {{ gateBlocked: number; apSkipped?: number; leaseMismatch?: number; idHealed?: number; phaseConflict?: number; nameWeak?: number; blocked?: GateBlocked | null }} [stats] 넘기면 "이름 유사도 기준은
 *   넘었지만 시군구 게이트로 버린 후보가 하나라도 있었던 분양" 1건마다 `gateBlocked` 를 1 올린다(반환값은 그대로).
 *   `apSkipped`·`leaseMismatch` 도 같은 방식(세션579 후보 게이트로 버린 후보가 있으면 공고 1건당 1).
 *   `phaseConflict`·`nameWeak` 도 같은 방식(세션581 이름·차수 게이트). `blocked` 는 호출마다 null 로 시작해,
 *   이 공고에서 세션581 게이트로 버린 후보 중 원 이름 유사도가 가장 높은 1건을 담는다(로그용).
 *   `idHealed` 는 1순위를 id 주인으로 찾았는데 그 행의 `naver_presale_no` 가 공고 번호와 다를 때 1.
 * @returns {{ apartment: AptForMatch; confidence: number; tier: number } | null}
 */
export function matchPresaleToApt(presale, apartments, indexes, stats) {
  const presaleNo = String(presale.naver_presale_no || "");
  const buildName = presale._name || "";
  const lat = presale._enrich?.lat;
  const lng = presale._enrich?.lng;
  const bjdCode = presale._enrich?.bjd_code;
  // 세션581: 앞 공고의 차단 기록이 이 공고 로그로 새지 않게 비운다(값이 있을 때만 — 칸이 없던 stats 에 칸을 만들지 않는다)
  if (stats?.blocked) stats.blocked = null;

  // 1순위: naver_presale_no 완전 일치 (Map O(1) 또는 선형 탐색) — 지역 무관(세션578 게이트 예외)
  if (presaleNo) {
    // 세션579: id 주인(ap-<번호>) 먼저 — 번호 필드를 잃었거나 남의 번호를 쥔 ap-* 도 자기 공고로
    const ownerId = `ap-${presaleNo}`;
    const owner = indexes?.byId
      ? indexes.byId.get(ownerId)
      : apartments.find(a => a.id === ownerId);
    if (owner) {
      if (owner.naver_presale_no !== presaleNo && stats) stats.idHealed = (stats.idHealed ?? 0) + 1;
      return { apartment: owner, confidence: 1.0, tier: 1 };
    }
    const exact = indexes?.byPresaleNo?.get(presaleNo)
      ?? apartments.find(a => a.naver_presale_no === presaleNo);
    if (exact) return { apartment: exact, confidence: 1.0, tier: 1 };
  }

  // 세션578 게이트 재료: 분양 주소의 시도·시군구(DB 표기로 정규화)
  const parsed = parsePresaleAddress(presale._enrich?.address);
  const pRegion = parsed.region;
  const pGu = normalizeGu(pRegion ?? "", parsed.gu) ?? null;
  // 세종은 gu 가 없어도 된다. 그 외에는 시도·시군구 둘 다 알아야 2~4순위를 본다.
  const districtKnown = !!pRegion && (pRegion === "세종" || !!pGu);
  let blocked = false;
  /** @param {AptForMatch} a */
  const inDistrict = (a) => {
    const guMatch = sameDistrict(pRegion, a.gu, pGu);
    const ok = districtKnown && a.region === pRegion && guMatch;
    if (!ok) blocked = true;
    return ok;
  };
  // 세션579 후보 게이트 재료: 공고의 임대 여부(유형 또는 공고 이름) — 후보는 이름만 본다
  const presaleIsLease = isLeasePresale(presale.presale_type) || isLeaseName(buildName);
  let apSkipped = false;
  let leaseMismatch = false;
  // 세션581 이름·차수 게이트 재료: 공고 이름의 두 가지 정리형(차수·블록 판정용 / 유사도용)
  const presaleStripped = stripRoundWords(buildName);
  const presaleClean = cleanName(buildName).replace(/\s+/g, "");
  let phaseConflict = false;
  let nameWeak = false;
  /** @type {GateBlocked | null} */
  let gateBest = null;
  /**
   * @param {AptForMatch} a @param {number} sim 원 이름 유사도 @param {number} tier
   * @param {GateBlocked["reason"]} reason
   */
  const noteGate = (a, sim, tier, reason) => {
    if (!gateBest || sim > gateBest.sim) gateBest = { name: a.name, tier, sim, reason };
  };
  /** @param {AptForMatch} a @param {number} sim 원 이름 유사도 @param {number} tier */
  const candidateOk = (a, sim, tier) => {
    if (String(a.id ?? "").startsWith("ap-")) { apSkipped = true; return false; }
    if (isLeaseName(a.name) !== presaleIsLease) { leaseMismatch = true; return false; }
    // 세션581 G-A 차수·블록 충돌 — 괄호 속 블록을 지키려고 cleanName 이 아니라 stripRoundWords
    const candStripped = stripRoundWords(a.name);
    if (phaseConsistent(presaleStripped, candStripped) === "conflict" || blockConflict(presaleStripped, candStripped)) {
      phaseConflict = true; noteGate(a, sim, tier, "차수충돌"); return false;
    }
    // 세션581 G-B 이름 약함 — 정리 이름 유사도 0.85 미만이고 부분문자열 구제(짧은 쪽 8자 이상)도 없으면 제외
    const candClean = cleanName(a.name).replace(/\s+/g, "");
    const nameSim = stringSimilarity(presaleClean, candClean);
    const sub = Math.min(presaleClean.length, candClean.length) >= KAKAO_SUB_MIN_LEN
      && (presaleClean.includes(candClean) || candClean.includes(presaleClean));
    if (nameSim < KAKAO_STRONG_SIM && !sub) { nameWeak = true; noteGate(a, sim, tier, "이름약함"); return false; }
    return true;
  };
  const finish = (/** @type {{ apartment: AptForMatch; confidence: number; tier: number } | null} */ r) => {
    if (blocked && stats) stats.gateBlocked++;
    if (apSkipped && stats) stats.apSkipped = (stats.apSkipped ?? 0) + 1;
    if (leaseMismatch && stats) stats.leaseMismatch = (stats.leaseMismatch ?? 0) + 1;
    if (phaseConflict && stats) stats.phaseConflict = (stats.phaseConflict ?? 0) + 1;
    if (nameWeak && stats) stats.nameWeak = (stats.nameWeak ?? 0) + 1;
    if (gateBest && stats) stats.blocked = gateBest;
    return r;
  };

  // 2순위: bjd_code + 이름 유사도 >= 0.5 (Map 그룹 또는 전체 탐색) + 시군구 게이트
  //
  // 세션578 검사관A 🟡1: 색인(byBjd)이 있는데 그 법정동 키가 없으면 `?? apartments` 로
  // 전체 단지가 후보가 되고, 바로 아래 `!indexes?.byBjd` 가 거짓이라 법정동 거르기도 건너뛰어
  // "2순위 = 이름 유사도만으로 아무 단지"가 되던 결함(2026-03-29 5d258341 부터).
  // 색인이 없을 때만(구버전 호출부 등) 전체 탐색 + 수동 법정동 필터로 폴백한다.
  if (bjdCode) {
    const candidates = indexes?.byBjd ? (indexes.byBjd.get(bjdCode) ?? []) : apartments;
    /** @type {AptForMatch | null} */
    let best = null;
    let bestSim = 0;
    for (const a of candidates) {
      if (!indexes?.byBjd && a.bjd_code !== bjdCode) continue;
      const sim = stringSimilarity(buildName, a.name);
      if (sim < MATCH_THRESHOLD_BJD) continue;
      if (!inDistrict(a)) continue;
      if (!candidateOk(a, sim, 2)) continue;
      if (sim > bestSim) { best = a; bestSim = sim; }
    }
    if (best) return finish({ apartment: best, confidence: bestSim, tier: 2 });
  }

  // 3순위: 좌표 MATCH_DISTANCE_M 이내 + 이름 유사도 + 시군구 게이트
  if (lat && lng) {
    /** @type {AptForMatch | null} */
    let best = null;
    let bestSim = 0;
    for (const a of apartments) {
      if (!a.lat || !a.lng) continue;
      const dlat = (lat - a.lat) * METERS_PER_DEGREE;
      const dlng = (lng - a.lng) * METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180);
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist > MATCH_DISTANCE_M) continue;
      const sim = stringSimilarity(buildName, a.name);
      if (sim < MATCH_THRESHOLD_GEO) continue;
      if (!inDistrict(a)) continue;
      if (!candidateOk(a, sim, 3)) continue;
      if (sim > bestSim) { best = a; bestSim = sim; }
    }
    if (best) return finish({ apartment: best, confidence: bestSim, tier: 3 });
  }

  // 4순위: 동일 region 내 이름 유사도 + 시군구 게이트
  if (pRegion && buildName) {
    /** @type {AptForMatch | null} */
    let best = null;
    let bestSim = 0;
    for (const a of apartments) {
      if (a.region !== pRegion) continue;
      const sim = stringSimilarity(buildName, a.name);
      if (sim < MATCH_THRESHOLD_REGION) continue;
      if (!inDistrict(a)) continue;
      if (!candidateOk(a, sim, 4)) continue;
      if (sim > bestSim) { best = a; bestSim = sim; }
    }
    if (best) return finish({ apartment: best, confidence: bestSim, tier: 4 });
  }

  return finish(null);
}

/** 분양 데이터 → 신규 아파트 레코드 생성 (테스트 가능하도록 export)
 * @param {PresaleRow} row
 * @param {ComplexData} complexData
 * @param {string | null | undefined} regionFallback
 */
export function buildNewApartment(row, complexData, regionFallback) {
  const no = row.naver_presale_no || "";
  const { region, gu, dong } = parsePresaleAddress(complexData.address);
  // ⚠️ gu 는 **정규화해서** 넣는다(세션546). 네이버 주소 원문이 "화성특례시"·"화성시 동탄구" 처럼
  //    GU_LAWD_MAP·regions 어디에도 없는 표기로 들어오면 실거래 호출도 지표 조인도 통째로 끊긴다.
  //    별칭표 키가 `17지역약칭|표기` 라 **약칭이 확정된 region**(폴백 적용 후)을 넘겨야 맞는다.
  const finalRegion = region ?? regionFallback;
  const apt = {
    id: `ap-${no}`,
    name: complexData.build_nm,
    region: finalRegion,
    gu: normalizeGu(finalRegion ?? "", gu) ?? null,
    dong: dong ?? null,
    address: complexData.address ?? null,
    lat: row._enrich.lat,
    lng: row._enrich.lng,
    units: complexData.total_house_cnt ?? 0,
    builder: row._enrich.builder,
    completion: row._enrich.completion,
    bjd_code: row._enrich.bjd_code,
    unit_source: "naver_presale",
  };
  Object.assign(apt, extractPresaleFields(row));
  return apt;
}

// ── 리스트 / 상세 API (2026-03 신규 POST API) ───────────────

/** API 프로브 — preSaleScheduleList 엔드포인트 확인 */
async function probeEndpoints() {
  log(PHASE, "API 엔드포인트 프로브 (POST /api/home/preSaleScheduleList)...");
  const data = await presalePost("/api/home/preSaleScheduleList", { bubdong_code: "0000000000" });
  if (data?.list && data.total_count > 0) {
    log(PHASE, `  OK — 전국 ${data.total_count}건 확인`);
    return data;
  }
  // 단일 단지 detail로 fallback 확인
  log(PHASE, "  리스트 실패 — complex/detail 직접 확인...");
  const detail = await presalePost("/api/complex/detail", { build_dtl_cd: 6025041, supp_cd: 9033181 });
  if (detail?.build_nm) {
    log(PHASE, `  OK (detail only) — ${detail.build_nm}`);
    return { _complexOnly: true, sample: detail };
  }
  logError(PHASE, "모든 엔드포인트 프로브 실패 — API 접근 불가");
  return null;
}

/** cortarNo 별 분양단지 목록 조회 (페이지네이션)
 * 세션545: 인자를 region → cortarNo 로 바꿨다. 광주·전남이 같은 코드를 쓰게 되어 호출 단위가
 * "지역" 이 아니라 "코드" 가 됐기 때문(buildCortarQueries 참조).
 * @param {string} cortarNo
 * @returns {Promise<ListItem[]>}
 */
// 세션578: 읽기 전용 탐침(.omc/artifacts)이 같은 호출 규칙(JWT·간격·재시도)을 쓰도록 export — 동작 변화 0
export async function fetchPresaleList(cortarNo) {
  if (!cortarNo) return [];

  const results = [];
  let page = 1;
  let hasNext = true;
  while (hasNext) {
    const data = await presalePost("/api/home/preSaleScheduleList", {
      bubdong_code: cortarNo,
      page,
      pageSize: LIST_PAGE_SIZE,
    });
    if (!data?.list?.length) break;

    for (const item of data.list) {
      results.push({
        preSaleComplexNumber: item.build_dtl_cd ?? null,
        announcementPreSaleSequence: item.supp_cd ?? null,
        preSaleComplexName: item.build_nm ?? null,
        preSaleStageCode: item.supp_proc_step ?? null,
        scheduleName: item.schdl_info?.schdl_title ?? null,
        dateInfo: item.schdl_info?.start_date ?? item.recruit_date ?? null,
      });
    }

    hasNext = data.has_next_page ?? false;
    page++;
  }

  return results;
}

/** 단지 상세 — POST /api/complex/detail
 * @param {string | number | null | undefined} complexNo
 * @param {string | number | null | undefined} seq
 */
// 세션578: 읽기 전용 탐침(.omc/artifacts)이 같은 호출 규칙(JWT·간격·재시도)을 쓰도록 export — 동작 변화 0
export async function fetchComplexData(complexNo, seq) {
  const no = Number(complexNo), s = Number(seq);
  if (!Number.isFinite(no) || !Number.isFinite(s)) return null;
  return await presalePost("/api/complex/detail", { build_dtl_cd: no, supp_cd: s });
}

/** 단지 일정 — POST /api/complex/schedule (실패 시 null)
 * @param {string | number | null | undefined} complexNo
 * @param {string | number | null | undefined} seq
 */
// 세션578: 읽기 전용 탐침(.omc/artifacts)이 같은 호출 규칙(JWT·간격·재시도)을 쓰도록 export — 동작 변화 0
export async function fetchDetailData(complexNo, seq) {
  const no = Number(complexNo), s = Number(seq);
  if (!Number.isFinite(no) || !Number.isFinite(s)) return null;
  return await presalePost("/api/complex/schedule", { build_dtl_cd: no, supp_cd: s });
}

/** 주택형별 규모 — POST /api/complex/scale (전용면적 출처, 실패·빈응답 시 [])
 *
 * 엔드포인트는 추측이 아니라 **분양 상세 페이지가 실제로 부르는 것**을 확인해 골랐다
 * (페이지 JS 번들에서 `/api/` 문자열 21개를 추출 → `scale` 이 주택형 목록). 처음 짚어 본
 * `houseType`·`typeList`·`supply` 등 19개는 전부 404 였다.
 *
 * @param {string | number | null | undefined} complexNo
 * @param {string | number | null | undefined} seq
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function fetchScaleData(complexNo, seq) {
  const no = Number(complexNo), s = Number(seq);
  if (!Number.isFinite(no) || !Number.isFinite(s)) return [];
  const data = await presalePost("/api/complex/scale", { build_dtl_cd: no, supp_cd: s });
  const list = data?.list;
  return Array.isArray(list) ? list : [];
}

// ── 메인 ────────────────────────────────────────────────────

async function main() {
  loadEnv();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logError("init", "SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요");
    process.exit(1);
  }
  const sb = getSupabase();
  const reporter = createReporter(PHASE);

  if (dryRun) log(PHASE, "🔸 DRY-RUN 모드 — DB 저장 없음");

  // Phase 0: API 접근성 확인
  const probeResult = await probeEndpoints();
  if (!probeResult) {
    log(PHASE, "API 접근 불가 — 정상 종료 (파이프라인 계속)");
    reporter.summary();
    process.exit(0);
  }
  if (probeOnly) {
    log(PHASE, "--probe 완료");
    process.exit(0);
  }

  // Phase 0.5: 기존 apartments 로드
  log(PHASE, "기존 아파트 데이터 로드...");
  // ⚠️ 세션545: 옛 `.range(0, 9999)` 단발 조회는 PostgREST max-rows 에 **1,000행에서 잘렸다**
  //    (2026-09-10 실측: 3,044곳 중 "기존 아파트 1000건 로드"). 나머지 2,000여 곳은 매칭 후보에
  //    없어 이미 있는 ah-* 단지 옆에 ap-* 가 새로 생기고(신규 326건 부풀림) tier 매칭이 통째로
  //    무너진다. `apts.length === 10000` 가드는 그래서 영영 안 울렸다. 고유키(id) 커서로 전량.
  /** @type {AptForMatch[]} */
  let apts;
  try {
    apts = /** @type {AptForMatch[]} */ (/** @type {unknown} */ (
      await selectAll(
        (s) => s.from("apartments")
          .select("id, name, region, gu, dong, lat, lng, bjd_code, naver_presale_no, units, builder, max_floor, completion"),
        sb,
        "id",
      )
    ));
  } catch (err) {
    logError(PHASE, `apartments 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  log(PHASE, `기존 아파트 ${apts.length}건 로드`);

  // Map 인덱스 (Tier1·2 O(1) 룩업)
  /** @type {Map<string, AptForMatch>} */
  const byPresaleNo = new Map();
  /** @type {Map<string, AptForMatch[]>} */
  const byBjd = new Map();
  /** @type {Map<string, AptForMatch>} */
  const byId = new Map();
  for (const a of apts) {
    if (a.id) byId.set(a.id, a);
    if (a.naver_presale_no) byPresaleNo.set(a.naver_presale_no, a);
    if (a.bjd_code) {
      if (!byBjd.has(a.bjd_code)) byBjd.set(a.bjd_code, []);
      const list = byBjd.get(a.bjd_code);
      if (list) list.push(a);
    }
  }
  /** @type {AptIndexes} */
  const aptIndexes = { byPresaleNo, byBjd, byId };

  // Phase 0.6: 이미 확보한 전용면적 이월표 — 단지당 요청 1개(2초)를 아낀다.
  // ⚠️ 고유키(apartment_id) 커서로 전량을 훑는다. 무정렬 `.range()` 반복은 1,000행 넘는
  //    표에서 에러 없이 행을 잃는다(.claude/rules/collectors/unordered-pagination-loses-rows.md).
  //    `prices` 는 이미 7,886행이라 이 규칙에 걸린다.
  /** @type {Map<string, { area: number, supplyArea: number | null }>} */
  const knownArea = new Map();
  {
    const PAGE = 1000;
    /** @type {number | null} */
    let cursor = null;
    for (;;) {
      let pq = sb.from("prices").select("id, apartment_id, area, supply_area").order("id", { ascending: true }).limit(PAGE);
      if (cursor != null) pq = pq.gt("id", cursor);
      const { data: prows, error: perr } = await pq;
      if (perr) { logError(PHASE, `prices 면적 조회 실패 — 이월 없이 진행: ${perr.message}`); break; }
      if (!prows?.length) break;
      for (const r of prows) {
        const a = Number(r.area);
        if (!Number.isFinite(a) || a < AREA_MIN_M2 || a > AREA_MAX_M2) continue;
        const sa = Number(r.supply_area);
        knownArea.set(String(r.apartment_id), { area: a, supplyArea: Number.isFinite(sa) && sa > 0 ? sa : null });
      }
      if (prows.length < PAGE) break;
      cursor = Number(prows[prows.length - 1].id);
    }
    log(PHASE, `기존 전용면적 보유 단지 ${knownArea.size}건 (이월 대상)`);
  }

  /**
   * 이 단지에 붙일 전용면적. 이미 알고 있으면 그대로 이월하고, 모를 때만 `scale` 을 부른다.
   * `--refresh-area` 면 항상 다시 조회한다.
   * @param {string} aptId
   * @param {string | number | null | undefined} no
   * @param {string | number | null | undefined} seq
   */
  async function resolveAreaInfo(aptId, no, seq) {
    if (!refreshArea) {
      const cached = knownArea.get(aptId);
      if (cached) return cached;
    }
    const picked = pickScaleArea(await fetchScaleData(no, seq));
    if (picked) knownArea.set(aptId, picked);
    // 못 구했는데 옛 값이 있으면 그 값을 이월한다 — 면적 없는 새 행이 옛 행을 덮지 않게.
    return picked ?? knownArea.get(aptId) ?? null;
  }

  // Phase 1: Discovery — 전국 분양단지 목록
  const regions = regionFilter ? [regionFilter] : Object.keys(REGION_CORTAR);
  const allPresales = [];

  if (!probeResult._complexOnly) {
    // cortarNo 중복(광주·전남 = 1200000000)을 접어 같은 목록을 두 번 받지 않는다.
    for (const q of buildCortarQueries(regions)) {
      log(PHASE, `[목록] ${q.regions.join("·")} (${q.cortarNo}) 조회...`);
      const list = await fetchPresaleList(q.cortarNo);
      log(PHASE, `  → ${list.length}건 발견`);
      // 공유 코드는 _region 을 null 로 — 주소 파서가 가른다(잘못된 폴백 라벨 방지).
      allPresales.push(...list.map(item => ({ ...item, _region: q.region })));
    }
  } else {
    log(PHASE, "리스트 API 미사용 — 기존 naver_presale_no 기반으로 갱신만 수행");
    for (const apt of apts) {
      if (apt.naver_presale_no) {
        allPresales.push({
          preSaleComplexNumber: apt.naver_presale_no,
          announcementPreSaleSequence: null,
          preSaleComplexName: apt.name,
          _region: apt.region,
        });
      }
    }
  }

  // 중복 제거 (preSaleComplexNumber 기준)
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {ListItem[]} */
  const uniquePresales = [];
  for (const p of allPresales) {
    const key = String(p.preSaleComplexNumber);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniquePresales.push(p);
  }

  const total = complexLimit ? Math.min(complexLimit, uniquePresales.length) : uniquePresales.length;
  log(PHASE, `총 ${uniquePresales.length}건 중 ${total}건 처리 예정`);

  // Phase 2+3: Detail 수집 + 매칭 + Upsert
  /** @type {Array<Record<string, unknown>>} */
  const updateRows = [];
  /** @type {Array<Record<string, unknown>>} */
  const insertRows = [];
  /** @type {Array<Record<string, unknown>>} */
  const priceRows = []; // prices 테이블 upsert용 (house_type='presale_min')
  /** @type {Record<string | number, number>} */
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, new: 0, none: 0 };
  // region 을 못 구해 신규 생성을 접은 수 (apartments.region 은 NOT NULL — 아래 가드 참조)
  let regionUnresolved = 0;
  // --region=X 로 좁혀 돌 때 공유 cortarNo 가 실어 온 다른 지역 단지를 건너뛴 수
  let regionFiltered = 0;
  // 세션578: 이름 유사도는 넘었지만 시군구 게이트로 후보를 버린 분양 수(matchPresaleToApt stats)
  // 세션581: phaseConflict·nameWeak = 이름·차수 게이트로 후보를 버린 공고 수, blocked = 이번 공고의 대표 차단 1건(로그용)
  /** @type {{ gateBlocked: number; apSkipped: number; leaseMismatch: number; idHealed: number; phaseConflict: number; nameWeak: number; blocked: GateBlocked | null }} */
  const matchStats = { gateBlocked: 0, apSkipped: 0, leaseMismatch: 0, idHealed: 0, phaseConflict: 0, nameWeak: 0, blocked: null };
  // 단지 상세 응답이 비어 실패로 센 단지 설명(describeComplexFailure) — 루프 뒤 [실패 명단] 한 줄
  /** @type {string[]} */
  const failedComplexes = [];

  for (let idx = 0; idx < total; idx++) {
    if (reporter.interrupted()) break;
    const item = uniquePresales[idx];
    const no = item.preSaleComplexNumber;
    const seq = item.announcementPreSaleSequence;

    if (!no) { reporter.skip(); continue; }
    if (!seq) {
      // seq 없으면 complex 엔드포인트 호출 불가 — 스킵
      reporter.skip();
      continue;
    }

    if (idx % 10 === 0) {
      log(PHASE, `  진행: ${idx}/${total} (${((idx / total) * 100).toFixed(0)}%)`);
    }

    // Phase 2: complex 데이터
    const complexData = await fetchComplexData(no, seq);
    if (!complexData?.build_nm) {
      const why = describeComplexFailure(no, seq, item);
      log(PHASE, `  [실패] ${why}`);
      failedComplexes.push(why);
      reporter.fail();
      continue;
    }

    // Phase 3: detail 데이터 (실패 시 null — complex만으로 진행)
    const detailData = await fetchDetailData(no, seq);

    // 행 변환
    const row = toPresaleRow(complexData, detailData, item);
    row._name = complexData.build_nm;

    // --region=X 로 좁혀 돌 때: 공유 cortarNo(광주·전남 = 1200000000)는 **양쪽 단지를 다**
    // 실어 온다. 시도만으로 못 가르므로 주소로 가른 지역이 요청과 다르면 건너뛴다.
    // (`_region` 은 그 코드가 공유라 null 이다 — buildCortarQueries 참조.)
    if (regionFilter) {
      const resolvedRegion = parsePresaleAddress(complexData.address).region ?? item._region ?? null;
      // ⚠️ **못 가른 항목(null)은 거르지 않는다**(2차 리뷰 NEW-2). 여기서 걸러 버리면
      //    주소가 비었을 뿐 `naver_presale_no` 로는 멀쩡히 매칭되는 기존 단지의 갱신까지
      //    `--region` 모드에서 통째로 사라진다. 신규 INSERT 는 아래 region null 가드가 따로 막는다.
      if (resolvedRegion != null && resolvedRegion !== regionFilter) {
        regionFiltered++;
        reporter.skip();
        continue;
      }
    }

    // Phase 4: 매칭
    const match = matchPresaleToApt(row, apts, aptIndexes, matchStats);
    if (matchStats.blocked) {
      const b = matchStats.blocked;
      const outcome = match ? `tier${match.tier} ${match.apartment.id}` : "매칭없음";
      log(PHASE, `  ⚠ 이름 게이트 차단: ${row._name} → ${b.name} (tier=${b.tier} sim=${b.sim.toFixed(2)} 이유=${b.reason}) 결과=${outcome}`);
    }

    if (match) {
      tierCounts[match.tier]++;
      if (match.tier >= 3) {
        log(PHASE, `  ⚠ 저신뢰 매칭: ${row._name} → ${match.apartment.name} (tier=${match.tier} conf=${match.confidence.toFixed(2)})`);
      }
      // 기존 아파트 업데이트
      /** @type {Record<string, unknown>} */
      const update = { id: match.apartment.id, ...extractPresaleFields(/** @type {Record<string, unknown>} */ (row)) };
      // enrichment: null인 기존 컬럼만 채움
      const enrich = row._enrich;
      if (enrich) {
        if (!match.apartment.units && enrich.units) update.units = enrich.units;
        if (!match.apartment.builder && enrich.builder) update.builder = enrich.builder;
        if (!match.apartment.max_floor && enrich.max_floor) update.max_floor = enrich.max_floor;
        if (!match.apartment.lat && enrich.lat) update.lat = enrich.lat;
        if (!match.apartment.lng && enrich.lng) update.lng = enrich.lng;
        // completion 만 "NULL 일 때만" 갱신하던 탓에 한 번 잘린 값이 영구 동결됐고, 매번
        // 갱신되는 presale_move_in 과 드리프트했다 (세션530). 규약(YYYYMM) 을 어긴 값도
        // 갱신 대상에 넣어 다음 회차에 스스로 낫게 한다. 정상 YYYYMM 은 그대로 둔다.
        if (!isCompletionYm(match.apartment.completion) && enrich.completion) update.completion = enrich.completion;
        if (!match.apartment.bjd_code && enrich.bjd_code) update.bjd_code = enrich.bjd_code;
      }
      updateRows.push(update);
      const areaInfo = await resolveAreaInfo(match.apartment.id, no, seq);
      const priceRow = toPresalePriceRow(complexData, match.apartment.id, areaInfo);
      if (priceRow) priceRows.push(priceRow);
      reporter.success();
    } else {
      // 신규 생성 가능 여부 판단
      const housingType = complexData.bclass_nm ?? "";
      const isAptLike = /아파트|주상복합|오피스텔/.test(housingType);
      const totalUnits = complexData.total_house_cnt ?? 0;

      if (isAptLike && totalUnits >= MIN_UNITS_FOR_INSERT) {
        const newApt = buildNewApartment(row, complexData, item._region);
        // ⚠️ `apartments.region` 은 **NOT NULL** 이다. 공유 cortarNo 항목은 `_region` 이 null 이라
        //    주소가 없거나 안 읽히면 여기서 region 이 null 로 나온다. 그 한 행을 배치에 넣으면
        //    `upsertBatch("apartments", …, 500)` 이 **그 배치를 통째로** 실패시켜, 같이 실린
        //    멀쩡한 신규 단지 수백 건이 함께 유실된다. 한 행을 접는 쪽이 언제나 싸다.
        if (newApt.region == null) {
          regionUnresolved++;
          logError(PHASE, `region 미확정 — 신규 생성 건너뜀: ${newApt.name ?? "(이름없음)"} (no=${no}, 주소=${complexData.address ?? "(없음)"})`);
          reporter.skip();
          continue;
        }
        tierCounts.new++;
        insertRows.push(newApt);
        const areaInfo = await resolveAreaInfo(newApt.id, no, seq);
        const priceRow = toPresalePriceRow(complexData, newApt.id, areaInfo);
        if (priceRow) priceRows.push(priceRow);
        reporter.success();
      } else {
        tierCounts.none++;
        reporter.skip();
      }
    }
  }

  if (failedComplexes.length > 0) {
    log(PHASE, formatFailedComplexList(failedComplexes, FAILED_COMPLEX_LOG_LIMIT));
  }

  // 매칭 tier 집계
  log(PHASE, `[매칭] tier1=${tierCounts[1]} tier2=${tierCounts[2]} tier3=${tierCounts[3]} tier4=${tierCounts[4]} 신규=${tierCounts.new} 미매칭=${tierCounts.none} region미확정=${regionUnresolved} 지역필터제외=${regionFiltered} 게이트차단=${matchStats.gateBlocked} ap제외=${matchStats.apSkipped} 임대불일치=${matchStats.leaseMismatch} id복원=${matchStats.idHealed} 차수충돌=${matchStats.phaseConflict} 이름약함=${matchStats.nameWeak}`);

  // 공고(item) 단위 집계와 단지 단위 실갱신 수를 구분해 남긴다 — 아래 UPDATE 는 단지 단위로 돈다.
  // reporter/collector_runs 의 ok 는 공고 단위 그대로 둔다(회귀 방지). 이 줄이 그 차이를 설명한다.
  const dedupedUpdates = dedupUpdateRows(updateRows);
  log(PHASE, `[집계] 기존 단지 갱신 — 공고 ${updateRows.length}건 / 단지 ${dedupedUpdates.length}건`);

  // DB 저장
  if (!dryRun) {
    if (dedupedUpdates.length) {
      log(PHASE, `기존 아파트 업데이트 ${dedupedUpdates.length}건...`);
      let updOk = 0, updFail = 0;
      for (const row of dedupedUpdates) {
        const { id, ...fields } = row;
        const { error } = await sb.from("apartments").update(fields).eq("id", id);
        if (error) { updFail++; if (updFail <= 3) logError(PHASE, `UPDATE ${id}: ${error.message}`); }
        else updOk++;
      }
      log("apartments", `${updOk}/${dedupedUpdates.length}건 update${updFail ? ` (${updFail}건 실패)` : ""}`);
    }
    if (insertRows.length) {
      log(PHASE, `신규 아파트 생성 ${insertRows.length}건...`);
      await upsertBatch("apartments", insertRows, "id", 500, sb);
    }
    // prices 테이블에도 분양가 병행 저장 (house_type='presale_min', apartment_id FK 안전을 위해 apartments upsert 뒤에 실행)
    if (priceRows.length) {
      log(PHASE, `prices 테이블 분양가 upsert ${priceRows.length}건...`);
      try {
        await upsertBatch("prices", priceRows, "apartment_id,house_type,recorded_at", 500, sb);
      } catch (e) {
        logError(PHASE, `prices upsert 실패 (비치명적): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    log(PHASE, `[DRY-RUN] 업데이트 단지 ${dedupedUpdates.length}건(공고 ${updateRows.length}건), 신규 ${insertRows.length}건, prices ${priceRows.length}건 (미저장)`);
  }

  const result = reporter.summary();
  await recordCollectorRun(PHASE, result);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
