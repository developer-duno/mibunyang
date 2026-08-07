# GitHub Actions 워크플로우 규칙

> 워크플로우 수정/추가 시 반드시 이 규칙을 따를 것.

## 워크플로우 목록

> ⚠️ **아래 표의 분류·개수는 낡는다.** 진실의 원천은 각 yml 의 `on:` 블록이다.
> 세션 491 실측에서 개수 어긋남 2건 + 미기재 1건이 나왔다. 단정 전 실측:
>
> ```bash
> ls .github/workflows/*.yml | wc -l                      # 전체 개수
> for f in .github/workflows/*.yml; do                     # 파일별 실제 트리거·주기
>   printf "%-42s %s\n" "$(basename $f)" "$(grep -oE "cron: *'[^']+'" $f | head -1)"
> done
> ```
>
> **분류 기준**: 아래 "매일/매주/매월"은 **수집·가공 계열**만 센다.
> CI/CD·모니터링·유틸리티는 주기와 무관하게 별도 절로 묶여 있다
> (예: `purge-consults` 는 매일 돌지만 유틸리티, `monitor-collectors` 는 매일 돌지만 모니터링).

### 매일 (3개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-naver-listings.yml` | 네이버 후처리 Core (sync + 전용률 계산, UTC 19:00) |
| `collect-naver-listings-incremental.yml` | 네이버 후처리 Incremental (UTC 20:30 = KST 05:30) — `transport-tago` → `infra-kakao` → `schools-neis` 를 **무인자로** 순차 실행. **세션 491 문서 추가** (그동안 표에 없었다). 이 세 스텝이 같은 이름의 월간 워크플로를 대체하므로 그쪽 schedule 을 지웠다 |
| `daily-deploy.yml` | Vercel 자동 배포 (KST 03:00). **세션 491**: `compute-scores` + `refresh-data` 두 잡을 `scoring-and-refresh` 하나로 합침 — `needs` 로 어차피 순차였는데 checkout·setup-node·npm ci 를 두 번 태우고 분 올림도 두 번 물었다. 스텝 순서(scores → collect-data → commit/push)는 그대로 |

> 세션 399: `collect-childcare-detail.yml` 삭제 → 집서버 로컬 러너 이전 (아래 KOSIS 절 옆 childcare 절 참조).

### CI/CD (3개)

| 워크플로우 | 설명 |
|-----------|------|
| `ci.yml` | CI 파이프라인 (lint → format:check → typecheck×3 → **audit×7** → test → build, push[main]/PR 트리거). **세션 491**: `concurrency` 로 PR 연속 푸시 시 낡은 실행 자동 취소. ⚠️ `pull_request` 에 `paths-ignore` 를 넣지 않은 것은 **의도** — 경로 필터로 건너뛴 체크를 브랜치 보호의 required status check 로 걸면 PR 이 "Waiting for status" 로 영구히 막힌다 |
| `e2e.yml` | Playwright E2E 테스트 (PR 트리거). **세션 491**: `paths-ignore`(docs·md·.claude·scripts·supabase) + `concurrency` + 브라우저 캐시. ⚠️ `paths-ignore` 에 `.github/workflows/**` 를 넣으면 이 파일 자신을 고칠 때 검증이 사라진다 — 절대 금지 |
| `warm-playwright-cache.yml` | **세션 491 신설** — 매주 화 KST 02:00, `main` 에서 브라우저 캐시를 미리 채운다. Actions 캐시는 "만든 브랜치 + 기본 브랜치"에서만 읽히는데 `e2e.yml` 은 PR 전용이라 이 예열이 없으면 캐시가 매번 미스된다. **캐시 키를 `e2e.yml` 과 동일하게 유지할 것** — 어긋나면 `scripts/audit-playwright-cache.mjs` 가 CI 에서 차단 |

### 매주 (4개) + 격주 (2개)

> **세션 491 (Actions 비용 감축)**: `collect-trade-stats`·`collect-trade-stats-regions` 주간→격주,
> `calc-exclusive-ratio` schedule 삭제(매일 경로와 중복). 근거·검증법은 아래 "세션 491 감축" 절 참조.

| 워크플로우 | 설명 |
|-----------|------|
| `collect-trade-stats.yml` | 거래 통계 산출 (**격주 7·21일** 16:00 UTC — 세션 491: 주 입력 trades 가 매월 6일에만 갱신되므로 주간은 과잉) |
| `collect-trade-stats-regions.yml` | 시군구 거래 통계 (**격주 7·21일** 16:30 UTC, trade-stats 직후) |
| `calc-layout.yml` | 평면구조 추정 (일요일 23:00 UTC, 세션273: calc-collection 그룹 분리). **세션 491**: 세 조회가 전부 max_rows=1000 에 걸려 3주 연속 갱신 0건이던 것을 매칭 선행 + `.in()` 분할로 복구 (dry-run 실측 **갱신 490건**) |
| `collect-nearby-childcare.yml` | 단지 1km 내 어린이집 근접 계산 (**세션 491: 매일 → 주 1회 화** — 입력이 82일째 정지 + 재계산 결과 677건 × 8필드 전부 동일). **세션 491 문서 추가** (그동안 표에 없었다) |
| `collect-applyhome-detail.yml` | 청약홈 분양일정·평형 (월 12:30 KST — 세션 467 매월 13일→주간: 월간이면 신규 공고의 미래 접수일이 못 들어와 알림 이벤트 소스가 죽음) |
| `notify-subscribers.yml` | 분양 알림 발송기 (월 14:00 KST, 세션 467) — subscribers × 접수 시작 D-0~7 대조. 기본 dry-run(notification_logs 적재+텔레그램 요약), live = PR3(SMS_ADAPTER_READY=true)+SOLAPI Secrets 둘 다 필요. concurrency `notify` 독립 |

### 매월 (18개) + 수동 전용 (4개)

> **세션 288~289: KOSIS 의존 10개 GH 폐기 → 집서버 로컬 러너 이전.** kosis.kr 이 GitHub 러너(해외
> Azure IP)를 차단해 `collect-{unsold-kosis,market-stats,migration,jeonse-price-index,regional-economy,fertility-rate,housing-supply-ratio,medical-access,avg-income,sale-price-index}.yml`
> 10개 삭제. 수집 = `scripts/kosis-local-runner.mjs` (Windows 작업 `MibunyangKosisLocal`, 매일 05:30 KST
> 일자 디스패치, `scripts/register-kosis-task.ps1` 로 등록). 감시 = monitor ⑤ `EXTERNAL_API_COLLECTORS`
> (collector_runs 신선도 — GH run 없음). 수동 보충 = `node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD`.
>
> **세션 399: childcare 3종(api.childcare.go.kr 평문 HTTP) GH 폐기 → 집서버 로컬 러너 이전.** 해외
> Azure IP 차단으로 `collect-childcare-detail.yml`·`collect-childcare-jeju.yml` 삭제 +
> `collect-childcare.yml` 의 info step 제거(Kakao step 만 GH 잔존). 수집 = `scripts/childcare-local-runner.mjs`
> (Windows 작업 `MibunyangChildcareLocal`, 매일 04:30 KST 3종 전부 실행, `scripts/register-childcare-task.ps1` 로
> 등록). 감시 = monitor ⑤ `EXTERNAL_API_COLLECTORS` (childcare-detail/info/info-jeju, collector_runs 신선도).

| 워크플로우 | 일자 | 설명 |
|-----------|------|------|
| `collect-infra.yml` | **수동만** | Kakao Places 인프라 — 세션 491 schedule 삭제. 매일 경로(`collect-naver-listings-incremental.yml`)가 같은 `infra-kakao.mjs` 를 무인자로 실행하므로 중복이었다 |
| `collect-transport.yml` | **수동만** | Kakao Places 교통 — 세션 491 schedule 삭제(동일 사유, `transport-tago.mjs`). dispatch 는 `--force` 전체 재수집 창구 |
| `collect-schools.yml` | **수동만** | NEIS 학교 — 세션 491 schedule 삭제(동일 사유, `schools-neis.mjs`). dispatch 는 limit/force 보충 창구 |
| `calc-exclusive-ratio.yml` | **수동만** | 전용률 계산 — 세션 491 주간 schedule 삭제. `collect-naver-listings.yml`(Core) 마지막 스텝이 같은 스크립트를 **매일** 실행해 중복이었다(주간보다 오히려 잦다) |
| `collect-noise.yml` | 1일 | 소음 추정 |
| `collect-environment.yml` | 1일 | 환경/혐오시설 |
| `collect-noxious.yml` | 3일 | 혐오시설 거리 (세션260: 1일→3일 분산, 60분 장시간 작업) |
| `collect-industry.yml` | 7일 | 산업단지 매칭 (세션260: 1일→7일 분산) |
| `collect-childcare.yml` | 1일 | Kakao 어린이집/유치원 (info step 은 세션 399 로컬 이전) |
| `collect-police.yml` | 1일 | Kakao 경찰관서 밀도 |
| `collect-emergency.yml` | 2일 | 응급의료기관 |
| `collect-population.yml` | 5일 | 행안부 인구 증감률 |
| `collect-trades.yml` | 6일 | 국토부 실거래 (매매/전세/분양권) |
| `collect-molit-units.yml` | 6일 | 국토부 총세대수 보정 |
| `collect-building-info.yml` | 10일 | 건축물 상세 (토요일 → 11일 fallback) |
| `collect-housing-permits.yml` | **분기 10일** | 주택 인허가 — 세션 491 월간→분기. MOLIT API 장기 중단으로 3회 연속 ok=0. 회복(`성공 N`>0) 확인 시 월간 복귀 |
| `collect-air-quality.yml` | 매주 월 | 에어코리아 대기질 |
| `collect-applyhome.yml` | 주간 (월 11:30 KST) | 청약홈 신규 ah-* seeding(세션 466, 좌표 정밀 중복 게이트) → 잔여세대 경쟁률 |
| `collect-maintenance.yml` | 15~19일 | 공동주택 관리비 (UTC 06:00 = **KST 15:00** — 세션 500 에 UTC 03:00 에서 이동. 옛 시각은 15~19일 중 월요일에 주간 청약홈 체인 2개를 실행창(120분) 안에 받아 `data-collection` 그룹 대기 자리를 밀어냈다 = 조용한 취소. 가드 `audit-cron-concurrency.mjs`) |
| `collect-building-hub.yml` | **분기 15일** | 건축HUB 에너지+인허가 — 세션 491 월간→분기. 04-15·05-18·06-15 세 실행 모두 `성공 0 \| 스킵 2000`(API 2,794회 호출·신규 0건). 10/15 에 `성공 N`>0 이면 월간 복귀 |
| `collect-housing-price.yml` | 16일 | 주택가격 (KST 17일 07:00 — 15일 migration/maintenance/building-hub 다음 날). **세션 491 문서 추가** — 그동안 이 표에 아예 없었다 |
| `collect-dart-builders.yml` | 분기별 | DART 시공사 재무 |

### 모니터링 (2개)

| 워크플로우 | 설명 |
|-----------|------|
| `monitor-db-size.yml` | Supabase 테이블별 행 수 점검 (매월 1일 KST 06:00) |
| `monitor-collectors.yml` | 수집기 실패/취소/0건/미발화/NULL급증 텔레그램 알림 (workflow_run 즉시 + 매일 KST 09:00 스윕). 새 collect-*.yml 추가 시 workflow_run.workflows 목록에 name 추가 의무 — `scripts/audit-monitor-coverage.mjs` 가 CI 에서 누락 차단. **세션 491: job 에 `if: github.event_name != 'workflow_run' \|\| github.event.workflow_run.conclusion != 'success'` 추가** — 트리거가 성공이면 감시 잡을 안 띄운다(실측 39회 중 35회가 "이상 없음"만 찍고 1분씩 과금). 실패·취소 알림은 그대로 즉시, "빈 성공"(ok=0)만 daily 스윕으로 최대 24h 지연 |

### 유틸리티 (5개)

| 워크플로우 | 설명 |
|-----------|------|
| `seed-data.yml` | 초기 데이터 시딩 |
| `backfill-new-apartments.yml` | **Phase 1+2 만 잔존** (세션 453: `fill-missing-data.yml` 에서 개명 — 동작이 backfill 로 좁혀짐) — Phase 1 좌표 backfill (geocode-missing+reverse-geocode) + Phase 2 matrix **2 일꾼** (calc-floors+regulation-seed — 세션 491: `sync-naver-complex` 제거, `collect-naver-listings.yml`(Naver Core)이 매일 같은 스크립트를 실행하는 중복이었다). **세션 308 (PR #11)**: Phase 3+4+5 일괄 폐기 — 외부 cron 가진 11 일꾼 (transport-tago/infra-kakao/environment/noise-estimate/noxious/dart-builders/molit-building-info/population/migration/collect-trades/trade-stats) 제외 + `audit-fill-matrix.mjs` CI 가드 신규. 5/31 발화 6번째 누적 cancelled 차단. 직전: 세션 273 calc 그룹 분리, 세션 291 phase2-calc 6→3, 세션 298 phase3 timeout 60→120, 세션 306 schools-neis 제거 |
| `geocode-missing.yml` | 좌표 누락 지오코딩 |
| `reverse-geocode.yml` | 좌표 → 주소 역지오코딩 |
| `purge-consults.yml` | 보존기간(365일) 경과 상담 자동 파기 (매일 KST 04:30, PIPA §21 — 세션 443 D4). `collect-*` 패턴 밖이라 monitor/audit 무관, 실패 시 `collector_runs` status=failure 기록 |

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
| `KOSIS_KEY` | KOSIS 국가통계포털 — 세션 289 로컬 러너 이전으로 GH 워크플로 사용 0 (집서버 `.env` 만, 시크릿 잔존은 무해) | - |
| `TAGO_KEY` | ~~TAGO 대중교통~~ — 세션 498(#337) 정적 파일 전환으로 **워크플로 주입 제거**(TAGO 호출 0). 시크릿 잔존은 무해 | - |
| `NEIS_KEY` | NEIS 교육정보 (선택, 미등록 시 스킵) | - |
| `SCHOOLINFO_KEY` | 학교알리미 학생수 (선택) | - |
| `AIRKOREA_KEY` | 에어코리아 대기질 (선택) | - |
| `CHILDCARE_API_KEY` | info.childcare.go.kr cpmsapi021 어린이집 목록 (세션 252) — 세션 399 로컬 러너(`childcare-local-runner.mjs`) 이전으로 GH 워크플로 사용 0 (로컬 `.env` 만, 시크릿 잔존은 무해) | - |
| `CHILDCARE_BASIC_API_KEY` | info.childcare.go.kr cpmsapi030 어린이집 70 필드 상세 (세션 256) — 세션 399 로컬 러너 이전으로 GH 워크플로 사용 0 (로컬 `.env` 만, 시크릿 잔존은 무해) | - |
| `SUBSCRIBERS_OPT_OUT_SECRET` | 분양 알림 수신거부 HMAC (Vercel 과 동일 값 유지 의무 — 드리프트 시 문자 속 철회 링크 전부 401, 세션 467) | - |
| `SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/`SOLAPI_SENDER` | 분양 알림 SMS 실발송 3종 (미등록 = notify-subscribers 자동 dry-run). ⚠️ 주입은 PR3(sendSms 실구현+SMS_ADAPTER_READY=true) 머지 후 — 스텁 상태 live 진입은 코드 게이트가 차단하지만 순서 지키는 게 정석 (세션 467) | - |

---

## 세션 491 감축 — Actions 비용

### 배경 (실측)

2026-07-13~31 **19일간 계정 지출한도 초과로 모든 잡이 시작조차 못 했다**(check-run annotation 원문:
`The job was not started because recent account payments have failed or your spending limit needs to be increased`).
잡이 2~3초 만에 `steps: []` 로 끝나 "수집기 고장"처럼 보이지만 코드 문제가 아니다 — **실패 로그를 볼 때
반드시 `steps` 배열이 비었는지 먼저 확인할 것.**

계정의 **비공개 레포 12개가 월 2,000분 무료 한도를 공유**한다(초과분 $0.006/분, 공개 레포는 한도 미소모).
8/1~8/4 실측 하루 483분 → 월 환산 14,973분 → 청구 약 $78. 예산은 $80 으로 상향돼 있으나 여유가 하루 반뿐이라
감축이 필수였다.

### ⚠️ 측정 방법 (틀리기 쉬움)

`updated_at − run_started_at`(벽시계)로 재면 **큐 대기가 섞이고 GitHub 은 큐 대기를 과금하지 않는다.**
실측 예: Purge Old Consults 가 벽시계로는 4일 61분이었으나 실제 과금은 **회당 17~20초**(나머지 53분은
`data-collection` 그룹 대기). 반드시 jobs API 로 잡 실행 시간을 재고, **잡마다 분 단위 올림** 과금임을
감안할 것(수집기 잡 79개 중 52개가 이미 1분 바닥이라 준비시간 단축은 절감 0).

```bash
gh api "repos/developer-duno/mibunyang/actions/runs/<id>/jobs" \
  --jq '.jobs[].steps[] | "\(.number). \(.name) | \(.started_at) ~ \(.completed_at)"'
```

### 이번에 바꾼 것

| 대상 | 변경 | 근거 |
|---|---|---|
| `monitor-collectors.yml` | job `if:` 로 workflow_run 성공 시 미발화 | 39회 중 35회가 "이상 없음"만 찍음 |
| `collect-nearby-childcare.yml` | 매일 → 주 1회(화) | 입력이 82일째 정지 + 재계산 결과 677건 × 8필드 전부 동일 |
| `collect-trade-stats(-regions).yml` | 주간 → 격주(7·21일) | 주 입력 trades 가 매월 6일에만 갱신 |
| `calc-exclusive-ratio.yml` | schedule 삭제 | Naver Core 가 매일 같은 스크립트 실행 |
| `collect-{transport,infra,schools}.yml` | schedule 삭제 | incremental 이 매일 **동일 무인자 명령** 실행 |
| `collect-housing-permits.yml` | 월간 → 분기 | MOLIT API 장기 중단, 3회 연속 ok=0 |
| `collect-building-hub.yml` | 월간 → 분기 | 3회 연속 `성공 0 \| 스킵 2000` |
| `backfill-new-apartments.yml` | `sync-naver-complex` 제거 | Naver Core 와 중복 |

**2차 (검사·배포 워크플로)**

| 대상 | 변경 | 근거 |
|---|---|---|
| `ci.yml` | `concurrency`(PR 한정 낡은 실행 취소) + audit 6번째 등록 | 같은 PR 연속 푸시 시 옛 커밋 검사가 끝까지 돌던 낭비 |
| `e2e.yml` | `paths-ignore` + `concurrency` + 브라우저 캐시 | 화면과 무관한 PR 에도 실브라우저 검사가 돌던 낭비 |
| `warm-playwright-cache.yml` | 신설 (주 1회 main 예열) | Actions 캐시는 만든 브랜치·기본 브랜치에서만 읽힘 → PR 전용 워크플로 혼자서는 캐시 재사용 불가 |
| `daily-deploy.yml` | 두 잡 → 한 잡 | `needs` 로 순차인데 준비(checkout·npm ci)를 두 번 태우고 분 올림도 두 번 |
| `scripts/audit-playwright-cache.mjs` | 신설 + CI 등록 | 캐시 키가 어긋나면 **영원히 미스인데 CI 는 초록** — 사람 주석으로 못 막는 유형 |

**3차 (수집기 구조 — 비용 + 데이터 복구)**

| 대상 | 변경 | 근거 |
|---|---|---|
| `noxious.mjs` | 증분 수집(`noxious == null` 만) + **단지 단위 즉시 저장** + `createReporter`/`break`/`recordCollectorRun` | 전수 2,170건 × 2.9초 = **105분인데 제한 60분** → 매 실행이 60분 태우고 저장 직전 SIGKILL(유예 0). 3개월 연속 쓰기 0건. 대상 **2,170 → 236건(11분)**, 미채움 236건 복구 |
| `calc-layout.mjs` | `selectAll` + **매칭 선행 후 필요한 단지만 articles 조회** | `.limit(10000)` 은 max_rows=1000 에 걸리고 limit 없는 조회도 기본 1000. 세 곳이 각각 잘려 **서로 다른 1000개끼리 매칭 → 3주 연속 갱신 0건**. dry-run 실측 결과 **갱신 0 → 490건**(layout 공백 69.7% → 38.9%) |

> ⚠️ **`articles` 를 전량 `selectAll` 하면 안 된다** — 처음엔 세 조회를 그냥 `selectAll` 로 바꿨는데
> dry-run 에서 `canceling statement due to statement timeout` 으로 **실패**했다(17만 행).
> 그대로 머지했으면 매주 실패했을 것이다. 게다가 `articles`(131만 행)는 자매 레포
> **naver-estate-web 과 공유하는 테이블**이라 무거운 전량 조회는 저쪽 라이브에도 부담이다.
> 처방 = 이름 매칭을 **먼저** 수행해 필요한 `complex_no` 만 추린 뒤 `.in()` 으로 200개씩 조회
> (실측: 17만 → **30,890건 / 단지 536개**). 부수적으로 옛 코드가 `aptToComplexes.get()` 이
> 돌려준 배열에 직접 push 해 원본 색인을 오염시키던 버그도 사라졌다.
>
> ℹ️ `complex_links` 테이블은 존재하지 않고, **이름 유사도 폴백이 원래 설계**다
> (`sync-naver-complex.mjs:249` 도 같은 로그를 남긴다). 사고가 아니다.
| `_graceful-coverage.test.mjs` | ALLOWLIST 에서 `noxious.mjs` **제거** | graceful 을 넣었으니 이제 검사 대상. 남겨두면 나중에 `break` 가 지워져도 아무도 모른다 |

> ⚠️ `noxious` 는 **발견 0건도 빈 배열(`[]`)로 기록**한다. "조회했고 없음"과 "아직 안 함"을
> 구분해야 다음 회차에 건너뛸 수 있기 때문. 점수(`scoreLocation.ts:116`)·화면(`AptCard.tsx:98`)
> 모두 `(noxious || [])` 로 읽어 `null` ↔ `[]` 의 표시·점수 영향은 0 임을 실측 확인했다.
>
> ⚠️ 또 하나의 가짜 초록불 — 테스트 12건이 전부 통과하는데도 `Number.isFinite` 가드는
> **아무도 지키지 않았다**(지워도 통과). 발견 0건 케이스만 봤기 때문이고, 가드가 진짜 필요한
> "발견은 있는데 거리가 Infinity" 케이스를 추가하고 나서야 뮤테이션이 잡혔다.
> **테스트가 통과한다 ≠ 그 코드가 지켜진다.**

> ⚠️ 작성 중 실제로 낸 버그 — `extractCacheKeys` 정규식을 `\S+` 로 썼다가 키 안의
> `${{ runner.os }}` 공백에서 잘려 **정상 상태를 "키 없음"으로 오판**했다. 뮤테이션 검증
> (일부러 한쪽 버전을 올려보기)에서 잡았다. 감사 스크립트를 새로 만들 땐 "정상이 통과하는가"와
> "고장이 걸리는가"를 **둘 다** 확인할 것.

### 🔴 필수 상태 검사(required status checks)는 이 저장소에 **켤 수 없다** — 실측 확정

**세션 491 에서 실제로 켰다가 `daily-deploy` 가 즉시 깨져 되돌렸다.**

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Required status check "ci" is expected.
! [remote rejected] main -> main (protected branch hook declined)
```

원인: `daily-deploy.yml:59` 이 `git push origin main` 으로 **데이터 갱신 커밋을 main 에 직접 민다.**
필수 상태 검사가 켜져 있으면 **봇의 직접 push 도 거부된다** — 새 커밋에는 검사 기록이 없기 때문이다.

> ⚠️ 공식 문서의 *"any commits must either be pushed to another branch and then merged **or pushed
> directly to the protected branch**"* 를 "직접 push 가 허용된다"로 읽으면 안 된다.
> **"그 커밋에 대해 검사가 이미 통과한 경우"** 를 뜻하고, 새로 만든 커밋은 영원히 거부된다.
> `GITHUB_TOKEN` 은 관리자가 아니라 `enforce_admins: false` 로도 우회되지 않는다.

**따라서 `ci.yml` 의 `push: branches: [main]` 을 뺄 수 없다.** 빼려면 필수 검사가 있어야 하는데
필수 검사를 켜면 매일 배포가 죽는다. 둘은 양립 불가다.

가능한 길 (착수 전 손익 계산할 것 — 절감은 월 312분 ≈ **$1.9** 뿐이다):

| 안 | 내용 | 비용 |
|---|---|---|
| A | `daily-deploy` 를 **PR 방식**으로 전환 (봇이 브랜치 → PR → 자동 머지) | 작업량 큼, 매일 PR 이 쌓임 |
| B | 필수 검사 대신 **PR 리뷰 필수**만 — 검사 강제는 못 하나 직접 push 는 허용 | 검사 강제 실패 |
| C | **그대로 두기** — 사람이 CI 를 지키고 월 312분은 포기 | 0 |

**현재 판단 = C.** 매일 배포 구조를 흔드는 대가가 $1.9 보다 크다.

현재 main 보호 상태(세션 491 되돌린 뒤): `required_linear_history` ✅ / `allow_force_pushes` ❌ /
`allow_deletions` ❌ / **`required_status_checks` 없음(의도적)**.

### 되돌리는 법

전부 cron/트리거만 바꿨으므로 해당 줄을 원복하면 끝난다. **되돌려야 하는 신호**:
`collect-building-hub` 가 분기 실행에서 `성공 N`>0 을 찍으면(=API 회복) 월간으로,
`collect-housing-permits` 도 마찬가지. 감시는 monitor ⑤ `EXTERNAL_API_COLLECTORS` 가 담당하는데
**월간→분기로 내렸으므로 해당 `stale_days` 기준(월간 38 / 분기 100)도 함께 맞춰야 한다.**

### 손대지 않은 것 (검증에서 기각)

- **`purge-consults.yml` 주기 축소** — 실제 과금이 하루 1분뿐이고, 줄이면 PIPA 파기가 최대 7일 지연 → 손해
- **`collect-maintenance.yml` 5일 연속 cron 축소** — 5연속 실패는 코드 결함이 아니라 위 계정 정지 탓.
  5일 연속은 미채움을 `--limit=600` 으로 나눠 채우려는 **의도된 설계**다. 8/15 첫 실전 로그 확인이 먼저
  > **세션 500 후속**: 이 판단은 유효했다. 7/16~19 관리비 4연속 failure 를 독립적으로 재조사한 결과
  > 같은 결론(계정 지출한도 — 그 나흘간 CI·E2E 까지 레포 전체가 2초 `steps: []` 로 전멸, Actions 분을
  > 안 쓰는 Dependabot 만 성공, `collector_runs` 행 0)에 도달했다. 8/6 18:29 의 `fetch failed` 600건은
  > 별건의 **외부 MOLIT 순단**이고(17개 시도 목록 조회가 각각 34.5초씩 연결 실패, 같은 코드가 4시간 뒤
  > 3,160회 호출로 성공) 5일 연속 cron 이 이미 흡수하는 설계다. **다만 시각(UTC 03:00)은 옮겼다** —
  > 5일 span·`--limit` 은 그대로 두고 hour 만 06:00 으로. 근거는 위 매월 표의 관리비 행 참조.
- **준비시간(checkout·setup-node·npm ci) 단축 / `--omit=dev`** — 잡당 평균 15.8초(전체의 3.6%), 분 올림 때문에 절감 시뮬레이션 0분
- **Playwright 에서 webkit 제거** — 월 147분으로 최대지만 `e2e/mobile.spec.ts` 4건이 모바일 사파리 회귀를 잡는 유일한 그물
