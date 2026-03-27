# Supabase 데이터베이스 규칙

> 스키마/마이그레이션 수정 시 반드시 이 규칙을 따를 것.

## 테이블 (14개 + 1 VIEW + presale 19컬럼)

| 테이블 | 설명 | 주요 수집기 |
|--------|------|-----------|
| apartments | 미분양 아파트 핵심 데이터 + 분양정보 19컬럼 | 청약홈 API, naver-presale.mjs |
| prices | 분양가 이력 (시계열) | 청약홈 API |
| unsold_history | 미분양 추이 (시계열) | 청약홈 API |
| trades | 실거래가 (매매/전세) | collect-trades.mjs |
| trade_stats | 거래 통계 캐시 (cancel_ratio_6m 포함) | trade-stats.mjs |
| infra | 주변 인프라 (병원, 마트 등) | infra-kakao.mjs |
| schools | 학교 정보 | schools-neis.mjs |
| transport | 교통 정보 | transport-tago.mjs |
| builders | 건설사 재무 | dart-builders.mjs |
| regions | 지역 통계 (인구, 이동, 시장지표 5개) | population.mjs, migration.mjs, collect-market-stats.mjs |
| (apartments 컬럼) | 청약 경쟁률 3개 (competition_rate/supply/applicants) | collect-applyhome.mjs |
| (apartments 컬럼) | 지번 3개 (bjd_code/lot_main/lot_sub) | reverse-geocode.mjs |
| (apartments 컬럼) | 에너지 3개 (elec_usage_kwh/gas_usage_mj/energy_collected_at) | collect-building-hub.mjs |
| (apartments 컬럼) | 분양정보 19개 (presale_min_price~presale_fetched_at) | naver-presale.mjs |
| complexes | 네이버 단지 정보 | naver-collect.py |
| articles | 네이버 매물 정보 | naver-collect.py |
| complex_price_history | 네이버 시세 이력 | naver-collect.py |
| consults | 상담 신청 | api/consults.js |
| **apartments_flat** (VIEW) | dedup CTE + 7개 테이블 JOIN 평탄화 + presale 19컬럼 | — |

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
마이그레이션: 20260329000000_add_presale_fields.sql
```
