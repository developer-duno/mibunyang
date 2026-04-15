#!/usr/bin/env node
// 일회성: 화성시 apartments.gu 복합 오염 정규화
// "화성시 동탄구/만세구/효행구/병점구" 및 "동탄구" 단독 → "화성시"
//
// 배경: apartments.gu 에 "화성시 동탄구" 같은 복합 문자열이 저장돼
//   collect-trades.mjs:163 의 regionGuPairs 가 getLawdCd("경기","화성시 동탄구") 매칭 실패
//   → MOLIT API 호출 미수행 → trades 에 화성시 0건 → trade_stats.nearby_median NULL 52건.
// 세션92-d 의 LAWD 41591 교정은 정확했으나 gu 복합 문자열 때문에 효과 없음.
//
// 사용법:
//   node scripts/fix_hwaseong_gu.mjs                   # dry-run
//   node scripts/fix_hwaseong_gu.mjs --commit          # 실제 UPDATE + JSON 백업
//   node scripts/fix_hwaseong_gu.mjs --rollback=PATH   # 백업 파일로 복원

import fs from "node:fs";
import path from "node:path";
import { loadEnv, getSupabase, log, logError } from "./collectors/_shared.mjs";

const PHASE = "fix-hwaseong-gu";
const COMMIT = process.argv.includes("--commit");
const rollbackArg = process.argv.find(a => a.startsWith("--rollback="));
const ROLLBACK_PATH = rollbackArg ? rollbackArg.split("=")[1] : null;

// 오염 후보 정확 값 (세션94 DB 실측 기준)
const BAD_PREFIX = "화성시 "; // "화성시 동탄구" "화성시 만세구" 등
const BAD_EXACT = ["동탄구", "만세구", "효행구", "병점구"];
const TARGET_GU = "화성시";

loadEnv();

async function selectCandidates(sb) {
  // LIKE '화성시 %' OR gu IN (...)
  // Supabase .or 로 결합
  const orExpr = `gu.like.${BAD_PREFIX}%,gu.in.(${BAD_EXACT.join(",")})`;
  const { data, error } = await sb
    .from("apartments")
    .select("id,region,gu,address,road_address")
    .eq("region", "경기")
    .or(orExpr);
  if (error) throw new Error(`SELECT 실패: ${error.message}`);
  return data || [];
}

function classify(row) {
  // "화성시 동탄구" 같은 복합은 무조건 대상.
  if (row.gu && row.gu.startsWith(BAD_PREFIX)) return { action: "UPDATE", reason: "composite gu" };
  // 단독 "동탄구" 등은 address에 "화성시" 포함되어야 안전
  if (BAD_EXACT.includes(row.gu)) {
    const addr = (row.address || "") + " " + (row.road_address || "");
    if (addr.includes("화성시")) return { action: "UPDATE", reason: "bare gu + hwaseong address" };
    return { action: "SKIP", reason: "bare gu but address missing 화성시 — 수동 검토" };
  }
  return { action: "SKIP", reason: "no match" };
}

async function doUpdate(sb, ids) {
  const BATCH = 100;
  let ok = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const { data, error } = await sb
      .from("apartments")
      .update({ gu: TARGET_GU })
      .in("id", slice)
      .select("id");
    if (error) { logError(PHASE, `배치 ${i}: ${error.message}`); continue; }
    ok += data?.length || 0;
  }
  return ok;
}

function writeBackup(rows) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(process.cwd(), "scripts", "_backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hwaseong_gu_${ts}.json`);
  const payload = rows.map(r => ({
    id: r.id, region: r.region, gu_before: r.gu, address: r.address,
  }));
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

async function rollback(sb, filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  log(PHASE, `ROLLBACK ${payload.length}건 from ${filePath}`);
  let ok = 0;
  for (const row of payload) {
    const { error } = await sb
      .from("apartments")
      .update({ gu: row.gu_before })
      .eq("id", row.id);
    if (error) { logError(PHASE, `${row.id}: ${error.message}`); continue; }
    ok++;
  }
  log(PHASE, `ROLLBACK DONE ${ok}/${payload.length}`);
}

async function main() {
  const sb = getSupabase();

  if (ROLLBACK_PATH) {
    if (!fs.existsSync(ROLLBACK_PATH)) {
      logError(PHASE, `백업 파일 없음: ${ROLLBACK_PATH}`); process.exit(1);
    }
    if (!COMMIT) { log(PHASE, "ROLLBACK dry-run — 내용만 출력"); log(PHASE, fs.readFileSync(ROLLBACK_PATH, "utf8").slice(0, 500)); return; }
    await rollback(sb, ROLLBACK_PATH);
    return;
  }

  log(PHASE, "SELECT 오염 후보...");
  const rows = await selectCandidates(sb);
  log(PHASE, `후보 ${rows.length}건`);

  const buckets = {};
  const toUpdate = [];
  const skipped = [];
  for (const row of rows) {
    buckets[row.gu] = (buckets[row.gu] || 0) + 1;
    const c = classify(row);
    if (c.action === "UPDATE") toUpdate.push({ ...row, _reason: c.reason });
    else skipped.push({ ...row, _reason: c.reason });
  }
  log(PHASE, `gu 분포: ${JSON.stringify(buckets)}`);
  log(PHASE, `UPDATE 대상 ${toUpdate.length}건, SKIP ${skipped.length}건`);

  if (skipped.length) {
    log(PHASE, "== SKIP 목록 ==");
    for (const s of skipped) {
      log(PHASE, `  ${s.id} gu="${s.gu}" addr="${(s.address||"").slice(0,50)}" [${s._reason}]`);
    }
  }

  if (!COMMIT) {
    log(PHASE, "== UPDATE 대상 샘플(상위 10) ==");
    for (const r of toUpdate.slice(0, 10)) {
      log(PHASE, `  ${r.id} "${r.gu}" → "${TARGET_GU}"  addr="${(r.address||"").slice(0,50)}"`);
    }
    log(PHASE, "DRY-RUN — UPDATE 생략. --commit 추가 시 실제 반영");
    return;
  }

  const backupFile = writeBackup(toUpdate);
  log(PHASE, `백업 저장: ${backupFile}`);

  const ok = await doUpdate(sb, toUpdate.map(r => r.id));
  log(PHASE, `UPDATE 완료 ${ok}/${toUpdate.length}`);

  // AFTER 검증
  const { data: after, error: e3 } = await sb
    .from("apartments")
    .select("gu")
    .eq("region", "경기")
    .ilike("address", "%화성시%");
  if (e3) { logError(PHASE, `검증 SELECT 실패: ${e3.message}`); return; }
  const afterBuckets = {};
  (after || []).forEach(r => { afterBuckets[r.gu || "NULL"] = (afterBuckets[r.gu || "NULL"] || 0) + 1; });
  log(PHASE, `AFTER 경기 화성 gu 분포: ${JSON.stringify(afterBuckets)}`);
}

main().catch(e => { logError(PHASE, e.stack || e.message); process.exit(99); });
