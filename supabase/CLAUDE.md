# Supabase 데이터베이스 규칙

> 스키마/마이그레이션 수정 시 반드시 이 규칙을 따를 것.

## 테이블 (15개 + 2 VIEW + presale 19컬럼)

| 테이블 | 설명 | 주요 수집기 |
|--------|------|-----------|
| apartments | 미분양 아파트 핵심 데이터 + 분양정보 19컬럼 | 청약홈 API, naver-presale.mjs |
| prices | 분양가 이력 (시계열) | 청약홈 API |
| unsold_history | 미분양 추이 (시계열) | 청약홈 API |
| trades | 실거래가 (매매/전세) | collect-trades.mjs |
| trade_stats | 거래 통계 캐시 (cancel_ratio_6m 포함) | trade-stats.mjs |
| infra | 주변 인프라 (병원, 마트 등 + 어린이집/응급의료) | infra-kakao.mjs, collect-childcare.mjs, collect-emergency.mjs |
| schools | 학교 정보 | schools-neis.mjs |
| transport | 교통 정보 | transport-tago.mjs |
| builders | 건설사 재무 | dart-builders.mjs |
| regions | 지역 통계 (인구, 이동, 시장지표 5개) | population.mjs, migration.mjs, collect-market-stats.mjs |
| (apartments 컬럼) | 건축 특성 4개 (corridor_type/heat_fuel/avg_maintenance_cost/primary_direction) | molit-building-info.mjs, naver-collect.py |
| (apartments 컬럼) | 청약 경쟁률 3개 (competition_rate/supply/applicants) | collect-applyhome.mjs |
| (apartments 컬럼) | 지번 3개 (bjd_code/lot_main/lot_sub) | reverse-geocode.mjs |
| (apartments 컬럼) | 에너지 3개 (elec_usage_kwh/gas_usage_mj/energy_collected_at) | collect-building-hub.mjs (⚠️ 공공/상업 건물만, 주거 아파트 미제공) |
| (apartments 컬럼) | 분양정보 19개 (presale_min_price~presale_fetched_at) | naver-presale.mjs |
| (apartments 컬럼) | 대기질 1개 (air_quality JSONB) | collect-air-quality.mjs |
| (apartments 컬럼) | 치안 안전 1개 (crime_safety_grade SMALLINT 1~5) | collect-crime-safety.mjs |
| (infra 컬럼) | 어린이집 2개 (childcare/childcare_dist) | collect-childcare.mjs |
| (infra 컬럼) | 응급의료 2개 (emergency/emergency_dist) | collect-emergency.mjs |
| complexes | 네이버 단지 정보 | naver-collect.py |
| articles | 네이버 매물 정보 | naver-collect.py |
| complex_price_history | 네이버 시세 이력 | naver-collect.py |
| consults | 상담 신청 | api/consults.js |
| api_quota_log | data.go.kr API 쿼터 사용량 추적 | recordApiQuota() (_shared.mjs) |
| **apartments_flat** (VIEW) | dedup CTE + 7개 테이블 JOIN 평탄화 + presale 19컬럼 | — |
| **api_quota_daily** (VIEW) | 일별 API 쿼터 합계 (모니터링용) | — |

## 시계열 테이블 스키마

### prices (분양가 이력)
```
id SERIAL PK, apartment_id TEXT FK, area REAL, supply_area REAL,
price INTEGER (만원), pp INTEGER (평당가), house_type TEXT,
supply_count INTEGER, recorded_at DATE
UNIQUE(apartment_id, house_type, recorded_at)
인덱스: idx_prices_apartment, idx_prices_latest(apartment_id, recorded_at DESC)
```

### unsold_history (미분양 추이)
```
id SERIAL PK, apartment_id TEXT FK, base_month TEXT ("202603"),
unsold_count INTEGER, post_completion_unsold INTEGER, change INTEGER,
recorded_at DATE
UNIQUE(apartment_id, base_month)
인덱스: idx_unsold_apartment, idx_unsold_month
```

### apartments 분양정보 컬럼 (19개, pre.land.naver.com)
```
presale_min_price INTEGER (만원), presale_max_price INTEGER (만원),
presale_pp INTEGER (평당가 만원), presale_type TEXT (민간분양/공공분양),
presale_stage TEXT (분양단계), presale_stage_code TEXT (C11=예정/C12=진행),
presale_image_url TEXT, naver_presale_no TEXT (단지번호),
naver_presale_seq TEXT (공고순번), presale_general_supply INTEGER (일반분양),
presale_buildings INTEGER (동수), presale_parking INTEGER (주차대수),
presale_inquiry TEXT (분양문의), presale_features TEXT (특징),
presale_move_in TEXT (입주시기), presale_recruit_date TEXT (분양시기),
presale_schedule JSONB (일정상세), presale_housing_type TEXT (주택유형),
presale_fetched_at TIMESTAMPTZ (수집시점)
마이그레이션: 20260329000000_add_presale_fields.sql (2026-03-29 Dashboard 실행 완료)
```

## 공유 DB 규칙

Supabase 인스턴스 `rwdtljipvmqpazrimyns`는 **mibunyang + naver-estate-web 공유**.

### 테이블 소유권

| 소유 | 테이블 | 쓰기 권한 | 읽기 권한 |
|------|--------|----------|----------|
| **공용** | complexes | 양쪽 upsert (컬럼 분리: mibunyang→nearby_apartment_ids, naver-estate-web→cortar/detail) | 양쪽 |
| **공용** | articles | 양쪽 upsert (mibunyang→로컬수집, naver-estate-web→APScheduler) | 양쪽 |
| **공용** | complex_price_history | 양쪽 upsert | 양쪽 |
| **공용** | trades | mibunyang만 upsert | 양쪽 |
| **mibunyang 전용** | apartments, prices, unsold_history, infra, schools, transport, builders, regions, trade_stats, consults + apartments_flat VIEW | mibunyang만 | mibunyang만 |
| **naver-estate-web 전용** | user_profiles, audit_logs, rate_limit_counters, admin_settings, crawler_checkpoints, complex_pyeong_details, article_price_history | naver-estate-web만 | naver-estate-web만 |

### 컬럼명 정규화 완료 (Phase 3, 2026-03-29)

DB 실사 결과, 실제 DB는 naver-estate-web 기준 컬럼명으로 이미 정규화됨.
schema.sql의 구 컬럼명(lat/lng/total_households 등)은 **실제 DB에 존재하지 않음**.

| 컬럼 의도 | 실제 DB 컬럼 | naver-collect.py | naver-estate-web | 상태 |
|----------|-------------|-----------------|-----------------|------|
| 위도 | `latitude` | `latitude` | `latitude` | ✅ 일치 |
| 경도 | `longitude` | `longitude` | `longitude` | ✅ 일치 |
| 총세대수 | `total_household_count` | `total_household_count` | `total_household_count` | ✅ 일치 |
| 부동산유형 | `real_estate_type_code` | `real_estate_type_code` | `real_estate_type_code` | ✅ 일치 |
| 난방방식 | `heat_method_type` | `heat_method_type` | `heat_method_type` | ✅ 일치 (Phase 3 수정) |
| 난방연료 | `heat_fuel_type` + `heat_fuel`(레거시) | `heat_fuel_type` | `heat_fuel_type` | ✅ 일치 (Phase 3 수정) |

인덱스: `idx_complexes_location ON complexes(latitude, longitude)` — 실제 DB latitude/longitude 존재, 정상.

### 마이그레이션 체크리스트

공용 테이블(complexes/articles/complex_price_history/trades) 변경 시:
1. 상대 프로젝트의 SELECT 쿼리 / ORM 모델 검색
2. 양쪽 CLAUDE.md에 변경 내역 기록
3. 기존 컬럼 타입 변경/삭제 금지 (컬럼 추가만)
4. CREATE INDEX 시 upsert 성능 영향 고려
5. ALTER TABLE은 트래픽 저점(KST 02:00~03:00)에 실행
