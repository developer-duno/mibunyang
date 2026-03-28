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

| 구분 | 방식 | 설명 |
|------|------|------|
| 네이버 수집 (자동) | Windows 스케줄러 | `scripts/run-naver-local.bat` — 주 2회 (월/목 06:00) |
| 네이버 수집 (수동) | 로컬 | `bash scripts/run-naver-local.sh` |
| 후처리(sync+calc) | GitHub Actions | `collect-naver-listings.yml` — 매일 자동 |
| 기타 수집기 | GitHub Actions | 공공 API이므로 IP 제한 없음 |

**이유**: 네이버 부동산 API는 데이터센터 IP(GitHub Actions)를 차단.

**자동 수집 (Windows 작업 스케줄러)**:
- 작업명: `MibunyangNaverCollect`
- 스케줄: 매주 월/목 오전 6시
- 스크립트: `scripts/run-naver-local.bat`
- 등록/변경: `powershell -ExecutionPolicy Bypass -File scripts/register-naver-task.ps1`
- 수동 트리거: `schtasks /run /tn MibunyangNaverCollect`

**수동 실행**: `bash scripts/run-naver-local.sh`

## 네이버 로컬 파이프라인 (6단계)

`run-naver-local.sh` / `run-naver-local.bat` 실행 시 6단계 순차 실행:

| 단계 | 스크립트 | 역할 | 필수 |
|------|---------|------|------|
| 1/6 | naver-collect.py | 네이버 매물 수집 (curl_cffi) | 필수 |
| 2/6 | sync-naver-complex.mjs | 22개 네이버 필드 → apartments 동기화 | 필수 |
| 3/6 | **naver-presale.mjs** | **분양정보 19필드 수집 (pre.land.naver.com, isCLI 패턴)** | 비필수 |
| 4/6 | naver-units.mjs | 세대수(units) 2차 보정 | 필수 |
| 5/6 | calc-exclusive-ratio.mjs | 전용률 계산 | 필수 |
| 6/6 | compute-scores.mjs | cats_cache 사전 스코어링 갱신 | 비필수 |

## 네이버 수집 후처리 파이프라인

naver-collect.py 완료 후 자동 실행되는 4단계:

```bash
bash scripts/post-naver-collect.sh
```

| 단계 | 스크립트 | 역할 |
|------|---------|------|
| 1 | sync-naver-complex.mjs | 22개 네이버 필드 → apartments 동기화 |
| 2 | naver-units.mjs | 세대수(units) 2차 보정 |
| 3 | collect-unsold-kosis.mjs | KOSIS 미분양률 비례배분 |
| 4 | compute-scores.mjs | cats_cache 사전 스코어링 갱신 |

- `watch-and-run.sh` — naver-collect.py 프로세스 종료 감시 → post-naver-collect.sh 자동 실행
- **compute-scores.mjs**는 `@/` 경로 별칭 사용 → 반드시 `node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs`로 실행

## API Rate Limit 정리

| API | 수집기 | MIN_INTERVAL | MAX_RETRIES | 429 처리 | 근거 |
|-----|--------|-------------|------------|---------|------|
| 네이버 부동산 | naver-collect.py | 1초 | 3회 | JWT 리셋 + 5×(i+1)초 대기 | 비공식 API, 429 빈번 |
| 네이버 부동산 | naver-listings.mjs | 1초 | 5회 | JWT 리셋 + [3,5,10,15,20]초 | 위와 동일 API |
| 네이버 부동산 | naver-units.mjs | 3초 | 3회 | JWT 리셋 + [5,10,20]초 | 검색 API는 더 민감 |
| 네이버 분양 | naver-presale.mjs | 2초 | 3회 | JWT 리셋 + [5,10,20]초 | pre.land.naver.com, 한국 IP 필수 |
| data.go.kr | molit-units, molit-building-info | 0.4초 | 3회 | (i+1)×2초 | 공공 API 초당 10건 제한 |
| data.go.kr | housing-permits | fetchWithRetry 사용 | 3회 | 지수 백오프 | 공공 API |
| data.go.kr | population, migration | fetchWithRetry 사용 | 3회 | 지수 백오프 | 공공 API |
| Kakao Places | infra-kakao | 동시 5개 세마포어 | fetchWithRetry | 지수 백오프 | Kakao 초당 50건 |
| DART | dart-builders | fetchWithRetry 사용 | 3회 | 지수 백오프 | DART 분당 100건 |
| KOSIS | collect-market-stats | 1초 (지표 간) | node:https | 타임아웃 30초 | HUG orgId=414, TLS 호환 |
| data.go.kr | collect-maintenance | 0.4초 | 3회 | (i+1)×2초 | 관리비 5항목×단지, kaptCode 매칭 |
| (로컬 계산) | calc-school-walk | — | — | — | schools.nearby_schools → 초등 도보 시간 |
| odcloud.kr | collect-applyhome | — | — | — | 청약홈 잔여세대 경쟁률 (주간) |
| data.go.kr | collect-building-hub | 0.4초 | 3회 | (i+1)×2초 | 건축HUB 에너지+인허가 4엔드포인트, 월 1회 |
| _shared.mjs | fetchWithRetry (공통) | — | 기본 3회 | Retry-After 헤더 → 지수 백오프 | 429/500/503 구분 |
