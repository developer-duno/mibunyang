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

**신규 ah-* seeding (세션 466)**: `collect-applyhome-seed.mjs` (collect-applyhome.yml 앞단 스텝, 주간 월)가
`getRemndrLttotPblancDetail` 로스터 부재 + 공고일≥since(기본 2026-03-14) 공고를 INSERT. 현행 API 에
REMNDR_HSHLDCO 부재라 **units=unsold=회차 공급분, unsold_rate=100** 으로 박아 molit-units 보정 대상에
의도적으로 편입 (월/목 로컬 파이프라인 + 매월 6일 cron 이 실제 세대수로 정정). 등록 전 좌표 정밀 중복
게이트(이름 유사도 0.85 + region + 좌표 500m — 사장님 결정)로 기존 ap-*/ah-* 물리 중복 차단.

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

> ⚠️ **실행 경로 = GitHub Actions 가 아니라 집서버 로컬 러너다**(세션 515). apis.data.go.kr 의 국토부
> (1613000) 서비스가 해외 IP 를 복불복 차단해 `collect-{trades,molit-units,building-info,maintenance,building-hub}.yml`
> 5개를 삭제하고 `scripts/kosis-local-runner.mjs` 매핑표로 옮겼다 — 아래 "KOSIS + MOLIT 수집 — 로컬 자동화" 절 참조.

| 파일 | 역할 | isCLI |
|------|------|-------|
| `_molit-api.mjs` | 공유 모듈 (API 호출, 매칭, 페이지네이션, NonRetryableError) | - |
| `molit-building-info.mjs` | 건물 상세 (주차/층수/난방/복도) | O |
| `molit-units.mjs` | 세대수 보정 (units, unsold_rate) | O |
| `collect-maintenance.mjs` | 관리비 수집 (5항목 합산) | O |

- **isCLI 패턴**: `process.argv[1] && import.meta.url.endsWith(...)` — 53개 파일 (테스트 시 main() 방지, 2026-06-29 실측 `grep -l "const isCLI" scripts/**/*.mjs | grep -v test | wc -l`)
- **NonRetryableError**: 4xx/XML 에러 즉시 throw, 429/500/503만 재시도
- **`molitApiCall` opts override (세션 451)**: 기본 timeout/retry = 공유 상수 `MOLIT_TIMEOUT_MS=30000` × `MOLIT_MAX_RETRIES=3`. 호출처가 선택적 6번째 인자 `{ timeoutMs?, maxRetries? }` 로 좁힐 수 있음(기본=상수 → molit-units·molit-building-info 무변경). **collect-maintenance 의 `fetchTotalHouseholds` 는 `{ timeoutMs: 8000, maxRetries: 1 }`** — households 호출 30s×3(≈93초) hang 이 단지당 최악 ~135초의 진앙이라 cost endpoint(8s/무재시도) 톤에 맞춰 좁힘. 전역 상수는 3 collector 공유라 **변경 금지**(cross-collector 회귀), maintenance-local opts 로만.

### 공유 모듈 (_shared.mjs)

- REGION_MAP: 약칭17 + 정식명20 = 37개
- REGION_LAWD_PREFIX + GU_LAWD_MAP + getLawdCd(): 법정동코드 매핑
- fetchWithRetry: Retry-After 헤더 + 지수 백오프 (429/500/503)
- upsertBatch: 배치 100ms + 429 재시도 (attempt+1)^2초
- recordApiQuota: api_quota_log 기록
- **today(): KST 고정 YYYY-MM-DD** (세션 419) — `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"})`. ⚠️ GitHub Actions=UTC 러너라 `new Date().toISOString().slice(0,10)` 직접 쓰면 KST 02:00~08:00 발화 시 recorded_at 하루 밀림. **시계열 recorded_at·collected_at 저장은 today() 의무**(직접 toISOString 금지). TZ env 안 씀(코드 고정이 본질 — TZ env는 cron 발화 안 바꿈+월경계 시프트 잠복위험). datetime(시각포함, presale_fetched_at 등)은 timestamptz 컬럼이라 toISOString 유지 OK

### Exit Code 정책

- createReporter 사용: `rpt.summary().fail > 0` → exit(1)
- 수동 카운터: `failed > 0` → exit(1)
- ⚠️ 개수는 **박제하지 않는다**(세션마다 변한다). 세션 496 실측 시점에 이 두 줄의 옛 박제값 "9개/5개"가
  실제 20개/7개로 어긋나 있었고, 두 분류 어디에도 안 드는 collector 가 27개 더 있었다(환경변수 누락 등
  다른 조건으로만 exit). 단정이 필요하면 그때 세되, 세는 규칙부터 정하고 센다 — `failed > 0` 이
  `rpt.fail(failed)` 에 넘기는 용도인 파일(`collect-applyhome.mjs`)도 있어 단순 grep 은 오탐한다.
- recordApiQuota 완료 후 exit 호출 (쿼터 기록 보장)
- ⚠️ **`try` 안 `process.exit()` 은 대기 중인 `finally` 를 실행하지 않는다**(Node 실측). `finally` 로 쿼터를
  기록하는 collector 가 이 구조면 **실패 종료 때마다 기록이 통째로 유실**되는데, 성공 경로는 멀쩡히 기록되므로
  로그만 봐서는 안 드러난다. 정답 2형 —
  ① try/catch/finally 문 **전체가 끝난 뒤** exit (`collect-market-stats.mjs`): `try` 안에 조기 `return` 이 없을 때만 안전.
  ② `shouldExit1` 플래그 + `finally` 안 recordApiQuota **await 직후** exit (`collect-applyhome.mjs`): 조기
  `return`(dry-run 등)이 있으면 이쪽만 안전 — ①을 쓰면 그 줄에 도달 못 해 **exit 0(성공) 회귀**.
  전수 회귀 가드 = `scripts/collectors/_exit-quota-coverage.test.mjs` (세션 496). 세션 395 가 9개 파일을 고치고
  applyhome 2개를 놓친 채 1년 가까이 잠복한 사고라 파일별 수동 점검 대신 기계로 훑는다.
- ✅ **가드가 사전 차단에 성공한 첫 사례 (세션 496b, PR #330)**: 신규 `collect-applyhome-remndr.mjs` 가
  try 안 `process.exit` 4곳을 가진 채 올라왔고, main 병합 순간 이 가드가 **머지 전에** red 를 냈다.
  이 파일은 dry-run 조기 `return` 이 있어 **②만 정답**이었다 — 즉 "정답이 2형"이 아니라 "파일마다 정답이
  하나로 갈린다". 새 collector 를 쓸 때 ①/②를 고르는 기준은 **`try` 안에 조기 `return` 이 있는가** 하나다.

---

## KOSIS + MOLIT 수집 — 로컬 자동화 (세션 288~289·395·515)

**kosis.kr 이 해외 클라우드 IP(GitHub 러너)를 차단(2026-06-09~) → 한국 IP 로컬 PC에서만 실행.** GH `collect-*.yml` 10개 삭제됨 (PR #98).

**세션 515: 국토부(apis.data.go.kr/**1613000**)도 2026-08-06 부터 GH 러너를 복불복 차단** (HTTP 코드 없는 `fetch failed` / 같은 키·같은 요청이 로컬 한국 IP 에선 156ms 200 OK 실측) → 1613000 의존 5종(trades·molit-units·molit-building-info·maintenance·building-hub)도 같은 러너로 이전. GH `collect-{trades,molit-units,building-info,maintenance,building-hub}.yml` 5개 삭제.

**세션 517: 이 러너는 이제 네이버 수집기도 하나 나른다** — `naver-devplan.mjs`(매월 20일). 네이버 API 역시 한국 IP 가 필요한데 편입 전까지는 어느 스케줄에도 없어 사람이 손으로 부를 때만 돌았다. 절 이름의 "KOSIS + MOLIT" 과 실체가 어긋나는 것은 `transport-tago`(이름은 TAGO 인데 TAGO 를 안 씀) 선례처럼 **문서로 해소**한다 — 파일·작업 이름을 바꾸면 스케줄러 등록·`collector_runs` 라벨까지 흔들린다.

| 구분 | 방식 | 실행 |
|------|------|------|
| 자동 수집 | Windows 스케줄러 `MibunyangKosisLocal` → `kosis-local-runner.bat` | 매일 05:30 KST (일자 디스패치 — 아래 표) |
| 수동/보충 | `node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD` | 필요시 |
| 매핑표 확인 | `node scripts/kosis-local-runner.mjs --list` | - |

일자 디스패치 (진실의 원천 = `kosis-local-runner.mjs` 의 `DAY_TABLE` — 아래는 요약이라 낡을 수 있다, 단정 전 `--list`):

| 일 | 수집기 | 게이트 |
|----|--------|--------|
| 2 | housing-supply-ratio | - |
| 6 | market-stats → **molit-units** → **trades** | trades 가 가장 오래 걸려 마지막 |
| 7 | migration | - |
| 8 | **collect-crime-safety** | 세션521 신규 — 외부 API 0(로컬 CSV 파싱). 행 생성자(population 5일·market-stats 6일) **뒤**여야 새 `recorded_at` 행을 덮는다 |
| 9 | unsold | - |
| 10 | fertility-rate, **molit-building-info** | building-info 는 **토요일이면 건너뜀**(자매 레포 public_data 와 쿼터 충돌) |
| 11 | housing-permits, **molit-building-info** | building-info 는 **전날이 토요일일 때만**(10일 보충) |
| 12·13·14 | regional-economy / avg-income / medical-access | - |
| 15~19 | **maintenance** | 매일 `--limit=600` 배치 (옛 cron `0 6 15-19` 이식 — 인자를 빼면 전 대상이 한 회차에 몰려 일일 쿼터 초과) |
| 15 | **building-hub** | 1·4·7·10월만 |
| 17 | sale-price-index | 1·4·7·10월만 |
| 17 | **housing-price** | 세션519 신규 — 옛 cron `0 22 16 * *`(UTC)는 **KST 17일** |
| 18 | jeonse-price-index | - |
| 20 | **naver-devplan** `--kinds=road,rail,station,jigu` | 네이버 4종만 (V-WORLD 축 제외 — 전량은 ~7.5h·중간 체크포인트 없음) |
| **매주 화** | **air-quality** | 세션519 신규 — 옛 cron `0 15 * * 1`(UTC 월)은 **KST 화요일**. 표의 첫 `dow` 항목 |

⚠️ **GH cron 을 이 표로 이식할 땐 UTC→KST(+9h) 로 날짜·요일을 다시 계산한다** (세션519). 러너는
KST 05:30 에 돌고 이 표도 KST 기준이라, cron 숫자를 그대로 베끼면 하루/한 요일이 밀린다.
`day` 와 `dow` 는 **배타** — `dow` 가 있으면 그 요일만 보고 `day` 는 무시한다.

**놓친 날 보충 (세션521)** — 스케줄러가 `StartWhenAvailable=true` 라 PC 가 꺼져 있던 날의 발화를
나중에 실행하는데, 러너는 **실행된 날짜**로만 판단해서 놓친 날의 수집기를 영영 건너뛰었다.
실측 사고: 8/13 05:30 발화가 통째로 빠졌고 8/14 03:28 에 뒤늦게 돈 실행은 "8/14" 로 판단해
14일분만 돌렸다 → `avg-income` 이 **39일** 밀린 채 monitor ⑤ 가 잡을 때까지 잠복.
이제 `.kosis-local-runner-state.json`(gitignore)에 마지막 처리일을 남기고 다음 실행에서 메운다.

| 상황 | 처리 |
|---|---|
| 첫 실행(상태 파일 없음)·형식 깨짐·미래 날짜 | 오늘만 |
| 어제까지 처리 | 오늘만 (평상시 동작 불변) |
| 며칠 밀림 | **가장 오래된 하루 + 오늘** — 매일 하루씩 따라잡는다 |
| 10일 초과로 밀림 | 위와 같되 `logError` 로 알림 (원인부터 볼 자리) |

⚠️ **한 번에 하루치만** 메우는 이유는 쿼터다. 15~19일 `maintenance` 는 회차당 약 3,600 회를 쓰는데
5일치를 몰아 돌리면 data.go.kr 일일 10,000 한도를 그 자리에서 넘긴다.
`--date=YYYY-MM-DD`(수동 보충)와 `--no-catchup` 은 소급을 끄고 그 날만 본다 — 상태 파일도 안 쓴다.
실패해도 상태는 기록한다(같은 날 무한 재시도 방지). 실패 알림은 기존 텔레그램이 담당.

등록/변경: `powershell -ExecutionPolicy Bypass -File scripts/register-kosis-task.ps1`

⚠️ **세션521 — 이 표에 CSV 기반 수집기가 처음 들어왔다.** `collect-crime-safety.mjs` 는 외부 API 를
쓰지 않고 `data/crime-safety-index.csv` 를 읽는다. 옛 판단은 *"CSV 가 연 1회 갱신이라 자동화할
대상이 없다"* 였는데(그래서 `audit-orphan-collectors` ALLOWLIST·monitor EXEMPT 양쪽에서 빠져
있었다), **채우는 대상인 `regions` 에는 매월 새 `recorded_at` 행이 생긴다**. 실측 결과 수집기가
2026-03 경 이후 안 돌아 04·05·06월 행이 통째로 NULL 이었고 `crime_grade` NULL 비율이 계속 올라
monitor NULL 급증 경보가 영구화되고 있었다. **처방은 감시를 끄는 쪽이 아니라 자동 실행 경로를
만드는 쪽**이었다 — 러너 매월 8일 편입 + 양쪽 예외 목록에서 제거.
즉 이 표의 자격은 "외부 API 를 쓰는가" 가 아니라 **"한국 IP 나 정기 실행이 필요한가"** 다.

감시: GH run 이 없으므로 monitor ⑤ `EXTERNAL_API_COLLECTORS` 신선도(일일·주간 14일/월간 38일/분기 100일)가 유일한 미발화 알림 — 세션 515 에 `trades`·`molit-building`·`molit-units` 3건, 세션 517 에 `naver-devplan` 1건 신규 등재(`maintenance`·`building-hub` 는 기존 항목 유지). KOSIS 수집기 10종 전부 실패 시 `collector_runs` 에 `status=failure` 행 기록 (PR #97·#99 하드닝 — throw·early-return 전 경로).

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
| 1/6 | naver-collect.py | 네이버 매물 수집 (curl_cffi, `--max-minutes=120` — 세션495 하향) | O |
| 2/6 | sync-naver-complex.mjs | 22개 필드 → apartments 동기화 | O |
| 3/6 | naver-presale.mjs | 분양정보 19필드 수집 | - |
| 4/6 | molit-units.mjs | 세대수 보정 (국토부 API, 세션89 교체) | - |
| 5/6 | calc-exclusive-ratio.mjs | 전용률 계산 | O |
| 6/6 | compute-scores.mjs | cats_cache 스코어링 갱신 | - |

**세션89 변경**: 4/6 단계가 `naver-units.mjs`(네이버 크롤링, IP 차단)에서 `molit-units.mjs`(국토부 API)로 교체됨. **세션233 영구 삭제**. 실패 시 WARNING 처리로 5/6, 6/6 계속 진행. `run-naver-local.bat`/`.sh` 양쪽 동일.

**세션518 — 실패 원인이 남는다 (로그 리다이렉션)**: 스케줄러 작업 `MibunyangNaverCollect` 는
`Command=F:\mibunyang\scripts\run-naver-local.bat` 를 **인자 없이** 부른다(실측). 즉 stdout/stderr 가
갈 곳이 없어 사라졌고, 단계가 죽어도 로그엔 `ERROR: X.mjs failed` 한 줄만 남았다 —
**2026-08-14 2단계 실패는 그래서 원인을 영영 못 밝힌다**(3~6단계가 통째로 스킵돼 `naver-presale`·
`molit-units` 가 7일 stale). 각 단계에 `>> "%LOG%" 2>&1` 을 붙여 해소.

| 로그 | 내용 |
|---|---|
| `naver-collect.log` | 단계 마커(시각 포함) + **2~6단계 stdout·stderr** |
| `naver-collect-py.log` | 1단계 파이썬 전용(단지마다 줄을 찍어 메인 로그를 파묻으므로 분리) |

- 단계 마커에 시각이 붙어 **어느 단계가 시간을 먹었는지**가 로그만으로 보인다(1단계 상한 120분,
  작업 전체 상한 `ExecutionTimeLimit=PT4H`).
- `run-naver-local.sh` 는 **의도적으로 무변경** — 사람이 콘솔을 보며 돌리는 경로라 리다이렉트하면
  진행이 안 보인다. (세션89의 "양쪽 동일"은 단계 구성 얘기지 로그 정책이 아니다.)
- 같이 고친 기존 버그: `if` 블록 안에서 `echo ... (non-fatal) >> ...` 의 `)` 가 블록 종료로 해석돼
  **문구가 `(non-fatal` 로 잘려 기록**되고 있었다(8/10 운영 로그 실측). `- non-fatal` 로 교체.
- ⚠️ `audit-orphan-collectors.mjs` 는 `.bat` 에서 `scripts/collectors/X.mjs` 를 **줄 끝 고정 없이**
  찾으므로 뒤에 리다이렉션이 붙어도 인식한다. 단 그 감사는 `REM` 주석을 못 걷어내니 **주석에
  수집기 경로를 쓰면 안 된다**(가짜로 "실행 경로 있음"이 된다).
- 검증: 수집기 호출만 가짜로 바꾼 사본으로 ①전 단계 성공(exit 0·6단계 마커) ②2단계 실패(exit 1·
  그 단계 stderr 가 로그에 남고 이후 중단) ③3단계 경고(exit 0·4~6단계 진행) 3경우 실증.

**세션470 인프라 개선 (중복방지·resume·재시도·CRLF)**:
- **중복 실행 방지 (filelock)**: `naver-collect.py` `__main__` 이 `FileLock(ROOT/.naver-collect.lock, timeout=0)` 획득. 이미 돌면 즉시 `sys.exit(0)`(겹침은 실패 아님). 손으로 여러 번 실행해도 2번째부터 종료 = 좀비 더미 방지(같은 IP 다중 수집기 → 네이버 rate-limit 경합 stall 사고 정정). `requirements.txt` filelock, `.gitignore` `.naver-collect.lock`.
- **resume (이어하기)**: `main()` 이 이미 `last_seen_at` 찍힌 complex_no(done_cx)를 `SB.select("articles",...)` 로 조회 → 매물·시세 루프 `if cn in done_cx: continue`. 스케줄러 재시도 시 이어서 돎. **창 = 최근 7일**(`naver-collect.py` L295 `since=now-timedelta(days=7)`) — 세션470 당시엔 "오늘"이었으나 **세션493 에서 7일로 확대**(아래 세션493 표 `resume 창` 행 참조). 따라서 날짜가 바뀌어도 7일 내 수집분은 계속 스킵되고, 시간예산이 아직 못 받은 단지로 간다. `--no-resume` 강제 전체. dry-run/조회실패 시 비활성(fail-open). 저장·조회 **UTC 통일**(`datetime.now(timezone.utc)`, 세션495 — 이전 naive KST 는 자매 레포 UTC writer 와 같은 컬럼에서 9시간 어긋났음). 세션338 schools `buildEnrichedIds` 답습. ⚠️ 세션495부터 **로컬 체크포인트 `.naver-collect-state.json` 병용** — 매물 0건 단지·7일 초과 방문 이력은 DB 스탬프에 안 남아 이 파일이 담당(유실 시 사고 아님 — 첫 사이클 순서만 재시작).
- **UTF-8 stdout 강제**: `sys.stdout.reconfigure("utf-8")` — cp949 콘솔 한글 print UnicodeEncodeError 방지(배치 chcp 65001 의존 제거).
- **스케줄러 재시도**: `register-naver-task.ps1` `New-ScheduledTaskSettingsSet` 에 `-RestartCount 2 -RestartInterval 10분 -MultipleInstances IgnoreNew`(실패 시 10분 뒤 ×2, 절대 겹침 없음). filelock 이 손실행까지 막는 2중 안전망. **재등록 완료**(2026-08-06, 실측 `ExecutionTimeLimit=PT4H`): `powershell -ExecutionPolicy Bypass -File F:\mibunyang\scripts\register-naver-task.ps1`(전체경로, `$PSScriptRoot` 기준). ⚠️ **관리자 PowerShell 필요** — 일반 셸에서 실행하면 `0x80070005`(액세스 거부)로 등록이 거부된다.
- **⚠️ `run-naver-local.bat` 은 반드시 CRLF + ASCII**: `.gitattributes *.bat text eol=crlf` 로 checkout 시 CRLF 복원되나 Write 툴 직생성은 LF 잔존 → cmd 오파싱(한글 :: 주석 + chcp 65001 악화)으로 스케줄러 발화 실패. 편집 후 CRLF·pureLF0 실측 의무(세션400·470 2회 재발). run-naver-local.sh(bash)는 정상, .bat 만 취약.

**세션493 1단계 시간 초과 → 2~6단계 굶주림 정정 (매칭 필터·시간예산·resume 7일·제한 4h)**:

7월 초부터 1단계가 매번 예약작업 제한시간(2h)에 잘려 강제종료(결과코드 267014) → bat 이 **2~6단계에
도달조차 못 함** → 분양정보(마지막 성공 7-03)·세대수 보정(7-06)이 한 달 stale. 산술: `find_markers` 가
(region,gu) 그룹 bounding box + 마진 0.03 으로 **3만 개 단지**를 잡고 그 전부에 매물 1회 + 시세 2회를
`thr(5.0)` 스로틀로 돌려 **≈42시간** 필요. **5초 스로틀은 IP 차단 방지용이라 줄이지 않는다.**

| 정정 | 내용 |
|------|------|
| **매칭 필터** | 매물·시세는 **우리 단지와 이름 유사도 ≥ 0.6 인 단지만**. 전량 기준 **크롤 대상 1,789단지**(아래 ⚠️ 주석 — PR #314 본문의 "1,747→10" 은 스모크 값) |
| **시간예산** | `--max-minutes`(기본 90, bat 은 **120** — 세션495: 6단계 체인 실측 246.6분 > 제한 240분이라 150→120 하향, 마진 약 23분). 초과 시 루프를 끊고 마무리는 정상 수행 후 **exit 0** |
| **resume 창** | 오늘 → **7일**. 예산에 잘려 남은 단지를 다음 발화(월↔목)가 이어받아 전체를 순환 |
| **제한시간** | `register-naver-task.ps1` ExecutionTimeLimit **2h → 4h**. **재등록 완료**(2026-08-06, 실측 PT4H). 세션495 예산 120분 하향으로 재등록 없이 마진 확보 |
| **실행 기록** | 종료 직전 `collector_runs` 1행 INSERT (`collector="naver-collect"`, 예산 중단 시 `status="partial"`) |

- ⚠️ **"마커 1,747건 → 대상 10건" 은 스모크 실행 값이지 전량 수치가 아니다**: PR #314 본문의 그 숫자는
  `--limit=10 --max-minutes=3` 로 돌린 스모크 결과다. `naver-collect.py` 의 `--limit` 은 **우리 단지 목록을
  앞에서 자르는** 인자라, 대상 상한이 애초에 10으로 묶인 상태에서 나온 값이다.
  **전체 오프라인 재현(세션 495): apartments 2,635 × complexes 63,842, LCS 임계 0.6 → 크롤 대상 1,789단지.**
  바로 위 산술의 **'3만 개 단지'는 필터를 걸기 *전* 마커 수**라 서로 다른 단계의 값이다(1,789 는 필터 *후*).
- **단지 메타(complexes upsert)는 마커 전체 유지** — bbox 요청 1회로 이미 받은 값이라 추가 비용 0.
  시간을 먹는 건 단지당 개별 요청이 필요한 매물·시세뿐이라 **그쪽만** 좁힌다.
- ⚠️ **매칭 임계·전처리는 다운스트림과 반드시 일치**: `sync-naver-complex.mjs` `matchApartments` 는
  complex_links 가 비면 `stringSimilarity(cpxName, apt.name) >= 0.6` 로 폴백하는데, **cpxName 은
  `.replace(/\([^)]*\)/g,"").trim()` 로 괄호를 벗긴 값**(L66). naver-collect.py 의 `_cpx_key()` 가 같은
  전처리를 한다 — 안 벗기면 "스타캐슬2차(주상복합)" 류(전체 단지의 **24%**)를 우리가 안 받아와
  굶주림이 그대로 남는다(실측: 괄호 제거를 빼면 599개 표본 중 매칭 48건 → 11건 유실).
- 유사도는 `_shared.mjs stringSimilarity`(공백 제거 후 LCS, `2*LCS/(len+len)`)를 **파이썬으로 직접 포팅**
  (`sim_name`). `difflib.SequenceMatcher` 는 알고리즘이 달라 0.6 임계 의미가 어긋나므로 **금지**.

**세션495 스케줄링 개편 (시세 기아·frontier 정체 정정 — 적대검증 CONFIRMED high 2건)**:

세션493 구조는 매물·시세가 **한 예산을 두 루프가 순서대로** 쓰는 바람에 매물이 항상 예산을 먼저
소진 → 시세 루프는 시작도 못 함(완주 run 이후 complex_price_history 신규 0행 실측). 또 대상 순서가
무정렬이라 앞쪽 3블록(~1,320단지)만 3-run 주기로 돌고 나머지 약 26%는 영구 미도달이었다.

| 정정 | 내용 |
|------|------|
| **interleave** | `collect_complex(cn)` 단지 단위로 **매물+시세를 한 묶음** 수집 — 이번 run 에 받은 단지는 같은 run 에서 시세까지 확보 |
| **회전** | `order_targets()` — 방문 오래된 순 + **무스탬프 최우선** + 동률 `complex_no` 사전순(결정적). frontier 가 매 run 전진 |
| **체크포인트** | `.naver-collect-state.json`(gitignore) — 매물 0건 단지도 "봤다" 기록, 재방문 낭비 차단. DB 스키마 변경 0 |
| **산술** | 회당 약 450단지(3요청×5초=15초/단지) → 전수 1,789 를 **4 run ≈ 2주** 순환. 체인 216.6분 < 제한 240분 |
  비교는 **같은 (region,gu) 그룹 단지끼리만** — 전체 2,170개와 곱하면 LCS 가 폭발한다.
- resume 시너지: 자매 레포(naver-estate-web)가 같은 `articles.last_seen_at` 을 찍는 단지는 자동 스킵되어
  우리 예산이 "우리만 보는 단지"에 집중된다.

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

> ⚠️ 아래 "실행 주체" 열은 세션 515 에 바뀌었다 — 국토부(1613000) 의존 5종은 GH 워크플로가 아니라
> **집서버 로컬 러너**(`kosis-local-runner.mjs`)가 돌린다. 발화일은 그대로라 쿼터 계산은 불변이다.

| 일자 | 실행 주체 | 추정 호출 |
|------|-----------|----------|
| 매월 1일 | collect-unsold-kosis (로컬 러너) | ~1 |
| 매월 5일 | population(GH), market-stats(로컬 러너 6일) | ~100 |
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
| 네이버 부동산 | naver-collect.py | 5초 (`thr()` 기본값, 세션 118 IP 쿨다운 상향) | 3회 | JWT 리셋 + 5*(i+1)초 |
| 네이버 부동산 | naver-listings.mjs | 5초 | 5회 | JWT 리셋 + [10,20,40,60,120]초 |
| 네이버 분양 | naver-presale.mjs | 2초 | 3회 | [5,10,20]초 |
| 네이버 개발계획 | naver-devplan.mjs | 5초 | 3회 (429 전용 [30,60,120]초) | ⚠️ **세션 쿠키 필수**(세션516): 쿠키 없는 요청은 "Rate limit exceeded" 거짓 문구로 **즉답 429** — 진짜 rate limit 아님. `ensureNaverSession()` 이 JWT+쿠키를 한 캐시로 관리 |
| data.go.kr | molit-* | 0.4초 | 3회 (기본) | NonRetryableError / 지수 백오프. ⚠️ collect-maintenance `fetchTotalHouseholds` 는 8s/1회 override(세션 451, 위 MOLIT 모듈 절) |
| Kakao Places | infra-kakao | 세마포어 5개 | fetchWithRetry | 지수 백오프 |
| DART | dart-builders | fetchWithRetry | 3회 | 지수 백오프 |
| Supabase | upsertBatch | 100ms/배치 | 3회 | (attempt+1)^2초 |

> 버스 정류장은 **외부 API 호출이 0** 이라 이 표에 없다 — 아래 절 참조(회차당 파일 1회 다운로드).

---

## 교통 수집 (transport-tago.mjs) — 버스는 파일, 나머지는 Kakao

이름은 `transport-tago` 지만 **TAGO API 는 더 이상 쓰지 않는다**(세션 498 · PR #337). 파일명은
호출처·워크플로·`collector_runs.collector` 이름과 얽혀 있어 그대로 뒀다.

| 항목 | 출처 | 비고 |
|---|---|---|
| 버스 정류장 | **data.go.kr 정적 파일**(#15067528, CSV·EUC-KR·약 20MB) | 수집기 실행당 1회 다운로드 후 전부 인메모리 매칭 |
| 지하철 / IC / KTX | Kakao Places | 기존 그대로 |

### 왜 TAGO 를 버렸나

TAGO 는 "지자체 BIS 와 연계된" 지역만 커버하는데 **서울은 자체 BIS(TOPIS)** 를 써서 그 밖이다.
그 결과 서울 637단지 중 **391곳(62%)이 "버스 0개"로 거짓 기록**돼 입지 점수가 깎이고 있었다.
게다가 TAGO 응답 지연으로 단지당 39초(정상의 10배)까지 늘어 증분 워크플로가 4시간 job timeout
을 통째로 먹고 후속 스텝(infra·schools)이 아예 안 도는 사고가 반복됐다.

### 개수 세는 규칙 (⚠️ 순서가 핵심)

정적 파일은 **정류장 기둥 하나를 방향별·지자체체계별로 여러 행에 나눠 담는다**(서울분 16,980행
vs 서울시 TOPIS 공식 11,231건, 고유 이름은 9,057개). 그래서:

```
반경 500m 필터 → 거리순 정렬 → 이름 dedup 先 → 고유 20개까지 cap 後
```

**dedup 을 먼저** 해야 한다. 반대로 하면 중복이 촘촘한 도심에서 상한 칸이 같은 정류장의 중복
행으로 채워져 고유 정류장 수가 과소 계상된다(실측: 전 단지 55%가 평균 2.54개 손실, 대구 -10.05점
· 서울 -9.47점 vs 제주 -0.40점의 체계적 편향). 상세 = [.claude/rules/collectors/external-file-duplicate-rows.md](../.claude/rules/collectors/external-file-duplicate-rows.md).

- `BUS_UNIQUE_CAP`(transport-tago.mjs) **== `FULL_BUS_ROUTES`**(src/constants/scoringTiers.ts) 여야
  한다. 낮으면 아무도 만점을 못 받고, 높으면 초과분이 점수에 안 쓰인다. `transport-tago.test.mjs`
  가 두 소스에서 값을 읽어 비교하는 동기화 가드를 갖고 있다(한쪽만 바꾸면 red).
- 파일 로드 실패 시 `null` 반환 → 그 회차 전체를 "버스 수집 실패"로 취급(세션98 이래의
  `null`=실패 / `[]`=성공·0건 계약 유지).

### 완료 판정 · 벽시계 예산

- 완료 판정 = **`bus_routes IS NOT NULL`**(세션 496 · #332). `subway_name` 기준이던 옛 판정은
  버스가 죽어도 완료로 쳐서 헛돌이·동결을 동시에 일으켰다.
- `--budget-min=N`(기본 180) — 240분 job timeout 대비 후속 스텝(infra·schools)에 60분을 남긴다.
  단지마다 즉시 upsert 하므로 예산으로 끊어도 그때까지 처리분은 저장돼 있다.
  ⚠️ 이 예산은 **8-07 이후 도입**(#332)이라 그 이전 실행 기록에는 적용돼 있지 않다.

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

## scripts/ 가 쓰는 외부 패키지는 반드시 package.json 에 선언 (세션518)

**`npm run lint` 은 `eslint src/` 라 `scripts/` 를 아예 안 본다.** 그래서
eslint-plugin-import 의 `no-extraneous-dependencies` 같은 규칙이 이 디렉토리에 닿지 않고,
**남의 패키지에 얹힌 import 가 조용히 살아남는다.**

사고: `js-yaml` 이 dependencies·devDependencies 어디에도 없이 **eslint 의 transitive 로만**
존재했다. eslint 10 시험 업그레이드가 46개 패키지를 정리하며 그 사슬을 끊자
`Cannot find package 'js-yaml'` 로 **감사·테스트 5개가 통째로 죽었다**
(`audit-env-keys`·`audit-cron-concurrency`·`audit-collect-transport-budget`·
`audit-fill-matrix`·`noxious.test`). `@types/js-yaml` 만 선언돼 있어 **"선언돼 있다"는
착시**까지 있었다 — 타입만 있고 본체가 없는 상태였다.

- 가드 = `scripts/audit-declared-deps.mjs` (CI 등재). `scripts/**` 의 bare import 를 뽑아
  `package.json` 과 대조하고, 미선언이면 exit 1.
- 제외 대상: Node 내장(`node:` 접두사·`builtinModules`) · `@/` 별칭 · 상대/절대 경로 ·
  `scripts/probes/`(`.gitignore` 대상이라 CI 체크아웃엔 없다 — 훑으면 로컬만 빨개진다).
- ⚠️ **`from` 뒤 공백이 판별의 핵심**이다. import 는 `from "pkg"`(괄호 없음)인데 Supabase 는
  `sb.from("apartments")`(괄호 있음)라, 괄호를 허용하면 **테이블 이름이 전부 패키지로 잡힌다**
  (첫 구현이 실제로 26종 오검출). 회귀 가드가 `audit-declared-deps.test.mjs` 에 있고
  뮤테이션 3종(괄호 허용·stripComments 우회·내장 검사 제거)으로 red 실증했다.
- 새 패키지를 쓸 땐 `npm i -D <이름>` 으로 **명시 선언**하고, 버전은 지금 해석되는 것과
  **같은 메이저로 고정**한다(`npm i -D js-yaml` 은 메이저 5를 끌어와 타입 정의 4와 어긋났다).

## 테스트 현황 (수집기)

> 진실의 원천 = **vitest 실행 수** (grep 은 동적 생성 `it()` 을 못 셈 — `_graceful-coverage` ALLOWLIST 루프 53건 등). 표는 stale 위험.
> 재측정: `npx vitest run scripts/collectors/ --reporter=json --outputFile=$TMP/c.json` 후 `testResults[].assertionResults.length` 파일별 합산.
> 세션 345 정정: 박제 42행/grep 수치 stale → vitest 실측 55행/1017 케이스. 세션 358: molit-building-info 29→22(energy 7케이스 제거) + data-audit 14→17 = **1013 케이스**.

**56개 파일** (진실의 원천 = 위 vitest 실행 수 — 케이스 수는 박제하지 말고 재측정. 2026-06-29 기준 ~1127 케이스)

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
| transit-match.test.mjs | 43 |
| noxious.test.mjs | 4 |
| collect-air-quality.test.mjs | 3 |
| industry-match.test.mjs | 3 |
| environment.test.mjs | 3 |
| collect-police.test.mjs | 2 |
