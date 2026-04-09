# GitHub Actions 워크플로우 규칙

> 워크플로우 수정/추가 시 반드시 이 규칙을 따를 것.

## 워크플로우 목록

### 매일 (3개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-naver-listings.yml` | 네이버 후처리 (sync + 전용률 계산) |
| `naver-units.yml` | 네이버 세대수 2차 보정 |
| `daily-deploy.yml` | Vercel 자동 배포 (KST 03:00) |

### CI/CD (1개)

| 워크플로우 | 설명 |
|-----------|------|
| `ci.yml` | CI 파이프라인 (린트 + 테스트 + 빌드, push/PR 트리거) |

### 매주 (3개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-trade-stats.yml` | 거래 통계 산출 (일요일) |
| `calc-exclusive-ratio.yml` | 전용률 계산 (일요일) |
| `calc-layout.yml` | 평면구조 추정 (일요일) |

### 매월 (23개)

| 워크플로우 | 일자 | 설명 |
|-----------|------|------|
| `collect-unsold-kosis.yml` | 1일 | KOSIS 시군구별 미분양 |
| `collect-infra.yml` | 1일 | Kakao Places 인프라 |
| `collect-transport.yml` | 1일 | Kakao Places 교통 |
| `collect-schools.yml` | 1일 | NEIS 학교 |
| `collect-noise.yml` | 1일 | 소음 추정 |
| `collect-environment.yml` | 1일 | 환경/혐오시설 |
| `collect-noxious.yml` | 1일 | 혐오시설 거리 |
| `collect-industry.yml` | 1일 | 산업단지 매칭 |
| `collect-childcare.yml` | 1일 | Kakao 어린이집/유치원 |
| `collect-police.yml` | 1일 | Kakao 경찰관서 밀도 |
| `collect-emergency.yml` | 2일 | 응급의료기관 |
| `collect-population.yml` | 5일 | 행안부 인구 증감률 |
| `collect-market-stats.yml` | 5일 | KOSIS HUG 시장통계 |
| `collect-trades.yml` | 6일 | 국토부 실거래 (매매/전세/분양권) |
| `collect-molit-units.yml` | 6일 | 국토부 총세대수 보정 |
| `collect-building-info.yml` | 10일 | 건축물 상세 (토요일 → 11일 fallback) |
| `collect-housing-permits.yml` | 10일 | 주택 인허가 |
| `collect-air-quality.yml` | 매주 월 | 에어코리아 대기질 |
| `collect-applyhome.yml` | 주간 | 청약홈 잔여세대 |
| `collect-migration.yml` | 15일 | 행안부 전입/전출 |
| `collect-maintenance.yml` | 15일 | 공동주택 관리비 |
| `collect-building-hub.yml` | 15일 | 건축HUB 에너지+인허가 |
| `collect-dart-builders.yml` | 분기별 | DART 시공사 재무 |

### 모니터링 (1개)

| 워크플로우 | 설명 |
|-----------|------|
| `monitor-db-size.yml` | Supabase 테이블별 행 수 점검 (매월 1일 KST 06:00) |

### 유틸리티 (5개)

| 워크플로우 | 설명 |
|-----------|------|
| `apply-migration.yml` | Supabase 마이그레이션 적용 |
| `seed-data.yml` | 초기 데이터 시딩 |
| `fill-missing-data.yml` | 빈 데이터 일괄 수집 (16개 수집기 순차) |
| `geocode-missing.yml` | 좌표 누락 지오코딩 |
| `reverse-geocode.yml` | 좌표 → 주소 역지오코딩 |

---

## GitHub Secrets

| 시크릿 | 용도 | 필수 |
|--------|------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL | O |
| `SUPABASE_SERVICE_KEY` | service_role 키 (쓰기) | O |
| `SUPABASE_ANON_KEY` | 공개 키 (E2E CI용) | O |
| `MOLIT_KEY` | 국토부 + 주택인허가 + 공동주택 (data.go.kr) | O |
| `MOIS_POP_KEY` | 행안부 인구/전입전출 (data.go.kr) | O |
| `KAKAO_KEY` | Kakao REST API (인프라/역지오코딩) | O |
| `DART_KEY` | DART 전자공시 (시공사 재무) | O |
| `KOSIS_KEY` | KOSIS 국가통계포털 (미분양) | O |
| `TAGO_KEY` | TAGO 대중교통 (data.go.kr) | O |
| `NEIS_KEY` | NEIS 교육정보 (선택, 미등록 시 스킵) | - |
| `SCHOOLINFO_KEY` | 학교알리미 학생수 (선택) | - |
| `AIRKOREA_KEY` | 에어코리아 대기질 (선택) | - |
