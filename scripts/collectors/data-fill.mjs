// @ts-check
/**
 * 데이터 자동 보정 오케스트레이터
 *
 * data-audit 결과를 바탕으로 null rate 높은 카테고리의 수집기를 자동 실행.
 *
 * 사용법:
 *   node scripts/collectors/data-fill.mjs                    # 전체 보정
 *   node scripts/collectors/data-fill.mjs --dry-run           # 미리보기
 *   node scripts/collectors/data-fill.mjs --category=building # 특정 카테고리만
 *   node scripts/collectors/data-fill.mjs --threshold=30      # 30% 이상 누락만 (기본 20%)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (필수)
 *   + 카테고리별: MOLIT_KEY, DART_KEY, MOIS_POP_KEY, KAKAO_KEY, TAGO_KEY
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnv, getSupabase, log, logError } from "./_shared.mjs";
import { computeAudit, fetchAllFromView } from "./data-audit.mjs";

/**
 * @typedef {{ category: string, phase: number, scripts: readonly string[], args: readonly string[], envKeys: readonly string[] }} CollectorEntry
 * @typedef {{ category: string, phase: number, scripts: readonly string[], args: readonly string[], envKeys: readonly string[], nullRate: number, currentRate: number }} AuditTarget
 * @typedef {{ ok: true } | { ok: false, error: string }} RunResult
 */

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const PHASE = "data-fill";
const COLLECTOR_TIMEOUT = 900_000; // 15분

// ── 수집기 매핑 (Phase 순서대로 정의) ────────────────────────
/** @type {readonly CollectorEntry[]} */
export const COLLECTORS = [
  // Phase 1: 기반 데이터
  { category: "building",  phase: 1, scripts: ["molit-building-info.mjs"], args: ["--force"], envKeys: ["MOLIT_KEY"] },
  { category: "builders",  phase: 1, scripts: ["dart-builders.mjs"],       args: [],          envKeys: ["DART_KEY"] },
  { category: "regions",   phase: 1, scripts: ["population.mjs", "population-sex-age.mjs", "migration.mjs", "housing-permits.mjs", "collect-housing-supply-ratio.mjs", "collect-housing-price.mjs", "childcare-info.mjs", "childcare-detail.mjs"], args: [], envKeys: ["MOIS_POP_KEY", "MOIS_SEX_AGE_KEY", "KOSIS_MIGRATION_KEY", "MOLIT_KEY", "KOSIS_KEY", "CHILDCARE_API_KEY", "CHILDCARE_BASIC_API_KEY"] },
  { category: "maintenance", phase: 1, scripts: ["collect-maintenance.mjs"], args: [],          envKeys: ["MOLIT_KEY"] },
  // Phase 2: 파생 데이터 (Phase 1 완료 후)
  { category: "trade_stats", phase: 2, scripts: ["trade-stats.mjs"],       args: [],          envKeys: [] },
  // Phase 3: Kakao 의존 (순차)
  { category: "infra",      phase: 3, scripts: ["infra-kakao.mjs"],        args: [],          envKeys: ["KAKAO_KEY"] },
  { category: "schools",    phase: 3, scripts: ["schools-neis.mjs"],       args: [],          envKeys: ["KAKAO_KEY", "NEIS_KEY", "SCHOOLINFO_KEY"] },
  { category: "transport",  phase: 3, scripts: ["transport-tago.mjs"],     args: [],          envKeys: ["KAKAO_KEY", "TAGO_KEY"] },
  { category: "environment", phase: 3, scripts: ["environment.mjs"],       args: [],          envKeys: ["KAKAO_KEY"] },
];

// 스킵 카테고리
export const SKIP_CATEGORIES = new Set(["naver", "future", "core", "price", "risk", "benefits"]);

// ── 수집기 실행 ──────────────────────────────────────────────
/**
 * @param {string} script
 * @param {readonly string[]} extraArgs
 * @param {boolean} dryRun
 * @returns {Promise<RunResult>}
 */
async function runCollector(script, extraArgs, dryRun) {
  const scriptPath = resolve(__dirname, script);
  const args = [...extraArgs];
  if (dryRun) args.push("--dry-run");

  log(PHASE, `  → ${script} ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath, [scriptPath, ...args],
      { timeout: COLLECTOR_TIMEOUT, env: process.env, maxBuffer: 10 * 1024 * 1024 }
    );
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { ok: true };
  } catch (err) {
    const e = /** @type {{ code?: string|number, status?: string|number, message?: string }} */ (err);
    const code = e.code || e.status || "unknown";
    logError(PHASE, `  ${script} 실패 (code: ${code}): ${e.message?.slice(0, 200) ?? ""}`);
    return { ok: false, error: e.message ?? String(err) };
  }
}

// ── env 사전 검증 ────────────────────────────────────────────
/**
 * @param {readonly string[]} envKeys
 * @returns {string[]}
 */
function checkEnvKeys(envKeys) {
  const missing = envKeys.filter(k => !process.env[k]);
  return missing;
}

// ── CLI 인자 파싱 ────────────────────────────────────────────
/**
 * @returns {{ dryRun: boolean, category: string | null, threshold: number }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  /** @type {{ dryRun: boolean, category: string | null, threshold: number }} */
  const flags = { dryRun: false, category: null, threshold: 20 };
  for (const arg of args) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--category=")) flags.category = arg.slice("--category=".length);
    else if (arg.startsWith("--threshold=")) flags.threshold = parseInt(arg.slice("--threshold=".length), 10) || 20;
  }
  return flags;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const flags = parseArgs();
  if (flags.dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. Before 감사
  log(PHASE, "\n[Before] 감사 데이터 조회 중...");
  const beforeRows = await fetchAllFromView(sb, null);
  if (beforeRows.length === 0) { log(PHASE, "아파트 데이터 없음, 종료"); return; }
  const before = computeAudit(beforeRows);
  log(PHASE, `아파트 ${before.total}건, 평균 신뢰도 ${before.avgReliability}%\n`);

  // 2. 보정 대상 선정
  /** @type {AuditTarget[]} */
  const targets = [];
  for (const col of COLLECTORS) {
    // 카테고리 필터
    if (flags.category && col.category !== flags.category) continue;
    if (SKIP_CATEGORIES.has(col.category)) continue;

    const catStat = before.categories[col.category];
    if (!catStat) continue;

    const nullRate = 100 - catStat.rate;
    if (nullRate < flags.threshold) {
      log(PHASE, `  ${col.category}: ${catStat.rate}% 커버리지 (임계값 ${flags.threshold}% 미만 → skip)`);
      continue;
    }

    // env 검증
    const missing = checkEnvKeys(col.envKeys);
    if (missing.length > 0) {
      logError(PHASE, `  ${col.category}: 환경변수 누락 [${missing.join(", ")}] → skip`);
      continue;
    }

    targets.push({ ...col, nullRate, currentRate: catStat.rate });
  }

  if (targets.length === 0) {
    log(PHASE, "보정 대상 없음 (모든 카테고리 임계값 이하 또는 env 누락)");
    return;
  }

  log(PHASE, `\n보정 대상: ${targets.map(t => `${t.category}(${t.nullRate.toFixed(1)}% 누락)`).join(", ")}\n`);

  // 3. Phase별 순차 실행
  /** @type {Record<string, string>} */
  const results = {};
  for (const phase of [1, 2, 3]) {
    const phaseTargets = targets.filter(t => t.phase === phase);
    if (phaseTargets.length === 0) continue;

    log(PHASE, `--- Phase ${phase} ---`);
    for (const target of phaseTargets) {
      log(PHASE, `[${target.category}] 수집 시작`);
      let allOk = true;
      for (const script of target.scripts) {
        const result = await runCollector(script, target.args, flags.dryRun);
        if (!result.ok) allOk = false;
      }
      results[target.category] = allOk ? "성공" : "부분실패";
    }
  }

  // 4. After 감사 (dry-run이 아닌 경우만)
  if (!flags.dryRun) {
    log(PHASE, "\n[After] 감사 데이터 재조회 중...");
    const afterRows = await fetchAllFromView(sb, null);
    const after = computeAudit(afterRows);

    // 델타 테이블
    log(PHASE, `\n[보정 결과]`);
    log(PHASE, `${"카테고리".padEnd(16)} ${"Before".padStart(8)} ${"After".padStart(8)} ${"개선".padStart(8)}  상태`);
    log(PHASE, "-".repeat(56));

    for (const target of targets) {
      const b = before.categories[target.category]?.rate ?? 0;
      const a = after.categories[target.category]?.rate ?? 0;
      const delta = a - b;
      const deltaStr = delta > 0 ? `+${delta.toFixed(1)}%` : delta === 0 ? "  0.0%" : `${delta.toFixed(1)}%`;
      const status = results[target.category] || "skip";
      log(PHASE, `${target.category.padEnd(16)} ${String(b.toFixed(1) + "%").padStart(8)} ${String(a.toFixed(1) + "%").padStart(8)} ${deltaStr.padStart(8)}  ${status}`);
    }

    log(PHASE, `\n평균 신뢰도: ${before.avgReliability}% → ${after.avgReliability}%`);
  } else {
    log(PHASE, "\n[DRY-RUN] 실제 DB 변경 없음. 위 수집기가 실행될 예정입니다.");
  }

  // 스킵된 카테고리 안내
  const skipped = [...SKIP_CATEGORIES].filter(c => before.categories[c]);
  if (skipped.length > 0) {
    log(PHASE, `\n[SKIP] ${skipped.join(", ")} — 자동 보정 불가 (naver=한국IP, future=수동, core/price/risk/benefits=원본)`);
  }

  log(PHASE, "\n=== 완료 ===");
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { logError(PHASE, err instanceof Error ? err.message : String(err)); process.exit(1); });
