/**
 * 네이버 부동산 매물 수집기 — 미분양 아파트 인근 시세 데이터
 *
 * Python 원본: D:/cursor/네이버 아파트/web/shared/naver_api.py
 * Node.js 포트: API 로직, JWT 패턴, 가격 파싱을 그대로 카피
 *
 * 사용법:
 *   node scripts/collectors/naver-listings.mjs
 *   node scripts/collectors/naver-listings.mjs --dry-run
 *   node scripts/collectors/naver-listings.mjs --limit=10   (아파트 N개만)
 *
 * 수집 흐름 (4단계):
 *   1. Supabase apartments 테이블에서 미분양 아파트 좌표 조회
 *   2. 각 좌표 주변 네이버 단지 검색 → naver_complexes에 upsert
 *   3. 단지별 매물 수집 → naver_articles에 upsert + 소프트 삭제
 *   4. 단지별 시세 이력 수집 → naver_price_history에 upsert (매매+전세)
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, upsertBatch, log, logError, today } from "./_shared.mjs";

loadEnv();

// ── 상수 (Python constants.py 포트) ────────────────────────
const NAVER_BASE = "https://new.land.naver.com";
const NAVER_SEARCH_API = `${NAVER_BASE}/api/search`;
const NAVER_COMPLEX_API = `${NAVER_BASE}/api/complexes`;
const NAVER_ARTICLES_API = `${NAVER_BASE}/api/articles/complex`;
const NAVER_ARTICLE_DETAIL_API = `${NAVER_BASE}/api/articles`;

const JWT_TOKEN_PATTERN = /"token":"(eyJ[A-Za-z0-9._-]+)"/;
const JWT_LIFETIME = 3000 * 1000; // 50분 (ms)
const MIN_INTERVAL = 1000;        // 요청 간 최소 1초
const PAGE_DELAY = 1500;          // 페이지 간 1.5초
const MAX_RETRIES = 3;
const RETRY_DELAYS = [3000, 5000, 10000];
const CACHE_TTL = 600000;         // 캐시 10분
const MAX_CACHE_SIZE = 500;       // 캐시 최대 항목 수

const M2_TO_PYEONG = 3.3058;

// ── CLI 인자 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const enrichDetail = args.includes("--enrich");
const limitArg = args.find(a => a.startsWith("--limit="));
const aptLimit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;

// ── NaverEstateAPI (Python NaverEstateAPI 클래스 포트) ──────
let jwtToken = null;
let jwtTokenTime = 0;
let lastRequestTime = 0;
const cache = new Map();

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

/** Rate limiting — 최소 간격 보장 */
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await sleep(MIN_INTERVAL - elapsed);
  }
  lastRequestTime = Date.now();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** 캐시 조회 */
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

/** JWT 토큰 추출 (Python _ensure_jwt 포트) */
async function ensureJwt(complexId) {
  // 유효한 토큰 있으면 재사용
  if (jwtToken && (Date.now() - jwtTokenTime) < JWT_LIFETIME) {
    return jwtToken;
  }

  const targetId = complexId || "217";  // 기본 단지 ID (은마아파트)
  const url = `${NAVER_BASE}/complexes/${targetId}`;

  await throttle();
  const res = await fetch(url, {
    headers: { ...HEADERS, "Accept": "text/html" },
  });

  if (!res.ok) {
    throw new Error(`JWT 페이지 로드 실패: ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(JWT_TOKEN_PATTERN);
  if (!match) {
    // 대체 패턴 시도
    const altPatterns = [
      /token\s*[:=]\s*["'](eyJ[A-Za-z0-9._-]+)["']/,
      /"accessToken"\s*:\s*"(eyJ[A-Za-z0-9._-]+)"/,
      /Bearer\s+(eyJ[A-Za-z0-9._-]+)/,
    ];
    for (const pat of altPatterns) {
      const m = html.match(pat);
      if (m) {
        jwtToken = m[1];
        jwtTokenTime = Date.now();
        log("jwt", `대체 패턴으로 토큰 획득 (${jwtToken.slice(0, 20)}...)`);
        return jwtToken;
      }
    }
    throw new Error("JWT 토큰 추출 실패 — HTML에서 토큰을 찾을 수 없음");
  }

  jwtToken = match[1];
  jwtTokenTime = Date.now();
  log("jwt", `토큰 획득 (${jwtToken.slice(0, 20)}...)`);
  return jwtToken;
}

/** HTTP 요청 + 재시도 (Python _request_with_retry 포트) */
async function requestWithRetry(url, params = {}, needAuth = false, refererComplexId = null) {
  const qs = new URLSearchParams(params).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;
  const cacheKey = fullUrl;

  const cached = getCached(cacheKey);
  if (cached) return cached;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await throttle();

      const headers = { ...HEADERS };
      if (needAuth) {
        const token = await ensureJwt(refererComplexId);
        headers["Authorization"] = `Bearer ${token}`;
        if (refererComplexId) {
          headers["Referer"] = `${NAVER_BASE}/complexes/${refererComplexId}`;
        }
      }

      const res = await fetch(fullUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429) {
        log("rate", `429 Rate Limit — ${RETRY_DELAYS[i]}ms 대기 후 재시도`);
        jwtToken = null; // 세션 리셋
        await sleep(RETRY_DELAYS[i]);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        log("auth", `${res.status} — JWT 재발급 후 재시도`);
        jwtToken = null;
        await sleep(RETRY_DELAYS[i]);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (err) {
      if (i === MAX_RETRIES - 1) throw err;
      log("retry", `${i + 1}/${MAX_RETRIES} 실패: ${err.message} — ${RETRY_DELAYS[i]}ms 대기`);
      await sleep(RETRY_DELAYS[i]);
    }
  }
}

// ── API 함수들 (Python 메서드 포트) ────────────────────────

/** 키워드 검색 → 단지 목록 */
async function searchByKeyword(keyword, page = 1) {
  return requestWithRetry(NAVER_SEARCH_API, {
    query: keyword,
    page: String(page),
    type: "complex",
  });
}

/** 단지별 매물 목록 */
async function getComplexArticles(complexId, page = 1) {
  return requestWithRetry(`${NAVER_ARTICLES_API}/${complexId}`, {
    page: String(page),
    complexNo: complexId,
    tradeType: "",       // 전체
    sameAddressGroup: "true",
  }, true, complexId);
}

/** 매물 상세 */
async function getArticleDetail(articleNo) {
  return requestWithRetry(`${NAVER_ARTICLE_DETAIL_API}/${articleNo}`, {}, true);
}

/** 단지 상세 */
async function getComplexDetail(complexId) {
  return requestWithRetry(`${NAVER_COMPLEX_API}/${complexId}`, {}, true, complexId);
}

/** 단지 시세 이력 조회 (Python get_complex_prices 포트) */
async function getComplexPrices(complexId, tradeType = "A1", areaNo = null) {
  const params = {
    complexNo: complexId,
    tradeType,           // A1=매매, B1=전세, B2=월세
    year: "5",
    priceChartChange: "true",
    type: "table",
  };
  if (areaNo != null) {
    params.areaNo = String(areaNo);
    params.areaChange = "true";
  }
  return requestWithRetry(`${NAVER_COMPLEX_API}/${complexId}/prices`, params, true, complexId);
}

// ── 가격 파싱 (Python _parse_price_str 포트) ───────────────

/** "2억 5,000" → 25000, "5천" → 5000, "2억 3천" → 23000 (만원) */
function parseNaverPrice(str) {
  if (!str) return 0;
  const s = str.replace(/[,\s만원]/g, "");
  const parts = s.split("억");
  if (parts.length === 2) {
    const eok = (parseInt(parts[0]) || 0) * 10000;
    const rest = parts[1];
    if (rest.includes("천")) {
      return eok + (parseInt(rest) || 0) * 1000;
    }
    return eok + (parseInt(rest) || 0);
  }
  if (s.includes("천")) {
    return (parseInt(s) || 0) * 1000;
  }
  return parseInt(s) || 0;
}

/** 평당가 계산 */
function calcPricePerPyeong(price, areaM2) {
  if (!price || !areaM2 || areaM2 <= 0) return null;
  return Math.round(price / (areaM2 / M2_TO_PYEONG));
}

// ── 데이터 변환 (Python from_dict 포트) ────────────────────

/** API 응답 → naver_complexes 행 */
function toComplexRow(data, nearbyAptIds = []) {
  return {
    complex_no: String(data.complexNo || data.complexNumber),
    complex_name: data.complexName || data.name || "",
    real_estate_type: data.realEstateTypeCode || null,
    region: null,  // 별도 매핑 필요
    gu: null,
    dong: null,
    lat: data.latitude ? parseFloat(data.latitude) : null,
    lng: data.longitude ? parseFloat(data.longitude) : null,
    total_households: data.totalHouseholdCount ?? data.householdCount ?? null,
    use_approve_ymd: data.useApproveYmd ?? null,
    construction_company: data.constructionCompanyName ?? null,
    floor_area_ratio: data.floorAreaRatio ? parseFloat(data.floorAreaRatio) : null,
    total_parking_count: data.totalParkingCount ?? null,
    high_floor: data.highFloor ?? null,
    low_floor: data.lowFloor ?? null,
    min_supply_area: data.minSupplyArea ? parseFloat(data.minSupplyArea) : null,
    max_supply_area: data.maxSupplyArea ? parseFloat(data.maxSupplyArea) : null,
    nearby_apartment_ids: nearbyAptIds.length > 0 ? nearbyAptIds : null,
    last_crawled_at: new Date().toISOString(),
  };
}

/** API 응답 → naver_articles 행 */
function toArticleRow(data, complexNo) {
  const price = parseNaverPrice(data.dealOrWarrantPrc);
  const rentPrice = parseNaverPrice(data.rentPrc);
  const area2 = data.area2 ? parseFloat(data.area2) : null;
  const area1 = data.area1 ? parseFloat(data.area1) : null;
  const isPresale = (data.realEstateTypeName || "").includes("분양권") ||
                    (data.articleRealEstateTypeName || "").includes("분양권");

  return {
    article_no: String(data.articleNo),
    complex_no: String(complexNo),
    trade_type: data.tradeTypeName || "",
    price: price || null,
    rent_price: rentPrice || null,
    supply_area: area1,
    exclusive_area: area2,
    pp: calcPricePerPyeong(price, area2),
    floor_info: data.floorInfo ?? null,
    building_name: data.buildingName ?? null,
    direction: data.direction ?? null,
    room_count: null,         // 상세 API에서
    bathroom_count: null,     // 상세 API에서
    maintenance_cost: null,   // 상세 API에서
    move_in_date: null,       // 상세 API에서
    heating_type: null,       // 상세 API에서
    use_approve_ymd: null,    // 상세 API에서
    is_presale: isPresale,
    is_verified: data.isVerifiedArticle ?? false,
    is_active: true,
    article_confirm_ymd: data.articleConfirmYmd ?? null,
    last_seen_at: new Date().toISOString(),
    recorded_at: today(),
  };
}

/** API 시세 응답 → naver_price_history 행 배열 */
function toPriceHistoryRows(data, complexNo, tradeType) {
  // 응답 구조 탐색: 다양한 경로에서 월별 시세 배열 추출
  const items = data?.realEstatePrice?.monthlyPrices
    || data?.monthlyPrices
    || data?.priceChartList
    || data?.prices
    || [];
  if (!Array.isArray(items)) return [];

  return items
    .filter(item => item.baseYearMonth || item.baseMonth)
    .map(item => ({
      complex_no: complexNo,
      trade_type: tradeType,
      area_no: item.areaNo != null ? String(item.areaNo) : null,
      deal_price_upper: item.dealUpperPrice ?? item.dealUpperPriceLimit ?? null,
      deal_price_lower: item.dealLowerPrice ?? item.dealLowPriceLimit ?? null,
      deal_price_avg: item.dealAveragePrice ?? null,
      lease_price_upper: item.leaseUpperPrice ?? item.leaseUpperPriceLimit ?? null,
      lease_price_lower: item.leaseLowerPrice ?? item.leaseLowPriceLimit ?? null,
      base_month: String(item.baseYearMonth || item.baseMonth).slice(0, 6),
      recorded_at: today(),
    }));
}

/** 상세 API로 매물 보강 (Python update_from_detail 포트) */
function enrichArticleFromDetail(row, detail) {
  const d = detail.articleDetail || {};
  const addition = detail.articleAddition || {};

  row.room_count = d.roomCount ?? null;
  row.bathroom_count = d.bathroomCount ?? null;
  row.heating_type = d.heatingTypeName ?? null;
  row.use_approve_ymd = d.useApproveYmd ?? null;
  row.move_in_date = d.moveInPossibleYmd ?? null;

  // 관리비: costsByDate[0].commonPrice (원 → 만원)
  if (d.maintenanceCost?.costsByDate?.length > 0) {
    const commonPrice = d.maintenanceCost.costsByDate[0].commonPrice;
    if (commonPrice) {
      row.maintenance_cost = Math.round(parseInt(commonPrice) / 10000);
    }
  }

  return row;
}

// ── 메인 수집 로직 ─────────────────────────────────────────

async function main() {
  const phase = "naver";

  if (dryRun) {
    log(phase, "🔍 --dry-run 모드");
  }

  // 1. Supabase에서 미분양 아파트 좌표 조회
  const sb = getSupabase();
  const { data: apartments, error: aptErr } = await sb
    .from("apartments")
    .select("id, name, region, gu, dong, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null);

  if (aptErr) {
    logError(phase, `아파트 조회 실패: ${aptErr.message}`);
    process.exit(1);
  }

  const targets = aptLimit > 0 ? apartments.slice(0, aptLimit) : apartments;
  log(phase, `📊 미분양 아파트 ${targets.length}건 대상 (전체: ${apartments.length}건)`);

  if (dryRun && targets.length > 0) {
    log(phase, `  샘플: ${targets[0].name} (${targets[0].lat}, ${targets[0].lng})`);
  }

  // 2. 지역별 그룹핑 (동일 지역 중복 검색 방지)
  const regionGroups = new Map();
  for (const apt of targets) {
    const key = `${apt.region} ${apt.gu || ""}`.trim();
    if (!regionGroups.has(key)) {
      regionGroups.set(key, []);
    }
    regionGroups.get(key).push(apt);
  }

  log(phase, `📍 ${regionGroups.size}개 지역 그룹`);

  const allComplexRows = [];
  const processedComplexes = new Set();

  // 3. 지역별 단지 검색
  for (const [regionKey, apts] of regionGroups) {
    log(phase, `🔎 검색: "${regionKey}" (${apts.length}건)`);
    const nearbyAptIds = apts.map(a => a.id);

    try {
      // 키워드 검색으로 단지 찾기
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await searchByKeyword(regionKey, page);
        if (!result?.complexes?.length) break;

        for (const complex of result.complexes) {
          const cno = String(complex.complexNo || complex.complexNumber);
          if (processedComplexes.has(cno)) continue;
          processedComplexes.add(cno);

          // APT, ABYG, JGC, PRE만 수집
          const type = complex.realEstateTypeCode;
          if (type && !["APT", "ABYG", "JGC", "PRE"].includes(type)) continue;

          allComplexRows.push(toComplexRow(complex, nearbyAptIds));
        }

        hasMore = result.isMoreData === true;
        page++;
        if (hasMore) await sleep(PAGE_DELAY);
      }
    } catch (err) {
      logError(phase, `검색 실패 "${regionKey}": ${err.message}`);
    }
  }

  log(phase, `🏢 단지 ${allComplexRows.length}건 발견`);

  if (dryRun) {
    log(phase, `\n── 샘플 단지 ──`);
    if (allComplexRows.length > 0) {
      console.log(JSON.stringify(allComplexRows[0], null, 2));
    }
    // 시세 API 샘플 테스트
    if (allComplexRows.length > 0) {
      log(phase, "\n── 샘플 시세 (매매) ──");
      try {
        const sample = await getComplexPrices(allComplexRows[0].complex_no, "A1");
        console.log(JSON.stringify(sample, null, 2).slice(0, 2000));
        const rows = toPriceHistoryRows(sample, allComplexRows[0].complex_no, "A1");
        log(phase, `  파싱 결과: ${rows.length}건`);
        if (rows.length > 0) console.log(JSON.stringify(rows[0], null, 2));
      } catch (e) {
        log(phase, `시세 샘플 실패: ${e.message}`);
      }
    }

    log(phase, "\n🔍 dry-run: DB 쓰기 생략");
    process.exit(0);
  }

  // 4. 단지 upsert
  await upsertBatch("naver_complexes", allComplexRows, "complex_no");

  // 5. 단지별 매물 수집 (스트리밍 upsert — 메모리 효율)
  let totalArticles = 0;
  let complexCount = 0;

  for (const complexRow of allComplexRows) {
    complexCount++;
    if (complexCount % 50 === 0) {
      log(phase, `  진행: ${complexCount}/${allComplexRows.length} 단지, ${totalArticles} 매물`);
    }

    try {
      const seenArticles = new Set();
      const complexArticles = [];  // 단지별 배열 (매 단지 후 초기화)
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await getComplexArticles(complexRow.complex_no, page);
        const articles = result?.articleList || [];
        if (!articles.length) break;

        for (const art of articles) {
          const row = toArticleRow(art, complexRow.complex_no);
          seenArticles.add(row.article_no);

          // --enrich: 상세 API로 rooms/관리비 등 보강 (rate limit 고려, 기본 OFF)
          if (enrichDetail) {
            try {
              const detail = await getArticleDetail(row.article_no);
              if (detail) enrichArticleFromDetail(row, detail);
            } catch (e) {
              // 상세 실패해도 기본 데이터는 유지
            }
          }

          complexArticles.push(row);
          totalArticles++;
        }

        hasMore = result.isMoreData === true;
        page++;
        if (hasMore) await sleep(PAGE_DELAY);
      }

      // 단지별 즉시 upsert (메모리 해제)
      if (complexArticles.length > 0) {
        await upsertBatch("naver_articles", complexArticles, "article_no");
      }

      // 소프트 삭제: 이전에 있었지만 이번에 안 보이는 매물
      if (seenArticles.size > 0) {
        const { error: deactivateErr } = await sb
          .from("naver_articles")
          .update({ is_active: false, last_seen_at: new Date().toISOString() })
          .eq("complex_no", complexRow.complex_no)
          .eq("is_active", true)
          .not("article_no", "in", `(${[...seenArticles].join(",")})`);

        if (deactivateErr) {
          logError(phase, `소프트 삭제 실패 ${complexRow.complex_no}: ${deactivateErr.message}`);
        }
      }
    } catch (err) {
      logError(phase, `매물 수집 실패 ${complexRow.complex_no}: ${err.message}`);
    }
  }

  log(phase, `📋 매물 ${totalArticles}건 수집 완료`);

  // 6. 단지별 시세 이력 수집
  log(phase, `\n📈 시세 이력 수집 시작...`);
  let totalPriceRows = 0;
  let priceComplexCount = 0;

  for (const complexRow of allComplexRows) {
    priceComplexCount++;
    if (priceComplexCount % 50 === 0) {
      log(phase, `  시세 진행: ${priceComplexCount}/${allComplexRows.length}, ${totalPriceRows}건`);
    }

    try {
      const rows = [];
      for (const tradeType of ["A1", "B1"]) {  // 매매 + 전세
        const result = await getComplexPrices(complexRow.complex_no, tradeType);
        const parsed = toPriceHistoryRows(result, complexRow.complex_no, tradeType);
        rows.push(...parsed);
      }
      if (rows.length > 0) {
        await upsertBatch("naver_price_history", rows, "complex_no,trade_type,area_no,base_month");
        totalPriceRows += rows.length;
      }
    } catch (err) {
      logError(phase, `시세 수집 실패 ${complexRow.complex_no}: ${err.message}`);
    }
  }

  log(phase, `📈 시세 이력 ${totalPriceRows}건 수집`);

  // 7. 통계 요약
  const { count: complexTotal } = await sb
    .from("naver_complexes")
    .select("*", { count: "exact", head: true });
  const { count: articleTotal } = await sb
    .from("naver_articles")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);
  const { count: priceHistoryTotal } = await sb
    .from("naver_price_history")
    .select("*", { count: "exact", head: true });

  log(phase, `\n✅ 수집 완료`);
  log(phase, `  단지: ${allComplexRows.length}건 신규/갱신 (전체: ${complexTotal})`);
  log(phase, `  매물: ${totalArticles}건 신규/갱신 (활성: ${articleTotal})`);
  log(phase, `  시세이력: ${totalPriceRows}건 신규/갱신 (전체: ${priceHistoryTotal})`);
}

main().catch(err => {
  logError("naver", `치명적 오류: ${err.message}`);
  console.error(err);
  process.exit(1);
});
