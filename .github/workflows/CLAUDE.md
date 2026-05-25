# GitHub Actions 워크플로우 규칙

> 워크플로우 수정/추가 시 반드시 이 규칙을 따를 것.

## 워크플로우 목록

### 매일 (3개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-naver-listings.yml` | 네이버 후처리 (sync + 전용률 계산) |
| `daily-deploy.yml` | Vercel 자동 배포 (KST 03:00) |
| `collect-childcare-detail.yml` | 어린이집 cpmsapi030 70 필드 상세 (KST 04:00, DAILY_LIMIT 분산 ~23일 누적) |

### CI/CD (2개)

| 워크플로우 | 설명 |
|-----------|------|
| `ci.yml` | CI 파이프라인 (린트 + 테스트 + 빌드, push/PR 트리거) |
| `e2e.yml` | Playwright E2E 테스트 (push/PR 트리거) |

### 매주 (3개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-trade-stats.yml` | 거래 통계 산출 (일요일 16:00 UTC) |
| `calc-exclusive-ratio.yml` | 전용률 계산 (일요일 22:00 UTC, 세션273: calc-collection 그룹 분리 — data-collection 큐 경합 회피) |
| `calc-layout.yml` | 평면구조 추정 (일요일 23:00 UTC, 세션273: calc-collection 그룹 분리) |

### 매월 (25개)

| 워크플로우 | 일자 | 설명 |
|-----------|------|------|
| `collect-unsold-kosis.yml` | 8일 | KOSIS 시군구별 미분양 (세션260: 1일→8일 분산) |
| `collect-infra.yml` | 1일 | Kakao Places 인프라 |
| `collect-transport.yml` | 4일 | Kakao Places 교통 (세션260: 1일→4일 분산) |
| `collect-schools.yml` | 2일 | NEIS 학교 (세션118: 1일→2일 이동 + school-collection 그룹 분리) |
| `collect-noise.yml` | 1일 | 소음 추정 |
| `collect-environment.yml` | 1일 | 환경/혐오시설 |
| `collect-noxious.yml` | 3일 | 혐오시설 거리 (세션260: 1일→3일 분산, 60분 장시간 작업) |
| `collect-industry.yml` | 7일 | 산업단지 매칭 (세션260: 1일→7일 분산) |
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
| `collect-jeonse-price-index.yml` | 17일 | KOSIS 전세가격지수 (DT_30404_B013, 시군구 월간) |
| `collect-regional-economy.yml` | 11일 | KOSIS 시도 경제·교육 지표 (GRDP/사교육비/사교육참여율/실업률) |

### 모니터링 (2개)

| 워크플로우 | 설명 |
|-----------|------|
| `monitor-db-size.yml` | Supabase 테이블별 행 수 점검 (매월 1일 KST 06:00) |
| `monitor-collectors.yml` | 수집기 실패/취소/0건/미발화/NULL급증 텔레그램 알림 (workflow_run 즉시 + 매일 KST 09:00 스윕). 새 collect-*.yml 추가 시 workflow_run.workflows 목록에 name 추가 의무 — `scripts/audit-monitor-coverage.mjs` 가 CI 에서 누락 차단 |

### 유틸리티 (4개)

| 워크플로우 | 설명 |
|-----------|------|
| `seed-data.yml` | 초기 데이터 시딩 |
| `fill-missing-data.yml` | **Phase 1+2 만 잔존** — Phase 1 좌표 backfill (geocode-missing+reverse-geocode) + Phase 2 matrix 3 일꾼 (sync-naver-complex+calc-floors+regulation-seed). **세션 308 (PR #11)**: Phase 3+4+5 일괄 폐기 — 외부 cron 가진 11 일꾼 (transport-tago/infra-kakao/environment/noise-estimate/noxious/dart-builders/molit-building-info/population/migration/collect-trades/trade-stats) 제외 + `audit-fill-matrix.mjs` CI 가드 신규. 5/31 발화 6번째 누적 cancelled 차단. 직전: 세션 273 calc 그룹 분리, 세션 291 phase2-calc 6→3, 세션 298 phase3 timeout 60→120, 세션 306 schools-neis 제거 |
| `geocode-missing.yml` | 좌표 누락 지오코딩 |
| `reverse-geocode.yml` | 좌표 → 주소 역지오코딩 |

> 세션 248: `apply-migration.yml` 폐기 (실제 SQL 실행 0건 사고). DDL 적용 = 사용자 Dashboard SQL Editor 직접 실행 표준 (supabase/CLAUDE.md "Dashboard SQL Editor 수동 실행" 절 참조).

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
| `CHILDCARE_API_KEY` | info.childcare.go.kr cpmsapi021 어린이집 목록 (세션 252) | O |
| `CHILDCARE_BASIC_API_KEY` | info.childcare.go.kr cpmsapi030 어린이집 70 필드 상세 (세션 256) | O |
