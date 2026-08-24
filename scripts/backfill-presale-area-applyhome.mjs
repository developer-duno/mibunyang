#!/usr/bin/env node
// @ts-check
/**
 * backfill-presale-area-applyhome.mjs
 *
 * 이미 저장된 `prices` 의 `presale_%` 행 중 **전용면적이 비어 있는 것**을, 같은 단지의 청약홈
 * 주택형 표(`applyhome_unit_supply`)에서 채운다. `backfill-presale-area.mjs`(네이버 `scale`
 * 경유)가 빈 응답을 받아 못 채운 단지들이 대상이다 — 네트워크 호출이 없어 DB 안에서 끝난다.
 *
 * 왜 필요한가 (세션532):
 *   세션531이 면적을 897 → 1,554곳으로 올렸지만 **176곳이 남았다**(손님 노출 1,730 기준 10.2%).
 *   면적이 없으면 `scorePrice` 가 평형별 실거래 버킷 경로를 못 타고 "구 전체 거래 중위 총액"과
 *   비교하는 폴백으로 떨어진다 — 그러면 괴리도가 "비싼가"가 아니라 **"큰가"** 를 잰다
 *   (`.claude/rules/meta/score-meaning-and-wording-are-a-pair.md` §세션531).
 *
 *   그 176곳을 갈라 보니 세 무리였다(2026-08-25 실측):
 *     ㉠ 75곳 — 가격 있음 + 청약홈 표 있음  → **이 스크립트가 채운다**
 *     ㉡ 33곳 — 가격이 아예 없음(prices 행 자체가 없음) + 청약홈 표 있음 → 별도 작업(승인 대기)
 *     ㉢ 68곳 — 청약홈 표 자체가 없음(재개발임대·정비사업 등 일반분양 아님) → 경로 미발견
 *
 * 어느 주택형을 고르는가 — **가격이 열쇠다** (이 스크립트의 핵심):
 *   한 단지에 주택형이 여럿이라(최대 16개 실측) "그 단지의 면적"을 하나 골라야 한다.
 *   `presale_min` 행의 price 는 최저가 주택형의 분양가이므로, 면적도 **같은 주택형**의 것이어야
 *   짝이 맞는다. 그런데 "청약홈에서 가장 싼 주택형"을 그냥 고르면 안 된다 — 두 표의 시점이
 *   달라(청약홈=분양 당시 전체 / 네이버=지금 남은 물량) 소형이 먼저 완판된 단지는 서로 다른
 *   집을 가리킨다. 이미 면적을 아는 1,395곳으로 두 방식을 대조한 결과(2026-08-25):
 *
 *     ㉮ 청약홈 최저 분양가 주택형   1㎡ 이내 일치 69.4% · 10㎡ 넘게 틀림 23.9%
 *     ㉯ price 에 가장 가까운 주택형  1㎡ 이내 일치 95.7% · 10㎡ 넘게 틀림  2.4%   ← 채택
 *
 *   ㉯는 **화면 분양가를 건드리지 않는다**(면적만 채운다)는 이점도 있다.
 *
 * 안 하는 것 (의도적):
 *   - price 가 없으면 **건너뛴다**. 열쇠가 없으면 ㉮로 떨어져 열에 셋이 틀리는데, 그 단지들은
 *     가격이 없어 괴리도 점수 자체가 안 나오므로 틀린 크기를 넣어 얻을 것이 없다(㉡ 무리).
 *   - 전용면적 상식 범위(20~250㎡) 밖은 버린다 — 계약면적 오입력·임대 행을 거른다
 *     (`naver-presale.mjs` 의 AREA_MIN_M2/AREA_MAX_M2 와 같은 기준).
 *   - `seed`(청약홈) 행이 있는 단지는 손대지 않는다 — VIEW 가 그쪽을 먼저 고르므로 화면 무관.
 *   - 과거 `recorded_at` 행은 손대지 않는다. VIEW 가 고르는 **가장 최근 행 하나만** 채운다.
 *
 * 사용:
 *   node scripts/backfill-presale-area-applyhome.mjs --dry-run     # 미리보기 (권장)
 *   node scripts/backfill-presale-area-applyhome.mjs --limit=10    # 소량 시험
 *   node scripts/backfill-presale-area-applyhome.mjs               # 전량 실행
 *
 *   ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *      (`.claude/rules/collectors/pipe-kills-collector.md`). 파일로 받아서 읽는다.
 *
 * 재실행 안전: 채워진 행은 대상에서 빠지므로 멱등하다. 중단해도 이어서 돌리면 된다.
 *
 * 롤백: **NULL 인 칸만** 채우므로 되돌릴 값이 없다. 되돌리려면 로그에 남은 row id 로
 *   `UPDATE prices SET area = NULL, supply_area = NULL WHERE id IN (...)`.
 */
import { loadEnv, getSupabase, sleep } from "./collectors/_shared.mjs";
import { fetchAllByCursor } from "./backfill-presale-area.mjs";

loadEnv();

const PHASE = "backfill-area-applyhome";

// 전용면적 상식 범위 — 계약면적 오입력·임대 행을 거른다(naver-presale.mjs 와 같은 기준).
const AREA_MIN_M2 = 20;
const AREA_MAX_M2 = 250;

/**
 * 저장가와 청약홈 분양가가 이 비율보다 벌어지면 **채우지 않는다**.
 *
 * 가격이 그만큼 어긋났다는 건 두 표가 같은 집을 가리키지 않는다는 뜻이라, 가장 가까운 주택형을
 * 골라도 남의 집 면적이 들어온다. 대조군(VIEW 가 고르는 행 중 면적 보유 518곳)에서 가격차이
 * 구간별 정확도를 재니 **30% 를 넘는 순간 절벽처럼 떨어졌다**(2026-08-25 실측):
 *
 *   가격차이  0~ 1%  n= 33  1㎡ 일치 87.9%  10㎡ 넘게 틀림  9.1%
 *   가격차이  1~ 5%  n= 74           86.5%                 8.1%
 *   가격차이  5~10%  n=198           92.9%                 3.5%
 *   가격차이 10~30%  n=171           93.6%                 3.5%   ← 여기까지 쓸 만하다
 *   가격차이 30~100% n= 31           38.7%                35.5%   ← 절벽
 *   가격차이 100%+   n= 11           18.2%                81.8%   ← 동전던지기보다 나쁘다
 *
 * 실제로 대상 88건 중 16건이 이 문턱에 걸린다(저장가 1,641 ↔ 청약홈 42,542 처럼 25배 벌어진
 * 건도 있다 — 임대 보증금이 분양가 자리에 들어온 것으로 보인다).
 *
 * ⚠️ 이 값을 옮기려면 위 표를 **다시 재고** 함께 옮긴다. 테스트가 관측값을 앵커로 잡고 있다.
 */
export const MAX_PRICE_GAP_RATIO = 0.3;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;

/** @param {string} msg */
function log(msg) {
  console.log(`[${PHASE}] ${msg}`);
}

/**
 * 청약홈 `house_ty` 는 0 패딩 + 뒤 공백이 붙은 문자열이다(예: `"059.9801 "`). 전용면적(㎡).
 *
 * ⚠️ 같은 행의 `supply_area` 는 **공급면적**이라 이 자리에 쓰면 안 된다 — 같은 행에서
 * 84.5775(공급) vs 59.9801(전용)로 1.41배 차이가 난다(2026-08-25 실측).
 *
 * @param {unknown} v
 * @returns {number | null} 상식 범위 안의 전용면적(㎡). 아니면 null.
 */
export function parseHouseTy(v) {
  if (v == null) return null;
  const n = parseFloat(String(v));
  if (!Number.isFinite(n) || n < AREA_MIN_M2 || n > AREA_MAX_M2) return null;
  return n;
}

/**
 * 청약홈 주택형 목록에서 **저장된 price 에 가장 가까운 분양가**의 주택형을 고른다.
 *
 * 가격을 열쇠로 쓰는 이유는 파일 첫머리 ㉮/㉯ 대조 참조. `price` 가 없으면 고를 근거가 없으므로
 * **null 을 돌려준다** — 여기서 "가장 싼 것"으로 폴백하면 열에 셋이 틀린 면적이 들어간다.
 *
 * 동률(같은 차이)이면 **싼 쪽**을 고른다 — `presale_min` 의 뜻과 같은 방향이고, 표의 행 순서에
 * 좌우되지 않아 재실행해도 같은 답이 나온다.
 *
 * @param {Array<{ house_ty?: unknown; top_amount?: unknown; supply_area?: unknown }>} rows
 * @param {unknown} price 저장된 분양가(만원)
 * @returns {{ area: number; supplyArea: number | null; matchedAmount: number; gap: number } | null}
 */
export function pickUnitByPrice(rows, price) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const p = Number(price);
  if (price == null || !Number.isFinite(p) || p <= 0) return null;

  /** @type {{ area: number; supplyArea: number | null; matchedAmount: number; gap: number } | null} */
  let best = null;
  for (const r of rows) {
    if (r == null || typeof r !== "object") continue;
    const area = parseHouseTy(r.house_ty);
    if (area == null) continue;
    const amt = Number(r.top_amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const gap = Math.abs(amt - p);
    // 더 가까우면 교체. 같은 거리면 싼 쪽(결정론적 — 행 순서에 안 흔들린다).
    if (best != null && !(gap < best.gap || (gap === best.gap && amt < best.matchedAmount))) continue;
    const supply = Number(r.supply_area);
    best = {
      area,
      supplyArea: Number.isFinite(supply) && supply > 0 ? supply : null,
      matchedAmount: amt,
      gap,
    };
  }
  return best;
}

/**
 * 백필 대상 선별 — **VIEW 가 실제로 고르는 행**만 고른다.
 *
 * `latest_prices` 는 `apartment_id` 별로 `(presale_% 가 뒤로, recorded_at DESC)` 순의 첫 행을
 * 쓴다. 그러니 `seed` 행이 하나라도 있으면 그쪽이 이기고, 없을 때만 `presale_%` 중 가장 최근
 * 행이 화면에 닿는다. 그 한 행만 채우면 충분하고, 과거 행을 건드리지 않아 안전하다.
 * (`backfill-presale-area.mjs` 의 `selectAreaBackfillTargets` 와 같은 규칙 — 그쪽은 네이버
 * 코드 유무로, 이쪽은 청약홈 표·price 유무로 거른다.)
 *
 * 순수 함수로 뽑아 둔 이유: DB 없이 회귀 가드를 걸기 위해서다.
 *
 * @param {Array<{ id: number; apartment_id: string; area: unknown; price: unknown; house_type: string | null; recorded_at: string | null }>} priceRows
 * @param {Map<string, Array<{ house_ty?: unknown; top_amount?: unknown; supply_area?: unknown }>>} supplyByApt
 * @returns {{
 *   targets: Array<{ rowId: number; aptId: string; price: number; area: number; supplyArea: number | null; matchedAmount: number; gap: number }>;
 *   alreadyFilled: number; seedWins: number; noSupply: number; noPrice: number; noMatch: number;
 *   farGap: number;
 * }}
 */
export function selectApplyhomeAreaTargets(priceRows, supplyByApt) {
  /** @type {Map<string, { seed: boolean; best: { id: number; area: unknown; price: unknown; recorded_at: string | null } | null }>} */
  const byApt = new Map();
  for (const r of priceRows) {
    const key = String(r.apartment_id);
    let e = byApt.get(key);
    if (!e) {
      e = { seed: false, best: null };
      byApt.set(key, e);
    }
    // presale_ 로 시작하지 않는 행(청약홈 seed 등)이 있으면 VIEW 는 그쪽을 고른다
    if (!String(r.house_type ?? "").startsWith("presale_")) {
      e.seed = true;
      continue;
    }
    if (e.best == null || String(r.recorded_at ?? "") > String(e.best.recorded_at ?? "")) {
      e.best = { id: r.id, area: r.area, price: r.price, recorded_at: r.recorded_at ?? null };
    }
  }

  /** @type {Array<{ rowId: number; aptId: string; price: number; area: number; supplyArea: number | null; matchedAmount: number; gap: number }>} */
  const targets = [];
  let alreadyFilled = 0;
  let seedWins = 0;
  let noSupply = 0;
  let noPrice = 0;
  let noMatch = 0;
  let farGap = 0;
  for (const [aptId, e] of byApt) {
    if (e.seed) {
      seedWins++;
      continue;
    }
    if (e.best == null) continue;
    const a = Number(e.best.area);
    if (Number.isFinite(a) && a > 0) {
      alreadyFilled++;
      continue;
    }
    const rows = supplyByApt.get(aptId);
    if (!rows || rows.length === 0) {
      noSupply++;
      continue;
    }
    const p = Number(e.best.price);
    if (e.best.price == null || !Number.isFinite(p) || p <= 0) {
      noPrice++;
      continue;
    }
    const picked = pickUnitByPrice(rows, e.best.price);
    if (picked == null) {
      noMatch++;
      continue;
    }
    // 가격이 너무 벌어졌으면 두 표가 같은 집을 안 가리킨다 — 채우지 않는다(MAX_PRICE_GAP_RATIO 주석).
    if (picked.gap / p > MAX_PRICE_GAP_RATIO) {
      farGap++;
      continue;
    }
    targets.push({ rowId: e.best.id, aptId, price: p, ...picked });
  }
  return { targets, alreadyFilled, seedWins, noSupply, noPrice, noMatch, farGap };
}

async function main() {
  const sb = getSupabase();
  log(dryRun ? "DRY-RUN 모드 (저장 안 함)" : "실행 모드");

  const priceRows =
    /** @type {Array<{ id: number; apartment_id: string; area: unknown; price: unknown; house_type: string | null; recorded_at: string | null }>} */ (
      await fetchAllByCursor(sb, "prices", "id, apartment_id, area, price, house_type, recorded_at", "id")
    );
  log(`prices ${priceRows.length}행 조회`);

  const supplyRows =
    /** @type {Array<{ apartment_id: string; house_ty: unknown; top_amount: unknown; supply_area: unknown }>} */ (
      await fetchAllByCursor(sb, "applyhome_unit_supply", "id, apartment_id, house_ty, top_amount, supply_area", "id")
    );
  /** @type {Map<string, Array<{ house_ty?: unknown; top_amount?: unknown; supply_area?: unknown }>>} */
  const supplyByApt = new Map();
  for (const r of supplyRows) {
    const key = String(r.apartment_id);
    let list = supplyByApt.get(key);
    if (!list) {
      list = [];
      supplyByApt.set(key, list);
    }
    list.push(r);
  }
  log(`applyhome_unit_supply ${supplyRows.length}행 · ${supplyByApt.size}단지 조회`);

  const { targets, alreadyFilled, seedWins, noSupply, noPrice, noMatch, farGap } = selectApplyhomeAreaTargets(
    priceRows,
    supplyByApt,
  );
  log(
    `대상 ${targets.length}건 | 이미 채워짐 ${alreadyFilled} | 청약홈 행 우선 ${seedWins} | ` +
      `청약홈 표 없음 ${noSupply} | 가격 없음 ${noPrice} | 유효 주택형 없음 ${noMatch} | ` +
      `가격 ${MAX_PRICE_GAP_RATIO * 100}% 초과 이격 ${farGap}`,
  );

  if (targets.length === 0) {
    log("백필 대상 없음 — 종료");
    return;
  }

  const slice = limit > 0 ? targets.slice(0, limit) : targets;
  log(`이번 실행 ${slice.length}건 (네트워크 호출 없음)`);

  // 문턱(30%)은 넘지 않았지만 10% 넘게 벌어진 건은 참고로 남긴다(그 구간 정확도 93.6%).
  const farOnes = slice.filter((t) => t.gap / t.price > 0.1);
  if (farOnes.length > 0) {
    log(`ⓘ 가격이 10~${MAX_PRICE_GAP_RATIO * 100}% 벌어진 건 ${farOnes.length}건 (그 구간 실측 정확도 93.6%)`);
  }

  let interrupted = false;
  const onSig = () => {
    interrupted = true;
    log("중단 신호 — 현재 건까지 마치고 종료");
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  let filled = 0;
  let failed = 0;
  for (let i = 0; i < slice.length; i++) {
    if (interrupted) break;
    const t = slice[i];
    const gapPct = ((t.gap / t.price) * 100).toFixed(1);
    if (dryRun) {
      log(
        `  [DRY] row ${t.rowId} ${t.aptId} ← 전용 ${t.area}㎡ / 공급 ${t.supplyArea ?? "-"} ` +
          `(저장가 ${t.price} ↔ 청약홈 ${t.matchedAmount}, 차이 ${gapPct}%)`,
      );
      filled++;
      continue;
    }
    const { error } = await sb
      .from("prices")
      .update({ area: t.area, supply_area: t.supplyArea })
      .eq("id", t.rowId);
    if (error) {
      failed++;
      console.error(`[${PHASE}] row ${t.rowId} 갱신 실패: ${error.message}`);
    } else {
      filled++;
      log(`  row ${t.rowId} ${t.aptId} ← 전용 ${t.area}㎡ (차이 ${gapPct}%)`);
    }
  }
  log(`${dryRun ? "[DRY-RUN] " : "✅ "}완료 — 채움 ${filled} · 실패 ${failed}${interrupted ? " · 중단됨" : ""}`);
  if (failed > 0) process.exitCode = 1;
  await sleep(0);
}

// CLI 직접 실행 시에만 main() 호출 (테스트가 순수 함수만 import 할 수 있게)
const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ e) => {
    console.error(`[${PHASE}] 실패:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
