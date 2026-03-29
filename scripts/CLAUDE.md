# 데이터 수집 스크립트 규칙

> `scripts/` 및 수집기 수정 시 반드시 이 규칙을 따를 것.

## units 보정 파이프라인

`apartments.unit_source` 필드로 세대수 출처 추적:

- `"applyhome"` — 청약홈 API (기본, 부정확할 수 있음)
- `"molit"` — 국토부 공동주택 기본정보 API (1차 보정, 매월)
- `"naver"` — 네이버 부동산 totalHouseholdCount (2차 보정, 매일)

보정 대상: `units <= 1` 또는 `unsold_rate >= 100%`인 단지.
보정 시 `unsold_rate`도 재계산: `ROUND(unsold / new_units * 100, 1)`.

## 네이버 부동산 수집 — 로컬 자동화

**네이버 수집은 한국 IP가 필요. Windows 작업 스케줄러로 로컬 PC에서 자동 실행.**

| 구분               | 방식             | 설명                                                 |
| ------------------ | ---------------- | ---------------------------------------------------- |
| 네이버 수집 (자동) | Windows 스케줄러 | `scripts/run-naver-local.bat` — 주 2회 (월/목 08:00) |
| 네이버 수집 (수동) | 로컬             | `bash scripts/run-naver-local.sh`                    |
| 후처리(sync+calc)  | GitHub Actions   | `collect-naver-listings.yml` — 매일 자동             |
| 기타 수집기        | GitHub Actions   | 공공 API이므로 IP 제한 없음                          |

**이유**: 네이버 부동산 API는 데이터센터 IP(GitHub Actions)를 차단.

**자동 수집 (Windows 작업 스케줄러)**:

- 작업명: `MibunyangNaverCollect`
- 스케줄: 매주 월/목 오전 8시 (naver-estate-web interval 크롤링과 시간 분리)
- 스크립트: `scripts/run-naver-local.bat`
- 등록/변경: `powershell -ExecutionPolicy Bypass -File scripts/register-naver-task.ps1`
- 수동 트리거: `schtasks /run /tn MibunyangNaverCollect`

**수동 실행**: `bash scripts/run-naver-local.sh`

## 네이버 로컬 파이프라인 (6단계)

`run-naver-local.sh` / `run-naver-local.bat` 실행 시 6단계 순차 실행:

| 단계 | 스크립트                 | 역할                                                      | 필수   |
| ---- | ------------------------ | --------------------------------------------------------- | ------ |
| 1/6  | naver-collect.py         | 네이버 매물 수집 (curl_cffi)                              | 필수   |
| 2/6  | sync-naver-complex.mjs   | 22개 네이버 필드 → apartments 동기화                      | 필수   |
| 3/6  | **naver-presale.mjs**    | **분양정보 19필드 수집 (pre.land POST API, JWT 불필요)** | 비필수 |
| 4/6  | naver-units.mjs          | 세대수(units) 2차 보정                                    | 필수   |
| 5/6  | calc-exclusive-ratio.mjs | 전용률 계산                                               | 필수   |
| 6/6  | compute-scores.mjs       | cats_cache 사전 스코어링 갱신                             | 비필수 |

## 네이버 수집 후처리 파이프라인

naver-collect.py 완료 후 자동 실행되는 4단계:

```bash
bash scripts/post-naver-collect.sh
```

| 단계 | 스크립트                 | 역할                                 |
| ---- | ------------------------ | ------------------------------------ |
| 1    | sync-naver-complex.mjs   | 22개 네이버 필드 → apartments 동기화 |
| 2    | naver-units.mjs          | 세대수(units) 2차 보정               |
| 3    | collect-unsold-kosis.mjs | KOSIS 미분양률 비례배분              |
| 4    | compute-scores.mjs       | cats_cache 사전 스코어링 갱신        |

- `watch-and-run.sh` — naver-collect.py 프로세스 종료 감시 → post-naver-collect.sh 자동 실행
- **compute-scores.mjs**는 `@/` 경로 별칭 사용 → 반드시 `node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs`로 실행

## data.go.kr API 쿼터 분배 (실측 기반, mibunyang + naver-estate-web 공유)

일일 한도: 10,000회 (MOLIT_KEY 공유). mibunyang은 GitHub Actions(US IP), naver-estate-web은 집 서버(KR IP).

| 일자          | 워크플로우                               | 추정 호출수 | 비고                  |
| ------------- | ---------------------------------------- | ----------- | --------------------- |
| 매월 1일      | collect-unsold-kosis                     | ~1회        | KOSIS 단일 호출       |
| 매월 5일      | collect-population, collect-market-stats | ~100회      |                       |
| 매월 6일      | collect-trades                           | 1,500~3,500 | 지역쌍 × 6개월 × 3종  |
| 매월 6일      | collect-molit-units                      | 50~300      | 보정 대상만           |
| **매월 10일** | **collect-building-info**                | **~8,500**  | **가장 큰 수집**      |
| 매월 10일     | collect-housing-permits                  | ~100        |                       |
| **토요일**    | naver-estate-web public_data             | ~3,600      | MAX_DAILY_CALLS=9,000 |

**⚠️ 위험일: 매월 10일이 토요일인 경우** — building-info(8,500) + public_data(3,600) = 12,100 > 10,000 (연 1~2회 발생)

- **자동 방지**: collect-building-info.yml에 토요일 감지 → 11일 fallback 로직 적용 (Phase 2, 2026-03-29)

### API 쿼터 로깅 (api_quota_log)

모든 data.go.kr 수집기(9개)는 완료 시 `recordApiQuota(collector, apiName, callCount)`를 호출하여 `api_quota_log` 테이블에 기록.

대상 수집기: molit-building-info, collect-trades, housing-permits, molit-units, population, migration, collect-maintenance, collect-building-hub, transport-tago

- 일별 합계 조회: `SELECT * FROM api_quota_daily WHERE log_date = CURRENT_DATE;`
- dry-run 모드에서는 기록하지 않음
- 로깅 실패 시 수집은 중단되지 않음 (try-catch 격리)

## 네이버 크롤링 시간 분리 (같은 IP)

| 시간(KST)         | 프로젝트         | 작업                          | 실행일             |
| ----------------- | ---------------- | ----------------------------- | ------------------ |
| 03:00             | naver-estate-web | discover_regions              | 일요일만           |
| 08:00             | mibunyang        | 로컬 naver-collect.py (6단계) | 월/목              |
| 매12시간          | naver-estate-web | crawl_articles (interval)     | 매일 (시간 불고정) |
| 매4시간           | naver-estate-web | crawl_details (interval)      | 매일 (시간 불고정) |
| 04:00             | naver-estate-web | collect_prices                | 수요일             |
| 10:30/14:30/19:00 | naver-estate-web | popular 크롤링                | 매일               |

## API Rate Limit 정리

| API           | 수집기                           | MIN_INTERVAL        | MAX_RETRIES    | 429 처리                       | 근거                                                 |
| ------------- | -------------------------------- | ------------------- | -------------- | ------------------------------ | ---------------------------------------------------- |
| 네이버 부동산 | naver-collect.py                 | 1초                 | 3회            | JWT 리셋 + 5×(i+1)초 대기      | 비공식 API, 429 빈번                                 |
| 네이버 부동산 | naver-listings.mjs               | 1초                 | 5회            | JWT 리셋 + [3,5,10,15,20]초    | 위와 동일 API                                        |
| 네이버 부동산 | naver-units.mjs                  | 3초                 | 3회            | JWT 리셋 + [5,10,20]초         | 검색 API는 더 민감                                   |
| 네이버 분양   | naver-presale.mjs                | 2초                 | 3회            | [5,10,20]초 대기               | pre.land POST API, JWT 불필요 (2026-03 전환)         |
| data.go.kr    | molit-units, molit-building-info | 0.4초               | 3회            | (i+1)×2초                      | 공공 API 초당 10건 제한                              |
| data.go.kr    | housing-permits                  | fetchWithRetry 사용 | 3회            | 지수 백오프                    | 공공 API                                             |
| data.go.kr    | population, migration            | fetchWithRetry 사용 | 3회            | 지수 백오프                    | 공공 API                                             |
| Kakao Places  | infra-kakao                      | 동시 5개 세마포어   | fetchWithRetry | 지수 백오프                    | Kakao 초당 50건                                      |
| DART          | dart-builders                    | fetchWithRetry 사용 | 3회            | 지수 백오프                    | DART 분당 100건                                      |
| KOSIS         | collect-market-stats             | 1초 (지표 간)       | node:https     | 타임아웃 30초                  | HUG orgId=414, TLS 호환                              |
| data.go.kr    | collect-maintenance              | 0.4초               | 3회            | (i+1)×2초                      | 관리비 5항목×단지, kaptCode 매칭                     |
| (로컬 계산)   | calc-school-walk                 | —                   | —              | —                              | schools.nearby_schools → 초등 도보 시간              |
| odcloud.kr    | collect-applyhome                | —                   | —              | —                              | 청약홈 잔여세대 경쟁률 (주간)                        |
| data.go.kr    | collect-building-hub             | 0.4초               | 3회            | (i+1)×2초                      | 건축HUB 에너지+인허가 2엔드포인트(전기+가스), 월 1회 |
| \_shared.mjs  | fetchWithRetry (공통)            | —                   | 기본 3회       | Retry-After 헤더 → 지수 백오프 | 429/500/503 구분                                     |

## BldEngyHubService 한계 (2026-03-29 진단)

`collect-building-hub.mjs`의 에너지 수집(전기/가스)은 **대형 공공/상업 건물만 대상**.
주거용 아파트는 BldEngyHubService에 데이터가 없음 (KEPCO/가스공사 관할).

| 테스트 대상                 | 결과             | 비고     |
| --------------------------- | ---------------- | -------- |
| 서울시청 (종로구 청운동 1)  | ✅ 90,064 kWh    | 공공건물 |
| 코엑스 (삼성동 159)         | ✅ 9,528,662 kWh | 상업건물 |
| 은마아파트 (대치동 62)      | ❌ 0건           | 주거용   |
| 래미안 원베일리 (서초동 91) | ❌ 0건           | 주거용   |

- bjd_code 보유: 1480/1481 (99.9%), 모두 10자리 정상
- lot_main 유효: 1457건 (98.4%)
- API 키 등록 정상 (NORMAL SERVICE)
- **현 수집기는 소수 비주거 건물만 매칭** — 주거 에너지 kWh/MJ 데이터는 공개 API 불가

### 주거용 에너지 데이터 조사 결론 (2026-03-29)

단지별 에너지 사용량(kWh/MJ)은 공개 API로 접근 불가:
- **KEPCO**: 시군구 단위 집계만 (개인정보 이슈로 단지별 미제공)
- **한국가스공사**: 시군구 단위만
- **BEMS(건물에너지정보)**: 500세대+ 의무보고이나 API 미제공 (스크래핑 필요, 법적 리스크)
- **K-apt 관리비**: `collect-maintenance.mjs`가 이미 난방비/가스료/전기료(원) 수집 중 → 에너지 "비용" 비교 가능
- **결론**: 현재 K-apt 관리비 데이터가 최선. 추가 조치 불필요.
