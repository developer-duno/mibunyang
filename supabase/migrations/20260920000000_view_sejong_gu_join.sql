-- apartments_flat VIEW — 세종 단지의 시군구 단위 지표 조인 복구 (세션 550)
--
-- 배경: 시군구 단위 지표 4종(fertilityRate·doctorsPer1k·hospitalBedsPer1k·housingPrice)은
--   latest_regions_gu 를 (rg.region = a.region AND rg.gu = a.gu) 로 조인해 가져온다.
--   세종은 apartments.gu 가 전부 NULL(42곳, 세종은 구·군이 없는 단일 시)인데 regions 의
--   시군구 행 키는 '세종|세종시' 다. SQL 에서 NULL = '세종시' 는 참이 될 수 없어,
--   세종 단지(VIEW 35곳)는 이 4지표가 **구조적으로 전부 NULL** 이었다.
--   라이브 실측(2026-09-20): VIEW 세종 35곳 4지표 채움 0/35 · 전국에서 4지표가 전부 빈 단지는 이 35곳뿐.
--   regions '세종|세종시' 행에는 fertility_rate(1.061)·housing_price(366)가 있다 →
--   이 마이그로 35곳의 fertilityRate·housingPrice 가 채워진다.
--   doctors_per_1k·hospital_beds_per_1k 는 regions '세종|세종시' 행에 값 자체가 없다(라이브 실측) —
--   그 둘은 이 마이그로 안 채워진다(원인 확인은 수집기 쪽 별도 과제).
--
-- ⚠️ 변경은 단 1곳: latest_regions_gu 조인 조건의 (rg.gu = a.gu) →
--    (rg.gu = CASE WHEN a.region = '세종' THEN '세종시' ELSE a.gu END).
--    세종이 아닌 지역은 ELSE 가 a.gu 를 그대로 돌려 **기존과 bit 단위로 같은 결과**다
--    (gu 가 NULL 인 비세종 단지는 예전처럼 조인되지 않는다 — 라이브 실측: gu NULL 42곳 전부 세종).
--    세종은 구·군이 없는 단일 시라 gu 값과 무관하게 '세종시' 로 맞춘다 — 주간 seed 가 세종 단지에
--    '6-3생활권' 같은 값을 넣어도(collect-applyhome-seed isValidGu 가 통과시키는 꼴) 빈칸이 안 된다.
--    컬럼 목록·순서·다른 조인·CTE 전부 무변경 → CREATE OR REPLACE 로 충분(DROP 불필요).
-- ⚠️ security_invoker 보존: CREATE OR REPLACE 라도 WITH (security_invoker = on) 직접 명시.
-- ⚠️ 이 조인을 JS 로 흉내 내는 자리도 같은 규칙이어야 한다(같은 PR 에서 함께 고침):
--    scripts/collectors/data-audit.mjs(시군구 merge) · scripts/monitor-collectors.mjs ⑦(fetchGuPairStats).
--
-- 적용 방법: **Supabase Dashboard SQL Editor 수동 실행** (이 레포의 supabase CLI 는 다른 조직으로
--   로그인돼 있다 — 세션 489 실측). 순서 = ① 아래 "회귀 확인 쿼리"를 **적용 전에 먼저** 돌려 숫자를 적어 둔다
--   ② 본문 전체 복사 → Run ③ 두 확인 쿼리를 다시 돌린다.
--   적용 시각: KST 03:00~05:30(daily-deploy 가 VIEW 를 전량 읽고 증분 수집이 도는 창)은 피한다.
--   반영 시점: API 는 즉시, 화면의 정적 JSON 은 다음 daily-deploy(매일 03:04~03:10 KST) 뒤.
-- 적용 확인 쿼리(기대: fertility = housing = total — 2026-09-20 기준 35. 앞의 둘이 0 이면 미적용):
--   SELECT count(*) FILTER (WHERE "fertilityRate" IS NOT NULL) AS fertility,
--          count(*) FILTER (WHERE "housingPrice"  IS NOT NULL) AS housing,
--          count(*) AS total
--   FROM apartments_flat WHERE region = '세종';
-- 회귀 확인 쿼리(**적용 전에 먼저 실행해 적어 둘 것** — 기대: 적용 전후 세 숫자가 모두 같다. 비세종은 한 곳도 안 바뀐다):
--   SELECT count(*) AS total_rows,
--          count(*) FILTER (WHERE region <> '세종' AND "fertilityRate" IS NOT NULL) AS non_sejong_fertility,
--          count(*) FILTER (WHERE region <> '세종' AND "housingPrice"  IS NOT NULL) AS non_sejong_housing
--   FROM apartments_flat;
--
-- 본문은 직전 VIEW(20260809000000_view_add_housing_price.sql) 통째 복사 + 위 1곳만 수정.
-- 롤백: 20260920000001_rollback_view_sejong_gu_join.sql (직전 VIEW 복원)

CREATE OR REPLACE VIEW apartments_flat WITH (security_invoker = on) AS
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
    (array_agg(pop_growth           ORDER BY recorded_at DESC) FILTER (WHERE pop_growth           IS NOT NULL))[1] AS pop_growth,
    (array_agg(supply_ratio         ORDER BY recorded_at DESC) FILTER (WHERE supply_ratio         IS NOT NULL))[1] AS supply_ratio,
    (array_agg(net_migration        ORDER BY recorded_at DESC) FILTER (WHERE net_migration        IS NOT NULL))[1] AS net_migration,
    (array_agg(price_index          ORDER BY recorded_at DESC) FILTER (WHERE price_index          IS NOT NULL))[1] AS price_index,
    (array_agg(avg_price_sqm        ORDER BY recorded_at DESC) FILTER (WHERE avg_price_sqm        IS NOT NULL))[1] AS avg_price_sqm,
    (array_agg(new_supply           ORDER BY recorded_at DESC) FILTER (WHERE new_supply           IS NOT NULL))[1] AS new_supply,
    (array_agg(initial_sale_rate    ORDER BY recorded_at DESC) FILTER (WHERE initial_sale_rate    IS NOT NULL))[1] AS initial_sale_rate,
    (array_agg(land_cost_ratio      ORDER BY recorded_at DESC) FILTER (WHERE land_cost_ratio      IS NOT NULL))[1] AS land_cost_ratio,
    (array_agg(housing_supply_level ORDER BY recorded_at DESC) FILTER (WHERE housing_supply_level IS NOT NULL))[1] AS housing_supply_level
  FROM regions
  WHERE gu IS NULL
  GROUP BY region
),
-- ── 신규 (세션 433): 시군구 단위 지역 활력 — 컬럼별 최신 non-null (세션391 lag 회피) ──
latest_regions_gu AS (
  SELECT region, gu,
    (array_agg(fertility_rate        ORDER BY recorded_at DESC) FILTER (WHERE fertility_rate        IS NOT NULL))[1] AS fertility_rate,
    (array_agg(doctors_per_1k        ORDER BY recorded_at DESC) FILTER (WHERE doctors_per_1k        IS NOT NULL))[1] AS doctors_per_1k,
    (array_agg(hospital_beds_per_1k  ORDER BY recorded_at DESC) FILTER (WHERE hospital_beds_per_1k  IS NOT NULL))[1] AS hospital_beds_per_1k,
    -- 신규 (세션 505): 공시가격 — 시군구 단위라 시도 CTE 가 아니라 여기가 맞는 자리다.
    (array_agg(housing_price         ORDER BY recorded_at DESC) FILTER (WHERE housing_price         IS NOT NULL))[1] AS housing_price
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
  -- 미분양률 100% 초과는 무력화(NULL) — 청약홈 회차 공급분이 분모로 들어가 폭발한 값.
  --   점수/중위/정렬이 이 NULL 을 "세대수 미확인=중립"으로 처리. 100 이하는 그대로 (세션 445).
  CASE WHEN a.unsold_rate > 100 THEN NULL ELSE a.unsold_rate END AS "unsoldRate",
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
  -- 무순위 공고 횟수 = applyhome_events(경쟁률 이벤트) 집계 (무변경).
  COALESCE(ae.event_count, 0) AS "unsoldEventCount",
  -- 최근 무순위 공고일 = presale_schedule_official.recruit_date(진짜 모집공고일 RCRIT_PBLANC_DE)
  --   의 단지별 MAX. 예전엔 applyhome_events.recorded_at(수집일)이라 전 단지가 같은 날로
  --   보이던 사고(세션 488 감사 §2-6) 정정. 진짜 날짜가 없으면(공고 미수집) NULL → 화면 "—".
  pso.last_recruit_date AS "lastUnsoldEventAt",
  -- 주택보급률 (KOSIS DT_MLTM_2100, 세션 457) — 시도 단위, 화면 표시 전용(점수 미반영).
  --   ⚠️ CREATE OR REPLACE VIEW 는 기존 컬럼 순서 변경 불가(42P16) → 신규 컬럼은 반드시 SELECT 맨 끝.
  r.housing_supply_level AS "housingSupplyLevel",
  -- 공시가격 (MOLIT 공동주택공시가격, 세션 505) — 시군구 평균 만원/㎡. 세금 계산용 정부 고시가라
  --   실거래·호가보다 낮은 게 정상. 화면 표시 전용(점수 미반영).
  --   ⚠️ CREATE OR REPLACE VIEW 는 기존 컬럼 순서 변경 불가(42P16) → 신규 컬럼은 반드시 SELECT 맨 끝.
  rg.housing_price AS "housingPrice"
FROM deduped a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
-- 세션550: 세종은 apartments.gu = NULL(시 전체가 한 단위) ↔ regions 시군구 키 = '세종시' 라
--   rg.gu = a.gu 가 영영 거짓이었다(NULL = 'x' 는 참이 못 된다). 세종은 gu 값과 무관하게 '세종시' 로 맞춘다.
LEFT JOIN latest_regions_gu rg ON rg.region = a.region
  AND rg.gu = CASE WHEN a.region = '세종' THEN '세종시' ELSE a.gu END
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id
LEFT JOIN (
  SELECT apartment_id,
         COUNT(*)         AS event_count,
         MAX(recorded_at) AS last_event_at
    FROM applyhome_events
   GROUP BY apartment_id
) ae ON ae.apartment_id = a.id
-- 진짜 모집공고일 소스 (세션 489) — presale_schedule_official.recruit_date = RCRIT_PBLANC_DE.
LEFT JOIN (
  SELECT apartment_id,
         MAX(recruit_date) AS last_recruit_date
    FROM presale_schedule_official
   WHERE recruit_date IS NOT NULL
   GROUP BY apartment_id
) pso ON pso.apartment_id = a.id;

NOTIFY pgrst, 'reload schema';
