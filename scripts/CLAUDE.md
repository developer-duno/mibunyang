# 데이터 수집 스크립트 규칙

> `scripts/` 수정 시 반드시 이 규칙을 따를 것.

## units 보정 파이프라인

`apartments.unit_source` 필드로 세대수 출처 추적:

| 출처 | 값 | 보정 | 주기 | 상태 |
|------|-----|------|------|------|
| 청약홈 API | `"applyhome"` | 기본 (부정확할 수 있음) | 주간 | 활성 |
| 국토부 공동주택 API | `"molit"` | 1차 + 2차 보정 | 매월 + post-naver-collect 시 | 활성 |
| 네이버 부동산 | `"naver"` | (옛 2차 보정) | - | **폐기(세션89 IP 차단 → 세션233 파일 영구 삭제)** |

세션89부터 naver-units가 집 서버 IP Rate Limit으로 연속 실패 → `post-naver-collect.sh` 2/4 단계를 molit-units로 교체. **세션233에서 `naver-units.mjs/.test.mjs/.yml` 3 파일 영구 삭제** (1년+ 미사용 + 사용자 cmd 수동 실행 사고 차단). 복구 의무 시 git history `346446a` 이전 커밋 참조.

보정 대상: `units <= 1` 또는 `unsold_rate >= 100%`인 단지.
보정 시 `unsold_rate` 재계산: `ROUND(unsold / new_units * 100, 1)`.

**세대수 필드 = kaptdaCnt 우선, 0이면 hoCnt(호수) 폴백** (세션 444 `resolveUnits()`): 국토부
`getAphusBassInfoV4` 응답에서 `kaptdaCnt`(공동주택 세대수)를 우선 쓰되, 임의공급·계약취소·블록
단위 등 특수 물량은 `kaptdaCnt=0` 으로 응답하므로 `hoCnt`(호수)로 폴백한다. `kaptdaCnt>1` 인
정상 단지는 둘이 동일(실측 4/4)이라 폴백이 회귀를 만들지 않는다. 폴백 없으면 청약홈 "이번 회차
잔여공급분"(units=4·11 등 소량)이 분모로 남아 `unsold/units` 가 818%·7100% 로 폭발(사장님 지적).
단, **이름 매칭 실패분**(원주혁신도시·세종 블록 등 ~46건)은 hoCnt 폴백으로도 못 풀어 화면측
`fmtUnsoldRate`(100% 초과 → "100%+" 캡, 손님 화면 AptCard·DetailModal)로 방어. 관리자
AdminUnitSupply 는 raw 진단값 유지.

**세션 445 — 100% 초과 무력화(null) + 점수 배선**: 화면 캡(`fmtUnsoldRate`)은 문자열만 고쳐
점수·중위값·정렬은 폭발값을 그대로 썼다(7% 저미분양 단지가 최고 위험으로 오채점). 회차 통합은
데이터상 대부분 불가(52건 중 37건 진짜 세대수 신호 0, dedup 정규화가 같은 단지를 분리)라
**왜곡 무력화**로 처방: `_shared.mjs clampUnsoldRate(rate)`(>100 → null, 100 이하 유지)를 단일
경계로 4 emit point 통일 — `collect-data.mjs`(정적 JSON emit 2곳)·`api/supabase/apartments.ts`
(라이브 API)·VIEW 마이그(`20260627000000`, `CASE WHEN unsold_rate>100 THEN NULL`)·화면 캡.
점수는 `engine.ts` sanitize 가 unsoldRate null 을 지역 중위값으로 되채우지 않고(`num(apt.unsoldRate,
null)`) `scoreRisk` 가 `units≤1 || unsoldRate==null → UNSOLD_UNKNOWN_SCORE`(중립) 처리.
**미분양 단지 여부 판정**(classify 미입주·hideNoUnsold 필터·AptCard moveInDone)은 unsoldRate(%)가
아니라 **`unsold`(수)** 로 — 클램프 null 단지가 목록서 사라지거나 입주완료로 둔갑하던 회귀 방지.
**⚠️ production 점수는 cats_cache precompute → VIEW 마이그 적용 후 daily-deploy 의
`compute-scores → collect-data --from-supabase-only` 1회 실행으로 자동 정합**(별 절차 불필요).

---

## MOLIT 수집기 모듈

| 파일 | 역할 | isCLI |
|------|------|-------|
| `_molit-api.mjs` | 공유 모듈 (API 호출, 매칭, 페이지네이션, NonRetryableError) | - |
| `molit-building-info.mjs` | 건물 상세 (주차/층수/난방/복도) | O |
| `molit-units.mjs` | 세대수 보정 (units, unsold_rate) | O |
| `collect-maintenance.mjs` | 관리비 수집 (5항목 합산) | O |

- **isCLI 패턴**: `process.argv[1] && import.meta.url.endsWith(...)` — 57개 파일 (테스트 시 main() 방지, 2026-05-31 실측 `grep -lE "const isCLI" scripts/**/*.mjs | grep -v test`)
- **NonRetryableError**: 4xx/XML 에러 즉시 throw, 429/500/503만 재시도

### 공유 모듈 (_shared.mjs)

- REGION_MAP: 약칭17 + 정식명20 = 37개
- REGION_LAWD_PREFIX + GU_LAWD_MAP + getLawdCd(): 법정동코드 매핑
- fetchWithRetry: Retry-After 헤더 + 지수 백오프 (429/500/503)
- upsertBatch: 배치 100ms + 429 재시도 (attempt+1)^2초
- recordApiQuota: api_quota_log 기록
- **today(): KST 고정 YYYY-MM-DD** (세션 419) — `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"})`. ⚠️ GitHub Actions=UTC 러너라 `new Date().toISOString().slice(0,10)` 직접 쓰면 KST 02:00~08:00 발화 시 recorded_at 하루 밀림. **시계열 recorded_at·collected_at 저장은 today() 의무**(직접 toISOString 금지). TZ env 안 씀(코드 고정이 본질 — TZ env는 cron 발화 안 바꿈+월경계 시프트 잠복위험). datetime(시각포함, presale_fetched_at 등)은 timestamptz 컬럼이라 toISOString 유지 OK

### Exit Code 정책

- createReporter 사용 (9개): `rpt.summary().fail > 0` → exit(1)
- 수동 카운터 (5개): `failed > 0` → exit(1)
- recordApiQuota 완료 후 exit 호출 (쿼터 기록 보장)

---

## KOSIS 수집 — 로컬 자동화 (세션 288~289·395)

**kosis.kr 이 해외 클라우드 IP(GitHub 러너)를 차단(2026-06-09~) → 한국 IP 로컬 PC에서만 실행.** GH `collect-*.yml` 10개 삭제됨 (PR #98).

| 구분 | 방식 | 실행 |
|------|------|------|
| 자동 수집 | Windows 스케줄러 `MibunyangKosisLocal` → `kosis-local-runner.bat` | 매일 05:30 KST (일자 디스패치: 2·6·7·9·10·12·13·14·17(분기)·18일) |
| 수동/보충 | `node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD` | 필요시 |
| 매핑표 확인 | `node scripts/kosis-local-runner.mjs --list` | - |

등록/변경: `powershell -ExecutionPolicy Bypass -File scripts/register-kosis-task.ps1`

감시: GH run 이 없으므로 monitor ⑤ `EXTERNAL_API_COLLECTORS` 신선도(월간 38일/분기 100일)가 유일한 미발화 알림. KOSIS 수집기 10종 전부 실패 시 `collector_runs` 에 `status=failure` 행 기록 (PR #97·#99 하드닝 — throw·early-return 전 경로).

---

## childcare 수집 — 로컬 자동화 (세션 399)

**`api.childcare.go.kr`(평문 HTTP)이 해외 클라우드 IP(GitHub 러너)를 차단 → 한국 IP 로컬 PC에서만 실행.** GH `collect-childcare-detail.yml`·`collect-childcare-jeju.yml` 삭제 + `collect-childcare.yml` 의 info step 제거(Kakao step 만 GH 잔존).

| 구분 | 방식 | 실행 |
|------|------|------|
| 자동 수집 | Windows 스케줄러 `MibunyangChildcareLocal` → `childcare-local-runner.bat` | 매일 04:30 KST (3종 전부: childcare-detail/info/info-jeju) |
| 수동/보충 | `node scripts/childcare-local-runner.mjs` | 필요시 |
| 대상 확인 | `node scripts/childcare-local-runner.mjs --list` | - |

등록/변경: `powershell -ExecutionPolicy Bypass -File scripts/register-childcare-task.ps1`

KOSIS(월간 일자 디스패치)와 달리 childcare 는 매일 3종 전부 실행 — detail 은 `DAILY_LIMIT` 1000/일 누적(~23일), info(243건)/jeju(2건)는 양이 적어 매일 최신 유지. 감시 = monitor ⑤ `EXTERNAL_API_COLLECTORS`(childcare-detail/info/info-jeju, stale_days 14). 시간 분리 = childcare 04:30 / KOSIS 05:30 / naver 02:00·08:00. detail 의 circuit breaker(세션 398)는 로컬(한국 IP)에선 차단이 없어 발동 안 함 = 무해(외부 장애 시 안전망으로 보존).

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
| 4/6 | molit-units.mjs | 세대수 보정 (국토부 API, 세션89 교체) | - |
| 5/6 | calc-exclusive-ratio.mjs | 전용률 계산 | O |
| 6/6 | compute-scores.mjs | cats_cache 스코어링 갱신 | - |

**세션89 변경**: 4/6 단계가 `naver-units.mjs`(네이버 크롤링, IP 차단)에서 `molit-units.mjs`(국토부 API)로 교체됨. **세션233 영구 삭제**. 실패 시 WARNING 처리로 5/6, 6/6 계속 진행. `run-naver-local.bat`/`.sh` 양쪽 동일.

**주의**: compute-scores.mjs는 `node --loader ./scripts/alias-loader.mjs` 필요 (`@/` 별칭)

### 후처리 파이프라인 (post-naver-collect.sh)

| 단계 | 스크립트 | 역할 |
|------|---------|------|
| 1 | sync-naver-complex.mjs | 22개 필드 동기화 |
| 2 | molit-units.mjs | 세대수 2차 보정 (국토부 API, 세션89 교체) |
| 3 | collect-unsold-kosis.mjs | KOSIS 미분양률 비례배분 |
| 4 | compute-scores.mjs | cats_cache 갱신 |

---

## data.go.kr API 쿼터 분배

일일 한도: 10,000회 (MOLIT_KEY, mibunyang + naver-estate-web 공유).

| 일자 | 워크플로우 | 추정 호출 |
|------|-----------|----------|
| 매월 1일 | collect-unsold-kosis | ~1 |
| 매월 5일 | population, market-stats | ~100 |
| 매월 6일 | collect-trades | 1,500~3,500 (세션92: 지방 8개 region 확장 시 +500~1,500) |
| 매월 6일 + 월/목 08:00 후 | molit-units | 50~300 (+post-naver-collect 시 추가) |
| **매월 10일** | **building-info** | **~8,500** |
| 매월 10일 | housing-permits | ~100 |
| **토요일** | naver-estate-web public_data | ~3,600 |

**위험일**:
- 매월 10일이 토요일 → 12,100 > 10,000. collect-building-info.yml에 토요일 → 11일 fallback 구현됨.
- 매월 10일이 월/목 → building-info 8,500 + post-naver-collect molit-units 300 = ~8,800~9,100(한도의 88~91%). 여유 900~1,200회. 모니터링 필요(세션89).
- **매월 6일 (세션92 이후)**: 지방 8개 region(강원/충북/충남/전북/전남/경북/경남/제주) 확장으로 collect-trades 최대 ~5,000회 가능. 여전히 10일보다 여유 있음 — 단 dry-run 실측 후 9,000 초과 시 `.github/workflows/collect-trades.yml` 2분할 고려(metro 6일 / rural 20일).

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

### heat_fuel / quake_design 수집 정책 (세션139 확정)

- **네이버 경로 단일화**: `sync-naver-complex.mjs` L219-221 (`complexes.heat_fuel_type → apartments.heat_fuel`) + `naver-collect.py` L117/119 (quakeDesign Phase 3 실사) 로 이미 DB 채워짐.
- **HpPermitService 미구독 결정**: 공공데이터포털 `getHpMgmCoopTpOulnInfo`·`getHpBasisOulnInfo` 별도 구독은 **보류**. 네이버 수집이 막히는 장애가 반복되기 전에는 구독 불필요.
- **재오픈 트리거**: (1) 네이버 IP 차단 장기화 (세션89 수준 실패가 3개월+ 지속), (2) `heat_fuel`/`quake_design` NULL 비율이 30%+ 로 악화, (3) 구독비보다 큰 사업 요구.
- **과거 코드**: 세션139 이전 `collect-building-hub.mjs` 에 `fetchHeatFuel`/`fetchQuakeDesign` 함수 + 주석처리된 호출부 존재. 재오픈 시 `git log` 에서 해당 커밋 이전 상태 복구 가능.

---

## 테스트 현황 (수집기)

> 진실의 원천 = **vitest 실행 수** (grep 은 동적 생성 `it()` 을 못 셈 — `_graceful-coverage` ALLOWLIST 루프 53건 등). 표는 stale 위험.
> 재측정: `npx vitest run scripts/collectors/ --reporter=json --outputFile=$TMP/c.json` 후 `testResults[].assertionResults.length` 파일별 합산.
> 세션 345 정정: 박제 42행/grep 수치 stale → vitest 실측 55행/1017 케이스. 세션 358: molit-building-info 29→22(energy 7케이스 제거) + data-audit 14→17 = **1013 케이스**.

**56개 파일 · 1104 케이스** (2026-06-11 vitest 실측 — `scripts/collectors/` 범위)

| 파일 | 테스트 수 |
|------|----------|
| schools-neis.test.mjs | 83 |
| _shared.test.mjs | 68 |
| _graceful-coverage.test.mjs | 53 |
| naver-presale.test.mjs | 44 |
| naver-listings.test.mjs | 38 |
| collect-trades.test.mjs | 35 |
| sync-naver-complex.test.mjs | 30 |
| _molit-api.test.mjs | 30 |
| transport-tago.test.mjs | 28 |
| collect-maintenance.test.mjs | 27 |
| migration.test.mjs | 27 |
| collect-unsold-kosis.test.mjs | 26 |
| trade-stats.test.mjs | 25 |
| collect-housing-price.test.mjs | 25 |
| childcare-info.test.mjs | 23 |
| collect-building-hub.test.mjs | 22 |
| molit-building-info.test.mjs | 22 |
| collect-avg-income.test.mjs | 20 |
| geocode-missing.test.mjs | 17 |
| collect-jeonse-price-index.test.mjs | 17 |
| collect-market-stats.test.mjs | 16 |
| population.test.mjs | 16 |
| noise-estimate.test.mjs | 15 |
| molit-units.test.mjs | 15 |
| collect-regional-economy.test.mjs | 15 |
| calc-layout.test.mjs | 14 |
| data-audit.test.mjs | 17 |
| population-sex-age.test.mjs | 13 |
| collect-applyhome.test.mjs | 13 |
| collect-sale-price-index.test.mjs | 13 |
| calc-school-walk.test.mjs | 13 |
| dart-builders.test.mjs | 13 |
| collect-fertility-rate.test.mjs | 13 |
| collect-medical-access.test.mjs | 13 |
| calc-floors.test.mjs | 12 |
| collect-crime-safety.test.mjs | 11 |
| trade-stats-regions.test.mjs | 11 |
| collect-housing-supply-ratio.test.mjs | 11 |
| data-fill.test.mjs | 11 |
| reverse-geocode.test.mjs | 10 |
| childcare-detail.test.mjs | 20 |
| regulation-seed.test.mjs | 9 |
| calc-exclusive-ratio.test.mjs | 9 |
| childcare-info-jeju.test.mjs | 9 |
| collect-nearby-childcare.test.mjs | 8 |
| collect-childcare.test.mjs | 7 |
| collect-emergency.test.mjs | 6 |
| housing-permits.test.mjs | 6 |
| infra-kakao.test.mjs | 5 |
| transit-match.test.mjs | 4 |
| noxious.test.mjs | 4 |
| collect-air-quality.test.mjs | 3 |
| industry-match.test.mjs | 3 |
| environment.test.mjs | 3 |
| collect-police.test.mjs | 2 |
