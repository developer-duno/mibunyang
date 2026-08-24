#!/usr/bin/env node
// @ts-check
/**
 * backfill-presale-area.mjs
 *
 * 이미 저장된 `prices` 의 `presale_min` 행 중 **전용면적이 비어 있는 것**을 네이버 분양
 * 주택형 목록(`/api/complex/scale`)에서 채운다.
 *
 * 왜 필요한가 (세션531):
 *   `naver-presale.mjs` 가 만드는 `presale_min` 행은 `area: null` 이었다. 그래서 그 단지들은
 *   `apartments_flat.area` 가 비고, `scorePrice` 의 **평형별 실거래 버킷 경로를 못 타** "구 전체
 *   거래 중위 총액"과 비교되는 폴백으로 떨어진다. 그러면 괴리도가 "비싼가"가 아니라 **"큰가"**
 *   를 재게 된다. 같은 단지 892곳을 경로만 바꿔 잰 대조 실험(2026-08-24):
 *
 *     면적↔괴리도 상관   버킷 −0.097  vs  폴백 −0.699
 *     대형(115㎡+) 중앙   −35.6%       vs  폴백 −182.1%   ("3배 비싸다"로 채점)
 *
 *   손님 노출 1,730곳 중 **833곳(48.2%)** 이 이 폴백에 걸려 있었고, 그 결과 괴리도 점수가
 *   0점 39.9% + 만점 27.9% = **열에 일곱이 양 끝**으로 몰려 비교 엔진이 비교를 못 했다.
 *
 *   수집기는 이미 고쳤다(`pickScaleArea` + `resolveAreaInfo`). 이 스크립트는 **이미 저장된
 *   행**을 지금 채운다 — 다음 수집 회차를 기다리면 그때까지 손님이 틀린 점수를 본다.
 *
 * 안 하는 것 (의도적):
 *   - `scale` 이 빈 목록이면 **건너뛴다**. 역산·평당가 대체는 실측으로 기각했다
 *     (`pickScaleArea` JSDoc 의 "역산·다른 대체 경로" 절 참조). 모르는 걸 지어내지 않는다.
 *   - `seed`(청약홈) 행은 손대지 않는다 — 이미 area 가 100% 차 있고 VIEW 가 그쪽을 먼저 고른다.
 *   - 과거 `recorded_at` 행은 손대지 않는다. VIEW 가 고르는 **가장 최근 행 하나만** 채운다.
 *     옛 행의 price 는 그때의 최저가라 오늘 잰 주택형과 짝이 다를 수 있다.
 *
 * 사용:
 *   node scripts/backfill-presale-area.mjs --dry-run          # 미리보기 (권장)
 *   node scripts/backfill-presale-area.mjs --limit=20         # 소량 시험
 *   node scripts/backfill-presale-area.mjs                    # 전량 실행 (단지당 2초)
 *
 * 재실행 안전: 채워진 행은 대상에서 빠지므로 멱등하다. 중단해도 이어서 돌리면 된다.
 *
 * 롤백: 이 스크립트는 **NULL 인 칸만** 채우므로 되돌릴 값이 없다. 되돌리려면
 *   `UPDATE prices SET area = NULL, supply_area = NULL WHERE id IN (...)` (로그에 id 를 남긴다).
 */
import { loadEnv, getSupabase, sleep } from "./collectors/_shared.mjs";
import { fetchScaleData, pickScaleArea } from "./collectors/naver-presale.mjs";

loadEnv();

const PHASE = "backfill-presale-area";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;

/** @param {string} msg */
function log(msg) {
  console.log(`[${PHASE}] ${msg}`);
}

/**
 * 백필 대상 선별 — **VIEW 가 실제로 고르는 행**만 고른다.
 *
 * `latest_prices` 는 `apartment_id` 별로 `(presale_% 가 뒤로, recorded_at DESC)` 순의 첫 행을
 * 쓴다. 그러니 `seed` 행이 하나라도 있으면 그쪽이 이기고, 없을 때만 `presale_min` 중 가장
 * 최근 행이 화면에 닿는다. 그 한 행만 채우면 충분하고, 과거 행을 건드리지 않아 안전하다.
 *
 * 순수 함수로 뽑아 둔 이유: DB 없이 회귀 가드를 걸기 위해서다.
 *
 * @param {Array<{ id: number; apartment_id: string; area: unknown; house_type: string | null; recorded_at: string | null }>} priceRows
 * @param {Map<string, { no: unknown; seq: unknown; name: string | null }>} naverCodes
 * @returns {{ targets: Array<{ rowId: number; aptId: string; name: string; no: unknown; seq: unknown }>; alreadyFilled: number; noNaverCode: number; seedWins: number }}
 */
export function selectAreaBackfillTargets(priceRows, naverCodes) {
  /** @type {Map<string, { seed: boolean; best: { id: number; area: unknown; recorded_at: string | null } | null }>} */
  const byApt = new Map();
  for (const r of priceRows) {
    const key = String(r.apartment_id);
    let e = byApt.get(key);
    if (!e) { e = { seed: false, best: null }; byApt.set(key, e); }
    // presale_ 로 시작하지 않는 행(청약홈 seed 등)이 있으면 VIEW 는 그쪽을 고른다
    if (!String(r.house_type ?? "").startsWith("presale_")) { e.seed = true; continue; }
    // presale_ 중에서는 recorded_at 이 가장 늦은 행
    if (e.best == null || String(r.recorded_at ?? "") > String(e.best.recorded_at ?? "")) {
      e.best = { id: r.id, area: r.area, recorded_at: r.recorded_at ?? null };
    }
  }

  /** @type {Array<{ rowId: number; aptId: string; name: string; no: unknown; seq: unknown }>} */
  const targets = [];
  let alreadyFilled = 0;
  let noNaverCode = 0;
  let seedWins = 0;
  for (const [aptId, e] of byApt) {
    if (e.seed) { seedWins++; continue; }
    if (e.best == null) continue;
    const a = Number(e.best.area);
    if (Number.isFinite(a) && a > 0) { alreadyFilled++; continue; }
    const code = naverCodes.get(aptId);
    if (!code || code.no == null || code.seq == null || code.no === "" || code.seq === "") { noNaverCode++; continue; }
    targets.push({ rowId: e.best.id, aptId, name: code.name ?? "", no: code.no, seq: code.seq });
  }
  return { targets, alreadyFilled, noNaverCode, seedWins };
}

/**
 * 고유키(id) 커서로 전량 조회. 무정렬 `.range()` 반복은 1,000행 넘는 표에서 에러 없이 행을
 * 잃는다(.claude/rules/collectors/unordered-pagination-loses-rows.md) — `prices` 는 7,886행이다.
 *
 * @template T
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} table
 * @param {string} cols
 * @param {string} keyCol
 * @returns {Promise<T[]>}
 */
async function fetchAllByCursor(sb, table, cols, keyCol) {
  const PAGE = 1000;
  /** @type {T[]} */
  const rows = [];
  /** @type {string | number | null} */
  let cursor = null;
  for (;;) {
    let q = sb.from(table).select(cols).order(keyCol, { ascending: true }).limit(PAGE);
    if (cursor != null) q = q.gt(keyCol, cursor);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(.../** @type {T[]} */ (/** @type {unknown} */ (data)));
    if (data.length < PAGE) break;
    cursor = /** @type {string | number} */ (/** @type {any} */ (data[data.length - 1])[keyCol]);
  }
  return rows;
}

async function main() {
  const sb = getSupabase();
  log(dryRun ? "DRY-RUN 모드 (저장 안 함)" : "실행 모드");

  const priceRows = /** @type {Array<{ id: number; apartment_id: string; area: unknown; house_type: string | null; recorded_at: string | null }>} */ (
    await fetchAllByCursor(sb, "prices", "id, apartment_id, area, house_type, recorded_at", "id")
  );
  log(`prices ${priceRows.length}행 조회`);

  const apts = /** @type {Array<{ id: string; name: string | null; naver_presale_no: unknown; naver_presale_seq: unknown }>} */ (
    await fetchAllByCursor(sb, "apartments", "id, name, naver_presale_no, naver_presale_seq", "id")
  );
  /** @type {Map<string, { no: unknown; seq: unknown; name: string | null }>} */
  const naverCodes = new Map();
  for (const a of apts) naverCodes.set(String(a.id), { no: a.naver_presale_no, seq: a.naver_presale_seq, name: a.name });
  log(`apartments ${apts.length}건 조회`);

  const { targets, alreadyFilled, noNaverCode, seedWins } = selectAreaBackfillTargets(priceRows, naverCodes);
  log(`대상 ${targets.length}건 | 이미 채워짐 ${alreadyFilled} | 네이버 코드 없음 ${noNaverCode} | 청약홈 행 우선 ${seedWins}`);

  if (targets.length === 0) { log("백필 대상 없음 — 종료"); return; }

  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  log(`이번 실행 ${slice.length}건 (단지당 약 2초 — 예상 ${Math.ceil((slice.length * 2) / 60)}분)`);

  // 중단해도 그때까지 저장한 것은 남는다(행마다 즉시 UPDATE). 재실행하면 이어서 돈다.
  let interrupted = false;
  const onSig = () => { interrupted = true; log("중단 신호 — 현재 단지까지 마치고 종료"); };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  let filled = 0, empty = 0, failed = 0;
  for (let i = 0; i < slice.length; i++) {
    if (interrupted) break;
    const t = slice[i];
    if (i > 0 && i % 25 === 0) log(`  진행 ${i}/${slice.length} — 채움 ${filled} · 빈응답 ${empty} · 실패 ${failed}`);
    let picked = null;
    try {
      // DB 에서 온 코드라 타입이 unknown — `fetchScaleData` 가 Number() 로 검증하므로 여기서 좁힌다
      const no = /** @type {string | number | null | undefined} */ (t.no);
      const seq = /** @type {string | number | null | undefined} */ (t.seq);
      picked = pickScaleArea(await fetchScaleData(no, seq));
    } catch (e) {
      failed++;
      console.error(`[${PHASE}] ${t.aptId} scale 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!picked) { empty++; continue; }
    if (dryRun) {
      log(`  [DRY] row ${t.rowId} ${t.aptId} ← 전용 ${picked.area}㎡ / 공급 ${picked.supplyArea ?? "-"} | ${t.name}`);
      filled++;
      continue;
    }
    const { error } = await sb
      .from("prices")
      .update({ area: picked.area, supply_area: picked.supplyArea })
      .eq("id", t.rowId);
    if (error) {
      failed++;
      console.error(`[${PHASE}] row ${t.rowId} 갱신 실패: ${error.message}`);
    } else {
      filled++;
      log(`  row ${t.rowId} ${t.aptId} ← 전용 ${picked.area}㎡ | ${t.name}`);
    }
  }
  log(`${dryRun ? "[DRY-RUN] " : "✅ "}완료 — 채움 ${filled} · 빈응답(주택형 정보 없음) ${empty} · 실패 ${failed}${interrupted ? " · 중단됨" : ""}`);
  if (failed > 0) process.exitCode = 1;
  await sleep(0);
}

// CLI 직접 실행 시에만 main() 호출 (테스트가 selectAreaBackfillTargets 만 import 할 수 있게)
const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ e) => {
    console.error(`[${PHASE}] 실패:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
