/**
 * 마이그레이션 스크립트 — apartments.json → Supabase 9개 테이블
 *
 * 사용법:
 *   node scripts/migrate-to-supabase.mjs
 *   node scripts/migrate-to-supabase.mjs --dry-run     (DB 쓰기 없이 검증만)
 *   node scripts/migrate-to-supabase.mjs --file=path   (다른 JSON 경로 지정)
 *
 * 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (.env 또는 환경변수)
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 건설사 별칭 정규화 ───────────────────────────────────────
const BUILDER_ALIASES = {
  "지에스건설": "GS건설", "GS건설(주)": "GS건설", "(주)GS건설": "GS건설",
  "현대건설(주)": "현대건설", "(주)현대건설": "현대건설",
  "(주)대우건설": "대우건설", "대우건설(주)": "대우건설",
  "에이치디씨현대산업개발": "HDC현대산업개발", "HDC현대산업개발(주)": "HDC현대산업개발",
  "디엘이앤씨": "DL이앤씨", "DL이앤씨(주)": "DL이앤씨",
  "포스코이앤씨(주)": "포스코이앤씨", "(주)포스코이앤씨": "포스코이앤씨",
  "삼성물산(주)": "삼성물산", "삼성물산건설부문": "삼성물산",
  "롯데건설(주)": "롯데건설", "(주)롯데건설": "롯데건설",
  "대림산업(주)": "대림산업", "(주)대림산업": "대림산업",
  "한화건설(주)": "한화건설", "(주)한화건설": "한화건설",
  "호반건설(주)": "호반건설", "(주)호반건설": "호반건설",
  "SK에코플랜트(주)": "SK에코플랜트",
  "태영건설(주)": "태영건설", "(주)태영건설": "태영건설",
  "금호건설(주)": "금호건설", "(주)금호건설": "금호건설",
};
function resolveBuilder(name) {
  if (!name) return "기타";
  return BUILDER_ALIASES[name.trim()] ?? name.trim();
}

// ── .env 파싱 ──────────────────────────────────────────────
function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

// ── CLI 인자 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find(a => a.startsWith("--file="));
const jsonPath = fileArg
  ? resolve(ROOT, fileArg.replace("--file=", ""))
  : resolve(ROOT, "public/data/apartments.json");

// ── Supabase 클라이언트 ────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) {
  console.error("❌ SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수 필요");
  process.exit(1);
}

const supabase = dryRun
  ? null
  : createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

// ── JSON 로드 ──────────────────────────────────────────────
console.log(`📂 JSON 파일: ${jsonPath}`);
const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
const apartments = raw.data;
console.log(`📊 아파트 ${apartments.length}건 로드`);

// ── 데이터 분해 ────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10); // "2026-03-08"

/** apartments 테이블 행 */
function toApartmentRow(a) {
  return {
    id: a.id,
    name: a.name,
    region: a.region,
    gu: a.gu ?? null,
    dong: a.dong ?? null,
    address: a.address ?? null,
    lat: a.lat ?? null,
    lng: a.lng ?? null,
    builder: resolveBuilder(a.builder),
    units: a.units ?? null,
    unsold: a.unsold ?? null,
    unsold_rate: a.unsoldRate ?? null,
    completion: a.completion ?? null,
    heating: a.heating ?? null,
    layout: a.layout ?? null,
    max_floor: a.maxFloor ?? null,
    parking_ratio: a.parkingRatio ?? null,
    floor_area_ratio: a.floorAreaRatio ?? null,
    exclusive_ratio: a.exclusiveRatio ?? null,
    energy_grade: a.energyGrade ?? null,
    green_bldg: a.greenBldg ?? null,
    quake_design: a.quakeDesign ?? null,
    has_pool: a.hasPool ?? null,
    dsr40pass: a.dsr40pass ?? null,
    announcement_url: a.announcementUrl ?? null,
    unit_source: a.unitSource ?? null,
    // 혜택
    discount_pct: a.discountPct ?? null,
    loan_free: a.loanFree ?? null,
    loan_free_pct: a.loanFreePct ?? null,
    option_free: a.optionFree ?? null,
    option_value: a.optionValue ?? null,
    balcony_free: a.balconyFree ?? null,
    balcony_value: a.balconyValue ?? null,
    cashback: a.cashback ?? null,
    contract_discount: a.contractDiscount ?? null,
    benefits: a.benefits ?? null,
    // 미래가치
    transit_dev: a.transitDev ?? null,
    dev_dist: a.devDist ?? null,
    city_dev: a.cityDev ?? null,
    industry_dev: a.industryDev ?? null,
    // 환경
    view: a.view ?? null,
    sunlight: a.sunlight ?? null,
    noise: a.noise ?? null,
    noxious: a.noxious ?? null,
    // 네이버 교차검증
    naver_nearby_median: a.naverNearbyMedian ?? null,
    naver_nearby_avg: a.naverNearbyAvg ?? null,
    naver_jeonse_rate: a.naverJeonseRate ?? null,
    naver_sell_count: a.naverSellCount ?? null,
    naver_jeonse_count: a.naverJeonseCount ?? null,
    naver_wolse_count: a.naverWolseCount ?? null,
    naver_build_year: a.naverBuildYear ?? null,
    naver_avg_floor: a.naverAvgFloor ?? null,
    naver_school_walk_min: a.naverSchoolWalkMin ?? null,
    naver_nearby_count: a.naverNearbyCount ?? null,
    naver_fetched_at: a.naverFetchedAt ?? null,
  };
}

/** prices 테이블 행 */
function toPriceRow(a) {
  if (a.price == null) return null;
  return {
    apartment_id: a.id,
    area: a.area ?? null,
    supply_area: a.supplyArea ?? null,
    price: a.price,
    pp: a.pp ?? null,
    house_type: a.houseType ?? "default",
    supply_count: a.supplyCount ?? null,
    recorded_at: today,
  };
}

/** infra 테이블 행 */
function toInfraRow(a) {
  // 인프라 데이터가 하나라도 있으면 행 생성
  if (a.hospital == null && a.mart == null && a.subwayDist == null) return null;
  return {
    apartment_id: a.id,
    hospital: a.hospital ?? 0,
    hospital_dist: a.hospitalDist ?? null,
    mart: a.mart ?? 0,
    mart_dist: a.martDist ?? null,
    conv: a.conv ?? 0,
    conv_dist: a.convDist ?? null,
    cafe: a.cafe ?? 0,
    cafe_dist: a.cafeDist ?? null,
    culture: a.culture ?? 0,
    culture_dist: a.cultureDist ?? null,
    bank: a.bank ?? 0,
    bank_dist: a.bankDist ?? null,
    pharmacy: a.pharmacy ?? 0,
    pharmacy_dist: a.pharmacyDist ?? null,
    park: a.park ?? 0,
    park_dist: a.parkDist ?? null,
    subway_dist: a.subwayDist ?? null,
    nearby_facilities: a.nearbyFacilities ?? null,
  };
}

/** schools 테이블 행 */
function toSchoolRow(a) {
  if (a.schoolScore == null) return null;
  return {
    apartment_id: a.id,
    school_score: a.schoolScore,
    school_grade: a.schoolGrade ?? null,
    nearby_schools: a.nearbySchools ?? null,
  };
}

/** transport 테이블 행 */
function toTransportRow(a) {
  if (a.busRoutes == null && a.icDist == null && a.ktxDist == null) return null;
  return {
    apartment_id: a.id,
    bus_routes: a.busRoutes ?? 0,
    ic_dist: a.icDist ?? null,
    ktx_dist: a.ktxDist ?? null,
  };
}

/** trade_stats 테이블 행 */
function toTradeStatsRow(a) {
  if (a.nearbyMedian == null && a.jeonseRate == null) return null;
  return {
    apartment_id: a.id,
    nearby_median: a.nearbyMedian ?? null,
    recent_trades_6m: a.recentTrades6m ?? null,
    jeonse_rate: a.jeonseRate ?? null,
    pir: a.pir ?? null,
    psr: a.psr ?? null,
  };
}

// ── 데이터 분해 실행 ───────────────────────────────────────
const aptRows = [];
const priceRows = [];
const infraRows = [];
const schoolRows = [];
const transportRows = [];
const tradeStatsRows = [];
const builderMap = new Map();  // builder name → { debt_ratio, credit_grade }
const regionMap = new Map();   // region → { pop_growth }

for (const a of apartments) {
  aptRows.push(toApartmentRow(a));

  const pr = toPriceRow(a);
  if (pr) priceRows.push(pr);

  const inf = toInfraRow(a);
  if (inf) infraRows.push(inf);

  const sch = toSchoolRow(a);
  if (sch) schoolRows.push(sch);

  const tr = toTransportRow(a);
  if (tr) transportRows.push(tr);

  const ts = toTradeStatsRow(a);
  if (ts) tradeStatsRows.push(ts);

  // 건설사 (중복 제거, 별칭 정규화)
  const normalizedBuilder = resolveBuilder(a.builder);
  if (normalizedBuilder !== "기타" && (a.builderDebtRatio != null || a.builderCreditGrade != null)) {
    if (!builderMap.has(normalizedBuilder)) {
      builderMap.set(normalizedBuilder, {
        name: normalizedBuilder,
        debt_ratio: a.builderDebtRatio ?? null,
        credit_grade: a.builderCreditGrade ?? null,
        hug_guarantee: a.hugGuarantee ?? null,
      });
    }
  }

  // 지역 (중복 제거)
  if (a.region && a.popGrowth != null) {
    if (!regionMap.has(a.region)) {
      regionMap.set(a.region, {
        region: a.region,
        gu: null,
        pop_growth: a.popGrowth,
        supply_ratio: a.supplyRatio ?? null,
        recorded_at: today,
      });
    }
  }
}

const builderRows = [...builderMap.values()];
const regionRows = [...regionMap.values()];

// ── 통계 출력 ──────────────────────────────────────────────
console.log("\n📋 분해 결과:");
console.log(`  apartments:   ${aptRows.length}`);
console.log(`  prices:       ${priceRows.length}`);
console.log(`  infra:        ${infraRows.length}`);
console.log(`  schools:      ${schoolRows.length}`);
console.log(`  transport:    ${transportRows.length}`);
console.log(`  trade_stats:  ${tradeStatsRows.length}`);
console.log(`  builders:     ${builderRows.length}`);
console.log(`  regions:      ${regionRows.length}`);

if (dryRun) {
  console.log("\n🔍 --dry-run 모드: DB 쓰기 생략");
  // 샘플 출력
  console.log("\n── 샘플 apartment ──");
  console.log(JSON.stringify(aptRows[0], null, 2));
  console.log("\n── 샘플 price ──");
  console.log(JSON.stringify(priceRows[0], null, 2));
  console.log("\n── 샘플 builder ──");
  console.log(JSON.stringify(builderRows[0], null, 2));
  process.exit(0);
}

// ── Supabase upsert ────────────────────────────────────────
async function upsertBatch(table, rows, conflictCol = "id", batchSize = 500) {
  if (!rows.length) {
    console.log(`  ⏭  ${table}: 0건 (스킵)`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictCol, ignoreDuplicates: false });

    if (error) {
      console.error(`  ❌ ${table} 배치 ${i}~${i + batch.length}: ${error.message}`);
      // 개별 행 재시도
      for (const row of batch) {
        const { error: e2 } = await supabase
          .from(table)
          .upsert([row], { onConflict: conflictCol, ignoreDuplicates: false });
        if (e2) {
          console.error(`    ⚠ ${table} 행 실패:`, row[conflictCol] || row.apartment_id, e2.message);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ✅ ${table}: ${inserted}/${rows.length}건 upsert`);
}

async function migrate() {
  console.log("\n🚀 Supabase 마이그레이션 시작...\n");

  // 순서 중요: apartments 먼저 (FK 참조)
  await upsertBatch("apartments", aptRows, "id");
  await upsertBatch("prices", priceRows, "apartment_id,house_type,recorded_at");
  await upsertBatch("infra", infraRows, "apartment_id");
  await upsertBatch("schools", schoolRows, "apartment_id");
  await upsertBatch("transport", transportRows, "apartment_id");
  await upsertBatch("trade_stats", tradeStatsRows, "apartment_id");
  await upsertBatch("builders", builderRows, "name");
  await upsertBatch("regions", regionRows, "region,gu,recorded_at");

  // ── 검증 ──────────────────────────────────────────────────
  console.log("\n🔍 검증 중...");
  const { count: aptCount } = await supabase
    .from("apartments")
    .select("*", { count: "exact", head: true });
  const { count: priceCount } = await supabase
    .from("prices")
    .select("*", { count: "exact", head: true });

  console.log(`  apartments: ${aptCount}건 (원본: ${aptRows.length})`);
  console.log(`  prices:     ${priceCount}건 (원본: ${priceRows.length})`);

  if (aptCount === aptRows.length) {
    console.log("\n✅ 마이그레이션 완료!");
  } else {
    console.log("\n⚠ 건수 불일치 — 로그를 확인하세요");
  }
}

migrate().catch(err => {
  console.error("❌ 마이그레이션 실패:", err);
  process.exit(1);
});
