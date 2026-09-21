// @ts-check
/**
 * 단지 몇 곳의 **월 1회 수집 파생값**만 다시 잰다 — 세션556.
 *
 * ## 왜 필요한가
 *
 * 좌표를 정정하면 파생값이 옛 좌표 기준으로 남는다. 매일 도는 것
 * (`transport`·`schools`·`infra` kakao 계열)은 `--purge-derived` 로 비우면 다음 날 채워지지만,
 * **월 1회 수집기는 비우면 최대 한 달 빈칸**이 된다:
 *
 * | 컬럼 | 수집기 | 주기 | 비우면 |
 * |---|---|---|---|
 * | `infra.police_dist` | `collect-police` | 매월 1일 | 최대 한 달 빈칸 · **`scoreRisk` 입력** |
 * | `infra.emergency_*` | `collect-emergency` | 로컬 러너 월간 | 최대 한 달 빈칸 |
 * | `apartments.noxious_dist` | `noxious` | 매월 3일 | **감점 0 = 반대 방향 거짓** → `refresh-noxious-one.mjs` 소관 |
 *
 * 그래서 비우지 않고 **그 자리에서 다시 잰다.** 수집기의 함수(`searchPolice`·`fetchEmergencyList`
 * ·`matchNearest`)를 **그대로 써서** 손으로 값을 만들지 않는다.
 *
 * ## 실측 사례 (세션556 — 좌표 8곳 정정 후)
 *
 *     판교TH212        police_dist  661m → 2,363m  (차이 1,702m)
 *     라펜트 힐         police_dist  1,183m → 172m (차이 1,011m)
 *     e편한세상 부평     police_dist  296m → 451m  (차이 155m)
 *
 * `police_dist` 는 `scoreRisk.ts:201` 의 점수 입력이라 **손님 점수가 틀어져 있었다.**
 *
 * ⚠️ 이 도구는 `--purge-derived` 의 **빈칸**이 아니라 **재측정**이다. 시간창
 * ([[purge-to-recollect-timing]])과 무관하게 언제 돌려도 된다 — 값이 비는 순간이 없다.
 *
 *   node scripts/refresh-infra-monthly-one.mjs <id> [<id> …]            # 미리보기
 *   node scripts/refresh-infra-monthly-one.mjs <id> [<id> …] --apply    # 반영 + 재조회 대조
 *   node scripts/refresh-infra-monthly-one.mjs --ids-file=<json> --apply
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY, KAKAO_KEY
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, getSupabase, sleep, log, logError } from "./collectors/_shared.mjs";
import { searchPolice } from "./collectors/collect-police.mjs";
import { fetchEmergencyList, matchNearest } from "./collectors/collect-emergency.mjs";

const PHASE = "refresh-infra-monthly";

/**
 * 한 단지의 경찰·응급의료를 다시 잰다.
 *
 * ⚠️ 검색이 실패하면 **그 항목은 손대지 않는다** — 옛 값이 틀렸어도 빈칸보다는 낫고,
 * 실패를 성공으로 세면 다음 회차가 건너뛴다(세션491 원칙과 같은 결).
 *
 * @param {{ id: string, name?: string|null, lat: unknown, lng: unknown }} apt
 * @param {any[]} facilities `fetchEmergencyList()` 결과 (전 단지 공용 — 한 번만 받는다)
 * @returns {Promise<{ police: { count: number, dist: number|null }|null, emergency: ReturnType<typeof matchNearest>|null }>}
 */
export async function remeasureOne(apt, facilities) {
  /** @type {{ count: number, dist: number|null }|null} */
  let police = null;
  try {
    police = await searchPolice(Number(apt.lat), Number(apt.lng));
  } catch (err) {
    logError(PHASE, `${apt.name ?? apt.id} 경찰: ${err instanceof Error ? err.message : String(err)}`);
  }
  /** @type {ReturnType<typeof matchNearest>|null} */
  let emergency = null;
  try {
    emergency = matchNearest(/** @type {any} */ (apt), facilities);
  } catch (err) {
    logError(PHASE, `${apt.name ?? apt.id} 응급: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { police, emergency };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const idsFileArg = argv.find((a) => a.startsWith("--ids-file="));
  /** @type {string[]} */
  let ids = argv.filter((a) => !a.startsWith("--"));
  if (idsFileArg) {
    const p = resolve(idsFileArg.slice("--ids-file=".length));
    if (!existsSync(p)) {
      logError(PHASE, `--ids-file 없음: ${p}`);
      process.exit(1);
    }
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    ids = Array.isArray(parsed) ? parsed : (parsed.ids ?? []);
  }
  if (ids.length === 0) {
    logError(PHASE, "단지 id 를 넘겨라 — 예: node scripts/refresh-infra-monthly-one.mjs ah-2026910198");
    process.exit(1);
  }

  loadEnv();
  const sb = getSupabase();
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 (dry-run) ===");

  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").in("id", ids);
  if (error) {
    logError(PHASE, `조회 실패: ${error.message}`);
    process.exit(1);
  }
  const { data: infra } = await sb.from("infra").select("*").in("apartment_id", ids);
  const before = new Map((infra ?? []).map((r) => [r.apartment_id, r]));

  log(PHASE, "응급의료 목록 조회 중…");
  // ⚠️ `fetchEmergencyList` 는 배열이 아니라 `{ facilities, apiCalls }` 를 준다(타입 검사가 잡음).
  const { facilities } = await fetchEmergencyList();
  log(PHASE, `응급의료 시설 ${facilities.length}건`);

  /** @type {Array<{ id: string, name: string, payload: Record<string, unknown> }>} */
  const plan = [];
  for (const apt of apts ?? []) {
    if (apt.lat == null || apt.lng == null) {
      logError(PHASE, `${apt.name ?? apt.id}: 좌표가 없어 건너뜀`);
      continue;
    }
    const { police, emergency } = await remeasureOne(apt, facilities);
    const b = before.get(apt.id);
    /** @type {Record<string, unknown>} */
    const payload = {};
    if (police) {
      payload.police = police.count;
      payload.police_dist = police.dist;
      log(PHASE, `${apt.name}  police_dist ${b?.police_dist ?? "-"} → ${police.dist ?? "null"}`);
    }
    if (emergency) {
      payload.emergency = emergency.count;
      payload.emergency_dist = emergency.dist;
      payload.emergency_name = emergency.name;
      payload.emergency_type = emergency.type;
      log(PHASE, `${apt.name}  emergency_dist ${b?.emergency_dist ?? "-"} → ${emergency.dist ?? "null"}`);
    }
    if (Object.keys(payload).length === 0) {
      logError(PHASE, `${apt.name ?? apt.id}: 둘 다 실패 — 건너뜀`);
      continue;
    }
    plan.push({ id: apt.id, name: String(apt.name ?? apt.id), payload });
    await sleep(250); // kakao rate limit
  }

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 (${plan.length}건) — 반영하려면 --apply ===`);
    return;
  }

  let ok = 0;
  for (const p of plan) {
    const { error: uErr } = await sb
      .from("infra")
      .update({ ...p.payload, updated_at: new Date().toISOString() })
      .eq("apartment_id", p.id);
    if (uErr) logError(PHASE, `${p.id}: ${uErr.message}`);
    else ok++;
  }
  log(PHASE, `\n반영: 성공 ${ok} · 실패 ${plan.length - ok}`);

  // 반영 직후 대조 — 로그가 아니라 DB 가 그 값인지 본다.
  const { data: after } = await sb.from("infra").select("apartment_id, police_dist, emergency_dist").in("apartment_id", plan.map((p) => p.id));
  const amap = new Map((after ?? []).map((r) => [r.apartment_id, r]));
  let mismatch = 0;
  for (const p of plan) {
    const a = amap.get(p.id);
    if ("police_dist" in p.payload && a?.police_dist !== p.payload.police_dist) {
      mismatch++;
      logError(PHASE, `대조 불일치 ${p.id} police_dist: 기대 ${p.payload.police_dist} · 실제 ${a?.police_dist}`);
    }
  }
  log(PHASE, `반영 직후 대조: 일치 ${plan.length - mismatch} · 불일치 ${mismatch}`);
  if (mismatch > 0) process.exit(1);
  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
