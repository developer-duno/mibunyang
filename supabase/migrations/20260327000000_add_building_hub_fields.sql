-- 건축HUB 통합 수집기를 위한 지번 정보 + 에너지 사용량 컬럼
-- 출처: data.go.kr 국토교통부_건축HUB (BldEngyHubService + 주택인허가)
-- 수집기: collect-building-hub.mjs, reverse-geocode.mjs (bjd_code 채움)
--
-- ROLLBACK: 이전 VIEW는 20260326000000_add_competition_rate.sql에 있음
-- ROLLBACK SQL:
--   ALTER TABLE apartments DROP COLUMN IF EXISTS bjd_code;
--   ALTER TABLE apartments DROP COLUMN IF EXISTS lot_main;
--   ALTER TABLE apartments DROP COLUMN IF EXISTS lot_sub;
--   ALTER TABLE apartments DROP COLUMN IF EXISTS elec_usage_kwh;
--   ALTER TABLE apartments DROP COLUMN IF EXISTS gas_usage_mj;
--   ALTER TABLE apartments DROP COLUMN IF EXISTS energy_collected_at;
--   그 후 20260326000000_add_competition_rate.sql의 VIEW를 재실행

-- 1) 지번 정보 (reverse-geocode.mjs에서 Kakao API 응답으로 채움)
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS bjd_code TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS lot_main INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS lot_sub INTEGER;

-- 2) 에너지 사용량 (collect-building-hub.mjs에서 BldEngyHubService로 채움)
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS elec_usage_kwh REAL;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS gas_usage_mj REAL;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS energy_collected_at TIMESTAMPTZ;

COMMENT ON COLUMN apartments.bjd_code IS '법정동코드 10자리 (Kakao coord2regioncode legal.code)';
COMMENT ON COLUMN apartments.lot_main IS '지번 본번 (Kakao coord2address main_address_no)';
COMMENT ON COLUMN apartments.lot_sub IS '지번 부번 (Kakao coord2address sub_address_no)';
COMMENT ON COLUMN apartments.elec_usage_kwh IS '월 전기사용량 kWh (건축HUB getBeElctyUsgInfo)';
COMMENT ON COLUMN apartments.gas_usage_mj IS '월 가스사용량 MJ (건축HUB getBeGasUsgInfo)';
COMMENT ON COLUMN apartments.energy_collected_at IS '에너지 데이터 수집 시점';

-- 3) apartments_flat VIEW 재생성 (에너지 3컬럼 추가, bjd_code/lot는 내부용이라 VIEW 미포함)
DROP VIEW IF EXISTS apartments_flat;
CREATE VIEW apartments_flat AS
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
  -- 관리비/방향
  a.avg_maintenance_cost AS "avgMaintenanceCost",
  a.primary_direction AS "primaryDirection",
  -- 네이버 단지 상세
  a.heat_fuel AS "heatFuel",
  a.corridor_type AS "corridorType",
  a.building_coverage_ratio AS "buildingCoverageRatio",
  -- 사전 스코어링 캐시
  a.cats_cache AS "catsCache",
  a.scores_computed_at AS "scoresComputedAt",
  -- 청약 경쟁률
  a.competition_rate AS "competitionRate",
  a.competition_supply AS "competitionSupply",
  a.competition_applicants AS "competitionApplicants",
  -- 건축HUB 에너지 사용량
  a.elec_usage_kwh AS "elecUsageKwh",
  a.gas_usage_mj AS "gasUsageMj",
  a.energy_collected_at AS "energyCollectedAt",
  -- 최신 분양가
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
  ts.price_by_area AS "priceByArea",
  ts.rent_by_area AS "rentByArea",
  ts.jeonse_by_area AS "jeonseByArea",
  ts.price_by_floor AS "priceByFloor",
  ts.avg_floor AS "avgFloor",
  ts.floor_range AS "floorRange",
  ts.nearby_build_year AS "nearbyBuildYear",
  ts.cancel_ratio_6m AS "cancelRatio6m",
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
  -- 데이터 완성도
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

NOTIFY pgrst, 'reload schema';
