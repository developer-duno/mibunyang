-- 리허설 VIEW — 20261013000000_view_one_card_bundle.sql 본문에서 VIEW 이름만 apartments_flat_rehearsal 로 바꾼 것(그 밖은 글자 그대로).
--   운영 VIEW(apartments_flat)·표는 건드리지 않고 잠그지도 않는다. node 대조 스크립트(계획서 Task 6 Step 3)가 서비스 열쇠로
--   옛/새 VIEW 를 전부 읽어 맞댄 뒤, 같은 날 _rehearsal/20261013_one_card_rehearsal_drop.sql 로 지운다(월요일 권한 지문 감시 ⑩ 전에).
--   새 public 객체엔 anon·authenticated 권한이 기본으로 붙으므로 아래에서 회수하고 service_role 에만 SELECT 를 준다.
--   적용 = 운영 단계 B-1(사장님 Dashboard SQL Editor). 작업반은 실행하지 않는다.
CREATE VIEW apartments_flat_rehearsal WITH (security_invoker = on) AS
WITH members AS (
  SELECT *,
    COALESCE(complex_key, id)                      AS bkey,
    (COALESCE(name, '') LIKE '%(오)%')              AS is_off,
    (id LIKE 'ah-%')                               AS is_ah,
    (naver_presale_no IS NOT NULL AND id = 'ap-' || naver_presale_no) AS is_owner
  FROM apartments
),
bundle_rep AS (                       -- 대표 행(D11)
  SELECT DISTINCT ON (bkey) bkey, id AS rep_id
  FROM members
  ORDER BY bkey, is_off ASC, is_ah DESC, id COLLATE "C" ASC     -- 모든 DISTINCT ON 의 id 정렬은 COLLATE "C"(🟡4) — 아래 CTE 도 같다
),
bundle_mat AS (                       -- 재료 행(§4-7 (3))
  SELECT DISTINCT ON (bkey) bkey, id AS mat_id
  FROM members
  ORDER BY bkey, is_off ASC,
           CASE WHEN is_owner THEN 0 WHEN is_ah THEN 1 ELSE 2 END ASC,
           CASE WHEN is_owner THEN presale_min_price END ASC NULLS LAST,
           (CASE WHEN is_owner THEN id END) COLLATE "C" ASC,
           id COLLATE "C" DESC
),
bundle_units AS (                     -- 세대수(D7)
  SELECT DISTINCT ON (bkey) bkey, units AS b_units
  FROM members mu
  WHERE units IS NOT NULL AND units > 1
    AND (NOT is_off OR NOT EXISTS (SELECT 1 FROM members o WHERE o.bkey = mu.bkey AND NOT o.is_off))   -- (오) 행은 비오피스텔 구성원이 하나도 없는 묶음에서만(세션636 D2 — JS pickBundleUnits·계획서 "(오) 제외")
  ORDER BY bkey, is_off ASC,            -- (오) 행은 뒤로(묶음이 (오) 뿐이면 그 값 — JS pickBundleUnits 는 (오)뿐이면 null 을 주지만 KOSIS 쪽은 (오) 를 자기 묶음으로 떼어 자기 값을 쓰므로(Task 1) 화면도 자기 값이 맞다. 리허설 대조(Task 6 Step 3)는 이 경우를 "(오)뿐인 2행+ 묶음"으로 따로 센다 — 맹점 O3)
           CASE WHEN unit_source = 'naver_presale' AND is_owner THEN 0
                WHEN unit_source IN ('naver_presale', 'naver') THEN 1
                WHEN unit_source = 'molit' THEN 2
                WHEN unit_source = 'applyhome' THEN 3
                ELSE 4 END ASC,
           units DESC, id COLLATE "C" ASC
),
bundle_unsold AS (                    -- 묶음 미분양(사장님 결정 §6-9)
  SELECT DISTINCT ON (m.bkey) m.bkey, m.unsold AS b_unsold, m.unsold_source AS b_unsold_source
  FROM members m JOIN bundle_mat bm ON bm.bkey = m.bkey
  ORDER BY m.bkey, m.is_off ASC,        -- (오) 행은 뒤로
           CASE WHEN m.unsold_source = 'applyhome'
                 AND m.unsold_as_of IS NOT NULL
                 AND m.unsold_as_of + INTERVAL '6 months' >= (now() AT TIME ZONE 'Asia/Seoul')::date THEN 0
                WHEN m.unsold_source = 'hold' THEN 2
                WHEN m.unsold IS NOT NULL THEN 1
                ELSE 3 END ASC,
           -- 순위 0(유효 청약홈 실측) 안에서만 공고일 최근 것 — 만료 청약홈 행의 공고일이 재료 행을 이기면 안 된다(맹점 O2)
           CASE WHEN m.unsold_source = 'applyhome' AND m.unsold_as_of IS NOT NULL
                 AND m.unsold_as_of + INTERVAL '6 months' >= (now() AT TIME ZONE 'Asia/Seoul')::date THEN m.unsold_as_of END DESC NULLS LAST,
           (m.id = bm.mat_id) DESC,
           m.id COLLATE "C" DESC
),
bundle_ah AS (                        -- 경쟁률·공고 링크 = 값 있는 청약홈 행 중 id 큰 것
  SELECT bkey,
    (array_agg(competition_rate       ORDER BY id COLLATE "C" DESC) FILTER (WHERE competition_rate       IS NOT NULL))[1] AS b_competition_rate,
    (array_agg(competition_supply     ORDER BY id COLLATE "C" DESC) FILTER (WHERE competition_supply     IS NOT NULL))[1] AS b_competition_supply,
    (array_agg(competition_applicants ORDER BY id COLLATE "C" DESC) FILTER (WHERE competition_applicants IS NOT NULL))[1] AS b_competition_applicants,
    (array_agg(announcement_url       ORDER BY id COLLATE "C" DESC) FILTER (WHERE announcement_url       IS NOT NULL))[1] AS b_announcement_url
  FROM members WHERE is_ah AND NOT is_off GROUP BY bkey
),
bundle_agg AS (
  SELECT bkey,
    count(*)                                                        AS member_count,
    array_agg(id ORDER BY id COLLATE "C") FILTER (WHERE NOT is_off) AS member_ids,  -- 시계열·재공고·곧분양 판정용: (오) 제외(아파트 카드에 오피스텔 공고·이력이 섞이지 않게 — 세션630 presale-detail 과 같은 뜻)
    array_agg(id ORDER BY id COLLATE "C")                           AS alias_ids    -- 옛 id 넘김용: 구성원 전부((오) 포함) — 옛 (오) 카드 id 의 관심매물·딥링크가 아파트 카드로 이어진다(재검사 🟠2)
  FROM members GROUP BY bkey
),
deduped AS (                          -- 한 묶음 = 한 행: a.* 는 재료 행, rep_* 는 대표 행
  SELECT mat.*,
    rep.id   AS rep_id,
    rep.name AS rep_name,
    rep.cats_cache AS rep_cats_cache,
    rep.scores_computed_at AS rep_scores_computed_at,
    bu.b_units, bun.b_unsold, bun.b_unsold_source,
    bah.b_competition_rate, bah.b_competition_supply, bah.b_competition_applicants, bah.b_announcement_url,
    bg.member_count, bg.member_ids, bg.alias_ids
  FROM bundle_rep br
  JOIN members rep ON rep.id = br.rep_id
  JOIN bundle_mat bm ON bm.bkey = br.bkey
  JOIN members mat ON mat.id = bm.mat_id
  LEFT JOIN bundle_units  bu  ON bu.bkey  = br.bkey
  LEFT JOIN bundle_unsold bun ON bun.bkey = br.bkey
  LEFT JOIN bundle_ah     bah ON bah.bkey = br.bkey
  JOIN bundle_agg bg ON bg.bkey = br.bkey
),
latest_prices AS (                    -- 재료 행의 가격 행 → 없으면 묶음 안 id 내림차순 첫 가격 행(D10)
  SELECT DISTINCT ON (bkey) bkey, area, price, pp
  FROM (
    SELECT m.bkey, m.id, m.is_off, (m.id = bm.mat_id) AS is_mat, p.area, p.price, p.pp,
           ROW_NUMBER() OVER (PARTITION BY p.apartment_id
                              ORDER BY (CASE WHEN p.house_type LIKE 'presale_%' THEN 1 ELSE 0 END), p.recorded_at DESC) AS rn
    FROM prices p JOIN members m ON m.id = p.apartment_id JOIN bundle_mat bm ON bm.bkey = m.bkey
  ) x
  WHERE rn = 1
  ORDER BY bkey, is_mat DESC, is_off ASC, id COLLATE "C" DESC   -- 재료 행 → (오) 아닌 행 → id 큰 행(🟡3)
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
  a.rep_id   AS id,
  -- 제목 떼기: 괄호를 공백 하나로 바꾼 뒤 겹공백을 하나로, 앞뒤 공백 제거 — JS stripNoticeWords 와 같은 세 단계(맹점 O1). 뗄 것이 없으면 원문 그대로.
  CASE WHEN a.rep_name ~ '\((?:\s*(?:(?:무순위|임의공급|사후|추가(?:모집)?|잔여(?:세대)?|선착순)\s*(?:\d+\s*(?:차|회차|회))?|\d+\s*(?:차|회차|회))\s*|[^()]*(?:계약취소주택|취소후\s*재공급|조합원\s*취소분|불법행위\s*재공급|재공급|청약|문의|재당첨|거주자|무주택|세대구성원|자격상실|제명)[^()]*)\)'
       THEN btrim(regexp_replace(regexp_replace(a.rep_name, '\((?:\s*(?:(?:무순위|임의공급|사후|추가(?:모집)?|잔여(?:세대)?|선착순)\s*(?:\d+\s*(?:차|회차|회))?|\d+\s*(?:차|회차|회))\s*|[^()]*(?:계약취소주택|취소후\s*재공급|조합원\s*취소분|불법행위\s*재공급|재공급|청약|문의|재당첨|거주자|무주택|세대구성원|자격상실|제명)[^()]*)\)', ' ', 'g'), '\s{2,}', ' ', 'g'))
       ELSE a.rep_name END AS name,   -- _card-title.mjs 의 NOTICE_PAREN_SQL 문자열을 두 자리에 똑같이 복사(시험이 글자 일치를 확인)
  a.dong,
  a.gu,
  a.region,
  a.lat,
  a.lng,
  a.builder,
  -- 혼자인 행은 자기 값 그대로(출력 무변경 §4-7 (9)) — 묶음 CTE 는 (오)·1 이하 행을 뒤로 미루거나 빼므로 혼자인 그 행이 NULL 을 받을 수 있다.
  CASE WHEN a.member_count >= 2 THEN a.b_units  ELSE a.units  END AS units,
  CASE WHEN a.member_count >= 2 THEN a.b_unsold ELSE a.unsold END AS unsold,
  -- 미분양률 100% 초과는 무력화(NULL) — 청약홈 회차 공급분이 분모로 들어가 폭발한 값.
  --   점수/중위/정렬이 이 NULL 을 "세대수 미확인=중립"으로 처리. 100 이하는 그대로 (세션 445).
  --   세션635 다): 묶음(구성원 2+)은 묶음 미분양 ÷ D7 세대수, 혼자인 행은 옛 식 그대로.
  CASE WHEN a.member_count >= 2
       THEN (CASE WHEN a.b_unsold IS NULL OR a.b_units IS NULL OR a.b_units <= 0 THEN NULL
                  WHEN ROUND(a.b_unsold::numeric / a.b_units * 100, 1) > 100 THEN NULL
                  ELSE ROUND(a.b_unsold::numeric / a.b_units * 100, 1) END)
       ELSE (CASE WHEN a.unsold_rate > 100 THEN NULL ELSE a.unsold_rate END)
  END AS "unsoldRate",
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
  CASE WHEN a.member_count >= 2 THEN a.b_announcement_url ELSE a.announcement_url END AS "announcementUrl",
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
  a.rep_cats_cache AS "catsCache",
  a.rep_scores_computed_at AS "scoresComputedAt",
  CASE WHEN a.member_count >= 2 THEN a.b_competition_rate       ELSE a.competition_rate       END AS "competitionRate",
  CASE WHEN a.member_count >= 2 THEN a.b_competition_supply     ELSE a.competition_supply     END AS "competitionSupply",
  CASE WHEN a.member_count >= 2 THEN a.b_competition_applicants ELSE a.competition_applicants END AS "competitionApplicants",
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
    (CASE WHEN (CASE WHEN a.member_count >= 2 THEN a.b_units ELSE a.units END) > 1 THEN 10 ELSE 0 END)
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
  ts.complex_jeonse_table AS "complexJeonseTable",
  -- 한 단지 = 한 장 다)(세션635) — 새 칸 5개. ⚠️ 순서 고정 · 맨 끝에만.
  a.bkey          AS "complexKey",
  COALESCE(a.member_ids, ARRAY[a.rep_id]) AS "memberIds",   -- (오) 뺀 구성원(비면 대표 id 하나)
  a.id            AS "materialId",
  a.rep_name      AS "noticeName",
  a.alias_ids     AS "aliasIds"     -- 구성원 전부((오) 포함) — 옛 id → 카드 넘김표 재료
FROM deduped a
LEFT JOIN latest_prices p ON p.bkey = a.bkey
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
LEFT JOIN (                            -- 무순위 공고 횟수·최근 공고일 = 구성원 합·최댓값
  SELECT m.bkey, COUNT(*) AS event_count, MAX(e.recorded_at) AS last_event_at
    FROM applyhome_events e JOIN members m ON m.id = e.apartment_id AND NOT m.is_off   -- (오) 구성원 공고 제외(세션636 D3)
   GROUP BY m.bkey
) ae ON ae.bkey = a.bkey
-- 진짜 모집공고일 소스 (세션 489) — presale_schedule_official.recruit_date = RCRIT_PBLANC_DE.
LEFT JOIN (
  SELECT m.bkey, MAX(s.recruit_date) AS last_recruit_date
    FROM presale_schedule_official s JOIN members m ON m.id = s.apartment_id AND NOT m.is_off   -- (오) 구성원 공고 제외(세션636 D3)
   WHERE s.recruit_date IS NOT NULL
   GROUP BY m.bkey
) pso ON pso.bkey = a.bkey;

REVOKE ALL ON apartments_flat_rehearsal FROM PUBLIC, anon, authenticated;
GRANT SELECT ON apartments_flat_rehearsal TO service_role;

NOTIFY pgrst, 'reload schema';
