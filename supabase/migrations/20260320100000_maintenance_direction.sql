-- 관리비/방향 집계 컬럼 추가 (articles → apartments)
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS avg_maintenance_cost INTEGER;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS primary_direction TEXT;

COMMENT ON COLUMN apartments.avg_maintenance_cost IS '평균 관리비 (만원 단위, articles.numeric_maintenance_cost 집계)';
COMMENT ON COLUMN apartments.primary_direction IS '대표 향 (articles.direction 최빈값)';

-- apartments_flat VIEW 업데이트 (새 컬럼 추가)
CREATE OR REPLACE VIEW apartments_flat AS
WITH latest_prices AS (
  SELECT DISTINCT ON (apartment_id)
    apartment_id, price, supply_area, exclusive_area, price_per_m2
  FROM prices
  ORDER BY apartment_id, recorded_at DESC
),
latest_regions AS (
  SELECT DISTINCT ON (region)
    region, population, pop_growth, avg_income, net_migration, supply_ratio
  FROM regions
  ORDER BY region, recorded_at DESC
)
SELECT
  a.id, a.name, a.region, a.gu, a.dong, a.address,
  a.builder, a.units, a.unsold, a.unsold_rate, a.unit_source,
  a.completion, a.area, a.price AS "rawPrice",
  a.lat, a.lng,
  a.homepage, a.phone, a.image_url,
  a.discount_pct, a.loan_free, a.loan_free_pct,
  a.option_value, a.option_free, a.balcony_value, a.balcony_free, a.cashback,
  a.dsr40_pass, a.hug_guarantee,
  a.heating, a.parking_ratio, a.floor_area_ratio, a.exclusive_ratio,
  a.max_floor, a.has_pool, a.energy_grade, a.green_bldg,
  a.layout, a.quake_design, a.structure,
  a.subway_dist, a.bus_routes, a.ic_dist, a.ktx_dist, a.subway_lines,
  a.view, a.sunlight, a.noise, a.noxious, a.noxious_dist,
  a.transit_dev, a.dev_dist, a.city_dev, a.industry_dev,
  a.regulated, a.floor_min, a.floor_max, a.floor_range,
  a.avg_maintenance_cost AS "avgMaintenanceCost",
  a.primary_direction AS "primaryDirection",
  -- 분양가
  p.price, p.supply_area AS "supplyArea", p.exclusive_area AS "exclusiveArea",
  p.price_per_m2 AS "pricePerm2",
  -- 지역 통계
  r.population, r.pop_growth AS "popGrowth",
  r.avg_income AS "avgIncome", r.net_migration AS "netMigration",
  r.supply_ratio AS "supplyRatio",
  -- 인프라
  i.hospital, i.mart, i.conv, i.park, i.cafe, i.culture, i.bank, i.pharmacy,
  i.subway_walk_min AS "subwayWalkMin",
  -- 학교
  sc.school_score AS "schoolScore", sc.school_grade AS "schoolGrade",
  -- 교통
  t.bus_routes AS "busRoutes", t.subway_dist AS "tSubwayDist",
  t.subway_lines AS "tSubwayLines", t.ic_dist AS "tIcDist", t.ktx_dist AS "tKtxDist",
  t.bus_detail AS "busDetail", t.subway_detail AS "subwayDetail",
  t.ic_detail AS "icDetail", t.ktx_detail AS "ktxDetail",
  -- 시공사
  b.debt_ratio AS "builderDebtRatio", b.credit_grade AS "builderCreditGrade",
  -- 거래 통계
  ts.nearby_median AS "nearbyMedian", ts.nearby_avg AS "nearbyAvg",
  ts.jeonse_rate AS "jeonseRate",
  ts.recent_trades_6m AS "recentTrades6m",
  ts.pir, ts.psr,
  ts.nearby_build_year AS "nearbyBuildYear",
  ts.nearby_avg_floor AS "nearbyAvgFloor",
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
