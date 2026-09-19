# Collector timeout 사고 root cause 분석 — 4-way 답습 의무 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/collectors/collector-timeout-rootcause-analysis.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 295)

세션 294 가 `collect-naver-listings-incremental.yml` 5/22 schedule run 26311529575 cancelled (transport-tago 2.1배 느림) 박제 시 **timeout 90→120 임시 완화 + BACKLOG "root cause 분석 별 세션 자리" 박제**. 세션 295 진입 자리 = "코드/API 결함 자리 정확 정정 의무".

세션 295 v1 환각: "apartments 단지 수 1000→2001 폭증 (네이버 신규 추가)". 자가 점검 1 발동 → `apartments.created_at` 실측 = 30일+ 이전 박제 자리 (마지막 2026-04-07) → 신규 추가 0 자리 확정. v1 환각 폐기.

v2 정정: `git log -- scripts/collectors/transport-tago.mjs` 답습 결과 커밋 `01d0dd4` (2026-05-22 07:42) `limit(10000) → range 페이지네이션` 박제. 메시지 인용:

> PostgREST max_rows=1000 제한 우회 — limit(10000) 환각 (실제 1000 행만 반환) 정정. transport-tago L194 자리 포함.

진앙 자리 확정 = **collector 본문 변경 (5/22 07:42)**. timeout 90→120 fix 는 회귀 자리 없는 정확한 정정 자리.

## 답습 자산

- 세션 294 timeout 90→120 fix 커밋 `b313b56` (`collect-naver-listings-incremental.yml`)
- 세션 295 본 룰 박제 시점 = R1 분석 종결 자리 확정
- 커밋 `01d0dd4` (2026-05-22) PostgREST max_rows=1000 fix 16건 일괄 정정 자리 — 답습 자산 (cross-collector 영향 자리)
- `.claude/rules/workflows/secret-naming-audit.md` §"운영 모니터링 (월간 schedule)" 절 답습 (월간 cron 데드 존 박제)
- 세션 309 trade-stats.mjs DSR batch fix (`createSemaphore(10)` + `Promise.all`) — Supabase 직렬 update timeout 진앙 정정 답습 자산. `docs/superpowers/specs/2026-05-25-trade-stats-dsr-batch-fix-design.md` 박제 (박힘 환각 7건 정정 + 진단 자리)
- 세션 327 사고 = Plan agent + 본인 환각 누적 **9건** 자가 점검 1 v2/v3 발동 후 정정. 패턴 = "Plan agent → 본인 grep → 추가 의심 발견 → 추가 grep → 9건 정정". raw log + `gh run view --json jobs` step 시간 둘 다 답습 의무. **메모리 박힘 값은 진실의 원천 아님** (예: `collector_runs` 스키마 = `ok_count`/`fail_count`/`skip_count` not `ok`/`fail`/`skip`). PR #28 graceful 박힘 = 46+ collector 중 완전 적용 4건 (9%) — `createReporter` 사용만으로 적용 단정 = 환각

## 세션 338 schools-neis NEIS 12배 지연 + 데이터 완결성 resume skip (PR #51)

### 진앙
- `collect-naver-listings-incremental.yml` 3주 연속 cancelled (5/22 + 5/26 + 5/27) — 5/27 run 26538887941 = schools-neis step 180분 timeout 정확 도달 (1110/2001 진행)
- raw log 답습 (단지당 5.8초) = NEIS 단지당 baseline 약 3.2초의 1.6배 + 누적 효과
- 진앙 = **NEIS 외부 API 자체 지연** + **resume self skip 패턴 부재** (매일 처음부터 2001건 재처리)

### 답습 패턴 (Plan v1+v2 환각 누적 10건 정정)
- 서브에이전트 3개 병렬 보고 + DB 직접 실측 교차 검증 의무 (서브에이전트만 단정 = 환각 위험 100%)
- "시간 기반 skip (30일 이내 무조건 skip)" 단정 환각 → 데이터 완결성 기반 (`schoolType` 키 박힘 + 30일 이내) 정정
- "NEIS_KEY 미설정으로 누락된 766건 영구 누락" 차단 패턴 = `schoolType` 키 부재 단지 강제 재처리 박힘
- timeout 정정 근거 = DB 실측 + 12배 지연 + 30일 후 전수 갱신 (2001×4초=134분 + transport 64 + infra 21 = 219분, 마진 21분/40%) 모두 답습 후 240 정정

### 정정 패턴 (답습 자산)
- `buildEnrichedIds` 헬퍼 함수 export (테스트 가능 + main loop 분리)
- 단위 테스트 6건 신규 (skip 박힘 / NEIS 미보강 재처리 / 비어있음 / 만료 / length 0 / 혼합 시나리오) = 회귀 가드
- monitor-collectors.mjs §5 schools `stale_days` 35→14 후속 정정 (세션 339, 본 사고가 35일 한계 안에 묻혀 alert 0회 발화한 진짜 진앙 해소)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 collector timeout cancelled run 답습 시 timeout 단순 늘리기 단정 | §1+§2 raw log 4-way 답습 의무 발동 → 단지 당 시간 비교로 진앙 진단 |
| `apartments.created_at` 답습 0회 후 "단지 폭증" 환각 단정 | §4 30일 신규 단지 grep 의무 발동 → 박제값 정정 |
| collector 본문 변경 시점 답습 0회 후 "API rate limit" 단정 | §3 `git log -- <collector>` 의무 발동 → 진짜 진앙 자리 확정 |
| BACKLOG "별 세션 자리 root cause 분석" 박제값 답습 단정 | §1~§4 4-way 답습 의무 → 박제값 ≠ 실측, 진앙 자리 다를 가능성 답습 |
| 외부 API 지연 + resume skip 패턴 부재 = 매일 전수 재처리 누적 timeout | 세션 338 §"답습 패턴" 의무 → 데이터 완결성 기반 skip + 누락 단지 강제 재처리 박힘 |
| monitor `stale_days` 박힘이 사고 한계 안에 묻혀 alert 0회 | 세션 339 정정 답습 → cron 발화 주기 + 1주 여유 = 14 (일일/월간) 의무 |
