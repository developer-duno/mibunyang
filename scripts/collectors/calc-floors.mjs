// @ts-check
/**
 * 층수 범위 계산 — max_floor → floors 텍스트
 *
 * 사용법:
 *   node scripts/collectors/calc-floors.mjs
 *   node scripts/collectors/calc-floors.mjs --dry-run
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log } from "./_shared.mjs";

loadEnv();
const DRY = process.argv.includes("--dry-run");

/**
 * @param {number | null | undefined} maxFloor
 * @returns {string | null}
 */
export function classifyFloors(maxFloor) {
  if (maxFloor == null || maxFloor <= 0) return null;
  if (maxFloor <= 5) return "저층(1~5F)";
  if (maxFloor <= 15) return "중층(6~15F)";
  if (maxFloor <= 25) return "고층(16~25F)";
  return "초고층(26F+)";
}

async function main() {
  const sb = getSupabase();

  // max_floor가 있고 floors가 없는 단지 조회 — 페이지네이션 1000 행/배치
  const PAGE_SIZE = 1000;
  const apts = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("apartments")
      .select("id, max_floor, floors")
      .not("max_floor", "is", null)
      .gt("max_floor", 0)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    apts.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const targets = apts.filter(a => !a.floors);
  log("calc-floors", `대상: ${targets.length}건 (전체 max_floor 보유: ${apts.length}건)`);

  if (DRY) {
    targets.slice(0, 5).forEach(a =>
      log("dry", `${a.id} → max_floor=${a.max_floor} → "${classifyFloors(a.max_floor)}"`)
    );
    return;
  }

  let updated = 0;
  for (const apt of targets) {
    const floors = classifyFloors(apt.max_floor);
    if (!floors) continue;

    const { error: uErr } = await sb
      .from("apartments")
      .update({ floors, updated_at: new Date().toISOString() })
      .eq("id", apt.id);

    if (uErr) {
      log("error", `${apt.id}: ${uErr.message}`);
    } else {
      updated++;
    }
  }

  log("calc-floors", `완료: ${updated}건 갱신`);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(e => { console.error(e); process.exit(1); });
