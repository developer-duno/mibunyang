#!/usr/bin/env node
// @ts-check
/**
 * backfill-completion-from-movein.mjs
 *
 * `apartments.completion` 중 **규약(YYYYMM)을 어긴 값**을, 무손실로 보존된 네이버 원문
 * `presale_move_in` 에서 복구한다.
 *
 * 왜 어긋났나 (세션530):
 *   수집기(`naver-presale.mjs`)가 `mvi_date.replace(/[-./]/g,"").slice(0,6)` 로 **검증 없이
 *   앞 6자를 잘라** `"2030 미정"` → `"2030 미"`, `"[1회]2026.06"` → `"[1회]20"` 을 저장했다.
 *   게다가 `completion` 만 "NULL 일 때만 갱신" 이라 한 번 잘린 값이 **영구 동결**된 반면
 *   `presale_move_in` 은 매회 갱신돼 둘이 드리프트했다. 그 깨진 값이 그대로 손님 화면에
 *   `"2030년  미월"` 로 나갔다.
 *
 *   수집기 쪽은 이미 고쳤다(`parsePresaleCompletion` + 동결 해제). 이 스크립트는 **이미
 *   저장된 행**을 지금 복구한다 — 네이버 목록에서 빠진 단지는 수집기가 다시 안 훑어
 *   자가 치유가 영영 안 닿기 때문이다.
 *
 * 안 고치는 것 (의도적):
 *   - 원문도 `"미정"` 이라 월을 알 수 없는 행 → 그대로 둔다. 모르는 걸 지어내지 않는다.
 *   - `completion` 이 이미 정상 YYYYMM 인 행 → 손대지 않는다. `presale_move_in` 과 어긋난
 *     행이 236건 있으나(입주예정일이 미뤄진 정상 사례 포함) 어느 쪽이 참인지는 이 결함과
 *     별개 문제라 범위 밖이다.
 *
 * 사용:
 *   node scripts/backfill-completion-from-movein.mjs --dry-run   # 미리보기 (권장)
 *   node scripts/backfill-completion-from-movein.mjs             # 실행
 *
 * 롤백:
 *   이 스크립트는 "규약을 어긴 값" 만 덮어쓰므로 되돌릴 원본은 `presale_move_in` 에 그대로
 *   남아 있다. 개별 되돌림이 필요하면 실행 로그의 `옛값` 을 그대로 UPDATE 하면 된다.
 */
import { loadEnv, getSupabase } from "./collectors/_shared.mjs";
import { isCompletionYm, parsePresaleCompletion } from "./collectors/naver-presale.mjs";

loadEnv();

const PHASE = "backfill-completion";
const dryRun = process.argv.includes("--dry-run");

/** @param {string} msg */
function log(msg) {
  console.log(`[${PHASE}] ${msg}`);
}

/**
 * 백필 대상 선별 — 규약을 어긴 `completion` 중 원문에서 월까지 확실히 읽히는 것만.
 *
 * 순수 함수로 뽑아 둔 이유: DB 없이 회귀 가드를 걸기 위해서다
 * (`backfill-completion-from-movein.test.mjs`).
 *
 * ⚠️ `missing`(NULL·빈값)과 `brokenUnrecoverable`(깨진 값)을 **갈라서** 센다. 뭉치면
 *    "복구 불가 418건" 처럼 보이는데 그 중 374건은 애초에 미수집이라 결함이 아니다 —
 *    수치 착시가 다음 세션의 오판을 부른다(.claude/rules/meta/tool-output-illusion-guard.md).
 *
 * @param {Array<{ id: string; name?: string | null; completion?: unknown; presale_move_in?: unknown }>} rows
 * @returns {{ targets: Array<{ id: string; name: string; from: unknown; to: string; raw: unknown }>; brokenUnrecoverable: number; missing: number }}
 */
export function selectBackfillTargets(rows) {
  /** @type {Array<{ id: string; name: string; from: unknown; to: string; raw: unknown }>} */
  const targets = [];
  let brokenUnrecoverable = 0;
  let missing = 0;
  for (const r of rows) {
    if (isCompletionYm(r.completion)) continue; // 이미 정상 → 손대지 않음
    const isMissing = r.completion == null || r.completion === "";
    const to = parsePresaleCompletion(r.presale_move_in);
    if (!to) {
      // 원문도 월 미상 → 지어내지 않는다
      if (isMissing) missing++;
      else brokenUnrecoverable++;
      continue;
    }
    targets.push({ id: r.id, name: r.name ?? "", from: r.completion ?? null, to, raw: r.presale_move_in });
  }
  return { targets, brokenUnrecoverable, missing };
}

/**
 * apartments 전량 조회 — **고유키(id) 커서**. 무정렬 `.range()` 반복은 1,000행 넘는 표에서
 * 에러 없이 행을 잃는다(.claude/rules/collectors/unordered-pagination-loses-rows.md).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @returns {Promise<Array<{ id: string; name: string | null; completion: unknown; presale_move_in: unknown }>>}
 */
async function fetchAllApartments(sb) {
  const PAGE = 1000;
  /** @type {Array<{ id: string; name: string | null; completion: unknown; presale_move_in: unknown }>} */
  const rows = [];
  /** @type {string | null} */
  let cursor = null;
  for (;;) {
    let q = sb
      .from("apartments")
      .select("id, name, completion, presale_move_in")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor != null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(
      .../** @type {Array<{ id: string; name: string | null; completion: unknown; presale_move_in: unknown }>} */ (
        /** @type {unknown} */ (data)
      ),
    );
    if (data.length < PAGE) break;
    cursor = /** @type {string} */ (data[data.length - 1].id);
  }
  return rows;
}

async function main() {
  const sb = getSupabase();
  log(dryRun ? "DRY-RUN 모드 (저장 안 함)" : "실행 모드");

  const rows = await fetchAllApartments(sb);
  log(`apartments 전량 ${rows.length}건 조회`);

  const { targets, brokenUnrecoverable, missing } = selectBackfillTargets(rows);
  log(`깨진 값 ${targets.length + brokenUnrecoverable}건 = 복구 가능 ${targets.length} + 복구 불가(원문도 월 미상) ${brokenUnrecoverable}`);
  log(`그 밖에 completion 미수집(NULL) ${missing}건 — 원문에도 월이 없어 손댈 것 없음(결함 아님)`);

  for (const t of targets) {
    log(`  ${t.id} ${JSON.stringify(t.from)} -> ${t.to}  (원문 ${JSON.stringify(t.raw)}) | ${t.name}`);
  }

  if (targets.length === 0) {
    log("백필 대상 없음 — 종료");
    return;
  }
  if (dryRun) {
    log("[DRY-RUN] 위 목록 미저장. 실제 반영하려면 --dry-run 없이 재실행");
    return;
  }

  // 행마다 값이 달라 배치 UPDATE 문법이 없다. upsert 우회는 NOT NULL(name) 때문에 불가
  // (세션527 실측) — 대상이 한 자릿수라 개별 UPDATE 로 충분하다.
  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    const { error } = await sb.from("apartments").update({ completion: t.to }).eq("id", t.id);
    if (error) {
      fail++;
      console.error(`[${PHASE}] ${t.id} 갱신 실패: ${error.message}`);
    } else {
      ok++;
    }
  }
  log(`✅ 백필 완료 — 성공 ${ok}건 / 실패 ${fail}건`);
  if (fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트가 selectBackfillTargets 만 import 할 수 있게)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ e) => {
    console.error(`[${PHASE}] 실패:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
