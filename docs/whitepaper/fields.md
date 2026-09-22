# 지표 지도 — 기계 추출분 (1층)

> 이 파일은 `node scripts/build-whitepaper.mjs` 가 **코드에서 직접 추출**한다. 손으로 고치지 말 것.
> 추출 시각: 2026-09-22T17:31:37.849Z · VIEW: `20260922000004_view_add_coord_shared.sql`
> "실제 내용물"·"시간 성격" 같은 **사람의 판단**은 2층(`judgments.md`)에 따로 쓴다.

| 코드명(기계어) | 화면 이름(사람어) | DB 표현식 | 점수 | 수집기 | 주기 | 채움 |
|---|---|---|---|---|---|---|
| `address` | 지번 주소 | `(VIEW 없음)` |  |  |  | 100% |
| `airQuality` | 대기질 | `a.air_quality` | Location | data-audit.mjs, collect-air-quality.mjs, air-annual-attach.mjs | 로컬러너 매주 화요일 05:30 KST | 100% |
| `announcementUrl` | (화면 미표시) | `a.announcement_url` |  | collect-applyhome-seed.mjs | GH cron 30 2 * * 1 (collect-applyhome.yml) | 3.3% |
| `area` | 전용면적 (㎡) | `(VIEW 없음)` | Price |  |  | 72.6% |
| `avgFloor` | 평균 거래 층수 (층) | `ts.avg_floor` |  | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 99.3% |
| `avgMaintenanceCost` | 평균 관리비 (만원) | `a.avg_maintenance_cost` | Benefit | data-audit.mjs, sync-naver-complex.mjs, collect-maintenance.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 15일 05:30 KST; 로컬러너 매월 16일 05:30 KST; 로컬러너 매월 17일 05:30 KST; 로컬러너 매월 18일 05:30 KST; 로컬러너 매월 19일 05:30 KST | 78% |
| `avgPriceSqm` | ㎡당 평균분양가 (천원/㎡) | `r.avg_price_sqm` | Price | data-audit.mjs, collect-market-stats.mjs, naver-presale.mjs | 로컬러너 매월 6일 05:30 KST | 100% |
| `balconyFree` | 발코니 확장 무상 | `a.balcony_free` | Benefit | data-audit.mjs |  | 0% |
| `balconyValue` | 발코니 가치 (만원) | `a.balcony_value` | Benefit |  |  | 0% |
| `bank` | 은행 (개) | `(VIEW 없음)` |  |  |  | 100% |
| `bankDist` | 은행 거리 (m) | `i.bank_dist` |  | data-audit.mjs |  | 96.9% |
| `benefits` | 혜택 목록 | `(VIEW 없음)` |  |  |  | 0% |
| `builder` | 시공사 | `(VIEW 없음)` | Price,Product |  |  | 99.8% |
| `builderCreditGrade` | 시공사 신용등급 | `b.credit_grade` | Risk | data-audit.mjs, dart-builders.mjs | GH cron 0 3 15 1,4,7,10 * (collect-dart-builders.yml) | 17.4% |
| `builderDebtRatio` | 시공사 부채비율 (%) | `b.debt_ratio` | Risk | data-audit.mjs, dart-builders.mjs | GH cron 0 3 15 1,4,7,10 * (collect-dart-builders.yml) | 17.4% |
| `buildingCoverageRatio` | 건폐율 (%) | `a.building_coverage_ratio` |  | sync-naver-complex.mjs, molit-building-info.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST | 86% |
| `busRoutes` | 버스 노선 (개) | `t.bus_routes` | Location | data-audit.mjs, transport-tago.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 100% |
| `busStopNames` | 주변 버스정류장 | `t.bus_stop_names` |  | data-audit.mjs, transport-tago.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 95.9% |
| `cafe` | 카페 (개) | `(VIEW 없음)` |  |  |  | 100% |
| `cafeDist` | 카페 거리 (m) | `i.cafe_dist` |  | data-audit.mjs |  | 94.5% |
| `cancelRatio6m` | 계약해제율 (%) | `ts.cancel_ratio_6m` | Risk | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 99.2% |
| `cashback` | 캐시백 (만원) | `(VIEW 없음)` | Benefit |  |  | 0% |
| `catsCache` | (화면 미표시) | `a.cats_cache` |  |  |  | 100% |
| `childcare` | 어린이집/유치원(1km) (개) | `(VIEW 없음)` | Product,Location |  |  | 100% |
| `childcareDist` | 어린이집 거리 (m) | `i.childcare_dist` |  | collect-childcare.mjs, childcare-info.mjs | GH cron 0 20 1 * * (collect-childcare.yml) | 91.4% |
| `cityDev` | 도시 개발 | `a.city_dev` | Future | data-audit.mjs, naver-devplan.mjs, transit-match.mjs | 로컬러너 매월 20일 05:30 KST | 96.9% |
| `competitionApplicants` | 청약신청수 (명) | `a.competition_applicants` |  | data-audit.mjs, collect-applyhome.mjs | GH cron 30 2 * * 1 (collect-applyhome.yml) | 31.8% |
| `competitionRate` | 청약 경쟁률 | `a.competition_rate` | Risk | data-audit.mjs, collect-applyhome.mjs | GH cron 30 2 * * 1 (collect-applyhome.yml) | 31.7% |
| `competitionSupply` | 공급세대수(청약) (세대) | `a.competition_supply` |  | data-audit.mjs, collect-applyhome.mjs | GH cron 30 2 * * 1 (collect-applyhome.yml) | 31.8% |
| `completion` | 입주예정 | `(VIEW 없음)` | Price |  |  | 81.8% |
| `contractDiscount` | 계약금 할인 | `a.contract_discount` |  |  |  | 0% |
| `conv` | 편의점 (개) | `(VIEW 없음)` | Location |  |  | 100% |
| `convDist` | 편의점 거리 (m) | `i.conv_dist` |  | data-audit.mjs |  | 93.9% |
| `coordShared` | (화면 미표시) | `a.coord_shared` |  | flag-shared-coords.mjs |  | 1.6% |
| `corridorType` | 복도유형 | `a.corridor_type` |  | data-audit.mjs, sync-naver-complex.mjs, molit-building-info.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST | 63.1% |
| `crimeSafetyGrade` | 치안 안전등급 | `a.crime_safety_grade` | Risk | data-audit.mjs, collect-crime-safety.mjs | 로컬러너 매월 8일 05:30 KST | 96.6% |
| `culture` | 문화시설 (개) | `(VIEW 없음)` |  |  |  | 100% |
| `cultureDist` | 문화시설 거리 (m) | `i.culture_dist` |  | data-audit.mjs |  | 96.8% |
| `dataReliability` | 데이터 신뢰도 (%) | `)))` ⚠️식 | Price |  |  | 100% |
| `devDist` | 개발지 거리 (km) | `a.dev_dist` | Future | data-audit.mjs, transit-match.mjs |  | 56.4% |
| `discountPct` | 할인율 (%) | `a.discount_pct` | Benefit | data-audit.mjs |  | 0% |
| `district` | 개발구역 | `(VIEW 없음)` |  |  |  | 2% |
| `doctorsPer1k` | 인구 천명당 의사수 (명) | `rg.doctors_per_1k` |  | collect-medical-access.mjs | 로컬러너 매월 14일 05:30 KST | 100% |
| `dong` | 동 | `(VIEW 없음)` |  |  |  | 100% |
| `dsr40pass` | DSR 40% 통과 | `a.dsr40pass` | Risk |  |  | 97.1% |
| `elecUsageKwh` | 월 전기사용량 (kWh) | `a.elec_usage_kwh` |  | data-audit.mjs, collect-building-hub.mjs | 로컬러너 매월 15일 05:30 KST | 16% |
| `emergency` | 응급의료기관 (개) | `(VIEW 없음)` |  |  |  | 100% |
| `emergencyDist` | 응급의료 거리 (m) | `i.emergency_dist` |  | data-audit.mjs, collect-emergency.mjs | 로컬러너 매월 3일 05:30 KST | 93.4% |
| `energyCollectedAt` | 에너지 수집 시점 | `a.energy_collected_at` |  | data-audit.mjs, collect-building-hub.mjs | 로컬러너 매월 15일 05:30 KST | 18% |
| `energyGrade` | 에너지 등급 | `a.energy_grade` | Product | data-audit.mjs, molit-building-info.mjs | 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST | 0% |
| `exclusiveRatio` | 전용률 (%) | `a.exclusive_ratio` | Product | data-audit.mjs, _shared.mjs, calc-exclusive-ratio.mjs 외1 | GH cron 0 19 * * * (collect-naver-listings.yml) | 78.5% |
| `fertilityRate` | 합계출산율 | `rg.fertility_rate` |  | collect-fertility-rate.mjs | 로컬러너 매월 10일 05:30 KST | 100% |
| `floorAreaRatio` | 용적률 (%) | `a.floor_area_ratio` | Product | data-audit.mjs, naver-listings.mjs, sync-naver-complex.mjs 외1 | GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST | 70.5% |
| `floorRange` | 거래 층수 범위 | `ts.floor_range` |  | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 99.3% |
| `floors` | 층수 범위 | `(VIEW 없음)` |  |  |  | 95.9% |
| `gasUsageMj` | 월 가스사용량 (MJ) | `a.gas_usage_mj` |  | data-audit.mjs, collect-building-hub.mjs | 로컬러너 매월 15일 05:30 KST | 12.6% |
| `greenBldg` | 녹색건축 | `a.green_bldg` | Product |  |  | 0% |
| `gu` | 구/시 | `(VIEW 없음)` | Risk |  |  | 98.6% |
| `hasPool` | 수영장 | `a.has_pool` | Product | data-audit.mjs, naver-listings.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 57.6% |
| `heatFuel` | 난방연료 | `a.heat_fuel` |  | data-audit.mjs, collect-building-hub.mjs, sync-naver-complex.mjs | 로컬러너 매월 15일 05:30 KST / GH cron 0 19 * * * (collect-naver-listings.yml) | 70.6% |
| `heating` | 난방방식 | `(VIEW 없음)` |  |  |  | 75.5% |
| `hospital` | 병원 (개) | `(VIEW 없음)` | Location |  |  | 100% |
| `hospitalBedsPer1k` | 인구 천명당 병상수 (개) | `rg.hospital_beds_per_1k` |  | collect-medical-access.mjs | 로컬러너 매월 14일 05:30 KST | 99.8% |
| `hospitalDist` | 병원 거리 (m) | `i.hospital_dist` |  | data-audit.mjs |  | 94.9% |
| `housingPrice` | 공시가격(시군구 평균) (만원/㎡) | `rg.housing_price` |  | data-audit.mjs, collect-housing-price.mjs | 로컬러너 매월 17일 05:30 KST | 99.4% |
| `housingSupplyLevel` | 주택보급률 (%) | `r.housing_supply_level` | Risk | data-audit.mjs, collect-housing-supply-ratio.mjs | 로컬러너 매월 2일 05:30 KST | 100% |
| `hugGuarantee` | HUG 보증 | `b.hug_guarantee` | Risk | data-audit.mjs |  | 0% |
| `icDist` | IC 거리 (km) | `t.ic_dist` | Location | data-audit.mjs, transport-tago.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 100% |
| `id` | 단지 ID | `(VIEW 없음)` |  |  |  | 100% |
| `industryDev` | 산업 개발 | `a.industry_dev` | Future | data-audit.mjs, industry-match.mjs, naver-devplan.mjs 외1 | GH cron 0 19 7 * * (collect-industry.yml) / 로컬러너 매월 20일 05:30 KST | 67.4% |
| `initialSaleRate` | 초기분양률 (%) | `r.initial_sale_rate` | Risk | data-audit.mjs, collect-market-stats.mjs | 로컬러너 매월 6일 05:30 KST | 100% |
| `isRegulated` | 규제지역 | `a.is_regulated` | Risk | data-audit.mjs, regulation-seed.mjs |  | 100% |
| `jeonseByArea` | (화면 미표시) | `ts.jeonse_by_area` |  | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 100% |
| `jeonseRate` | 전세가율 (%) | `ts.jeonse_rate` | Price | data-audit.mjs, trade-stats.mjs, trade-stats-regions.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) / GH cron 30 16 7,21 * * (collect-trade-stats-regions.yml) | 99.2% |
| `ktxDist` | KTX 거리 (km) | `t.ktx_dist` | Location | data-audit.mjs, transport-tago.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 100% |
| `landCostRatio` | 대지비 비율 (%) | `r.land_cost_ratio` | Price | data-audit.mjs, collect-market-stats.mjs | 로컬러너 매월 6일 05:30 KST | 100% |
| `lastUnsoldEventAt` | 최근 무순위 공고일 | `pso.last_recruit_date` |  |  |  | 54.9% |
| `layout` | 평면구조 | `(VIEW 없음)` | Product |  |  | 68.3% |
| `loanFree` | 무이자 대출 | `a.loan_free` | Risk,Benefit | data-audit.mjs |  | 0% |
| `loanFreePct` | 무이자 비율 (%) | `a.loan_free_pct` | Benefit |  |  | 0% |
| `mart` | 대형마트 (개) | `(VIEW 없음)` | Location |  |  | 100% |
| `martDist` | 마트 거리 (m) | `i.mart_dist` |  | data-audit.mjs |  | 42.6% |
| `maxFloor` | 최고층 (층) | `a.max_floor` | Product | data-audit.mjs, calc-floors.mjs, naver-listings.mjs 외3 | GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST | 96.2% |
| `name` | 단지명 | `(VIEW 없음)` | Price |  |  | 100% |
| `naverAvgFloor` | 네이버 평균 층수 (층) | `a.naver_avg_floor` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 97.2% |
| `naverBuildYear` | 네이버 평균 건축연도 | `a.naver_build_year` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 99.4% |
| `naverFetchedAt` | 수집 시점 | `a.naver_fetched_at` |  | sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 99.4% |
| `naverJeonseCount` | 전세 매물 (건) | `a.naver_jeonse_count` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 54.1% |
| `naverJeonseRate` | 네이버 전세가율 (%) | `a.naver_jeonse_rate` |  | data-audit.mjs, trade-stats.mjs, sync-naver-complex.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) / GH cron 0 19 * * * (collect-naver-listings.yml) | 93.4% |
| `naverNearbyAvg` | 네이버 주변 평균가 (만원) | `a.naver_nearby_avg` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 99.1% |
| `naverNearbyCount` | 주변 단지 수 (개) | `a.naver_nearby_count` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 99.4% |
| `naverNearbyMedian` | 네이버 주변 중위가 (만원) | `a.naver_nearby_median` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 99.1% |
| `naverPresaleNo` | 네이버 분양번호 | `a.naver_presale_no` |  | naver-presale.mjs |  | 72.9% |
| `naverPresaleSeq` | 네이버 공고순번 | `a.naver_presale_seq` |  | naver-presale.mjs |  | 72.9% |
| `naverSchoolWalkMin` | 최근접 초등 도보 (분) | `a.naver_school_walk_min` | Location | data-audit.mjs, calc-school-walk.mjs |  | 63.5% |
| `naverSellCount` | 매매 매물 (건) | `a.naver_sell_count` |  | data-audit.mjs, collect-unsold-kosis.mjs, sync-naver-complex.mjs | 로컬러너 매월 9일 05:30 KST / GH cron 0 19 * * * (collect-naver-listings.yml) | 62.7% |
| `naverWolseCount` | 월세 매물 (건) | `a.naver_wolse_count` |  | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 53.5% |
| `nearbyBuildYear` | 주변 평균 건축연도 | `ts.nearby_build_year` |  | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 81.6% |
| `nearbyFacilities` | (화면 미표시) | `i.nearby_facilities` |  | data-audit.mjs |  | 0% |
| `nearbyMedian` | 주변 아파트 시세 (만원) | `ts.nearby_median` | Price | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 99.9% |
| `nearbySchools` | (화면 미표시) | `sc.nearby_schools` |  | data-audit.mjs, calc-school-walk.mjs, schools-neis.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 100% |
| `netMigration` | 순이동 (명) | `r.net_migration` | Future | data-audit.mjs, migration.mjs | 로컬러너 매월 7일 05:30 KST | 100% |
| `newSupply` | 신규 분양세대수 (세대) | `r.new_supply` |  | data-audit.mjs, collect-market-stats.mjs | 로컬러너 매월 6일 05:30 KST | 100% |
| `noise` | 소음 (dB) | `(VIEW 없음)` | Location |  |  | 76.4% |
| `noxious` | 혐오시설 | `(VIEW 없음)` | Location |  |  | 89.6% |
| `noxiousDist` | 혐오시설 거리 (m) | `a.noxious_dist` | Location | data-audit.mjs, collect-air-quality.mjs, noxious.mjs | 로컬러너 매주 화요일 05:30 KST / GH cron 0 18 3 * * (collect-noxious.yml) | 86.2% |
| `optionFree` | 옵션 무상 | `a.option_free` | Benefit |  |  | 0% |
| `optionValue` | 옵션 가치 (만원) | `a.option_value` | Benefit |  |  | 0% |
| `park` | 공원 (개) | `(VIEW 없음)` | Location |  |  | 100% |
| `parkDist` | 공원 거리 (m) | `i.park_dist` |  | data-audit.mjs |  | 94.9% |
| `parkingRatio` | 주차 비율 (대/세대) | `a.parking_ratio` | Product | data-audit.mjs, sync-naver-complex.mjs, molit-building-info.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST | 91.3% |
| `pharmacy` | 약국 (개) | `(VIEW 없음)` | Location |  |  | 100% |
| `pharmacyDist` | 약국 거리 (m) | `i.pharmacy_dist` |  | data-audit.mjs |  | 75.7% |
| `pir` | PIR (소득대비) (배) | `(VIEW 없음)` | Price |  |  | 97.1% |
| `police` | 경찰관서(3km) (개) | `(VIEW 없음)` | Risk |  |  | 100% |
| `policeDist` | 경찰관서 거리 (m) | `i.police_dist` | Risk | collect-air-quality.mjs, collect-police.mjs | 로컬러너 매주 화요일 05:30 KST / GH cron 0 16 1 * * (collect-police.yml) | 91.5% |
| `popGrowth` | 인구증감률 (%) | `r.pop_growth` | Future,Risk | data-audit.mjs, population.mjs | 로컬러너 매월 5일 05:30 KST | 100% |
| `pp` | 평당가 (만원) | `(VIEW 없음)` |  |  |  | 97.1% |
| `presaleBuildings` | 동수 (동) | `a.presale_buildings` |  | naver-presale.mjs |  | 72.9% |
| `presaleFeatures` | 특징 | `a.presale_features` |  | naver-presale.mjs |  | 72.6% |
| `presaleFetchedAt` | 분양정보 수집시점 | `a.presale_fetched_at` |  | naver-presale.mjs |  | 72.9% |
| `presaleGeneralSupply` | 일반분양 세대 (세대) | `a.presale_general_supply` | Product | naver-presale.mjs |  | 72.9% |
| `presaleHousingType` | 주택유형 | `a.presale_housing_type` | Product | _shared.mjs, calc-exclusive-ratio.mjs, naver-presale.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 72.9% |
| `presaleImageUrl` | 대표이미지 | `a.presale_image_url` |  | naver-presale.mjs |  | 0% |
| `presaleInquiry` | 분양문의 | `a.presale_inquiry` |  | naver-presale.mjs |  | 33% |
| `presaleMaxPrice` | 분양 최고가 (만원) | `a.presale_max_price` |  | naver-presale.mjs |  | 72.9% |
| `presaleMinPrice` | 분양 최저가 (만원) | `a.presale_min_price` |  | naver-presale.mjs |  | 72.9% |
| `presaleMoveIn` | 입주시기 | `a.presale_move_in` |  | naver-presale.mjs |  | 54% |
| `presaleParking` | 주차대수 (대) | `a.presale_parking` | Product | naver-presale.mjs |  | 72.9% |
| `presalePp` | 평당 분양가 (만원) | `a.presale_pp` | Price | naver-presale.mjs |  | 72.9% |
| `presaleRecruitDate` | 분양시기 | `a.presale_recruit_date` |  | naver-presale.mjs |  | 72.9% |
| `presaleSchedule` | 분양일정 | `a.presale_schedule` |  | naver-presale.mjs |  | 72.9% |
| `presaleStage` | 분양단계 | `a.presale_stage` | Price | collect-applyhome-detail.mjs, naver-presale.mjs | GH cron 30 3 * * 1 (collect-applyhome-detail.yml) | 72.9% |
| `presaleStageCode` | 분양단계코드 | `a.presale_stage_code` |  | naver-presale.mjs |  | 72.9% |
| `presaleType` | 분양유형 | `a.presale_type` | Price,Risk | naver-presale.mjs |  | 72.9% |
| `price` | 분양가 (만원) | `(VIEW 없음)` | Price,Benefit |  |  | 97.1% |
| `priceByArea` | (화면 미표시) | `ts.price_by_area` | Price | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 100% |
| `priceByFloor` | (화면 미표시) | `ts.price_by_floor` |  | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 100% |
| `priceIndex` | 분양가격지수 (2014=100) | `r.price_index` | Price | collect-sale-price-index.mjs, data-audit.mjs, collect-jeonse-price-index.mjs 외1 | 로컬러너 매월 17일 05:30 KST / 로컬러너 매월 18일 05:30 KST / 로컬러너 매월 6일 05:30 KST | 100% |
| `primaryDirection` | 대표 향 | `a.primary_direction` | Location | data-audit.mjs, sync-naver-complex.mjs | GH cron 0 19 * * * (collect-naver-listings.yml) | 83.2% |
| `psr` | PSR (주변대비) | `(VIEW 없음)` | Price |  |  | 72.1% |
| `quakeDesign` | 내진설계 | `a.quake_design` | Product | collect-building-hub.mjs, sync-naver-complex.mjs | 로컬러너 매월 15일 05:30 KST / GH cron 0 19 * * * (collect-naver-listings.yml) | 32.4% |
| `recentTrades6m` | 구 최근6개월 거래 (건) | `ts.recent_trades_6m` | Risk | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 99.3% |
| `region` | 시/도 | `(VIEW 없음)` | Risk,Location |  |  | 100% |
| `rentByArea` | (화면 미표시) | `ts.rent_by_area` |  | data-audit.mjs, trade-stats.mjs | GH cron 0 16 7,21 * * (collect-trade-stats.yml) | 100% |
| `roadAddress` | 도로명 주소 | `a.road_address` |  | _kakao-poi.mjs, data-audit.mjs, reverse-geocode.mjs 외2 | GH cron 0 2 * * 0 (backfill-new-apartments.yml); GH cron 0 19 * * * (collect-naver-listings.yml) / GH cron 0 4 1 * * (collect-noise.yml) / 로컬러너 매월 15일 05:30 KST | 40.3% |
| `schoolGrade` | 학군 등급 | `sc.school_grade` | Location | data-audit.mjs, schools-neis.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 100% |
| `schoolScore` | 학군 점수 | `sc.school_score` | Location | data-audit.mjs, schools-neis.mjs, collect-nearby-childcare.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) / GH cron 30 20 * * 2 (collect-nearby-childcare.yml) | 100% |
| `scoresComputedAt` | (화면 미표시) | `a.scores_computed_at` |  |  |  | 100% |
| `subwayDist` | 지하철 거리 (m) | `COALESCE(t.subway_dist, i.subway_dist, 9999)` ⚠️식 | Location | data-audit.mjs, infra-kakao.mjs, collect-air-quality.mjs 외1 | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) / 로컬러너 매주 화요일 05:30 KST | 100% |
| `subwayLines` | 지하철 노선 | `t.subway_lines` | Location | data-audit.mjs, transport-tago.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 77.9% |
| `subwayName` | 최근접 지하철역 | `t.subway_name` |  | data-audit.mjs, transport-tago.mjs | GH cron 30 20 * * * (collect-naver-listings-incremental.yml) | 84% |
| `sunlight` | 일조 | `(VIEW 없음)` | Location |  |  | 60.2% |
| `supplyRatio` | 공급비율 (%) | `r.supply_ratio` | Risk | data-audit.mjs, housing-permits.mjs, population.mjs | 로컬러너 매월 11일 05:30 KST / 로컬러너 매월 5일 05:30 KST | 100% |
| `transitDev` | 교통 개발 | `a.transit_dev` | Future | data-audit.mjs, naver-devplan.mjs, transit-match.mjs | 로컬러너 매월 20일 05:30 KST | 56.4% |
| `units` | 총세대수 (세대) | `(VIEW 없음)` | Product,Risk |  |  | 100% |
| `unsold` | 미분양 세대 (세대) | `(VIEW 없음)` |  |  |  | 84.2% |
| `unsoldEventCount` | 무순위 공고 횟수 | `COALESCE(ae.event_count, 0)` ⚠️식 |  |  |  | 100% |
| `unsoldRate` | 미분양률 (%) | `CASE WHEN a.unsold_rate > 100 THEN NULL ELSE a.unsold_rate END` ⚠️식 | Risk | molit-units.mjs, collect-applyhome-seed.mjs, collect-unsold-kosis.mjs 외1 | 로컬러너 매월 6일 05:30 KST / GH cron 30 2 * * 1 (collect-applyhome.yml) / 로컬러너 매월 9일 05:30 KST / GH cron 0 19 * * * (collect-naver-listings.yml) | 81.8% |
| `updatedAt` | (화면 미표시) | `a.updated_at` |  | molit-units.mjs, calc-floors.mjs, regulation-seed.mjs 외17 | 로컬러너 매월 6일 05:30 KST / GH cron 0 23 * * 0 (calc-layout.yml) / GH cron 30 20 * * * (collect-naver-listings-incremental.yml) / GH cron 0 16 7,21 * * (collect-trade-stats.yml) / GH cron 0 20 1 * * (collect-childcare.yml) / GH cron 0 19 * * * (collect-naver-listings.yml) / 로컬러너 매월 3일 05:30 KST / GH cron 30 2 * * 1 (collect-applyhome.yml) / 로컬러너 매월 9일 05:30 KST / GH cron 0 16 1 * * (collect-police.yml) / 로컬러너 매월 15일 05:30 KST / 로컬러너 매월 15일 05:30 KST; 로컬러너 매월 16일 05:30 KST; 로컬러너 매월 17일 05:30 KST; 로컬러너 매월 18일 05:30 KST; 로컬러너 매월 19일 05:30 KST / 로컬러너 매월 10일 05:30 KST; 로컬러너 매월 11일 05:30 KST / GH cron 0 3 15 1,4,7,10 * (collect-dart-builders.yml) | 100% |
| `view` | 조망 | `(VIEW 없음)` | Location |  |  | 93.4% |

총 161개 지표.
