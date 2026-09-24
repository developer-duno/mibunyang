// @ts-check
/**
 * 청약홈 경쟁률 수집기
 *
 * API: 한국부동산원 청약홈 잔여세대 경쟁률 조회
 *   (api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getRemndrLttotPblancCmpet)
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-applyhome.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/collect-applyhome.mjs --dry-run --impact-out=<경로>   (완판 0 쓰기 계획 JSON)
 *   node scripts/collectors/collect-applyhome.mjs --expect-zero=<N>   (완판 0 쓰기 차단기 — 승인한 개수와 같을 때만)
 *
 * ## 세션569 C6 — 완판 신호로 청약홈 미분양 값을 0 으로 (사장님 결정 2026-09-24 🟡8)
 * 행마다 `competition_shortfall`(평형별 미달 합 = 평형마다 max(0, 공급 − 신청))을 저장한다. 그리고
 * `unsold_source === "applyhome"` 인 단지에서 **그 값의 회차**가 미달 0 이면 `unsold = 0`·`unsold_rate = 0`
 * (출처 applyhome 유지)으로 쓴다(`planApplyhomeUnsold`). 그 밖은 값 불변.
 *   - "그 값의 회차" 확인 = `unsold === 이번 경쟁률의 공급 합`. seed 는 회차 공급분을 값으로 쓰므로
 *     자기 회차면 둘이 같다(조사 67/67). 세션569 에 사람이 넣은 5곳은 값이 **다른 회차**(뒤 회차의
 *     잔여·임의 공고) 것이고 이 경쟁률은 옛 분양 회차라 같지 않다 → 건드리지 않는다.
 *   - 합계(신청 ≥ 공급)가 아니라 평형별로 본다 — 청주처럼 합계는 넘치는데 평형별 미달이 96 인 단지가 있다.
 *   - 차단기(data-changing-run-approval.md §2): 미리보기(--impact-out) 저장 **뒤**, DB 쓰기 **전**에 판정.
 *     기본 = 한 회차 0 쓰기 10건 초과면 발동, `--expect-zero=<N>` 이면 그 개수와 정확히 같을 때만 통과.
 *
 * 필요 환경변수:
 *   MOLIT_KEY (data.go.kr 통합 키 — odcloud.kr 호환)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, selectAll, upsertBatch, recordApiQuota, recordCollectorRun, today } from "./_shared.mjs";
import { writeFileSync } from "node:fs";

loadEnv();

const PHASE = "applyhome";
const API_KEY = process.env.MOLIT_KEY;
let apiCalls = 0;

const BASE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getRemndrLttotPblancCmpet";

/**
 * @typedef {{ HOUSE_MANAGE_NO?: string; SUPLY_HSHLDCO?: string | number; REQ_CNT?: string | number; [k: string]: unknown }} ApplyHomeRow
 * @typedef {{ rate: number | null; supply: number; applicants: number; shortfall: number | null; raw_rows: ApplyHomeRow[] }} AggResult
 */

/** 한 회차 완판 0 쓰기 차단기 기본 상한(건) — 주간 seed 유입 약 2~3건/주 기준. @type {number} */
export const B_ZERO_DEFAULT_LIMIT = 10;

/**
 * 평형별 미달 합 — 평형(행)마다 max(0, 공급 − 신청) 을 더한다(세션569 C6).
 * 청약홈 `CMPET_RATE "(△N)"` 의 N 과 같은 값이다(2026-09-21 원본 8단지 대조: 봉담 △6·△17·△73, 서수원 △2).
 * 공급 합이 0 이면 정보가 없으므로 null — 0(완판)으로 읽히면 안 된다(API 필드명이 바뀌어 공급이 0 으로
 * 읽히는 사고를 완판으로 오인하지 않게).
 * 신청 수가 숫자가 아니면 0 으로 본다(미달이 크게 잡히는 쪽 = 0 쓰기가 일어나지 않는 쪽으로 틀린다).
 * @param {ApplyHomeRow[]} items
 * @returns {number | null}
 */
export function computeShortfall(items) {
  let supplyTotal = 0;
  let shortfall = 0;
  for (const item of items) {
    const supply = Number(item.SUPLY_HSHLDCO) || 0;
    const applicants = Number(item.REQ_CNT) || 0;
    supplyTotal += supply;
    shortfall += Math.max(0, supply - applicants);
  }
  return supplyTotal > 0 ? shortfall : null;
}

/**
 * 완판 신호로 applyhome 값을 0 으로 쓸지 판정한다(세션569 C6 B). DB 접근 없는 순수 함수.
 *
 * - `zero`      = 출처 applyhome · 값 > 0 · 값 === 이번 경쟁률 공급 합(= 그 값의 회차) · 평형별 미달 0
 * - `keep`      = 그 밖(출처가 applyhome 이 아님 · 이미 0 · 다른 회차 값 · 미달 있음 · 미달 모름)
 *
 * @param {{ unsold?: number | null; unsold_source?: string | null }} apt
 * @param {{ supply: number; shortfall: number | null }} agg
 * @returns {{ action: "zero" | "keep"; reason: string }}
 */
export function planApplyhomeUnsold(apt, agg) {
  if (apt.unsold_source !== "applyhome") return { action: "keep", reason: "not_applyhome" };
  if (apt.unsold == null || apt.unsold <= 0) return { action: "keep", reason: "already_zero_or_empty" };
  if (agg.shortfall == null) return { action: "keep", reason: "shortfall_unknown" };
  if (apt.unsold !== agg.supply) return { action: "keep", reason: "other_round" };
  if (agg.shortfall !== 0) return { action: "keep", reason: "shortfall_positive" };
  return { action: "zero", reason: "sold_out" };
}

/**
 * 완판 0 쓰기 차단기 — `expectZero` 가 있으면 정확히 같을 때만 통과, 없으면 기본 상한 초과면 발동.
 * @param {number} zeroCount
 * @param {number | null} expectZero
 * @returns {{ fired: boolean; zeroCount: number; limit: number; expectZero: number | null }}
 */
export function evaluateApplyhomeZeroBreaker(zeroCount, expectZero) {
  const fired = expectZero != null ? zeroCount !== expectZero : zeroCount > B_ZERO_DEFAULT_LIMIT;
  return { fired, zeroCount, limit: B_ZERO_DEFAULT_LIMIT, expectZero: expectZero ?? null };
}

/**
 * `--expect-zero=<N>` 파싱. 없거나 음수·비정수면 null(무효면 invalid=true).
 * @param {string[]} argv
 * @returns {{ expectZero: number | null; invalid: boolean }}
 */
export function parseApplyhomeExpectZero(argv) {
  const arg = argv.find((a) => a.startsWith("--expect-zero="));
  if (!arg) return { expectZero: null, invalid: false };
  const n = Number(arg.slice("--expect-zero=".length));
  if (!Number.isInteger(n) || n < 0) return { expectZero: null, invalid: true };
  return { expectZero: n, invalid: false };
}

// ── API 페이지네이션 (odcloud: page/perPage) ─────────────────
/** @returns {Promise<ApplyHomeRow[]>} */
async function fetchAllPages() {
  /** @type {ApplyHomeRow[]} */
  const allRows = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: "1000",
      serviceKey: API_KEY || "",
    });

    const url = `${BASE_URL}?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    apiCalls++;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = /** @type {{ data?: ApplyHomeRow[]; totalCount?: number }} */ (await res.json());
    const data = json.data || [];
    allRows.push(...data);

    log(PHASE, `  page ${page}: ${data.length}건 (누적 ${allRows.length}/${json.totalCount})`);

    if (allRows.length >= (json.totalCount || 0) || data.length < 1000) break;
    page++;
  }

  return allRows;
}

// ── 아파트별 가중평균 경쟁률 집계 ────────────────────────────
/**
 * @param {ApplyHomeRow[]} rows
 * @returns {Record<string, AggResult>}
 */
export function aggregateByApartment(rows) {
  // HOUSE_MANAGE_NO별 그룹핑
  /** @type {Record<string, ApplyHomeRow[]>} */
  const groups = {};
  for (const row of rows) {
    const no = row.HOUSE_MANAGE_NO;
    if (!no) continue;
    if (!groups[no]) groups[no] = [];
    groups[no].push(row);
  }

  /** @type {Record<string, AggResult>} */
  const result = {};
  for (const [no, items] of Object.entries(groups)) {
    let totalSupply = 0;
    let totalApplicants = 0;

    for (const item of items) {
      const supply = Number(item.SUPLY_HSHLDCO) || 0;
      const applicants = Number(item.REQ_CNT) || 0;  // REQ_CNT는 문자열!

      totalSupply += supply;
      totalApplicants += applicants;
    }

    // 가중평균: 총 신청수 / 총 공급수
    const rate = totalSupply > 0
      ? Math.round((totalApplicants / totalSupply) * 100) / 100
      : null;

    result[no] = { rate, supply: totalSupply, applicants: totalApplicants, shortfall: computeShortfall(items), raw_rows: items };
  }

  return result;
}

/**
 * 매칭된 단지만 events 배열로 변환 (순수 함수, DB 호출 없음 — 단위 테스트용)
 * @param {Record<string, AggResult>} aggregated
 * @param {Array<{ id: string }>} apartments
 * @param {string} recordedAt
 */
export function buildEventsFromAggregated(aggregated, apartments, recordedAt) {
  const aptSet = new Set(apartments.map(a => a.id));
  /** @type {Array<{ apartment_id: string; house_manage_no: string; supply: number; applicants: number; rate: number | null; recorded_at: string; raw_response: ApplyHomeRow[] }>} */
  const events = [];
  for (const [no, agg] of Object.entries(aggregated)) {
    const aptId = `ah-${no}`;
    if (!aptSet.has(aptId)) continue;
    events.push({
      apartment_id: aptId,
      house_manage_no: no,
      supply: agg.supply,
      applicants: agg.applicants,
      rate: agg.rate,
      recorded_at: recordedAt,
      raw_response: agg.raw_rows,
    });
  }
  return events;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  const impactOutArg = process.argv.find((a) => a.startsWith("--impact-out="));
  const impactOutPath = impactOutArg ? impactOutArg.slice("--impact-out=".length) : null;
  const expectZeroParsed = parseApplyhomeExpectZero(process.argv);
  if (expectZeroParsed.invalid) logError(PHASE, `--expect-zero 값이 유효하지 않음 — 무시하고 기본 상한(${B_ZERO_DEFAULT_LIMIT}건) 판정`);

  const sb = getSupabase();
  const rpt = createReporter(PHASE);
  // process.exit() 를 try 안에서 부르면 대기 중인 finally(recordApiQuota)를 건너뛴다
  // (Node 실측, 세션 395 정정 패턴 — collect-applyhome-detail.mjs 답습).
  // 그래서 exit 여부는 플래그로만 들고, 실제 exit 는 finally 안 recordApiQuota 직후에 한다.
  let shouldExit1 = false;

  try {
  // 1. 청약홈 API 전체 조회
  log(PHASE, "청약홈 잔여세대 경쟁률 조회 시작...");
  const rows = await fetchAllPages();
  log(PHASE, `API 총 ${rows.length}건`);

  // 2. 아파트별 집계
  const aggregated = aggregateByApartment(rows);
  const aptNos = Object.keys(aggregated);
  log(PHASE, `고유 아파트: ${aptNos.length}건`);

  // 2.5. 청약홈 API 응답 형식 변경 조기 감지 (5% 경고 + exit(1) 알림)
  // ⚠️ 위치 = aggregate 직후 + apartments.update 루프 진입 전.
  //    이 시점에는 어떤 DB 쓰기도 발생 안 함 → 중단 시 데이터 무결.
  const totalAggregated = aptNos.length;
  const zeroSupplyCount = Object.values(aggregated)
    .filter(a => a.supply === 0).length;
  const zeroRatio = totalAggregated > 0 ? zeroSupplyCount / totalAggregated : 0;
  if (zeroRatio > 0.05) {
    logError(PHASE, `⚠️ supply=0 비율 ${(zeroRatio * 100).toFixed(1)}% (${zeroSupplyCount}/${totalAggregated}) — 청약홈 API 필드명 변경 가능성. odcloud 응답 1건 샘플 확인 필요.`);
    shouldExit1 = true;
    return;
  }

  // 3. 우리 아파트 ID와 매칭 (ah-{HOUSE_MANAGE_NO})
  const apartments = /** @type {Array<{ id: string; unsold: number | null; unsold_source: string | null }>} */ (await selectAll(
    (s) => s.from("apartments").select("id, unsold, unsold_source"),
    sb,
    "id", // 무정렬 OFFSET 이면 경쟁률 대상이 조용히 빠진다 (세션543 W2)
  ));

  const aptSet = new Set(apartments.map(a => a.id));
  const aptById = new Map(apartments.map(a => [a.id, a]));

  // 3.5. 완판 0 쓰기 계획(세션569 C6 B) → 미리보기 저장 → 차단기 판정. **DB 쓰기 전**이다
  //      (data-changing-run-approval.md §2 — 차단기는 미리보기 뒤, 쓰기 전).
  /** @type {Array<{ id: string; currentUnsold: number | null; supply: number; shortfall: number | null }>} */
  const zeroPlan = [];
  /** @type {Record<string, number>} */
  const bReasonCounts = {};
  for (const [no, agg] of Object.entries(aggregated)) {
    const apt = aptById.get(`ah-${no}`);
    if (!apt) continue;
    const verdict = planApplyhomeUnsold(apt, agg);
    if (apt.unsold_source === "applyhome") bReasonCounts[verdict.reason] = (bReasonCounts[verdict.reason] || 0) + 1;
    if (verdict.action === "zero") zeroPlan.push({ id: apt.id, currentUnsold: apt.unsold, supply: agg.supply, shortfall: agg.shortfall });
  }
  const breaker = evaluateApplyhomeZeroBreaker(zeroPlan.length, expectZeroParsed.expectZero);
  log(PHASE, `완판 0 쓰기 계획: ${zeroPlan.length}건 (applyhome 판정 ${Object.entries(bReasonCounts).map(([r, n]) => `${r}=${n}`).join(", ") || "없음"}) · 차단기 ${breaker.fired ? "발동" : "미발동"}(상한 ${breaker.limit}${breaker.expectZero != null ? ` · expect-zero=${breaker.expectZero}` : ""})`);
  for (const z of zeroPlan) log(PHASE, `  [완판→0] ${z.id}: unsold ${z.currentUnsold} → 0 (공급 ${z.supply} · 평형별 미달 ${z.shortfall})`);
  if (impactOutPath) {
    try {
      writeFileSync(impactOutPath, JSON.stringify({ generatedAt: new Date().toISOString(), breaker, bReasonCounts, zeroPlan }, null, 2), "utf8");
      log(PHASE, `[IMPACT] 완판 0 쓰기 계획 ${zeroPlan.length}건 저장: ${impactOutPath}`);
    } catch (e) {
      logError(PHASE, `impact-out 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (breaker.fired) {
    const msg = `완판 0 쓰기 차단기 발동 — ${breaker.zeroCount}건${breaker.expectZero != null ? ` (expect-zero=${breaker.expectZero} 와 불일치)` : ` 가 상한 ${breaker.limit}건 초과`} — 경쟁률·미분양 어느 것도 쓰지 않고 중단`;
    if (dryRun) {
      logError(PHASE, `[DRY-RUN 경고] ${msg}`);
    } else {
      logError(PHASE, msg);
      await recordCollectorRun(PHASE, { ok: 0, status: "failure", errorMessage: msg });
      shouldExit1 = true;
      return;
    }
  }
  const zeroIds = new Set(zeroPlan.map((z) => z.id));
  let zeroWritten = 0;
  let matched = 0;
  /** @type {Array<{ apartment_id: string; house_manage_no: string; supply: number; applicants: number; rate: number | null; recorded_at: string; raw_response: ApplyHomeRow[] }>} */
  const events = [];   // 시계열 적재용 — apartments.update 성공 시에만 누적

  for (const [no, agg] of Object.entries(aggregated)) {
    if (rpt.interrupted()) break;
    const aptId = `ah-${no}`;
    if (!aptSet.has(aptId)) continue;
    matched++;

    if (dryRun) {
      const rateStr = agg.rate != null
        ? (agg.rate < 0 ? `미달(${(Math.abs(agg.rate) * 100).toFixed(0)}%)` : `${agg.rate}:1`)
        : "null";
      log(PHASE, `  [DRY-RUN] ${aptId}: ${rateStr} (공급:${agg.supply} 신청:${agg.applicants} 평형별 미달:${agg.shortfall ?? "?"})`);
      rpt.success(1);
      continue;
    }

    const { error: updErr } = await sb.from("apartments").update({
      competition_rate: agg.rate,
      competition_supply: agg.supply,
      competition_applicants: agg.applicants,
      competition_shortfall: agg.shortfall,
      updated_at: new Date().toISOString(),
    }).eq("id", aptId);

    if (updErr) { logError(PHASE, `  ${aptId} UPDATE 실패: ${updErr.message}`); rpt.fail(1); continue; }
    rpt.success(1);

    // 완판 0 쓰기(세션569 C6 B) — 계획 때 본 값·출처가 그대로일 때만(WHERE 로 경합 창을 닫는다).
    // 출처는 applyhome 그대로 둔다(청약홈이 "다 팔렸다"고 말한 값이다). 성공은 돌아온 행으로 센다.
    if (zeroIds.has(aptId)) {
      const cur = aptById.get(aptId)?.unsold ?? null;
      const { data: zData, error: zErr } = await sb.from("apartments")
        .update({ unsold: 0, unsold_rate: 0, updated_at: new Date().toISOString() })
        .eq("id", aptId).eq("unsold_source", "applyhome").eq("unsold", /** @type {number} */ (cur))
        .select("id");
      if (zErr) { logError(PHASE, `  ${aptId} 완판 0 쓰기 실패: ${zErr.message}`); rpt.fail(1); }
      else if (zData && zData.length > 0) zeroWritten++;
      else log(PHASE, `  ${aptId} 완판 0 쓰기 건너뜀 — 그 사이 값·출처가 바뀜`);
    }

    // 시계열 events 누적 (apartments.update 성공 분기 안)
    events.push({
      apartment_id: aptId,
      house_manage_no: no,
      supply: agg.supply,
      applicants: agg.applicants,
      rate: agg.rate,
      recorded_at: today(), // KST 고정
      raw_response: agg.raw_rows,
    });
  }

  // 4. 시계열 일괄 upsert (dry-run 모드 아닐 때만)
  if (!dryRun && events.length > 0) {
    const inserted = await upsertBatch(
      "applyhome_events",
      events,
      "apartment_id,house_manage_no",
      500,
      sb,
    );
    const failed = events.length - inserted;
    if (failed > 0) rpt.fail(failed);
    // 추가 PHASE 로그 불필요: upsertBatch 내부가 이미
    // "applyhome_events: ${inserted}/${rows.length}건 upsert" 출력
  }

  log(PHASE, `매칭: ${matched}/${aptNos.length}건 · 완판 0 쓰기 ${dryRun ? `예정 ${zeroPlan.length}` : `${zeroWritten}/${zeroPlan.length}`}건`);
  const result = rpt.summary();
  log(PHASE, "\n=== 완료 ===");
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) shouldExit1 = true;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
    }
    // exit 은 recordApiQuota 를 await 한 바로 뒤 = 쿼터 기록 보장(scripts/CLAUDE.md Exit Code 정책).
    // ⚠️ try/finally *뒤* 로 빼면 안 된다 — 2.5 조기 감지가 try 안에서 return 하므로 그 줄에는
    //    도달하지 못해 exit 0(성공)으로 끝난다(Node 실측).
    if (shouldExit1) process.exit(1);
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
