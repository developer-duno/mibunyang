// @ts-check
/**
 * 전용률 계산기 — prices 테이블의 area/supply_area 기반
 *
 * exclusive_ratio = (전용면적 / 공급면적) * 100
 *
 * 사용법:
 *   node scripts/collectors/calc-exclusive-ratio.mjs              (Supabase UPDATE)
 *   node scripts/collectors/calc-exclusive-ratio.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, selectAll, createReporter, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ apartment_id: string; area: number | null; supply_area: number | null }} PriceRow */

loadEnv();

const PHASE = "excl-ratio";

/**
 * 전용률 계산: (전용면적 / 공급면적) * 100, 소수점 1자리
 * @param {number | null | undefined} area
 * @param {number | null | undefined} supplyArea
 * @returns {number | null}
 */
export function calcRatio(area, supplyArea) {
  if (!area || !supplyArea || supplyArea <= 0) return null;
  return Math.round(area / supplyArea * 100 * 10) / 10;
}

export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  // 이 수집기는 run-naver-local.bat 5/6 단계라 GitHub Actions run 이 없다. 실행 기록이 없으면
  // "돌았는데 대상이 0" 과 "아예 안 돌았다" 를 구분할 방법이 아무 데도 없었다 (세션 495).
  const rpt = createReporter(PHASE);

  // 전용률이 없는 아파트 (selectAll: 1000행 제한 자동 페이지네이션)
  const apts = await selectAll(
    (s) => s.from("apartments")
      .select("id, name, exclusive_ratio")
      .is("exclusive_ratio", null),
    sb
  );
  log(PHASE, `대상: ${apts.length}건 (exclusive_ratio null)`);

  if (!apts.length) {
    log(PHASE, "대상 없음, 종료");
    // 대상 0건도 기록한다. ok=0·skip=0 이라 monitor ② 가 한 번 울릴 수 있는데,
    // 전용률이 빈 단지가 하나도 없다는 건 실제로 드문 상태라 한 번 보는 게 낫다
    // (applyhome-seed 가 같은 트레이드오프를 이미 수용 — monitor ⑤ 주석 참조).
    await recordCollectorRun(PHASE, rpt.summary());
    return;
  }

  // prices 테이블에서 area, supply_area 조회 (PostgREST URL ~8KB 제한 대비 150개 단위 청크)
  const aptIds = apts.map(a => a.id);
  const CHUNK = 150; // UUID 36자 × 150 ≈ 5.4KB, PostgREST URL 제한 내 안전 마진
  const prices = [];
  for (let i = 0; i < aptIds.length; i += CHUNK) {
    const chunk = aptIds.slice(i, i + CHUNK);
    const data = await selectAll(
      (s) => s.from("prices")
        .select("apartment_id, area, supply_area")
        .in("apartment_id", chunk),
      sb
    );
    prices.push(...data);
  }
  log(PHASE, `prices ${prices.length}건 조회 (${Math.ceil(aptIds.length / CHUNK)} 청크)`);

  // 아파트별 최신 가격 레코드
  /** @type {Record<string, PriceRow>} */
  const priceMap = {};
  for (const p of /** @type {PriceRow[]} */ (prices)) {
    if (p.area && p.supply_area && p.supply_area > 0) {
      if (!priceMap[p.apartment_id]) priceMap[p.apartment_id] = p;
    }
  }

  let updated = 0, skipped = 0, failed = 0;

  for (const apt of apts) {
    if (rpt.interrupted()) break;
    const p = priceMap[apt.id];
    if (!p) { skipped++; rpt.skip(); continue; }

    const ratio = calcRatio(p.area, p.supply_area);

    if (dryRun) {
      log(PHASE, `  [DRY] ${apt.name}: ${p.area}/${p.supply_area} = ${ratio}%`);
      updated++;
      rpt.success();
      continue;
    }

    const { error } = await sb
      .from("apartments")
      .update({ exclusive_ratio: ratio, updated_at: new Date().toISOString() })
      .eq("id", apt.id);
    // DB 오류는 건너뜀이 아니라 장애다. 옛 코드가 skipped 에 섞어 세는 바람에
    // "prices 가 없어서 못 함"(정상)과 "UPDATE 가 깨짐"(사고)이 한 숫자에 묻혔다.
    if (error) { logError(PHASE, `${apt.name}: ${error.message}`); failed++; rpt.fail(); }
    else { updated++; rpt.success(); }
  }

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped}, 장애 ${failed} ===`);
  await recordCollectorRun(PHASE, rpt.summary());
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
