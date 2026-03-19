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

## API Rate Limit 정리

| API | 수집기 | MIN_INTERVAL | MAX_RETRIES | 429 처리 | 근거 |
|-----|--------|-------------|------------|---------|------|
| 네이버 부동산 | naver-collect.py | 1초 | 3회 | JWT 리셋 + 5×(i+1)초 대기 | 비공식 API, 429 빈번 |
| 네이버 부동산 | naver-listings.mjs | 1초 | 5회 | JWT 리셋 + [3,5,10,15,20]초 | 위와 동일 API |
| 네이버 부동산 | naver-units.mjs | 3초 | 3회 | JWT 리셋 + [5,10,20]초 | 검색 API는 더 민감 |
| data.go.kr | molit-units, molit-building-info | 0.4초 | 3회 | (i+1)×2초 | 공공 API 초당 10건 제한 |
| data.go.kr | housing-permits | fetchWithRetry 사용 | 3회 | 지수 백오프 | 공공 API |
| data.go.kr | population, migration | fetchWithRetry 사용 | 3회 | 지수 백오프 | 공공 API |
| Kakao Places | infra-kakao | 동시 5개 세마포어 | fetchWithRetry | 지수 백오프 | Kakao 초당 50건 |
| DART | dart-builders | fetchWithRetry 사용 | 3회 | 지수 백오프 | DART 분당 100건 |
| _shared.mjs | fetchWithRetry (공통) | — | 기본 3회 | Retry-After 헤더 → 지수 백오프 | 429/500/503 구분 |
