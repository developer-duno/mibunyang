# GitHub Actions 워크플로우 규칙

> 워크플로우 수정/추가 시 반드시 이 규칙을 따를 것.

## 워크플로우 목록

### 매일 (2개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-naver-listings.yml` | 네이버 후처리 (sync + 전용률 계산) |
| `daily-deploy.yml` | Vercel 자동 배포 (KST 03:00) |

> 세션 399: `collect-childcare-detail.yml` 삭제 → 집서버 로컬 러너 이전 (아래 KOSIS 절 옆 childcare 절 참조).

### CI/CD (2개)

| 워크플로우 | 설명 |
|-----------|------|
| `ci.yml` | CI 파이프라인 (린트 + 테스트 + 빌드, push/PR 트리거) |
| `e2e.yml` | Playwright E2E 테스트 (push/PR 트리거) |

### 매주 (5개)

| 워크플로우 | 설명 |
|-----------|------|
| `collect-trade-stats.yml` | 거래 통계 산출 (일요일 16:00 UTC) |
| `calc-exclusive-ratio.yml` | 전용률 계산 (일요일 22:00 UTC, 세션273: calc-collection 그룹 분리 — data-collection 큐 경합 회피) |
| `calc-layout.yml` | 평면구조 추정 (일요일 23:00 UTC, 세션273: calc-collection 그룹 분리) |
| `collect-applyhome-detail.yml` | 청약홈 분양일정·평형 (월 12:30 KST — 세션 467 매월 13일→주간: 월간이면 신규 공고의 미래 접수일이 못 들어와 알림 이벤트 소스가 죽음) |
| `notify-subscribers.yml` | 분양 알림 발송기 (월 14:00 KST, 세션 467) — subscribers × 접수 시작 D-0~7 대조. 기본 dry-run(notification_logs 적재+텔레그램 요약), live = PR3(SMS_ADAPTER_READY=true)+SOLAPI Secrets 둘 다 필요. concurrency `notify` 독립 |

### 매월 (20개)

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
| `collect-infra.yml` | 1일 | Kakao Places 인프라 |
| `collect-transport.yml` | 4일 | Kakao Places 교통 (세션260: 1일→4일 분산) |
| `collect-schools.yml` | 2일 | NEIS 학교 (세션118: 1일→2일 이동 + school-collection 그룹 분리) |
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
| `collect-housing-permits.yml` | 10일 | 주택 인허가 |
| `collect-air-quality.yml` | 매주 월 | 에어코리아 대기질 |
| `collect-applyhome.yml` | 주간 (월 11:30 KST) | 청약홈 신규 ah-* seeding(세션 466, 좌표 정밀 중복 게이트) → 잔여세대 경쟁률 |
| `collect-maintenance.yml` | 15일 | 공동주택 관리비 |
| `collect-building-hub.yml` | 15일 | 건축HUB 에너지+인허가 |
| `collect-dart-builders.yml` | 분기별 | DART 시공사 재무 |

### 모니터링 (2개)

| 워크플로우 | 설명 |
|-----------|------|
| `monitor-db-size.yml` | Supabase 테이블별 행 수 점검 (매월 1일 KST 06:00) |
| `monitor-collectors.yml` | 수집기 실패/취소/0건/미발화/NULL급증 텔레그램 알림 (workflow_run 즉시 + 매일 KST 09:00 스윕). 새 collect-*.yml 추가 시 workflow_run.workflows 목록에 name 추가 의무 — `scripts/audit-monitor-coverage.mjs` 가 CI 에서 누락 차단 |

### 유틸리티 (4개)

| 워크플로우 | 설명 |
|-----------|------|
| `seed-data.yml` | 초기 데이터 시딩 |
| `backfill-new-apartments.yml` | **Phase 1+2 만 잔존** (세션 453: `fill-missing-data.yml` 에서 개명 — 동작이 backfill 로 좁혀짐) — Phase 1 좌표 backfill (geocode-missing+reverse-geocode) + Phase 2 matrix 3 일꾼 (sync-naver-complex+calc-floors+regulation-seed). **세션 308 (PR #11)**: Phase 3+4+5 일괄 폐기 — 외부 cron 가진 11 일꾼 (transport-tago/infra-kakao/environment/noise-estimate/noxious/dart-builders/molit-building-info/population/migration/collect-trades/trade-stats) 제외 + `audit-fill-matrix.mjs` CI 가드 신규. 5/31 발화 6번째 누적 cancelled 차단. 직전: 세션 273 calc 그룹 분리, 세션 291 phase2-calc 6→3, 세션 298 phase3 timeout 60→120, 세션 306 schools-neis 제거 |
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
| `TAGO_KEY` | TAGO 대중교통 (data.go.kr) | O |
| `NEIS_KEY` | NEIS 교육정보 (선택, 미등록 시 스킵) | - |
| `SCHOOLINFO_KEY` | 학교알리미 학생수 (선택) | - |
| `AIRKOREA_KEY` | 에어코리아 대기질 (선택) | - |
| `CHILDCARE_API_KEY` | info.childcare.go.kr cpmsapi021 어린이집 목록 (세션 252) | O |
| `CHILDCARE_BASIC_API_KEY` | info.childcare.go.kr cpmsapi030 어린이집 70 필드 상세 (세션 256) | O |
| `SUBSCRIBERS_OPT_OUT_SECRET` | 분양 알림 수신거부 HMAC (Vercel 과 동일 값 유지 의무 — 드리프트 시 문자 속 철회 링크 전부 401, 세션 467) | - |
| `SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/`SOLAPI_SENDER` | 분양 알림 SMS 실발송 3종 (미등록 = notify-subscribers 자동 dry-run). ⚠️ 주입은 PR3(sendSms 실구현+SMS_ADAPTER_READY=true) 머지 후 — 스텁 상태 live 진입은 코드 게이트가 차단하지만 순서 지키는 게 정석 (세션 467) | - |
