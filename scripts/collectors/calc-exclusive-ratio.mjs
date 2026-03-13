/**
 * 전용률 계산기 — prices 테이블의 area/supply_area 기반
 *
 * exclusive_ratio = (전용면적 / 공급면적) * 100
 *
 * 사용법:
 *   node scripts/collectors/calc-exclusive-ratio.mjs              (Supabase UPDATE)
 *   node scripts/collectors/calc-exclusive-ratio.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError } from "./_shared.mjs";

loadEnv();

const PHASE = "excl-ratio";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 전용률이 없는 아파트
  const { data: apts, error: aErr } = await sb
    .from("apartments")
    .select("id, name, exclusive_ratio")
    .is("exclusive_ratio", null);
  if (aErr) throw new Error(`apartments 조회 실패: ${aErr.message}`);
  log(PHASE, `대상: ${apts.length}건 (exclusive_ratio null)`);

  if (!apts.length) { log(PHASE, "대상 없음, 종료"); return; }

  // prices 테이블에서 area, supply_area 조회
  const aptIds = apts.map(a => a.id);
  const { data: prices, error: pErr } = await sb
    .from("prices")
    .select("apartment_id, area, supply_area")
    .in("apartment_id", aptIds);
  if (pErr) throw new Error(`prices 조회 실패: ${pErr.message}`);

  // 아파트별 최신 가격 레코드
  const priceMap = {};
  for (const p of prices) {
    if (p.area && p.supply_area && p.supply_area > 0) {
      if (!priceMap[p.apartment_id]) priceMap[p.apartment_id] = p;
    }
  }

  let updated = 0, skipped = 0;

  for (const apt of apts) {
    const p = priceMap[apt.id];
    if (!p) { skipped++; continue; }

    const ratio = Math.round(p.area / p.supply_area * 100 * 10) / 10;

    if (dryRun) {
      log(PHASE, `  [DRY] ${apt.name}: ${p.area}/${p.supply_area} = ${ratio}%`);
      updated++;
      continue;
    }

    const { error } = await sb
      .from("apartments")
      .update({ exclusive_ratio: ratio, updated_at: new Date().toISOString() })
      .eq("id", apt.id);
    if (error) { logError(PHASE, `${apt.name}: ${error.message}`); skipped++; }
    else updated++;
  }

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped} ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
