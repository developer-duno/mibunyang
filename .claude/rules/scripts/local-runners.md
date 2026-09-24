---
paths:
  - "scripts/kosis-local-runner.mjs"
  - "scripts/childcare-local-runner.mjs"
  - "scripts/run-naver-local.*"
  - "scripts/register-*.ps1"
  - "scripts/collectors/naver-collect.py"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

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
| 3 | **collect-emergency** | 세션525 신규 — 옛 cron `0 16 2 * *`(UTC 2일)은 **KST 3일**. B552657(국립중앙의료원)도 해외 IP 차단 |
| 5 | **population → population-sex-age** | 세션550 신규 — 옛 cron `0 20 5 * *`(UTC 5일)은 **KST 6일**이지만 **일부러 5일**. `regions` **행 생성자**라 후행(6·7·8일)보다 앞이어야 한다([[regions-multicollector-recorded-at-lag]]). 대상 월은 일(day)을 안 봐서 5일↔6일이 같은 달(`population.mjs:589`) |
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
| 21 | **lhzone-status** | 세션522 신규 (택지정보시스템 → dev_plans.progression_step) — 요약표 누락분 세션533 보충 |
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

### 분양 단지의 전용면적은 `/api/complex/scale` 에서 온다 (세션531)

`naver-presale.mjs` 가 만드는 `presale_min` 가격 행은 오래 `area: null` 이었다. 그러면 그 단지는
`apartments_flat.area` 가 비어 **`scorePrice` 의 평형별 실거래 버킷 경로를 못 타고** "구 전체 거래
중위 총액"과 비교되는 폴백으로 떨어진다. 그 폴백은 "비싼가"가 아니라 **"큰가"** 를 잰다.

같은 단지 892곳을 **경로만 바꿔** 잰 대조 실험(2026-08-24):

| | 버킷 경로(면적 반영) | 폴백 경로(면적 미반영) |
|---|---|---|
| corr(면적, 괴리도) | −0.097 | **−0.699** |
| 사분위 폭 | 36.2 | 62.9 |
| 115㎡+ 괴리도 중앙 | −35.6% | **−182.1%** |

손님 노출 1,730곳 중 **833곳(48.2%)** 이 이 폴백에 걸려 괴리도 점수가 0점 39.9% + 만점 27.9% =
**열에 일곱이 양 끝**으로 몰려 있었다.

- **출처**: `POST /api/complex/scale` → `result.list[]` 의 `use_area_size`(전용) · `supp_size`(공급) ·
  `supp_price`(그 주택형 분양가). 이 엔드포인트는 **분양 상세 페이지 JS 번들에서 실제 호출 목록을
  추출해** 찾았다 — 처음 짚어 본 `houseType`·`typeList`·`supply` 등 19개는 전부 404 였다.
- **어느 주택형인가**: 저장되는 `price` 가 `min_price`(최저가)이므로 **최저 `supp_price` 주택형**의
  면적을 쓴다(`pickScaleArea`). 다른 주택형 면적을 붙이면 비싼 집을 싼 값으로 재는 새 거짓이 된다.
- **요청 비용**: 단지당 +1회(2초). 이미 면적을 아는 단지는 이월해 건너뛴다(`resolveAreaInfo`).
  ⚠️ **건너뛸 때도 값은 이어 붙인다** — `latest_prices` 가 `presale_%` 중 `recorded_at` 최신 행을
  고르므로, 면적 없는 새 행을 만들면 옛 행을 덮어 화면에서 면적이 사라진다. `--refresh-area` 로 강제 재조회.
- **커버리지**: 청약홈 계열(`ah-`) 표본 140곳 중 74.3%, 네이버 전용(`ap-`) 은 약 35%. 빈 응답은
  **건너뛴다** — 아래 기각 목록대로 대체 경로가 없다.
- **이미 저장된 행**: `node scripts/backfill-presale-area.mjs --dry-run` → 실행. VIEW 가 고르는
  최신 행 하나만 채우고 과거 행은 건드리지 않는다(멱등·중단 안전).

⚠️ **되살리지 말 것 — 실측으로 기각한 대체 경로 3종** (근거를 새로 들고 올 때만 재개):

| 시도 | 기각 근거 |
|---|---|
| `prices` 에 숨은 면적 재사용 | 해당 833곳 중 **0곳** (VIEW 선택 문제가 아니었다) |
| `price ÷ 평당가` 역산 | 공급/전용 중앙비율 보정 후에도 오차 중앙 13.5%, 진짜 괴리도와 맞대면 폴백 대비 **승률 53.1%**(동전던지기)·평균오차는 오히려 악화 |
| 평당가끼리 비교(`presale_pp` vs `avg_price_sqm`) | 버킷 경로 값과 상관 **0.149**(무관), 중앙 +37%p 계통 편차 |
| 상세 응답의 `min_size`/`max_size` | 전용면적 아님 — DB 전용 대비 비율 0.95~1.93 산포, 서로 다른 단지가 같은 값(276.55)을 반환 |

### ⚠️ cats_cache UPDATE 는 단지 1곳당 요청 1개 — 동시성·지연을 함부로 올리지 말 것 (세션527)

PostgREST 에 **행마다 다른 값을 넣는 배치 UPDATE 문법이 없어** 약 2,200건을 개별 요청으로 보낸다.
`upsert` 로 `{id, cats_cache}` 만 보내는 우회는 **운영 DB 실측 결과 불가** —
`null value in column "name" violates not-null constraint`(INSERT 선시도). 전체 행 upsert 는
읽은 시점 이후 다른 수집기가 바꾼 컬럼을 되돌리는 **lost update** 위험이라 배제.

그래서 요청 **수** 대신 **요청률**을 잠갔다: `UPDATE_CONCURRENCY` **5** + `UPDATE_BATCH_DELAY_MS`
**100ms**(둘 다 export, `compute-scores.test.mjs` 가 값·배선·초당 요청률을 검사).
옛 값(10·지연 0)은 초당 약 25회(피크 32) 버스트였고, **DB 는 자매 레포(naver-estate-web)와 공유**다.
실측: 2,227건 · 174초 · 실패 0 = **초당 12.8회**. 근본책(Postgres RPC 로 배열 UPDATE)은 BACKLOG.

### 후처리 파이프라인 (`run-naver-local.bat` — 예약 작업 `MibunyangNaverCollect`, 월/목 08:00)

> ⚠️ 세션567 실측(2026-09-24 `Get-ScheduledTask`): 예약 작업은 `MibunyangChildcareLocal`(매일 04:30) ·
> `MibunyangKosisLocal`(매일 05:30, 날짜별 표 `kosis-local-runner.mjs` DAY_TABLE) · `MibunyangNaverCollect`
> (월/목 08:00) **3개뿐**이다. 옛 `post-naver-collect.sh`(4단계, 3단계가 미분양)는 `watch-and-run.sh` 만 부르고
> 예약이 없다(로그 마지막 2026-04-11). **미분양(`collect-unsold-kosis`)은 로컬 러너 매월 9일에만 돈다** —
> 네이버 러너는 미분양을 안 건드린다. 이 표를 옛 경로로 믿으면 미분양 갱신 시점을 틀리게 잡는다.

| 단계(bat 표기) | 스크립트 | 실패하면 |
|------|---------|---------|
| 1/6 | naver-collect.py (Python, `--max-minutes=120` — 자체 로그 `naver-collect-py.log`) | 중단 (`exit /b 1`) |
| 2/6 | sync-naver-complex.mjs — 네이버 단지 필드 동기화 | 중단 |
| 3/6 | naver-presale.mjs — 네이버 분양 일정 | 계속 (WARNING) |
| 4/6 | molit-units.mjs — 세대수 2차 보정 (국토부 API, 세션89 교체) | 계속 (WARNING) |
| 5/6 | calc-exclusive-ratio.mjs — 전용률 | 중단 |
| 6/6 | compute-scores.mjs — cats_cache 갱신 | 계속 (WARNING) |

손 실행 쌍둥이 = `scripts/run-naver-local.sh`(같은 6단계, 콘솔 출력) — 명령 `/collect-naver` 가 이쪽을 쓴다.


---

## 네이버 크롤링 시간 분리 (동일 IP)

| 시간(KST) | 프로젝트 | 작업 | 실행일 |
|-----------|---------|------|--------|
| 03:00 | naver-estate-web | discover_regions | 일요일 |
| 08:00 | mibunyang | naver-collect.py (6단계) | 월/목 |
| 매12시간 | naver-estate-web | crawl_articles | 매일 |
| 매4시간 | naver-estate-web | crawl_details | 매일 |
| 04:00 | naver-estate-web | collect_prices | 수요일 |
