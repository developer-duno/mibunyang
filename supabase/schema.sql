-- ============================================================
-- 미분양 아파트 비교 엔진 v3.0 — Supabase 스키마
-- 14개 테이블 + 1 VIEW: apartments, prices, unsold_history, trades,
--            trade_stats, infra, schools, transport, builders, regions,
--            complexes, articles, complex_price_history, consults
-- ============================================================

-- 1. apartments (정적 데이터, ~1,500행)
CREATE TABLE IF NOT EXISTS apartments (
  id TEXT PRIMARY KEY,                    -- "ah-{HOUSE_MANAGE_NO}"
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  gu TEXT,
  dong TEXT,
  address TEXT,
  road_address TEXT,
  district TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  builder TEXT,
  units INTEGER,
  unsold INTEGER,
  unsold_rate REAL,                       -- 미분양률 (%)
  completion TEXT,                        -- "202605"
  heating TEXT,
  layout TEXT,
  max_floor INTEGER,
  floors TEXT,
  is_regulated BOOLEAN DEFAULT false,
  parking_ratio REAL,
  floor_area_ratio REAL,
  exclusive_ratio REAL,
  energy_grade INTEGER,
  green_bldg TEXT,
  quake_design BOOLEAN,
  has_pool BOOLEAN,
  dsr40pass BOOLEAN,                     -- DSR 40% 통과 여부
  announcement_url TEXT,
  unit_source TEXT,                       -- "naver" | "applyhome"
  avg_maintenance_cost INTEGER,          -- 관리비 (만원/세대/월)
  primary_direction TEXT,                -- 주방향 (남향/동향 등)
  earthquake_design BOOLEAN,             -- 내진설계 여부 (추론 기반)
  entrance_type TEXT,                    -- 현관구조 (계단식/복도식)
  heat_method TEXT,                      -- 난방방식 (개별/지역/중앙)
  heat_fuel TEXT,                        -- 난방연료 (도시가스/지역난방)
  corridor_type TEXT,                    -- 복도유형 (복도식/계단식/혼합식)
  building_coverage_ratio NUMERIC,       -- 건폐율 (%)
  cats_cache JSONB,                      -- 서버 사전 스코어링 캐시
  scores_computed_at TIMESTAMPTZ,        -- 스코어 계산 시점
  competition_rate REAL,                 -- 청약 경쟁률
  competition_supply INTEGER,            -- 공급 세대수
  competition_applicants INTEGER,        -- 신청자 수
  bjd_code TEXT,                         -- 법정동코드 10자리 (Kakao reverse-geocode)
  lot_main INTEGER,                      -- 지번 본번
  lot_sub INTEGER,                       -- 지번 부번
  elec_usage_kwh REAL,                   -- 월 전기사용량 kWh (건축HUB)
  gas_usage_mj REAL,                     -- 월 가스사용량 MJ (건축HUB)
  energy_collected_at TIMESTAMPTZ,       -- 에너지 수집 시점
  -- 혜택
  discount_pct REAL,
  loan_free BOOLEAN,
  loan_free_pct REAL,
  option_free BOOLEAN,
  option_value INTEGER,
  balcony_free BOOLEAN,
  balcony_value INTEGER,
  cashback INTEGER,
  contract_discount BOOLEAN,
  benefits JSONB,                         -- ["무이자", "발코니"]
  -- 미래가치
  transit_dev TEXT,
  dev_dist REAL,
  city_dev TEXT,
  industry_dev TEXT,
  -- 환경
  view TEXT,
  sunlight TEXT,
  noise REAL,
  noxious JSONB,                          -- ["소각장", "고압선"]
  noxious_dist REAL,                      -- 최근접 혐오시설 거리 (m)
  -- 네이버 교차검증
  naver_nearby_median INTEGER,            -- 주변 중위가 (만원)
  naver_nearby_avg INTEGER,               -- 주변 평균가 (만원)
  naver_jeonse_rate REAL,                 -- 전세가율 (%)
  naver_sell_count INTEGER,               -- 매매 매물 수
  naver_jeonse_count INTEGER,             -- 전세 매물 수
  naver_wolse_count INTEGER,              -- 월세 매물 수
  naver_build_year INTEGER,               -- 주변 평균 건축연도
  naver_avg_floor REAL,                   -- 평균 층수
  naver_school_walk_min REAL,             -- 최근접 초등 도보 (분)
  naver_nearby_count INTEGER,             -- 주변 단지 수
  naver_fetched_at TIMESTAMPTZ,           -- 수집 시점
  --
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. prices (시계열 — "가격은 시간 데이터")
CREATE TABLE IF NOT EXISTS prices (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  area REAL,                              -- 전용면적 (m²)
  supply_area REAL,                       -- 공급면적
  price INTEGER,                          -- 분양가 (만원)
  pp INTEGER,                             -- 평당가 (만원/3.3m²)
  house_type TEXT,                        -- "084.9871A"
  supply_count INTEGER,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(apartment_id, house_type, recorded_at)
);

-- 3. unsold_history (시계열 — 미분양 추이)
CREATE TABLE IF NOT EXISTS unsold_history (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  base_month TEXT NOT NULL,               -- "202603"
  unsold_count INTEGER,
  post_completion_unsold INTEGER,
  change INTEGER,                         -- 전월 대비 증감
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(apartment_id, base_month)
);

-- 4. trades (시계열 — 실거래가)
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  region TEXT NOT NULL,
  gu TEXT,
  dong TEXT,
  deal_month TEXT,                        -- "202603"
  area REAL,
  price INTEGER,                          -- 만원
  floor INTEGER,
  build_year INTEGER,
  trade_type TEXT DEFAULT 'sale',         -- 'sale' | 'jeonse'
  deposit INTEGER,
  apt_name TEXT,                         -- 아파트명
  cancel_date TEXT,                      -- 해제일
  dealing_type TEXT,                     -- 거래유형 (중개/직거래)
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- 5. infra (주간 갱신)
CREATE TABLE IF NOT EXISTS infra (
  apartment_id TEXT PRIMARY KEY REFERENCES apartments(id) ON DELETE CASCADE,
  hospital INTEGER DEFAULT 0,
  hospital_dist REAL,
  mart INTEGER DEFAULT 0,
  mart_dist REAL,
  conv INTEGER DEFAULT 0,
  conv_dist REAL,
  cafe INTEGER DEFAULT 0,
  cafe_dist REAL,
  culture INTEGER DEFAULT 0,
  culture_dist REAL,
  bank INTEGER DEFAULT 0,
  bank_dist REAL,
  pharmacy INTEGER DEFAULT 0,
  pharmacy_dist REAL,
  park INTEGER DEFAULT 0,
  park_dist REAL,
  subway_dist REAL,
  nearby_facilities JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. schools (주간 갱신)
CREATE TABLE IF NOT EXISTS schools (
  apartment_id TEXT PRIMARY KEY REFERENCES apartments(id) ON DELETE CASCADE,
  school_score INTEGER,
  school_grade TEXT,
  nearby_schools JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. transport (주간 갱신)
CREATE TABLE IF NOT EXISTS transport (
  apartment_id TEXT PRIMARY KEY REFERENCES apartments(id) ON DELETE CASCADE,
  subway_dist REAL,
  subway_name TEXT,
  subway_lines TEXT,
  bus_routes INTEGER DEFAULT 0,
  bus_stop_names TEXT,
  ic_dist REAL,
  ktx_dist REAL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. builders (월간 갱신)
CREATE TABLE IF NOT EXISTS builders (
  name TEXT PRIMARY KEY,
  debt_ratio REAL,
  credit_grade TEXT,
  hug_guarantee BOOLEAN,
  corp_code TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. regions (월간 갱신, 시계열)
CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  region TEXT NOT NULL,
  gu TEXT,
  population INTEGER,
  households INTEGER,
  regional_unsold REAL,
  pop_growth REAL,
  avg_income INTEGER,
  supply_ratio REAL,
  net_migration INTEGER,
  jeonse_rate REAL,
  avg_price INTEGER,
  price_index REAL,
  avg_price_sqm REAL,
  new_supply INTEGER,
  initial_sale_rate REAL,
  land_cost_ratio REAL,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(region, COALESCE(gu, ''), recorded_at)
);

-- 10. trade_stats (아파트별 실거래 통계 — 캐시 테이블)
CREATE TABLE IF NOT EXISTS trade_stats (
  apartment_id TEXT PRIMARY KEY REFERENCES apartments(id) ON DELETE CASCADE,
  nearby_median INTEGER,                  -- 주변 중위 거래가 (만원)
  recent_trades_6m INTEGER,               -- 6개월 거래건수
  jeonse_rate REAL,                       -- 전세가율 (%)
  pir REAL,                               -- 소득대비 가격비율
  psr REAL,                               -- 주변시세 대비 분양가 비율
  price_by_area JSONB DEFAULT '[]',       -- 면적별 매매 시세 배열
  rent_by_area JSONB DEFAULT '[]',        -- 면적별 전세 시세 배열
  jeonse_by_area JSONB DEFAULT '[]',      -- 면적별 전세가율 배열
  price_by_floor JSONB DEFAULT '[]',      -- 층수별 매매 시세 배열
  avg_floor INTEGER,
  floor_range TEXT,
  nearby_build_year INTEGER,
  cancel_ratio_6m REAL,                   -- 6개월 매매 해제비율 (%)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. complexes (네이버 인근 단지 — 로컬 수집)
-- ============================================================
CREATE TABLE IF NOT EXISTS complexes (
  complex_no TEXT PRIMARY KEY,
  complex_name TEXT NOT NULL,
  real_estate_type TEXT,                  -- APT/ABYG/JGC/PRE
  region TEXT,
  gu TEXT,
  dong TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  total_households INTEGER,
  use_approve_ymd TEXT,                   -- 준공일 YYYYMMDD
  construction_company TEXT,
  floor_area_ratio REAL,
  total_parking_count INTEGER,
  high_floor INTEGER,
  low_floor INTEGER,
  min_supply_area REAL,
  max_supply_area REAL,
  earthquake_design BOOLEAN,             -- 내진설계 여부
  entrance_type TEXT,                    -- 현관구조
  heat_method TEXT,                      -- 난방방식
  heat_fuel TEXT,                        -- 난방연료
  corridor_type TEXT,                    -- 복도유형
  building_coverage_ratio NUMERIC,       -- 건폐율
  -- 어떤 미분양 아파트 근처인지 추적
  nearby_apartment_ids JSONB,            -- ["ah-xxx", "ah-yyy"]
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. articles (네이버 매물 — 로컬 수집)
-- ============================================================
CREATE TABLE IF NOT EXISTS articles (
  article_no TEXT PRIMARY KEY,
  complex_no TEXT NOT NULL REFERENCES complexes(complex_no) ON DELETE CASCADE,
  trade_type_name TEXT NOT NULL,           -- 매매/전세/월세
  price INTEGER,                          -- 만원
  rent_price INTEGER,                     -- 월세액 만원
  supply_area REAL,                       -- 공급면적 m²
  exclusive_area REAL,                    -- 전용면적 m²
  pp INTEGER,                             -- 평당가 만원
  floor_info TEXT,
  building_name TEXT,                     -- 동
  direction TEXT,
  room_count INTEGER,
  bathroom_count INTEGER,
  maintenance_cost INTEGER,               -- 관리비 만원
  move_in_date TEXT,                      -- 입주일 YYYYMMDD
  heating_type TEXT,
  use_approve_ymd TEXT,                   -- 건물 준공일
  is_presale BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  article_confirm_ymd TEXT,               -- 매물 확인일
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_at DATE DEFAULT CURRENT_DATE
);

-- ============================================================
-- 13. complex_price_history (네이버 시세 이력 — 로컬 수집)
-- 입력: naver-collect.py에서 매매(A1)+전세(B1) 5년치 수집
-- ============================================================
CREATE TABLE IF NOT EXISTS complex_price_history (
  id SERIAL PRIMARY KEY,
  complex_no TEXT NOT NULL REFERENCES complexes(complex_no) ON DELETE CASCADE,
  trade_type TEXT NOT NULL,               -- A1=매매, B1=전세, B2=월세
  area_no TEXT,                           -- 평형 번호
  price_upper INTEGER,                    -- 매매 상한 만원 (실제 DB 컬럼명)
  price_lower INTEGER,                    -- 매매 하한 만원
  price_avg INTEGER,                      -- 매매 평균 만원
  base_month TEXT,                        -- YYYYMM
  recorded_at DATE DEFAULT CURRENT_DATE,
  UNIQUE(complex_no, trade_type, COALESCE(area_no, ''), base_month)
);

-- ============================================================
-- 14. consults (상담 신청)
-- ============================================================
CREATE TABLE IF NOT EXISTS consults (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  interested_apts TEXT[] DEFAULT '{}',
  budget_min INTEGER,
  budget_max INTEGER,
  consult_type TEXT DEFAULT '방문상담',
  message TEXT,
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_apartments_region ON apartments(region);
CREATE INDEX IF NOT EXISTS idx_apartments_gu ON apartments(region, gu);
CREATE INDEX IF NOT EXISTS idx_apartments_builder ON apartments(builder);
CREATE INDEX IF NOT EXISTS idx_prices_apartment ON prices(apartment_id);
CREATE INDEX IF NOT EXISTS idx_prices_recorded ON prices(recorded_at);
CREATE INDEX IF NOT EXISTS idx_unsold_apartment ON unsold_history(apartment_id);
CREATE INDEX IF NOT EXISTS idx_unsold_month ON unsold_history(base_month);
CREATE INDEX IF NOT EXISTS idx_trades_region ON trades(region, gu);
CREATE INDEX IF NOT EXISTS idx_trades_month ON trades(deal_month);
CREATE INDEX IF NOT EXISTS idx_regions_region ON regions(region);
CREATE INDEX IF NOT EXISTS idx_regions_latest ON regions(region, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_prices_latest ON prices(apartment_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_regions_sido_latest ON regions(region, recorded_at DESC) WHERE gu IS NULL;
CREATE INDEX IF NOT EXISTS idx_complexes_location ON complexes(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_articles_complex ON articles(complex_no, trade_type_name, is_active);
CREATE INDEX IF NOT EXISTS idx_articles_active ON articles(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_complex_price_history ON complex_price_history(complex_no, trade_type);
CREATE INDEX IF NOT EXISTS idx_trades_cancel ON trades(region, deal_month) WHERE cancel_date IS NOT NULL;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
-- 읽기: anon 허용 / 쓰기: service_role만
ALTER TABLE apartments ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE unsold_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE infra ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport ENABLE ROW LEVEL SECURITY;
ALTER TABLE builders ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_stats ENABLE ROW LEVEL SECURITY;

-- 읽기 정책 (anon + authenticated)
CREATE POLICY "Public read" ON apartments FOR SELECT USING (true);
CREATE POLICY "Public read" ON prices FOR SELECT USING (true);
CREATE POLICY "Public read" ON unsold_history FOR SELECT USING (true);
CREATE POLICY "Public read" ON trades FOR SELECT USING (true);
CREATE POLICY "Public read" ON infra FOR SELECT USING (true);
CREATE POLICY "Public read" ON schools FOR SELECT USING (true);
CREATE POLICY "Public read" ON transport FOR SELECT USING (true);
CREATE POLICY "Public read" ON builders FOR SELECT USING (true);
CREATE POLICY "Public read" ON regions FOR SELECT USING (true);
CREATE POLICY "Public read" ON trade_stats FOR SELECT USING (true);

-- 쓰기 정책 (service_role — GitHub Actions에서 사용)
CREATE POLICY "Service write" ON apartments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON prices FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON unsold_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON trades FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON infra FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON schools FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON transport FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON builders FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON regions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON trade_stats FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE complexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE complex_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON complexes FOR SELECT USING (true);
CREATE POLICY "Public read" ON articles FOR SELECT USING (true);
CREATE POLICY "Public read" ON complex_price_history FOR SELECT USING (true);
CREATE POLICY "Service write" ON complexes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON articles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON complex_price_history FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE consults ENABLE ROW LEVEL SECURITY;
CREATE POLICY consults_anon_insert ON consults FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY consults_service ON consults FOR ALL TO service_role USING (true);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apartments_updated BEFORE UPDATE ON apartments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_infra_updated BEFORE UPDATE ON infra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_schools_updated BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_transport_updated BEFORE UPDATE ON transport
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_builders_updated BEFORE UPDATE ON builders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_trade_stats_updated BEFORE UPDATE ON trade_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VIEW: 평탄화된 아파트 데이터 (기존 JSON과 동일 형태)
-- ============================================================
CREATE OR REPLACE VIEW apartments_flat AS
WITH latest_prices AS (
  SELECT DISTINCT ON (apartment_id)
    apartment_id, area, price, pp
  FROM prices
  ORDER BY apartment_id, recorded_at DESC
),
latest_regions AS (
  SELECT DISTINCT ON (region)
    region, pop_growth, supply_ratio, net_migration,
    price_index, avg_price_sqm, new_supply, initial_sale_rate, land_cost_ratio
  FROM regions
  WHERE gu IS NULL
  ORDER BY region, recorded_at DESC
)
SELECT
  a.id,
  a.name,
  a.dong,
  a.gu,
  a.region,
  a.lat,
  a.lng,
  a.builder,
  a.units,
  a.unsold,
  a.unsold_rate AS "unsoldRate",
  a.completion,
  a.heating,
  a.max_floor AS "maxFloor",
  a.floors,
  a.parking_ratio AS "parkingRatio",
  a.floor_area_ratio AS "floorAreaRatio",
  a.exclusive_ratio AS "exclusiveRatio",
  a.energy_grade AS "energyGrade",
  a.green_bldg AS "greenBldg",
  a.quake_design AS "quakeDesign",
  a.has_pool AS "hasPool",
  a.is_regulated AS "isRegulated",
  a.dsr40pass AS "dsr40pass",
  a.announcement_url AS "announcementUrl",
  a.layout,
  a.address,
  a.road_address AS "roadAddress",
  a.district,
  a.avg_maintenance_cost AS "avgMaintenanceCost",
  a.primary_direction AS "primaryDirection",
  a.heat_fuel AS "heatFuel",
  a.corridor_type AS "corridorType",
  a.building_coverage_ratio AS "buildingCoverageRatio",
  a.updated_at AS "updatedAt",
  a.cats_cache AS "catsCache",
  a.scores_computed_at AS "scoresComputedAt",
  a.competition_rate AS "competitionRate",
  a.competition_supply AS "competitionSupply",
  a.competition_applicants AS "competitionApplicants",
  a.elec_usage_kwh AS "elecUsageKwh",
  a.gas_usage_mj AS "gasUsageMj",
  a.energy_collected_at AS "energyCollectedAt",
  -- 혜택
  a.discount_pct AS "discountPct",
  a.loan_free AS "loanFree",
  a.loan_free_pct AS "loanFreePct",
  a.option_free AS "optionFree",
  a.option_value AS "optionValue",
  a.balcony_free AS "balconyFree",
  a.balcony_value AS "balconyValue",
  a.cashback,
  a.contract_discount AS "contractDiscount",
  a.benefits,
  -- 미래가치
  a.transit_dev AS "transitDev",
  a.dev_dist AS "devDist",
  a.city_dev AS "cityDev",
  a.industry_dev AS "industryDev",
  -- 환경
  a.view,
  a.sunlight,
  a.noise,
  a.noxious,
  a.noxious_dist AS "noxiousDist",
  -- 최신 분양가 (prices 테이블에서)
  p.area,
  p.price,
  p.pp,
  -- 인프라
  i.hospital,
  i.mart,
  i.conv,
  i.cafe,
  i.culture,
  i.bank,
  i.pharmacy,
  i.park,
  COALESCE(t.subway_dist, i.subway_dist, 9999) AS "subwayDist",
  i.hospital_dist AS "hospitalDist",
  i.mart_dist AS "martDist",
  i.conv_dist AS "convDist",
  i.cafe_dist AS "cafeDist",
  i.culture_dist AS "cultureDist",
  i.bank_dist AS "bankDist",
  i.pharmacy_dist AS "pharmacyDist",
  i.park_dist AS "parkDist",
  i.nearby_facilities AS "nearbyFacilities",
  -- 학군
  sc.school_score AS "schoolScore",
  sc.school_grade AS "schoolGrade",
  sc.nearby_schools AS "nearbySchools",
  -- 교통
  t.bus_routes AS "busRoutes",
  t.ic_dist AS "icDist",
  t.ktx_dist AS "ktxDist",
  t.subway_name AS "subwayName",
  t.subway_lines AS "subwayLines",
  t.bus_stop_names AS "busStopNames",
  -- 건설사
  b.debt_ratio AS "builderDebtRatio",
  b.credit_grade AS "builderCreditGrade",
  b.hug_guarantee AS "hugGuarantee",
  -- 지역
  r.pop_growth AS "popGrowth",
  r.supply_ratio AS "supplyRatio",
  r.net_migration AS "netMigration",
  -- 지역 시장 통계 (KOSIS HUG)
  r.price_index AS "priceIndex",
  r.avg_price_sqm AS "avgPriceSqm",
  r.new_supply AS "newSupply",
  r.initial_sale_rate AS "initialSaleRate",
  r.land_cost_ratio AS "landCostRatio",
  -- 실거래 통계
  ts.nearby_median AS "nearbyMedian",
  ts.recent_trades_6m AS "recentTrades6m",
  ts.jeonse_rate AS "jeonseRate",
  ts.pir,
  ts.psr,
  ts.avg_floor AS "avgFloor",
  ts.floor_range AS "floorRange",
  ts.nearby_build_year AS "nearbyBuildYear",
  ts.cancel_ratio_6m AS "cancelRatio6m",
  -- 시세 배열 (DetailModal 시세 테이블용)
  ts.price_by_area AS "priceByArea",
  ts.rent_by_area AS "rentByArea",
  ts.jeonse_by_area AS "jeonseByArea",
  ts.price_by_floor AS "priceByFloor",
  -- 네이버 교차검증
  a.naver_nearby_median AS "naverNearbyMedian",
  a.naver_nearby_avg AS "naverNearbyAvg",
  a.naver_jeonse_rate AS "naverJeonseRate",
  a.naver_sell_count AS "naverSellCount",
  a.naver_jeonse_count AS "naverJeonseCount",
  a.naver_wolse_count AS "naverWolseCount",
  a.naver_build_year AS "naverBuildYear",
  a.naver_avg_floor AS "naverAvgFloor",
  a.naver_school_walk_min AS "naverSchoolWalkMin",
  a.naver_nearby_count AS "naverNearbyCount",
  a.naver_fetched_at AS "naverFetchedAt",
  -- 데이터 완성도 (계산, 합계 100)
  GREATEST(0, LEAST(100, (
    (CASE WHEN p.price IS NOT NULL THEN 15 ELSE 0 END) +
    (CASE WHEN i.hospital IS NOT NULL THEN 12 ELSE 0 END) +
    (CASE WHEN sc.school_score IS NOT NULL THEN 12 ELSE 0 END) +
    (CASE WHEN t.bus_routes IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN b.debt_ratio IS NOT NULL THEN 8 ELSE 0 END) +
    (CASE WHEN r.pop_growth IS NOT NULL THEN 8 ELSE 0 END) +
    (CASE WHEN ts.nearby_median IS NOT NULL THEN 15 ELSE 0 END) +
    (CASE WHEN ts.jeonse_rate IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN a.units > 1 THEN 10 ELSE 0 END)
  ))) AS "dataReliability"
FROM apartments a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id;
