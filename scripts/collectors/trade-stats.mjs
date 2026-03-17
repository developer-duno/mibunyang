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
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError } from "./_shared.mjs";

loadEnv();

const NATIONAL_MEDIAN_INCOME = 5000; // 만원/월 — avg_income null 시 기본값

// ── 중위값 헬퍼 ────────────────────────────────────────────────
function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

// ── 날짜 헬퍼 ──────────────────────────────────────────────────
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ── Supabase 전체 조회 (1000건 페이징) ─────────────────────────
async function fetchAll(table, select, filters = {}, sb = null) {
  sb = sb ?? getSupabase();
  const rows = [];
  const PAGE = 1000;
  let from = 0;

  while (true) {
    let q = sb.from(table).select(select).range(from, from + PAGE - 1);
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
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

// ── 메인 ─────────────────────────────────────────────────────
/** 거래 배열 → 면적별 min/avg/max/count 통계 */
function groupByArea(trades) {
  const groups = new Map();
  for (const t of trades) {
    const bucket = Math.round(t.area / 5) * 5;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(t.price);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([area, prices]) => ({
      area,
      min: Math.min(...prices),
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
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
  const [rawApts, rawPrices, trades, regions, naverArticles, naverComplexes] = await Promise.all([
    fetchAll("apartments", "id,name,region,gu", {}, sbMibunyang),
    fetchAll("prices", "apartment_id,area,price,recorded_at", {}, sbMibunyang),
    fetchAll("trades", "region,gu,price,area,floor,deal_month:deal_month,trade_type", {}, sbMibunyang).catch(() => []),
    fetchAll("regions", "region,gu,avg_income", {}, sbMibunyang).catch(() => []),
    fetchAll("articles", "complex_no,trade_type_name,numeric_price,area2_m2,created_at", { is_active: true }, sbMibunyang).catch(() => []),
    fetchAll("complexes", "complex_no,sido,sigungu,use_approve_ymd", {}, sbMibunyang).catch(() => []),
  ]);
  log("load", `아파트 ${rawApts.length}건, 가격 ${rawPrices.length}건, 거래 ${trades.length}건, 지역 ${regions.length}건, 매물 ${naverArticles.length}건, 단지 ${naverComplexes.length}건`)

  // 2. 인덱스 구축
  // 지역 소득 맵: "region:gu" → avg_income
  const incomeMap = new Map();
  for (const r of regions) {
    if (r.avg_income != null) {
      if (r.gu) incomeMap.set(`${r.region}:${r.gu}`, r.avg_income);
      else incomeMap.set(r.region, r.avg_income); // 시도 단위
    }
  }

  // 거래 그룹: "region:gu" → trades[]
  const tradesByGu = new Map();
  for (const t of trades) {
    if (!t.region || !t.gu || t.price == null) continue;
    const key = `${t.region}:${t.gu}`;
    if (!tradesByGu.has(key)) tradesByGu.set(key, []);
    tradesByGu.get(key).push(t);
  }

  // 네이버 단지 → 아파트 매핑, 단지별 구 정보
  const complexGuMap = new Map();
  for (const nc of naverComplexes) {
    if (nc.sido && nc.sigungu) complexGuMap.set(nc.complex_no, { region: nc.sido, gu: nc.sigungu });
  }

  // 네이버 매물 그룹: "region:gu" → articles[]
  const naverByGu = new Map();
  for (const a of naverArticles) {
    const guInfo = complexGuMap.get(a.complex_no);
    if (!guInfo) continue;
    const key = `${guInfo.region}:${guInfo.gu}`;
    if (!naverByGu.has(key)) naverByGu.set(key, []);
    naverByGu.get(key).push(a);
  }

  // 3. 각 아파트별 통계 산출
  log("calc", "아파트별 거래 통계 계산...");
  const results = [];
  const dsrUpdates = [];
  let processed = 0;

  for (const apt of apartments) {
    if (!apt.region || !apt.gu) continue;

    const key = `${apt.region}:${apt.gu}`;
    const aptPrice = apt.price; // 만원
    const aptArea = apt.area || null;

    // ── nearby_median (인근 시세 중위값) ───────────────────────
    let nearbyMedian = null;
    const guTrades = tradesByGu.get(key) || [];
    const recent12m = guTrades.filter(
      (t) => t.deal_month >= cutoff12m && (t.trade_type === "매매" || !t.trade_type)
    );

    if (recent12m.length >= 3) {
      nearbyMedian = median(recent12m.map((t) => t.price));
    } else {
      // trades 부족 시 articles 대체
      const guNaver = naverByGu.get(key) || [];
      const naverSale = guNaver.filter(
        (a) =>
          a.numeric_price != null &&
          (a.trade_type_name === "매매" || a.trade_type_name === "sale" || !a.trade_type_name) &&
          (!a.created_at || a.created_at >= cutoff12m)
      );
      if (naverSale.length >= 1) {
        nearbyMedian = median(naverSale.map((a) => a.numeric_price));
      }
    }

    // ── jeonse_rate (전세가율 %) ──────────────────────────────
    let jeonseRate = null;
    if (aptPrice && aptPrice > 0) {
      // 거래 데이터에서 전세 중위
      const jeonse12m = guTrades.filter(
        (t) => t.deal_month >= cutoff12m && t.trade_type === "전세"
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
            (a.trade_type_name === "전세" || a.trade_type_name === "lease") &&
            (!a.created_at || a.created_at >= cutoff12m)
        );
        const naverSale = guNaver.filter(
          (a) =>
            a.numeric_price != null &&
            (a.trade_type_name === "매매" || a.trade_type_name === "sale" || !a.trade_type_name) &&
            (!a.created_at || a.created_at >= cutoff12m)
        );
        const jMedian = naverJeonse.length >= 1 ? median(naverJeonse.map((a) => a.numeric_price)) : null;
        const sMedian = naverSale.length >= 1 ? median(naverSale.map((a) => a.numeric_price)) : nearbyMedian;
        if (jMedian != null && sMedian && sMedian > 0) {
          jeonseRate = Math.round((jMedian / sMedian) * 1000) / 10;
        }
      }
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
            (a.trade_type_name === "매매" || a.trade_type_name === "sale" || !a.trade_type_name) &&
            (!a.created_at || a.created_at >= cutoff12m)
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
      (t) => t.deal_month >= cutoff6m && (t.trade_type === "매매" || !t.trade_type)
    );
    const recentTrades6m = recent6m.length || null;

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

    // 면적별 전세 시세
    const jeonse12m = guTrades.filter(
      t => t.deal_month >= cutoff12m && t.trade_type === "전세" && t.price > 0 && t.area > 0
    );
    const rentByArea = groupByArea(jeonse12m);

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
        const order = { "1-5층": 0, "6-15층": 1, "16층+": 2 };
        return (order[a[0]] ?? 9) - (order[b[0]] ?? 9);
      })
      .map(([group, prices]) => ({
        group,
        avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
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
      return gi && gi.region === apt.region && gi.gu === apt.gu;
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
      recentTrades6m == null
    ) {
      continue;
    }

    results.push({
      apartment_id: apt.id,
      nearby_median: nearbyMedian,
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

  log("summary", `nearby_median: ${withMedian.length}건`);
  log("summary", `pir: ${withPir.length}건 (평균 ${withPir.length ? (withPir.reduce((s, r) => s + r.pir, 0) / withPir.length).toFixed(1) : "N/A"}년)`);
  log("summary", `psr: ${withPsr.length}건 (평균 ${withPsr.length ? (withPsr.reduce((s, r) => s + r.psr, 0) / withPsr.length).toFixed(2) : "N/A"})`);
  log("summary", `jeonse_rate: ${withJeonse.length}건 (평균 ${withJeonse.length ? (withJeonse.reduce((s, r) => s + r.jeonse_rate, 0) / withJeonse.length).toFixed(1) : "N/A"}%)`);
  log("summary", `recent_trades_6m: ${withTrades.length}건`);
  log("summary", `dsr40pass: ${dsrUpdates.filter(d => d.dsr40pass).length}통과 / ${dsrUpdates.filter(d => !d.dsr40pass).length}미통과 (총 ${dsrUpdates.length}건)`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");

    if (withPir.length) {
      console.log("\nPIR 상위 10:");
      for (const r of withPir.sort((a, b) => b.pir - a.pir).slice(0, 10)) {
        const apt = apartments.find((a) => a.id === r.apartment_id);
        console.log(`  ${apt?.name ?? r.apartment_id}: PIR ${r.pir}년, PSR ${r.psr ?? "N/A"}, 전세가율 ${r.jeonse_rate ?? "N/A"}%`);
      }
    }

    if (withPir.length) {
      console.log("\nPIR 하위 10:");
      for (const r of withPir.sort((a, b) => a.pir - b.pir).slice(0, 10)) {
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

  const sbMibunyang2 = getMibuyangSupabase();
  const BATCH = 500;
  let upserted = 0;

  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH);
    const { error } = await sbMibunyang2
      .from("trade_stats")
      .upsert(batch, { onConflict: "apartment_id", ignoreDuplicates: false });

    if (error) {
      logError("upsert", `배치 ${i}~${i + batch.length}: ${error.message}`);
      // 개별 재시도
      for (const row of batch) {
        const { error: e2 } = await sbMibunyang2
          .from("trade_stats")
          .upsert([row], { onConflict: "apartment_id", ignoreDuplicates: false });
        if (!e2) upserted++;
      }
    } else {
      upserted += batch.length;
    }
  }

  log("done", `trade_stats 테이블 ${upserted}/${results.length}건 upsert 완료`);

  // 6. DSR 40% 통과 여부 → apartments 테이블 업데이트
  if (dsrUpdates.length > 0) {
    let dsrOk = 0;
    for (const { id, dsr40pass } of dsrUpdates) {
      const { error: e } = await sbMibunyang2
        .from("apartments")
        .update({ dsr40pass })
        .eq("id", id);
      if (!e) dsrOk++;
    }
    log("done", `apartments.dsr40pass ${dsrOk}/${dsrUpdates.length}건 업데이트 완료`);
  }
}

main().catch((err) => {
  logError("main", err.message);
  process.exit(1);
});
