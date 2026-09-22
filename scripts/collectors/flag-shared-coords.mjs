// @ts-check
/**
 * 좌표를 **남의 단지와 공유하는** 행에 표시를 단다 — `apartments.coord_shared` (세션560)
 *
 * ## 무엇이 문제인가
 * 지오코딩이 단지를 못 찾으면 구청·면사무소 같은 **대표 장소의 좌표**로 떨어진다. 그러면
 * 서로 다른 단지 여럿이 **소수점까지 똑같은 좌표**를 공유한다. 좌표가 틀리면 그 좌표로 재는
 * 것이 **전부** 틀린다 — 지하철·학교·병원·대기질 측정소까지.
 *
 * 세션539~542가 같은 결함 209곳을 고쳤지만, 남은 것들은 **아직 준공 전이라 지도에 없어서**
 * 정정 도구가 정답을 못 찾는다(2026-09-22 dry-run 1,860곳 → 정정 대상 0곳).
 *
 * ## 그래서 고치는 대신 **표시**한다 (사장님 확정 2026-09-22)
 * 손님이 "지하철 5분"을 사실로 믿고 판단하는 것을 막는 게 먼저다. 좌표를 **추측으로 옮기면**
 * 멀쩡한 값을 망친다(실증: 형제 행 좌표를 쓰려다 `금강펜테리움 6차`↔`7차` 같은 **별개 단지**를
 * 묶는 규칙이 나와 폐기했다).
 *
 * ## 판정은 **직접 하지 않는다** — 정정 도구의 덤프를 읽는다
 * ⚠️ 세션560에 이 판정을 직접 구현하려다 세 번 틀렸다(29 → 36 → 95자리로 출렁였다).
 * 이름에서 회차를 떼는 규칙이 미묘해서다: `신림스카이아파트14차`(회차)와
 * `금강펜테리움 6차 센트럴파크`(단지 차수)를 가르는 일은 이미 정정 도구가 풀어 둔 문제다.
 *
 * 그래서 이 수집기는 **`fix-placeholder-addresses.mjs --out=<덤프>` 결과를 입력으로 받는다.**
 * 그 도구의 `findTruePlaceholders` 가 진짜 판정자이고, 핵심 조건은 **`tier === "none"`**
 * (= 카카오 POI·청약홈 주소·네이버 단지 **세 출처가 모두 실패한 행**)이다. 같은 단지의
 * 회차 분리는 출처가 잡아 주므로 애초에 후보에 안 든다.
 *
 * ## 사용법
 *   node scripts/fix-placeholder-addresses.mjs --out=<덤프>          # ① 판정 (20분 안팎)
 *   node scripts/collectors/flag-shared-coords.mjs --from=<덤프>      # ② dry-run
 *   node scripts/collectors/flag-shared-coords.mjs --from=<덤프> --apply
 *
 * ⚠️ 경로는 **절대경로**로. Git Bash `/tmp` 와 node `resolve("/tmp")` 가 다른 폴더다.
 * ⚠️ 선행: `supabase/migrations/20260922000002_apartments_coord_shared.sql` 적용.
 */
import {
  loadEnv,
  log,
  logError,
  getSupabase,
  selectAll,
  createSemaphore,
  recordCollectorRun,
  createReporter,
} from "./_shared.mjs";
import { findTruePlaceholders } from "../fix-placeholder-addresses.mjs";
import { readFileSync } from "node:fs";

loadEnv();

const PHASE = "flag-shared-coords";

/**
 * 덤프에서 표시 대상 id 집합을 뽑는다.
 *
 * 판정은 정정 도구의 `findTruePlaceholders` 가 한다 — 이 함수는 덤프의 모양만 검사한다.
 *
 * @param {unknown} dump `--out=` 으로 저장된 JSON
 * @returns {Set<string>}
 */
export function flaggedFromDump(dump) {
  const d = /** @type {{ rows?: unknown; rosterSize?: unknown }} */ (dump);
  if (!d || !Array.isArray(d.rows)) {
    throw new Error("덤프 형식이 아닙니다 — rows 배열이 없습니다");
  }
  // 로스터가 통째로 비면 외부 API 가 죽은 회차다. 그걸로 표시를 내리면 안 된다(fail-close).
  if (typeof d.rosterSize === "number" && d.rosterSize === 0) {
    throw new Error("덤프의 로스터가 0건입니다 — 그 회차는 신뢰할 수 없습니다(fail-close)");
  }
  const rows = /** @type {Array<{ id: string; name: string; lat: number | null; lng: number | null; tier: string }>} */ (
    d.rows
  );
  return findTruePlaceholders(rows);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  if (!fromArg) {
    logError(PHASE, "--from=<덤프> 가 필요합니다 (fix-placeholder-addresses.mjs --out= 로 만든 JSON)");
    process.exit(1);
  }
  const path = fromArg.slice("--from=".length);

  /** @type {Set<string>} */
  let flagged;
  try {
    flagged = flaggedFromDump(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    logError(PHASE, `덤프를 읽지 못했습니다(${path}): ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }
  log(PHASE, `덤프 판정: 표시 대상 ${flagged.size}곳`);

  const sb = getSupabase();
  const rows = await selectAll((s) => s.from("apartments").select("id,coord_shared"), sb, "id");
  log(PHASE, `단지 ${rows.length}곳`);

  // 켤 것과 끌 것을 모두 본다 — 좌표가 고쳐지면 표시도 내려가야 한다.
  const updates = rows
    .map((r) => ({ id: r.id, next: flagged.has(r.id), prev: r.coord_shared === true }))
    .filter((x) => x.next !== x.prev);
  const on = updates.filter((x) => x.next).length;
  log(
    PHASE,
    `바꿀 것 ${updates.length}곳 (켬 ${on} / 끔 ${updates.length - on}) | 이미 맞음 ${rows.length - updates.length}`
  );

  if (!apply) {
    log(PHASE, "DRY-RUN 종료");
    return;
  }

  const rpt = createReporter(PHASE);
  const limit = createSemaphore(10);
  const CHUNK = 500;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    if (rpt.interrupted()) {
      log(PHASE, `중단 신호 — ${ok}곳까지 반영하고 멈춥니다`);
      break;
    }
    const results = await Promise.all(
      updates
        .slice(i, i + CHUNK)
        .map((u) =>
          limit(async () => sb.from("apartments").update({ coord_shared: u.next }).eq("id", u.id))
        )
    );
    // ⚠️ 보낸 수가 아니라 **돌아온 결과**에서 센다([[count-results-not-sent]] — 세션560 실사고).
    for (const r of results) {
      const err = /** @type {{ error?: { message?: string } | null }} */ (r)?.error;
      if (err) {
        if (!fail) logError(PHASE, `업데이트 실패 예시: ${err.message}`);
        fail++;
      } else ok++;
    }
  }
  rpt.success(ok);
  if (fail) rpt.fail(fail);
  rpt.skip(rows.length - updates.length);
  await recordCollectorRun(PHASE, rpt.summary());
  log(PHASE, `완료 — 반영 ${ok}곳${fail ? ` / 실패 ${fail}곳` : ""}`);
  if (fail) process.exitCode = 1;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((e) => {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
