-- apartments_flat VIEW — 시세 비교 범위 좁히기 다) 점수 입력 칸 9개 + 라) 화면 칸 3개 노출 (세션607·609)
--
-- ⛔⛔ 순서 경고: **이 마이그를 적용하기 전에 다) PR(점수 전환)을 합치면 점수 입력이 비어 전부 중립이 된다.**
--    다) 의 scorePrice 는 괴리도·전세가율을 이 칸(cmpFairPrice·complexJeonseRate)에서만 읽는다 — 칸이 없으면
--    1,9xx곳 전부 괴리도 30점·전세가율 50점(중립)으로 그날 밤 굽기에 실린다. 반드시 **이 마이그 적용 → 새 칸 채움
--    확인 → 전이표 승인 → 합침** 순서.
--
-- 배경: 지금 가격 점수는 구(區) 전체를 한 덩어리로 비교한다(nearby_median·price_by_area·jeonse_rate·psr).
--   같은 평수 매매가 최고÷최저가 구 8.19배 → 같은 단지 1.20배(설계서 §1). 나) 가 trade_stats 에 범위·건수·기간을
--   담은 새 칸(cmp_*·complex_*)을 만들었고(20261004000000), 이 VIEW 가 그중 **점수 입력 칸만** 내보낸다.
--   설계서 docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md §4-3·§5-3 · 계획서 B1.
--
-- ⚠️ 변경은 SELECT **맨 끝** 12줄(cmpScope … complexSaleN 9 + dongFact·complexTable·complexJeonseTable 3) + "dataReliability" 식의 두 항
--    (ts.nearby_median → ts.cmp_scope IN ('complex','dong_peer') 15점 · ts.jeonse_rate → ts.complex_jeonse_rate 10점,
--    합계 100 그대로 — 사장님 결정 10-07 "지금 바꿈", 검사관 B4). 이 두 항이 바뀌면 신뢰도 서브점수(가격 0.07)도 움직이므로
--    등급 전이표에 포함한다. 컬럼 순서·다른 조인·CTE 전부 무변경 → CREATE OR REPLACE 로 충분(DROP 불필요 → GRANT 보존).
-- ⚠️ 라) 화면 칸 3개(dong_fact·complex_table·complex_jeonse_table)도 맨 끝에 싣는다(세션609) — 매일 굽기가
--    select("*") 로 읽지만 목록 JSON 에서는 빼고(scripts/static-outputs.mjs DETAIL_ONLY_FIELDS) 상세 버킷에만 둔다.
--    complex_src 는 넣지 않는다(화면이 cmp_src 로 충분).
-- ⚠️ security_invoker 보존: CREATE OR REPLACE 라도 WITH (security_invoker = on) 직접 명시.
-- ⚠️ 라이브 API(api/supabase/apartments.ts)는 칸 **화이트리스트** — 같은 PR 에서 9칸, 라) PR 에서 3칸을 넣었다(12칸).
--
-- 선행: 20261004000000_trade_links_and_scope_stats.sql (trade_stats 새 칸) — 없으면 아래 가드가 멈춘다.
--
-- 적용 방법: **Supabase Dashboard SQL Editor 수동 실행**(이 레포의 supabase CLI 는 다른 조직 로그인 — 세션489).
--   적용 시각은 KST 03:00~05:30 을 피한다(daily-deploy 가 VIEW 를 전량 읽고 증분 수집이 도는 창).
--   반영 = API 즉시 / 정적 JSON 은 다음 daily-deploy 뒤. 적용 뒤 감시 ⑩ 권한 지문에 변화가 있으면 재승인.
--
-- 적용 확인 쿼리(기대: total = 화면 단지 수, scoped = trade_stats 새 칸이 채워진 수 · 10/08 첫 정기 회차 뒤 > 0):
--   SELECT count(*) AS total, count("cmpScope") AS scoped,
--          count(*) FILTER (WHERE "cmpScope" IN ('complex','dong_peer')) AS judged,
--          count("complexJeonseRate") AS jr FROM apartments_flat;
--
-- 본문은 직전 VIEW(20260922000004_view_add_coord_shared.sql) 통째 복사 + 위 끝 12줄 추가 + "dataReliability" 두 항 교체.
-- ROLLBACK: _rollbacks/20261007000001_rollback_view_add_trade_scope.sql (직전 VIEW 복원 — 칸을 줄이므로 DROP 필요)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_stats' AND column_name = 'cmp_scope'
  ) THEN
    RAISE EXCEPTION '먼저 20261004000000_trade_links_and_scope_stats.sql 을 실행하세요 (trade_stats.cmp_scope 컬럼이 없습니다)';
  END IF;
END $$;

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
    -- 세션607 다): 점수 입력 칸이 새 비교 칸으로 바뀌어 신뢰도도 같은 칸을 센다(의미·문구 짝 규칙)
    (CASE WHEN ts.cmp_scope IN ('complex', 'dong_peer') THEN 15 ELSE 0 END) +
    (CASE WHEN ts.complex_jeonse_rate IS NOT NULL THEN 10 ELSE 0 END) +
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
  rg.housing_price AS "housingPrice",
  -- 좌표 자리표시 의심 표시 (세션560) — true 면 이 단지 좌표를 다른 단지가 함께 쓴다.
  --   좌표 파생값(교통·학군·인프라·대기질)을 그대로 믿을 수 없다는 뜻이다.
  --   ⚠️ **화면 경고 UI 는 아직 없다**(세션560 기준 `src/` 변경 0건) — 이 컬럼은 그 준비다.
  --   ⚠️ 라이브 API(`api/supabase/apartments.ts`)는 필드 **화이트리스트** 방식이라 `coordShared` 가
  --      안 나간다. 정적 JSON(`collect-data.mjs` 의 `select("*")`)에만 실린다 — 화면을 만들 때 확인할 것.
  --   채우는 주체 = scripts/collectors/flag-shared-coords.mjs (양방향 — 좌표가 고쳐지면 내려간다).
  --   ⚠️ CREATE OR REPLACE VIEW 는 기존 컬럼 순서 변경 불가(42P16) → 신규 컬럼은 반드시 SELECT 맨 끝.
  a.coord_shared AS "coordShared",
  -- 시세 비교 범위 좁히기 다(세션607) — 가격 점수의 입력 칸(trade_stats 새 칸, 20261004000000 이 만듦).
  --   점수(scorePrice)는 이 칸만 읽는다: 적정가 = cmpFairPrice(범위 complex·dong_peer 일 때만) ·
  --   전세가율 = complexJeonseRate. 면적별 표(complex_table·complex_jeonse_table)·동네 사실(dong_fact)은
  --   라) 화면 칸이라 맨 끝 3줄로 싣는다(세션609) — 목록 JSON 에서는 빼고 상세 버킷에만(static-outputs.mjs).
  --   ⚠️ CREATE OR REPLACE VIEW 는 기존 컬럼 순서 변경 불가(42P16) → 신규 컬럼은 반드시 SELECT 맨 끝.
  ts.cmp_scope AS "cmpScope",
  ts.cmp_fair_price AS "cmpFairPrice",
  ts.cmp_n AS "cmpN",
  ts.cmp_months AS "cmpMonths",
  ts.cmp_area_mode AS "cmpAreaMode",
  ts.cmp_src AS "cmpSrc",
  ts.complex_jeonse_rate AS "complexJeonseRate",
  ts.complex_jeonse_n AS "complexJeonseN",
  ts.complex_sale_n AS "complexSaleN",
  ts.dong_fact AS "dongFact",
  ts.complex_table AS "complexTable",
  ts.complex_jeonse_table AS "complexJeonseTable"
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
