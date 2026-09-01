// @ts-check
/**
 * fix-exclusive-ratio-outliers.mjs — 전용률 타당 범위 밖 저장값 24곳 정리 (세션538/539)
 *
 * `backfill-exclusive-ratio.mjs`(세션537)가 빈칸을 채우고 명백한 오염값(≥100 등)을 정정했다.
 * 그 뒤에도 `apartments.exclusive_ratio` 가 타당 범위(60~90%) 밖인데 **NULL 이 아닌** 저장값이
 * 24곳 남아 있다(60미만 22 · 90초과 2). 이 스크립트는 그 24곳만 대상으로, **근거가 있을 때만**
 * 정리한다 — 근거가 "낮아 보인다"뿐이면 건드리지 않는다(세션536 "지울 뻔한 멀쩡한 값").
 *
 * 세 갈래 판정 (순서대로 적용, 먼저 걸리는 것으로 확정):
 *
 *   규칙 1 — 재계산(fix): 같은 region+gu 이고 `applyhome_unit_supply.house_ty` 가 **정확히 같은**
 *     다른(또는 자기) 행들에서 ratioFrom(전용면적, 공급면적)을 구해 타당 범위 안인 것만 모아
 *     중앙값을 낸다. 그 중앙값이 타당 범위 안이면 채택 — 단, 자기 `prices` 재료가 타당 범위
 *     안인데 그 중앙값과 5%p 넘게 어긋나면 채택하지 않는다(두 독립 재료가 서로 다투면 어느
 *     쪽도 못 믿는다는 backfill-exclusive-ratio.mjs 의 원칙을 그대로 따른다).
 *
 *   규칙 2 — 비움(clear → NULL): 위에서 재계산되지 않았고, 다음 중 하나라도 참이면.
 *     (a) 저장값 ≥ 100 — 정의상 불가능(공급 = 전용 + 주거공용이므로 전용률은 항상 100 미만).
 *     (b) `presale_housing_type` 이 아파트 계열(아파트·주상복합)인데 값이 타당 범위 밖 —
 *         "아파트라고 알고 있는 물건에 아파트일 수 없는 값".
 *     (c) 자기 재료(청약홈·prices)가 있고 전부 타당 범위 안인데 저장값이 그 어느 것과도
 *         3%p 이상 다름 — 저장값만 따로 논다.
 *
 *   규칙 3 — 놔둠(keep): 그 외. 오피스텔처럼 재료 자체가 없거나(재료 있음 판정 불가)
 *     저장값이 재료와 가까우면 손대지 않는다.
 *
 * 실측(2026-09-01, 24곳 라이브 대조로 확정 — 재조사 불필요):
 *   재계산 12곳 — "현대 프라힐스 소사역 더프라임" 계열, 전부 48.5 → 73.4~73.6.
 *     (own applyhome_unit_supply 행은 있으나 supply_area 가 전부 null 이라 자기 재료로는
 *     계산 불가 — 같은 소사구·같은 house_ty 를 쓰는 다른 회차 단지들의 값을 빌려온다.)
 *   비움 7곳 — 전부 `presale_housing_type`="아파트"(규칙 2b) 또는 100(규칙 2a).
 *   놔둠 5곳 — 전부 `presale_housing_type`="오피스텔"이고 청약홈·prices 재료가 아예 없다
 *     (재료가 없으니 규칙 2c 도 못 걸고, 규칙 1 도 자기 house_ty 가 없어 그룹을 못 찾는다).
 *
 * 안 하는 것 (의도적):
 *   - 규칙 1~3 어디에도 안 걸리는 값은 그대로 둔다. "낮아 보인다"만으로는 근거가 못 된다.
 *   - 타당 범위 **안**의 기존 값은 애초에 이 스크립트의 대상이 아니다(24곳에 안 들어옴).
 *
 * ⚠️ 비운 7곳 중 1곳은 파이프라인이 곧 다시 채운다 — 알고 하는 일이다 (세션538 적대검증).
 *   `ap-6027488 아크로리츠카운티`는 자기 `prices` 재료(44.94/66.71 = 67.4%)를 갖고 있어,
 *   `calc-exclusive-ratio.mjs`(collect-naver-listings.yml 4번째 스텝, **매일 KST 04:00**)가
 *   다음 실행에서 67.4 를 쓴다. 그 수집기에는 이 스크립트의 "그룹 재료와 다투면 기각" 개념이
 *   없기 때문이다(값 게이트 60~90 은 67.4 를 통과시킨다).
 *   그래도 비우는 이유: 지금 저장된 50.7 은 **어느 재료와도 맞지 않는 근거 없는 값**이고,
 *   67.4 는 최소한 그 단지 자신의 분양가 기록에서 나온다. 즉 결과는 50.7 → 67.4 로 **개선**이며
 *   점수는 둘 다 같은 최저 구간(74 미만)이라 변화가 없다.
 *   남는 질문(청약홈 중앙 76.2 vs prices 67.4, 8.8%p 불일치 — 어느 쪽이 옳은가)은 이 스크립트가
 *   답할 수 없다. 그건 재료 품질 문제라 별건으로 남긴다.
 *   나머지 6곳은 안전하다 — prices 재료가 없거나(4곳), 값이 게이트 밖(루첸시아 93.9 > 90)이거나,
 *   네이버 경로가 유형·거리·재료 게이트에 막힌다(적대검증이 7곳 전부 시뮬레이션으로 확인).
 *
 * 사용:
 *   node scripts/fix-exclusive-ratio-outliers.mjs            # 미리보기(기본)
 *   node scripts/fix-exclusive-ratio-outliers.mjs --apply    # 실제 반영
 *
 *   ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *      (`.claude/rules/collectors/pipe-kills-collector.md`). 파일로 받아서 읽는다.
 *
 * 재실행 안전: 재계산된 값은 타당 범위 안이라, 비운 값은 NULL(대상 조건 `exclusive_ratio
 * IS NOT NULL` 을 벗어남)이라 둘 다 다음 실행의 대상에서 빠진다(멱등).
 *
 * ⚠️ `backfill-exclusive-ratio.mjs` 를 import 하면 그 파일 최상단의 `loadEnv()` 가 다시
 * 실행되지만, `loadEnv()`(_shared.mjs)는 이미 설정된 키를 덮어쓰지 않고 `getSupabase()`는
 * 클라이언트를 캐시하므로 두 번 호출돼도 부작용이 없다 — 계산 로직을 복제하지 않고 그대로
 * re-export 해 쓴다(그 파일 자체가 CLI 로 직접 실행되지 않는 한 `main()` 은 안 돈다).
 */
import {
  loadEnv, getSupabase, log, logError, selectAll,
  isPlausibleExclRatio, EXCL_RATIO_APT_LIKE_TYPES,
} from "./collectors/_shared.mjs";
import { ratioFrom, parseExclusiveArea, median } from "./backfill-exclusive-ratio.mjs";

loadEnv();

const PHASE = "fix-excl-ratio-outliers";

/** 규칙 1 — 자기 prices 재료가 그룹 중앙값과 이보다 크게(%p) 어긋나면 재계산을 기각한다. */
export const GROUP_DISAGREE_MAX = 5;
/** 규칙 2(c) — 저장값이 자기 재료 전부와 이만큼(%p) 이상 다르면 비운다. */
export const OWN_MATERIAL_DISAGREE_MIN = 3;

/** 비움 사유 — 왜 지웠는지를 숫자가 아니라 이름으로 남긴다. */
export const CLEAR_REASON = {
  GE_100: "저장값 100 이상(정의상 불가능)",
  APT_LIKE_OUT_OF_RANGE: "아파트 계열인데 저장값이 타당 범위 밖",
  DISAGREES_WITH_OWN_MATERIALS: "저장값이 자기 재료 전부와 따로 놈",
};

/**
 * 저장값이 이 스크립트의 대상(타당 범위 밖, non-null)인가.
 * @param {number | null | undefined} v
 * @returns {boolean}
 */
export function isOutlier(v) {
  return v != null && Number.isFinite(Number(v)) && !isPlausibleExclRatio(Number(v));
}

/**
 * 타당 범위 밖 저장값 하나에 대해 무엇을 할지 판정한다. DB 접근 없는 순수 함수.
 *
 * @param {number} current  현재 저장값(타당 범위 밖, non-null 전제 — isOutlier(current)===true)
 * @param {string | null | undefined} housingType  apartments.presale_housing_type
 * @param {{
 *   groupCandidates?: number[];   // 같은 region+gu+house_ty 매칭 청약홈 전용률(raw, 필터 전)
 *   ownApplyhome?: number[];      // 자기 applyhome_unit_supply 행에서 계산한 전용률(raw, 필터 전)
 *   ownPrice?: number | null;     // 자기 prices 재료(raw, 계산된 전용률 1개)
 * }} mat
 * @returns {{ action: "fix" | "clear" | "keep"; value?: number; reason?: string }}
 */
export function decideOutlier(current, housingType, mat) {
  // 규칙 1 — 재계산: 그룹(같은 region+gu+house_ty) 재료를 타당 범위로 걸러 중앙값을 낸다.
  const groupPlausible = (mat.groupCandidates ?? []).filter((v) => isPlausibleExclRatio(v));
  const groupMedian = median(groupPlausible);
  if (groupMedian != null) {
    const ownPx = isPlausibleExclRatio(mat.ownPrice) ? /** @type {number} */ (mat.ownPrice) : null;
    const conflict = ownPx != null && Math.abs(groupMedian - ownPx) > GROUP_DISAGREE_MAX;
    if (!conflict) {
      return { action: "fix", value: Math.round(groupMedian * 10) / 10 };
    }
  }

  // 규칙 2 — 비움
  if (current >= 100) {
    return { action: "clear", reason: CLEAR_REASON.GE_100 };
  }
  if (typeof housingType === "string" && EXCL_RATIO_APT_LIKE_TYPES.has(housingType)) {
    return { action: "clear", reason: CLEAR_REASON.APT_LIKE_OUT_OF_RANGE };
  }
  const ownAhAll = (mat.ownApplyhome ?? []).filter((v) => Number.isFinite(v));
  const ownAh = median(ownAhAll.filter((v) => isPlausibleExclRatio(v)));
  const ownPxMaterial = isPlausibleExclRatio(mat.ownPrice) ? /** @type {number} */ (mat.ownPrice) : null;
  const materials = /** @type {number[]} */ ([ownAh, ownPxMaterial].filter((v) => v != null));
  if (materials.length > 0 && materials.every((v) => Math.abs(current - v) >= OWN_MATERIAL_DISAGREE_MIN)) {
    return { action: "clear", reason: CLEAR_REASON.DISAGREES_WITH_OWN_MATERIALS };
  }

  // 규칙 3 — 놔둠
  return { action: "keep" };
}

/** @param {ReturnType<typeof getSupabase>} sb */
async function fetchData(sb) {
  const apts = await selectAll(
    (s) => s.from("apartments").select("id, name, exclusive_ratio, presale_housing_type, region, gu"),
    sb,
    "id",
  );
  const unitRows = await selectAll(
    (s) => s.from("applyhome_unit_supply").select("id, apartment_id, house_ty, supply_area"),
    sb,
    "id",
  );
  const priceRows = await selectAll(
    (s) => s.from("prices").select("id, apartment_id, area, supply_area")
      .not("area", "is", null).not("supply_area", "is", null),
    sb,
    "id",
  );
  return { apts, unitRows, priceRows };
}

/**
 * DB 조회 결과에서 그룹(region+gu+house_ty)·자기 재료 맵을 조립한다.
 * @param {any[]} apts
 * @param {any[]} unitRows
 * @param {any[]} priceRows
 */
function buildMaterials(apts, unitRows, priceRows) {
  const aptMeta = new Map(apts.map((a) => [a.id, a]));

  // 그룹 재료(raw) — region+gu+house_ty 매칭. isPlausibleExclRatio 필터는 decideOutlier 안에서.
  /** @type {Map<string, number[]>} */
  const groupMap = new Map();
  // 아파트별 자기 applyhome_unit_supply — house_ty 목록(그룹 조회용) + 전용률(raw, 자기재료용).
  /** @type {Map<string, { houseTys: string[]; ratios: number[] }>} */
  const ownAhByApt = new Map();

  for (const r of unitRows) {
    const meta = aptMeta.get(r.apartment_id);
    if (!meta) continue;
    const ratio = ratioFrom(parseExclusiveArea(r.house_ty), r.supply_area);

    if (!ownAhByApt.has(r.apartment_id)) ownAhByApt.set(r.apartment_id, { houseTys: [], ratios: [] });
    const own = /** @type {{ houseTys: string[]; ratios: number[] }} */ (ownAhByApt.get(r.apartment_id));
    own.houseTys.push(r.house_ty);
    if (ratio != null) own.ratios.push(ratio);

    if (ratio == null) continue;
    const key = `${meta.region}|${meta.gu}|${r.house_ty}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    /** @type {number[]} */ (groupMap.get(key)).push(ratio);
  }

  /** @type {Map<string, number>} */
  const ownPxByApt = new Map();
  for (const p of priceRows) {
    if (ownPxByApt.has(p.apartment_id)) continue;
    const v = ratioFrom(p.area, p.supply_area);
    if (v != null) ownPxByApt.set(p.apartment_id, v);
  }

  return { groupMap, ownAhByApt, ownPxByApt };
}

export async function main() {
  const apply = process.argv.includes("--apply");
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 (dry-run) — 반영하려면 --apply ===");

  const sb = getSupabase();
  const { apts, unitRows, priceRows } = await fetchData(sb);
  log(PHASE, `아파트 ${apts.length}건 · applyhome_unit_supply ${unitRows.length}행 · prices(면적있음) ${priceRows.length}행`);

  const { groupMap, ownAhByApt, ownPxByApt } = buildMaterials(apts, unitRows, priceRows);

  const targets = apts.filter((a) => isOutlier(a.exclusive_ratio));
  log(PHASE, `타당 범위(60~90%) 밖 저장값 ${targets.length}건 검사`);

  /** @type {{id: string, name: string, from: number, to: number}[]} */
  const fixes = [];
  /** @type {{id: string, name: string, from: number, reason: string}[]} */
  const clears = [];
  /** @type {{id: string, name: string, from: number, type: string | null}[]} */
  const keeps = [];

  for (const a of targets) {
    const own = ownAhByApt.get(a.id) ?? { houseTys: [], ratios: [] };
    const houseTys = [...new Set(own.houseTys)];
    /** @type {number[]} */
    let groupCandidates = [];
    for (const ht of houseTys) {
      const key = `${a.region}|${a.gu}|${ht}`;
      groupCandidates = groupCandidates.concat(groupMap.get(key) ?? []);
    }
    const ownPrice = ownPxByApt.get(a.id) ?? null;

    const current = Number(a.exclusive_ratio);
    const d = decideOutlier(current, a.presale_housing_type, {
      groupCandidates, ownApplyhome: own.ratios, ownPrice,
    });

    if (d.action === "fix") fixes.push({ id: a.id, name: a.name, from: current, to: /** @type {number} */ (d.value) });
    else if (d.action === "clear") clears.push({ id: a.id, name: a.name, from: current, reason: d.reason ?? "?" });
    else keeps.push({ id: a.id, name: a.name, from: current, type: a.presale_housing_type });
  }

  log(PHASE, `\n판정: 재계산 ${fixes.length} · 비움 ${clears.length} · 놔둠 ${keeps.length}`);

  log(PHASE, `\n--- 재계산 ${fixes.length}건 (전량) ---`);
  for (const r of fixes) log(PHASE, `  ${r.id} | ${String(r.name).slice(0, 30).padEnd(32)} ${r.from}% → ${r.to}%`);

  log(PHASE, `\n--- 비움 ${clears.length}건 (전량) ---`);
  for (const r of clears) log(PHASE, `  ${r.id} | ${String(r.name).slice(0, 30).padEnd(32)} ${r.from}% → NULL (${r.reason})`);

  log(PHASE, `\n--- 놔둠 ${keeps.length}건 (전량) ---`);
  for (const r of keeps) log(PHASE, `  ${r.id} | ${String(r.name).slice(0, 30).padEnd(32)} ${r.from}% (유형: ${r.type ?? "미상"})`);

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 — 반영 대상(재계산+비움) ${fixes.length + clears.length}건. 실행하려면 --apply ===`);
    return { fixes: fixes.length, clears: clears.length, keeps: keeps.length };
  }

  let ok = 0, fail = 0;
  for (const r of fixes) {
    const { error } = await sb.from("apartments")
      .update({ exclusive_ratio: r.to, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { logError(PHASE, `[재계산] ${r.name}(${r.id}): ${error.message}`); fail++; }
    else ok++;
  }
  for (const r of clears) {
    const { error } = await sb.from("apartments")
      .update({ exclusive_ratio: null, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { logError(PHASE, `[비움] ${r.name}(${r.id}): ${error.message}`); fail++; }
    else ok++;
  }
  log(PHASE, `\n=== 반영 완료: 성공 ${ok} · 실패 ${fail} ===`);
  return { fixes: fixes.length, clears: clears.length, keeps: keeps.length, ok, fail };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
