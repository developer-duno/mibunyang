---
paths:
  - "scripts/collectors/_molit-api.mjs"
  - "scripts/collectors/_shared.mjs"
  - "scripts/collectors/naver-*.mjs"
  - "scripts/collectors/naver-collect.py"
  - "scripts/collectors/molit-*.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## data.go.kr API 쿼터 분배

일일 한도: 10,000회 (MOLIT_KEY, mibunyang + naver-estate-web 공유).

> ⚠️ 아래 "실행 주체" 열은 세션 515 에 바뀌었다 — 국토부(1613000) 의존 5종은 GH 워크플로가 아니라
> **집서버 로컬 러너**(`kosis-local-runner.mjs`)가 돌린다. 발화일은 그대로라 쿼터 계산은 불변이다.

| 일자 | 실행 주체 | 추정 호출 |
|------|-----------|----------|
| 매월 9일 | collect-unsold-kosis (로컬 러너 — `kosis-local-runner.mjs` DAY_TABLE `day: 9`, 세션567 정정: 옛 표기 "1일") | ~1 |
| 매월 5일 | population + population-sex-age (로컬 러너, 세션550 이전), market-stats(로컬 러너 6일) | ~100 |
| 매월 6일 | collect-trades (로컬 러너) | 1,500~3,500 (세션92: 지방 8개 region 확장 시 +500~1,500) |
| 매월 6일 + 월/목 08:00 후 | molit-units (로컬 러너 + 네이버 파이프라인) | 50~300 (+post-naver-collect 시 추가) |
| **매월 10일** | **building-info (로컬 러너)** | **~8,500** |
| 매월 11일 | housing-permits (로컬 러너, KOSIS) | ~100 |
| 매월 15~19일 | maintenance (로컬 러너, `--limit=600`) | ~3,600/회차 |
| **토요일** | naver-estate-web public_data | ~3,600 |

**위험일**:
- 매월 10일이 토요일 → 12,100 > 10,000. 로컬 러너 매핑표의 `skipIfDow: 6`(10일) + `onlyIfPrevDayDow: 6`(11일)로 fallback 구현됨(옛 collect-building-info.yml 의 셸 분기를 이식).
- 매월 10일이 월/목 → building-info 8,500 + post-naver-collect molit-units 300 = ~8,800~9,100(한도의 88~91%). 여유 900~1,200회. 모니터링 필요(세션89).
- **매월 6일 (세션92 이후)**: 지방 8개 region(강원/충북/충남/전북/전남/경북/경남/제주) 확장으로 collect-trades 최대 ~5,000회 가능. 여전히 10일보다 여유 있음 — 단 dry-run 실측 후 9,000 초과 시 `kosis-local-runner.mjs` DAY_TABLE 2분할 고려(metro 6일 / rural 20일).

### 쿼터 로깅

9개 수집기 완료 시 `recordApiQuota(collector, apiName, callCount)` → `api_quota_log` 테이블.
조회: `SELECT * FROM api_quota_daily WHERE log_date = CURRENT_DATE;`


---

## API Rate Limit 정리

| API | 수집기 | 간격 | 재시도 | 429 처리 |
|-----|--------|------|--------|---------|
| 네이버 부동산 | naver-collect.py | 5초 (`thr()` 기본값, 세션 118 IP 쿨다운 상향) | 3회 | JWT 리셋 + 5*(i+1)초 |
| 네이버 부동산 | naver-listings.mjs | 5초 | 5회 | JWT 리셋 + [10,20,40,60,120]초 |
| 네이버 분양 | naver-presale.mjs | 2초 | 3회 | [5,10,20]초 |
| 네이버 개발계획 | naver-devplan.mjs | 5초 | 3회 (429 전용 [30,60,120]초) | ⚠️ **세션 쿠키 필수**(세션516): 쿠키 없는 요청은 "Rate limit exceeded" 거짓 문구로 **즉답 429** — 진짜 rate limit 아님. `ensureNaverSession()` 이 JWT+쿠키를 한 캐시로 관리 |
| data.go.kr | molit-* | 0.4초 | 3회 (기본) | NonRetryableError / 지수 백오프. ⚠️ collect-maintenance `fetchTotalHouseholds` 는 8s/1회 override(세션 451, 위 MOLIT 모듈 절) |
| Kakao Places | infra-kakao | 세마포어 5개 | fetchWithRetry | 지수 백오프 |
| DART | dart-builders | fetchWithRetry | 3회 | 지수 백오프 |
| Supabase | upsertBatch | 100ms/배치 | 3회 | (attempt+1)^2초 |

> 버스 정류장은 **외부 API 호출이 0** 이라 이 표에 없다 — 아래 절 참조(회차당 파일 1회 다운로드).
