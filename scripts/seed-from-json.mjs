/**
 * 초기 데이터 시딩 — apartments.json → Supabase 7개 테이블
 *
 * /public/data/apartments.json (1481건)을 Supabase에 분배 upsert.
 * 수집기들이 작동하려면 apartments 테이블에 기본 데이터가 필요.
 *
 * 사용법:
 *   node scripts/seed-from-json.mjs              (Supabase UPSERT)
 *   node scripts/seed-from-json.mjs --dry-run    (미리보기만)
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, upsertBatch, log, logError, ROOT } from "./collectors/_shared.mjs";

loadEnv();

const PHASE = "seed";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  // 1. JSON 로드
  const jsonPath = resolve(ROOT, "public/data/apartments.json");
  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  const items = raw.data || raw;
  log(PHASE, `JSON 로드: ${items.length}건`);

  if (!items.length) {
    logError(PHASE, "apartments.json이 비어있습니다");
    process.exit(1);
  }

  // 2. 테이블별 행 구성
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const aptRows = [];
  const priceRows = [];
  const infraRows = [];
  const schoolRows = [];
  const transportRows = [];
  const tradeStatRows = [];
  const regionMap = new Map();

  for (const d of items) {
    // apartments 테이블
    aptRows.push({
      id: d.id,
      name: d.name,
      dong: d.dong || null,
      gu: d.gu || null,
      region: d.region,
      lat: d.lat || null,
      lng: d.lng || null,
      builder: d.builder || null,
      units: d.units ?? 0,
      unsold: d.unsold ?? 0,
      unsold_rate: d.unsoldRate ?? null,
      completion: d.completion || null,
      updated_at: now,
    });

    // prices 테이블 (area, price, pp)
    if (d.price) {
      priceRows.push({
        apartment_id: d.id,
        area: d.area || null,
        price: d.price,
        pp: d.pp || null,
        house_type: "seed",
        recorded_at: today,
      });
    }

    // infra 테이블
    if (d.hospital != null || d.subwayDist != null) {
      infraRows.push({
        apartment_id: d.id,
        hospital: d.hospital ?? 0,
        mart: d.mart ?? 0,
        conv: d.conv ?? 0,
        cafe: d.cafe ?? 0,
        culture: d.culture ?? 0,
        bank: d.bank ?? 0,
        pharmacy: d.pharmacy ?? 0,
        park: d.park ?? 0,
        subway_dist: d.subwayDist ?? null,
        updated_at: now,
      });
    }

    // schools 테이블
    if (d.schoolScore != null) {
      schoolRows.push({
        apartment_id: d.id,
        school_score: d.schoolScore,
        school_grade: d.schoolGrade || null,
        updated_at: now,
      });
    }

    // transport 테이블
    if (d.busRoutes != null || d.icDist != null) {
      transportRows.push({
        apartment_id: d.id,
        bus_routes: d.busRoutes ?? 0,
        ic_dist: d.icDist ?? null,
        ktx_dist: d.ktxDist ?? null,
        updated_at: now,
      });
    }

    // trade_stats 테이블
    if (d.nearbyMedian != null || d.pir != null) {
      tradeStatRows.push({
        apartment_id: d.id,
        nearby_median: d.nearbyMedian ?? null,
        recent_trades_6m: d.recentTrades6m ?? null,
        jeonse_rate: d.jeonseRate ?? null,
        pir: d.pir ?? null,
        psr: d.psr ?? null,
        updated_at: now,
      });
    }

    // regions (지역별 중복 제거)
    if (d.popGrowth != null && d.region && !regionMap.has(d.region)) {
      regionMap.set(d.region, {
        region: d.region,
        gu: null,
        pop_growth: d.popGrowth,
        recorded_at: today,
      });
    }
  }

  const regionRows = [...regionMap.values()];

  log(PHASE, `분배: apartments=${aptRows.length}, prices=${priceRows.length}, infra=${infraRows.length}, schools=${schoolRows.length}, transport=${transportRows.length}, trade_stats=${tradeStatRows.length}, regions=${regionRows.length}`);

  if (dryRun) {
    log(PHASE, "[DRY-RUN] 샘플 apartment:");
    log(PHASE, JSON.stringify(aptRows[0], null, 2));
    log(PHASE, "[DRY-RUN] 샘플 price:");
    log(PHASE, JSON.stringify(priceRows[0], null, 2));
    log(PHASE, "=== DRY-RUN 완료 ===");
    return;
  }

  // 3. 순서대로 upsert (FK 의존성 → apartments 먼저)
  const sb = getSupabase();

  log(PHASE, "--- apartments upsert ---");
  await upsertBatch("apartments", aptRows, "id");

  log(PHASE, "--- prices upsert ---");
  // house_type="seed" 센티넬 값으로 UNIQUE 제약 정상 작동
  await upsertBatch("prices", priceRows, "apartment_id,house_type,recorded_at");

  log(PHASE, "--- infra upsert ---");
  await upsertBatch("infra", infraRows, "apartment_id");

  log(PHASE, "--- schools upsert ---");
  await upsertBatch("schools", schoolRows, "apartment_id");

  log(PHASE, "--- transport upsert ---");
  await upsertBatch("transport", transportRows, "apartment_id");

  log(PHASE, "--- trade_stats upsert ---");
  await upsertBatch("trade_stats", tradeStatRows, "apartment_id");

  log(PHASE, "--- regions ---");
  // 함수형 유니크 인덱스 (region, COALESCE(gu,''), recorded_at) 때문에
  // upsert onConflict 사용 불가 — 기존 데이터 삭제 후 insert
  const regionRegions = regionRows.map(r => r.region);
  const { error: delErr } = await sb
    .from("regions")
    .delete()
    .in("region", regionRegions)
    .is("gu", null)
    .eq("recorded_at", today);
  if (delErr) log(PHASE, `regions 기존 삭제 참고: ${delErr.message}`);

  let regionOk = 0;
  for (const r of regionRows) {
    const { error } = await sb.from("regions").insert([r]);
    if (error) {
      if (!error.message.includes("duplicate")) {
        logError(PHASE, `region ${r.region}: ${error.message}`);
      }
    } else {
      regionOk++;
    }
  }
  log(PHASE, `regions: ${regionOk}/${regionRows.length}건`);

  log(PHASE, "=== 시딩 완료 ===");
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
