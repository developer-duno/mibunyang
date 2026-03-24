# GitHub Actions 워크플로우 규칙

> 워크플로우 수정/추가 시 반드시 이 규칙을 따를 것.

## 워크플로우 목록

### 매일
| 워크플로우 | 설명 |
|-----------|------|
| `collect-naver-listings.yml` | 네이버 후처리 (sync + 전용률 계산) |
| `naver-units.yml` | 네이버 세대수 2차 보정 |
| `daily-deploy.yml` | Vercel 자동 배포 (KST 03:00) |

### CI/CD
| 워크플로우 | 설명 |
|-----------|------|
| `ci.yml` | CI 파이프라인 (린트 + 테스트 + 빌드, push/PR 트리거) |

### 매주
| 워크플로우 | 설명 |
|-----------|------|
| `collect-trade-stats.yml` | 거래 통계 산출 (일요일) |
| `calc-exclusive-ratio.yml` | 전용률 계산 (일요일) |
| `calc-layout.yml` | 평면구조 추정 (일요일) |

### 매월
| 워크플로우 | 설명 |
|-----------|------|
| `collect-trades.yml` | 국토부 실거래 수집 (6일 — 5일 갱신 후) |
| `collect-molit-units.yml` | 국토부 공동주택 총세대수 보정 (6일) |
| `collect-population.yml` | 행안부 인구 증감률 (5일) |
| `collect-housing-permits.yml` | 국토부 주택 인허가 공급비율 (10일) |
| `collect-building-info.yml` | 국토부 건축물 상세정보 (10일) |
| `collect-migration.yml` | 행안부 전입/전출 순이동 (15일) |
| `collect-infra.yml` | Kakao Places 인프라 (1일) |
| `collect-transport.yml` | Kakao Places 교통 (1일) |
| `collect-schools.yml` | NEIS 학교 (1일) |
| `collect-dart-builders.yml` | DART 시공사 재무 (분기별: 1,4,7,10월 15일) |
| `collect-noise.yml` | 소음 추정 (1일) |
| `collect-environment.yml` | 환경/혐오시설 (1일) |
| `collect-noxious.yml` | 혐오시설 거리 (1일) |
| `collect-industry.yml` | 산업단지 매칭 (1일) |
| `collect-unsold-kosis.yml` | KOSIS 시군구별 미분양 (1일) |
| `collect-market-stats.yml` | KOSIS HUG 시장통계 5개 지표 (5일) |

### 유틸리티
| 워크플로우 | 설명 |
|-----------|------|
| `apply-migration.yml` | Supabase 마이그레이션 적용 |
| `seed-data.yml` | 초기 데이터 시딩 |
| `fill-missing-data.yml` | 빈 데이터 일괄 수집 (16개 수집기 순차 실행) |
| `geocode-missing.yml` | 좌표 누락 단지 지오코딩 |
| `reverse-geocode.yml` | 좌표 → 주소 역지오코딩 |

### 로컬 전용 (네이버)
| 스크립트 | 설명 |
|---------|------|
| `scripts/run-naver-local.bat` | Windows 스케줄러 자동 실행 (주 2회 월/목 06:00) |
| `scripts/run-naver-local.sh` | 수동 실행용 (bash) |
| `scripts/collectors/naver-collect.py` | Python 수집 로직 (curl_cffi) |

## GitHub Secrets

| 시크릿 | 용도 |
|--------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_KEY` | Supabase service_role 키 (쓰기용) |
| `MOIS_POP_KEY` | 행안부 주민등록 인구/전입전출 API 키 (data.go.kr) |
| `MOLIT_KEY` | 국토부 실거래 + 주택인허가 + 공동주택 기본정보 API 키 (data.go.kr) |
| `KAKAO_KEY` | Kakao REST API 키 (혐오시설/환경/소음 수집 + 역지오코딩) |
| `DART_KEY` | DART 전자공시 API 키 (시공사 재무 수집) |
| `KOSIS_KEY` | KOSIS 국가통계포털 API 키 (미분양 수집) |
