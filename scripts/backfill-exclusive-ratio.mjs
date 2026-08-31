// @ts-check
/**
 * backfill-exclusive-ratio.mjs — 전용률 빈칸 채우기 + 물리적 불가능값 정정 (세션537)
 *
 * `apartments.exclusive_ratio` 의 (A) 빈칸을 채우고, (B) 물리적으로 나올 수 없는 값을
 * 바로잡는다. 재료가 전부 DB 안에 있어 **외부 API 호출이 0회**다.
 *
 * 왜 필요한가:
 *   전용률은 상품성 점수의 한 축(우수 80%↑ / 양호 77%↑ / 보통 74%↑, EXCL_RATIO_TIERS)이다.
 *   비어 있으면 `sanitize` 가 60 으로 눌러 **최저 구간**에 떨어뜨린다(engine.ts L95, `_noExcl`).
 *   손님 화면 1,754곳 중 259곳(14.8%)이 그 상태였다.
 *
 *   더 나쁜 것은 "채워져 있는데 틀린" 값이다. 지금까지 전용률의 주 writer 는
 *   `sync-naver-complex.mjs` L444-451 로, 네이버 **매물**(articles)의 area2/area1 중앙값을
 *   쓴다. 그 단지 매칭이 세션536 이 밝힌 오염 경로(짝의 92.07%가 500m 밖)를 탄다.
 *
 * 세 출처를 맞대 확인한 것 (2026-08-31 라이브 실측):
 *   - 청약홈 계산값 ↔ prices 계산값 : 등급 일치 78.7% (n=621)
 *   - 청약홈 계산값 ↔ DB 저장값     : 등급 일치 52.4% (n=1,135) ← DB 값만 따로 논다
 *   ah-/ap- 로 갈라도 52% 로 같아 "매칭 대상이 달라서"가 아니다. 집계 방식(중앙값·평균·
 *   세대수가중·최다세대형·전용면적중앙) 5종을 바꿔도 51~53% 로 움직이지 않았다 —
 *   즉 "어느 주택형을 고르나"의 문제가 아니라 **저장값 쪽이 흔들린다**.
 *
 * 타당 범위 60~90% 의 근거 (자의적 선택이 아님):
 *   두 독립 출처(청약홈·prices)가 3%p 이내로 일치하는 538곳을 "신뢰 코어"로 두면
 *   min=61.2 · p1=65.7 · p50=74.8 · p99=81.0 · max=83.3 으로 매우 좁다.
 *   청약홈 주택형 11,048건 원시 분포도 p1=62.7 · p50=75.0 · max=91.6.
 *   전용률은 정의상 100% 를 넘을 수 없고(공급 = 전용 + 주거공용), 90%대는 공용면적이
 *   사실상 없다는 뜻이라 아파트에서 나오지 않는다.
 *
 *   경쟁 후보를 넣어 민감도를 봤다 — 대상 수(범위 밖 판정):
 *     55~95% → 51건 · 58~92% → 59건 · **60~90% → 64건** · 62~88% → 78건 · 65~85% → 132건
 *   65 부터 두 배로 뛰는데, 그 지점부터 **신뢰 코어(61.2~83.3)를 잡아먹기 시작**한다.
 *   60~90 은 신뢰 코어를 통째로 품으면서 명백한 오류만 걸러내는 완만한 구간이다.
 *
 * 안 하는 것 (의도적):
 *   - **타당 범위 안(60~90%)의 기존 값은 절대 건드리지 않는다.** 세션536 에서 사장님이 정한
 *     "기존 값은 불변" 원칙을 유지하고, 물리적으로 불가능한 값만 예외로 둔다. 재료와
 *     다르다는 것만으로는 우리 값이 틀렸다는 증거가 못 된다(세션536: 지울 뻔한 멀쩡한 값).
 *   - 계산값 자체가 타당 범위 밖이면 **버린다**. 재료도 틀릴 수 있다.
 *   - 두 재료가 서로 5%p 넘게 어긋나면 **보류**한다. 어느 쪽도 신뢰할 근거가 없다.
 *
 * 사용:
 *   node scripts/backfill-exclusive-ratio.mjs            # 미리보기(기본)
 *   node scripts/backfill-exclusive-ratio.mjs --apply    # 실제 반영
 *   node scripts/backfill-exclusive-ratio.mjs --limit=20 # 소량 확인
 *
 *   ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *      (`.claude/rules/collectors/pipe-kills-collector.md`). 파일로 받아서 읽는다.
 *
 * 재실행 안전: 채운 값은 타당 범위 안이라 다음 실행의 대상에서 빠진다(멱등).
 * ⚠️ 롤백 경로가 사실상 없다 (세션537 후속 감사): `log()` 는 `console.log` 라 파일·DB 어디에도
 *   남지 않고, `apartments` 에 변경 이력 테이블·트리거도 없다(`updated_at` 갱신뿐). 게다가
 *   `show()` 는 최대 15건만 찍으므로 정정 42건 중 27건은 콘솔에도 이전값이 안 남았다.
 *   → 다음에 이 스크립트를 쓸 땐 **실행 출력을 파일로 리다이렉트**해 두어라
 *     (`node scripts/backfill-exclusive-ratio.mjs --apply > backfill-$(date +%%Y%%m%%d).log 2>&1`).
 *   빈칸이던 것은 NULL 로 되돌리면 되지만, 정정분은 이전값을 알 수 없다.
 */
import { loadEnv, getSupabase, log, logError, selectAll } from "./collectors/_shared.mjs";

loadEnv();

const PHASE = "backfill-excl-ratio";

/** 전용률 타당 범위 하한(%) — 위 주석의 민감도 표 참조. @type {number} */
export const VALID_MIN = 60;
/** 전용률 타당 범위 상한(%) — 전용률은 정의상 100 미만, 90대는 공용면적 없음을 뜻함. @type {number} */
export const VALID_MAX = 90;
/** 두 재료가 이보다 크게 어긋나면 보류(%p). @type {number} */
export const MATERIAL_DISAGREE_MAX = 5;

/** 보류 사유 — 왜 안 건드렸는지를 숫자가 아니라 이름으로 남긴다. */
export const HOLD = {
  NO_MATERIAL: "재료 없음",
  MATERIAL_OUT_OF_RANGE: "재료가 타당 범위 밖",
  MATERIAL_DISAGREE: "두 재료가 서로 어긋남",
};

/**
 * 청약홈 주택형 코드에서 전용면적(㎡)을 뽑는다. 예: "084.9478B" → 84.9478
 * @param {unknown} houseTy
 * @returns {number | null}
 */
export function parseExclusiveArea(houseTy) {
  const m = String(houseTy ?? "").match(/^\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 전용률(%) = 전용면적 / 공급면적 * 100, 소수점 1자리.
 * @param {number | null | undefined} exclusive
 * @param {number | null | undefined} supply
 * @returns {number | null}
 */
export function ratioFrom(exclusive, supply) {
  if (!exclusive || !supply || exclusive <= 0 || supply <= 0) return null;
  return Math.round((exclusive / supply) * 1000) / 10;
}

/**
 * 물리적으로 말이 되는 전용률인가.
 * @param {number | null | undefined} v
 * @returns {boolean}
 */
export function isPlausible(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= VALID_MIN && v <= VALID_MAX;
}

/**
 * 중앙값. 극단 주택형 하나에 끌려가지 않도록 평균 대신 쓴다.
 * @param {number[]} xs
 * @returns {number | null}
 */
export function median(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * 한 아파트에 대해 무엇을 할지 판정한다. DB 접근 없는 순수 함수.
 *
 * @param {number | null | undefined} current  현재 저장값
 * @param {{ applyhome?: number[]; prices?: number | null }} mat  재료
 * @returns {{ action: "fill" | "fix" | "keep" | "hold"; value?: number; reason?: string }}
 */
export function decide(current, mat) {
  // 재료 정리 — 타당 범위 밖 후보는 애초에 버린다(재료도 틀릴 수 있다).
  const ahAll = (mat.applyhome ?? []).filter((v) => Number.isFinite(v));
  const ah = median(ahAll.filter(isPlausible));
  const px = isPlausible(mat.prices) ? /** @type {number} */ (mat.prices) : null;

  const cur = typeof current === "number" && current !== 0 ? current : null;
  const isEmpty = cur == null;

  // 재료가 하나도 없으면 손대지 않는다.
  if (ah == null && px == null) {
    // 원재료는 있었는데 전부 범위 밖이었다면 사유를 갈라 남긴다.
    const hadRaw = ahAll.length > 0 || (mat.prices != null && Number.isFinite(mat.prices));
    return { action: "hold", reason: hadRaw ? HOLD.MATERIAL_OUT_OF_RANGE : HOLD.NO_MATERIAL };
  }

  // 두 재료가 서로 크게 어긋나면 어느 쪽도 신뢰할 근거가 없다.
  if (ah != null && px != null && Math.abs(ah - px) > MATERIAL_DISAGREE_MAX) {
    return { action: "hold", reason: HOLD.MATERIAL_DISAGREE };
  }

  // 채택값 — 청약홈은 주택형 여럿의 중앙값이라 단지 대표성이 높다. prices 는 행 하나.
  const cands = /** @type {number[]} */ ([ah, px].filter((v) => v != null));
  const value = Math.round(/** @type {number} */ (median(cands)) * 10) / 10;

  if (isEmpty) return { action: "fill", value };

  // ⚠️ 여기가 이 스크립트의 핵심 경계다. 기존 값이 타당 범위 안이면 재료와 아무리 달라도
  //    건드리지 않는다(세션536 "기존 값 불변"). 범위 밖일 때만 고칠 근거가 성립한다.
  if (isPlausible(cur)) return { action: "keep" };

  return { action: "fix", value };
}

/** @param {ReturnType<typeof getSupabase>} sb */
async function fetchMaterials(sb) {
  /** @type {Map<string, number[]>} */
  const applyhome = new Map();
  const unitRows = await selectAll(
    (s) => s.from("applyhome_unit_supply").select("id, apartment_id, house_ty, supply_area"),
    sb,
    "id",
  );
  for (const r of /** @type {any[]} */ (unitRows)) {
    const v = ratioFrom(parseExclusiveArea(r.house_ty), r.supply_area);
    if (v == null) continue;
    if (!applyhome.has(r.apartment_id)) applyhome.set(r.apartment_id, []);
    (applyhome.get(r.apartment_id) ?? []).push(v);
  }

  /** @type {Map<string, number>} */
  const prices = new Map();
  const priceRows = await selectAll(
    (s) => s.from("prices").select("id, apartment_id, area, supply_area")
      .not("area", "is", null).not("supply_area", "is", null),
    sb,
    "id",
  );
  for (const p of /** @type {any[]} */ (priceRows)) {
    if (prices.has(p.apartment_id)) continue;
    const v = ratioFrom(p.area, p.supply_area);
    if (v != null) prices.set(p.apartment_id, v);
  }

  log(PHASE, `재료: 청약홈 ${applyhome.size}단지 (행 ${unitRows.length}) · prices ${prices.size}단지 (행 ${priceRows.length})`);
  return { applyhome, prices };
}

export async function main() {
  const apply = process.argv.includes("--apply");
  const limArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limArg ? Number(limArg.split("=")[1]) : Infinity;
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 (dry-run) — 반영하려면 --apply ===");

  const sb = getSupabase();
  const { applyhome, prices } = await fetchMaterials(sb);

  const apts = await selectAll(
    (s) => s.from("apartments").select("id, name, exclusive_ratio"),
    sb,
    "id",
  );
  log(PHASE, `아파트 ${apts.length}건 검사`);

  /** @type {{id: string, name: string, from: number|null, to: number}[]} */
  const fills = [];
  /** @type {{id: string, name: string, from: number|null, to: number}[]} */
  const fixes = [];
  /** @type {Record<string, number>} */
  const holds = {};
  let keeps = 0;

  for (const a of /** @type {any[]} */ (apts)) {
    const cur = a.exclusive_ratio == null ? null : Number(a.exclusive_ratio);
    const d = decide(cur, { applyhome: applyhome.get(a.id), prices: prices.get(a.id) ?? null });
    if (d.action === "keep") { keeps++; continue; }
    if (d.action === "hold") { holds[d.reason ?? "?"] = (holds[d.reason ?? "?"] ?? 0) + 1; continue; }
    const rec = { id: a.id, name: a.name, from: cur, to: /** @type {number} */ (d.value) };
    (d.action === "fill" ? fills : fixes).push(rec);
  }

  const holdTotal = Object.values(holds).reduce((s, n) => s + n, 0);
  log(PHASE, `\n판정: 채움 ${fills.length} · 정정 ${fixes.length} · 유지 ${keeps} · 보류 ${holdTotal}`);
  for (const [k, v] of Object.entries(holds)) log(PHASE, `  보류 - ${k}: ${v}건`);

  /**
   * @param {string} label
   * @param {{id: string, name: string, from: number|null, to: number}[]} rows
   */
  const show = (label, rows) => {
    if (!rows.length) return;
    log(PHASE, `\n--- ${label} ${rows.length}건 (최대 15건 표시) ---`);
    for (const r of rows.slice(0, 15)) {
      log(PHASE, `  ${String(r.name).slice(0, 26).padEnd(28)} ${r.from == null ? "(빈칸)" : String(r.from)} → ${r.to}%`);
    }
  };
  show("채움", fills);
  show("정정", fixes);

  const all = [...fills, ...fixes];
  const targets = limit === Infinity ? all : all.slice(0, limit);
  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 — 반영 대상 ${targets.length}건. 실행하려면 --apply ===`);
    return { fills: fills.length, fixes: fixes.length, keeps, holds };
  }

  let ok = 0, fail = 0;
  for (const t of targets) {
    const { error } = await sb.from("apartments")
      .update({ exclusive_ratio: t.to, updated_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) { logError(PHASE, `${t.name}(${t.id}): ${error.message}`); fail++; }
    else ok++;
  }
  log(PHASE, `\n=== 반영 완료: 성공 ${ok} · 실패 ${fail} ===`);
  return { fills: fills.length, fixes: fixes.length, keeps, holds, ok, fail };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
