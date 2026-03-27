-- 네이버 분양정보(pre.land.naver.com) 전용 컬럼 19개 추가
-- + apartments_flat VIEW 갱신 (분양정보 컬럼 포함)
--
-- 롤백: ALTER TABLE apartments DROP COLUMN IF EXISTS presale_min_price; (각 컬럼)
--       + 이전 VIEW(20260328000000) 재실행

BEGIN;

-- ── 1) apartments 테이블에 분양정보 컬럼 추가 ─────────────────────
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_min_price INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_max_price INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_pp INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_type TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_stage TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_stage_code TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_image_url TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS naver_presale_no TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS naver_presale_seq TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_general_supply INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_buildings INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_parking INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_inquiry TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_features TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_move_in TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_recruit_date TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_schedule JSONB;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_housing_type TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS presale_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN apartments.presale_min_price IS '분양 최저가 (만원) — pre.land.naver.com';
COMMENT ON COLUMN apartments.presale_max_price IS '분양 최고가 (만원) — pre.land.naver.com';
COMMENT ON COLUMN apartments.presale_pp IS '평당 분양가 (만원) — pre.land.naver.com';
COMMENT ON COLUMN apartments.presale_type IS '분양유형 (민간분양/공공분양)';
COMMENT ON COLUMN apartments.presale_stage IS '분양단계 (분양중/분양예정/계약 등)';
COMMENT ON COLUMN apartments.presale_stage_code IS '분양단계코드 (C11=예정, C12=진행/완료)';
COMMENT ON COLUMN apartments.presale_image_url IS '분양 대표이미지 URL';
COMMENT ON COLUMN apartments.naver_presale_no IS '네이버 분양 단지번호 (preSaleComplexNumber)';
COMMENT ON COLUMN apartments.naver_presale_seq IS '네이버 분양 공고순번 (announcementPreSaleSequence)';
COMMENT ON COLUMN apartments.presale_general_supply IS '일반분양 세대수';
COMMENT ON COLUMN apartments.presale_buildings IS '동수';
COMMENT ON COLUMN apartments.presale_parking IS '주차대수 (정수)';
COMMENT ON COLUMN apartments.presale_inquiry IS '분양문의 전화번호';
COMMENT ON COLUMN apartments.presale_features IS '특징 (교통, 학군 등 텍스트)';
COMMENT ON COLUMN apartments.presale_move_in IS '입주시기 (YYYYMM 또는 2022.11 형식)';
COMMENT ON COLUMN apartments.presale_recruit_date IS '분양시기 (YYYY-MM-DD)';
COMMENT ON COLUMN apartments.presale_schedule IS '일정 상세 (schdl_info + scheduleName + dateInfo)';
COMMENT ON COLUMN apartments.presale_housing_type IS '주택유형 (아파트/도시형생활주택/주상복합 등)';
COMMENT ON COLUMN apartments.presale_fetched_at IS '분양정보 수집시점';

-- ── 2) apartments_flat VIEW 갱신 (기존 전체 + 분양정보 19컬럼) ────
DROP VIEW IF EXISTS apartments_flat;

CREATE OR REPLACE VIEW apartments_flat AS
WITH dedup_ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY regexp_replace(name, '\([^)]*\)$', ''),
                   region,
                   COALESCE(gu, ''),
                   COALESCE(dong, '')
      ORDER BY id DESC
    ) AS _dedup_rank
  FROM apartments
),
deduped AS (
  SELECT * FROM dedup_ranked WHERE _dedup_rank = 1
),
latest_prices AS (
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
  -- 네이버 분양정보 (pre.land.naver.com)
  a.presale_min_price AS "presaleMinPrice",
  a.presale_max_price AS "presaleMaxPrice",
  a.presale_pp AS "presalePp",
  a.presale_type AS "presaleType",
  a.presale_stage AS "presaleStage",
  a.presale_stage_code AS "presaleStageCode",
  a.presale_image_url AS "presaleImageUrl",
  a.naver_presale_no AS "naverPresaleNo",
  a.naver_presale_seq AS "naverPresaleSeq",
  a.presale_general_supply AS "presaleGeneralSupply",
  a.presale_buildings AS "presaleBuildings",
  a.presale_parking AS "presaleParking",
  a.presale_inquiry AS "presaleInquiry",
  a.presale_features AS "presaleFeatures",
  a.presale_move_in AS "presaleMoveIn",
  a.presale_recruit_date AS "presaleRecruitDate",
  a.presale_schedule AS "presaleSchedule",
  a.presale_housing_type AS "presaleHousingType",
  a.presale_fetched_at AS "presaleFetchedAt",
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
FROM deduped a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id;

COMMIT;
