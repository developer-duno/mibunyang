# 외부 API 장기 중단 정책 — 탐지·대기·재시도·알림 패턴 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/workflows/external-api-outage-policy.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 318~328)

housing-permits 수집기가 MOLIT 500 응답 4월 10일 이후 5월 내내 장애. collector_runs 행은 정상 (graceful 적용 후 partial) 이나 데이터 갱신 0건. 1개월+ 누적 후 발견.

raw API 진단:
- `apis.data.go.kr/1613000/HousingLicenseService` 응답 = HTTP 500 (API 서버 자체 장애)
- 본인 책임 0 (외부 API 자체 사고)
- 그러나 모니터링 = "collector 정상 실행 + 데이터 0건" 사고 답습 0 → 운영 데드존

**환각 정정 자산 (v1 → v2, 세션 334 박힘)**:
- `phase` → `collector` (collector_runs 진실의 원천 컬럼명)
- `allOk = ok_count > 0` 역방향 환각 → `allEmptySuccess = status==='success' && ok_count===0`
- `transport-tago` → `transport`, `schools-neis` → `schools` (PHASE 실측)
- `building-hub` entry 추가 (5/18 ok=0 silent fail 실측)
- 경로 `scripts/collectors/monitor-collectors.mjs` → `scripts/monitor-collectors.mjs`
- `type` → `kind`, `'external_api_outage'` → `'outage'` (Issue 타입 정합)

## 답습 자산

- 세션 264 `category-null-monitor` 4 카테고리 박힘 답습 (apartments 19 + 시도 17 + 51 필드 + NULL 추세)
- 세션 265 월간 schedule 데드존 monitor 답습 (`secret-naming-audit.md` 운영 모니터링 절)
- 세션 295 collector timeout 4-way 답습 (`collector-timeout-rootcause-analysis.md`)
- 본 룰 신규 = 5번째 카테고리 (외부 API 장기 중단)
- 세션 318~328 housing-permits 사고 (1개월+ 데이터 갱신 0건)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 외부 API collector 추가 후 1개월 silent fail | §1 EXTERNAL_API_COLLECTORS 배열 박힘 의무 → 월간 monitor 발화 |
| collector_runs 정상 + 데이터 stale 답습 0 | §2 점검 ⑤ 발동 → silent fail 7일 이내 발견 |
| 외부 API 영구 폐기 (KOSIS 통계표 ID 변경) | §3 raw API 호출 + 공식 공지 답습 → BACKLOG 박힘 |
| "외부 API 책임이라 본인 무관" 단정 | §안티 패턴 grep → 모니터 박힘 의무 답습 |

## stale_days 정정 답습 (세션 339)

- 세션 318~328 housing-permits 1개월+ silent fail 사고 박힘 시점에 schools=35 로 박은 가정 = "NEIS 분기 발화" 환각. 실제 = `collect-naver-listings-incremental.yml` 안 schools step 매일 발화 + 월간 `collect-schools.yml` 자매 동시 동작.
- 세션 338 사고 (3주 cancelled = 5/22 + 5/26 + 5/27) 가 35일 한계 안에 묻혀 monitor §5 alert 발화 0회. 일일 cron 기준 = 14 (1주 여유 포함) 정정 후 다음 3주+ 사고 시 alert 즉시 박힘.
- 진실의 원천 = `scripts/monitor-collectors.mjs:176` 의 `EXTERNAL_API_COLLECTORS` 배열. 본 md L63-67 sample 은 그 코드와 동기 의무 (drift 시 코드 우선).
- **세션 463 정정 (역방향 사고)**: 세션 339 가 "일일=14" 를 정정하며 남긴 주석 "(월간/일일=14)" 환각이 월간 cron 2종(housing-permits 월 10일·building-hub 월 15일)에 14 로 잔존. monitor 는 매일 발화라 ⑤-b 미발화 분기가 발화일+14일부터 다음 발화까지 **매일 거짓 stale 경보** + `continue` 로 진짜 outage 판정(housing-permits MOLIT 500 장기 중단)까지 가림. 당시 두 collector 의 collector_runs 행이 2개뿐(3행 미만 오탐 차단)이라 미발화 상태로 잠복 — 3번째 발화(7/10·7/15) 후 발화 예정이던 것을 선제 정정 14→38 (applyhome-detail·maintenance·KOSIS 월간 38 답습). 기준 = **일일=14 / 월간=38 / 분기=100**, cron yml grep 후 박힘.
- **세션 496 보강 (주간 항목 신설)**: 위 기준표에 **주간이 빠져 있었다**. 그런데 코드에는 이미 주간 cron collector 3종이
  `stale_days: 14` 로 박혀 있다 — `applyhome-seed`(`collect-applyhome.yml` 안 step, 월 11:30 KST)·
  `applyhome-detail`(월 12:30, 세션 467 주간화)·`notify-subscribers`(월 14:00).
  (PR #330 이 머지되면 `applyhome-remndr`(월 13:30)이 같은 값으로 4번째가 된다.)
  산식은 일일과 같은 꼴로 **발화주기 7일 + 여유 7일 = 14**.
  값 자체는 맞는데 **근거가 룰에 없어서** 다음 세션이 기준표만 보고 주간 collector 를 월간(38)으로 오설정할 여지가 있었다
  — 세션 463 사고가 정확히 "기준표에 없는 주기를 옆 항목 값으로 채운" 결과였으므로 같은 자리를 미리 막는다.
  **최종 기준 = 일일=14 / 주간=14 / 월간=38 / 분기=100** (전부 "발화주기 + 여유 1주기" 꼴, cron yml grep 후 박힘).

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션) — 보강

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 외부 API collector `stale_days` 환각 박힘 (cron 주기 미답습) | 본 md §"stale_days 정정 답습" 절 답습 의무 → cron yml grep 1회 후 stale_days 박힘 |
| 일일 cron collector 가 `stale_days: 35` 박힘 = 3주 사고 묻힘 | 세션 339 정정 답습 자산 → 14 의무 |
