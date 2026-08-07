/**
 * 공유 유틸리티 — 수집 스크립트 공통 모듈
 *
 * M5d-1 (세션 193): // @ts-nocheck 제거 + 24 export 정밀 typedef 박제.
 * 의존자 42 (collectors 본체 전수). 본 모듈 typedef 가 M5d-2~4 (collectors 본체) 의 사전 조건.
 */
// @ts-check
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "../..");

// ── .env 로드 ──────────────────────────────────────────────
/** @returns {void} */
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
/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let _supabase = null;
/** @returns {import("@supabase/supabase-js").SupabaseClient} */
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
/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let _supabaseMibunyang = null;
/** @returns {import("@supabase/supabase-js").SupabaseClient} */
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
/**
 * @param {string} phase
 * @param {string} msg
 * @returns {void}
 */
export function log(phase, msg) {
  console.log(`[${phase}] ${msg}`);
}

/**
 * @param {string} phase
 * @param {string} msg
 * @returns {void}
 */
export function logError(phase, msg) {
  console.error(`[${phase}] ERROR: ${msg}`);
}

// ── 세마포어 (동시 실행 수 제한) ───────────────────────────
/**
 * @param {number} max
 * @returns {<T>(fn: () => Promise<T>) => Promise<T>}
 */
export function createSemaphore(max) {
  let running = 0;
  /** @type {Array<(value?: unknown) => void>} */
  const queue = [];
  return async (fn) => {
    if (running >= max) await new Promise(r => queue.push(r));
    running++;
    try { return await fn(); }
    finally { running--; if (queue.length) { const next = queue.shift(); if (next) next(); } }
  };
}

/**
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

// ── 배치 upsert ────────────────────────────────────────────
const RATE_LIMIT_RE = /too many|rate limit/i;

/**
 * @template T
 * @param {string} table
 * @param {T[]} rows
 * @param {string} conflictCol
 * @param {number} [batchSize]
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [sb]
 * @param {{ delayMs?: number; maxRetries?: number }} [opts]
 * @returns {Promise<number>}
 */
export async function upsertBatch(table, rows, conflictCol, batchSize = 500, sb = null, { delayMs = 100, maxRetries = 3 } = {}) {
  if (!rows.length) return 0;
  const client = sb ?? getSupabase();
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const batch = rows.slice(i, i + batchSize);
    /** @type {{ message?: string } | null} */
    let error = null;

    // 429 재시도 루프
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await /** @type {any} */ (client.from(table))
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
        const { error: e2 } = await /** @type {any} */ (client.from(table))
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
/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [retries]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // 세션 496: 호출자가 signal 을 넘겼으면 그걸 존중한다. 예전엔 `AbortSignal.timeout(30000)`
      // 이 무조건 options.signal 을 덮어써 호출자가 준 더 짧은 timeout(예: transport-tago 의
      // 15000ms)이 조용히 무시됐다. 호출자 미지정(undefined/null) 시에만 30초 기본값을 쓴다 —
      // 46개 수집기가 공유하는 기본 동작은 이 분기로 그대로 유지된다.
      const res = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(30000) });
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
  throw new Error(`fetchWithRetry: ${retries}회 재시도 소진`);
}

// ── 지역 매핑 ──────────────────────────────────────────────
/** @type {import("../types.ts").RegionMap} */
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

/** @type {readonly string[]} */
export const VALID_REGIONS = [
  "서울","부산","대구","인천","광주","대전","울산","세종",
  "경기","강원","충북","충남","전북","전남","경북","경남","제주"
];

// ── 법정동코드 매핑 ────────────────────────────────────────
/** @type {import("../types.ts").RegionMap} */
export const REGION_LAWD_PREFIX = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

// 구/군 → 법정동코드 5자리 (region별 중첩 구조 — 중구/서구/동구 등 동명이구 해소)
/** @type {import("../types.ts").GuLawdMap} */
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
  // 경기 통합시 — 수원/성남/안양/부천/안산/고양/용인은 "시 단위"(41110/41130/41170/41190/41270/41280/41460) 가 MOLIT 미지원. 하위 구 복합 gu 를 추가. 기존 단일 키는 parseAddress/레거시 호환 위해 유지하되, 실제 MOLIT 호출은 복합 gu 경로만 성공.
  "경기": {
    "수원시": "41110",
    "수원시 장안구": "41111", "수원시 권선구": "41113",
    "수원시 팔달구": "41115", "수원시 영통구": "41117",
    "성남시": "41130",
    "성남시 수정구": "41131", "성남시 중원구": "41133", "성남시 분당구": "41135",
    "안양시": "41170",
    "안양시 만안구": "41171", "안양시 동안구": "41173",
    "안산시": "41270",
    "안산시 상록구": "41271", "안산시 단원구": "41273",
    "고양시": "41280",
    "고양시 덕양구": "41281", "고양시 일산동구": "41285", "고양시 일산서구": "41287",
    "용인시": "41460",
    "용인시 처인구": "41461", "용인시 기흥구": "41463", "용인시 수지구": "41465",
    "부천시": "41190",
    "부천시 원미구": "41192", "부천시 소사구": "41194", "부천시 오정구": "41196",
    "의정부시": "41150", "광명시": "41210", "평택시": "41220", "동두천시": "41250",
    "과천시": "41290", "구리시": "41310", "남양주시": "41360", "오산시": "41370", "시흥시": "41390",
    "군포시": "41410", "의왕시": "41430", "하남시": "41450", "파주시": "41480",
    "이천시": "41500", "안성시": "41550", "김포시": "41570", "화성시": "41591", "광주시": "41610",
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
  // 강원특별자치도 (2023-06-11 출범) 이후 LAWD_CD 42→51 개편
  "강원": {
    "춘천시": "51110", "원주시": "51130", "강릉시": "51150", "동해시": "51170",
    "태백시": "51190", "속초시": "51210", "삼척시": "51230",
    "홍천군": "51720", "횡성군": "51730", "영월군": "51750", "평창군": "51760",
    "정선군": "51770", "철원군": "51780", "화천군": "51790", "양구군": "51800",
    "인제군": "51810", "고성군": "51820", "양양군": "51830",
  },
  // 청주시는 2014 통합 이후 4구(상당/서원/흥덕/청원)만 유효. "청주시" 단일 코드는 MOLIT 미지원.
  "충북": {
    "청주시 상당구": "43111", "청주시 서원구": "43112",
    "청주시 흥덕구": "43113", "청주시 청원구": "43114",
    "충주시": "43130", "제천시": "43150",
    "보은군": "43720", "옥천군": "43730", "영동군": "43740", "증평군": "43745",
    "진천군": "43750", "괴산군": "43760", "음성군": "43770", "단양군": "43800",
  },
  // 천안시는 2008 분구 이후 동남/서북 2구만 유효. "천안시" 단일 코드는 MOLIT 미지원.
  "충남": {
    "천안시 동남구": "44131", "천안시 서북구": "44133",
    "공주시": "44150", "보령시": "44180", "아산시": "44200",
    "서산시": "44210", "논산시": "44230", "계룡시": "44250", "당진시": "44270",
    "금산군": "44710", "부여군": "44760", "서천군": "44770", "청양군": "44790",
    "홍성군": "44800", "예산군": "44810", "태안군": "44825",
  },
  // 전북특별자치도 (2024-01-18 출범) 이후 LAWD_CD 45→52 개편. 전주시는 완산/덕진 구 단위만 유효.
  "전북": {
    "전주시 완산구": "52111", "전주시 덕진구": "52113",
    "군산시": "52130", "익산시": "52140", "정읍시": "52180",
    "남원시": "52190", "김제시": "52210",
    "완주군": "52710", "진안군": "52720", "무주군": "52730", "장수군": "52740",
    "임실군": "52750", "순창군": "52770", "고창군": "52790", "부안군": "52800",
  },
  "전남": {
    "목포시": "46110", "여수시": "46130", "순천시": "46150", "나주시": "46170",
    "광양시": "46230",
    "담양군": "46710", "곡성군": "46720", "구례군": "46730", "고흥군": "46770",
    "보성군": "46780", "화순군": "46790", "장흥군": "46800", "강진군": "46810",
    "해남군": "46820", "영암군": "46830", "무안군": "46840", "함평군": "46860",
    "영광군": "46870", "장성군": "46880", "완도군": "46890", "진도군": "46900",
    "신안군": "46910",
  },
  // 포항시는 1995 분구 이후 남구/북구 2구만 유효. "포항시" 단일 코드는 MOLIT 미지원.
  "경북": {
    "포항시 남구": "47111", "포항시 북구": "47113",
    "경주시": "47130", "김천시": "47150", "안동시": "47170",
    "구미시": "47190", "영주시": "47210", "영천시": "47230", "상주시": "47250",
    "문경시": "47280", "경산시": "47290",
    "군위군": "47720", "의성군": "47730", "청송군": "47750", "영양군": "47760",
    "영덕군": "47770", "청도군": "47820", "고령군": "47830", "성주군": "47840",
    "칠곡군": "47850", "예천군": "47900", "봉화군": "47920", "울진군": "47930",
    "울릉군": "47940",
  },
  // 창원시는 2010 통합 이후 5구(의창/성산/마산합포/마산회원/진해)만 유효. "창원시" 단일 코드는 MOLIT 미지원.
  "경남": {
    "창원시 의창구": "48121", "창원시 성산구": "48123",
    "창원시 마산합포구": "48125", "창원시 마산회원구": "48127",
    "창원시 진해구": "48129",
    "진주시": "48170", "통영시": "48220", "사천시": "48240",
    "김해시": "48250", "밀양시": "48270", "거제시": "48310", "양산시": "48330",
    "의령군": "48720", "함안군": "48730", "창녕군": "48740", "고성군": "48820",
    "남해군": "48840", "하동군": "48850", "산청군": "48860", "함양군": "48870",
    "거창군": "48880", "합천군": "48890",
  },
  "제주": {
    "제주시": "50110", "서귀포시": "50130",
  },
};

// 세션95 단계 B: apartments.gu 정규화 (화성시 재오염 방지 방어선).
// "화성시 동탄구" 같은 복합 문자열이 미래 경로로 들어와도 "화성시"로 축약.
// 세션94 에서 확정된 화성시 비법정 구 화이트리스트만 처리.
// 신규 region/case 는 여기 추가.
const HWASEONG_BARE_GU = new Set(["동탄구", "만세구", "효행구", "병점구"]);
/**
 * @param {string} region
 * @param {string | null | undefined} gu
 * @returns {string | null | undefined}
 */
export function normalizeGu(region, gu) {
  if (!gu) return gu;
  if (region === "경기") {
    if (gu.startsWith("화성시 ")) return "화성시";
    if (HWASEONG_BARE_GU.has(gu)) return "화성시";
  }
  return gu;
}

/**
 * @param {string} region
 * @param {string | null | undefined} [gu]
 * @returns {string | null}
 */
export function getLawdCd(region, gu) {
  // 세종특별자치시는 구·군 없이 단일 LAWD_CD(36110)만 유효. prefix+"000"(36000)은 MOLIT 미지원.
  if (region === "세종") return "36110";
  if (!gu) {
    const prefix = REGION_LAWD_PREFIX[region];
    return prefix ? prefix + "000" : null;
  }
  const regionMap = GU_LAWD_MAP[region];
  if (regionMap?.[gu]) return regionMap[gu];
  // 통합시(천안/청주/창원/포항/전주) 단독 구 형식 매칭 — "동남구"로 "천안시 동남구" 찾기
  if (regionMap && gu.endsWith("구")) {
    for (const [name, code] of Object.entries(regionMap)) {
      if (name.endsWith(" " + gu)) return code;
    }
  }
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
/** @type {import("../types.ts").BuilderAliasMap} */
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

/**
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function resolveBuilder(name) {
  if (!name) return "기타";
  return BUILDER_ALIASES[name.trim()] ?? name.trim();
}

// ── 문자열 유사도 (Python SequenceMatcher 포팅) ─────────────
/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function stringSimilarity(a, b) {
  const sa = String(a ?? "").replace(/\s+/g, "");
  const sb = String(b ?? "").replace(/\s+/g, "");
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  const len = sa.length + sb.length;
  // LCS 기반 유사도
  const m = sa.length, n = sb.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = sa[i - 1] === sb[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[m][n]) / len;
}

// ── Supabase 전체 조회 (1000행 제한 자동 페이지네이션) ────────
// queryFn: (sb) => sb.from("t").select("cols").filter(...) 형태의 쿼리 빌더 콜백
/**
 * @template T
 * @param {(sb: import("@supabase/supabase-js").SupabaseClient) => any} queryFn
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [sb]
 * @returns {Promise<T[]>}
 */
export async function selectAll(queryFn, sb = null) {
  const client = sb ?? getSupabase();
  const PAGE = 1000;
  /** @type {T[]} */
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn(client).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`selectAll 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── sleep ────────────────────────────────────────────────────
/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── wall-clock budget ────────────────────────────────────────
/**
 * job `timeout-minutes` **미만**에서 수집기가 스스로 멈추게 하는 벽시계 예산.
 *
 * ⚠️ 왜 필요한가: GitHub Actions 는 `timeout-minutes` 도달 시 step 을 **즉시 SIGKILL**
 *    (grace 0) 한다 — graceful break 도, 마지막 저장도 실행될 틈이 없다. 수집을 다 끝낸 뒤
 *    한 번에 upsert 하는 수집기는 그 순간 **그때까지의 수집분을 전량 잃는다**
 *    (실측: collect-trades 7/6 run 28821807904 = 120분 일하고 저장 0건).
 *    job timeout 보다 작은 예산에서 먼저 멈추면 부분 저장이라도 남는다.
 *
 * @param {number} startedAt  main() 시작 시각 (Date.now())
 * @param {number} budgetMin  예산 (분). 0 이하 = 비활성(무제한)
 * @param {number} [nowMs]    현재 시각 (테스트 주입용)
 * @returns {boolean}
 */
export function budgetExceeded(startedAt, budgetMin, nowMs = Date.now()) {
  if (budgetMin <= 0) return false;
  return (nowMs - startedAt) >= budgetMin * 60_000;
}

// ── 오늘 날짜 (KST 고정) ────────────────────────────────────
// 환경 무관 KST 날짜 — Intl en-CA = YYYY-MM-DD. GitHub Actions(UTC 러너)에서도 KST 보장.
// 수집기 cron 이 KST 02:00~08:00 발화인데 UTC toISOString 은 그 시각 전날을 줘서 recorded_at 이
// 하루 밀리던 결함(세션 419) 정정. TZ env 에 의존하지 않고 코드에서 고정(이중 안전망 불필요).
const KST_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
/** @returns {string} KST 기준 YYYY-MM-DD */
export function today() {
  return KST_DATE_FMT.format(new Date());
}

// ── 미분양률 클램프 (세션 445) ──────────────────────────────
/**
 * 미분양률 100% 초과는 데이터 신뢰 불가(청약홈 잔여세대 공고의 "이번 회차 공급분"이
 * 분모로 들어가 폭발한 값)라 null 로 무력화한다. 미분양은 본질적으로 전체 세대수를
 * 넘을 수 없으므로 229%·2900% 같은 값은 진짜 미분양률이 아님 → "세대수 미확인(중립)"
 * 으로 취급. 100 이하(100 포함)는 그대로 둔다.
 * 점수(scoreRisk)·중위값·정렬이 전부 이 null 을 중립 처리하도록 단일 경계(>100)로 통일.
 * @param {number | null | undefined} rate
 * @returns {number | null}
 */
export function clampUnsoldRate(rate) {
  if (rate == null) return null;
  return rate > 100 ? null : rate;
}

// ── API 쿼터 로깅 ───────────────────────────────────────────
// data.go.kr 등 일일 한도 API 사용량을 api_quota_log 테이블에 기록
/**
 * @param {string} collector
 * @param {string} apiName
 * @param {number} callCount
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [sbOverride] 테스트용 Supabase 클라이언트 주입. 주입 시 --dry-run argv 무시하고 항상 기록.
 * @returns {Promise<void>}
 */
export async function recordApiQuota(collector, apiName, callCount, sbOverride = null) {
  if (!callCount || callCount <= 0) return;
  // dry-run 실행은 api_quota_log 오염 방지를 위해 기록 skip.
  // sbOverride(테스트 클라이언트 주입) 가 있으면 argv 무관하게 항상 기록 — 테스트 격리.
  if (!sbOverride && process.argv.includes("--dry-run")) {
    log("quota", `${collector}: dry-run — api_quota_log 기록 skip`);
    return;
  }
  try {
    const sb = sbOverride ?? getSupabase();
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
    const msg = err instanceof Error ? err.message : String(err);
    logError("quota", `${collector} 쿼터 기록 예외: ${msg}`);
  }
}

// ── 수집 실행 결과 기록 ──────────────────────────────────────
// 수집기가 끝날 때 성공/실패/처리건수를 collector_runs 테이블에 1행 INSERT
/**
 * @param {string} collector 수집기명 (예: "molit-units")
 * @param {{ status?: string, ok?: number, fail?: number, skip?: number,
 *           elapsed?: string|number, errorMessage?: string|null,
 *           startedAt?: string|null }} result
 *        createReporter().summary() 반환값 + status/errorMessage/startedAt
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [sbOverride]
 *        테스트용 Supabase 클라이언트 주입 (selectAll/upsertBatch 패턴 답습).
 *        주입 시 --dry-run argv 무시하고 항상 기록.
 * @returns {Promise<void>}
 */
export async function recordCollectorRun(collector, result, sbOverride = null) {
  // dry-run 실행은 collector_runs 오염 방지를 위해 기록 skip.
  // sbOverride(테스트 클라이언트 주입) 가 있으면 argv 무관하게 항상 기록 — 테스트 격리.
  if (!sbOverride && process.argv.includes("--dry-run")) {
    log("runs", `${collector}: dry-run — collector_runs 기록 skip`);
    return;
  }
  try {
    const sb = sbOverride ?? getSupabase();
    const status = result.status
      ?? ((result.fail ?? 0) > 0 ? "failure" : "success");
    log("runs", `${collector}: INSERT 시도 (status=${status})`);
    const { error } = await sb.from("collector_runs").insert({
      collector,
      status,
      ok_count: result.ok ?? null,
      fail_count: result.fail ?? null,
      skip_count: result.skip ?? null,
      elapsed_sec: result.elapsed != null ? Number(result.elapsed) : null,
      error_message: result.errorMessage ?? null,
      started_at: result.startedAt ?? null,
    });
    if (error) {
      const errObj = /** @type {any} */ (error);
      logError("runs", `${collector} 실행 기록 실패: ${error.message} (code=${errObj.code ?? "?"} details=${errObj.details ?? "?"} hint=${errObj.hint ?? "?"})`);
    } else {
      log("runs", `${collector}: ${status} 기록 (성공 ${result.ok ?? 0} 실패 ${result.fail ?? 0})`);
    }
  } catch (err) {
    // 실행 기록 실패는 수집 중단하지 않음
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    logError("runs", `${collector} 실행 기록 예외: ${msg}\n${stack}`);
  }
}

// ── Graceful shutdown ──────────────────────────────────────
/**
 * 세션 321: GitHub Actions timeout (SIGTERM) 받으면 멈춤 신호 박힘.
 * createReporter 미사용 collector 자리에서 1회 호출:
 *   const isInterrupted = setupGracefulShutdown(PHASE);
 *   for (...) {
 *     if (isInterrupted()) break;
 *     ...
 *   }
 *
 * @param {string} phase
 * @returns {() => boolean} interrupted 상태 조회 함수
 */
export function setupGracefulShutdown(phase) {
  let interrupted = false;
  process.once("SIGTERM", () => {
    interrupted = true;
    log(phase, "SIGTERM 받음 — graceful 중단 (다음 루프 반복부터)");
  });
  return () => interrupted;
}

// ── 수집 리포터 ─────────────────────────────────────────────
/**
 * Graceful shutdown 지원 (세션 321):
 * - SIGTERM 받으면 interrupted=true. GitHub Actions timeout 시점에 5초 유예 받음.
 * - 수집기 main() loop 에서 `if (rpt.interrupted()) break;` 1줄로 graceful 중단.
 * - summary() = status 자동 판정 (interrupted 시 "partial").
 *
 * @param {string} phase
 * @returns {import("../types.ts").Reporter & { interrupted: () => boolean }}
 */
export function createReporter(phase) {
  const startTime = Date.now();
  let ok = 0, fail = 0, skip = 0;
  let interrupted = false;

  const sigHandler = () => {
    interrupted = true;
    log(phase, "SIGTERM 받음 — graceful 중단 (다음 루프 반복부터)");
  };
  process.once("SIGTERM", sigHandler);

  return {
    success(n = 1) { ok += n; },
    fail(n = 1) { fail += n; },
    skip(n = 1) { skip += n; },
    interrupted: () => interrupted,
    summary() {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const total = ok + fail + skip;
      const status = interrupted ? "partial" : ((fail > 0) ? "failure" : "success");
      log(phase, `[완료] ${elapsed}초 | 성공 ${ok} | 실패 ${fail} | 스킵 ${skip} | 총 ${total}건${interrupted ? " (graceful 중단)" : ""}`);
      process.removeListener("SIGTERM", sigHandler);
      return { elapsed, ok, fail, skip, total, status };
    },
  };
}
