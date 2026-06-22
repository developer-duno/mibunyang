-- apartments_flat VIEW — 시군구 단위 지역 활력 3컬럼 노출 (세션 433)
--
-- 배경: regions 시군구행(gu IS NOT NULL)에 fertility_rate(합계출산율, KOSIS DT_1B81A17)·
--   doctors_per_1k(인구 천명당 의사수)·hospital_beds_per_1k(천명당 병상수)가 각 85% 채워져
--   있으나 src/ 어디에도 미사용. 기존 latest_regions CTE 는 WHERE gu IS NULL(시도 단위)만
--   JOIN 해서 이 시군구 데이터가 VIEW 에 안 들어왔다. → 별도 latest_regions_gu CTE 신설로
--   apartments.gu 와 매칭해 노출 (소비자 상세 화면용, 점수 무변경).
--
-- ⚠️ 세션 391 함정(new-recorded_at-row lag) 회피 = array_agg FILTER 컬럼별 최신 non-null 패턴
--   (latest_regions 와 동일). 시군구 행도 여러 recorded_at 스냅샷이 있을 수 있어 컬럼별 최신값.
-- ⚠️ security_invoker 보존: DROP+CREATE 라 WITH (security_invoker = on) 직접 명시
--   (supabase/CLAUDE.md 보안 표준 + 20260609000000 답습).
--
-- 본문은 직전 VIEW(20260609000000_view_regions_latest_nonnull.sql) 통째 복사
--   + latest_regions_gu CTE 신설 + SELECT 3컬럼 + JOIN 1줄 추가.
-- 롤백: 20260623000001_rollback_view_add_regions_gu_vitality.sql (직전 VIEW 복원)

DROP VIEW IF EXISTS apartments_flat;

CREATE VIEW apartments_flat WITH (security_invoker = on) AS
WITH dedup_ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY regexp_replace(name, '\([^)]*\)$', ''),
                   region,
                   COALESCE(gu, ''),
                   COALESCE(dong, '')
      ORDER BY (name LIKE '%(오)%') ASC, id DESC
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
  ORDER BY apartment_id,
           (CASE WHEN house_type LIKE 'presale_%' THEN 1 ELSE 0 END),
           recorded_at DESC
),
latest_regions AS (
  SELECT region,
    (array_agg(pop_growth        ORDER BY recorded_at DESC) FILTER (WHERE pop_growth        IS NOT NULL))[1] AS pop_growth,
    (array_agg(supply_ratio      ORDER BY recorded_at DESC) FILTER (WHERE supply_ratio      IS NOT NULL))[1] AS supply_ratio,
    (array_agg(net_migration     ORDER BY recorded_at DESC) FILTER (WHERE net_migration     IS NOT NULL))[1] AS net_migration,
    (array_agg(price_index       ORDER BY recorded_at DESC) FILTER (WHERE price_index       IS NOT NULL))[1] AS price_index,
    (array_agg(avg_price_sqm     ORDER BY recorded_at DESC) FILTER (WHERE avg_price_sqm     IS NOT NULL))[1] AS avg_price_sqm,
    (array_agg(new_supply        ORDER BY recorded_at DESC) FILTER (WHERE new_supply        IS NOT NULL))[1] AS new_supply,
    (array_agg(initial_sale_rate ORDER BY recorded_at DESC) FILTER (WHERE initial_sale_rate IS NOT NULL))[1] AS initial_sale_rate,
    (array_agg(land_cost_ratio   ORDER BY recorded_at DESC) FILTER (WHERE land_cost_ratio   IS NOT NULL))[1] AS land_cost_ratio
  FROM regions
  WHERE gu IS NULL
  GROUP BY region
),
-- ── 신규 (세션 433): 시군구 단위 지역 활력 — 컬럼별 최신 non-null (세션391 lag 회피) ──
latest_regions_gu AS (
  SELECT region, gu,
    (array_agg(fertility_rate        ORDER BY recorded_at DESC) FILTER (WHERE fertility_rate        IS NOT NULL))[1] AS fertility_rate,
    (array_agg(doctors_per_1k        ORDER BY recorded_at DESC) FILTER (WHERE doctors_per_1k        IS NOT NULL))[1] AS doctors_per_1k,
    (array_agg(hospital_beds_per_1k  ORDER BY recorded_at DESC) FILTER (WHERE hospital_beds_per_1k  IS NOT NULL))[1] AS hospital_beds_per_1k
  FROM regions
  WHERE gu IS NOT NULL
  GROUP BY region, gu
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
  a.air_quality AS "airQuality",
  -- 치안
  a.crime_safety_grade AS "crimeSafetyGrade",
  -- 최신 분양가 (prices 테이블에서, 공식가 우선 tie-breaker 적용)
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
  i.childcare,
  i.childcare_dist AS "childcareDist",
  i.emergency,
  i.emergency_dist AS "emergencyDist",
  i.police,
  i.police_dist AS "policeDist",
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
  -- 지역 활력 (시군구 단위, 세션 433) — KOSIS 출산율·의료
  rg.fertility_rate AS "fertilityRate",
  rg.doctors_per_1k AS "doctorsPer1k",
  rg.hospital_beds_per_1k AS "hospitalBedsPer1k",
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
  -- 데이터 완성도 (계산, 합계 100) — 세션97: 유령값 제거
  GREATEST(0, LEAST(100, (
    (CASE WHEN p.price > 0 THEN 15 ELSE 0 END) +
    (CASE WHEN i.hospital > 0 THEN 12 ELSE 0 END) +
    (CASE WHEN sc.school_score IS NOT NULL THEN 12 ELSE 0 END) +
    (CASE WHEN t.bus_stop_names IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN b.debt_ratio IS NOT NULL THEN 8 ELSE 0 END) +
    (CASE WHEN r.pop_growth IS NOT NULL THEN 8 ELSE 0 END) +
    (CASE WHEN ts.nearby_median IS NOT NULL THEN 15 ELSE 0 END) +
    (CASE WHEN ts.jeonse_rate IS NOT NULL THEN 10 ELSE 0 END) +
    (CASE WHEN a.units > 1 THEN 10 ELSE 0 END)
  ))) AS "dataReliability",
  -- 신규 2컬럼 (applyhome_events 시계열 집계)
  COALESCE(ae.event_count, 0) AS "unsoldEventCount",
  ae.last_event_at              AS "lastUnsoldEventAt"
FROM deduped a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN latest_regions_gu rg ON rg.region = a.region AND rg.gu = a.gu
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id
LEFT JOIN (
  SELECT apartment_id,
         COUNT(*)         AS event_count,
         MAX(recorded_at) AS last_event_at
    FROM applyhome_events
   GROUP BY apartment_id
) ae ON ae.apartment_id = a.id;

NOTIFY pgrst, 'reload schema';
