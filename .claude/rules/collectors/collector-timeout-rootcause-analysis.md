# Collector timeout 사고 root cause 분석 — 4-way 답습 의무

> 사건·이력 (세션295 — timeout cancelled run 답습에서 "단지 수 폭증" v1 환각 → 실측으로 폐기 → git log 로 collector 본문 변경(PostgREST max_rows fix) 진앙 확정) → [rules-history/collectors/collector-timeout-rootcause-analysis.md](../../rules-history/collectors/collector-timeout-rootcause-analysis.md)

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

## 안티 패턴 보강 (세션 327)

- ❌ Plan agent 보고 표 + 라인 번호 + 통계 = 환각 위험 100%. 본인 직접 1회 답습 의무
- ❌ "createReporter 사용 = graceful 적용" 단정. `if (rpt.interrupted()) break;` 명시 박힘 grep 의무
- ❌ "PR merge = 실전 동작 확인" 단정. workflow_dispatch dry-run 또는 자연 cron 1회 실증 의무
- ❌ "외부 API 분산 N%" 박힘 단일 표본 단정. N≥10 표본 통계 (평균/σ/Z-score) 답습 의무

> 답습 자산·세션338 상세·차단 검증 이력 → [rules-history/collectors/collector-timeout-rootcause-analysis.md](../../rules-history/collectors/collector-timeout-rootcause-analysis.md)
