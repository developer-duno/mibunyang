/**
 * 공유 유틸리티 — 수집 스크립트 공통 모듈
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "../..");

// ── .env 로드 ──────────────────────────────────────────────
export function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

// ── Supabase 클라이언트 (service_role — 쓰기 권한) ─────────
let _supabase = null;
export function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_KEY 필요");
  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabase;
}

// ── Supabase 클라이언트 (public 스키마 — naver-estate-web 공유) ─────────────
let _supabaseMibunyang = null;
export function getMibuyangSupabase() {
  if (_supabaseMibunyang) return _supabaseMibunyang;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_KEY 필요");
  _supabaseMibunyang = createClient(url, key, {
    db: { schema: 'public' },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabaseMibunyang;
}

// ── 로깅 ───────────────────────────────────────────────────
export function log(phase, msg) {
  console.log(`[${phase}] ${msg}`);
}

export function logError(phase, msg) {
  console.error(`[${phase}] ERROR: ${msg}`);
}

// ── 세마포어 (동시 실행 수 제한) ───────────────────────────
export function createSemaphore(max) {
  let running = 0;
  const queue = [];
  return async (fn) => {
    if (running >= max) await new Promise(r => queue.push(r));
    running++;
    try { return await fn(); }
    finally { running--; if (queue.length) queue.shift()(); }
  };
}

// ── 배치 upsert ────────────────────────────────────────────
const RATE_LIMIT_RE = /too many|rate limit/i;

export async function upsertBatch(table, rows, conflictCol, batchSize = 500, sb = null, { delayMs = 100, maxRetries = 3 } = {}) {
  if (!rows.length) return 0;
  sb = sb ?? getSupabase();
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const batch = rows.slice(i, i + batchSize);
    let error = null;

    // 429 재시도 루프
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await sb
        .from(table)
        .upsert(batch, { onConflict: conflictCol, ignoreDuplicates: false });
      error = res.error;

      if (!error) { inserted += batch.length; break; }

      if (RATE_LIMIT_RE.test(error.message ?? "")) {
        const wait = (attempt + 1) ** 2 * 1000;
        log(table, `429 감지 — ${wait}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})`);
        await sleep(wait);
        continue;
      }
      break; // 비-429 에러는 개별 재시도로
    }

    if (error && !RATE_LIMIT_RE.test(error.message ?? "")) {
      logError(table, `배치 ${i}~${i + batch.length}: ${error.message}`);
      let retryOk = 0, retryFail = 0;
      for (const row of batch) {
        if (retryOk + retryFail > 0) await sleep(50);
        const { error: e2 } = await sb
          .from(table)
          .upsert([row], { onConflict: conflictCol, ignoreDuplicates: false });
        if (!e2) { inserted++; retryOk++; }
        else retryFail++;
      }
      log(table, `  개별 재시도: ${retryOk}/${batch.length} 성공, ${retryFail}건 실패`);
    }
  }

  log(table, `${inserted}/${rows.length}건 upsert`);
  return inserted;
}

// ── API 호출 (재시도 포함) ──────────────────────────────────
// 시그니처 유지: fetchWithRetry(url, options?, retries?)
export async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;

      if (res.status === 429) {
        // Rate limit — Retry-After 헤더 우선, 없으면 지수 백오프
        const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : (i + 1) ** 2 * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (res.status === 500 || res.status === 503) {
        // 서버 에러 — 지수 백오프 후 재시도
        await new Promise(r => setTimeout(r, (i + 1) ** 2 * 1000));
        continue;
      }
      // 4xx (429 제외) — 재시도 의미 없음
      if (i === retries - 1) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, (i + 1) ** 2 * 1000));
    }
  }
}

// ── 지역 매핑 ──────────────────────────────────────────────
export const REGION_MAP = {
  // 약칭 (KOSIS API 등에서 약칭으로 반환)
  "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천",
  "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종",
  "경기": "경기", "강원": "강원", "충북": "충북", "충남": "충남",
  "전북": "전북", "전남": "전남", "경북": "경북", "경남": "경남", "제주": "제주",
  // 정식명
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
  "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남",
  "제주특별자치도": "제주", "제주도": "제주",
};

export const VALID_REGIONS = [
  "서울","부산","대구","인천","광주","대전","울산","세종",
  "경기","강원","충북","충남","전북","전남","경북","경남","제주"
];

// ── 법정동코드 매핑 ────────────────────────────────────────
export const REGION_LAWD_PREFIX = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

// 구/군 → 법정동코드 5자리 (region별 중첩 구조 — 중구/서구/동구 등 동명이구 해소)
export const GU_LAWD_MAP = {
  "서울": {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200", "광진구": "11215",
    "동대문구": "11230", "중랑구": "11260", "성북구": "11290", "강북구": "11305", "도봉구": "11320",
    "노원구": "11350", "은평구": "11380", "서대문구": "11410", "마포구": "11440", "양천구": "11470",
    "강서구": "11500", "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710", "강동구": "11740",
  },
  "부산": {
    "중구": "26110", "서구": "26140", "동구": "26170", "영도구": "26200", "부산진구": "26230",
    "동래구": "26260", "남구": "26290", "북구": "26320", "해운대구": "26350", "사하구": "26380",
    "금정구": "26410", "강서구": "26440", "연제구": "26470", "수영구": "26500", "사상구": "26530",
    "기장군": "26710",
  },
  "인천": {
    "중구": "28110", "동구": "28120", "미추홀구": "28177", "연수구": "28185", "남동구": "28200",
    "부평구": "28237", "계양구": "28245", "서구": "28260", "강화군": "28710", "옹진군": "28720",
  },
  "경기": {
    "수원시": "41110", "성남시": "41130", "의정부시": "41150", "안양시": "41170", "부천시": "41190",
    "광명시": "41210", "평택시": "41220", "동두천시": "41250", "안산시": "41270", "고양시": "41280",
    "과천시": "41290", "구리시": "41310", "남양주시": "41360", "오산시": "41370", "시흥시": "41390",
    "군포시": "41410", "의왕시": "41430", "하남시": "41450", "용인시": "41460", "파주시": "41480",
    "이천시": "41500", "안성시": "41550", "김포시": "41570", "화성시": "41590", "광주시": "41610",
    "양주시": "41630", "포천시": "41650", "여주시": "41670",
  },
  "대구": {
    "중구": "27110", "동구": "27140", "서구": "27170", "남구": "27200", "북구": "27230",
    "수성구": "27260", "달서구": "27290", "달성군": "27710",
  },
  "대전": {
    "동구": "30110", "중구": "30140", "서구": "30170", "유성구": "30200", "대덕구": "30230",
  },
  "광주": {
    "동구": "29110", "서구": "29140", "남구": "29155", "북구": "29170", "광산구": "29200",
  },
  "울산": {
    "중구": "31110", "남구": "31140", "동구": "31170", "북구": "31200", "울주군": "31710",
  },
  "세종": {
    "세종시": "36110",
  },
};

export function getLawdCd(region, gu) {
  if (!gu) {
    const prefix = REGION_LAWD_PREFIX[region];
    return prefix ? prefix + "000" : null;
  }
  const regionMap = GU_LAWD_MAP[region];
  if (regionMap?.[gu]) return regionMap[gu];
  if (regionMap) {
    const short = gu.replace(/시$|군$|구$/, "");
    if (short.length >= 2) {
      for (const [name, code] of Object.entries(regionMap)) {
        if (name.startsWith(short)) return code;
      }
    }
  }
  for (const rMap of Object.values(GU_LAWD_MAP)) {
    if (rMap[gu]) return rMap[gu];
  }
  const prefix = REGION_LAWD_PREFIX[region];
  return prefix ? prefix + "000" : null;
}

// ── 건설사 별칭 ────────────────────────────────────────────
export const BUILDER_ALIASES = {
  "지에스건설": "GS건설", "GS건설(주)": "GS건설", "(주)GS건설": "GS건설",
  "현대건설(주)": "현대건설", "(주)현대건설": "현대건설",
  "(주)대우건설": "대우건설", "대우건설(주)": "대우건설",
  "에이치디씨현대산업개발": "HDC현대산업개발", "HDC현대산업개발(주)": "HDC현대산업개발",
  "디엘이앤씨": "DL이앤씨", "DL이앤씨(주)": "DL이앤씨",
  "포스코이앤씨(주)": "포스코이앤씨", "(주)포스코이앤씨": "포스코이앤씨",
  "삼성물산(주)": "삼성물산", "삼성물산건설부문": "삼성물산",
  "롯데건설(주)": "롯데건설", "(주)롯데건설": "롯데건설",
  "대림산업(주)": "대림산업", "(주)대림산업": "대림산업",
  "한화건설(주)": "한화건설", "(주)한화건설": "한화건설",
  "호반건설(주)": "호반건설", "(주)호반건설": "호반건설",
  "SK에코플랜트(주)": "SK에코플랜트",
  "태영건설(주)": "태영건설", "(주)태영건설": "태영건설",
  "금호건설(주)": "금호건설", "(주)금호건설": "금호건설",
};

export function resolveBuilder(name) {
  if (!name) return "기타";
  return BUILDER_ALIASES[name.trim()] ?? name.trim();
}

// ── 문자열 유사도 (Python SequenceMatcher 포팅) ─────────────
export function stringSimilarity(a, b) {
  a = String(a ?? "").replace(/\s+/g, "");
  b = String(b ?? "").replace(/\s+/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  const len = a.length + b.length;
  // LCS 기반 유사도
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[m][n]) / len;
}

// ── Supabase 전체 조회 (1000행 제한 자동 페이지네이션) ────────
// queryFn: (sb) => sb.from("t").select("cols").filter(...) 형태의 쿼리 빌더 콜백
export async function selectAll(queryFn, sb = null) {
  sb = sb ?? getSupabase();
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn(sb).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`selectAll 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── sleep ────────────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 오늘 날짜 ──────────────────────────────────────────────
export function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── API 쿼터 로깅 ───────────────────────────────────────────
// data.go.kr 등 일일 한도 API 사용량을 api_quota_log 테이블에 기록
export async function recordApiQuota(collector, apiName, callCount) {
  if (!callCount || callCount <= 0) return;
  try {
    const sb = getSupabase();
    const { error } = await sb.from("api_quota_log").insert({
      log_date: today(),
      collector,
      api_name: apiName,
      call_count: callCount,
    });
    if (error) logError("quota", `${collector} 쿼터 기록 실패: ${error.message}`);
    else log("quota", `${collector}: ${apiName} ${callCount}회 기록`);
  } catch (err) {
    // 쿼터 로깅 실패는 수집 중단하지 않음
    logError("quota", `${collector} 쿼터 기록 예외: ${err.message}`);
  }
}

// ── 수집 리포터 ─────────────────────────────────────────────
export function createReporter(phase) {
  const startTime = Date.now();
  let ok = 0, fail = 0, skip = 0;
  return {
    success(n = 1) { ok += n; },
    fail(n = 1) { fail += n; },
    skip(n = 1) { skip += n; },
    summary() {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const total = ok + fail + skip;
      log(phase, `[완료] ${elapsed}초 | 성공 ${ok} | 실패 ${fail} | 스킵 ${skip} | 총 ${total}건`);
      return { elapsed, ok, fail, skip, total };
    },
  };
}
