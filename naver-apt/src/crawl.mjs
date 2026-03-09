#!/usr/bin/env node
/**
 * 네이버 부동산 주변아파트 크롤러
 *
 * 미분양 아파트(apartments.json)의 각 단지 주변 아파트를 네이버에서 수집하여
 * output/nearby-trends.json에 저장한다.
 *
 * 사용법:
 *   node src/crawl.mjs                   전체 수집
 *   node src/crawl.mjs --dry-run         수집 없이 대상 목록만 출력
 *   node src/crawl.mjs --limit=5         처음 5개 단지만 수집
 *   node src/crawl.mjs --region=경기     특정 지역만 수집
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import {
  searchComplexes,
  getComplexDetail,
  getComplexArticles,
  getComplexPrices,
  getComplexSchools,
  parseNaverPrice,
  calcPP,
} from "./naver-api.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const MIBUNYANG_ROOT = resolve(PROJECT_ROOT, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, "output");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "nearby-trends.json");
const HISTORY_FILE = resolve(OUTPUT_DIR, "article-history.json");

// ── 환경변수 로드 (.env 파일 선택사항) ──────────────────────
loadEnv({ path: resolve(PROJECT_ROOT, ".env") });

// ── 설정 상수 (환경변수 우선, 기본값 fallback) ──────────────
const CONFIG = {
  NEARBY_RADIUS_KM: Number(process.env.NEARBY_RADIUS_KM) || 3,
  MAX_NEARBY_COMPLEXES: Number(process.env.MAX_NEARBY_COMPLEXES) || 20,
  SEARCH_MAX_PAGES: Number(process.env.SEARCH_MAX_PAGES) || 5,
  ARTICLES_MAX_PAGES: Number(process.env.ARTICLES_MAX_PAGES) || 3,
  PRICE_HISTORY_YEARS: Number(process.env.PRICE_HISTORY_YEARS) || 5,
  MAX_ARTICLES_PER_TYPE: Number(process.env.MAX_ARTICLES_PER_TYPE) || 50,
  MAX_ERRORS_SAVED: 50,
  SKIP_IF_WITHIN_MS: (Number(process.env.SKIP_IF_WITHIN_HOURS) || 24) * 3_600_000,
  CHECKPOINT_INTERVAL: Number(process.env.CHECKPOINT_INTERVAL) || 5,
  AREA_BUCKET_SIZE: 5,
  FLOOR_TIERS: { low: 5, mid: 15 },
};

// ── 거래유형 분류 맵 ──────────────────────────────────────
const TRADE_CLASSIFIERS = [
  { keyword: "매매", key: "sell" },
  { keyword: "전세", key: "jeonse" },
  { keyword: "월세", key: "wolse" },
];

// ── CLI 인자 ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const regionArg = args.find(a => a.startsWith("--region="));
const limitParsed = limitArg ? parseInt(limitArg.split("=")[1]) : NaN;
if (limitArg && (!Number.isFinite(limitParsed) || limitParsed <= 0)) {
  console.error("❌ --limit 값은 1 이상의 정수여야 합니다");
  process.exit(1);
}
const limit = limitArg ? limitParsed : Infinity;
const regionFilter = regionArg ? regionArg.split("=")[1] : null;

// ── CONFIG 유효성 검증 ────────────────────────────────────────
function validateConfig() {
  if (CONFIG.NEARBY_RADIUS_KM <= 0) throw new Error("CONFIG: NEARBY_RADIUS_KM은 0보다 커야 합니다");
  if (CONFIG.AREA_BUCKET_SIZE <= 0) throw new Error("CONFIG: AREA_BUCKET_SIZE는 0보다 커야 합니다");
  if (CONFIG.FLOOR_TIERS.low >= CONFIG.FLOOR_TIERS.mid) throw new Error("CONFIG: FLOOR_TIERS.low < mid 여야 합니다");
  if (CONFIG.MAX_NEARBY_COMPLEXES <= 0) throw new Error("CONFIG: MAX_NEARBY_COMPLEXES는 0보다 커야 합니다");
  if (CONFIG.CHECKPOINT_INTERVAL <= 0) throw new Error("CONFIG: CHECKPOINT_INTERVAL은 0보다 커야 합니다");
}

// ── 공통 유틸 ─────────────────────────────────────────────────
function calcMedian(sortedArr) {
  if (sortedArr.length === 0) return 0;
  const mid = Math.floor(sortedArr.length / 2);
  return sortedArr.length % 2 === 1
    ? sortedArr[mid]
    : Math.round((sortedArr[mid - 1] + sortedArr[mid]) / 2);
}

// ── 미분양 아파트 목록 로드 ──────────────────────────────────
function loadApartments() {
  const jsonPath = resolve(MIBUNYANG_ROOT, "public/data/apartments.json");
  if (!existsSync(jsonPath)) {
    console.error("❌ apartments.json 없음:", jsonPath);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  let apts = raw.data || raw;
  if (regionFilter) {
    apts = apts.filter(a => a.region === regionFilter);
  }
  return apts.slice(0, limit);
}

// ── 주변 단지 검색 ───────────────────────────────────────────
function buildSearchKeyword(apt) {
  const parts = [];
  if (apt.region) parts.push(apt.region);
  if (apt.gu) parts.push(apt.gu);
  if (apt.dong) parts.push(apt.dong);
  if (parts.length === 0 && apt.address) {
    return apt.address.split(" ").slice(0, 3).join(" ").normalize("NFC");
  }
  return parts.join(" ").normalize("NFC");
}

// ── 거리 계산 (Haversine) ────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 거래유형 분류 ────────────────────────────────────────────
function classifyTradeType(tradeTypeName) {
  for (const { keyword, key } of TRADE_CLASSIFIERS) {
    if (tradeTypeName.includes(keyword)) return key;
  }
  if (tradeTypeName) {
    console.warn(`    ⚠ 미분류 거래유형 "${tradeTypeName}" → 매매 fallback`);  // Fix 4
    return "sell";
  }
  return null;
}

// ── 매물 → 정리된 객체 변환 ─────────────────────────────────
function parseArticle(art, complexNo) {
  const price = parseNaverPrice(art.dealOrWarrantPrc || art.price);
  const rentPrice = parseNaverPrice(art.rentPrc || "0");
  const supplyArea = parseFloat(art.area1) || 0;
  const exclusiveArea = parseFloat(art.area2) || 0;
  const tradeType = art.tradeTypeName || art.tradTpNm || "";
  if (!tradeType) console.warn(`    ⚠ 거래유형 불명: ${art.articleNo}`);
  return {
    articleNo: art.articleNo || art.atclNo,
    complexNo,
    tradeType,
    price,
    rentPrice,
    supplyArea,
    exclusiveArea,
    pp: exclusiveArea > 0 ? calcPP(price, exclusiveArea) : null,  // Fix 2
    floorInfo: art.floorInfo || art.flrInfo || "",
    direction: art.direction || "",
    confirmDate: art.articleConfirmYmd || art.atclCfmYmd || "",
    isVerified: art.verificationTypeCode === "VR" || art.vrfcTpCd === "VRFC",
    // Phase 1 확장 필드
    buildingName: art.buildingName || art.bildNm || "",
    maintenanceCost: parseInt(art.maintenanceCost || art.mntnCost) || null,
    parkingCount: art.parkingCount || art.parkingCnt || null,
    moveInDate: art.moveInPossibleYmd || art.mvInDate || "",
    tags: art.tagList || [],
    featureDesc: art.articleFeatureDesc || art.atclFetrDesc || "",
  };
}

// ── 학군 데이터 파싱 ─────────────────────────────────────────
function parseSchools(schoolsData) {
  if (!schoolsData) return [];
  const list = schoolsData.schoolList || schoolsData.schools || [];
  return list.map(s => ({
    name: s.schoolName || s.name || "",
    type: inferSchoolType(s.schoolName || s.name || ""),
    walkTimeMin: parseInt(s.walkTime) || null,
    distanceM: parseInt(s.distance) || (s.walkTime ? Math.round(s.walkTime * 67) : null),
    studentCount: s.totalStudentCount || null,
    studentPerClass: s.studentCountPerClassroom || null,
    organizationType: s.organizationType || "",
  })).filter(s => s.name);
}

function inferSchoolType(name) {
  if (name.includes("초등")) return "초등";
  if (name.includes("중학") || name.endsWith("중")) return "중등";
  if (name.includes("고등") || name.endsWith("고")) return "고등";
  return "";
}

// ── 시세 데이터 가공 ─────────────────────────────────────────
function processPrices(priceData) {
  if (!priceData) return null;
  const trades = priceData.realPriceList || priceData.realPriceDataList || [];
  if (trades.length === 0) return null;

  // 최근 6개월 거래
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthStr = sixMonthsAgo.toISOString().slice(0, 7).replace("-", "");

  const recentTrades = trades.filter(t => {
    const ym = (t.tradeYearMonth || t.dealDate || "").replace(/[^0-9]/g, "").slice(0, 6);
    return ym >= sixMonthStr;
  });

  const prices = recentTrades
    .map(t => parseNaverPrice(t.dealAmt || t.formattedPrice || "0"))
    .filter(p => p > 0);

  if (prices.length === 0) return null;

  prices.sort((a, b) => a - b);

  return {
    count: prices.length,
    median: calcMedian(prices),
    avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    min: prices[0],
    max: prices[prices.length - 1],
    recentTrades6m: recentTrades.length,
  };
}

// ── 주변 단지 반경 필터링 ────────────────────────────────────
function filterByRadius(nearbyComplexes, apt, errors) {
  if (!apt.lat || !apt.lng) {
    console.warn(`    ⚠ 좌표 없음 (${apt.name}) — 검색 상위 ${CONFIG.MAX_NEARBY_COMPLEXES}개 사용`);
    errors.push({ type: "no_coords", target: apt.id, error: "좌표 없음 — 반경 필터 미적용", at: new Date().toISOString() });
    return nearbyComplexes.slice(0, CONFIG.MAX_NEARBY_COMPLEXES);
  }

  return nearbyComplexes
    .filter(c => {
      if (!c.latitude || !c.longitude) return false;
      const lat2 = parseFloat(c.latitude);
      const lng2 = parseFloat(c.longitude);
      if (!isFinite(lat2) || !isFinite(lng2)) return false;
      const dist = haversineKm(apt.lat, apt.lng, lat2, lng2);
      return isFinite(dist) && dist <= CONFIG.NEARBY_RADIUS_KM;
    })
    .sort((a, b) => {
      const dA = haversineKm(apt.lat, apt.lng, parseFloat(a.latitude), parseFloat(a.longitude));
      const dB = haversineKm(apt.lat, apt.lng, parseFloat(b.latitude), parseFloat(b.longitude));
      return dA - dB;
    })
    .slice(0, CONFIG.MAX_NEARBY_COMPLEXES);
}

// ── 단지별 데이터 수집 ───────────────────────────────────────
async function fetchComplexData(complex, apt) {
  const cNo = complex.complexNo;
  const distKm = apt.lat && apt.lng
    ? haversineKm(apt.lat, apt.lng, parseFloat(complex.latitude), parseFloat(complex.longitude)).toFixed(2)
    : null;

  // 순차 API 호출 — rate limit 방지 (각 호출 실패해도 계속 진행)
  let detail = null, rawArticles = [], priceData = null, schoolsData = null;
  try { detail = await getComplexDetail(cNo); }
  catch (err) { console.warn(`    ⚠ ${cNo} 상세 실패: ${err.message}`); }
  try { rawArticles = await getComplexArticles(cNo, "", CONFIG.ARTICLES_MAX_PAGES); }
  catch (err) { console.warn(`    ⚠ ${cNo} 매물 실패: ${err.message}`); }
  try { priceData = await getComplexPrices(cNo, "A1", CONFIG.PRICE_HISTORY_YEARS); }
  catch (err) { console.warn(`    ⚠ ${cNo} 시세 실패: ${err.message}`); }
  try { schoolsData = await getComplexSchools(cNo); }
  catch (err) { console.warn(`    ⚠ ${cNo} 학군 실패: ${err.message}`); }

  const cd = detail?.complexDetail;
  const info = {
    complexNo: cNo,
    name: complex.complexName || cd?.complexName || "",
    households: cd?.totalHouseholdCount || complex.totalHouseholdCount || 0,
    approveDate: cd?.useApproveYmd || "",
    builder: cd?.constructionCompanyName || "",
    distKm: distKm ? parseFloat(distKm) : null,
    lat: parseFloat(complex.latitude) || null,
    lng: parseFloat(complex.longitude) || null,
    // Phase 1 확장 필드
    highFloor: cd?.highFloor || null,
    lowFloor: cd?.lowFloor || null,
    totalDongCount: cd?.totalDongCount || null,
    heatMethodType: cd?.heatMethodTypeName || cd?.heatMethodTypeCode || null,
    totalParkingCount: cd?.totalParkingCount || null,
    // Phase 2 학군 데이터
    schools: parseSchools(schoolsData),
  };

  // 페이지 한도에 근접하면 데이터 절단 경고 (페이지당 ~20건)
  const pageCapacity = CONFIG.ARTICLES_MAX_PAGES * 20;
  if (rawArticles.length >= pageCapacity) {
    console.warn(`    ⚠ ${cNo} 매물 ${rawArticles.length}건 — 페이지 한도 도달, 일부 누락 가능`);
  }
  const classified = { sell: [], jeonse: [], wolse: [] };
  for (const art of rawArticles) {
    const parsed = parseArticle(art, cNo);
    const key = classifyTradeType(parsed.tradeType);
    if (key) classified[key].push(parsed);
  }

  return { info, classified, priceData };
}

// ── 단지 처리 (1개 아파트 단위) ──────────────────────────────
async function processApartment(apt, nearbyComplexes, errors) {
  const filtered = filterByRadius(nearbyComplexes, apt, errors);

  console.log(`    📍 반경 ${CONFIG.NEARBY_RADIUS_KM}km 내: ${filtered.length}개 단지`);

  if (filtered.length === 0) {
    return {
      aptId: apt.id,
      aptName: apt.name,
      region: apt.region,
      gu: apt.gu,
      fetchedAt: new Date().toISOString(),
      nearbyCount: 0,
      complexes: [],
      articles: { sell: [], jeonse: [], wolse: [] },
      priceStats: null,
    };
  }

  // 각 주변 단지의 매물 + 시세 수집
  const complexInfos = [];
  const allArticles = { sell: [], jeonse: [], wolse: [] };
  const allPrices = [];

  for (const complex of filtered) {
    try {
      const { info, classified, priceData } = await fetchComplexData(complex, apt);
      complexInfos.push(info);
      allArticles.sell.push(...classified.sell);
      allArticles.jeonse.push(...classified.jeonse);
      allArticles.wolse.push(...classified.wolse);
      if (priceData) allPrices.push({ complexNo: complex.complexNo, data: priceData });
    } catch (err) {
      console.warn(`    ⚠ [${err.name}] ${complex.complexNo} 수집 중 오류: ${err.message}`);
      errors.push({ type: "complex", target: `${apt.id}/${complex.complexNo}`, error: err.message, errorType: err.name, code: err.code || null, at: new Date().toISOString() });
    }
  }

  // 통계 계산
  const priceStats = calculateStats(allArticles, allPrices, complexInfos);

  return {
    aptId: apt.id,
    aptName: apt.name,
    region: apt.region,
    gu: apt.gu,
    fetchedAt: new Date().toISOString(),
    nearbyCount: complexInfos.length,
    complexes: complexInfos,
    articles: {
      sell: allArticles.sell.slice(0, CONFIG.MAX_ARTICLES_PER_TYPE),
      jeonse: allArticles.jeonse.slice(0, CONFIG.MAX_ARTICLES_PER_TYPE),
      wolse: allArticles.wolse.slice(0, CONFIG.MAX_ARTICLES_PER_TYPE),
    },
    priceStats,
  };
}

// ── 메인 크롤링 ─────────────────────────────────────────────
async function crawl() {
  validateConfig();
  const apartments = loadApartments();
  console.log(`📊 미분양 단지 ${apartments.length}건 로드 (${regionFilter || "전체"})`);

  if (dryRun) {
    console.log("\n🔍 --dry-run: 대상 목록만 출력\n");
    for (const apt of apartments) {
      const kw = buildSearchKeyword(apt);
      console.log(`  ${apt.id} | ${apt.name} | 검색: "${kw}"`);
    }
    console.log(`\n총 ${apartments.length}건 대상`);
    return;
  }

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // 기존 결과 로드 (이어받기)
  let existingResult = {};
  if (existsSync(OUTPUT_FILE)) {
    try {
      existingResult = JSON.parse(readFileSync(OUTPUT_FILE, "utf8"));
      console.log(`📂 기존 결과 로드: ${Object.keys(existingResult.trends || {}).length}건`);
    } catch { /* ignore */ }
  }

  const trends = existingResult.trends || {};
  const errors = [];

  // Phase 4: 매물 이력 로드
  const articleHistory = loadArticleHistory();
  const historyStats = { newListings: 0, priceChanges: 0, totalTracked: 0 };

  // 검색 키워드 중복 제거 (같은 gu의 단지들은 한 번만 검색)
  const searchMap = new Map();
  for (const apt of apartments) {
    const kw = buildSearchKeyword(apt);
    if (!searchMap.has(kw)) searchMap.set(kw, []);
    searchMap.get(kw).push(apt);
  }

  console.log(`\n🔍 검색 키워드 ${searchMap.size}개 (단지 ${apartments.length}개)\n`);

  let processedCount = 0;
  let skippedCount = 0;
  const totalApts = apartments.length;

  for (const [keyword, aptsForKeyword] of searchMap) {
    console.log(`\n── 검색: "${keyword}" (${aptsForKeyword.length}개 단지) ──`);

    // 1. 네이버 검색으로 주변 단지 찾기
    let nearbyComplexes;
    try {
      nearbyComplexes = await searchComplexes(keyword, CONFIG.SEARCH_MAX_PAGES);
    } catch (err) {
      console.error(`  ❌ 검색 실패: ${err.message}`);
      errors.push({ type: "search", target: keyword, error: err.message, errorType: err.name, code: err.code || null, at: new Date().toISOString() });
      skippedCount += aptsForKeyword.length;
      continue;
    }

    console.log(`  📍 네이버 검색 결과: ${nearbyComplexes.length}개 단지`);

    // 2. 각 미분양 단지별로 처리
    for (const apt of aptsForKeyword) {
      processedCount++;
      console.log(`\n  [${processedCount}/${totalApts}] ${apt.name} (${apt.id})`);

      // 이미 최근 수집된 데이터가 있으면 스킵
      if (trends[apt.id]?.fetchedAt) {
        const lastFetch = new Date(trends[apt.id].fetchedAt).getTime();
        if (Number.isFinite(lastFetch) && Date.now() - lastFetch < CONFIG.SKIP_IF_WITHIN_MS) {
          console.log(`    ⏭ 최근 수집 데이터 있음 (스킵)`);
          continue;
        }
      }

      trends[apt.id] = await processApartment(apt, nearbyComplexes, errors);

      // Phase 4: 매물 이력 추적
      for (const type of ["sell", "jeonse", "wolse"]) {
        for (const art of trends[apt.id].articles[type]) {
          const status = trackArticle(art.articleNo, art, articleHistory);
          if (status === "new") historyStats.newListings++;
          if (status === "changed") historyStats.priceChanges++;
        }
      }

      const total = (trends[apt.id].articles.sell.length || 0) +
        (trends[apt.id].articles.jeonse.length || 0) +
        (trends[apt.id].articles.wolse.length || 0);
      console.log(`    ✅ 단지 ${trends[apt.id].nearbyCount}개, 매물 ${total}건`);

      // 중간 저장
      if (processedCount % CONFIG.CHECKPOINT_INTERVAL === 0) {
        saveResult(trends, errors);
        console.log(`    💾 중간 저장 (${processedCount}/${totalApts})`);
      }
    }
  }

  // Phase 4: 비활성 매물 감지 + 이력 저장
  const allCurrentNos = new Set();
  for (const t of Object.values(trends)) {
    for (const type of ["sell", "jeonse", "wolse"]) {
      for (const art of (t.articles?.[type] || [])) {
        allCurrentNos.add(art.articleNo);
      }
    }
  }
  const deactivated = deactivateMissing(articleHistory, allCurrentNos);
  historyStats.totalTracked = Object.keys(articleHistory).length;
  historyStats.deactivated = deactivated;
  saveArticleHistory(articleHistory, historyStats);

  // 최종 저장
  saveResult(trends, errors);
  console.log(`\n✅ 크롤링 완료: ${processedCount}건 처리, ${skippedCount}건 스킵, ${errors.length}건 오류`);
  console.log(`  📈 이력: 신규 ${historyStats.newListings}, 가격변동 ${historyStats.priceChanges}, 비활성 ${deactivated}, 총추적 ${historyStats.totalTracked}`);
  console.log(`📂 결과: ${OUTPUT_FILE}`);
}

// ── 통계 계산 ────────────────────────────────────────────────
function calculateStats(articles, pricesArr, complexInfos) {
  const sellPrices = articles.sell.map(a => a.price).filter(p => p > 0);
  const jeonsePrices = articles.jeonse.map(a => a.price).filter(p => p > 0);

  if (sellPrices.length === 0) return null;

  sellPrices.sort((a, b) => a - b);
  const median = calcMedian(sellPrices);
  const avg = Math.round(sellPrices.reduce((s, p) => s + p, 0) / sellPrices.length);

  // 전세가율
  let jeonseRate = null;
  if (jeonsePrices.length > 0 && median > 0) {
    jeonsePrices.sort((a, b) => a - b);
    const jMedian = calcMedian(jeonsePrices);
    // Fix 3: jMedian=0이면 전세가율 계산 무의미
    jeonseRate = jMedian > 0 ? Math.round(jMedian / median * 100) : null;
  }

  // 면적별 그룹핑
  const priceByArea = groupByArea(articles.sell);
  const rentByArea = groupByArea(articles.jeonse);

  // 전세가율 by area — rentByArea 기준으로 생성 (DetailModal이 rentByArea.area로 조인)
  const jeonseByArea = rentByArea.map(r => {
    const sell = priceByArea.find(p => Math.abs(p.area - r.area) <= CONFIG.AREA_BUCKET_SIZE);
    return {
      area: r.area,
      rate: sell && sell.avg > 0 ? Math.round(r.avg / sell.avg * 100) : null,
    };
  }).filter(j => j.rate !== null);

  // 층별 그룹핑
  const priceByFloor = groupByFloor(articles.sell);

  // recentTrades6m: pricesArr(시세 이력)에서 최근 6개월 거래 수 합산
  let recentTrades6m = sellPrices.length;
  if (pricesArr && pricesArr.length > 0) {
    let totalRecent = 0;
    for (const p of pricesArr) {
      const processed = processPrices(p.data);
      if (processed) totalRecent += processed.recentTrades6m;
    }
    if (totalRecent > 0) recentTrades6m = totalRecent;
  }

  // avgFloor, floorRange: 매물 층수 통계
  const floors = articles.sell
    .map(a => parseInt(a.floorInfo) || 0)
    .filter(f => f > 0);
  const avgFloor = floors.length > 0
    ? Math.round(floors.reduce((s, f) => s + f, 0) / floors.length)
    : null;
  const floorRange = floors.length > 0
    ? `${Math.min(...floors)}~${Math.max(...floors)}`
    : null;

  // nearbyBuildYear: 주변 단지 평균 건축년도
  let nearbyBuildYear = null;
  if (complexInfos && complexInfos.length > 0) {
    const years = complexInfos
      .map(c => {
        if (!c.approveDate) return 0;
        const y = parseInt(c.approveDate.slice(0, 4));
        return (y >= 1970 && y <= 2030) ? y : 0;
      })
      .filter(y => y > 0);
    if (years.length > 0) {
      nearbyBuildYear = Math.round(years.reduce((s, y) => s + y, 0) / years.length);
    }
  }

  // 관리비 통계 (매매 매물 기준)
  const maintenanceCosts = articles.sell
    .map(a => a.maintenanceCost)
    .filter(c => c != null && c > 0);
  maintenanceCosts.sort((a, b) => a - b);
  const maintenanceCostMedian = maintenanceCosts.length > 0 ? calcMedian(maintenanceCosts) : null;
  const maintenanceCostRange = maintenanceCosts.length > 0
    ? `${maintenanceCosts[0]}~${maintenanceCosts[maintenanceCosts.length - 1]}`
    : null;

  // 주차대수 통계 (단지 정보 기준)
  const parkingCounts = complexInfos
    .map(c => c.totalParkingCount)
    .filter(p => p != null && p > 0);
  const avgParkingCount = parkingCounts.length > 0
    ? Math.round(parkingCounts.reduce((s, p) => s + p, 0) / parkingCounts.length)
    : null;

  return {
    source: "naver",
    nearbyMedian: median,
    nearbyAvg: avg,
    nearbyMin: sellPrices[0],
    nearbyMax: sellPrices[sellPrices.length - 1],
    sellCount: sellPrices.length,
    jeonseCount: jeonsePrices.length,
    wolseCount: articles.wolse.length,
    totalSellCount: articles.sell.length,
    totalJeonseCount: articles.jeonse.length,
    totalWolseCount: articles.wolse.length,
    recentTrades6m,
    jeonseRate,
    nearbyBuildYear,
    avgFloor,
    floorRange,
    priceByArea,
    rentByArea,
    jeonseByArea,
    priceByFloor,
    // Phase 1 확장 통계
    maintenanceCostMedian,
    maintenanceCostRange,
    avgParkingCount,
    // Phase 2 학군 통계
    ...calcSchoolStats(complexInfos),
  };
}

function calcSchoolStats(complexInfos) {
  const allSchools = complexInfos.flatMap(c => c.schools || []);
  if (allSchools.length === 0) return {};
  // 중복 학교 제거 (같은 이름)
  const uniqueSchools = [...new Map(allSchools.map(s => [s.name, s])).values()];
  const walkTimes = uniqueSchools.map(s => s.walkTimeMin).filter(t => t != null && t > 0);
  const distances = uniqueSchools.map(s => s.distanceM).filter(d => d != null && d > 0);
  return {
    nearbySchoolCount: uniqueSchools.length,
    nearestWalkMin: walkTimes.length > 0 ? Math.min(...walkTimes) : null,
    nearestSchoolM: distances.length > 0 ? Math.min(...distances) : null,
    avgSchoolDistM: distances.length > 0
      ? Math.round(distances.reduce((s, d) => s + d, 0) / distances.length)
      : null,
  };
}

function groupByArea(articles) {
  const groups = {};
  for (const a of articles) {
    if (!a.exclusiveArea || a.price <= 0) continue;
    const bucket = Math.round(a.exclusiveArea / CONFIG.AREA_BUCKET_SIZE) * CONFIG.AREA_BUCKET_SIZE;
    if (!groups[bucket]) groups[bucket] = [];
    groups[bucket].push(a.price);
  }
  return Object.entries(groups)
    .map(([area, prices]) => {
      prices.sort((a, b) => a - b);
      return {
        area: Number(area),
        min: prices[0],
        avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
        max: prices[prices.length - 1],
        count: prices.length,
      };
    })
    .sort((a, b) => a.area - b.area);
}

function groupByFloor(articles) {
  const { low, mid } = CONFIG.FLOOR_TIERS;
  const groups = { [`저층(1-${low})`]: [], [`중층(${low + 1}-${mid})`]: [], [`고층(${mid + 1}+)`]: [] };
  const keys = Object.keys(groups);
  for (const a of articles) {
    if (a.price <= 0) continue;
    const floor = parseInt(a.floorInfo) || 0;
    if (floor <= 0) continue; // 지하·불명 제외
    if (floor <= low) groups[keys[0]].push(a.price);
    else if (floor <= mid) groups[keys[1]].push(a.price);
    else groups[keys[2]].push(a.price);
  }
  return Object.entries(groups)
    .filter(([, prices]) => prices.length > 0)
    .map(([group, prices]) => ({
      group,
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
      count: prices.length,
    }));
}

// ── Phase 4: 매물 생명주기 추적 ─────────────────────────────
function loadArticleHistory() {
  if (!existsSync(HISTORY_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
    return raw.articles || {};
  } catch { return {}; }
}

function trackArticle(articleNo, article, history) {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const existing = history[articleNo];
  if (!existing) {
    history[articleNo] = {
      complexNo: article.complexNo,
      firstSeen: now,
      lastSeen: now,
      isActive: true,
      priceHistory: [{ date, price: article.price, tradeType: article.tradeType }],
    };
    return "new";
  }
  existing.lastSeen = now;
  existing.isActive = true;
  const lastEntry = existing.priceHistory[existing.priceHistory.length - 1];
  if (lastEntry.price !== article.price) {
    existing.priceHistory.push({ date, price: article.price, tradeType: article.tradeType });
    return "changed";
  }
  return "same";
}

function deactivateMissing(history, currentArticleNos) {
  let deactivated = 0;
  for (const [no, art] of Object.entries(history)) {
    if (art.isActive && !currentArticleNos.has(no)) {
      art.isActive = false;
      art.deactivatedAt = new Date().toISOString();
      deactivated++;
    }
  }
  return deactivated;
}

// Fix 1: 이력 프루닝 — 90일 초과 비활성 항목 삭제 + priceHistory 50건 제한
function pruneHistory(history) {
  const cutoff = Date.now() - 90 * 24 * 3_600_000;
  let pruned = 0;
  for (const [no, art] of Object.entries(history)) {
    if (!art.isActive && new Date(art.lastSeen).getTime() < cutoff) {
      delete history[no];
      pruned++;
      continue;
    }
    if (art.priceHistory && art.priceHistory.length > 50) {
      art.priceHistory = art.priceHistory.slice(-50);
    }
  }
  if (pruned > 0) console.log(`  🧹 이력 프루닝: ${pruned}건 삭제 (90일 초과 비활성)`);
}

function saveArticleHistory(history, stats) {
  pruneHistory(history);  // Fix 1: 저장 전 프루닝
  try {
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    const tmpFile = HISTORY_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify({ articles: history, stats }, null, 2), "utf8");
    renameSync(tmpFile, HISTORY_FILE);
  } catch (err) {
    console.error(`  ❌ 이력 저장 실패: ${err.message}`);
  }
}

// ── 결과 저장 (원자적: temp → rename) ────────────────────────
function saveResult(trends, errors) {
  try {
    const result = {
      version: "2.0",
      generatedAt: new Date().toISOString(),
      totalApartments: Object.keys(trends).length,
      errors: errors.slice(-CONFIG.MAX_ERRORS_SAVED),
      trends,
    };
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    const tmpFile = OUTPUT_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(result, null, 2), "utf8");
    renameSync(tmpFile, OUTPUT_FILE);
  } catch (err) {
    console.error(`  ❌ 저장 실패: ${err.message}`);
  }
}

// ── 실행 ─────────────────────────────────────────────────────
crawl().catch(err => {
  console.error("❌ 크롤링 실패:", err);
  process.exit(1);
});
