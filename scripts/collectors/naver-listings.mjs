// @ts-check
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
 *   2. 각 좌표 주변 네이버 단지 검색 → complexes에 upsert
 *   3. 단지별 매물 수집 → articles에 upsert + 소프트 삭제
 *   (시세 이력은 naver-estate-web에서 관리)
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
/**
 * @typedef {Record<string, unknown>} NaverApiData
 * @typedef {{
 *   article_no: string; complex_no: string; trade_type_name: string;
 *   numeric_price: number | null; numeric_rent_price: number | null;
 *   area1_m2: number | null; area2_m2: number | null;
 *   price_per_pyeong: number | null;
 *   floor_info: string | null; building_name: string | null; direction: string | null;
 *   room_count: number | null; bathroom_count: number | null;
 *   numeric_maintenance_cost: number | null;
 *   move_in_date: string | null; heating_type: string | null;
 *   use_approve_ymd: string | null;
 *   is_presale: boolean; is_verified: boolean; is_active: boolean;
 *   article_confirm_ymd: string | null; last_seen_at: string;
 * }} ArticleRow
 */
import { loadEnv, getMibuyangSupabase, upsertBatch, log, logError, selectAll, setupGracefulShutdown, sleep } from "./_shared.mjs";

loadEnv();

// ── 환경변수 검증 ───────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  logError("init", "SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요");
  process.exit(1);
}

// ── 상수 (Python constants.py 포트) ────────────────────────
const NAVER_BASE = "https://new.land.naver.com";
const NAVER_SEARCH_API = `${NAVER_BASE}/api/search`;
const NAVER_ARTICLES_API = `${NAVER_BASE}/api/articles/complex`;
const NAVER_ARTICLE_DETAIL_API = `${NAVER_BASE}/api/articles`;

const JWT_TOKEN_PATTERN = /"token":"(eyJ[A-Za-z0-9._-]+)"/;
const JWT_LIFETIME = 3000 * 1000; // 50분 (ms)
// 세션118 긴급 완화: 네이버 IP 쿨다운 대응 (cooldown_fix.md ①)
// 요청 간격·페이지 간격 각 5배, 재시도 대기 [3,5,10,15,20]→[10,20,40,60,120]초
const MIN_INTERVAL = 5000;        // 요청 간 최소 5초 (이전 1초)
const PAGE_DELAY = 3000;          // 페이지 간 3초 (이전 1.5초)
const MAX_RETRIES = 5;
const RETRY_DELAYS = [10000, 20000, 40000, 60000, 120000];
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
/** @type {string | null} */
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

/** 캐시 조회 @param {string} key */
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/** @param {string} key @param {unknown} data */
function setCached(key, data) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { time: Date.now(), data });
}

/** JWT 토큰 추출 (Python _ensure_jwt 포트) @param {string} [complexId] */
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

/**
 * HTTP 요청 + 재시도 (Python _request_with_retry 포트)
 * @param {string} url
 * @param {Record<string, string>} [params]
 * @param {boolean} [needAuth]
 * @param {string | null} [refererComplexId]
 */
async function requestWithRetry(url, params = {}, needAuth = false, refererComplexId = null) {
  const qs = new URLSearchParams(params).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;
  const cacheKey = fullUrl;

  const cached = getCached(cacheKey);
  if (cached) return cached;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await throttle();

      /** @type {Record<string, string>} */
      const headers = { ...HEADERS };
      if (needAuth) {
        const token = await ensureJwt(refererComplexId ?? undefined);
        headers["Authorization"] = `Bearer ${token}`;
        if (refererComplexId) {
          headers["Referer"] = `${NAVER_BASE}/complexes/${refererComplexId}`;
        }
      }

      const res = await fetch(fullUrl, {
        headers,
        signal: AbortSignal.timeout(60000),
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
      log("retry", `${i + 1}/${MAX_RETRIES} 실패: ${err instanceof Error ? err.message : String(err)} — ${RETRY_DELAYS[i]}ms 대기`);
      await sleep(RETRY_DELAYS[i]);
    }
  }
}

// ── API 함수들 (Python 메서드 포트) ────────────────────────

/** 키워드 검색 → 단지 목록 @param {string} keyword @param {number} [page] */
async function searchByKeyword(keyword, page = 1) {
  return requestWithRetry(NAVER_SEARCH_API, {
    query: keyword,
    page: String(page),
    type: "complex",
  });
}

/** 단지별 매물 목록 @param {string} complexId @param {number} [page] */
async function getComplexArticles(complexId, page = 1) {
  return requestWithRetry(`${NAVER_ARTICLES_API}/${complexId}`, {
    page: String(page),
    complexNo: complexId,
    tradeType: "",       // 전체
    sameAddressGroup: "true",
  }, true, complexId);
}

/** 매물 상세 @param {string} articleNo */
async function getArticleDetail(articleNo) {
  return requestWithRetry(`${NAVER_ARTICLE_DETAIL_API}/${articleNo}`, {}, true);
}

// ── 가격 파싱 (Python _parse_price_str 포트) ───────────────

/** "2억 5,000" → 25000, "5천" → 5000, "2억 3천" → 23000 (만원) @param {string | null | undefined} str */
export function parseNaverPrice(str) {
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

/** 평당가 계산 @param {number | null} price @param {number | null} areaM2 */
export function calcPricePerPyeong(price, areaM2) {
  if (!price || !areaM2 || areaM2 <= 0) return null;
  return Math.round(price / (areaM2 / M2_TO_PYEONG));
}

// ── 데이터 변환 (Python from_dict 포트) ────────────────────

/** 단지 데이터에서 수영장 유무 감지 @param {NaverApiData} data @returns {boolean | null} */
export function detectPool(data) {
  // 구조화된 시설 정보 확인
  const facilityStr = JSON.stringify(
    data.facilityInfo ?? data.complexFacility ?? data.communityFacilityInfo ?? ""
  ).toLowerCase();
  if (facilityStr.includes("수영") || facilityStr.includes("pool")) return true;

  // 사진 카테고리에서 확인
  const photos = /** @type {Array<Record<string, unknown>>} */ (data.photos ?? data.complexPhotoList ?? []);
  for (const p of photos) {
    const cat = String(p.smallCategoryName ?? p.categoryName ?? "").toLowerCase();
    if (cat.includes("수영") || cat.includes("pool")) return true;
  }

  // 태그/설명에서 확인
  const desc = JSON.stringify(
    data.tagList ?? data.detailDescription ?? data.complexFeatureDescription ?? ""
  ).toLowerCase();
  if (desc.includes("수영장") || desc.includes("swimming pool")) return true;

  return null; // 확인 불가 → null (not false)
}

/** API 응답 → complexes 행 @param {NaverApiData} input */
export function toComplexRow(input) {
  const data = /** @type {Record<string, any>} */ (input);
  return {
    complex_no: String(data.complexNo || data.complexNumber),
    complex_name: data.complexName || data.name || "",
    real_estate_type_code: data.realEstateTypeCode || null,
    latitude: data.latitude ? parseFloat(data.latitude) : null,
    longitude: data.longitude ? parseFloat(data.longitude) : null,
    total_household_count: data.totalHouseholdCount ?? data.householdCount ?? null,
    use_approve_ymd: data.useApproveYmd ?? null,
    construction_company: data.constructionCompanyName ?? null,
    floor_area_ratio: data.floorAreaRatio ? parseFloat(data.floorAreaRatio) : null,
    total_parking_count: data.totalParkingCount ?? null,
    high_floor: data.highFloor ?? null,
    low_floor: data.lowFloor ?? null,
    min_supply_area_m2: data.minSupplyArea ? parseFloat(data.minSupplyArea) : null,
    max_supply_area_m2: data.maxSupplyArea ? parseFloat(data.maxSupplyArea) : null,
    has_pool: detectPool(input),
    last_crawled_at: new Date().toISOString(),
  };
}

/** API 응답 → articles 행 @param {NaverApiData} input @param {string} complexNo */
export function toArticleRow(input, complexNo) {
  const data = /** @type {Record<string, any>} */ (input);
  const price = parseNaverPrice(data.dealOrWarrantPrc);
  const rentPrice = parseNaverPrice(data.rentPrc);
  const area2 = data.area2 ? parseFloat(data.area2) : null;
  const area1 = data.area1 ? parseFloat(data.area1) : null;
  const isPresale = String(data.realEstateTypeName || "").includes("분양권") ||
                    String(data.articleRealEstateTypeName || "").includes("분양권");

  return {
    article_no: String(data.articleNo),
    complex_no: String(complexNo),
    trade_type_name: String(data.tradeTypeName || ""),
    numeric_price: price || null,
    numeric_rent_price: rentPrice || null,
    area1_m2: area1,
    area2_m2: area2,
    price_per_pyeong: calcPricePerPyeong(price, area2),
    floor_info: data.floorInfo ?? null,
    building_name: data.buildingName ?? null,
    direction: data.direction ?? null,
    room_count: null,         // 상세 API에서
    bathroom_count: null,     // 상세 API에서
    numeric_maintenance_cost: null,   // 상세 API에서
    move_in_date: null,       // 상세 API에서
    heating_type: null,       // 상세 API에서
    use_approve_ymd: null,    // 상세 API에서
    is_presale: isPresale,
    is_verified: data.isVerifiedArticle ?? false,
    is_active: true,
    article_confirm_ymd: data.articleConfirmYmd ?? null,
    last_seen_at: new Date().toISOString(),
  };
}


/** 상세 API로 매물 보강 (Python update_from_detail 포트) @param {ArticleRow} row @param {NaverApiData} detail */
export function enrichArticleFromDetail(row, detail) {
  const d = /** @type {Record<string, any>} */ (detail.articleDetail || {});

  row.room_count = d.roomCount ?? null;
  row.bathroom_count = d.bathroomCount ?? null;
  row.heating_type = d.heatingTypeName ?? null;
  row.use_approve_ymd = d.useApproveYmd ?? null;
  row.move_in_date = d.moveInPossibleYmd ?? null;

  // 관리비: costsByDate[0].commonPrice (원 → 만원)
  if (d.maintenanceCost?.costsByDate?.length > 0) {
    const commonPrice = d.maintenanceCost.costsByDate[0].commonPrice;
    if (commonPrice) {
      row.numeric_maintenance_cost = Math.round(parseInt(commonPrice) / 10000);
    }
  }

  return row;
}

// ── 메인 수집 로직 ─────────────────────────────────────────

async function main() {
  const phase = "naver";
  const isInterrupted = setupGracefulShutdown(phase);  // 세션 344: graceful shutdown

  if (dryRun) {
    log(phase, "🔍 --dry-run 모드");
  }

  // 1. Supabase에서 미분양 아파트 좌표 조회
  const sbMibunyang = getMibuyangSupabase();
  // selectAll: 1000행 제한 자동 페이지네이션
  const apartments = await selectAll(
    (s) => s.from("apartments")
      .select("id, name, region, gu, dong, lat, lng")
      .not("lat", "is", null)
      .not("lng", "is", null),
    sbMibunyang
  );

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
    if (isInterrupted()) break;  // 세션 344: graceful shutdown (region 검색 loop)
    log(phase, `🔎 검색: "${regionKey}" (${apts.length}건)`);

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

          allComplexRows.push(toComplexRow(complex));
        }

        hasMore = result.isMoreData === true;
        page++;
        if (hasMore) await sleep(PAGE_DELAY);
      }
    } catch (err) {
      logError(phase, `검색 실패 "${regionKey}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(phase, `🏢 단지 ${allComplexRows.length}건 발견`);

  if (dryRun) {
    log(phase, `\n── 샘플 단지 ──`);
    if (allComplexRows.length > 0) {
      console.log(JSON.stringify(allComplexRows[0], null, 2));
    }

    log(phase, "\n🔍 dry-run: DB 쓰기 생략");
    process.exit(0);
  }

  // 4. 단지 upsert
  await upsertBatch("complexes", allComplexRows, "complex_no", 500, getMibuyangSupabase());

  // 5. 단지별 매물 수집 (스트리밍 upsert — 메모리 효율)
  let totalArticles = 0;
  let complexCount = 0;

  for (const complexRow of allComplexRows) {
    if (isInterrupted()) break;  // 세션 344: graceful shutdown (complex 매물 loop)
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
        await upsertBatch("articles", complexArticles, "article_no", 500, getMibuyangSupabase());
      }

      // 소프트 삭제: 이전에 있었지만 이번에 안 보이는 매물
      if (seenArticles.size > 0) {
        const seenList = [...seenArticles];
        const BATCH_SIZE = 500;
        let deactivateFails = 0;
        for (let i = 0; i < seenList.length; i += BATCH_SIZE) {
          const batch = seenList.slice(i, i + BATCH_SIZE);
          const { error: deactivateErr } = await sbMibunyang
            .from("articles")
            .update({ is_active: false, last_seen_at: new Date().toISOString() })
            .eq("complex_no", complexRow.complex_no)
            .eq("is_active", true)
            .not("article_no", "in", `(${batch.join(",")})`);

          if (deactivateErr) {
            // 1회 재시도
            await sleep(1000);
            const { error: retryErr } = await sbMibunyang
              .from("articles")
              .update({ is_active: false, last_seen_at: new Date().toISOString() })
              .eq("complex_no", complexRow.complex_no)
              .eq("is_active", true)
              .not("article_no", "in", `(${batch.join(",")})`);
            if (retryErr) {
              deactivateFails++;
              logError(phase, `소프트 삭제 실패 (재시도 포함) ${complexRow.complex_no}: ${retryErr.message}`);
            }
          }
        }
        if (deactivateFails > 0) {
          logError(phase, `⚠️ ${complexRow.complex_no}: 소프트 삭제 ${deactivateFails}건 최종 실패`);
        }
      }
    } catch (err) {
      logError(phase, `매물 수집 실패 ${complexRow.complex_no}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(phase, `📋 매물 ${totalArticles}건 수집 완료`);

  // 7. 통계 요약
  const { count: complexTotal } = await sbMibunyang
    .from("complexes")
    .select("*", { count: "exact", head: true });
  const { count: articleTotal } = await sbMibunyang
    .from("articles")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);
  log(phase, `\n✅ 수집 완료`);
  log(phase, `  단지: ${allComplexRows.length}건 신규/갱신 (전체: ${complexTotal})`);
  log(phase, `  매물: ${totalArticles}건 신규/갱신 (활성: ${articleTotal})`);

}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { logError("naver", `치명적 오류: ${err instanceof Error ? err.message : String(err)}`); console.error(err); process.exit(1); });
