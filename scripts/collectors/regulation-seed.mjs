/**
 * 규제지역 시드 적용 — regulation-zones.json → apartments.is_regulated
 *
 * 사용법:
 *   node scripts/collectors/regulation-seed.mjs
 *   node scripts/collectors/regulation-seed.mjs --dry-run
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, log, ROOT } from "./_shared.mjs";

loadEnv();
const DRY = process.argv.includes("--dry-run");

async function main() {
  const sb = getSupabase();

  // 규제지역 JSON 로드
  const jsonPath = resolve(ROOT, "public/data/regulation-zones.json");
  const zones = JSON.parse(readFileSync(jsonPath, "utf8"));

  // "서울 강남구" 형태 → Set
  const regulated = new Set();
  for (const list of [zones["투기과열지구"], zones["조정대상지역"]]) {
    if (Array.isArray(list)) list.forEach(z => regulated.add(z));
  }

  log("regulation", `규제지역: ${regulated.size}개 시군구`);

  // 전체 아파트 조회
  const { data: apts, error } = await sb
    .from("apartments")
    .select("id, region, gu, is_regulated")
    .limit(10000);

  if (error) throw error;

  let updated = 0;
  for (const apt of apts) {
    const key = `${apt.region ?? ""} ${apt.gu ?? ""}`.trim();
    const shouldBeRegulated = regulated.has(key);

    // 이미 동일하면 건너뜀
    if (apt.is_regulated === shouldBeRegulated) continue;

    if (DRY) {
      log("dry", `${apt.id} (${key}) → is_regulated=${shouldBeRegulated}`);
      updated++;
      continue;
    }

    const { error: uErr } = await sb
      .from("apartments")
      .update({ is_regulated: shouldBeRegulated, updated_at: new Date().toISOString() })
      .eq("id", apt.id);

    if (uErr) {
      log("error", `${apt.id}: ${uErr.message}`);
    } else {
      updated++;
    }
  }

  log("regulation", `완료: ${updated}건 갱신`);
}

main().catch(e => { console.error(e); process.exit(1); });
