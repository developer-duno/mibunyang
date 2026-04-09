# Supabase 데이터베이스 규칙

> 스키마/마이그레이션 수정 시 반드시 이 규칙을 따를 것.

## 테이블 (15개 + 2 VIEW)

| 테이블 | 설명 | 주요 수집기 |
|--------|------|-----------|
| apartments | 미분양 핵심 데이터 + 분양정보 19컬럼 | 청약홈, naver-presale |
| prices | 분양가 이력 (시계열) | 청약홈 |
| unsold_history | 미분양 추이 (시계열) | 청약홈 |
| trades | 실거래가 (매매/전세) | collect-trades |
| trade_stats | 거래 통계 캐시 | trade-stats |
| infra | 인프라 (병원/마트/어린이집/응급의료/경찰) | infra-kakao, childcare, emergency, police |
| schools | 학교 정보 | schools-neis |
| transport | 교통 정보 | transport-tago |
| builders | 건설사 재무 | dart-builders |
| regions | 지역 통계 (인구/이동/시장지표) | population, migration, market-stats |
| complexes | 네이버 단지 정보 | naver-collect.py |
| articles | 네이버 매물 정보 | naver-collect.py |
| complex_price_history | 네이버 시세 이력 | naver-collect.py |
| consults | 상담 신청 | api/consults.js |
| api_quota_log | API 쿼터 사용량 추적 | recordApiQuota() |
| **apartments_flat** (VIEW) | dedup CTE + 7개 JOIN 평탄화 + presale 19컬럼 | - |
| **api_quota_daily** (VIEW) | 일별 API 쿼터 합계 | - |

### apartments 추가 컬럼 그룹

| 그룹 | 컬럼 수 | 수집기 |
|------|---------|--------|
| 건축 특성 | 4 (corridor_type, heat_fuel, avg_maintenance_cost, primary_direction) | molit-building-info, naver-collect |
| 청약 경쟁률 | 3 (competition_rate, supply, applicants) | collect-applyhome |
| 지번 | 3 (bjd_code, lot_main, lot_sub) | reverse-geocode |
| 에너지 | 3 (elec_usage_kwh, gas_usage_mj, energy_collected_at) | collect-building-hub (공공/상업만) |
| 분양정보 | 19 (presale_min_price ~ presale_fetched_at) | naver-presale |
| 대기질 | 1 (air_quality JSONB) | collect-air-quality |
| 치안 | 1 (crime_safety_grade SMALLINT 1~5) | collect-crime-safety |

---

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

### apartments 분양정보 컬럼 (19개)
```
presale_min_price INTEGER, presale_max_price INTEGER, presale_pp INTEGER,
presale_type TEXT, presale_stage TEXT, presale_stage_code TEXT,
presale_image_url TEXT, naver_presale_no TEXT, naver_presale_seq TEXT,
presale_general_supply INTEGER, presale_buildings INTEGER,
presale_parking INTEGER, presale_inquiry TEXT, presale_features TEXT,
presale_move_in TEXT, presale_recruit_date TEXT, presale_schedule JSONB,
presale_housing_type TEXT, presale_fetched_at TIMESTAMPTZ
```

---

## 공유 DB 규칙

인스턴스 `rwdtljipvmqpazrimyns`는 **mibunyang + naver-estate-web 공유**.

### 테이블 소유권

| 소유 | 테이블 | 쓰기 |
|------|--------|------|
| **공용** | complexes | 양쪽 upsert (컬럼 분리: mibunyang→nearby_apartment_ids, naver-estate-web→cortar/detail) |
| **공용** | articles | 양쪽 upsert |
| **공용** | complex_price_history | 양쪽 upsert |
| **공용** | trades | mibunyang만 |
| **mibunyang 전용** | apartments, prices, unsold_history, infra, schools, transport, builders, regions, trade_stats, consults, api_quota_log | mibunyang만 |
| **naver-estate-web 전용** | user_profiles, audit_logs, crawler_checkpoints, complex_pyeong_details 등 | naver-estate-web만 |

### 컬럼명 정규화

DB는 naver-estate-web 기준 컬럼명으로 정규화됨:

| 의도 | 실제 DB 컬럼 |
|------|-------------|
| 위도/경도 | `latitude` / `longitude` |
| 총세대수 | `total_household_count` |
| 부동산유형 | `real_estate_type_code` |
| 난방방식/연료 | `heat_method_type` / `heat_fuel_type` |

인덱스: `idx_complexes_location ON complexes(latitude, longitude)`

---

## 마이그레이션 체크리스트

공용 테이블(complexes/articles/complex_price_history/trades) 변경 시:

1. 상대 프로젝트의 SELECT 쿼리 / ORM 모델 검색
2. 양쪽 CLAUDE.md에 변경 내역 기록
3. **기존 컬럼 타입 변경/삭제 금지** (컬럼 추가만)
4. CREATE INDEX 시 upsert 성능 영향 고려
5. ALTER TABLE은 트래픽 저점(KST 02:00~03:00)에 실행
