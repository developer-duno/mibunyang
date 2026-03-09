/**
 * 네이버 부동산 API 클라이언트
 *
 * 기능: JWT 토큰 관리, 요청 쓰로틀링, 캐시, 재시도
 * 참조: scripts/collectors/naver-listings.mjs (미분양 프로젝트 원본)
 */

const NAVER_BASE = "https://new.land.naver.com";
const MIN_INTERVAL = 1000;      // 요청 간 최소 1초
const PAGE_DELAY = 1500;        // 페이지 간 1.5초
const MAX_RETRIES = 3;
const RETRY_DELAYS = [3000, 5000, 10000];
const CACHE_TTL = 3_600_000;    // 1시간 (단지 정보는 안정적)
const MAX_CACHE_SIZE = 5000;    // 주변 단지 겹침 고려
const JWT_LIFETIME = 3000_000;  // 50분
const FETCH_TIMEOUT = 15_000;   // fetch 타임아웃 15초
const TRANSIENT_CODES = new Set([408, 429, 500, 502, 503, 504]);

const M2_TO_PYEONG = 3.3058;

// ── 상태 ─────────────────────────────────────────────────────
let jwtToken = null;
let jwtExpiry = 0;
let lastRequestTime = 0;
const cache = new Map();
// Phase 3: 적응형 쓰로틀 + 쿠키 세션
let dynamicInterval = MIN_INTERVAL;
let consecutiveSuccess = 0;
let sessionCookies = "";

// ── 헤더 ─────────────────────────────────────────────────────
function baseHeaders() {
  const h = {
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
  if (sessionCookies) h["Cookie"] = sessionCookies;
  return h;
}

function authHeaders(complexNo) {
  return {
    ...baseHeaders(),
    "Authorization": `Bearer ${jwtToken}`,
    "Referer": `${NAVER_BASE}/complexes/${complexNo}`,
  };
}

// ── 쓰로틀 (적응형) ──────────────────────────────────────────
async function throttle(extraDelay = 0) {
  const elapsed = Date.now() - lastRequestTime;
  const wait = Math.max(0, dynamicInterval + extraDelay - elapsed);
  if (wait > 0) await sleep(wait);
  lastRequestTime = Date.now();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 캐시 ─────────────────────────────────────────────────────
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { time: Date.now(), data });
}

// ── 세션 초기화 (쿠키 획득) ──────────────────────────────────
async function initSession() {
  if (sessionCookies) return;
  try {
    await throttle();
    const res = await fetch(`${NAVER_BASE}/`, { headers: baseHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    const cookies = res.headers.getSetCookie?.() || [];
    sessionCookies = cookies.map(c => c.split(";")[0]).join("; ");
    if (sessionCookies) console.log("  🍪 세션 쿠키 획득 완료");
  } catch (err) {
    console.warn(`  ⚠ 세션 초기화 실패 (무시): ${err.message}`);
  }
}

// ── JWT 토큰 ─────────────────────────────────────────────────
async function fetchJwtToken(complexNo = "217") {
  console.log("  🔑 JWT 토큰 발급 중...");
  await throttle();
  const url = `${NAVER_BASE}/complexes/${complexNo}`;
  const res = await fetch(url, { headers: baseHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`JWT 페이지 요청 실패: ${res.status}`);
  const html = await res.text();

  const patterns = [
    /"token":"(eyJ[A-Za-z0-9._-]+)"/,
    /token\s*[:=]\s*["'](eyJ[A-Za-z0-9._-]+)["']/,
    /"accessToken"\s*:\s*"(eyJ[A-Za-z0-9._-]+)"/,
    /Bearer\s+(eyJ[A-Za-z0-9._-]+)/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      jwtToken = m[1];
      jwtExpiry = Date.now() + JWT_LIFETIME;
      console.log(`  🔑 JWT 발급 완료 (유효: ${Math.round(JWT_LIFETIME / 60000)}분)`);
      return jwtToken;
    }
  }
  throw new Error("JWT 토큰 추출 실패");
}

let jwtPromise = null;
async function ensureJwt(complexNo) {
  await initSession();
  if (!jwtToken || Date.now() > jwtExpiry) {
    if (!jwtPromise) {
      jwtPromise = fetchJwtToken(complexNo).finally(() => { jwtPromise = null; });
    }
    await jwtPromise;
  }
}

// ── HTTP 요청 (재시도 포함) ──────────────────────────────────
async function fetchWithRetry(url, headers, retries = MAX_RETRIES, useCache = true) {
  if (useCache) {
    const cached = getCached(url);
    if (cached) return cached;
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttle(attempt > 0 ? PAGE_DELAY : 0);
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });

      if (res.status === 429) {
        dynamicInterval = Math.min(dynamicInterval * 1.5, 5000);
        consecutiveSuccess = 0;
        console.warn(`  ⚠ 429 Rate Limit — 쓰로틀 증가: ${dynamicInterval}ms`);
        jwtToken = null;
        await sleep(RETRY_DELAYS[attempt] || 10000);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        console.warn(`  ⚠ ${res.status} Auth — JWT 재발급`);
        jwtToken = null;
        await sleep(RETRY_DELAYS[attempt] || 3000);
        continue;
      }
      if (!res.ok) {
        if (TRANSIENT_CODES.has(res.status)) {
          console.warn(`  ⚠ ${res.status} 일시 오류 — 재시도 대기`);
          await sleep(RETRY_DELAYS[attempt] || 3000);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      if (!text || text.length === 0) {
        if (attempt === retries) throw new Error("빈 응답 (rate limit 가능성)");
        console.warn(`  ⚠ 빈 응답 — 재시도 (${attempt + 1}/${retries})`);
        await sleep(RETRY_DELAYS[attempt] || 3000);
        continue;
      }
      const json = JSON.parse(text);
      if (useCache) setCached(url, json);
      // 연속 성공 시 쓰로틀 복원
      consecutiveSuccess++;
      if (consecutiveSuccess >= 10 && dynamicInterval > MIN_INTERVAL) {
        dynamicInterval = Math.max(dynamicInterval * 0.8, MIN_INTERVAL);
        consecutiveSuccess = 0;
      }
      return json;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  ⚠ [${err.name}] 요청 실패 (${attempt + 1}/${retries}): ${err.message}`);
      await sleep(RETRY_DELAYS[attempt] || 3000);
    }
  }
}

// ── 공개 API: 키워드 검색 ────────────────────────────────────
export async function searchComplexes(keyword, maxPages = 3) {
  await initSession();
  const cacheKey = `search:${keyword}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const allComplexes = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    await throttle(page > 1 ? PAGE_DELAY : 0);
    const url = `${NAVER_BASE}/api/search?keyword=${encodeURIComponent(keyword)}&page=${page}`;
    try {
      const data = await fetchWithRetry(url, baseHeaders());
      const list = data?.complexList || data?.complexes || [];
      for (const c of list) {
        if (c.complexNo && !seen.has(c.complexNo)) {
          seen.add(c.complexNo);
          allComplexes.push(c);
        }
      }
      if (!data?.isMoreData) break;
    } catch (err) {
      console.warn(`  ⚠ 검색 실패 (${keyword}, page ${page}): ${err.message}`);
      break;
    }
  }

  setCached(cacheKey, allComplexes);
  return allComplexes;
}

// ── 공개 API: 단지 상세 ──────────────────────────────────────
export async function getComplexDetail(complexNo) {
  const cacheKey = `complex:${complexNo}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureJwt(complexNo);
  const url = `${NAVER_BASE}/api/complexes/${complexNo}`;
  const data = await fetchWithRetry(url, authHeaders(complexNo));
  setCached(cacheKey, data);
  return data;
}

// ── 공개 API: 단지별 매물 목록 ───────────────────────────────
export async function getComplexArticles(complexNo, tradeType = "", maxPages = 5) {
  await ensureJwt(complexNo);
  const allArticles = [];

  for (let page = 1; page <= maxPages; page++) {
    const tradeParam = tradeType || "";
    const url = `${NAVER_BASE}/api/articles/complex/${complexNo}`
      + `?realEstateType=APT%3AABYG%3AJGC%3APRE&tradeType=${tradeParam}`
      + `&tag=%3A%3A%3A%3A%3A%3A%3A%3A`
      + `&rentPriceMin=0&rentPriceMax=900000000`
      + `&priceMin=0&priceMax=900000000`
      + `&areaMin=0&areaMax=900000000`
      + `&oldBuildYears&recentlyBuildYears`
      + `&minHouseHoldCount&maxHouseHoldCount`
      + `&showArticle=false&sameAddressGroup=false`
      + `&minMaintenanceCost&maxMaintenanceCost`
      + `&priceType=RETAIL&directions=`
      + `&page=${page}&complexNo=${complexNo}`
      + `&buildingNos=&areaNos=&type=list&order=rank`;
    try {
      const data = await fetchWithRetry(url, authHeaders(complexNo), MAX_RETRIES, false);
      const list = data?.articleList || [];
      allArticles.push(...list);
      if (!data?.isMoreData) break;
    } catch (err) {
      console.warn(`  ⚠ 매물 수집 실패 (${complexNo}, page ${page}): ${err.message}`);
      break;
    }
    if (page < maxPages) await sleep(PAGE_DELAY);
  }

  return allArticles;
}

// ── 공개 API: 시세 이력 ──────────────────────────────────────
export async function getComplexPrices(complexNo, tradeType = "A1", year = 5) {
  const cacheKey = `prices:${complexNo}:${tradeType}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureJwt(complexNo);
  const params = new URLSearchParams({
    complexNo: String(complexNo),
    tradeType,
    year: String(year),
  });
  const url = `${NAVER_BASE}/api/complexes/${complexNo}/prices?${params}`;

  try {
    const data = await fetchWithRetry(url, authHeaders(complexNo));
    setCached(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`  ⚠ 시세 이력 수집 실패 (${complexNo}): ${err.message}`);
    return null;
  }
}

// ── 가격 파싱 유틸 ───────────────────────────────────────────
export function parseNaverPrice(str) {
  if (!str) return 0;
  const s = str.toString().replace(/[,\s만원]/g, "");
  const parts = s.split("억");
  if (parts.length === 2) {
    const eok = (parseInt(parts[0]) || 0) * 10000;
    const rest = parts[1];
    if (rest.includes("천")) {
      // "3천" → 3000, "3천5백" → 3500, "3천500" → 3500
      const cheonMatch = rest.match(/(\d+)\s*천/);
      const cheon = (parseInt(cheonMatch?.[1]) || 0) * 1000;
      const afterCheon = rest.replace(/\d+\s*천/, "");
      const baekMatch = afterCheon.match(/(\d+)\s*백/);
      const remainder = baekMatch ? (parseInt(baekMatch[1]) || 0) * 100
        : (parseInt(afterCheon) || 0);
      return eok + cheon + remainder;
    }
    return eok + (parseInt(rest) || 0);
  }
  if (s.includes("천")) {
    const cheonMatch = s.match(/(\d+)\s*천/);
    const cheon = (parseInt(cheonMatch?.[1]) || 0) * 1000;
    const afterCheon = s.replace(/\d+\s*천/, "");
    const baekMatch = afterCheon.match(/(\d+)\s*백/);
    const remainder = baekMatch ? (parseInt(baekMatch[1]) || 0) * 100
      : (parseInt(afterCheon) || 0);
    return cheon + remainder;
  }
  return parseInt(s) || 0;
}

export function calcPP(price, areaM2) {
  if (!price || !areaM2 || areaM2 <= 0) return 0;
  return Math.round(price / (areaM2 / M2_TO_PYEONG));
}

// ── 공개 API: 단지별 학군 정보 ───────────────────────────────
export async function getComplexSchools(complexNo) {
  const cacheKey = `schools:${complexNo}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureJwt(complexNo);
  const url = `${NAVER_BASE}/api/complexes/${complexNo}/schools`;
  try {
    const data = await fetchWithRetry(url, authHeaders(complexNo));
    setCached(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`  ⚠ 학군 수집 실패 (${complexNo}): ${err.message}`);
    return null;
  }
}

export { M2_TO_PYEONG };
