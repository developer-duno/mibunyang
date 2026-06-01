// @ts-check
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

/**
 * @typedef {{ collector: string, fields: string[] }} AuditFieldEntry
 * @typedef {{ collector: string, filled: number, total: number, rate: number }} AuditCategoryStat
 * @typedef {{ category: string, field: string, filled: number, missing: number }} AuditFieldStat
 * @typedef {{ apartments: number, rate: number }} AuditRegionStat
 * @typedef {{ total: number, filled: number, checked: number }} RegionRunStat
 * @typedef {{ total: number, avgReliability?: number, categories: Record<string, AuditCategoryStat>, fields: Record<string, AuditFieldStat>, regions: Record<string, AuditRegionStat> }} AuditResult
 * @typedef {{ id: string, name?: string, region?: string, dataReliability?: number, units?: number, [k: string]: unknown }} FlatRow
 */

loadEnv();

const PHASE = "data-audit";
const BATCH_SIZE = 1000;

// ── 영구 미수집 필드 (공공 API 소스 부재) ─────────────────────
// quakeDesign/greenBldg: V4 API에서 제거됨.
// energyGrade: 세션 358 정정 — kaptdEcnt(승강기대수) 오인 제거. 주거용 아파트
//   에너지효율등급은 공공 data.go.kr API 미제공 (scripts/CLAUDE.md "BldEngyHubService 한계").
const PERMANENT_NULL = new Set(["quakeDesign", "greenBldg", "energyGrade"]);

// ── 특수 null 판정 (VIEW COALESCE/기본값 마스킹) ──────────────
/** @type {Record<string, number>} */
const MASKED_DEFAULTS = { subwayDist: 9999, icDist: 99, ktxDist: 99 };

// ── AUDIT_FIELDS: 19 카테고리, ~91 필드 ──────────────────────
/** @type {Record<string, AuditFieldEntry>} */
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
    fields: ["maxFloor", "parkingRatio", "floorAreaRatio", "exclusiveRatio", "energyGrade", "heating", "corridorType", "heatFuel", "avgMaintenanceCost", "primaryDirection", "floors", "hasPool"],
  },
  maintenance: {
    collector: "collect-maintenance",
    fields: ["maintHeat", "maintHotwater", "maintGas", "maintElec", "maintWater"],
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
    fields: ["popGrowth", "supplyRatio", "netMigration", "priceIndex", "avgPriceSqm", "newSupply", "initialSaleRate", "landCostRatio"],
  },
  trade_stats: {
    collector: "trade-stats",
    fields: [
      "nearbyMedian", "recentTrades6m", "jeonseRate", "pir", "psr",
      "avgFloor", "nearbyBuildYear", "floorRange",
      "priceByArea", "rentByArea", "jeonseByArea", "priceByFloor",
      "cancelRatio6m",
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
  energy: {
    collector: "collect-building-hub",
    fields: ["elecUsageKwh", "gasUsageMj", "energyCollectedAt"],
  },
  competition: {
    collector: "collect-applyhome",
    fields: ["competitionRate", "competitionSupply", "competitionApplicants"],
  },
  air: {
    collector: "collect-air-quality",
    fields: ["airQuality"],
  },
  safety: {
    collector: "crime-safety+emergency",
    fields: ["crimeSafetyGrade", "emergency", "emergencyDist", "emergencyName", "emergencyType"],
  },
};


// ── null 판정 ────────────────────────────────────────────────
/**
 * @param {string} field
 * @param {unknown} value
 * @returns {boolean}
 */
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
  if (field === "units" && typeof value === "number" && value <= 1) return true;
  return false;
}

// ── 감사 계산 ────────────────────────────────────────────────
/**
 * @param {FlatRow[]} rows
 * @returns {AuditResult}
 */
export function computeAudit(rows) {
  const total = rows.length;
  if (total === 0) return { total: 0, categories: {}, fields: {}, regions: {} };

  // 필드별 null 카운트
  /** @type {Record<string, AuditFieldStat>} */
  const fieldStats = {};
  for (const [cat, { fields }] of Object.entries(AUDIT_FIELDS)) {
    for (const f of fields) {
      fieldStats[`${cat}.${f}`] = { category: cat, field: f, filled: 0, missing: 0 };
    }
  }

  // 지역별 집계
  /** @type {Record<string, RegionRunStat>} */
  const regionStats = {};

  for (const row of rows) {
    const region = (typeof row.region === "string" && row.region) ? row.region : "기타";
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
  /** @type {Record<string, AuditCategoryStat>} */
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
  /** @type {Record<string, AuditRegionStat>} */
  const regions = {};
  for (const [r, s] of Object.entries(regionStats)) {
    regions[r] = {
      apartments: s.total,
      rate: s.checked > 0 ? Math.round((s.filled / s.checked) * 1000) / 10 : 0,
    };
  }

  // dataReliability 평균
  const reliabilities = rows.map((/** @type {FlatRow} */ r) => /** @type {number} */ (r.dataReliability ?? 0));
  const avgReliability = Math.round(reliabilities.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) / total * 10) / 10;

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

/**
 * @param {number} rate
 * @returns {string}
 */
function colorByRate(rate) {
  if (rate >= RATE_EXCELLENT) return GREEN;
  if (rate >= RATE_WARNING) return YELLOW;
  return RED;
}

/**
 * @param {number} rate
 * @returns {string}
 */
function bar(rate) {
  const filled = Math.round(rate / 10);
  return "■".repeat(filled) + "□".repeat(10 - filled);
}

/**
 * @param {AuditResult} audit
 */
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

// ── 테이블별 개별 쿼리 + 메모리 merge (VIEW 타임아웃 방지) ──
/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} table
 * @param {string} columns
 * @param {string | null} filterCol
 * @param {string | null} filterVal
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchAllFromTable(sb, table, columns, filterCol, filterVal) {
  /** @type {Record<string, unknown>[]} */
  const allRows = [];
  let query = sb.from(table).select(columns, { count: "exact" });
  if (filterCol && filterVal) query = query.eq(filterCol, filterVal);
  query = query.range(0, BATCH_SIZE - 1);

  const { data: first, error, count } = await query;
  if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
  allRows.push(.../** @type {Record<string, unknown>[]} */ (/** @type {unknown} */ (first || [])));

  if (count && count > BATCH_SIZE) {
    for (let i = 1; i * BATCH_SIZE < count; i++) {
      const offset = i * BATCH_SIZE;
      let q = sb.from(table).select(columns);
      if (filterCol && filterVal) q = q.eq(filterCol, filterVal);
      q = q.range(offset, offset + BATCH_SIZE - 1);
      const { data: batch, error: bErr } = await q;
      if (bErr) { logError(PHASE, `${table} 배치 ${i} 실패: ${bErr.message}`); break; }
      if (batch) allRows.push(.../** @type {Record<string, unknown>[]} */ (/** @type {unknown} */ (batch)));
      if (!batch || batch.length < BATCH_SIZE) break;
    }
  }
  return allRows;
}

// apartments 컬럼 (core + building + risk + benefits + naver + environment + future + air/safety)
const APT_COLS = "id,name,region,gu,dong,address,road_address,district,lat,lng,builder,units,completion,layout," +
  "max_floor,parking_ratio,floor_area_ratio,exclusive_ratio,energy_grade,heating,corridor_type,heat_fuel,avg_maintenance_cost,maint_heat,maint_hotwater,maint_gas,maint_elec,maint_water,primary_direction,floors,has_pool," +
  "is_regulated,dsr40pass," +
  "discount_pct,loan_free,balcony_free,cashback,benefits," +
  "view,sunlight,noise,noxious,noxious_dist," +
  "air_quality,crime_safety_grade," +
  "transit_dev,dev_dist,city_dev,industry_dev," +
  "naver_nearby_median,naver_nearby_avg,naver_jeonse_rate,naver_sell_count,naver_jeonse_count," +
  "naver_wolse_count,naver_build_year,naver_avg_floor,naver_school_walk_min,naver_nearby_count," +
  "elec_usage_kwh,gas_usage_mj,energy_collected_at," +
  "competition_rate,competition_supply,competition_applicants";

// snake_case → camelCase 변환
/**
 * @param {Record<string, unknown>} row
 * @returns {FlatRow}
 */
function toCamel(row) {
  /** @type {Record<string, string>} */
  const map = {
    road_address: "roadAddress", max_floor: "maxFloor", parking_ratio: "parkingRatio",
    floor_area_ratio: "floorAreaRatio", exclusive_ratio: "exclusiveRatio",
    energy_grade: "energyGrade", has_pool: "hasPool", is_regulated: "isRegulated",
    corridor_type: "corridorType", heat_fuel: "heatFuel",
    avg_maintenance_cost: "avgMaintenanceCost",
    maint_heat: "maintHeat", maint_hotwater: "maintHotwater",
    maint_gas: "maintGas", maint_elec: "maintElec", maint_water: "maintWater",
    primary_direction: "primaryDirection",
    discount_pct: "discountPct", loan_free: "loanFree", balcony_free: "balconyFree",
    noxious_dist: "noxiousDist",
    air_quality: "airQuality", crime_safety_grade: "crimeSafetyGrade",
    transit_dev: "transitDev", dev_dist: "devDist",
    city_dev: "cityDev", industry_dev: "industryDev",
    naver_nearby_median: "naverNearbyMedian", naver_nearby_avg: "naverNearbyAvg",
    naver_jeonse_rate: "naverJeonseRate", naver_sell_count: "naverSellCount",
    naver_jeonse_count: "naverJeonseCount", naver_wolse_count: "naverWolseCount",
    naver_build_year: "naverBuildYear", naver_avg_floor: "naverAvgFloor",
    naver_school_walk_min: "naverSchoolWalkMin", naver_nearby_count: "naverNearbyCount",
    elec_usage_kwh: "elecUsageKwh", gas_usage_mj: "gasUsageMj",
    energy_collected_at: "energyCollectedAt",
    competition_rate: "competitionRate", competition_supply: "competitionSupply",
    competition_applicants: "competitionApplicants",
  };
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(row)) out[map[k] || k] = v;
  return /** @type {FlatRow} */ (out);
}

// 관련 테이블 merge (apartment_id 또는 name 기준)
/**
 * @param {FlatRow[]} aptRows
 * @param {Record<string, unknown>[]} relatedRows
 * @param {string} joinKey
 * @param {string} targetKey
 * @param {Record<string, string>} colMap
 */
function mergeRelated(aptRows, relatedRows, joinKey, targetKey, colMap) {
  /** @type {Map<unknown, Record<string, unknown>>} */
  const lookup = new Map();
  for (const r of relatedRows) lookup.set(r[joinKey], r);
  for (const apt of aptRows) {
    const rel = lookup.get(apt[targetKey]);
    if (!rel) continue;
    for (const [src, dst] of Object.entries(colMap)) apt[dst] = rel[src];
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string | null} regionFilter
 * @returns {Promise<FlatRow[]>}
 */
export async function fetchAllFromView(sb, regionFilter) {
  // 1. apartments 메인 테이블
  log(PHASE, "  apartments 테이블 조회...");
  const rawApts = await fetchAllFromTable(sb, "apartments", APT_COLS, regionFilter ? "region" : null, regionFilter);
  const apts = rawApts.map(toCamel);
  log(PHASE, `  apartments: ${apts.length}건`);

  const aptIds = apts.map(a => a.id);
  if (aptIds.length === 0) return apts;

  // 2~8. 관련 테이블 병렬 쿼리
  log(PHASE, "  관련 테이블 7개 병렬 조회...");
  const [prices, infra, schools, transport, builders, regions, tradeStats] = await Promise.all([
    fetchAllFromTable(sb, "prices", "apartment_id,area,price,pp", null, null),
    fetchAllFromTable(sb, "infra", "apartment_id,hospital,mart,conv,cafe,culture,bank,pharmacy,park,hospital_dist,mart_dist,conv_dist,cafe_dist,culture_dist,bank_dist,pharmacy_dist,park_dist,subway_dist,nearby_facilities,emergency,emergency_dist,emergency_name,emergency_type", null, null),
    fetchAllFromTable(sb, "schools", "apartment_id,school_score,school_grade,nearby_schools", null, null),
    fetchAllFromTable(sb, "transport", "apartment_id,subway_dist,bus_routes,ic_dist,ktx_dist,subway_name,subway_lines,bus_stop_names", null, null),
    fetchAllFromTable(sb, "builders", "name,debt_ratio,credit_grade,hug_guarantee", null, null),
    fetchAllFromTable(sb, "regions", "region,gu,recorded_at,pop_growth,supply_ratio,net_migration,price_index,avg_price_sqm,new_supply,initial_sale_rate,land_cost_ratio", null, null),
    fetchAllFromTable(sb, "trade_stats", "apartment_id,nearby_median,recent_trades_6m,jeonse_rate,pir,psr,avg_floor,nearby_build_year,floor_range,price_by_area,rent_by_area,jeonse_by_area,price_by_floor,cancel_ratio_6m", null, null),
  ]);

  // merge prices (latest per apartment — prices 테이블은 시계열, 최신 1건만)
  const latestPrices = new Map();
  for (const p of prices) {
    if (!latestPrices.has(p.apartment_id)) latestPrices.set(p.apartment_id, p);
  }
  for (const apt of apts) {
    const p = latestPrices.get(apt.id);
    if (!p) continue;
    apt.area = p.area;
    apt.price = p.price;
    apt.pp = p.pp;
  }

  // merge infra
  mergeRelated(apts, infra, "apartment_id", "id", {
    hospital: "hospital", mart: "mart", conv: "conv", cafe: "cafe",
    culture: "culture", bank: "bank", pharmacy: "pharmacy", park: "park",
    hospital_dist: "hospitalDist", mart_dist: "martDist", conv_dist: "convDist",
    cafe_dist: "cafeDist", culture_dist: "cultureDist", bank_dist: "bankDist",
    pharmacy_dist: "pharmacyDist", park_dist: "parkDist", subway_dist: "subwayDist",
    nearby_facilities: "nearbyFacilities",
    emergency: "emergency", emergency_dist: "emergencyDist",
    emergency_name: "emergencyName", emergency_type: "emergencyType",
  });

  // merge schools
  mergeRelated(apts, schools, "apartment_id", "id", {
    school_score: "schoolScore", school_grade: "schoolGrade", nearby_schools: "nearbySchools",
  });

  // merge transport (subwayDist: transport 우선, 없으면 infra에서 이미 설정됨)
  for (const t of transport) {
    const apt = apts.find((/** @type {FlatRow} */ a) => a.id === t.apartment_id);
    if (!apt) continue;
    if (t.subway_dist != null) apt.subwayDist = t.subway_dist;
    apt.busRoutes = t.bus_routes;
    apt.icDist = t.ic_dist;
    apt.ktxDist = t.ktx_dist;
    apt.subwayName = t.subway_name;
    apt.subwayLines = t.subway_lines;
    apt.busStopNames = t.bus_stop_names;
  }

  // merge builders (join by name)
  mergeRelated(apts, builders, "name", "builder", {
    debt_ratio: "builderDebtRatio", credit_grade: "builderCreditGrade", hug_guarantee: "hugGuarantee",
  });

  // merge regions (VIEW latest_regions 재현: gu IS NULL 시도 레벨 + recorded_at 최신)
  const regionLookup = new Map();
  for (const r of regions) {
    if (r.gu != null) continue; // 시도 레벨만 (market_stats 5컬럼은 시도 행에만 채워짐)
    const prev = regionLookup.get(r.region);
    if (!prev || String(r.recorded_at) > String(prev.recorded_at)) regionLookup.set(r.region, r);
  }
  for (const apt of apts) {
    const r = regionLookup.get(apt.region);
    if (!r) continue;
    apt.popGrowth = r.pop_growth;
    apt.supplyRatio = r.supply_ratio;
    apt.netMigration = r.net_migration;
    apt.priceIndex = r.price_index;
    apt.avgPriceSqm = r.avg_price_sqm;
    apt.newSupply = r.new_supply;
    apt.initialSaleRate = r.initial_sale_rate;
    apt.landCostRatio = r.land_cost_ratio;
  }

  // merge trade_stats
  mergeRelated(apts, tradeStats, "apartment_id", "id", {
    nearby_median: "nearbyMedian", recent_trades_6m: "recentTrades6m",
    jeonse_rate: "jeonseRate", pir: "pir", psr: "psr",
    avg_floor: "avgFloor", nearby_build_year: "nearbyBuildYear", floor_range: "floorRange",
    price_by_area: "priceByArea", rent_by_area: "rentByArea",
    jeonse_by_area: "jeonseByArea", price_by_floor: "priceByFloor",
    cancel_ratio_6m: "cancelRatio6m",
  });

  // dataReliability 계산 (VIEW의 SQL 로직 재현)
  for (const apt of apts) {
    apt.dataReliability = Math.max(0, Math.min(100,
      (apt.nearbyMedian != null ? 15 : 0) +
      (apt.hospital != null ? 12 : 0) +
      (apt.schoolScore != null ? 12 : 0) +
      (apt.busRoutes != null ? 10 : 0) +
      (apt.builderDebtRatio != null ? 8 : 0) +
      (apt.popGrowth != null ? 8 : 0) +
      (apt.nearbyMedian != null ? 15 : 0) +
      (apt.jeonseRate != null ? 10 : 0) +
      ((typeof apt.units === "number" && apt.units > 1) ? 10 : 0)
    ));
  }

  log(PHASE, `  merge 완료: ${apts.length}건`);
  return apts;
}

// ── CLI 인자 파싱 ────────────────────────────────────────────
/**
 * @returns {{ json: boolean, region: string | null }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  /** @type {{ json: boolean, region: string | null }} */
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
const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { logError(PHASE, err instanceof Error ? err.message : String(err)); process.exit(1); });
