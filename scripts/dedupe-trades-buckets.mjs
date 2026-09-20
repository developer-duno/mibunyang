// @ts-check
/**
 * `trades` 중복 행 정리 — 세종 NULL-gu 사본 + 옛 맨표기/오라벨 버킷 (세션550).
 *
 * ## 무엇이 잘못됐나 (2026-09-20 실측, 전체 1,052,512행)
 *
 * ### ① 세종 — 고유 인덱스가 한 번도 안 걸렸다
 * `idx_trades_unique(region, gu, deal_month, area, price, floor, trade_type)` 가 upsert 의
 * 충돌 키인데 **Postgres 는 NULL 을 서로 다른 값으로 본다**. 세종은 구·군이 없어 `gu=null` 로
 * 저장돼 왔고, 그래서 회차마다 같은 거래가 **새 행**으로 또 들어갔다(202603 은 10벌, 202608 은 1벌).
 * `gu IS NULL` 68,352행 = 실제 거래 11,812건. 그 옆 `세종|행정중심복합도시` 11,790행은
 * gu 가 null 이 아니라 인덱스가 제대로 걸려 **거래당 1행**이다 — 그래서 그쪽이 남길 쪽(keeper)이고,
 * 두 버킷의 충돌 키 집합은 완전히 같다(어느 쪽에도 상대에 없는 키가 없다).
 * 손님 피해: `trade-stats.mjs statsKey()` 가 세종을 gu 무시하고 `"세종:"` 한 버킷으로 접어
 * 화면에 "세종 6개월 거래 10,916건"(참값 2,124)이 떴다 → 유동성 등급이 통째로 한 칸 위.
 *
 * ### ② 옛 맨표기·오라벨 버킷 — 정식 표기 쪽에 같은 거래가 이미 있다
 * `기흥구`(→`용인시 기흥구`) 같은 맨표기 10개, 그리고 옛 LAWD 폴백이 남긴 오라벨 2개
 * (`경북|북구` 안에 부산 북구 동들이 · `대구|대구` 는 통째로 서울 동대문구 동들). 전부
 * 정식 버킷에 쌍둥이가 있는 **죽은 사본**이다.
 *
 * ## 이 도구가 지키는 것
 *
 * - **재분석 없는 반영**: `--apply` 같은 건 아예 없다. 눈으로 본 계획 파일만 `--apply-from` 으로
 *   반영한다. 세션542 사고(눈으로 본 dry-run 과 다른 것이 반영됨)의 재발 방지
 *   (`.claude/rules/collectors/placeholder-coordinates-truth-sources.md`).
 * - **fail-close**: 버킷별 쌍둥이 비율이 `TWIN_RATIO_MIN` 미만이면 그 버킷은 **0건 삭제**이고
 *   계획에 `passes:false` 로 적힌다. 반영은 범위 안에 실패 버킷이 하나라도 있으면 통째로 거부한다.
 * - **쌍둥이 없는 행은 안 지운다** — 그건 중복이 아니라 유일본이다(세션548 D5와 같은 결).
 * - 삭제는 **기본키 `id` 로만**(`.delete().in("id", …)`) — 필터 삭제 금지.
 *
 * ## 사용법
 *
 *   node scripts/dedupe-trades-buckets.mjs --out=<절대경로>                      # (기본) dry-run
 *   node scripts/dedupe-trades-buckets.mjs --out=<절대경로> --only=sejong        # 범위 한정
 *   node scripts/dedupe-trades-buckets.mjs --apply-from=<계획.json>              # 그 계획 미리보기
 *   node scripts/dedupe-trades-buckets.mjs --apply-from=<계획.json> --apply      # 그 계획 그대로 반영
 *
 * `--only=` 는 `sejong` · `twins` · `<region>:<gu>`(예: `경북:북구`).
 * ⚠️ `--out` 은 **절대경로**로 — Git Bash 의 `/tmp` 는 node `resolve` 와 다른 폴더를 가리킨다.
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, getSupabase, log, logError, selectAll, normalizeGu } from "./collectors/_shared.mjs";
import { tradeTwinKey, chunkIds, computeTwinRatio, TWIN_RATIO_MIN, ID_CHUNK } from "./remap-incheon-2026.mjs";

const PHASE = "dedupe-trades";

/**
 * 세종 버킷 — `dupGu`(=null) 쪽이 사본, `keeperGu` 쪽이 남길 쪽, 최종 표기는 `relabelTo`.
 *
 * `relabelTo` 가 `"세종시"` 인 이유 = `GU_LAWD_MAP["세종"]["세종시"]`(36110) · `regions` 키
 * `세종|세종시` 와 같은 표기이고, 수집기(`collect-trades.mjs tradeRowGu`)가 앞으로 쓸 값이다.
 * 이 둘이 어긋나면 다음 회차가 또 새 버킷을 만든다.
 */
export const SEJONG = Object.freeze({
  region: "세종",
  dupGu: /** @type {string | null} */ (null),
  keeperGu: "행정중심복합도시",
  relabelTo: "세종시",
});

/**
 * @typedef {{ region: string, gu: string }} Bucket
 * @typedef {{ from: Bucket, targets: Bucket[] }} TwinBucket
 * @typedef {{ id: number | string, region: string | null, gu: string | null, dong: string | null,
 *   deal_month: string | null, area: number | null, price: number | null, floor: number | null,
 *   trade_type: string | null, apt_name: string | null, cancel_date?: string | null,
 *   recorded_at?: string | null }} TradeRow
 */

/**
 * 죽은 사본 버킷 → 같은 거래가 살아 있는 정식 버킷.
 *
 * ⚠️ 맨표기 10개의 `targets` 는 **`normalizeGu(region, bare)` 와 같아야 한다** — 테스트가 그 동치를
 * 단언한다(여기 적힌 글자를 믿지 않는다). 표기법이 바뀌면 리터럴이 아니라 테스트가 먼저 깨진다.
 *
 * 아래 둘은 맨표기가 아니라 **옛 LAWD 폴백이 만든 오라벨**이라 대상이 다른 시도다:
 * - `경북|북구` 7,169행 = 포항시 북구 4,547 + **부산 북구 동들**(화명·만덕·금곡·덕천·구포) 2,622
 * - `대구|대구` 4,022행 = 통째로 **서울 동대문구 동들**(답십리·전농·이문·용두·장안·휘경)
 * 그래서 이 둘만 `targets` 가 여럿이거나 다른 시도를 가리킨다.
 *
 * ⚠️ 인천 `서구`·`중구` 의 비쌍둥이 22행은 세션548이 **일부러 남긴** 유일본이라 이 표에 없다.
 * @type {readonly TwinBucket[]}
 */
export const TWIN_BUCKETS = Object.freeze([
  { from: { region: "경기", gu: "기흥구" }, targets: [{ region: "경기", gu: "용인시 기흥구" }] },
  { from: { region: "경기", gu: "덕양구" }, targets: [{ region: "경기", gu: "고양시 덕양구" }] },
  { from: { region: "충남", gu: "서북구" }, targets: [{ region: "충남", gu: "천안시 서북구" }] },
  { from: { region: "경기", gu: "장안구" }, targets: [{ region: "경기", gu: "수원시 장안구" }] },
  { from: { region: "충남", gu: "동남구" }, targets: [{ region: "충남", gu: "천안시 동남구" }] },
  { from: { region: "경기", gu: "만안구" }, targets: [{ region: "경기", gu: "안양시 만안구" }] },
  { from: { region: "경기", gu: "소사구" }, targets: [{ region: "경기", gu: "부천시 소사구" }] },
  { from: { region: "충북", gu: "상당구" }, targets: [{ region: "충북", gu: "청주시 상당구" }] },
  { from: { region: "경남", gu: "의창구" }, targets: [{ region: "경남", gu: "창원시 의창구" }] },
  { from: { region: "경기", gu: "오정구" }, targets: [{ region: "경기", gu: "부천시 오정구" }] },
  {
    from: { region: "경북", gu: "북구" },
    targets: [{ region: "경북", gu: "포항시 북구" }, { region: "부산", gu: "북구" }],
  },
  { from: { region: "대구", gu: "대구" }, targets: [{ region: "서울", gu: "동대문구" }] },
]);

/**
 * 옛 LAWD 폴백이 만든 **오라벨** 버킷 — 맨표기가 아니므로 `normalizeGu` 동치 단언에서 뺀다.
 * 표기는 `bucketName()` 형식(`region:gu`)과 같아야 한다 — 다르면 테스트가 먼저 깨진다.
 */
export const MISLABELLED_BUCKETS = Object.freeze(["경북:북구", "대구:대구"]);

/** 버킷 이름 — 로그·`--only=` 에 쓰는 한 형식. */
/**
 * @param {Bucket | { region: string, gu: string | null }} b
 * @returns {string}
 */
export function bucketName(b) {
  return `${b.region}:${b.gu ?? ""}`;
}

// ── 인자 ───────────────────────────────────────────────────────
/**
 * ⚠️ **`--apply` 단독 모드는 없다**(설계). 반영은 `--apply-from=<계획>` 과 함께일 때만 뜻이 선다 —
 * 재분석 후 반영은 "눈으로 본 것과 다른 것이 반영되는" 사고 유형이라 아예 길을 막는다.
 *
 * @param {string[]} argv
 * @returns {{ apply: boolean, outPath: string | null, applyFrom: string | null,
 *   only: string | null, error: string | null }}
 */
export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const outArg = argv.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : null;
  const fromArg = argv.find((a) => a.startsWith("--apply-from="));
  const applyFrom = fromArg ? fromArg.slice("--apply-from=".length) : null;
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;

  const known = (/** @type {string} */ a) =>
    a === "--apply" || a.startsWith("--out=") || a.startsWith("--apply-from=") || a.startsWith("--only=");
  const unknown = argv.filter((a) => !known(a));

  let error = null;
  if (unknown.length) error = `모르는 인자: ${unknown.join(" ")}`;
  else if (apply && !applyFrom) {
    // `--apply` 만으로는 못 쓴다 — 전체 재분석 후 반영이 세션542 사고의 모양이다.
    error = "--apply 는 --apply-from=<계획.json> 과 함께만 씁니다 (재분석 후 반영 금지)";
  } else if (outArg && !outPath) error = "--out= 에 경로가 없습니다 (절대경로 필요)";
  else if (fromArg && !applyFrom) error = "--apply-from= 에 경로가 없습니다";
  else if (applyFrom && outArg) {
    error = "--apply-from 은 --out 과 함께 쓸 수 없습니다 (계획 파일이 곧 반영 목록입니다)";
  } else if (onlyArg && !only) error = "--only= 에 값이 없습니다";
  else if (!applyFrom && !outPath) {
    // 계획을 파일로 안 남기면 `--apply-from` 으로 반영할 길이 없다 — 화면만 보고 끝나는 실행을 막는다.
    error = "--out=<절대경로> 가 필요합니다 (계획 JSON 을 남겨야 나중에 그대로 반영할 수 있습니다)";
  }

  return { apply, outPath, applyFrom, only, error };
}

/**
 * `--only=` 가 이 버킷을 포함하는가. null 이면 전부.
 * @param {string | null} only
 * @param {"sejong" | "twin"} kind
 * @param {string} name `bucketName()` 결과
 * @returns {boolean}
 */
export function inScope(only, kind, name) {
  if (!only) return true;
  if (only === "sejong") return kind === "sejong";
  if (only === "twins") return kind === "twin";
  return only === name;
}

// ── 계획 (순수 함수) ───────────────────────────────────────────
/**
 * 죽은 사본 버킷 하나의 삭제 계획.
 *
 * 쌍둥이 판정은 `tradeTwinKey`(dong·deal_month·area·price·floor·trade_type·apt_name)로 한다 —
 * region·gu 는 **갈린 축 자체**라 빼고, `cancel_date` 도 뺀다(정식 쪽이 나중 해제를 받아
 * 옛 행이 낡은 판본인 경우가 대부분인데, 그건 같은 거래이므로 지울 수 있어야 한다).
 *
 * @param {TradeRow[]} fromRows
 * @param {TradeRow[]} targetRows 대상 버킷들의 행을 합친 것
 * @returns {{ total: number, twins: number, ratio: number, passes: boolean,
 *   deleteIds: Array<number|string>, nonTwin: number, nonTwinSamples: TradeRow[] }}
 */
export function planTwinBucket(fromRows, targetRows) {
  const d = computeTwinRatio(fromRows, targetRows);
  // fail-close: 비율 미달이면 **한 건도** 지우지 않는다. 근거("정식 쪽에 같은 거래가 있다")가
  // 무너진 상태에서 지우면 유일본을 잃는다.
  const deleteIds = d.passes ? d.twinIds : [];
  return {
    total: d.total,
    twins: d.twins,
    ratio: d.ratio,
    passes: d.passes,
    deleteIds,
    nonTwin: d.total - d.twins,
    nonTwinSamples: d.nonTwinSamples,
  };
}

/**
 * 두 행 중 살아남을 쪽 — 최신 `recorded_at`, 동률이면 큰 `id`.
 * @param {TradeRow} a
 * @param {TradeRow} b
 * @returns {TradeRow}
 */
function pickSurvivor(a, b) {
  const ra = a.recorded_at ? String(a.recorded_at) : "";
  const rb = b.recorded_at ? String(b.recorded_at) : "";
  if (ra !== rb) return ra > rb ? a : b;
  return String(a.id) > String(b.id) ? a : b;
}

/**
 * 빈 값 자리를 메우는 표식 — 실제 값과 절대 안 겹치게 고른다.
 * ⚠️ 생 NUL 문자를 소스에 넣지 않는다(파일이 바이너리로 취급돼 grep·가드가 통째로 죽는다 —
 *    `feedback_nul_byte_in_write.md`). 이름 있는 상수로 두면 그 사고가 다시 안 난다.
 */
const NULL_SENTINEL = "\u0000";
/**
 * 충돌 키 — DB 고유 인덱스와 **같은 컬럼 순서**. 세종 relabel 이 이 키를 밟는지 보는 데 쓴다.
 * @param {TradeRow} r
 * @param {string | null} gu relabel 후의 gu 를 넣어 "옮기면 충돌하는가"를 본다
 * @returns {string}
 */
export function conflictKey(r, gu) {
  return [r.region, gu, r.deal_month, r.area, r.price, r.floor, r.trade_type]
    .map((v) => (v == null ? NULL_SENTINEL : String(v)))
    .join("|");
}

/**
 * 세종 계획 — 사본 삭제 + 남은 행 표기 통일.
 *
 * 1. **모든** 세종 행(두 gu 값 전부)을 `tradeTwinKey` 로 묶는다.
 * 2. 묶음에 keeper(gu=`행정중심복합도시`)가 있으면 그 묶음의 **null-gu 행은 전부 삭제**.
 *    keeper 는 어떤 경우에도 안 지운다.
 * 3. null-gu 행만 있는 묶음이면 **한 행만 남기고**(최신 `recorded_at`, 동률 시 큰 `id`) 나머지 삭제.
 * 4. keeper 행은 전부 `relabelTo` 로 표기 통일. 살아남은 null-gu 행은 **그 표기로 옮겨도
 *    고유 인덱스를 안 밟을 때만** 함께 옮긴다 — 밟으면 그대로 null 로 두고 수를 보고한다
 *    (어차피 `statsKey` 가 세종을 한 버킷으로 접으므로 화면 숫자는 이미 1건으로 세어진다).
 *
 * @param {TradeRow[]} rows 세종 전 행(두 gu 값)
 * @param {string} keeperGu
 * @param {string} relabelTo
 * @returns {{ dupTotal: number, keeperTotal: number, groups: number,
 *   deleteIds: Array<number|string>, relabelIds: Array<number|string>,
 *   keptNullIds: Array<number|string>, relabelBlocked: number,
 *   orphanGroups: number, passes: boolean }}
 */
export function planSejong(rows, keeperGu = SEJONG.keeperGu, relabelTo = SEJONG.relabelTo) {
  /** @type {Map<string, { keepers: TradeRow[], dups: TradeRow[] }>} */
  const groups = new Map();
  let dupTotal = 0;
  let keeperTotal = 0;
  for (const r of rows) {
    const k = tradeTwinKey(r);
    let g = groups.get(k);
    if (!g) { g = { keepers: [], dups: [] }; groups.set(k, g); }
    if (r.gu === keeperGu) { g.keepers.push(r); keeperTotal++; }
    else if (r.gu == null) { g.dups.push(r); dupTotal++; }
    // 그 밖의 gu(이미 relabelTo 인 행 등)는 손대지 않는다 — 이 도구가 만든 상태일 수 있다.
  }

  /** @type {Array<number|string>} */
  const deleteIds = [];
  /** @type {Array<number|string>} */
  const relabelIds = [];
  /** @type {Array<number|string>} */
  const keptNullIds = [];
  let orphanGroups = 0;

  for (const g of groups.values()) {
    if (g.keepers.length > 0) {
      // keeper 가 있으면 사본은 전부 삭제. keeper 는 절대 안 지운다.
      for (const d of g.dups) deleteIds.push(d.id);
      for (const k of g.keepers) relabelIds.push(k.id);
      continue;
    }
    if (g.dups.length === 0) continue;
    // keeper 없는 묶음 — 한 행만 남긴다.
    orphanGroups++;
    let survivor = g.dups[0];
    for (const d of g.dups.slice(1)) survivor = pickSurvivor(survivor, d);
    for (const d of g.dups) { if (d.id !== survivor.id) deleteIds.push(d.id); }
    keptNullIds.push(survivor.id);
  }

  // relabel 충돌 검사 — 옮긴 뒤 `relabelTo` 를 달게 될 행들의 충돌 키를 모아 두고,
  // 살아남은 null-gu 행이 그 키를 이미 밟으면 옮기지 않는다.
  /** @type {Set<string>} */
  const taken = new Set();
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  for (const id of relabelIds) {
    const r = byId.get(String(id));
    if (r) taken.add(conflictKey(r, relabelTo));
  }
  let relabelBlocked = 0;
  for (const id of keptNullIds) {
    const r = byId.get(String(id));
    if (!r) continue;
    const ck = conflictKey(r, relabelTo);
    if (taken.has(ck)) { relabelBlocked++; continue; }
    taken.add(ck);
    relabelIds.push(id);
  }

  return {
    dupTotal,
    keeperTotal,
    groups: groups.size,
    deleteIds,
    relabelIds,
    keptNullIds,
    relabelBlocked,
    orphanGroups,
    // 세종은 비율 fail-close 가 아니다(사본 판정이 "같은 묶음 안"이라 구조적으로 참).
    // 대신 keeper 가 통째로 비면 계획 자체가 이상하므로 그때만 막는다.
    passes: rows.length > 0 && keeperTotal > 0,
  };
}

// ── 계획 파일 검증 (`--apply-from`) ────────────────────────────
/**
 * 계획 파일이 반영해도 되는 것인가 — **DB 접근 없이** 파일만 보고 판정한다.
 *
 * `--apply-from` 은 재분석을 안 하므로 계획이 곧 진실이다. 그러면 "그 계획을 만든 dry-run 이
 * 온전했나"를 파일 안에서 확인할 수 있어야 한다(세션543 `checkDumpProvenance` 와 같은 결).
 *
 * ⚠️ 이 함수는 **계획의 판정이 옳은지는 못 지킨다** — 그건 사람의 검토 몫이다.
 *
 * @param {any} json
 * @param {string | null} only 반영 범위
 * @param {Date} [now]
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkPlan(json, only = null, now = new Date()) {
  if (!json || typeof json !== "object") return { ok: false, reason: "계획 파일이 객체가 아닙니다" };
  if (!Array.isArray(json.buckets)) {
    return { ok: false, reason: "구버전/손상 계획 — buckets 배열이 없습니다. 미리보기를 다시 만드세요." };
  }
  if (typeof json.tradesTotalBefore !== "number" || !Number.isFinite(json.tradesTotalBefore)) {
    return { ok: false, reason: "계획에 tradesTotalBefore 가 없습니다 (전체 행수 대조를 못 합니다)." };
  }
  const gen = json.createdAt ? Date.parse(String(json.createdAt)) : Number.NaN;
  if (!Number.isFinite(gen)) {
    return { ok: false, reason: "계획에 createdAt 이 없습니다 (언제 만든 계획인지 알 수 없습니다)." };
  }
  const hours = (now.getTime() - gen) / 3600000;
  if (hours > 24) {
    return { ok: false, reason: `계획이 ${hours.toFixed(1)}시간 전 것입니다 (24시간 초과) — 미리보기를 다시 만드세요.` };
  }
  if (hours < -1) {
    return { ok: false, reason: "계획의 createdAt 이 미래입니다 — 파일이 손으로 고쳐졌습니다." };
  }
  // 범위 안에 fail-close 버킷이 하나라도 있으면 통째로 거부한다.
  const scoped = json.buckets.filter((/** @type {any} */ b) => inScope(only, b.kind, b.name));
  if (scoped.length === 0) {
    return { ok: false, reason: `--only=${only ?? "(전체)"} 범위에 해당하는 버킷이 계획에 없습니다.` };
  }
  // ⚠️ `passes === false` 만 막으면 **`passes` 필드가 아예 없는** 손편집 계획이 통과한다
  //    (`undefined !== false`). 통과의 근거는 "없지 않다"가 아니라 "명시적으로 참"이어야 한다.
  const failed = scoped.filter((/** @type {any} */ b) => b.passes !== true);
  if (failed.length > 0) {
    return {
      ok: false,
      reason: `통과로 표시되지 않은 버킷이 범위에 있습니다: ${failed.map((/** @type {any} */ b) => `${b.name}(passes=${JSON.stringify(b.passes)})`).join(", ")} — --only= 로 빼거나 원인을 먼저 보세요.`,
    };
  }

  // 불변식 — 지울 id 와 남겨 고칠 id 가 겹치면 계획 자체가 모순이다(세션550 리뷰 #4).
  const inv = checkPlanInvariants(scoped);
  if (inv.length > 0) return { ok: false, reason: inv.join(" · ") };
  return { ok: true, reason: "" };
}

/**
 * 계획의 **불변식** — 깨지면 반영하지 않는다.
 *
 * ① `deleteIds ∩ relabelIds = ∅` — 지울 행을 동시에 고칠 수는 없다.
 * ② 세종 버킷에서 `deleteIds ∩ keeper id = ∅` — keeper 는 남길 쪽이므로 절대 삭제 목록에 없어야 한다.
 *    keeper id 는 계획의 `relabelIds` 에서 `keptNullIds`(살아남은 null 행)를 뺀 것이다.
 *
 * ⚠️ 오늘 라이브에서는 둘 다 0건이다(keeper 11,790 = 묶음 11,790, 고유 인덱스가 같은 키의 keeper
 *    중복을 막는다). 그래서 **병합 로직을 넣지 않는다** — 대신 그 전제가 깨지면 조용히 지나가지
 *    않게 검사만 둔다. 검사가 걸리면 사람이 먼저 원인을 본다.
 *
 * @param {any[]} buckets 범위 안 버킷
 * @returns {string[]} 위반 문장(빈 배열 = 통과)
 */
export function checkPlanInvariants(buckets) {
  /** @type {string[]} */
  const problems = [];
  for (const b of buckets) {
    /** @type {Set<string>} */
    const del = new Set((b.deleteIds ?? []).map(String));
    /** @type {string[]} */
    const rel = (b.relabelIds ?? []).map(String);
    const both = rel.filter((/** @type {string} */ id) => del.has(id));
    if (both.length > 0) {
      problems.push(`${b.name}: 삭제·표기변경 목록에 같이 든 id ${both.length}건 (예: ${both.slice(0, 5).join(", ")})`);
    }
    if (b.kind === "sejong") {
      /** @type {Set<string>} */
      const kept = new Set((b.keptNullIds ?? []).map(String));
      const keepers = rel.filter((/** @type {string} */ id) => !kept.has(id));
      const doomed = keepers.filter((/** @type {string} */ id) => del.has(id));
      if (doomed.length > 0) {
        problems.push(`${b.name}: keeper 가 삭제 목록에 있습니다 ${doomed.length}건 (예: ${doomed.slice(0, 5).join(", ")})`);
      }
    }
  }
  return problems;
}

/**
 * 이 계획을 **파일로 남겨도 되는가** (계획 생성 측 게이트).
 *
 * `checkPlanInvariants` 를 직접 부르는 대신 이 함수를 두는 이유 = 계획 생성 경로는 DB 를 훑는
 * `runDryRun` 안에 있어 테스트가 못 지난다. 판정만 떼어 내면 "불변식을 어긴 계획은 저장되지
 * 않는다"를 배선째 시험할 수 있다 — 배선을 끊는 뮤테이션이 red 가 되는 자리다(세션550 2차 리뷰).
 *
 * @param {any[]} buckets
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function planWritability(buckets) {
  const problems = checkPlanInvariants(buckets);
  return { ok: problems.length === 0, problems };
}

/**
 * 계획을 파일로 쓴다 — **불변식을 통과한 계획만**.
 *
 * 검사와 쓰기를 한 함수에 묶는 이유 = 떼어 놓으면 검사를 건너뛰는 편집이 "저장은 그대로" 남겨
 * 모순된 계획이 사람 손에 들어간다. 여기서는 검사를 지우면 **쓰기도 같이 사라지므로** 그 편집이
 * 테스트에 바로 드러난다(세션550 2차 리뷰 M6d).
 *
 * @param {string} absPath 절대경로
 * @param {{ buckets: any[] }} plan
 * @returns {string} 쓴 경로
 * @throws 불변식을 어기면 쓰지 않고 throw
 */
export function writePlanFile(absPath, plan) {
  const inv = planWritability(plan.buckets ?? []);
  if (!inv.ok) {
    throw new Error(`불변식 위반으로 계획을 저장하지 않습니다 — ${inv.problems.join(" · ")}`);
  }
  writeFileSync(absPath, JSON.stringify(plan, null, 2), "utf8");
  return absPath;
}

/**
 * 계획에서 **반영할 id 만** 뽑는다 — 여기서 판정을 다시 하지 않는다.
 * @param {any} json
 * @param {string | null} only
 * @returns {{ deleteIds: Array<number|string>, relabelIds: Array<number|string>,
 *   buckets: any[] }}
 */
export function selectPlanIds(json, only = null) {
  const buckets = json.buckets.filter((/** @type {any} */ b) => inScope(only, b.kind, b.name));
  /** @type {Array<number|string>} */
  const deleteIds = [];
  /** @type {Array<number|string>} */
  const relabelIds = [];
  for (const b of buckets) {
    for (const id of b.deleteIds ?? []) deleteIds.push(id);
    for (const id of b.relabelIds ?? []) relabelIds.push(id);
  }
  return { deleteIds, relabelIds, buckets };
}

/**
 * 전제 검사 표본의 판정 — **이어달리기(resume)를 막지 않으면서** 진짜 전제 위반은 잡는다.
 *
 * 앞 회차가 중간에 끊기면 그 회차가 이미 지운 행은 **없다**. 그걸 실패로 세면 같은 계획을
 * 다시 돌릴 길이 영영 막힌다(실측: 표본 200건 중 72건이 목록 앞 10% 에 있다 — 앞부분만
 * 지워진 상태에서 재실행하면 전부 "없음"으로 잡혀 한 건도 못 고친다).
 *
 * 그래서 셋으로 가른다:
 * - **없음** → 이미 처리됨(정상). 지우려던 행이 사라진 것은 우리가 원하던 결과다.
 * - **있는데 region/gu 가 계획과 다름** → 진짜 전제 위반(다른 세션이 건드렸다). 실패.
 * - 있고 값도 같음 → 아직 안 지워짐(정상).
 *
 * @param {Array<{ id: string | number, region: string | null, gu: string | null }>} found 실제 조회된 행
 * @param {Array<number|string>} sampled 조회를 요청한 id
 * @param {Map<string, { region: string, gu: string | null }>} want 계획이 기대하는 버킷
 * @returns {{ gone: number, ok: number, bad: string[] }}
 */
export function classifySample(found, sampled, want) {
  const got = new Map(found.map((r) => [String(r.id), r]));
  /** @type {string[]} */
  const bad = [];
  let gone = 0;
  let ok = 0;
  for (const id of sampled) {
    const key = String(id);
    const r = got.get(key);
    if (!r) { gone++; continue; } // 이미 처리됨 — 실패가 아니다
    const w = want.get(key);
    if (!w) { ok++; continue; }
    if (r.region !== w.region || (r.gu ?? null) !== (w.gu ?? null)) {
      bad.push(`${id}(${r.region}|${r.gu ?? "null"} ≠ 계획 ${w.region}|${w.gu ?? "null"})`);
    } else ok++;
  }
  return { gone, ok, bad };
}

/**
 * 표기변경 대상의 판정 — 이어달리기에서 **이미 고쳐진 행**과 **이상한 행**을 가른다.
 *
 * - 이미 `relabelTo` 면 → 완료(정상).
 * - 없거나 제3의 gu 면 → 실패. 이 목록의 행은 **남길 쪽**이라 사라졌다는 건 사고다
 *   (삭제 대상과 달리 "없음"이 정상일 수 없다).
 *
 * @param {Array<{ id: string | number, gu: string | null }>} found
 * @param {Array<number|string>} targets
 * @param {string} relabelTo
 * @param {string | null} fromGu 계획이 기대하는 원래 표기(세종 keeper). null 이면 원래 값을 안 따진다.
 * @returns {{ done: number, todo: Array<number|string>, bad: string[] }}
 */
export function classifyRelabel(found, targets, relabelTo, fromGu = null) {
  const got = new Map(found.map((r) => [String(r.id), r]));
  /** @type {Array<number|string>} */
  const todo = [];
  /** @type {string[]} */
  const bad = [];
  let done = 0;
  for (const id of targets) {
    const r = got.get(String(id));
    if (!r) { bad.push(`${id}(없음 — 남길 행이 사라졌습니다)`); continue; }
    if (r.gu === relabelTo) { done++; continue; }
    if (fromGu != null && r.gu !== fromGu) { bad.push(`${id}(gu=${r.gu ?? "null"} — 계획의 ${fromGu} 도 ${relabelTo} 도 아닙니다)`); continue; }
    todo.push(id);
  }
  return { done, todo, bad };
}

/**
 * 반영 뒤 되읽기 판정 — 남으면 안 되는 것을 문장으로(빈 배열 = 통과).
 *
 * ⚠️ count 가 null 이면 **실패**다. Supabase 의 `head:true` 조회는 표가 없거나 조회가 어긋나도
 * `count: null` 을 조용히 돌려준다 — `?? 0` 으로 받으면 "0건 = 성공"으로 뒤집힌다
 * (`probe-must-be-self-verified.md` §4-1). 네 검사 **전부**에 같은 잣대를 쓴다 —
 * `relabelLeft` 만 `!= null` 로 봐주면 조회가 실패했을 때 조용히 통과한다(세션550 리뷰 #5).
 *
 * @param {{ stillThere?: number | null, bucketLeft?: Array<{ name: string, left: number | null, expected: number }>,
 *   relabelLeft?: number | null, relabelChecked?: boolean,
 *   totalAfter?: number | null, totalExpected?: number }} r
 * @returns {string[]}
 */
export function verifyAfterApply(r) {
  /** @type {string[]} */
  const problems = [];
  if (r.stillThere == null) problems.push("삭제 확인 실패 — count 가 null (0 으로 읽지 않습니다)");
  else if (r.stillThere > 0) problems.push(`삭제했어야 할 행 ${r.stillThere}건이 아직 있습니다`);

  for (const b of r.bucketLeft ?? []) {
    if (b.left == null) problems.push(`${b.name}: 잔여 재조회 실패 — count 가 null`);
    else if (b.left !== b.expected) problems.push(`${b.name}: 잔여 ${b.left}행 (기대 ${b.expected}행)`);
  }

  // 세종 계획을 반영했으면 옛 표기는 0행이어야 한다. 조회가 실패(null)해도 **실패**다.
  if (r.relabelChecked) {
    if (r.relabelLeft == null) problems.push("표기변경 확인 실패 — count 가 null (0 으로 읽지 않습니다)");
    else if (r.relabelLeft > 0) problems.push(`표기를 바꿨어야 할 행 ${r.relabelLeft}건이 옛 표기 그대로입니다`);
  }

  if (r.totalExpected != null) {
    if (r.totalAfter == null) problems.push("전체 행수 재조회 실패 — count 가 null");
    else if (r.totalAfter !== r.totalExpected) {
      problems.push(`trades 전체 ${r.totalAfter}행 (기대 ${r.totalExpected}행)`);
    }
  }
  return problems;
}

// ── DB 조회 ────────────────────────────────────────────────────
// ⚠️ select 컬럼은 호출 자리에 **문자열 리터럴로** 적는다(세션547) — 상수로 넘기면 정적 가드
//    `_selectall-keycol-coverage.test.mjs` 가 커서 키("id")를 못 읽어 위반으로 판정한다.
// ⚠️ `trades` 는 100만행이 넘는다 — `selectAll(..., "id")` 고유키 커서가 **필수**다.
//    무정렬 `.range` 는 에러 없이 행을 잃는다(`unordered-pagination-loses-rows.md`).

/**
 * 버킷 하나의 행 전부 + 같은 필터의 `count: "exact"`. 둘이 다르면 페이징이 샌 것이다(§4 대조).
 * @param {any} sb
 * @param {string} region
 * @param {string | null} gu null 이면 `gu IS NULL`
 * @returns {Promise<{ rows: TradeRow[], count: number | null }>}
 */
async function fetchBucket(sb, region, gu) {
  const rows = /** @type {TradeRow[]} */ (
    await selectAll(
      (s) => {
        const q = s
          .from("trades")
          .select("id, region, gu, dong, deal_month, area, price, floor, trade_type, apt_name, cancel_date, recorded_at")
          .eq("region", region);
        return gu == null ? q.is("gu", null) : q.eq("gu", gu);
      },
      sb,
      "id",
    )
  );
  const base = sb.from("trades").select("*", { count: "exact", head: true }).eq("region", region);
  const { count, error } = await (gu == null ? base.is("gu", null) : base.eq("gu", gu));
  if (error) {
    logError(PHASE, `${region}|${gu ?? "(null)"} count 조회 실패: ${error.message}`);
    return { rows, count: null };
  }
  return { rows, count };
}

/**
 * `id` 묶음이 아직 있는지 센다 — 반영 뒤 "정말 지워졌나" 확인용.
 * @param {any} sb
 * @param {Array<number|string>} ids
 * @returns {Promise<number | null>}
 */
async function countExistingIds(sb, ids) {
  let total = 0;
  for (const chunk of chunkIds(ids)) {
    const { count, error } = await sb
      .from("trades").select("*", { count: "exact", head: true }).in("id", chunk);
    if (error) { logError(PHASE, `id 확인 실패: ${error.message}`); return null; }
    if (count == null) { logError(PHASE, "id 확인 실패 — count 가 null"); return null; }
    total += count;
  }
  return total;
}

/**
 * 전체 행수.
 * @param {any} sb
 * @returns {Promise<number | null>}
 */
async function countAll(sb) {
  const { count, error } = await sb.from("trades").select("*", { count: "exact", head: true });
  if (error) { logError(PHASE, `전체 행수 조회 실패: ${error.message}`); return null; }
  return count;
}

/**
 * `trade-stats.mjs` 와 **같은 필터**로 세종 6개월 거래 건수를 센다 — 화면 숫자의 예측값.
 * (`statsKey` 가 세종을 gu 무시하고 한 버킷으로 접으므로 gu 조건 없이 region 만 본다.)
 * @param {TradeRow[]} rows 세종 전 행
 * @param {string} cutoff6mYM
 * @param {Set<string> | null} removedIds 삭제될 id (null 이면 현재 상태)
 * @returns {number}
 */
export function countSejongRecent6m(rows, cutoff6mYM, removedIds = null) {
  return rows.filter((t) => {
    if (removedIds && removedIds.has(String(t.id))) return false;
    if (t.cancel_date != null) return false;
    if (!(t.trade_type === "sale" || t.trade_type === "매매" || !t.trade_type)) return false;
    return String(t.deal_month ?? "") >= cutoff6mYM;
  }).length;
}

/**
 * 6개월 컷오프 — `trade-stats.mjs` 의 `monthsAgo(6)` + `YYYYMM` 자르기와 같은 계산.
 * @param {Date} [now]
 * @returns {string}
 */
export function cutoff6mYM(now = new Date()) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10).replace(/-/g, "").slice(0, 6);
}

// ── 메인 ───────────────────────────────────────────────────────
/**
 * @param {string[]} argv
 */
export async function main(argv = process.argv.slice(2)) {
  loadEnv();
  const args = parseArgs(argv);
  if (args.error) { logError(PHASE, args.error); process.exit(1); }
  const sb = getSupabase();

  if (args.applyFrom) {
    const code = await runApplyFrom(sb, args);
    if (code !== 0) process.exit(code);
    return;
  }
  return await runDryRun(sb, args);
}

/**
 * @param {any} sb
 * @param {ReturnType<typeof parseArgs>} args
 */
async function runDryRun(sb, args) {
  log(PHASE, `=== dry-run (읽기만) · 범위 ${args.only ?? "전체"} ===`);
  const tradesTotalBefore = await countAll(sb);
  log(PHASE, `trades 전체 ${tradesTotalBefore ?? "(count 없음)"}행`);

  /** @type {any[]} */
  const buckets = [];
  /** @type {Record<string, any>} */
  const extra = {};

  // ── 세종 ──
  const sejongName = bucketName({ region: SEJONG.region, gu: SEJONG.dupGu });
  if (inScope(args.only, "sejong", sejongName)) {
    const dup = await fetchBucket(sb, SEJONG.region, SEJONG.dupGu);
    const keep = await fetchBucket(sb, SEJONG.region, SEJONG.keeperGu);
    log(PHASE, `세종 사본(gu=null) ${dup.rows.length}행 (count ${dup.count ?? "?"}) · ` +
      `keeper(${SEJONG.keeperGu}) ${keep.rows.length}행 (count ${keep.count ?? "?"})`);
    const fetchOk = dup.count === dup.rows.length && keep.count === keep.rows.length;
    if (!fetchOk) {
      logError(PHASE, "⚠️ 받은 행수와 count 가 다릅니다 — 페이징이 샜습니다. 계획을 쓰지 마세요.");
    }
    const all = [...dup.rows, ...keep.rows];
    const p = planSejong(all, SEJONG.keeperGu, SEJONG.relabelTo);
    const cut = cutoff6mYM();
    const before6m = countSejongRecent6m(all, cut);
    const after6m = countSejongRecent6m(all, cut, new Set(p.deleteIds.map(String)));
    log(PHASE, `  묶음 ${p.groups}개 · keeper 없는 묶음 ${p.orphanGroups}개 · ` +
      `삭제 ${p.deleteIds.length}행 · 표기변경 ${p.relabelIds.length}행 · ` +
      `표기 못 옮김 ${p.relabelBlocked}행 (고유 인덱스 충돌)`);
    log(PHASE, `  세종 6개월 거래(cutoff ${cut}): ${before6m}건 → ${after6m}건`);
    buckets.push({
      kind: "sejong", name: sejongName, region: SEJONG.region, dupGu: SEJONG.dupGu,
      keeperGu: SEJONG.keeperGu, relabelTo: SEJONG.relabelTo,
      total: dup.rows.length, countExact: dup.count, keeperTotal: keep.rows.length,
      keeperCountExact: keep.count, fetchOk,
      groups: p.groups, orphanGroups: p.orphanGroups,
      deleteIds: p.deleteIds, relabelIds: p.relabelIds, keptNullIds: p.keptNullIds,
      relabelBlocked: p.relabelBlocked, nonTwin: 0, nonTwinSamples: [],
      expectedLeft: dup.rows.length - p.deleteIds.length,
      passes: p.passes && fetchOk,
    });
    extra.sejongRecent6m = { cutoff: cut, before: before6m, after: after6m };
  }

  // ── 죽은 사본 버킷 ──
  for (const tb of TWIN_BUCKETS) {
    const name = bucketName(tb.from);
    if (!inScope(args.only, "twin", name)) continue;
    const from = await fetchBucket(sb, tb.from.region, tb.from.gu);
    /** @type {TradeRow[]} */
    const targetRows = [];
    /** @type {Array<{ name: string, rows: number, count: number | null }>} */
    const targetInfo = [];
    let targetsOk = true;
    for (const t of tb.targets) {
      const got = await fetchBucket(sb, t.region, t.gu);
      targetRows.push(...got.rows);
      targetInfo.push({ name: bucketName(t), rows: got.rows.length, count: got.count });
      if (got.count !== got.rows.length) targetsOk = false;
    }
    const fetchOk = from.count === from.rows.length && targetsOk;
    if (!fetchOk) {
      logError(PHASE, `⚠️ ${name}: 받은 행수와 count 가 다릅니다 — 페이징이 샜습니다.`);
    }
    const p = planTwinBucket(from.rows, targetRows);
    log(PHASE, `${name.padEnd(16)} ${String(p.total).padStart(6)}행 · 쌍둥이 ${String(p.twins).padStart(6)} · ` +
      `비율 ${(p.ratio * 100).toFixed(2)}% · 삭제 ${String(p.deleteIds.length).padStart(6)} · ` +
      `비쌍둥이 ${p.nonTwin} → ${p.passes ? "통과" : "중단(fail-close)"} ` +
      `[대상 ${targetInfo.map((t) => `${t.name}=${t.rows}`).join(" + ")}]`);
    if (!p.passes) {
      for (const r of p.nonTwinSamples.slice(0, 5)) {
        log(PHASE, `     쌍둥이 없음 표본 id=${r.id} ${r.dong ?? ""} ${r.deal_month ?? ""} ${r.trade_type ?? ""} ${r.area ?? ""}㎡ ${r.price ?? ""} ${r.floor ?? ""}층`);
      }
    }
    buckets.push({
      kind: "twin", name, from: tb.from, targets: tb.targets, targetInfo,
      total: p.total, countExact: from.count, fetchOk,
      twins: p.twins, ratio: p.ratio,
      deleteIds: p.deleteIds, relabelIds: [],
      nonTwin: p.nonTwin,
      nonTwinSamples: p.nonTwinSamples.slice(0, 20).map((r) => ({
        id: r.id, region: r.region, gu: r.gu, dong: r.dong, deal_month: r.deal_month,
        trade_type: r.trade_type, area: r.area, price: r.price, floor: r.floor, apt_name: r.apt_name,
      })),
      expectedLeft: p.total - p.deleteIds.length,
      passes: p.passes && fetchOk,
    });
  }

  const totalDelete = buckets.reduce((s, b) => s + b.deleteIds.length, 0);
  const totalRelabel = buckets.reduce((s, b) => s + b.relabelIds.length, 0);
  log(PHASE, `합계: 삭제 ${totalDelete}행 · 표기변경 ${totalRelabel}행 · ` +
    `fail-close 버킷 ${buckets.filter((b) => !b.passes).length}개`);

  const plan = {
    createdAt: new Date().toISOString(),
    only: args.only,
    tradesTotalBefore,
    totalDelete,
    totalRelabel,
    buckets,
    ...extra,
  };
  if (args.outPath) {
    // ⚠️ 불변식 검사와 저장은 **한 함수 안**이다. 둘을 떼어 놓으면 검사를 건너뛰는 편집이
    //    "저장은 그대로" 남겨 모순된 계획이 파일로 나간다(세션550 2차 리뷰 M6d).
    try {
      const abs = writePlanFile(resolve(args.outPath), plan);
      log(PHASE, `계획 저장: ${abs}`);
    } catch (err) {
      logError(PHASE, err instanceof Error ? err.message : String(err));
      logError(PHASE, "계획이 모순입니다 — 원인을 먼저 보세요.");
      process.exit(1);
    }
  }
  log(PHASE, "dry-run 완료 — 쓰기 없음 (--apply-from=<계획> --apply 로 반영)");
}

/**
 * 검토한 계획 파일 그대로 반영 — **재분석 0**.
 *
 * ## 왜 `process.exit` 대신 종료코드를 돌려주나 (세션550 리뷰 #1)
 *
 * 옛 판본은 이 함수 안에서 바로 `process.exit` 을 불러 **테스트가 한 줄도 못 지났다**. 그래서
 * "삭제 묶음에 keeper 를 끼워 넣는" 뮤테이션이 57/57 초록으로 통과했다 — 쓰기 경로에 가드가
 * 하나도 없었다는 뜻이다. 이제 클라이언트를 인자로 받고 종료코드를 **돌려주므로**, 가짜
 * 클라이언트로 실제 경로를 그대로 태워 "무엇을 지우고 무엇을 고치는지"를 단언할 수 있다.
 *
 * ## 이어달리기 (세션550 리뷰 #2)
 *
 * 중간에 끊긴 회차를 같은 계획으로 다시 돌릴 수 있어야 한다. 그래서 **이미 없는 삭제 대상**과
 * **이미 고쳐진 표기 대상**은 실패가 아니라 "이미 처리됨"으로 센다. 대신 전체 행수 대조는
 * 계획의 `tradesTotalBefore` 가 아니라 **이번 회차 시작 시점의 실제 총수**를 쓴다 — 앞 회차가
 * 이미 지운 만큼은 이번 회차의 책임이 아니기 때문이다.
 *
 * @param {any} sb
 * @param {ReturnType<typeof parseArgs>} args
 * @returns {Promise<number>} 종료코드 (0 = 성공)
 */
export async function runApplyFrom(sb, args) {
  const abs = resolve(String(args.applyFrom));
  if (!existsSync(abs)) { logError(PHASE, `--apply-from 파일 없음: ${abs}`); return 1; }
  const json = JSON.parse(readFileSync(abs, "utf8"));
  log(PHASE, `=== apply-from ${abs} · ${args.apply ? "APPLY (쓰기)" : "미리보기"} · 범위 ${args.only ?? "전체"} ===`);

  const chk = checkPlan(json, args.only);
  if (!chk.ok) { logError(PHASE, `계획 거부: ${chk.reason}`); return 1; }

  const { deleteIds, relabelIds, buckets } = selectPlanIds(json, args.only);
  log(PHASE, `계획 생성 ${json.createdAt} · 삭제 ${deleteIds.length}행 · 표기변경 ${relabelIds.length}행 · 버킷 ${buckets.length}개`);
  for (const b of buckets) {
    log(PHASE, `  ${String(b.name).padEnd(16)} 삭제 ${String((b.deleteIds ?? []).length).padStart(6)} · ` +
      `표기변경 ${String((b.relabelIds ?? []).length).padStart(6)} · 잔여기대 ${b.expectedLeft}`);
  }

  // 전제 검사 — 표본의 region/gu 가 계획을 만들 때와 같은가. 그 사이 다른 세션이 건드렸으면 멈춘다.
  // ⚠️ "없음" 은 실패가 아니다(앞 회차가 이미 지웠다) — `classifySample` 이 가른다.
  const sample = sampleIds(deleteIds, 200);
  if (sample.length > 0) {
    const want = wantedBuckets(buckets);
    const found = await fetchRowsByIds(sb, sample);
    if (found == null) { logError(PHASE, "전제 검사 조회 실패 — 중단합니다"); return 1; }
    const cls = classifySample(found, sample, want);
    if (cls.bad.length > 0) {
      logError(PHASE, `전제 검사 실패 ${cls.bad.length}건 — 계획 생성 뒤 DB 가 바뀌었습니다: ${cls.bad.slice(0, 10).join(", ")}`);
      return 1;
    }
    log(PHASE, `전제 검사 통과 (표본 ${sample.length}건 · 그대로 ${cls.ok}건 · 이미 처리됨 ${cls.gone}건)`);
  }

  // keeper 수가 그대로인가 — 세종 계획이 범위에 있을 때만.
  // 이어달리기에서는 keeper 가 이미 새 표기로 옮겨졌을 수 있으므로 **옛 표기 + 새 표기** 를 함께 센다.
  const sejongBucket = buckets.find((/** @type {any} */ b) => b.kind === "sejong");
  const relabelTo = sejongBucket?.relabelTo ?? SEJONG.relabelTo;
  if (sejongBucket) {
    const oldN = await countByGu(sb, sejongBucket.region, sejongBucket.keeperGu);
    const newN = await countByGu(sb, sejongBucket.region, relabelTo);
    if (oldN == null || newN == null) { logError(PHASE, "keeper 수 조회 실패 (count null)"); return 1; }
    if (oldN + newN !== sejongBucket.keeperTotal) {
      logError(PHASE, `keeper 수가 달라졌습니다: 계획 ${sejongBucket.keeperTotal} → 지금 ${oldN}(옛 표기)+${newN}(새 표기)=${oldN + newN}`);
      return 1;
    }
    log(PHASE, `keeper 수 동일 (${oldN + newN}행 — 옛 표기 ${oldN} · 이미 옮김 ${newN})`);
  }

  // ⚠️ 전체 행수 기준은 **이번 회차 시작 시점**이다(계획의 tradesTotalBefore 가 아니다).
  const totalBefore = await countAll(sb);
  if (!args.apply) {
    log(PHASE, "미리보기 완료 — 쓰기 없음 (--apply 를 함께 주면 반영)");
    return 0;
  }

  // ── 여기부터만 쓰기 ──
  // 순서 고정: **삭제 먼저, 표기변경 나중**. 반대로 하면 옮긴 행이 고유 인덱스를 먼저 밟는다.
  let deleted = 0;
  let alreadyGone = 0;
  for (const chunk of chunkIds(deleteIds, ID_CHUNK)) {
    // ⚠️ `chunk.length` 를 더하면 **낙관적 집계**다 — 실제로 몇 행이 지워졌는지는 반환값만 안다.
    const { data, error } = await sb.from("trades").delete().in("id", chunk).select("id");
    if (error) { logError(PHASE, `삭제(${chunk.length}행): ${error.message}`); return 1; }
    const got = (data ?? []).length;
    deleted += got;
    if (got < chunk.length) {
      // 모자란 몫이 "앞 회차가 이미 지운 행" 인지 확인한다 — 그게 아니면 멈춘다.
      const missing = new Set(chunk.map(String));
      for (const r of data ?? []) missing.delete(String(r.id));
      const still = await fetchRowsByIds(sb, [...missing]);
      if (still == null) { logError(PHASE, "삭제 차이 확인 조회 실패 — 중단합니다"); return 1; }
      if (still.length > 0) {
        logError(PHASE, `삭제했어야 할 ${still.length}행이 그대로 남았습니다 (예: ${still.slice(0, 5).map((r) => r.id).join(", ")})`);
        return 1;
      }
      alreadyGone += missing.size;
    }
  }
  log(PHASE, `삭제 ${deleted}행 (이미 처리됨 ${alreadyGone}행)`);

  // 표기변경 — 이미 새 표기인 행은 건너뛰고, 사라졌거나 제3의 표기면 멈춘다.
  let relabelled = 0;
  let relabelDone = 0;
  for (const chunk of chunkIds(relabelIds, ID_CHUNK)) {
    const found = await fetchRowsByIds(sb, chunk);
    if (found == null) { logError(PHASE, "표기변경 대상 조회 실패 — 중단합니다"); return 1; }
    const cls = classifyRelabel(found, chunk, relabelTo, null);
    if (cls.bad.length > 0) {
      logError(PHASE, `표기변경 대상 이상 ${cls.bad.length}건: ${cls.bad.slice(0, 5).join(", ")}`);
      return 1;
    }
    relabelDone += cls.done;
    if (cls.todo.length === 0) continue;
    const { data, error } = await sb.from("trades").update({ gu: relabelTo }).in("id", cls.todo).select("id");
    if (error) { logError(PHASE, `표기변경(${cls.todo.length}행): ${error.message}`); return 1; }
    const got = (data ?? []).length;
    if (got < cls.todo.length) {
      logError(PHASE, `표기변경이 ${cls.todo.length}행 중 ${got}행만 반영됐습니다 — 중단합니다`);
      return 1;
    }
    relabelled += got;
  }
  log(PHASE, `표기변경 ${relabelled}행 → ${relabelTo} (이미 처리됨 ${relabelDone}행)`);

  // ── 되읽기 대조 ──
  const stillThere = await countExistingIds(sb, deleteIds);
  /** @type {Array<{ name: string, left: number | null, expected: number }>} */
  const bucketLeft = [];
  for (const b of buckets) {
    const region = b.kind === "sejong" ? b.region : b.from.region;
    const gu = b.kind === "sejong" ? b.dupGu : b.from.gu;
    const count = await countByGu(sb, region, gu);
    // 세종 null 버킷의 기대 잔여 = 계획의 expectedLeft 에서 표기까지 옮긴 행을 뺀 값.
    let expected = b.expectedLeft;
    if (b.kind === "sejong") {
      const rel = new Set((b.relabelIds ?? []).map(String));
      const movedNull = (b.keptNullIds ?? []).filter((/** @type {any} */ id) => rel.has(String(id))).length;
      expected = b.expectedLeft - movedNull;
    }
    bucketLeft.push({ name: b.name, left: count, expected });
  }
  // 세종을 반영했으면 옛 표기는 0행이어야 한다 — 조회 실패(null)도 실패로 센다.
  const relabelLeft = sejongBucket ? await countByGu(sb, sejongBucket.region, sejongBucket.keeperGu) : null;
  const totalAfter = await countAll(sb);
  const problems = verifyAfterApply({
    stillThere, bucketLeft,
    relabelLeft, relabelChecked: !!sejongBucket,
    // 이번 회차가 **실제로** 지운 만큼만 줄어야 한다(이미 없던 행은 이번 회차가 지운 게 아니다).
    totalAfter, totalExpected: totalBefore == null ? undefined : totalBefore - deleted,
  });

  const report = {
    createdAt: new Date().toISOString(), source: abs, only: args.only,
    deleted, alreadyGone, relabelled, relabelDone, relabelTo,
    stillThere, bucketLeft, relabelLeft,
    totalBefore, totalAfter, verified: problems.length === 0, problems,
  };
  writeFileSync(`${abs}.applied.json`, JSON.stringify(report, null, 2), "utf8");
  log(PHASE, `반영 보고: ${abs}.applied.json`);

  if (problems.length) {
    logError(PHASE, `되읽기 결과가 기대와 다릅니다 — ${problems.join(" · ")}`);
    return 1;
  }
  log(PHASE, "apply 완료");
  return 0;
}

/**
 * 계획이 기대하는 버킷 — 삭제 대상 id → {region, gu}.
 * @param {any[]} buckets
 * @returns {Map<string, { region: string, gu: string | null }>}
 */
export function wantedBuckets(buckets) {
  /** @type {Map<string, { region: string, gu: string | null }>} */
  const want = new Map();
  for (const b of buckets) {
    const region = b.kind === "sejong" ? b.region : b.from.region;
    const gu = b.kind === "sejong" ? b.dupGu : b.from.gu;
    for (const id of b.deleteIds ?? []) want.set(String(id), { region, gu });
  }
  return want;
}

/**
 * id 묶음으로 행을 읽는다. 조회 실패는 **null**(빈 배열과 구분해야 한다 — 빈 배열은 "다 지워졌다").
 * @param {any} sb
 * @param {Array<number|string>} ids
 * @returns {Promise<Array<{ id: string|number, region: string|null, gu: string|null }> | null>}
 */
async function fetchRowsByIds(sb, ids) {
  /** @type {Array<{ id: string|number, region: string|null, gu: string|null }>} */
  const out = [];
  for (const chunk of chunkIds(ids, ID_CHUNK)) {
    const { data, error } = await sb.from("trades").select("id, region, gu").in("id", chunk);
    if (error) { logError(PHASE, `조회 실패: ${error.message}`); return null; }
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * region + gu 한 버킷의 행수. 실패·null 은 그대로 null 로 돌려준다(0 으로 읽지 않는다).
 * @param {any} sb
 * @param {string} region
 * @param {string | null} gu
 * @returns {Promise<number | null>}
 */
async function countByGu(sb, region, gu) {
  const base = sb.from("trades").select("*", { count: "exact", head: true }).eq("region", region);
  const { count, error } = await (gu == null ? base.is("gu", null) : base.eq("gu", gu));
  if (error) { logError(PHASE, `${region}|${gu ?? "(null)"} 조회 실패: ${error.message}`); return null; }
  return count ?? null;
}

/**
 * 처음·끝·가운데를 고루 뽑는다 — 앞쪽만 보면 뒤쪽 변경을 놓친다.
 * @param {Array<number|string>} ids
 * @param {number} n
 * @returns {Array<number|string>}
 */
export function sampleIds(ids, n = 200) {
  if (ids.length <= n) return [...ids];
  const head = ids.slice(0, Math.floor(n / 3));
  const tail = ids.slice(-Math.floor(n / 3));
  /** @type {Array<number|string>} */
  const mid = [];
  const want = n - head.length - tail.length;
  const step = Math.max(1, Math.floor(ids.length / (want + 1)));
  for (let i = step; i < ids.length && mid.length < want; i += step) mid.push(ids[i]);
  return [...new Set([...head, ...mid, ...tail].map(String))].map((s) => {
    const hit = ids.find((v) => String(v) === s);
    return hit === undefined ? s : hit;
  });
}

// (`checkSampleUnchanged` 는 세션550 리뷰 #2 로 `wantedBuckets` + `fetchRowsByIds` +
//  `classifySample` 셋으로 갈라졌다 — "없음" 을 실패로 세던 판정이 이어달리기를 막았기 때문이다.)

// 맨표기 버킷의 정식 이름이 `normalizeGu` 와 같은지는 **테스트**가 단언한다 — 여기서 쓰지만
// 링크만 남긴다(미사용 import 를 만들지 않기 위해 계획 단계에서 한 번 확인한다).
export { normalizeGu };

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
