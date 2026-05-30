# Collector timeout 사고 root cause 분석 — 4-way 답습 의무

## 사고 박제 (세션 295)

세션 294 가 `collect-naver-listings-incremental.yml` 5/22 schedule run 26311529575 cancelled (transport-tago 2.1배 느림) 박제 시 **timeout 90→120 임시 완화 + BACKLOG "root cause 분석 별 세션 자리" 박제**. 세션 295 진입 자리 = "코드/API 결함 자리 정확 정정 의무".

세션 295 v1 환각: "apartments 단지 수 1000→2001 폭증 (네이버 신규 추가)". 자가 점검 1 발동 → `apartments.created_at` 실측 = 30일+ 이전 박제 자리 (마지막 2026-04-07) → 신규 추가 0 자리 확정. v1 환각 폐기.

v2 정정: `git log -- scripts/collectors/transport-tago.mjs` 답습 결과 커밋 `01d0dd4` (2026-05-22 07:42) `limit(10000) → range 페이지네이션` 박제. 메시지 인용:

> PostgREST max_rows=1000 제한 우회 — limit(10000) 환각 (실제 1000 행만 반환) 정정. transport-tago L194 자리 포함.

진앙 자리 확정 = **collector 본문 변경 (5/22 07:42)**. timeout 90→120 fix 는 회귀 자리 없는 정확한 정정 자리.

## 근본 원인 = 단일 신호 단정

collector timeout 사고 자리 답습 시 **timeout 수치 (90/120) + 직전 run 시간** 단일 신호만 보고 "코드 결함" / "API rate limit" / "단지 수 폭증" 등 단정 환각. 진앙은 4 신호 교차 답습으로만 확정 가능 자리.

| 단일 신호 환각 | 4-way 검증 결과 |
|---|---|
| "코드 결함" | collector_runs 답습 → 직전 success 시간 답습 후 단지 당 일정 시간 확인 |
| "API rate limit" | raw run log 답습 → 단지 당 시간 일정 (sleep 자체가 의도된 자리) 확인 |
| "단지 수 폭증 (신규 단지)" | `apartments.created_at` 답습 → 30일 이내 신규 0 확인 시 폐기 |
| "timeout 자리 부족" | git log 답습 → collector 본문 변경 시점 자리 확정 |

## 재발 방지 (4-way 답습 의무)

collector timeout 사고 자리 plan 작성 시 다음 4 grep/실측 의무. 단일 신호 단정 금지.

### 1. raw run log 답습 (gh run view --log)

```bash
gh run view <cancelled_run_id> --log 2>&1 | grep -E "<collector>|\[<phase>\]" | head -50

# step 별 정확 타이밍 (timeout-minutes 도달 vs 외부 cancel 구분) — --log 텍스트로는 못 봄
gh api repos/{owner}/{repo}/actions/runs/<id>/jobs \
  --jq '.jobs[] | .name + ": " + .started_at + " ~ " + .completed_at + " [" + (.conclusion // "?") + "]"'

# 상태값 분리 집계 (자연 timeout vs 외부 cancel = graceful 효과 다름)
gh run list --workflow=<wf>.yml --status timed_out --limit 5   # timeout-minutes 도달 = SIGKILL grace 0, graceful break 무효
gh run list --workflow=<wf>.yml --status cancelled --limit 5   # gh run cancel/concurrency 축출 = grace 5분, graceful break 유효
```

핵심 박제: **"전체 N건 → 미수집 M건"** + **"X초 | 성공 Y"**. 단지 당 시간 = X/Y 계산. 단지 수와 시간이 선형 비례면 API/코드 결함 0 자리.

**step 타이밍 판별** (세션 344 building-info 사고 답습): yml `timeout-minutes` 값과 실제 끊긴 시점 비교. timeout-minutes=90인데 정확히 30분 cancel = job timeout 아님 → 외부 cancel(concurrency 축출/수동). `gh run view --log | tail` 텍스트로는 step별 시간을 못 보므로 jobs 엔드포인트 `started_at`/`completed_at` 실측 의무.

### 2. 직전 success run 답습 (단지 당 시간 비교)

```bash
gh run view <prev_success_run_id> --log 2>&1 | grep -E "<collector>|\[<phase>\]" | head -50
```

직전 success 와 cancelled 의 단지 당 시간 (X/Y) 비교. **3% 이내 = 노이즈 / 일정** → 코드 결함 0. 단지 수 증가가 처리 시간 증가의 원인 자리 확정.

### 3. collector 본문 변경 시점 답습 (git log)

```bash
git log --oneline -10 -- scripts/collectors/<collector>.mjs
git show <suspicious_commit> --stat 2>&1 | head -25
```

cancelled run 시점 직전에 collector 본문 변경 있는지 답습. 변경 있으면 = 그 자리가 진앙 자리. 변경 없으면 = 다른 원인 (`apartments.created_at` 답습 진입).

### 4. apartments.created_at 답습 (신규 단지 폭증 검증)

```bash
node --input-type=module -e "
import { loadEnv, getSupabase } from './scripts/collectors/_shared.mjs';
loadEnv();
const sb = getSupabase();
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const { count } = await sb.from('apartments').select('*', { count: 'exact', head: true }).gte('created_at', since);
console.log('apartments created in last 30 days:', count);
"
```

30일 이내 신규 단지 0 = "단지 폭증 (신규 추가)" 가설 폐기. 신규 단지 0 인데 단지 수가 늘어났으면 = collector fetch 로직 변경 자리 (위 §3 답습).

## 안티 패턴 (사고 답습)

- ❌ "timeout 수치 60→90 → 120 단순 늘림 = 정답" — 진앙 자리 답습 0회 후 timeout 늘리기 단정 금지. 단지 당 시간 일정 + 단지 수 증가 자리면 늘리기 정답, 다른 자리면 코드 root fix 자리
- ❌ "단지 당 시간 = 4초 = 의도된 sleep × 4 + API 호출 = 정상" 단정 — sleep 자체가 너무 긴 자리도 가능 자리. 옛 collector_runs 값과 비교 의무
- ❌ "apartments 신규 추가 없으면 collector fetch 변경" 단정 — `git log` 답습 1회 의무 (다른 collector 의 PostgREST max_rows fix 자리 같은 cross-collector 영향 가능)
- ❌ "BACKLOG '별 세션 자리 root cause 분석' 박제값 답습 단정" — 실측 4-way 답습 의무, 박제값 환각 가능 자리
- ❌ "Supabase update 직렬 for-loop = 단순 코드 패턴" — 1000+ row 자리 시 timeout 진앙 가능성. `_shared.mjs createSemaphore(N)` + `Promise.all` 답습 자산 답습 의무 (세션 309 박제: trade-stats.mjs L596-607 직렬 1960 row × 150ms = 4분 54초 → semaphore(10) 30초)
- ❌ "cancelled run N건 같은 원인 단정" — 각 run 의 step 시간 답습 의무. (1) `gh run list --status timed_out` vs `--status cancelled` 상태값 먼저 구분 (2) `gh api .../runs/<id>/jobs --jq '.jobs[].steps[]'` 로 step별 started_at/completed_at 확인. timeout-minutes 도달(자연 timeout) vs 중간 cancel(외부) vs 큐 충돌 판별 (세션 309·344 박제: 15분 boundary vs 57분 vs building-info 90분 yml인데 30분 외부 cancel)

## 답습 자산

- 세션 294 timeout 90→120 fix 커밋 `b313b56` (`collect-naver-listings-incremental.yml`)
- 세션 295 본 룰 박제 시점 = R1 분석 종결 자리 확정
- 커밋 `01d0dd4` (2026-05-22) PostgREST max_rows=1000 fix 16건 일괄 정정 자리 — 답습 자산 (cross-collector 영향 자리)
- `.claude/rules/workflows/secret-naming-audit.md` §"운영 모니터링 (월간 schedule)" 절 답습 (월간 cron 데드 존 박제)
- 세션 309 trade-stats.mjs DSR batch fix (`createSemaphore(10)` + `Promise.all`) — Supabase 직렬 update timeout 진앙 정정 답습 자산. `docs/superpowers/specs/2026-05-25-trade-stats-dsr-batch-fix-design.md` 박제 (박힘 환각 7건 정정 + 진단 자리)
- 세션 327 사고 = Plan agent + 본인 환각 누적 **9건** 자가 점검 1 v2/v3 발동 후 정정. 패턴 = "Plan agent → 본인 grep → 추가 의심 발견 → 추가 grep → 9건 정정". raw log + `gh run view --json jobs` step 시간 둘 다 답습 의무. **메모리 박힘 값은 진실의 원천 아님** (예: `collector_runs` 스키마 = `ok_count`/`fail_count`/`skip_count` not `ok`/`fail`/`skip`). PR #28 graceful 박힘 = 46+ collector 중 완전 적용 4건 (9%) — `createReporter` 사용만으로 적용 단정 = 환각

## 안티 패턴 보강 (세션 327)

- ❌ Plan agent 보고 표 + 라인 번호 + 통계 = 환각 위험 100%. 본인 직접 1회 답습 의무
- ❌ "createReporter 사용 = graceful 적용" 단정. `if (rpt.interrupted()) break;` 명시 박힘 grep 의무
- ❌ "PR merge = 실전 동작 확인" 단정. workflow_dispatch dry-run 또는 자연 cron 1회 실증 의무
- ❌ "외부 API 분산 N%" 박힘 단일 표본 단정. N≥10 표본 통계 (평균/σ/Z-score) 답습 의무

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
