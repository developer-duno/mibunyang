// @ts-check
/**
 * 매물 수에서 흘러든 미분양 오염값 정리 (세션559 일회성)
 *
 * ## 무엇을 지우나
 * `apartments.unsold` 가 **총세대수보다 큰** 행. 미분양은 정의상 총세대수를 넘을 수 없으므로
 * 이 값들은 전부 `sync-naver-complex.mjs` 가 넣던 **네이버 매매 매물 수**다.
 *
 * 실측(2026-09-22): 81곳. 예시 —
 *   · 세종더샵예미지 L4블록: 1세대인데 미분양 18 (미분양률 1,800%)
 *   · 춘천 파밀리에 리버파크: 15세대인데 미분양 54
 *   · 에비뉴 청계 II: 5세대인데 미분양 24
 *
 * ## 왜 코드 수정만으로는 부족한가
 * `sync-naver-complex.mjs` 에서 미분양 기록을 제거했고(세션559),
 * `collect-unsold-kosis.mjs` 의 `shouldSkipKosisFill` 이 이제 KOSIS 공식 통계로 덮어쓰지만 —
 *   · 이미 DB 에 박힌 값은 **그대로 남는다**
 *   · `units <= 1` 인 19곳은 비례배분 분모가 없어 **KOSIS 도 못 채운다** (영영 오염값이 남는다)
 * 그래서 한 번 지워 준다. 지운 뒤 KOSIS 가 채울 수 있는 곳은 다음 회차에 채워지고,
 * 못 채우는 곳은 `unsold = null` = **"모른다"** 가 된다 — 틀린 값보다 정직하다.
 *
 * ## 미분양 == 매물수 지만 세대수 이내인 1,090곳은 왜 안 지우나
 * 그건 "오염"이라 단정할 수 없다. 진짜 미분양이 우연히 매물 수와 같을 수 있고,
 * 무엇보다 **지우면 그 자리가 `UNSOLD_UNKNOWN_SCORE`(40점, 위험 높음)가 되어**
 * 지금(평균 23.5점)보다 오히려 나쁘게 표시된다(세션559 실측).
 * 그 1,090곳은 KOSIS 가 다음 회차에 **공식 값으로 덮어쓴다** — 빈칸을 거치지 않는다.
 *
 * ## 사용법
 *   node scripts/cleanup-listing-based-unsold.mjs              (dry-run — 기본)
 *   node scripts/cleanup-listing-based-unsold.mjs --apply      (실제 반영)
 */
import { loadEnv, getSupabase, log, logError, selectAll } from "./collectors/_shared.mjs";

loadEnv();

const PHASE = "cleanup-unsold";

/**
 * 오염 판정 — 미분양이 총세대수를 넘으면 매물 수가 흘러든 것이다.
 *
 * ⚠️ `units` 나 `unsold` 가 null 이면 판정하지 않는다(모르는 것을 지우지 않는다).
 *
 * @param {{ units: number | null; unsold: number | null }} apt
 * @returns {boolean}
 */
export function isContaminatedUnsold(apt) {
  if (apt.units == null || apt.unsold == null) return false;
  if (apt.units <= 0) return false;
  return apt.unsold > apt.units;
}

async function main() {
  const apply = process.argv.includes("--apply");
  log(PHASE, apply ? "=== 실제 반영 모드 ===" : "=== DRY-RUN (반영하려면 --apply) ===");

  const sb = getSupabase();
  const rows = await selectAll(
    (s) => s.from("apartments").select("id, name, units, unsold, unsold_rate, naver_sell_count"),
    sb,
    "id"
  );

  /** @type {Array<{ id: string; name: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null }>} */
  const typed = /** @type {any} */ (rows);
  const targets = typed.filter(isContaminatedUnsold);

  log(PHASE, `전체 ${typed.length}곳 중 오염 ${targets.length}곳`);
  const sameAsListing = targets.filter((a) => a.naver_sell_count != null && a.unsold === a.naver_sell_count).length;
  log(PHASE, `  그중 매물 수와 정확히 일치: ${sameAsListing}곳 (= 매물 유래 확정)`);
  const tiny = targets.filter((a) => (a.units ?? 0) <= 1).length;
  log(PHASE, `  그중 units<=1 (KOSIS 도 못 채움, 지운 뒤 '모름'으로 남음): ${tiny}곳`);

  for (const a of targets.slice(0, 10)) {
    log(PHASE, `  ${a.name}: ${a.units}세대인데 미분양 ${a.unsold} (률 ${a.unsold_rate ?? "null"}%) 매물 ${a.naver_sell_count ?? "-"}`);
  }
  if (targets.length > 10) log(PHASE, `  … 외 ${targets.length - 10}곳`);

  if (!apply) {
    log(PHASE, "DRY-RUN 종료 — 반영하려면 --apply");
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const a of targets) {
    // unsold 와 unsold_rate 를 함께 null 로 — 한쪽만 지우면 두 필드가 서로 다른 시점을
    // 가리킨 채 그럴듯한 옛 비율이 화면·scoreRisk 에 계속 노출된다(세션538 지적과 같은 결).
    const { error } = await sb.from("apartments").update({ unsold: null, unsold_rate: null }).eq("id", a.id);
    if (error) {
      logError(PHASE, `${a.name}: ${error.message}`);
      fail++;
    } else {
      ok++;
    }
  }
  log(PHASE, `완료 — 정리 ${ok}곳 / 실패 ${fail}곳`);
  if (fail > 0) process.exit(1);
}

// CLI 판정은 이 저장소 관례를 따른다(collect-air-quality.mjs 등) — Windows 경로에서
// `file://` 비교가 어긋나므로 **파일명**으로 맞춘다.
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) {
  main().catch((e) => {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
