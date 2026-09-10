// @ts-check
/**
 * 전남광주통합특별시(2026-07-01) 코드 전환에 따른 **저장 데이터 재매핑** — 세션545 PR-E §2.
 *
 * 코드표(`_shared.mjs`)를 새 코드로 바꾸는 것만으로는 **이미 저장된 값**이 안 따라온다.
 * 이 도구가 그 다섯 자리를 옮기고, 통합 이름으로 박힌 region 을 갈라 붙이고,
 * "경기 광주시" 를 "광주광역시" 로 오라벨한 잔재를 정리한다.
 *
 * 기본은 **dry-run**(읽기만). 쓰기는 `--apply` 를 줄 때만.
 *
 *   node scripts/remap-jeonnam-gwangju-codes.mjs                 # 계획만 출력
 *   node scripts/remap-jeonnam-gwangju-codes.mjs --out=<절대경로> # 계획을 JSON 으로 저장
 *   node scripts/remap-jeonnam-gwangju-codes.mjs --apply         # 실제 쓰기 + 재조회 검증
 *
 * ⚠️ `--out` 은 **절대경로**로. Git Bash `/tmp` 는 node `resolve` 와 다른 폴더를 가리킨다.
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { writeFileSync } from "node:fs";
import {
  loadEnv, getSupabase, log, logError, selectAll,
  JEONNAM_GWANGJU_SGG_OLD_TO_NEW, resolveRegionName,
} from "./collectors/_shared.mjs";

const PHASE = "remap-jn-gj";

/** 재매핑 대상이 되는 `apartments.region` 값 */
export const TARGET_REGIONS = new Set(["전남", "광주", "전남광주통합특별시"]);

/** 통합 시도 이름이 그대로 박힌 region 값 */
export const MERGED_SIDO_NAME = "전남광주통합특별시";

/**
 * (d) `trades` 삭제 fail-close 임계 — 삭제 대상 행의 **경기 쪽 쌍둥이 존재율**이
 * 이 값 미만이면 아무것도 지우지 않는다. 지우려는 근거가 "같은 거래를 두 번 긁었다" 이므로,
 * 쌍둥이가 없으면 그 근거 자체가 무너진다.
 */
export const TWIN_RATIO_MIN = 0.99;

/**
 * (e) 손으로 확인한 **한 곳** — 추측 금지, id 를 못 박는다.
 *
 * ⚠️ 세션545 스펙 초안은 `ah-2026910190`(A8블록)도 같이 넣었다. 189 만 확인하고 190 을
 * "같은 지구니까 같겠지" 로 넘긴 것이고, 2차 리뷰 중 실측에서 **틀렸다**:
 *   · 189(A7블록) 주소 = "… 북구 월출동" · 카카오 좌표 = 북구 월출동 → 광주/북구 ✅
 *   · 190(A8블록) 주소 = "… **장성군 진원면**" → 전남 장성군. DB region 도 이미 "전남" 이라
 *     광주/북구로 바꾸면 **맞는 값을 틀린 값으로 덮는다**.
 * 게다가 둘의 좌표가 **소수 13자리까지 동일**(35.2411705241485, 126.864718064904)이라
 * 190 의 좌표는 189 것이 복사된 자리표시 의심이다 — 좌표부터 정해야 gu 를 정할 수 있다.
 * 그래서 190 은 **이 도구가 건드리지 않고** BACKLOG 로 넘긴다(placeholder-coordinates 계열).
 */
export const GU_FIX_IDS = ["ah-2026910189"];

/** `.in("id", […])` 한 번에 싣는 id 수 — URL 길이 제한 여유. */
export const ID_CHUNK = 150;

/**
 * @typedef {{ id: string, region: string | null, gu: string | null, address: string | null, bjd_code: string | null }} AptRow
 * @typedef {{ id: number | string, region: string | null, gu: string | null, deal_month: string | null, area: number | null, price: number | null, floor: number | null, trade_type: string | null }} TradeRow
 */

// ── (a) apartments.bjd_code 앞 5자리 ────────────────────────────
/**
 * @param {AptRow[]} rows
 * @returns {{ updates: Array<{id: string, from: string, to: string}>, manual: Array<{id: string, bjd_code: string, region: string | null}> }}
 */
export function planBjdRemap(rows) {
  /** @type {Array<{id: string, from: string, to: string}>} */
  const updates = [];
  /** @type {Array<{id: string, bjd_code: string, region: string | null}>} */
  const manual = [];
  // (c) 가 경기로 되돌릴 행은 여기서 뺀다. region 이 "광주" 로 **오라벨**돼 있을 뿐
  // bjd_code(41610…)는 이미 맞는 값이라, 안 빼면 "표에 없는 앞5" 로 5곳이 가짜 보고된다.
  const willBecomeGyeonggi = new Set(planGyeonggiGwangju(rows).map((x) => x.id));
  for (const r of rows) {
    if (!r.region || !TARGET_REGIONS.has(r.region)) continue;
    if (willBecomeGyeonggi.has(r.id)) continue;
    const bjd = r.bjd_code;
    if (!bjd || bjd.length < 5) continue;
    const head = bjd.slice(0, 5);
    if (head.startsWith("12")) continue; // 이미 새 코드
    const next = JEONNAM_GWANGJU_SGG_OLD_TO_NEW[head];
    if (!next) {
      // 표에 없는 앞5 = 다른 시도 코드가 박힌 것(좌표 재정합 대상) — **건드리지 않는다**.
      manual.push({ id: r.id, bjd_code: bjd, region: r.region });
      continue;
    }
    updates.push({ id: r.id, from: bjd, to: next + bjd.slice(5) });
  }
  return { updates, manual };
}

// ── (b) apartments.region 이 통합 이름 그대로 ───────────────────
/**
 * @param {AptRow[]} rows
 * @returns {{ updates: Array<{id: string, gu: string | null, to: string}>, skipped: Array<{id: string, gu: string | null}> }}
 */
export function planRegionSplit(rows) {
  /** @type {Array<{id: string, gu: string | null, to: string}>} */
  const updates = [];
  /** @type {Array<{id: string, gu: string | null}>} */
  const skipped = [];
  for (const r of rows) {
    if (r.region !== MERGED_SIDO_NAME) continue;
    const to = resolveRegionName(MERGED_SIDO_NAME, r.gu);
    if (to) updates.push({ id: r.id, gu: r.gu, to });
    else skipped.push({ id: r.id, gu: r.gu }); // gu 가 비어 못 가름 — 사람이 본다
  }
  return { updates, skipped };
}

// ── (c) 경기 광주시가 광주광역시로 오라벨 ───────────────────────
/**
 * `parsePresaleAddress` 의 옛 전수 순회(`address.includes("광주")`)가 만든 잔재.
 * 주소가 "경기도" 로 시작하는 것만 — 주소를 못 믿는 행은 손대지 않는다.
 * @param {AptRow[]} rows
 * @returns {Array<{id: string, address: string, from: string}>}
 */
export function planGyeonggiGwangju(rows) {
  return rows
    .filter(
      (r) =>
        r.region === "광주" &&
        r.gu === "광주시" &&
        typeof r.address === "string" &&
        r.address.startsWith("경기도"),
    )
    .map((r) => ({ id: r.id, address: String(r.address), from: "광주" }));
}

// ── (e) gu 가 지구 이름으로 박힌 두 곳 ──────────────────────────
/**
 * @param {AptRow[]} rows
 * @param {string[]} [ids]
 * @returns {Array<{id: string, fromRegion: string | null, fromGu: string | null}>}
 */
export function planGuFix(rows, ids = GU_FIX_IDS) {
  const want = new Set(ids);
  return rows
    .filter((r) => want.has(r.id))
    .map((r) => ({ id: r.id, fromRegion: r.region, fromGu: r.gu }));
}

// ── (d) trades 중복 행 ─────────────────────────────────────────
/**
 * 고유키에서 region·gu 를 뺀 나머지 — 같은 거래인지 판정하는 열쇠.
 * @param {TradeRow} r
 * @returns {string}
 */
export function tradeTwinKey(r) {
  return [r.deal_month, r.area, r.price, r.floor, r.trade_type].join("|");
}

/**
 * 삭제 대상(광주:광주시)마다 경기:광주시 쪽에 같은 거래가 있는지 센다.
 *
 * `region` 이 고유키(`region,gu,deal_month,area,price,floor,trade_type`)에 들어 있어
 * "경기" 로 relabel 하면 기존 경기 행과 충돌한다. 그래서 삭제가 정답인데, 그 전제는
 * **경기 쪽에 같은 거래가 이미 있다**는 것이다. 그 전제를 여기서 실측한다.
 *
 * ⚠️ **쌍둥이가 없는 행까지 지우지 않는다.** 옛 판본은 `--apply` 에서
 * `.delete().eq("region","광주").eq("gu","광주시")` 로 조건 전체를 통째로 지웠는데,
 * 그러면 쌍둥이가 없는 행(= 경기 쪽에 같은 거래가 **없는** 행)도 함께 사라진다.
 * 그 행들은 중복이 아니라 **경기 광주시 거래가 광주로 오라벨된 유일본**이므로,
 * 지우는 게 아니라 `region` 을 경기로 되돌리는 게 맞다. 그래서 id 를 갈라 돌려준다.
 *
 * @param {TradeRow[]} targets 광주:광주시 행
 * @param {TradeRow[]} gyeonggi 경기:광주시 행
 * @returns {{ total: number, twins: number, ratio: number, passes: boolean, missing: string[],
 *   twinIds: Array<number|string>, nonTwinIds: Array<number|string> }}
 */
export function computeTwinRatio(targets, gyeonggi) {
  const have = new Set(gyeonggi.map(tradeTwinKey));
  /** @type {string[]} */
  const missing = [];
  /** @type {Array<number|string>} */
  const twinIds = [];
  /** @type {Array<number|string>} */
  const nonTwinIds = [];
  let twins = 0;
  for (const t of targets) {
    const k = tradeTwinKey(t);
    if (have.has(k)) { twins++; twinIds.push(t.id); }
    else { missing.push(k); nonTwinIds.push(t.id); }
  }
  const total = targets.length;
  const ratio = total === 0 ? 0 : twins / total;
  return {
    total, twins, ratio, passes: total > 0 && ratio >= TWIN_RATIO_MIN, missing,
    twinIds, nonTwinIds,
  };
}

// ── 쓰기 보조 ──────────────────────────────────────────────────
/**
 * id 목록을 청크로 나눈다 — `.in("id", […])` 한 번에 너무 많이 실으면 URL 길이 제한에 걸린다.
 * @param {Array<number|string>} ids
 * @param {number} [size]
 * @returns {Array<Array<number|string>>}
 */
export function chunkIds(ids, size = ID_CHUNK) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunkIds: size 는 1 이상 정수여야 한다 (받은 값 ${size})`);
  /** @type {Array<Array<number|string>>} */
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * 되읽기 검증 — 남으면 안 되는 잔여를 문장으로 돌려준다(빈 배열 = 통과).
 *
 * ⚠️ `leftD` 가 null/undefined 면 **실패**다. Supabase 의 `head:true` 조회는 표가 없거나
 * 조회가 어긋나도 `count: null` 을 조용히 돌려준다 — 그걸 `?? 0` 으로 받으면
 * "0건 남음 = 성공" 으로 뒤집혀 읽힌다(probe-must-be-self-verified §4-1).
 *
 * @param {{ leftA: number, leftB: number, leftC: number, leftE: number,
 *   leftD: number | null | undefined, tradesApplied: boolean }} r
 * @returns {string[]}
 */
export function verifyResiduals(r) {
  /** @type {string[]} */
  const problems = [];
  if (r.leftA > 0) problems.push(`a 잔여 ${r.leftA}`);
  if (r.leftB > 0) problems.push(`b 잔여 ${r.leftB}`);
  if (r.leftC > 0) problems.push(`c 잔여 ${r.leftC}`);
  if (r.leftE > 0) problems.push(`e 미반영 ${r.leftE}곳 (region=광주·gu=북구 가 아님)`);
  if (r.leftD == null) problems.push("d 재조회 실패 — count 가 null (0 으로 읽지 않는다)");
  else if (r.tradesApplied && r.leftD > 0) problems.push(`d 잔여 ${r.leftD}`);
  return problems;
}

// ── 출력 ───────────────────────────────────────────────────────
/**
 * @param {string[]} ids
 * @param {number} [max]
 * @returns {string}
 */
function idList(ids, max = 20) {
  if (ids.length === 0) return "(없음)";
  return ids.length <= max ? ids.join(", ") : `${ids.slice(0, max).join(", ")} … 외 ${ids.length - max}건`;
}

// ── 메인 ───────────────────────────────────────────────────────
async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const outArg = argv.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : null;
  if (outArg && !outPath) {
    logError(PHASE, "--out= 에 경로가 없습니다 (절대경로 필요)");
    process.exit(1);
  }
  const unknown = argv.filter((a) => a !== "--apply" && !a.startsWith("--out="));
  if (unknown.length) {
    logError(PHASE, `모르는 인자: ${unknown.join(" ")}`);
    process.exit(1);
  }

  log(PHASE, apply ? "=== APPLY 모드 (쓰기) ===" : "=== DRY-RUN (읽기만) ===");
  const sb = getSupabase();

  // apartments — 전 행을 훑는다(오라벨 행은 region 이 이미 틀렸으므로 서버 필터를 못 믿는다).
  const apts = /** @type {AptRow[]} */ (
    await selectAll((s) => s.from("apartments").select("id, region, gu, address, bjd_code"), sb, "id")
  );
  log(PHASE, `apartments 조회: ${apts.length}건`);

  const a = planBjdRemap(apts);
  const b = planRegionSplit(apts);
  const c = planGyeonggiGwangju(apts);
  const e = planGuFix(apts);

  // trades — 삭제 대상과 그 쌍둥이 후보
  const targets = /** @type {TradeRow[]} */ (
    await selectAll(
      (s) =>
        s
          .from("trades")
          .select("id, region, gu, deal_month, area, price, floor, trade_type")
          .eq("region", "광주")
          .eq("gu", "광주시"),
      sb,
      "id",
    )
  );
  const gyeonggi = /** @type {TradeRow[]} */ (
    await selectAll(
      (s) =>
        s
          .from("trades")
          .select("id, region, gu, deal_month, area, price, floor, trade_type")
          .eq("region", "경기")
          .eq("gu", "광주시"),
      sb,
      "id",
    )
  );
  const d = computeTwinRatio(targets, gyeonggi);

  // ── 표 출력 ──
  log(PHASE, "");
  log(PHASE, `a) apartments.bjd_code 앞5 재매핑 : ${a.updates.length}곳`);
  for (const u of a.updates.slice(0, 10)) log(PHASE, `     ${u.id}: ${u.from} → ${u.to}`);
  if (a.updates.length > 10) log(PHASE, `     … 외 ${a.updates.length - 10}건`);
  log(PHASE, `   ⚠ 표에 없는 앞5 (수동 refit 대상, 건드리지 않음): ${a.manual.length}곳`);
  for (const m of a.manual) log(PHASE, `     ${m.id}: ${m.bjd_code} (region=${m.region})`);

  log(PHASE, `b) apartments.region 통합이름 분할 : ${b.updates.length}곳 (미결 ${b.skipped.length})`);
  for (const u of b.updates) log(PHASE, `     ${u.id}: ${MERGED_SIDO_NAME} + gu=${u.gu} → ${u.to}`);
  for (const s of b.skipped) log(PHASE, `     [skip] ${s.id}: gu=${s.gu ?? "(없음)"} — 못 가름`);

  log(PHASE, `c) 경기 광주시 오라벨 정정        : ${c.length}곳`);
  for (const u of c) log(PHASE, `     ${u.id}: 광주 → 경기 (${u.address})`);

  log(
    PHASE,
    `d) trades 광주:광주시 정리         : ${d.total}행 · 쌍둥이 ${d.twinIds.length}행(삭제) · ` +
      `쌍둥이없음 ${d.nonTwinIds.length}행(경기로 relabel) · 비율 ${(d.ratio * 100).toFixed(2)}% ` +
      `· 경기:광주시 ${gyeonggi.length}행 · 임계 ${(TWIN_RATIO_MIN * 100).toFixed(0)}% → ${d.passes ? "통과" : "중단(fail-close)"}`,
  );
  if (!d.passes && d.total > 0) {
    log(PHASE, `   쌍둥이 없는 키 ${d.missing.length}개 예시: ${idList(d.missing.slice(0, 5), 5)}`);
  }

  log(PHASE, `e) gu 지구이름 정정               : ${e.length}곳`);
  for (const u of e) log(PHASE, `     ${u.id}: ${u.fromRegion}/${u.fromGu} → 광주/북구`);

  // 보고만 — 삭제는 별도 승인 (스펙 §2)
  const dupIds = apts.filter((r) => r.id === "ah-2026910183").map((r) => r.id);
  log(PHASE, `※ 중복 의심 ah-2026910183 (순천금호어울림더파크2차): ${dupIds.length ? "존재 — 보고만, 삭제 안 함" : "없음"}`);

  const plan = {
    generatedAt: new Date().toISOString(),
    aptRows: apts.length,
    a: { count: a.updates.length, updates: a.updates, manual: a.manual },
    b: { count: b.updates.length, updates: b.updates, skipped: b.skipped },
    c: { count: c.length, updates: c },
    d: {
      total: d.total, twins: d.twins, ratio: d.ratio, passes: d.passes,
      gyeonggiRows: gyeonggi.length, ids: targets.map((t) => t.id),
      // 삭제(쌍둥이 있음) / relabel(쌍둥이 없음) 을 갈라 남긴다 — 무엇을 지웠는지 사후에 확인 가능해야 한다.
      twinCount: d.twinIds.length, nonTwinCount: d.nonTwinIds.length,
      twinIds: d.twinIds, nonTwinIds: d.nonTwinIds,
    },
    e: { count: e.length, updates: e },
  };
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
    log(PHASE, `계획 저장: ${outPath}`);
  }

  if (!apply) {
    log(PHASE, "dry-run 완료 — 쓰기 없음 (--apply 로 반영)");
    return;
  }

  // ── 쓰기 ──
  let wrote = 0;
  for (const u of a.updates) {
    const { error } = await sb.from("apartments").update({ bjd_code: u.to }).eq("id", u.id);
    if (error) { logError(PHASE, `a ${u.id}: ${error.message}`); process.exit(1); }
    wrote++;
  }
  for (const u of b.updates) {
    const { error } = await sb.from("apartments").update({ region: u.to }).eq("id", u.id);
    if (error) { logError(PHASE, `b ${u.id}: ${error.message}`); process.exit(1); }
    wrote++;
  }
  for (const u of c) {
    const { error } = await sb.from("apartments").update({ region: "경기" }).eq("id", u.id);
    if (error) { logError(PHASE, `c ${u.id}: ${error.message}`); process.exit(1); }
    wrote++;
  }
  for (const u of e) {
    const { error } = await sb.from("apartments").update({ region: "광주", gu: "북구" }).eq("id", u.id);
    if (error) { logError(PHASE, `e ${u.id}: ${error.message}`); process.exit(1); }
    wrote++;
  }
  let deleted = 0;
  let relabelled = 0;
  if (d.passes) {
    // ⚠️ 조건 삭제(`.eq(region).eq(gu)`)를 쓰지 않는다 — 그건 쌍둥이가 **없는** 행까지
    //    같이 지운다. 그 행들은 중복이 아니라 오라벨된 유일본이라 지우면 정보가 사라진다.
    //    id 로 갈라, 쌍둥이는 삭제하고 쌍둥이 없는 행은 경기로 되돌린다.
    for (const chunk of chunkIds(d.twinIds)) {
      const { error } = await sb.from("trades").delete().in("id", chunk);
      if (error) { logError(PHASE, `d 삭제(${chunk.length}건): ${error.message}`); process.exit(1); }
      deleted += chunk.length;
    }
    // 쌍둥이가 없다는 것은 곧 경기 쪽에 같은 고유키가 없다는 뜻이므로, region 만 바꿔도
    // 고유 인덱스(region,gu,deal_month,area,price,floor,trade_type) 충돌이 날 수 없다.
    for (const chunk of chunkIds(d.nonTwinIds)) {
      const { error } = await sb.from("trades").update({ region: "경기" }).in("id", chunk);
      if (error) { logError(PHASE, `d relabel(${chunk.length}건): ${error.message}`); process.exit(1); }
      relabelled += chunk.length;
    }
    log(PHASE, `d) trades 삭제 ${deleted}행 · 경기로 relabel ${relabelled}행 (합 ${d.total})`);
  } else {
    log(PHASE, "d) 쌍둥이 비율 미달 — 삭제·relabel 건너뜀 (표만 출력)");
  }

  // ── 되읽기 검증 ──
  const after = /** @type {AptRow[]} */ (
    await selectAll((s) => s.from("apartments").select("id, region, gu, address, bjd_code"), sb, "id")
  );
  const leftA = planBjdRemap(after).updates.length;
  const leftB = planRegionSplit(after).updates.length;
  const leftC = planGyeonggiGwangju(after).length;
  // (e) 는 계획 단계에서 "그 id 가 존재하는가" 만 봤다 — 실제로 광주/북구가 됐는지는
  // 되읽기로만 알 수 있다. 쓰기가 조용히 안 먹은 경우를 여기서 잡는다.
  const afterById = new Map(after.map((r) => [r.id, r]));
  const leftEIds = e
    .map((u) => u.id)
    .filter((id) => {
      const r = afterById.get(id);
      return !r || r.region !== "광주" || r.gu !== "북구";
    });
  const { count: leftD, error: leftDErr } = await sb
    .from("trades").select("*", { count: "exact", head: true })
    .eq("region", "광주").eq("gu", "광주시");
  if (leftDErr) logError(PHASE, `d 재조회 오류: ${leftDErr.message}`);
  log(
    PHASE,
    `검증(재조회): a 잔여 ${leftA} · b 잔여 ${leftB} · c 잔여 ${leftC} · ` +
      `d 잔여 ${leftD ?? "(count 없음)"} · e 미반영 ${leftEIds.length} · ` +
      `쓰기 ${wrote}건(+삭제 ${deleted}·relabel ${relabelled})`,
  );
  const problems = verifyResiduals({
    leftA, leftB, leftC, leftE: leftEIds.length, leftD, tradesApplied: d.passes,
  });
  if (problems.length) {
    if (leftEIds.length) logError(PHASE, `e 미반영 id: ${idList(leftEIds)}`);
    logError(PHASE, `재조회 결과가 기대와 다릅니다 — ${problems.join(" · ")}`);
    process.exit(1);
  }
  log(PHASE, "apply 완료");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
