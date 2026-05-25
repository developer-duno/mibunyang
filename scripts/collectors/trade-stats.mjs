// @ts-check
/**
 * 거래 통계 산출 — PIR, PSR, 전세가율, 인근 시세 중위값
 *
 * 기존 Supabase 데이터(apartments, trades, regions, complexes, articles)에서
 * 파생 지표를 계산하여 trade_stats 테이블에 upsert.
 *
 * 사용법:
 *   node scripts/collectors/trade-stats.mjs          (trade_stats 테이블 업데이트)
 *   node scripts/collectors/trade-stats.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role 키
 */
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError, createSemaphore, recordCollectorRun } from "./_shared.mjs";

loadEnv();

// KOSIS DT_1C86 2022년 전국 1인당 개인소득 23,388천원/년 ÷ 12 ÷ 10 = 195만원/월.
// 세션107 이전 5000(단위 오해, 월로 기재됐으나 연 단위로 쓰이고 있었음) → 195로 정정.
// collect-avg-income.mjs가 regions.avg_income을 동일 단위(만원/월)로 채우므로 기본값도 일치.
const NATIONAL_MEDIAN_INCOME = 195; // 만원/월 — avg_income null 시 fallback

// ── region/gu → 인덱스 키 ──────────────────────────────────────
// 세종은 gu=null(40건) / gu="행정중심복합도시"(1건) 두 버킷으로 분산돼 있어
// 한 버킷으로 통합하기 위해 region==="세종" 화이트리스트로 gu 무시.
// 비세종은 기존 `region:gu` 리터럴과 bit 단위 동일한 키 반환.
/**
 * @param {string | null | undefined} region
 * @param {string | null | undefined} gu
 * @returns {string | null}
 */
export function statsKey(region, gu) {
  if (!region) return null;
  if (region === "세종") return "세종:";
  return gu ? `${region}:${gu}` : null;
}

// ── 중위값 헬퍼 ────────────────────────────────────────────────
/**
 * @param {number[]} arr
 * @returns {number | null}
 */
export function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

// ── 날짜 헬퍼 ──────────────────────────────────────────────────
/** @param {number} n */
export function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ── Supabase 전체 조회 (1000건 페이징) ─────────────────────────
/**
 * @param {string} table
 * @param {string} select
 * @param {Record<string, any>} [filters]
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [sb]
 * @param {Array<{col: string, op: string, val: any}>} [rangeFilters]
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchAll(table, select, filters = {}, sb = null, rangeFilters = []) {
  sb = sb ?? getSupabase();
  const rows = [];
  const PAGE = 1000;
  let from = 0;

  while (true) {
    /** @type {any} */
    let q = sb.from(table).select(select).range(from, from + PAGE - 1);
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    for (const { col, op, val } of rangeFilters) {
      q = q[op](col, val);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return rows;
}

// ── 해제 거래 조회 (fetchAll은 NOT IS NULL 미지원 → 별도 함수) ──
/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} cutoff
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchCancelledTrades(sb, cutoff) {
  /** @type {Array<Record<string, any>>} */
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("trades")
      .select("region,gu,deal_month,trade_type")
      .gte("deal_month", cutoff)
      .not("cancel_date", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`해제거래 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ── 메인 ─────────────────────────────────────────────────────
/** 거래 배열 → 면적별 min/avg/max/count 통계
 * @param {Array<Record<string, any>>} trades
 */
export function groupByArea(trades) {
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (const t of trades) {
    const bucket = Math.round(t.area / 5) * 5;
    if (!groups.has(bucket)) groups.set(bucket, []);
    (groups.get(bucket) ?? []).push(t.price);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([area, prices]) => ({
      area,
      min: Math.min(...prices),
      avg: Math.round(prices.reduce(/** @type {(s: number, p: number) => number} */ ((s, p) => s + p), 0) / prices.length),
      max: Math.max(...prices),
      count: prices.length,
    }));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cutoff12m = monthsAgo(12);
  const cutoff6m = monthsAgo(6);

  // 1. 데이터 로드
  const sbMibunyang = getMibuyangSupabase();

  log("load", "데이터 병렬 조회...");
  const cutoff12mYM = cutoff12m.replace(/-/g, "").slice(0, 6); // YYYYMM 형식
  const cutoff6mYM = cutoff6m.replace(/-/g, "").slice(0, 6);
  const [rawApts, rawPrices, trades, regions, naverArticles, naverComplexes, priceHistory, cancelledTrades] = await Promise.all([
    fetchAll("apartments", "id,name,region,gu,naver_jeonse_rate", {}, sbMibunyang),
    fetchAll("prices", "apartment_id,area,price,recorded_at", {}, sbMibunyang),
    fetchAll("trades", "region,gu,price,area,floor,deal_month:deal_month,trade_type", {}, sbMibunyang,
      [{ col: "deal_month", op: "gte", val: cutoff12mYM },
       { col: "cancel_date", op: "is", val: null }]).catch(() => []),
    fetchAll("regions", "region,gu,avg_income", {}, sbMibunyang).catch(() => []),
    fetchAll("articles", "complex_no,trade_type_name,numeric_price,area2_m2", { is_active: true }, sbMibunyang).catch(() => []),
    fetchAll("complexes", "complex_no,sido,sigungu,use_approve_ymd", {}, sbMibunyang).catch(() => []),
    fetchAll("complex_price_history", "complex_no,trade_type,price_avg,base_month", { trade_type: "A1" }, sbMibunyang,
      [{ col: "base_month", op: "gte", val: cutoff12mYM }])
      .then(rows => rows.filter(r => r.price_avg != null))
      .catch(() => []),
    // 해제 거래 (cancel_date IS NOT NULL, 6개월)
    fetchCancelledTrades(sbMibunyang, cutoff6mYM).catch(() => []),
  ]);
  // rawPrices에서 아파트별 최신 가격·면적 매핑 (apartments 테이블에 price/area 컬럼 없음)
  /** @type {Map<string, Record<string, any>>} */
  const latestPriceMap = new Map();
  for (const p of rawPrices) {
    if (!p.price || p.price <= 0) continue; // price=0 오염 row 방어
    const prev = latestPriceMap.get(p.apartment_id);
    if (!prev || (p.recorded_at && (!prev.recorded_at || p.recorded_at > prev.recorded_at))) {
      latestPriceMap.set(p.apartment_id, p);
    }
  }
  /** @type {Array<Record<string, any>>} */
  const apartments = rawApts.map(/** @param {Record<string, any>} a */ (a) => {
    const lp = latestPriceMap.get(a.id);
    return { ...a, price: lp?.price ?? null, area: lp?.area ?? null };
  });
  log("load", `아파트 ${apartments.length}건, 가격 ${rawPrices.length}건, 거래 ${trades.length}건, 해제거래 ${cancelledTrades.length}건, 지역 ${regions.length}건, 매물 ${naverArticles.length}건, 단지 ${naverComplexes.length}건, 시세이력 ${priceHistory.length}건`);

  // 2. 인덱스 구축
  // 지역 소득 맵: "region:gu" → avg_income
  /** @type {Map<string, number>} */
  const incomeMap = new Map();
  for (const r of regions) {
    if (r.avg_income != null) {
      if (r.gu) incomeMap.set(`${r.region}:${r.gu}`, r.avg_income);
      else incomeMap.set(r.region, r.avg_income); // 시도 단위
    }
  }

  // 거래 그룹: statsKey(region,gu) → trades[]
  /** @type {Map<string, Array<Record<string, any>>>} */
  const tradesByGu = new Map();
  for (const t of trades) {
    if (t.price == null) continue;
    const key = statsKey(t.region, t.gu);
    if (!key) continue;
    if (!tradesByGu.has(key)) tradesByGu.set(key, []);
    (tradesByGu.get(key) ?? []).push(t);
  }

  // 네이버 단지 → 아파트 매핑, 단지별 구 정보
  // 세종은 sido="세종특별자치시", sigungu=NULL 로 저장돼 있어 region="세종" 로 정규화하고 gu 는 버림.
  /** @type {Map<string, { region: string, gu: string | null }>} */
  const complexGuMap = new Map();
  for (const nc of naverComplexes) {
    if (!nc.sido) continue;
    const region = nc.sido === "세종특별자치시" ? "세종" : nc.sido;
    const gu = region === "세종" ? null : nc.sigungu;
    if (region === "세종" || gu) complexGuMap.set(nc.complex_no, { region, gu });
  }

  // 네이버 매물 그룹: statsKey → articles[]
  /** @type {Map<string, Array<Record<string, any>>>} */
  const naverByGu = new Map();
  for (const a of naverArticles) {
    const guInfo = complexGuMap.get(a.complex_no);
    if (!guInfo) continue;
    const key = statsKey(guInfo.region, guInfo.gu);
    if (!key) continue;
    if (!naverByGu.has(key)) naverByGu.set(key, []);
    (naverByGu.get(key) ?? []).push(a);
  }

  // 시세 이력 그룹: statsKey → price_avg[]
  /** @type {Map<string, number[]>} */
  const historyByGu = new Map();
  for (const h of priceHistory) {
    const guInfo = complexGuMap.get(h.complex_no);
    if (!guInfo || h.price_avg == null) continue;
    const key = statsKey(guInfo.region, guInfo.gu);
    if (!key) continue;
    if (!historyByGu.has(key)) historyByGu.set(key, []);
    (historyByGu.get(key) ?? []).push(h.price_avg);
  }

  // 해제 거래 그룹: statsKey → 해제 건수 (매매만)
  /** @type {Map<string, number>} */
  const cancelByGu = new Map();
  for (const t of cancelledTrades) {
    if (t.trade_type !== "sale" && t.trade_type !== "매매" && t.trade_type != null) continue;
    const key = statsKey(t.region, t.gu);
    if (!key) continue;
    cancelByGu.set(key, (cancelByGu.get(key) || 0) + 1);
  }

  // 3. 각 아파트별 통계 산출
  log("calc", "아파트별 거래 통계 계산...");
  const results = [];
  const dsrUpdates = [];
  let processed = 0;

  for (const apt of apartments) {
    const key = statsKey(apt.region, apt.gu);
    if (!key) continue;

    const aptPrice = apt.price; // 만원
    const aptArea = apt.area || null;

    // ── nearby_median (인근 시세 중위값) ───────────────────────
    let nearbyMedian = null;
    let medianSource = null;
    const guTrades = tradesByGu.get(key) || [];
    // trades는 서버사이드에서 12개월 필터링 완료 — 거래유형만 필터
    const recent12m = guTrades.filter(
      (t) => t.trade_type === "sale" || t.trade_type === "매매" || !t.trade_type
    );

    // 1단계: 실거래 데이터 (매매 3건+)
    if (recent12m.length >= 3) {
      nearbyMedian = median(recent12m.map((t) => t.price));
      medianSource = "trades";
    } else {
      // 2단계: 네이버 매물 호가 (articles)
      const guNaver = naverByGu.get(key) || [];
      const naverSale = guNaver.filter(
        (a) =>
          a.numeric_price != null &&
          (a.trade_type_name === "매매" || a.trade_type_name === "sale" || !a.trade_type_name)
      );
      if (naverSale.length >= 1) {
        nearbyMedian = median(naverSale.map((a) => a.numeric_price));
        medianSource = "articles";
      }
    }

    // 3단계: 네이버 시세 이력 (complex_price_history)
    if (nearbyMedian == null) {
      const guHistory = historyByGu.get(key) || [];
      if (guHistory.length >= 1) {
        nearbyMedian = median(guHistory);
        medianSource = "history";
      }
    }

    // ── jeonse_rate (전세가율 %) ──────────────────────────────
    let jeonseRate = null;
    if (aptPrice && aptPrice > 0) {
      // 거래 데이터에서 전세 중위 (서버사이드 12개월 필터 적용됨)
      const jeonse12m = guTrades.filter(
        (t) => t.trade_type === "jeonse" || t.trade_type === "전세"
      );

      if (jeonse12m.length >= 3) {
        const jeonseMedian = median(jeonse12m.map((t) => t.price));
        const saleMedian = nearbyMedian || aptPrice;
        if (jeonseMedian != null && saleMedian > 0) {
          jeonseRate = Math.round((jeonseMedian / saleMedian) * 1000) / 10;
        }
      } else {
        // articles 대체
        const guNaver = naverByGu.get(key) || [];
        const naverJeonse = guNaver.filter(
          (a) =>
            a.numeric_price != null &&
            (a.trade_type_name === "전세" || a.trade_type_name === "lease")
        );
        const naverSale = guNaver.filter(
          (a) =>
            a.numeric_price != null &&
            (a.trade_type_name === "매매" || a.trade_type_name === "sale" || !a.trade_type_name)
        );
        const jMedian = naverJeonse.length >= 1 ? median(naverJeonse.map((a) => a.numeric_price)) : null;
        const sMedian = naverSale.length >= 1 ? median(naverSale.map((a) => a.numeric_price)) : nearbyMedian;
        if (jMedian != null && sMedian && sMedian > 0) {
          jeonseRate = Math.round((jMedian / sMedian) * 1000) / 10;
        }
      }
    }

    // 네이버 전세가율 fallback
    if (jeonseRate == null && apt.naver_jeonse_rate != null) {
      jeonseRate = apt.naver_jeonse_rate;
    }

    // ── pir (Price to Income Ratio, 연) ──────────────────────
    let pir = null;
    if (aptPrice != null && aptPrice > 0) {
      // gu 단위 → region 단위 → 전국 중위 순으로 폴백
      const income =
        incomeMap.get(key) ??
        incomeMap.get(apt.region) ??
        NATIONAL_MEDIAN_INCOME;
      const annualIncome = income * 12; // 만원/년
      if (annualIncome > 0) {
        pir = Math.round((aptPrice / annualIncome) * 100) / 100;
      }
    }

    // ── psr (Price to Surrounding Ratio) ────────────────────
    let psr = null;
    if (aptPrice != null && aptArea && aptArea > 0 && nearbyMedian != null) {
      const aptPricePerM2 = aptPrice / aptArea;

      // 인근 거래의 평균 m2당 가격
      const withArea = recent12m.filter((t) => t.area && t.area > 0);
      let nearbyPerM2 = null;

      if (withArea.length >= 3) {
        const perM2List = withArea.map((t) => t.price / t.area);
        nearbyPerM2 = median(perM2List);
      } else {
        // naver 대체
        const guNaver = naverByGu.get(key) || [];
        const naverWithArea = guNaver.filter(
          (a) =>
            a.numeric_price != null &&
            a.area2_m2 &&
            a.area2_m2 > 0 &&
            (a.trade_type_name === "매매" || a.trade_type_name === "sale" || !a.trade_type_name)
        );
        if (naverWithArea.length >= 1) {
          nearbyPerM2 = median(naverWithArea.map((a) => a.numeric_price / a.area2_m2));
        }
      }

      if (nearbyPerM2 && nearbyPerM2 > 0) {
        psr = Math.round((aptPricePerM2 / nearbyPerM2) * 100) / 100;
      }
    }

    // ── recent_trades_6m (최근 6개월 거래 건수) ──────────────
    const recent6m = guTrades.filter(
      (t) => t.deal_month >= cutoff6mYM && (t.trade_type === "sale" || t.trade_type === "매매" || !t.trade_type)
    );
    const recentTrades6m = recent6m.length || null;

    // ── cancel_ratio_6m (6개월 매매 해제비율 %) ────────────────
    let cancelRatio6m = null;
    const cancelCount = cancelByGu.get(key) || 0;
    const totalSale6m = recent6m.length + cancelCount;
    if (totalSale6m >= 3) {
      cancelRatio6m = Math.round((cancelCount / totalSale6m) * 1000) / 10;
    }

    // ── dsr40pass (DSR 40% 통과 여부) ──────────────────────────
    // 70% LTV, 30년 원리금균등, 금리 4% 가정
    let dsr40pass = null;
    if (pir != null && pir > 0 && aptPrice != null && aptPrice > 0) {
      const loanAmount = aptPrice * 0.7; // 만원
      const monthlyRate = 0.04 / 12;
      const months = 30 * 12;
      const monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
      const annualPayment = monthlyPayment * 12;
      const annualIncome = aptPrice / pir;
      const dsr = (annualPayment / annualIncome) * 100;
      dsr40pass = dsr <= 40;
    }

    // ── 시세 배열 (DetailModal 시세 테이블용) ─────────────────────
    // 면적별 매매 시세
    const priceByArea = groupByArea(recent12m.filter(t => t.price > 0 && t.area > 0));

    // 면적별 전세 시세 (서버사이드 12개월 필터 적용됨)
    const jeonseAll = guTrades.filter(
      t => (t.trade_type === "jeonse" || t.trade_type === "전세") && t.price > 0 && t.area > 0
    );
    const rentByArea = groupByArea(jeonseAll);

    // 면적별 전세가율 (매매/전세 매칭)
    const jeonseByArea = priceByArea
      .map(sell => {
        const rent = rentByArea.find(r => Math.abs(r.area - sell.area) <= 5);
        if (!rent || sell.avg <= 0) return null;
        return { area: sell.area, rate: Math.round((rent.avg / sell.avg) * 1000) / 10 };
      })
      .filter(Boolean);

    // 층수별 매매 시세
    const floorTrades = recent12m.filter(t => t.price > 0 && t.floor != null && t.floor > 0);
    const floorGroups = new Map();
    for (const t of floorTrades) {
      const group = t.floor <= 5 ? "1-5층" : t.floor <= 15 ? "6-15층" : "16층+";
      if (!floorGroups.has(group)) floorGroups.set(group, []);
      floorGroups.get(group).push(t.price);
    }
    const priceByFloor = [...floorGroups.entries()]
      .sort((a, b) => {
        /** @type {Record<string, number>} */
        const order = { "1-5층": 0, "6-15층": 1, "16층+": 2 };
        return (order[a[0]] ?? 9) - (order[b[0]] ?? 9);
      })
      .map(([group, prices]) => ({
        group,
        avg: Math.round(prices.reduce(/** @type {(s: number, p: number) => number} */ ((s, p) => s + p), 0) / prices.length),
        count: prices.length,
      }));

    // ── avgFloor / floorRange (거래 층수 통계) ─────────────────
    const floors = floorTrades.map(t => t.floor);
    const avgFloor = floors.length > 0
      ? Math.round(floors.reduce((s, f) => s + f, 0) / floors.length)
      : null;
    const floorRange = floors.length > 0
      ? `${Math.min(...floors)}~${Math.max(...floors)}`
      : null;

    // ── nearbyBuildYear (인근 평균 건축연도) ────────────────────
    let nearbyBuildYear = null;
    const guComplexes = naverComplexes.filter(nc => {
      const gi = complexGuMap.get(nc.complex_no);
      return gi && statsKey(gi.region, gi.gu) === key;
    });
    const buildYears = guComplexes
      .map(nc => nc.use_approve_ymd ? parseInt(nc.use_approve_ymd.slice(0, 4), 10) : NaN)
      .filter(y => !isNaN(y) && y > 1970);
    if (buildYears.length > 0) {
      nearbyBuildYear = Math.round(buildYears.reduce((s, y) => s + y, 0) / buildYears.length);
    }

    // 모든 값이 null이면 스킵
    if (
      nearbyMedian == null &&
      jeonseRate == null &&
      pir == null &&
      psr == null &&
      recentTrades6m == null &&
      cancelRatio6m == null
    ) {
      continue;
    }

    results.push({
      apartment_id: apt.id,
      nearby_median: nearbyMedian,
      _medianSource: medianSource,
      recent_trades_6m: recentTrades6m,
      jeonse_rate: jeonseRate,
      pir,
      psr,
      price_by_area: priceByArea.length > 0 ? priceByArea : [],
      rent_by_area: rentByArea.length > 0 ? rentByArea : [],
      jeonse_by_area: jeonseByArea.length > 0 ? jeonseByArea : [],
      price_by_floor: priceByFloor.length > 0 ? priceByFloor : [],
      avg_floor: avgFloor,
      floor_range: floorRange,
      nearby_build_year: nearbyBuildYear,
      cancel_ratio_6m: cancelRatio6m,
      updated_at: new Date().toISOString(),
    });

    if (dsr40pass != null) {
      dsrUpdates.push({ id: apt.id, dsr40pass });
    }

    processed++;
    if (processed % 100 === 0) {
      log("calc", `${processed}/${apartments.length}건 처리...`);
    }
  }

  log("calc", `${results.length}건 통계 산출 완료`);

  // 4. 요약 출력
  const withMedian = results.filter((r) => r.nearby_median != null);
  const withPir = results.filter((r) => r.pir != null);
  const withPsr = results.filter((r) => r.psr != null);
  const withJeonse = results.filter((r) => r.jeonse_rate != null);
  const withTrades = results.filter((r) => r.recent_trades_6m != null);
  const withCancel = results.filter((r) => r.cancel_ratio_6m != null);

  const fromTrades = results.filter(r => r._medianSource === "trades").length;
  const fromArticles = results.filter(r => r._medianSource === "articles").length;
  const fromHistory = results.filter(r => r._medianSource === "history").length;
  log("summary", `nearby_median: ${withMedian.length}건 (실거래 ${fromTrades}, 매물 ${fromArticles}, 시세이력 ${fromHistory})`);
  log("summary", `pir: ${withPir.length}건 (평균 ${withPir.length ? (withPir.reduce((s, r) => s + (r.pir ?? 0), 0) / withPir.length).toFixed(1) : "N/A"}년)`);
  log("summary", `psr: ${withPsr.length}건 (평균 ${withPsr.length ? (withPsr.reduce((s, r) => s + (r.psr ?? 0), 0) / withPsr.length).toFixed(2) : "N/A"})`);
  log("summary", `jeonse_rate: ${withJeonse.length}건 (평균 ${withJeonse.length ? (withJeonse.reduce((s, r) => s + (r.jeonse_rate ?? 0), 0) / withJeonse.length).toFixed(1) : "N/A"}%)`);
  log("summary", `recent_trades_6m: ${withTrades.length}건`);
  log("summary", `cancel_ratio_6m: ${withCancel.length}건 (평균 ${withCancel.length ? (withCancel.reduce((s, r) => s + (r.cancel_ratio_6m ?? 0), 0) / withCancel.length).toFixed(1) : "N/A"}%)`);
  log("summary", `dsr40pass: ${dsrUpdates.filter(d => d.dsr40pass).length}통과 / ${dsrUpdates.filter(d => !d.dsr40pass).length}미통과 (총 ${dsrUpdates.length}건)`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");

    if (withPir.length) {
      console.log("\nPIR 상위 10:");
      for (const r of withPir.sort((a, b) => (b.pir ?? 0) - (a.pir ?? 0)).slice(0, 10)) {
        const apt = apartments.find((a) => a.id === r.apartment_id);
        console.log(`  ${apt?.name ?? r.apartment_id}: PIR ${r.pir}년, PSR ${r.psr ?? "N/A"}, 전세가율 ${r.jeonse_rate ?? "N/A"}%`);
      }
    }

    if (withPir.length) {
      console.log("\nPIR 하위 10:");
      for (const r of withPir.sort((a, b) => (a.pir ?? 0) - (b.pir ?? 0)).slice(0, 10)) {
        const apt = apartments.find((a) => a.id === r.apartment_id);
        console.log(`  ${apt?.name ?? r.apartment_id}: PIR ${r.pir}년, PSR ${r.psr ?? "N/A"}, 전세가율 ${r.jeonse_rate ?? "N/A"}%`);
      }
    }
    return;
  }

  // 5. Supabase upsert
  if (!results.length) {
    log("done", "upsert할 데이터 없음");
    return;
  }

  const BATCH = 500;
  let upserted = 0;

  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH).map(({ _medianSource, ...row }) => row);
    const { error } = await sbMibunyang
      .from("trade_stats")
      .upsert(batch, { onConflict: "apartment_id", ignoreDuplicates: false });

    if (error) {
      logError("upsert", `배치 ${i}~${i + batch.length}: ${error.message}`);
      // 개별 재시도
      for (const row of batch) {
        const { error: e2 } = await sbMibunyang
          .from("trade_stats")
          .upsert([row], { onConflict: "apartment_id", ignoreDuplicates: false });
        if (!e2) upserted++;
      }
    } else {
      upserted += batch.length;
    }
  }

  log("done", `trade_stats 테이블 ${upserted}/${results.length}건 upsert 완료`);

  // 6. DSR 40% 통과 여부 → apartments 테이블 업데이트 (동시 10 병렬)
  // 세션 309: 직렬 for-loop (1960 row × 150ms = ~5분, timeout 15분 boundary 도달) → createSemaphore(10) 병렬 (~30초).
  if (dsrUpdates.length > 0) {
    const limit = createSemaphore(10);
    const dsrResults = await Promise.all(
      dsrUpdates.map(({ id, dsr40pass }) =>
        limit(async () => await sbMibunyang.from("apartments").update({ dsr40pass }).eq("id", id))
      )
    );
    const dsrOk = dsrResults.filter((/** @type {any} */ r) => !r.error).length;
    log("done", `apartments.dsr40pass ${dsrOk}/${dsrUpdates.length}건 업데이트 완료`);
  }

  await recordCollectorRun("trade-stats", { ok: upserted, fail: results.length - upserted });
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((err) => { logError("main", err instanceof Error ? err.message : String(err)); process.exit(1); });
