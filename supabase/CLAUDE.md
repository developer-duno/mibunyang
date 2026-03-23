# Supabase 데이터베이스 규칙

> 스키마/마이그레이션 수정 시 반드시 이 규칙을 따를 것.

## 테이블 (14개 + 1 VIEW)

| 테이블 | 설명 | 주요 수집기 |
|--------|------|-----------|
| apartments | 미분양 아파트 핵심 데이터 | 청약홈 API |
| prices | 분양가 이력 (시계열) | 청약홈 API |
| unsold_history | 미분양 추이 (시계열) | 청약홈 API |
| trades | 실거래가 (매매/전세) | collect-trades.mjs |
| trade_stats | 거래 통계 캐시 (cancel_ratio_6m 포함) | trade-stats.mjs |
| infra | 주변 인프라 (병원, 마트 등) | infra-kakao.mjs |
| schools | 학교 정보 | schools-neis.mjs |
| transport | 교통 정보 | transport-tago.mjs |
| builders | 건설사 재무 | dart-builders.mjs |
| regions | 지역 통계 (인구, 이동) | population.mjs, migration.mjs |
| complexes | 네이버 단지 정보 | naver-collect.py |
| articles | 네이버 매물 정보 | naver-collect.py |
| complex_price_history | 네이버 시세 이력 | naver-collect.py |
| consults | 상담 신청 | api/consults.js |
| **apartments_flat** (VIEW) | 7개 테이블 JOIN 평탄화 | — |
