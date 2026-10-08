// @ts-check
/**
 * SGIS 행정동 매핑 수집기 — 단지 좌표를 SGIS 행정동 코드 8자리로 바꿔 `apartments.sgis_emd_cd` 에 넣는다.
 *
 * 용도: SGIS 동네 통계(인구·가구·주택)는 SGIS 행정동 코드(시도2+시군구3+읍면동3, 시도 코드는 SGIS 자체 체계)로만
 *   조회된다. 법정동 `bjd_code` 와 체계가 달라 좌표로 한 번 역지오코딩해 칸에 둔다(빈칸만 채움 — 이미 채워진 행은 안 덮는다).
 *
 * 사용법:
 *   node scripts/collectors/sgis-map-emd.mjs --dry-run --impact-out=<절대경로>   (① 미리보기 — 첫 회차 전이표 재료)
 *   node scripts/collectors/sgis-map-emd.mjs --first-run --expect-ok=<N>         (② 첫 회차 — 승인한 숫자와 계획이 같을 때만 쓴다)
 *   node scripts/collectors/sgis-map-emd.mjs                                       (③ 평소 — 로컬 러너 매주 화요일, 새 단지만)
 *   인자(허용 목록 — 모르는 인자·조합은 던진다): --dry-run · --impact-out=<절대경로> · --limit=N · --budget-min=N(기본 60, 0=무제한)
 *     · --first-run 과 --expect-ok=N 은 함께만, --dry-run·--limit 과는 같이 못 쓴다(첫 회차는 전수만).
 *
 * 첫 회차 관문(세션614 메인 판정 · data-changing-run-approval §2 "승인한 숫자와 정확히 같을 때만"):
 *   러너는 합친 뒤 첫 화요일에 인자 없이 이 수집기를 부른다 — 마이그 적용·전이표 승인보다 앞설 수 있다.
 *   그래서 인자 없는 실행은 대상 조회 뒤·대조군 앞에서 `collector_runs` 에 이 수집기의 쓴 행(ok_count>0, status 무관)이 하나도 없으면
 *   **아무것도 쓰지 않고** skip 1 + errorMessage `FIRST_RUN_PENDING` 를 기록하고 exit 0 으로 끝난다.
 *   첫 회차는 사람이 ①의 전이표를 승인한 뒤 ②로 돌린다 — 전수 계획의 쓸 행 수가 N 과 다르면 한 행도 안 쓴다(exit 1).
 *
 * ⚠️ `--dry-run` 이면 `recordCollectorRun` 이 스스로 기록을 건너뛴다(_shared.mjs) — 미리보기는 기록 0 이 의도다.
 * ⚠️ 쓰기마다 `apartments.updated_at` 트리거(init 마이그 trg_apartments_updated)가 오른다 — `collect-maintenance.mjs` 가
 *   updated_at 오래된 순으로 회차를 고르므로 첫 회차 때 한 번 밀린다(세션614 메인 판정: 받아들임, 1회성).
 * ⚠️ 좌표가 바뀐 단지는 옛 코드가 남는다 — 재매핑은 후속(정정 도구가 좌표를 옮길 때 sgis_emd_cd 를 비우는 한 줄).
 * ⚠️ 마이그 전(칸 없음, PG 42703) 등으로 매핑 본체가 던지면 `runAndRecord` 가 받아 failure 1행(fail 1 · 사유)을 기록하고
 *   exit 1 이다(보완 W6 — 옛 판은 기록 0행으로 죽었다). Supabase 연결 자체가 안 되면 기록할 곳이 없어 exit 1 만 남는다.
 * ⚠️ `coord_shared = true`(좌표가 남의 단지와 공유 = 자리표시, 세션560) 행은 호출하지 않고 건너뛴다(보완 W3 —
 *   구청 같은 대표 좌표가 멀쩡한 행정동 코드를 받아 "맞는 것처럼" 저장되는 길을 막는다. 선례 calc-school-walk.mjs).
 * 기록 표시(감시 ⑱ checkSgisMapMarkers 가 읽는다): 관문 대기 = error_message `FIRST_RUN_PENDING` ·
 *   시도 불일치로 안 쓴 단지가 있으면 `SGIS_SIDO_MISMATCH=<N>`(status 는 그대로) — 상수·파서는 _shared.mjs.
 *
 * 외부 호출: 인증 1 + 대조군 1 + 대상 수(첫 회차 ≈ 2,6xx · 그 뒤 주당 새 단지 수). 호출 사이 0.2초.
 *   관문에 걸린 실행·대상 0건인 실행은 호출 0.
 *
 * 세션614 · 설계서 `.omc/artifacts/session614/plan-sgis-map-emd.md` §3(+ #3-가 첫 회차 관문)
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  loadEnv, getSupabase, log, logError, sleep, setupGracefulShutdown, recordCollectorRun, selectAll, budgetExceeded,
  joinRunMessage, formatSgisSidoMismatch, SGIS_FIRST_RUN_PENDING_MARKER,
} from "./_shared.mjs";
import { rgeocodeWgs84, SGIS_SIDO_CODE, SGIS_CALL_INTERVAL_MS } from "./_sgis-api.mjs";

const PHASE = "sgis-map-emd";

/** 연속 실패가 이만큼이면 중단(인증 만료·차단 신호). */
export const MAX_CONSECUTIVE_FAIL = 20;

/** 기본 예산(분). 남은 건 다음 화요일. */
export const DEFAULT_BUDGET_MIN = 60;

/** 첫 회차 관문에 걸린 실행의 collector_runs.error_message 표시(정본 = _shared.mjs — 감시 ⑱ 과 한 상수). */
export const FIRST_RUN_PENDING = SGIS_FIRST_RUN_PENDING_MARKER;

/**
 * 양성 대조군 — 실행 시작 때 1콜. 역삼1동 좌표가 이 코드가 아니면 즉시 중단(probe-must-be-self-verified).
 * 세션613 실측 원문(probe.log:18) = sido_cd 11 · sgg_cd 230 · emdong_cd 640.
 */
export const CONTROL = Object.freeze({ lat: 37.5006, lng: 127.0366, admCd: "11230640", label: "역삼1동" });

/**
 * 실행 인자를 읽는다(허용 목록 — `assign-complex-keys.mjs` parseArgs 패턴). 꼴이 틀리면 throw(DB·API 를 보기 전에 멈춘다).
 * @param {readonly string[]} argv process.argv 꼴(앞 2개는 node·스크립트)
 * @returns {{ dryRun: boolean, impactOut: string | null, limit: number | null, budgetMin: number,
 *   firstRun: boolean, expectOk: number | null }}
 */
export function parseArgs(argv) {
  let dryRun = false;
  let firstRun = false;
  /** @type {string | null} */
  let impactOut = null;
  /** @type {number | null} */
  let limit = null;
  /** @type {number | null} */
  let budgetMin = null;
  /** @type {number | null} */
  let expectOk = null;
  /** @type {string[]} */
  const unknown = [];
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--first-run") {
      if (firstRun) throw new Error("--first-run 이 두 번 나왔습니다");
      firstRun = true;
    } else if (a.startsWith("--expect-ok")) {
      const m = /^--expect-ok=(\d+)$/.exec(a);
      if (!m) throw new Error(`--expect-ok 에는 승인한 쓸 행 수(0 이상의 정수)가 필요합니다: ${a}`);
      if (expectOk != null) throw new Error("--expect-ok 이 두 번 나왔습니다");
      expectOk = Number(m[1]);
    } else if (a.startsWith("--impact-out")) {
      const m = /^--impact-out=(.+)$/.exec(a);
      if (!m) throw new Error(`--impact-out 에는 저장할 파일 경로가 필요합니다: ${a}`);
      if (impactOut != null) throw new Error("--impact-out 이 두 번 나왔습니다");
      if (!path.isAbsolute(m[1])) throw new Error(`--impact-out 은 절대경로로 줍니다: ${m[1]}`);
      impactOut = m[1];
    } else if (a.startsWith("--limit")) {
      const m = /^--limit=(\d+)$/.exec(a);
      if (!m || Number(m[1]) < 1) throw new Error(`--limit 에는 1 이상의 정수가 필요합니다: ${a}`);
      if (limit != null) throw new Error("--limit 이 두 번 나왔습니다");
      limit = Number(m[1]);
    } else if (a.startsWith("--budget-min")) {
      const m = /^--budget-min=(\d+)$/.exec(a);
      if (!m) throw new Error(`--budget-min 에는 0 이상의 정수(분)가 필요합니다: ${a}`);
      if (budgetMin != null) throw new Error("--budget-min 이 두 번 나왔습니다");
      budgetMin = Number(m[1]);
    } else {
      unknown.push(a);
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `모르는 인자: ${unknown.join(" ")} — 쓸 수 있는 것은 --dry-run · --impact-out=<절대경로> · --limit=N · --budget-min=N · --first-run --expect-ok=N 뿐입니다`,
    );
  }
  if (firstRun !== (expectOk != null)) {
    throw new Error("--first-run 과 --expect-ok=N 은 함께만 줍니다 — 첫 회차는 승인한 쓸 행 수와 계획이 같을 때만 씁니다");
  }
  if (firstRun && dryRun) {
    throw new Error("--first-run 과 --dry-run 은 같이 줄 수 없습니다 — 미리보기는 --dry-run --impact-out 으로만");
  }
  // 보완 2: 몇 행만 쓰고 관문이 열리면 다음 화요일 러너가 나머지 2,6xx행을 승인 없이 쓴다.
  if (firstRun && limit != null) {
    throw new Error("첫 회차는 전수만 — --limit 과 같이 못 쓴다. 몇 개만 시험하려면 --dry-run --limit");
  }
  return { dryRun, impactOut, limit, budgetMin: budgetMin ?? DEFAULT_BUDGET_MIN, firstRun, expectOk };
}

/**
 * @typedef {{ id: string, name?: string | null, region?: string | null, gu?: string | null,
 *   lat: number, lng: number, sgis_emd_cd?: string | null, coord_shared?: boolean | null }} AptRow
 * @typedef {import("./_sgis-api.mjs").RgeocodeResult} RgeocodeResult
 * @typedef {{ action: "write", admCd: string }
 *   | { action: "skip", reason: "none" }
 *   | { action: "skip", reason: "sido-mismatch", expected: readonly string[], sidoCd: string }} RowPlan
 */

/**
 * 한 단지의 판정(순수 함수). API 가 던진 경우(fail)는 호출자가 다룬다.
 *  - ok + 그 지역의 허용 시도 코드에 응답 sido_cd 가 있음 → write
 *  - ok + 시도 불일치(모르는 지역 포함) → skip sido-mismatch(자리표시·엉뚱한 좌표 신호 — 쓰지 않는다)
 *  - none → skip none(해상·국외 좌표 등)
 * @param {Pick<AptRow, "region">} apt
 * @param {RgeocodeResult} resp
 * @returns {RowPlan}
 */
export function planRow(apt, resp) {
  if (resp.kind !== "ok") return { action: "skip", reason: "none" };
  const expected = (apt.region != null && Object.prototype.hasOwnProperty.call(SGIS_SIDO_CODE, apt.region))
    ? SGIS_SIDO_CODE[apt.region]
    : [];
  if (!expected.includes(resp.sidoCd)) {
    return { action: "skip", reason: "sido-mismatch", expected, sidoCd: resp.sidoCd };
  }
  return { action: "write", admCd: resp.admCd };
}

/**
 * 첫 회차 관문 — 이 수집기가 **실제로 쓴** 기록(ok_count > 0)이 collector_runs 에 하나라도 있는가. status 는 보지 않는다.
 * ⚠️ 보완 W1: 옛 판은 status=success 만 셌다 — 첫 회차 2,6xx행 중 1행만 실패해도 status=failure 라 관문이 영영 안 열렸다.
 *   쓴 행이 있으면(failure·partial 이어도) 첫 회차는 지난 것이다.
 * @param {any} sb
 * @returns {Promise<{ done: boolean, error: string | null }>}
 */
export async function hasWrittenRun(sb) {
  const { data, error } = await sb
    .from("collector_runs")
    .select("collector")
    .eq("collector", PHASE)
    .gt("ok_count", 0)
    .limit(1);
  if (error) return { done: false, error: error.message ?? String(error) };
  return { done: Array.isArray(data) && data.length > 0, error: null };
}

/**
 * @typedef {{ ranAt: string, dryRun: boolean, total: number,
 *   planned: { ok: number, skipNone: number, skipSidoMismatch: number, skipCoordShared: number, fail: number },
 *   bySido: Record<string, number>,
 *   byRegionSido: Record<string, Record<string, number>>,
 *   byRegion: Record<string, { ok: number, skip: number, fail: number }>,
 *   sameCoordGroups: { groups: number, rows: number },
 *   sidoMismatch: Array<{ id: string, name: string | null, region: string | null, gu: string | null, sidoCd: string, fullAddr: string | null }>,
 *   sggMismatch: Array<{ id: string, name: string | null, region: string | null, gu: string | null, sggNm: string | null, admCd: string }>,
 *   sample: Array<{ id: string, name: string | null, admCd: string, emdNm: string | null }>,
 *   stopped: "interrupted" | "budget" | null,
 *   aborted: string | null }} Impact
 * @typedef {{ ok: number, fail: number, skip: number, total: number, stopped: "interrupted" | "budget" | null,
 *   aborted: string | null, pending: boolean, impact: Impact }} RunResult
 */

/**
 * 대상 중 좌표(소수 5자리)가 같은 묶음 — 자리표시 좌표 신호(placeholder-coordinates-truth-sources). 미리보기 보고용.
 * @param {ReadonlyArray<Pick<AptRow, "lat" | "lng">>} apts
 * @returns {{ groups: number, rows: number }} 2행 이상 묶음 수와 그 행 수 합
 */
export function countSameCoordGroups(apts) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const a of apts) {
    const k = `${Number(a.lat).toFixed(5)},${Number(a.lng).toFixed(5)}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  let groups = 0, rows = 0;
  for (const n of m.values()) if (n >= 2) { groups++; rows += n; }
  return { groups, rows };
}

/**
 * 우리 `gu` 가 응답 `sgg_nm` 과 맞나 — 우리 gu 의 낱말(공백 기준)이 **전부** 응답 sgg_nm 낱말에 있으면 맞음.
 * 예: "영통구" ↔ "수원시 영통구" 맞음 · "수원시 장안구" ↔ "수원시 영통구" 안 맞음. gu·sgg_nm 이 비면 판정 안 함(true).
 * 보고용(보완 W3) — 쓰기는 막지 않는다.
 * @param {string | null | undefined} gu
 * @param {string | null | undefined} sggNm
 * @returns {boolean}
 */
export function sggMatches(gu, sggNm) {
  if (!gu || !sggNm) return true;
  const have = new Set(String(sggNm).split(/\s+/).filter(Boolean));
  return String(gu).split(/\s+/).filter(Boolean).every((t) => have.has(t));
}

/**
 * 매핑 본체 — DB·API·시계를 주입받아 끝까지 돈다(시험이 네트워크 없이 같은 경로를 태운다).
 * 순서: 대상 조회 → (0건이면 끝) → (평소 실행만) 첫 회차 관문 → 대조군 1콜 → 단지마다 역지오코딩·판정(계획 — 응답은 메모리에, 재호출 없음)
 *   → (dry-run 이면 끝 · 첫 회차면 계획의 쓸 행 수 = 승인 숫자일 때만) 빈칸만 쓰기.
 * @param {{ sb: any, fetchImpl?: typeof fetch, dryRun: boolean, firstRun?: boolean, expectOk?: number | null,
 *   limit?: number | null, budgetMin?: number,
 *   startedMs?: number, isInterrupted?: () => boolean, sleepFn?: (ms: number) => Promise<void>,
 *   nowIso?: () => string, nowMs?: () => number }} opts
 * @returns {Promise<RunResult>}
 */
export async function runMapping(opts) {
  const {
    sb, fetchImpl, dryRun, firstRun = false, expectOk = null, limit = null, budgetMin = DEFAULT_BUDGET_MIN,
    startedMs = Date.now(), isInterrupted = () => false, sleepFn = sleep,
    nowIso = () => new Date().toISOString(), nowMs = () => Date.now(),
  } = opts;

  /** @type {Impact} */
  const impact = {
    ranAt: nowIso(), dryRun, total: 0,
    planned: { ok: 0, skipNone: 0, skipSidoMismatch: 0, skipCoordShared: 0, fail: 0 },
    bySido: {}, byRegionSido: {}, byRegion: {}, sameCoordGroups: { groups: 0, rows: 0 },
    sidoMismatch: [], sggMismatch: [], sample: [], stopped: null, aborted: null,
  };
  /** @param {Partial<RunResult>} r @returns {RunResult} */
  const done = (r) => ({ ok: 0, fail: 0, skip: 0, total: impact.total, stopped: null, aborted: null, pending: false, impact, ...r });

  // 세션534 패턴: 고유키(id) 커서 — 정렬 없는 OFFSET 은 큰 표에서 행을 잃는다.
  const all = /** @type {AptRow[]} */ (/** @type {unknown} */ (
    await selectAll(
      (s) => s
        .from("apartments")
        .select("id, name, region, gu, lat, lng, sgis_emd_cd, coord_shared")
        .not("lat", "is", null)
        .not("lng", "is", null)
        .is("sgis_emd_cd", null),
      sb,
      "id",
    )
  ));
  const apts = limit != null ? all.slice(0, limit) : all;
  impact.total = apts.length;
  impact.sameCoordGroups = countSameCoordGroups(apts);
  if (apts.length === 0) return done({});

  // 첫 회차 관문 — 평소(쓰기) 실행만, 대조군보다 앞(관문에 걸리면 SGIS 호출 0).
  //   미리보기는 쓰지 않고, --first-run 은 그 자체가 첫 회차라 건너뛴다.
  if (!dryRun && !firstRun) {
    const gate = await hasWrittenRun(sb);
    if (gate.error) {
      const reason = `첫 회차 관문 조회 실패 — ${gate.error}`;
      impact.aborted = reason;
      return done({ fail: 1, aborted: reason });
    }
    if (!gate.done) return done({ pending: true });
  }

  // 양성 대조군 — 응답 모양·코드 체계가 세션613 실측과 같은지 먼저 본다. 다르면 한 행도 쓰지 않는다.
  let controlCd = null;
  try {
    const c = await rgeocodeWgs84(CONTROL.lat, CONTROL.lng, { fetchImpl });
    controlCd = c.kind === "ok" ? c.admCd : "none";
  } catch (err) {
    controlCd = `throw: ${err instanceof Error ? err.message : String(err)}`;
  }
  await sleepFn(SGIS_CALL_INTERVAL_MS);
  if (controlCd !== CONTROL.admCd) {
    const reason = `SGIS 응답이 대조군과 다름 — ${CONTROL.label}(${CONTROL.lat}, ${CONTROL.lng}) 기대 ${CONTROL.admCd} · 받음 ${controlCd}`;
    impact.aborted = reason;
    return done({ fail: 1, aborted: reason });
  }

  let fail = 0, skip = 0, consecutiveFail = 0;
  /** @type {"interrupted" | "budget" | null} */
  let stopped = null;
  /** @type {string | null} */
  let aborted = null;
  /** @type {Array<{ apt: AptRow, admCd: string }>} */
  const toWrite = [];

  /** @param {string | null | undefined} region @param {"ok"|"skip"|"fail"} k */
  const bump = (region, k) => {
    const key = region ?? "(없음)";
    const r = impact.byRegion[key] ?? (impact.byRegion[key] = { ok: 0, skip: 0, fail: 0 });
    r[k]++;
  };

  // ── 1) 계획: 역지오코딩·판정만(쓰기 0) ──
  for (let i = 0; i < apts.length; i++) {
    if (isInterrupted()) { stopped = "interrupted"; break; }  // 세션344: graceful shutdown
    if (budgetExceeded(startedMs, budgetMin, nowMs())) { stopped = "budget"; break; }  // 남은 건 다음 화요일
    const apt = apts[i];
    // 보완 W3: 자리표시 좌표(남의 단지와 공유)는 부르지 않는다 — 대표 좌표가 멀쩡한 코드를 받아 "맞는 것처럼" 저장된다.
    if (apt.coord_shared === true) {
      skip++; impact.planned.skipCoordShared++; bump(apt.region, "skip");
      continue;
    }
    /** @type {RgeocodeResult} */
    let resp;
    try {
      resp = await rgeocodeWgs84(apt.lat, apt.lng, { fetchImpl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.id} ${apt.name ?? ""}: ${msg}`);
      fail++; impact.planned.fail++; bump(apt.region, "fail");
      consecutiveFail++;
      if (consecutiveFail >= MAX_CONSECUTIVE_FAIL) {
        aborted = `연속 실패 ${MAX_CONSECUTIVE_FAIL}회 — 중단(인증 만료·차단 의심)`;
        logError(PHASE, aborted);
        break;
      }
      await sleepFn(SGIS_CALL_INTERVAL_MS);
      continue;
    }
    consecutiveFail = 0;
    await sleepFn(SGIS_CALL_INTERVAL_MS);

    if (resp.kind === "ok") {
      impact.bySido[resp.sidoCd] = (impact.bySido[resp.sidoCd] ?? 0) + 1;
      // 보완 W5: 광주·전남이 SGIS 에서 어느 코드로 오는지 — 우리 지역별 응답 sido_cd 교차
      const rk = apt.region ?? "(없음)";
      const rs = impact.byRegionSido[rk] ?? (impact.byRegionSido[rk] = {});
      rs[resp.sidoCd] = (rs[resp.sidoCd] ?? 0) + 1;
    }
    const plan = planRow(apt, resp);
    if (plan.action === "skip") {
      skip++; bump(apt.region, "skip");
      if (plan.reason === "none") {
        impact.planned.skipNone++;
      } else {
        impact.planned.skipSidoMismatch++;
        const fullAddr = resp.kind === "ok" ? resp.fullAddr : null;
        log(PHASE, `[시도 불일치] ${apt.id} ${apt.region} 기대{${plan.expected.join(",")}} 응답 ${plan.sidoCd} ${fullAddr ?? ""}`);
        impact.sidoMismatch.push({
          id: apt.id, name: apt.name ?? null, region: apt.region ?? null, gu: apt.gu ?? null, sidoCd: plan.sidoCd, fullAddr,
        });
      }
      continue;
    }
    impact.planned.ok++;
    toWrite.push({ apt, admCd: plan.admCd });
    if (resp.kind === "ok" && !sggMatches(apt.gu, resp.sggNm)) {
      impact.sggMismatch.push({ id: apt.id, name: apt.name ?? null, region: apt.region ?? null, gu: apt.gu ?? null, sggNm: resp.sggNm, admCd: plan.admCd });
    }
    if (impact.sample.length < 20) {
      impact.sample.push({ id: apt.id, name: apt.name ?? null, admCd: plan.admCd, emdNm: resp.kind === "ok" ? resp.emdNm : null });
    }
    if ((i + 1) % 200 === 0) log(PHASE, `계획 진행: ${i + 1}/${apts.length} (쓸 예정 ${toWrite.length})`);
  }
  impact.aborted = aborted;
  impact.stopped = stopped;

  if (dryRun) {
    for (const w of toWrite) bump(w.apt.region, "ok");
    return done({ ok: toWrite.length, fail, skip, stopped, aborted });
  }
  if (aborted) return done({ fail, skip, stopped, aborted });

  // 첫 회차 — 끝까지 세운 계획의 쓸 행 수가 승인한 숫자와 정확히 같을 때만 쓴다(data-changing-run-approval §2).
  if (firstRun) {
    let reason = null;
    if (stopped) reason = `첫 회차 계획이 끝나지 않음(멈춤=${stopped}) — 아무것도 쓰지 않았습니다`;
    else if (toWrite.length !== expectOk) reason = `승인 ${expectOk} ≠ 계획 ${toWrite.length} — 아무것도 쓰지 않았습니다`;
    if (reason) {
      impact.aborted = reason;
      return done({ fail: Math.max(fail, 1), skip, stopped, aborted: reason });
    }
  }

  // ── 2) 쓰기: 빈칸만 — 그 사이 누가 채웠으면 안 덮는다(돌아온 행으로 센다) ──
  let ok = 0;
  for (const { apt, admCd } of toWrite) {
    if (isInterrupted()) { stopped = "interrupted"; impact.stopped = stopped; break; }  // 세션344: graceful shutdown
    const { data, error } = await sb
      .from("apartments")
      .update({ sgis_emd_cd: admCd, sgis_mapped_at: nowIso() })
      .eq("id", apt.id)
      .is("sgis_emd_cd", null)
      .select("id");
    if (error) {
      logError(PHASE, `${apt.id} 쓰기 실패: ${error.message}`);
      fail++; bump(apt.region, "fail");
      continue;
    }
    if (!data || data.length === 0) { skip++; bump(apt.region, "skip"); continue; }  // 이미 채워짐
    ok++; bump(apt.region, "ok");
  }
  return done({ ok, fail, skip, stopped, aborted: null });
}

/**
 * 실행 결과 → collector_runs 기록 내용과 종료 코드(순수 함수 — 시험 대상).
 *  - 첫 회차 관문 대기: skip 1 · success · errorMessage FIRST_RUN_PENDING · exit 0
 *  - 대상 0건: skip 1 · success · exit 0
 *    (skip=1 인 이유(세션555): monitor ② 는 ok===0 && skip===0 일 때만 운다 — "대상이 없어 안 했다" 가
 *     "아무것도 못 했다" 와 같은 신호가 되면 매주 거짓 경보. reverse-geocode.mjs·geocode-missing.mjs 와 쌍둥이)
 *  - 실패·중단(대조군·관문 조회·승인 숫자 불일치·연속 실패): failure · exit 1
 *  - 멈춤(중단 신호·예산): partial · exit 0 / 그 밖: success · exit 0
 *  - 시도 불일치로 안 쓴 단지가 있으면 error_message 끝에 `SGIS_SIDO_MISMATCH=<N>`(status 는 그대로 · 보완 W4 — 감시 ⑱ 이 읽는다)
 * dry-run 이면 recordCollectorRun 이 스스로 기록을 건너뛴다(_shared.mjs).
 * @param {RunResult} r
 * @returns {{ record: { ok: number, fail: number, skip: number, status: string, errorMessage?: string | null }, exitCode: number }}
 */
export function runOutcome(r) {
  if (r.pending) return { record: { ok: 0, fail: 0, skip: 1, status: "success", errorMessage: FIRST_RUN_PENDING }, exitCode: 0 };
  if (r.total === 0 && !r.aborted) return { record: { ok: 0, fail: 0, skip: 1, status: "success" }, exitCode: 0 };
  const bad = r.fail > 0 || r.aborted != null;
  const mismatch = r.impact?.planned?.skipSidoMismatch ?? 0;
  const errorMessage = joinRunMessage(r.aborted, mismatch > 0 ? formatSgisSidoMismatch(mismatch) : null) ?? null;
  return {
    record: { ok: r.ok, fail: r.fail, skip: r.skip, status: bad ? "failure" : (r.stopped ? "partial" : "success"), errorMessage },
    exitCode: bad ? 1 : 0,
  };
}

/**
 * 매핑 본체를 돌리고 결과를 기록한다 — 본체가 던져도 failure 1행을 남긴다(보완 W6). main 과 시험이 같은 길을 탄다.
 * @param {{ sb: any, args: ReturnType<typeof parseArgs>, fetchImpl?: typeof fetch, isInterrupted?: () => boolean,
 *   startedMs?: number, record?: typeof recordCollectorRun,
 *   writeImpact?: (path: string, text: string) => void }} deps
 * @returns {Promise<{ r: RunResult | null, exitCode: number }>}
 */
export async function runAndRecord(deps) {
  const {
    sb, args, fetchImpl, isInterrupted, startedMs = Date.now(), record = recordCollectorRun,
    writeImpact = (p, text) => writeFileSync(p, text, "utf8"),
  } = deps;
  const startedAt = new Date(startedMs).toISOString();
  const elapsedSec = () => ((Date.now() - startedMs) / 1000).toFixed(1);
  /** @type {RunResult} */
  let r;
  try {
    r = await runMapping({
      sb, fetchImpl, dryRun: args.dryRun, firstRun: args.firstRun, expectOk: args.expectOk,
      limit: args.limit, budgetMin: args.budgetMin, startedMs, isInterrupted,
    });
  } catch (err) {
    const msg = `매핑 실행 예외 — ${err instanceof Error ? err.message : String(err)}`;
    logError(PHASE, msg);
    await record(PHASE, { ok: 0, fail: 1, skip: 0, status: "failure", errorMessage: msg, elapsed: elapsedSec(), startedAt });
    return { r: null, exitCode: 1 };
  }

  if (args.impactOut) {
    writeImpact(args.impactOut, JSON.stringify(r.impact, null, 2));
    log(PHASE, `미리보기 저장: ${args.impactOut}`);
  }

  const out = runOutcome(r);
  if (r.pending) {
    log(PHASE, "첫 회차 대기 — 사람이 --dry-run --impact-out 전이표 승인 뒤 --first-run --expect-ok=<N> 으로 돌린다(이번 실행은 아무것도 쓰지 않았습니다)");
  } else if (r.total === 0 && !r.aborted) {
    log(PHASE, "대상 0건 — 좌표 있는 단지는 전부 매핑돼 있음");
  } else {
    const p = r.impact.planned;
    log(PHASE, `=== 완료: 대상 ${r.total} · 반영 ${r.ok}${args.dryRun ? "(예정)" : ""} · 건너뜀 ${r.skip}(결과 없음 ${p.skipNone} · 시도 불일치 ${p.skipSidoMismatch} · 자리표시 좌표 ${p.skipCoordShared}) · 실패 ${r.fail}${r.stopped ? ` · 멈춤=${r.stopped}` : ""} ===`);
    if (r.aborted) logError(PHASE, r.aborted);
  }
  await record(PHASE, { ...out.record, elapsed: elapsedSec(), startedAt });
  return { r, exitCode: out.exitCode };
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnv();
  if (!process.env.SGIS_CONSUMER_KEY || !process.env.SGIS_CONSUMER_SECRET) {
    logError(PHASE, "SGIS_CONSUMER_KEY · SGIS_CONSUMER_SECRET 환경변수 필요");
    process.exit(1);
  }
  if (args.dryRun) log(PHASE, "=== DRY-RUN 모드 (쓰기 0 · collector_runs 기록 0) ===");
  if (args.firstRun) log(PHASE, `=== 첫 회차 — 승인한 쓸 행 수 ${args.expectOk} 와 계획이 같을 때만 씁니다 ===`);

  const startedMs = Date.now();
  const sb = getSupabase();
  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션344: graceful shutdown
  const { exitCode } = await runAndRecord({ sb, args, isInterrupted, startedMs });
  if (exitCode !== 0) process.exit(exitCode);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
