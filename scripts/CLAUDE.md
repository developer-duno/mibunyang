# 데이터 수집 스크립트 규칙

> `scripts/` 수정 시 반드시 이 규칙을 따를 것.

## units 보정 파이프라인

`apartments.unit_source` 필드로 세대수 출처 추적:

| 출처 | 값 | 보정 | 주기 |
|------|-----|------|------|
| 청약홈 API | `"applyhome"` | 기본 (부정확할 수 있음) | 주간 |
| 국토부 공동주택 API | `"molit"` | 1차 보정 | 매월 |
| 네이버 부동산 | `"naver"` | 2차 보정 | 매일 |

보정 대상: `units <= 1` 또는 `unsold_rate >= 100%`인 단지.
보정 시 `unsold_rate` 재계산: `ROUND(unsold / new_units * 100, 1)`.

---

## MOLIT 수집기 모듈

| 파일 | 역할 | isCLI |
|------|------|-------|
| `_molit-api.mjs` | 공유 모듈 (API 호출, 매칭, 페이지네이션, NonRetryableError) | - |
| `molit-building-info.mjs` | 건물 상세 (주차/층수/에너지/난방/복도) | O |
| `molit-units.mjs` | 세대수 보정 (units, unsold_rate) | O |
| `collect-maintenance.mjs` | 관리비 수집 (5항목 합산) | O |

- **isCLI 패턴**: `process.argv[1] && import.meta.url.endsWith(...)` — 34개 파일 (테스트 시 main() 방지)
- **NonRetryableError**: 4xx/XML 에러 즉시 throw, 429/500/503만 재시도

### 공유 모듈 (_shared.mjs)

- REGION_MAP: 약칭17 + 정식명20 = 37개
- REGION_LAWD_PREFIX + GU_LAWD_MAP + getLawdCd(): 법정동코드 매핑
- fetchWithRetry: Retry-After 헤더 + 지수 백오프 (429/500/503)
- upsertBatch: 배치 100ms + 429 재시도 (attempt+1)^2초
- recordApiQuota: api_quota_log 기록

### Exit Code 정책

- createReporter 사용 (9개): `rpt.summary().fail > 0` → exit(1)
- 수동 카운터 (5개): `failed > 0` → exit(1)
- recordApiQuota 완료 후 exit 호출 (쿼터 기록 보장)

---

## 네이버 수집 — 로컬 자동화

**네이버 API는 데이터센터 IP를 차단 → 한국 IP 로컬 PC에서만 실행.**

| 구분 | 방식 | 실행 |
|------|------|------|
| 자동 수집 | Windows 스케줄러 `run-naver-local.bat` | 월/목 08:00 |
| 수동 수집 | `bash scripts/run-naver-local.sh` | 필요시 |
| 후처리 | GitHub Actions `collect-naver-listings.yml` | 매일 |

등록/변경: `powershell -ExecutionPolicy Bypass -File scripts/register-naver-task.ps1`

### 로컬 파이프라인 (6단계)

| 단계 | 스크립트 | 역할 | 필수 |
|------|---------|------|------|
| 1/6 | naver-collect.py | 네이버 매물 수집 (curl_cffi) | O |
| 2/6 | sync-naver-complex.mjs | 22개 필드 → apartments 동기화 | O |
| 3/6 | naver-presale.mjs | 분양정보 19필드 수집 | - |
| 4/6 | naver-units.mjs | 세대수 2차 보정 | O |
| 5/6 | calc-exclusive-ratio.mjs | 전용률 계산 | O |
| 6/6 | compute-scores.mjs | cats_cache 스코어링 갱신 | - |

**주의**: compute-scores.mjs는 `node --loader ./scripts/alias-loader.mjs` 필요 (`@/` 별칭)

### 후처리 파이프라인 (post-naver-collect.sh)

| 단계 | 스크립트 | 역할 |
|------|---------|------|
| 1 | sync-naver-complex.mjs | 22개 필드 동기화 |
| 2 | naver-units.mjs | 세대수 보정 |
| 3 | collect-unsold-kosis.mjs | KOSIS 미분양률 비례배분 |
| 4 | compute-scores.mjs | cats_cache 갱신 |

---

## data.go.kr API 쿼터 분배

일일 한도: 10,000회 (MOLIT_KEY, mibunyang + naver-estate-web 공유).

| 일자 | 워크플로우 | 추정 호출 |
|------|-----------|----------|
| 매월 1일 | collect-unsold-kosis | ~1 |
| 매월 5일 | population, market-stats | ~100 |
| 매월 6일 | collect-trades | 1,500~3,500 |
| 매월 6일 | molit-units | 50~300 |
| **매월 10일** | **building-info** | **~8,500** |
| 매월 10일 | housing-permits | ~100 |
| **토요일** | naver-estate-web public_data | ~3,600 |

**위험일**: 매월 10일이 토요일 → 12,100 > 10,000. collect-building-info.yml에 토요일 → 11일 fallback 구현됨.

### 쿼터 로깅

9개 수집기 완료 시 `recordApiQuota(collector, apiName, callCount)` → `api_quota_log` 테이블.
조회: `SELECT * FROM api_quota_daily WHERE log_date = CURRENT_DATE;`

---

## 네이버 크롤링 시간 분리 (동일 IP)

| 시간(KST) | 프로젝트 | 작업 | 실행일 |
|-----------|---------|------|--------|
| 03:00 | naver-estate-web | discover_regions | 일요일 |
| 08:00 | mibunyang | naver-collect.py (6단계) | 월/목 |
| 매12시간 | naver-estate-web | crawl_articles | 매일 |
| 매4시간 | naver-estate-web | crawl_details | 매일 |
| 04:00 | naver-estate-web | collect_prices | 수요일 |

---

## API Rate Limit 정리

| API | 수집기 | 간격 | 재시도 | 429 처리 |
|-----|--------|------|--------|---------|
| 네이버 부동산 | naver-collect.py | 1초 | 3회 | JWT 리셋 + 5*(i+1)초 |
| 네이버 부동산 | naver-listings.mjs | 1초 | 5회 | JWT 리셋 + [3,5,10,15,20]초 |
| 네이버 부동산 | naver-units.mjs | 3초 | 3회 | JWT 리셋 + [5,10,20]초 |
| 네이버 분양 | naver-presale.mjs | 2초 | 3회 | [5,10,20]초 |
| data.go.kr | molit-* | 0.4초 | 3회 | NonRetryableError / 지수 백오프 |
| Kakao Places | infra-kakao | 세마포어 5개 | fetchWithRetry | 지수 백오프 |
| DART | dart-builders | fetchWithRetry | 3회 | 지수 백오프 |
| Supabase | upsertBatch | 100ms/배치 | 3회 | (attempt+1)^2초 |

---

## BldEngyHubService 한계

`collect-building-hub.mjs`의 에너지 수집(전기/가스)은 **공공/상업 건물만 대상**.
주거용 아파트는 BldEngyHubService에 데이터 없음 (KEPCO/가스공사 관할).

현재 K-apt 관리비 데이터(`collect-maintenance.mjs`)가 에너지 비용 비교의 최선.

---

## 테스트 현황 (수집기)

| 파일 | 테스트 수 |
|------|----------|
| _molit-api.test.mjs | 30 |
| molit-building-info.test.mjs | 28 |
| schools-neis.test.mjs | 71 |
| naver-listings.test.mjs | 46 |
| sync-naver-complex.test.mjs | 25 |
| trade-stats.test.mjs | 22 |
| collect-building-hub.test.mjs | 22 |
| transport-tago.test.mjs | 22 |
| collect-unsold-kosis.test.mjs | 18 |
| geocode-missing.test.mjs | 17 |
| molit-units.test.mjs | 15 |
| collect-maintenance.test.mjs | 18 |
| dart-builders.test.mjs | 13 |
| migration.test.mjs | 12 |
| calc-school-walk.test.mjs | 11 |
| reverse-geocode.test.mjs | 10 |
| regulation-seed.test.mjs | 9 |
| collect-applyhome.test.mjs | 8 |
| naver-units.test.mjs | 8 |
| collect-market-stats.test.mjs | 7 |
| housing-permits.test.mjs | 6 |
| infra-kakao.test.mjs | 5 |
| transit-match.test.mjs | 4 |
| industry-match.test.mjs | 3 |
