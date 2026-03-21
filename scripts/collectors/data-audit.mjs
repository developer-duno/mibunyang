/**
 * 데이터 완성도 배치 감사 스크립트
 *
 * apartments_flat VIEW 전체를 쿼리하여 필드별/카테고리별/지역별 null rate 측정.
 *
 * 사용법:
 *   node scripts/collectors/data-audit.mjs              # 콘솔 리포트
 *   node scripts/collectors/data-audit.mjs --json        # JSON stdout (집계만, PII 미포함)
 *   node scripts/collectors/data-audit.mjs --region=경기  # 특정 지역만
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError } from "./_shared.mjs";

loadEnv();

const PHASE = "data-audit";
const BATCH_SIZE = 1000;

// ── 영구 미수집 필드 (V4 API에서 제거됨) ─────────────────────
const PERMANENT_NULL = new Set(["quakeDesign", "greenBldg"]);

// ── 특수 null 판정 (VIEW COALESCE/기본값 마스킹) ──────────────
const MASKED_DEFAULTS = { subwayDist: 9999, icDist: 99, ktxDist: 99 };

// ── AUDIT_FIELDS: 14 카테고리, ~85 필드 ──────────────────────
export const AUDIT_FIELDS = {
  core: {
    collector: "applyhome",
    fields: ["name", "region", "gu", "dong", "address", "roadAddress", "district", "lat", "lng", "builder", "units", "completion", "layout"],
  },
  price: {
    collector: "applyhome",
    fields: ["area", "price", "pp"],
  },
  building: {
    collector: "molit-building-info",
    fields: ["maxFloor", "parkingRatio", "floorAreaRatio", "exclusiveRatio", "energyGrade", "heating", "floors", "hasPool"],
  },
  risk: {
    collector: "applyhome",
    fields: ["isRegulated", "dsr40pass"],
  },
  benefits: {
    collector: "applyhome",
    fields: ["discountPct", "loanFree", "balconyFree", "cashback", "benefits"],
  },
  infra: {
    collector: "infra-kakao",
    fields: [
      "hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park",
      "hospitalDist", "martDist", "convDist", "cafeDist", "cultureDist", "bankDist", "pharmacyDist", "parkDist",
      "nearbyFacilities",
    ],
  },
  transport: {
    collector: "transport-tago",
    fields: ["subwayDist", "busRoutes", "icDist", "ktxDist", "subwayName", "subwayLines", "busStopNames"],
  },
  schools: {
    collector: "schools-neis",
    fields: ["schoolScore", "schoolGrade", "nearbySchools"],
  },
  builders: {
    collector: "dart-builders",
    fields: ["builderDebtRatio", "builderCreditGrade", "hugGuarantee"],
  },
  regions: {
    collector: "population+migration+housing",
    fields: ["popGrowth", "supplyRatio", "netMigration"],
  },
  trade_stats: {
    collector: "trade-stats",
    fields: [
      "nearbyMedian", "recentTrades6m", "jeonseRate", "pir", "psr",
      "avgFloor", "nearbyBuildYear", "floorRange",
      "priceByArea", "rentByArea", "jeonseByArea", "priceByFloor",
    ],
  },
  naver: {
    collector: "naver (local-only)",
    fields: [
      "naverNearbyMedian", "naverNearbyAvg", "naverJeonseRate",
      "naverSellCount", "naverJeonseCount", "naverWolseCount",
      "naverBuildYear", "naverAvgFloor", "naverSchoolWalkMin", "naverNearbyCount",
    ],
  },
  environment: {
    collector: "environment",
    fields: ["view", "sunlight", "noise", "noxious", "noxiousDist"],
  },
  future: {
    collector: "manual",
    fields: ["transitDev", "devDist", "cityDev", "industryDev"],
  },
};

// ── null 판정 ────────────────────────────────────────────────
export function isFieldNull(field, value) {
  // 영구 미수집 필드
  if (PERMANENT_NULL.has(field)) return true;
  // 배열: 빈 배열 = null
  if (Array.isArray(value)) return value.length === 0;
  // 스칼라: null/undefined
  if (value == null) return true;
  // COALESCE 기본값 마스킹
  if (field in MASKED_DEFAULTS && value === MASKED_DEFAULTS[field]) return true;
  // units 특수 케이스 (세대수 미상)
  if (field === "units" && value <= 1) return true;
  return false;
}

// ── 감사 계산 ────────────────────────────────────────────────
export function computeAudit(rows) {
  const total = rows.length;
  if (total === 0) return { total: 0, categories: {}, fields: {}, regions: {} };

  // 필드별 null 카운트
  const fieldStats = {};
  for (const [cat, { fields }] of Object.entries(AUDIT_FIELDS)) {
    for (const f of fields) {
      fieldStats[`${cat}.${f}`] = { category: cat, field: f, filled: 0, missing: 0 };
    }
  }

  // 지역별 집계
  const regionStats = {};

  for (const row of rows) {
    const region = row.region || "기타";
    if (!regionStats[region]) regionStats[region] = { total: 0, filled: 0, checked: 0 };
    regionStats[region].total++;

    for (const [cat, { fields }] of Object.entries(AUDIT_FIELDS)) {
      for (const f of fields) {
        const key = `${cat}.${f}`;
        const isNull = isFieldNull(f, row[f]);
        if (isNull) fieldStats[key].missing++;
        else fieldStats[key].filled++;

        regionStats[region].checked++;
        if (!isNull) regionStats[region].filled++;
      }
    }
  }

  // 카테고리별 집계
  const categories = {};
  for (const [cat, { collector, fields }] of Object.entries(AUDIT_FIELDS)) {
    let catFilled = 0;
    let catTotal = 0;
    for (const f of fields) {
      const s = fieldStats[`${cat}.${f}`];
      catFilled += s.filled;
      catTotal += s.filled + s.missing;
    }
    categories[cat] = {
      collector,
      filled: catFilled,
      total: catTotal,
      rate: catTotal > 0 ? Math.round((catFilled / catTotal) * 1000) / 10 : 0,
    };
  }

  // 지역별 커버리지율
  const regions = {};
  for (const [r, s] of Object.entries(regionStats)) {
    regions[r] = {
      apartments: s.total,
      rate: s.checked > 0 ? Math.round((s.filled / s.checked) * 1000) / 10 : 0,
    };
  }

  // dataReliability 평균
  const reliabilities = rows.map(r => r.dataReliability ?? 0);
  const avgReliability = Math.round(reliabilities.reduce((a, b) => a + b, 0) / total * 10) / 10;

  return { total, avgReliability, categories, fields: fieldStats, regions };
}

// ── 콘솔 리포트 포맷팅 ──────────────────────────────────────
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

// 콘솔 리포트 커버리지 임계값
const RATE_EXCELLENT = 80; // % — 녹색 (우수)
const RATE_WARNING = 50;   // % — 노랑 (양호)

function colorByRate(rate) {
  if (rate >= RATE_EXCELLENT) return GREEN;
  if (rate >= RATE_WARNING) return YELLOW;
  return RED;
}

function bar(rate) {
  const filled = Math.round(rate / 10);
  return "■".repeat(filled) + "□".repeat(10 - filled);
}

function printReport(audit) {
  const { total, avgReliability, categories, fields, regions } = audit;

  log(PHASE, `\n=== 데이터 완성도 감사 ===`);
  log(PHASE, `총 아파트: ${total.toLocaleString()}건  |  평균 dataReliability: ${avgReliability}%\n`);

  // 카테고리별
  log(PHASE, `[카테고리별 커버리지]`);
  for (const [cat, s] of Object.entries(categories)) {
    const c = colorByRate(s.rate);
    const pad = cat.padEnd(14);
    log(PHASE, `  ${c}${pad} ${String(s.rate).padStart(5)}%  ${bar(s.rate)}${RESET}  ${DIM}(${s.collector})${RESET}`);
  }

  // 필드별 상세 (누락률 20% 이상)
  const badFields = Object.entries(fields)
    .map(([key, s]) => ({ key, ...s, rate: (s.filled / (s.filled + s.missing)) * 100 }))
    .filter(f => f.rate < 80 && !PERMANENT_NULL.has(f.field))
    .sort((a, b) => a.rate - b.rate);

  if (badFields.length > 0) {
    log(PHASE, `\n[필드별 상세 — 커버리지 80% 미만]`);
    for (const f of badFields) {
      const c = colorByRate(f.rate);
      log(PHASE, `  ${c}${f.key.padEnd(30)} ${String(f.filled).padStart(5)}/${f.filled + f.missing}  ${f.rate.toFixed(1)}%${RESET}`);
    }
  }

  // 지역별 worst 5
  const worstRegions = Object.entries(regions)
    .sort(([, a], [, b]) => a.rate - b.rate)
    .slice(0, 5);

  if (worstRegions.length > 0) {
    log(PHASE, `\n[지역별 커버리지 worst 5]`);
    log(PHASE, `  ${worstRegions.map(([r, s]) => `${r}: ${s.rate}% (${s.apartments}건)`).join("  |  ")}`);
  }

  log(PHASE, "");
}

// ── 배치 페이지네이션 (PostgREST 1000행 제한 우회) ───────────
export async function fetchAllFromView(sb, regionFilter) {
  const allRows = [];

  let query = sb.from("apartments_flat").select("*", { count: "exact" });
  if (regionFilter) query = query.eq("region", regionFilter);
  query = query.range(0, BATCH_SIZE - 1);

  const { data: firstBatch, error, count } = await query;
  if (error) throw new Error(`apartments_flat 조회 실패: ${error.message}`);
  allRows.push(...(firstBatch || []));

  if (count && count > BATCH_SIZE) {
    const remaining = Math.ceil((count - BATCH_SIZE) / BATCH_SIZE);
    for (let i = 1; i <= remaining; i++) {
      const offset = i * BATCH_SIZE;
      let batchQuery = sb.from("apartments_flat").select("*");
      if (regionFilter) batchQuery = batchQuery.eq("region", regionFilter);
      batchQuery = batchQuery.range(offset, offset + BATCH_SIZE - 1);

      const { data: batch, error: batchError } = await batchQuery;
      if (batchError) {
        logError(PHASE, `배치 ${i} 조회 실패: ${batchError.message}`);
        break;
      }
      if (batch) allRows.push(...batch);
      if (!batch || batch.length < BATCH_SIZE) break;
    }
  }

  return allRows;
}

// ── CLI 인자 파싱 ────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { json: false, region: null };
  for (const arg of args) {
    if (arg === "--json") flags.json = true;
    else if (arg.startsWith("--region=")) flags.region = arg.slice("--region=".length);
  }
  return flags;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const flags = parseArgs();
  const sb = getSupabase();

  // 전체 데이터 조회
  const rows = await fetchAllFromView(sb, flags.region);
  if (rows.length === 0) {
    log(PHASE, "대상 아파트 없음, 종료");
    return;
  }

  log(PHASE, `${rows.length}건 조회 완료${flags.region ? ` (지역: ${flags.region})` : ""}`);

  // 감사 계산
  const audit = computeAudit(rows);

  if (flags.json) {
    // JSON 출력 (집계 통계만, 아파트 이름/주소 등 PII 미포함)
    const output = {
      timestamp: new Date().toISOString(),
      totalApartments: audit.total,
      avgReliability: audit.avgReliability,
      categories: audit.categories,
      fields: Object.fromEntries(
        Object.entries(audit.fields).map(([k, v]) => [k, { filled: v.filled, missing: v.missing }])
      ),
      regions: audit.regions,
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } else {
    printReport(audit);
  }
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
