// @ts-check
/**
 * cleanup-presale-links.mjs — 다른 시군구 단지에 잘못 붙은 네이버 분양 링크를 끊고 분양 칸을 비우는
 * 도구 (세션578).
 *
 * ## 왜 필요한가
 * `naver-presale.mjs` 의 `matchPresaleToApt` 2~4순위가 **시군구를 보지 않고** 브랜드 낱말 유사도만으로
 * 분양 공고를 기존 단지에 붙였다. 그 결과 남의 분양 번호(`naver_presale_no`)와 분양 칸 17개,
 * 그리고 `prices`(house_type `presale_min`)에 남의 분양가가 쌓였다
 * (예: ap-6026677 음성아이파크 ← 서울원아이파크 ap-6027751, 88km — 89900/3861 4행).
 * 수집기 쪽 게이트(같은 세션)는 **앞으로** 붙는 것만 막는다. 이미 박힌 링크는 1순위(번호 일치)로
 * 매 회차 다시 매칭되므로 이 도구로 끊어야 한다.
 *
 * ## 판정 (`findContaminatedLinks` — 순수 함수)
 * `naver_presale_no` 가 있고, 그 번호의 **주인 행 `ap-<번호>` 가 존재**하며, 주인 ≠ 자기이고,
 * `a.region !== owner.region || !sameDistrict(a.region, a.gu, owner.gu)` 이면 오염.
 *   - 시군구 판정은 수집기 게이트와 **같은 함수**(`naver-presale.mjs` 의 `sameDistrict`)를 import 한다.
 *     잣대가 둘로 갈리면 이 도구가 끊은 링크를 수집기가 다음 회차에 다시 붙인다.
 *   - 주인 행이 없는 것·같은 시군구는 대상이 **아니다**(판정 불가 — 다음 단계에서 따로 본다).
 *
 * ## 동작
 *   - ap-*  : `naver_presale_no` = 자기 id 의 `ap-` 뒤 번호로 복원, `naver_presale_seq` = null, 분양 17칸 null
 *             (다음 수집 회차가 자기 번호로 1순위 매칭해 자기 분양 정보를 다시 채운다).
 *   - 그 외 : `naver_presale_no`·`naver_presale_seq` null + 분양 17칸 null.
 *   - prices: 그 단지의 `house_type='presale_min'` 행 중 `(price, pp)` 가 **지금의
 *             `(presale_min_price, presale_pp)` 와 같은 행만** 삭제(남의 값이 확실한 행만).
 *
 * ## 한계 (건드리지 않는 것)
 * `unsold*` 4칸·세대수(units)·시공사(builder)·준공월(completion)·좌표(lat/lng)·최고층·bjd_code 는
 * 오염 매칭 때 enrich 로 채워졌을 **수도** 있지만, 원래 값인지 남의 값인지 판별할 근거가 없어 그대로 둔다.
 * 또 `(price, pp)` 가 지금 분양 칸과 다른 옛 prices 행(오염 이전 회차 값이 섞였을 수 있음)도 남긴다.
 * UPDATE 에 현재값 조건이 없어 확인 뒤 몇 ms 사이 경합 가능 — 월/목 08:00~14:00 네이버 러너 시간을 피해 반영한다.
 *
 * ## 안전장치 (`cleanup-unsold-by-ids.mjs` 와 같은 수준 — `.claude/rules/collectors/data-changing-run-approval.md`)
 *   1. dry-run 이 기본. `--out=<계획.json>` 필수. 전이표를 콘솔에 먼저 보여 준다.
 *   2. dry-run 은 `<out>.before.<YYYYMMDD-HHmmss>.json`(대상 행 19칸 현재값 + 삭제 예정 prices 행 전체)과
 *      `<out>.restore.<ts>.json`(역계획)을 남긴다. 같은 out 으로 여러 번 돌려도 사본을 덮어쓰지 않는다.
 *   3. `--apply` 는 반드시 `--from=<그 before 사본>` 을 요구한다. 사본의 19칸과 **지금 DB 값이 전부 같은
 *      행만** UPDATE 하고, 다르면 `현재값 달라짐: <칸> DB=… 사본=…` 으로 skip. prices 삭제도 사본에 적힌
 *      행 id 로만 한다(반영 시점에 다시 판정하지 않는다 — 세션542 `--apply` 재분석 사고 답습).
 *   4. 성공은 **돌아온 행**으로만 센다(`feedback_count_results_not_sent.md`). `createSemaphore(10)`.
 *   5. 반영 직후 대상 id 를 다시 읽어 기대 상태(ap-* = 자기 번호 + presale_pp null / 그 외 = 번호 null)인
 *      행 수와 남은 prices 행 수를 대조한다. 어긋나면 exit 1.
 *   6. 대상이 1,000 을 넘으면 exit 1(`.in()` 상한 — `unordered-pagination-loses-rows.md`).
 *   7. apartments 전량은 `selectAll(…, "id")` 고유키 커서로 읽는다.
 *
 * ## 사용법
 *   node scripts/cleanup-presale-links.mjs --out=<계획.json>                                  (dry-run)
 *   node scripts/cleanup-presale-links.mjs --out=<계획.json> --ids-file=<id목록.json>         (그 명단 안에서만 판정)
 *   node scripts/cleanup-presale-links.mjs --apply --from=<계획.json.before.<ts>.json> --why="세션578 오염 링크"
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *    (`.claude/rules/collectors/pipe-kills-collector.md`). 로그는 `> 파일 2>&1` 로 받는다.
 */
import {
  loadEnv, getSupabase, log, logError, createSemaphore, selectAll, haversineKm,
} from "./collectors/_shared.mjs";
import { sameDistrict } from "./collectors/naver-presale.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PHASE = "cleanup-presale-links";
const MAX_TARGETS = 1000;
const PRICE_CHUNK = 200;

/** 비울 분양 칸 17개 */
export const PRESALE_FIELDS = /** @type {const} */ ([
  "presale_min_price", "presale_max_price", "presale_pp", "presale_type", "presale_stage",
  "presale_stage_code", "presale_image_url", "presale_general_supply", "presale_buildings",
  "presale_parking", "presale_inquiry", "presale_features", "presale_move_in",
  "presale_recruit_date", "presale_schedule", "presale_housing_type", "presale_fetched_at",
]);
/** 사본·현재값 대조 대상 19칸 = 번호 2칸 + 분양 17칸 */
export const SNAP_FIELDS = /** @type {const} */ (["naver_presale_no", "naver_presale_seq", ...PRESALE_FIELDS]);

// ⚠️ 리터럴로 둔다 — 정적 가드(`_selectall-keycol-coverage.test.mjs`)가 select 문자열에서 커서 키 `id` 를 읽는다.
// SNAP_FIELDS 19칸이 빠지지 않았는지는 시험("APT_COLS 가 19칸을 다 담는다")이 지킨다.
export const APT_COLS = "id, name, region, gu, lat, lng, naver_presale_no, naver_presale_seq, presale_min_price, presale_max_price, presale_pp, presale_type, presale_stage, presale_stage_code, presale_image_url, presale_general_supply, presale_buildings, presale_parking, presale_inquiry, presale_features, presale_move_in, presale_recruit_date, presale_schedule, presale_housing_type, presale_fetched_at";

/**
 * @typedef {Record<string, any> & { id: string; name: string | null; region: string | null; gu: string | null; lat: number | null; lng: number | null; naver_presale_no: string | null }} AptRow
 * @typedef {{ id: number; apartment_id: string; price: number | null; pp: number | null; house_type: string | null } & Record<string, any>} PriceRow
 * @typedef {{
 *   id: string; name: string | null; region: string | null; gu: string | null;
 *   presale_type: string | null; presale_pp: number | null; presale_min_price: number | null;
 *   ownerId: string; ownerName: string | null; ownerRegion: string | null; ownerGu: string | null;
 *   km: number | null; action: "ap-restore" | "unlink";
 * }} Target
 */

/**
 * 오염 링크 판정 — DB 접근 없는 순수 함수.
 * @param {AptRow[]} rows apartments 전량(주인 행 조회용)
 * @param {{ onlyIds?: Set<string> | null }} [opts] `onlyIds` 가 있으면 그 명단 안의 행만 판정(주인 조회는 전량)
 * @returns {Target[]}
 */
export function findContaminatedLinks(rows, opts = {}) {
  const onlyIds = opts.onlyIds ?? null;
  /** @type {Map<string, AptRow>} */
  const byId = new Map(rows.map((r) => [r.id, r]));
  /** @type {Target[]} */
  const out = [];
  for (const a of rows) {
    if (onlyIds && !onlyIds.has(a.id)) continue;
    const no = a.naver_presale_no == null ? "" : String(a.naver_presale_no).trim();
    if (!no) continue;
    const owner = byId.get(`ap-${no}`);
    if (!owner) continue; // 주인 행 없음 — 판정 불가, 대상 아님
    if (owner.id === a.id) continue; // 자기 번호
    const contaminated = a.region !== owner.region || !sameDistrict(a.region, a.gu, owner.gu);
    if (!contaminated) continue;
    const km = a.lat != null && a.lng != null && owner.lat != null && owner.lng != null
      ? Math.round(haversineKm(a.lat, a.lng, owner.lat, owner.lng) * 10) / 10
      : null;
    out.push({
      id: a.id, name: a.name ?? null, region: a.region ?? null, gu: a.gu ?? null,
      presale_type: a.presale_type ?? null, presale_pp: a.presale_pp ?? null,
      presale_min_price: a.presale_min_price ?? null,
      ownerId: owner.id, ownerName: owner.name ?? null, ownerRegion: owner.region ?? null, ownerGu: owner.gu ?? null,
      km, action: a.id.startsWith("ap-") ? "ap-restore" : "unlink",
    });
  }
  out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return out;
}

/**
 * 동작별 기대 새 값(19칸). ap-* 는 자기 번호로 복원, 그 외는 번호도 null.
 * @param {string} id
 * @returns {Record<string, string | null>}
 */
export function expectedValues(id) {
  /** @type {Record<string, string | null>} */
  const v = {};
  for (const f of SNAP_FIELDS) v[f] = null;
  if (id.startsWith("ap-")) v.naver_presale_no = id.slice("ap-".length);
  return v;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function valuesEqual(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * 삭제할 prices 행 고르기 — 그 단지의 `presale_min` 행 중 `(price, pp)` 가 지금 분양 칸
 * `(presale_min_price, presale_pp)` 와 같은 행만. 지금 분양가가 비었으면 아무것도 고르지 않는다.
 * @param {{ id: string; presale_min_price: number | null; presale_pp: number | null }} target
 * @param {PriceRow[]} priceRows
 * @returns {PriceRow[]}
 */
export function selectPricesToDelete(target, priceRows) {
  if (target.presale_min_price == null) return [];
  return priceRows.filter((p) =>
    p.apartment_id === target.id &&
    p.house_type === "presale_min" &&
    valuesEqual(p.price, target.presale_min_price) &&
    valuesEqual(p.pp, target.presale_pp));
}

/**
 * `--from` 사본의 19칸과 지금 DB 값을 대조 — 같은 행만 반영 대상으로 남긴다. 순수 함수.
 * @template {{ id: string; name?: string | null; current: Record<string, unknown> }} T
 * @param {T[]} snapTargets
 * @param {AptRow[]} dbRows
 * @returns {{ toApply: T[]; staleSkipped: Array<{ id: string; name: string | null; reason: string }> }}
 */
export function checkCurrentValues(snapTargets, dbRows) {
  /** @type {Map<string, AptRow>} */
  const byId = new Map(dbRows.map((r) => [r.id, r]));
  /** @type {T[]} */
  const toApply = [];
  /** @type {Array<{ id: string; name: string | null; reason: string }>} */
  const staleSkipped = [];
  for (const t of snapTargets) {
    const db = byId.get(t.id);
    if (!db) {
      staleSkipped.push({ id: t.id, name: t.name ?? null, reason: "현재값 달라짐: 행 없음(그 사이 삭제되었거나 조회 안 됨)" });
      continue;
    }
    /** @type {string | null} */
    let mismatch = null;
    for (const f of SNAP_FIELDS) {
      if (!valuesEqual(db[f], t.current?.[f])) {
        mismatch = `현재값 달라짐: ${f} DB=${JSON.stringify(db[f])} 사본=${JSON.stringify(t.current?.[f])}`;
        break;
      }
    }
    if (mismatch) {
      staleSkipped.push({ id: t.id, name: t.name ?? null, reason: mismatch });
      continue;
    }
    toApply.push(t);
  }
  return { toApply, staleSkipped };
}

/**
 * `YYYYMMDD-HHmmss`
 * @param {Date} now
 * @returns {string}
 */
export function formatTimestamp(now) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** @param {number | null} km */
function bucket(km) {
  if (km == null) return "거리불명";
  if (km <= 1) return "≤1km";
  if (km <= 10) return "1~10km";
  if (km <= 50) return "10~50km";
  return ">50km";
}

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | null}
 */
function argValue(argv, name) {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

/**
 * id 명단 파일(배열 또는 {ids:[...]}) 읽기.
 * @param {string} abs
 * @param {(p: string) => string} readFile
 * @returns {string[]}
 */
function parseIdsFile(abs, readFile) {
  const j = /** @type {any} */ (JSON.parse(readFile(abs)));
  const arr = Array.isArray(j) ? j : j?.ids;
  if (!Array.isArray(arr)) throw new Error(`--ids-file 형식 오류(배열 또는 {ids:[...]}): ${abs}`);
  return arr.map((x) => (typeof x === "string" ? x : String(x?.id ?? ""))).filter(Boolean);
}

/**
 * 대상 단지들의 presale_min prices 행 전체 — id 묶음마다 고유키 커서로 읽는다(묶음 결과가 1,000 을 넘어도 안 샌다).
 * @param {any} sb
 * @param {string[]} ids
 * @returns {Promise<PriceRow[]>}
 */
async function loadPresalePrices(sb, ids) {
  /** @type {PriceRow[]} */
  const all = [];
  for (let i = 0; i < ids.length; i += PRICE_CHUNK) {
    const chunk = ids.slice(i, i + PRICE_CHUNK);
    const rows = /** @type {PriceRow[]} */ (await selectAll(
      (s) => s.from("prices").select("*").eq("house_type", "presale_min").in("apartment_id", chunk),
      sb,
      "id",
    ));
    all.push(...rows);
  }
  return all;
}

/**
 * 도구 본체 — 의존성 주입형(시험은 가짜 Supabase 클라이언트로 돈다). process.exit 를 부르지 않고 code 를 돌려준다.
 * @param {{
 *   argv: string[];
 *   sb: any;
 *   now?: Date;
 *   cwd?: string;
 *   readFile?: (p: string) => string;
 *   writeFile?: (p: string, s: string) => void;
 *   exists?: (p: string) => boolean;
 * }} deps
 * @returns {Promise<{ code: number; [k: string]: unknown }>}
 */
export async function run(deps) {
  const { argv, sb } = deps;
  const now = deps.now ?? new Date();
  const cwd = deps.cwd ?? process.cwd();
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s, "utf8"));
  const exists = deps.exists ?? ((p) => existsSync(p));

  const apply = argv.includes("--apply");
  const outArg = argValue(argv, "out");
  const fromArg = argValue(argv, "from");
  const idsArg = argValue(argv, "ids-file");
  const why = argValue(argv, "why");

  if (apply && !fromArg) {
    logError(PHASE, "--apply 는 --from=<dry-run 이 만든 before 사본.json> 없이 실행할 수 없음");
    return { code: 1 };
  }
  if (!apply && !outArg) {
    logError(PHASE, "--out=<계획.json> 필요 (dry-run 결과·사본·역계획을 남길 자리)");
    return { code: 1 };
  }

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "DRY-RUN — DB 변경 0 (반영하려면 --apply --from=<before 사본>)");
  if (why) log(PHASE, `사유: ${why}`);

  if (apply) return applyFromSnapshot({ sb, cwd, readFile, fromPath: /** @type {string} */ (fromArg) });

  // ── dry-run ──────────────────────────────────────────────
  /** @type {Set<string> | null} */
  let onlyIds = null;
  if (idsArg) {
    const abs = resolve(cwd, idsArg);
    if (!exists(abs)) {
      logError(PHASE, `--ids-file 없음: ${abs}`);
      return { code: 1 };
    }
    try {
      onlyIds = new Set(parseIdsFile(abs, readFile));
    } catch (e) {
      logError(PHASE, e instanceof Error ? e.message : String(e));
      return { code: 1 };
    }
    log(PHASE, `--ids-file 명단 ${onlyIds.size}건 안에서만 판정`);
  }

  const rows = /** @type {AptRow[]} */ (await selectAll(
    (s) => s.from("apartments").select("id, name, region, gu, lat, lng, naver_presale_no, naver_presale_seq, presale_min_price, presale_max_price, presale_pp, presale_type, presale_stage, presale_stage_code, presale_image_url, presale_general_supply, presale_buildings, presale_parking, presale_inquiry, presale_features, presale_move_in, presale_recruit_date, presale_schedule, presale_housing_type, presale_fetched_at"),
    sb,
    "id",
  ));
  log(PHASE, `apartments 전량 ${rows.length}행 (고유키 커서)`);

  const targets = findContaminatedLinks(rows, { onlyIds });
  if (targets.length > MAX_TARGETS) {
    logError(PHASE, `대상 ${targets.length}건 — 1,000 초과(.in() 상한). --ids-file 로 나눠서 돌릴 것`);
    return { code: 1, targets: targets.length };
  }

  const priceRows = await loadPresalePrices(sb, targets.map((t) => t.id));
  /** @type {Map<string, AptRow>} */
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const snapTargets = targets.map((t) => {
    const r = /** @type {AptRow} */ (rowById.get(t.id));
    /** @type {Record<string, unknown>} */
    const current = {};
    for (const f of SNAP_FIELDS) current[f] = r[f] ?? null;
    return {
      id: t.id, name: t.name, action: t.action, current, expected: expectedValues(t.id),
      prices: selectPricesToDelete(t, priceRows),
      owner: { id: t.ownerId, name: t.ownerName, region: t.ownerRegion, gu: t.ownerGu }, km: t.km,
    };
  });

  // 전이표
  log(PHASE, `\n=== 전이표 — 대상 ${targets.length}건 ===`);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const s = snapTargets[i];
    log(PHASE, `  ${t.id} · ${t.name ?? "-"} · ${t.region ?? "?"}|${t.gu ?? "?"} · ${t.presale_type ?? "-"} · 평당 ${t.presale_pp ?? "null"}`
      + ` → 주인 ${t.ownerId} · ${t.ownerName ?? "-"} · ${t.ownerRegion ?? "?"}|${t.ownerGu ?? "?"} · ${t.km == null ? "거리불명" : `${t.km}km`}`
      + ` · 동작 ${t.action === "ap-restore" ? `ap-복원(번호→${t.id.slice(3)})` : "끊기(번호 null)"}`
      + ` · prices 삭제 ${s.prices.length}행`);
  }
  const apCount = targets.filter((t) => t.action === "ap-restore").length;
  const priceTotal = snapTargets.reduce((n, s) => n + s.prices.length, 0);
  /** @type {Record<string, Record<string, number>>} */
  const dist = { "ap-*": {}, "그 외": {} };
  for (const t of targets) {
    const g = t.action === "ap-restore" ? dist["ap-*"] : dist["그 외"];
    const b = bucket(t.km);
    g[b] = (g[b] ?? 0) + 1;
  }
  log(PHASE, `\n=== 요약: 대상 ${targets.length} · ap-* ${apCount} · 그 외 ${targets.length - apCount} · prices 삭제 예정 ${priceTotal}행 ===`);
  log(PHASE, `  거리 분포 ${JSON.stringify(dist)}`);

  const ts = formatTimestamp(now);
  const outAbs = resolve(cwd, /** @type {string} */ (outArg));
  const beforePath = `${outAbs}.before.${ts}.json`;
  const restorePath = `${outAbs}.restore.${ts}.json`;
  if (exists(beforePath) || exists(restorePath)) {
    logError(PHASE, `사본이 이미 있음(덮어쓰지 않는다): ${beforePath} — 1초 뒤 다시 돌릴 것`);
    return { code: 1 };
  }
  const generatedAt = now.toISOString();
  writeFile(outAbs, JSON.stringify({
    generatedAt, why, idsFile: idsArg,
    summary: { targets: targets.length, ap: apCount, other: targets.length - apCount, pricesToDelete: priceTotal, dist },
    plan: snapTargets.map((s) => ({ id: s.id, name: s.name, action: s.action, expected: s.expected, owner: s.owner, km: s.km, priceIds: s.prices.map((p) => p.id) })),
  }, null, 2));
  writeFile(beforePath, JSON.stringify({
    generatedAt, why, idsFile: idsArg, fields: SNAP_FIELDS,
    targets: snapTargets.map((s) => ({ id: s.id, name: s.name, action: s.action, current: s.current, expected: s.expected, prices: s.prices })),
  }, null, 2));
  writeFile(restorePath, JSON.stringify({
    generatedAt,
    note: "되돌릴 때: restore 19칸을 그 id 에 UPDATE 하고, prices 행은 그대로 INSERT 한다(id 포함).",
    plan: snapTargets.map((s) => ({ id: s.id, name: s.name, restore: s.current, prices: s.prices })),
  }, null, 2));
  log(PHASE, `\n[PLAN] ${outAbs}`);
  log(PHASE, `[BEFORE] 사본: ${beforePath}`);
  log(PHASE, `[RESTORE] 역계획: ${restorePath}`);
  log(PHASE, `=== DRY-RUN 종료 — 반영하려면 --apply --from=${beforePath} ===`);
  return { code: 0, targets: targets.length, ap: apCount, pricesToDelete: priceTotal, beforePath, restorePath };
}

/**
 * @param {{ sb: any; cwd: string; readFile: (p: string) => string; fromPath: string }} p
 * @returns {Promise<{ code: number; [k: string]: unknown }>}
 */
async function applyFromSnapshot({ sb, cwd, readFile, fromPath }) {
  /** @type {any} */
  let snap;
  try {
    snap = JSON.parse(readFile(resolve(cwd, fromPath)));
  } catch (e) {
    logError(PHASE, `--from 사본 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }
  /** @type {Array<{ id: string; name?: string | null; action: string; current: Record<string, unknown>; expected: Record<string, unknown>; prices: PriceRow[] }>} */
  const snapTargets = Array.isArray(snap?.targets) ? snap.targets : [];
  if (snapTargets.length === 0) {
    logError(PHASE, `--from 사본에 targets 가 없음: ${fromPath}`);
    return { code: 1 };
  }
  if (snapTargets.length > MAX_TARGETS) {
    logError(PHASE, `사본 대상 ${snapTargets.length}건 — 1,000 초과(.in() 상한)`);
    return { code: 1 };
  }
  const ids = snapTargets.map((t) => t.id);
  const { data, error } = await sb.from("apartments").select(APT_COLS).in("id", ids);
  if (error) {
    logError(PHASE, `apartments 조회 실패: ${error.message}`);
    return { code: 1 };
  }
  const dbRows = /** @type {AptRow[]} */ (data ?? []);
  const { toApply, staleSkipped } = checkCurrentValues(snapTargets, dbRows);
  if (staleSkipped.length > 0) {
    log(PHASE, `\n=== 현재값 달라짐 — 건너뜀 ${staleSkipped.length}건 ===`);
    for (const s of staleSkipped) log(PHASE, `  [skip] ${s.name ?? s.id}(${s.id}): ${s.reason}`);
  }

  const limit = createSemaphore(10);
  /** @type {string[]} */
  const okIds = [];
  let fail = 0;
  let pricesDeleted = 0;
  /** @type {number[]} */
  const priceIdsDeleted = [];
  await Promise.all(toApply.map((t) => limit(async () => {
    const t2 = /** @type {any} */ (t);
    const { data: updated, error: updErr } = await sb
      .from("apartments")
      .update(t2.expected)
      .eq("id", t.id)
      .select("id");
    if (updErr) {
      logError(PHASE, `${t.id}: ${updErr.message}`);
      fail++;
      return;
    }
    if (!updated || updated.length === 0) {
      logError(PHASE, `${t.id}: UPDATE 가 행을 돌려주지 않음`);
      fail++;
      return;
    }
    okIds.push(t.id);
    /** @type {number[]} */
    const pids = (t2.prices ?? []).map((/** @type {PriceRow} */ p) => p.id);
    if (pids.length === 0) return;
    const { data: deleted, error: delErr } = await sb
      .from("prices")
      .delete()
      .eq("apartment_id", t.id)
      .eq("house_type", "presale_min")
      .in("id", pids)
      .select("id");
    if (delErr) {
      logError(PHASE, `${t.id} prices 삭제 실패: ${delErr.message}`);
      return;
    }
    for (const d of deleted ?? []) { pricesDeleted++; priceIdsDeleted.push(d.id); }
  })));

  log(PHASE, `\n=== 반영 완료: 성공 ${okIds.length} / 실패 ${fail} / 현재값 달라짐(건너뜀) ${staleSkipped.length} · prices 삭제 ${pricesDeleted}행 ===`);

  // 반영 직후 재조회 — 기대 상태인 행 수
  let code = fail > 0 ? 1 : 0;
  if (okIds.length > 0) {
    const { data: vData, error: vErr } = await sb
      .from("apartments")
      .select("id, naver_presale_no, presale_pp")
      .in("id", okIds);
    if (vErr) {
      logError(PHASE, `반영 후 검증 조회 실패: ${vErr.message}`);
      code = 1;
    } else {
      const vRows = /** @type {AptRow[]} */ (vData ?? []);
      const good = vRows.filter((r) => (r.id.startsWith("ap-")
        ? String(r.naver_presale_no ?? "") === r.id.slice(3) && r.presale_pp == null
        : r.naver_presale_no == null)).length;
      log(PHASE, `[검증] 기대 상태 행: ${good} / ${okIds.length}(기대) — ap-* 는 자기 번호+presale_pp null, 그 외는 번호 null`);
      if (good !== okIds.length) {
        logError(PHASE, "검증 불일치 — 경합 또는 트리거 개입 가능");
        code = 1;
      }
    }
    const expectedPriceIds = toApply
      .filter((t) => okIds.includes(t.id))
      .flatMap((t) => /** @type {any} */ (t).prices ?? [])
      .map((/** @type {PriceRow} */ p) => p.id);
    if (expectedPriceIds.length > 0) {
      const { data: left, error: lErr } = await sb.from("prices").select("id").in("id", expectedPriceIds);
      if (lErr) {
        logError(PHASE, `prices 검증 조회 실패: ${lErr.message}`);
        code = 1;
      } else {
        log(PHASE, `[검증] 삭제 예정 prices ${expectedPriceIds.length}행 중 남은 행: ${(left ?? []).length}(기대 0)`);
        if ((left ?? []).length !== 0) code = 1;
      }
    }
  }
  return { code, ok: okIds.length, fail, staleSkipped: staleSkipped.length, pricesDeleted, priceIdsDeleted };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  loadEnv();
  run({ argv: process.argv.slice(2), sb: getSupabase() })
    .then((r) => { process.exitCode = r.code; })
    .catch((/** @type {unknown} */ err) => {
      logError(PHASE, err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
