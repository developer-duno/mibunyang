#!/usr/bin/env node
/**
 * backfill-presale-prices.mjs
 *
 * apartments.presale_min_price 값을 prices 테이블에 house_type='presale_min' 으로 복사한다.
 * price 커버리지 갭(세션86: 64.0%) 원인이 "수집은 됐으나 prices 테이블 미기록" 이라서
 * VIEW latest_prices CTE 가 이 값을 못 잡는 구조였음. 백필로 기존 513건을 즉시 복구한다.
 *
 * 사용:
 *   node scripts/backfill-presale-prices.mjs --dry-run    # 미리보기
 *   node scripts/backfill-presale-prices.mjs              # 실행
 *
 * 롤백:
 *   DELETE FROM prices WHERE house_type = 'presale_min';
 */
import { loadEnv, getSupabase, upsertBatch } from "./collectors/_shared.mjs";

loadEnv();

const dryRun = process.argv.includes("--dry-run");
const PHASE = "backfill-presale-prices";

function log(msg) {
  console.log(`[${PHASE}] ${msg}`);
}

async function main() {
  const sb = getSupabase();
  log(dryRun ? "DRY-RUN 모드" : "실행 모드");

  // presale_min_price 가 있는 아파트 전체 조회
  const { data: rows, error } = await sb
    .from("apartments")
    .select("id, presale_min_price, presale_pp")
    .not("presale_min_price", "is", null);

  if (error) {
    console.error(`[${PHASE}] apartments 조회 실패:`, error.message);
    process.exit(1);
  }

  log(`presale_min_price 보유 아파트: ${rows.length}건`);

  const today = new Date().toISOString().slice(0, 10);
  const priceRows = rows.map((r) => ({
    apartment_id: r.id,
    area: null,
    supply_area: null,
    price: r.presale_min_price,
    pp: r.presale_pp ?? null,
    house_type: "presale_min",
    supply_count: null,
    recorded_at: today,
  }));

  if (dryRun) {
    log(`[DRY-RUN] 저장 대상 ${priceRows.length}건 (recorded_at=${today})`);
    if (priceRows.length > 0) {
      log(`샘플 3건: ${JSON.stringify(priceRows.slice(0, 3), null, 2)}`);
    }
    return;
  }

  if (priceRows.length === 0) {
    log("백필 대상 없음");
    return;
  }

  log(`prices 테이블 upsert ${priceRows.length}건...`);
  await upsertBatch(
    "prices",
    priceRows,
    "apartment_id,house_type,recorded_at",
    500,
    sb,
  );
  log(`✅ 백필 완료 ${priceRows.length}건`);
}

main().catch((e) => {
  console.error(`[${PHASE}] 실패:`, e);
  process.exit(1);
});
