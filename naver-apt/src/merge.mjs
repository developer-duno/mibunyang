#!/usr/bin/env node
/**
 * nearby-trends.json → apartments.json 병합 스크립트
 *
 * 네이버 부동산 크롤링 결과(nearby-trends.json)를 메인 앱의
 * apartments.json에 병합하여 스코어링 엔진에서 활용할 수 있게 한다.
 *
 * 사용법:
 *   node src/merge.mjs                  # 병합 실행
 *   node src/merge.mjs --dry-run        # 변경 내용만 출력 (파일 미수정)
 *   node src/merge.mjs --backup         # 백업 후 병합
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const MIBUNYANG_ROOT = resolve(PROJECT_ROOT, "..");

const TRENDS_FILE = resolve(PROJECT_ROOT, "output/nearby-trends.json");
const APT_FILE = resolve(MIBUNYANG_ROOT, "public/data/apartments.json");

// ── CLI 인자 ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const backup = args.includes("--backup");

// ── 파일 로드 ────────────────────────────────────────────────
function loadTrends() {
  if (!existsSync(TRENDS_FILE)) {
    console.error("❌ nearby-trends.json 없음:", TRENDS_FILE);
    console.error("   먼저 npm run crawl 을 실행하세요.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(TRENDS_FILE, "utf8"));
}

function loadApartments() {
  if (!existsSync(APT_FILE)) {
    console.error("❌ apartments.json 없음:", APT_FILE);
    process.exit(1);
  }
  return JSON.parse(readFileSync(APT_FILE, "utf8"));
}

// ── 학교 데이터에서 최근접 초등학교 도보 시간 추출 ────────────
function getNearestSchoolWalkMin(complexes) {
  let minWalk = null;
  for (const c of complexes) {
    for (const s of (c.schools || [])) {
      if (s.type === "초등" && s.walkTimeMin != null && s.walkTimeMin > 0) {
        if (minWalk === null || s.walkTimeMin < minWalk) {
          minWalk = s.walkTimeMin;
        }
      }
    }
  }
  return minWalk;
}

// ── 병합 로직 ────────────────────────────────────────────────
function mergeData(apartments, trends) {
  const trendMap = trends.trends || {};
  const stats = { matched: 0, enriched: 0, skipped: 0, fields: {} };

  for (const apt of apartments) {
    const trend = trendMap[apt.id];
    if (!trend) {
      stats.skipped++;
      continue;
    }

    stats.matched++;
    const ps = trend.priceStats;
    if (!ps) continue;

    let changed = false;

    // 기존 값이 없으면 네이버 값으로 보충
    if ((!apt.nearbyMedian || apt.nearbyMedian === 0) && ps.nearbyMedian > 0) {
      apt.nearbyMedian = ps.nearbyMedian;
      inc(stats.fields, "nearbyMedian");
      changed = true;
    }
    if ((!apt.jeonseRate || apt.jeonseRate === 0) && ps.jeonseRate > 0) {
      apt.jeonseRate = ps.jeonseRate;
      inc(stats.fields, "jeonseRate");
      changed = true;
    }
    if ((!apt.recentTrades6m || apt.recentTrades6m === 0) && ps.sellCount > 0) {
      apt.recentTrades6m = ps.sellCount;
      inc(stats.fields, "recentTrades6m");
      changed = true;
    }

    // 네이버 전용 필드 (항상 기록 — 교차검증용)
    apt.naverNearbyMedian = ps.nearbyMedian ?? null;
    apt.naverNearbyAvg = ps.nearbyAvg ?? null;
    apt.naverJeonseRate = ps.jeonseRate ?? null;
    apt.naverSellCount = ps.sellCount ?? 0;
    apt.naverJeonseCount = ps.jeonseCount ?? 0;
    apt.naverWolseCount = ps.wolseCount ?? 0;
    apt.naverBuildYear = ps.nearbyBuildYear ?? null;
    apt.naverAvgFloor = ps.avgFloor ?? null;
    apt.naverSchoolWalkMin = getNearestSchoolWalkMin(trend.complexes || []);
    apt.naverNearbyCount = trend.nearbyCount ?? 0;
    apt.naverFetchedAt = trend.fetchedAt ?? null;

    if (changed) stats.enriched++;
  }

  return stats;
}

function inc(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

// ── 메인 ─────────────────────────────────────────────────────
function main() {
  console.log("📊 nearby-trends → apartments.json 병합\n");

  const trends = loadTrends();
  const trendCount = Object.keys(trends.trends || {}).length;
  console.log(`  📂 nearby-trends: ${trendCount}건 (${trends.generatedAt})`);

  const raw = loadApartments();
  const apartments = raw.data || raw;
  const isWrapped = !!raw.data;
  console.log(`  📂 apartments: ${apartments.length}건`);

  if (dryRun) console.log("\n  🔍 --dry-run: 파일 수정 없이 결과만 출력\n");

  const stats = mergeData(apartments, trends);

  // 결과 출력
  console.log(`\n✅ 병합 결과:`);
  console.log(`  매칭: ${stats.matched}건 / ${apartments.length}건`);
  console.log(`  보충: ${stats.enriched}건 (기존 null/0 → 네이버 값)`);
  console.log(`  미매칭: ${stats.skipped}건 (크롤링 미수집)`);

  if (Object.keys(stats.fields).length > 0) {
    console.log(`  보충 필드:`);
    for (const [field, count] of Object.entries(stats.fields)) {
      console.log(`    ${field}: ${count}건`);
    }
  }

  if (dryRun) {
    console.log("\n🔍 --dry-run 완료. 파일은 수정되지 않았습니다.");
    return;
  }

  // 백업
  if (backup) {
    const backupPath = APT_FILE + ".bak";
    copyFileSync(APT_FILE, backupPath);
    console.log(`\n💾 백업: ${backupPath}`);
  }

  // 저장 (원자적: tmp → rename)
  const output = isWrapped ? { ...raw, data: apartments } : apartments;
  const tmpFile = APT_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(output, null, 2), "utf8");
  renameSync(tmpFile, APT_FILE);
  console.log(`\n💾 저장: ${APT_FILE}`);
}

main();
