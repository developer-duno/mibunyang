# Collector timeout 사고 root cause 분석 — 4-way 답습 의무

## 한 줄

collector timeout 진앙을 **timeout 수치 + 직전 run 시간** 단일 신호로 "코드 결함 / API rate limit / 단지 수 폭증 / timeout 부족"이라 단정하지 않는다. 아래 4 신호를 교차한 뒤에만 plan 을 쓴다.

## 4-way 답습 (plan 작성 시 의무)

1. **raw run log** — `gh run view <id> --log` 에서 "전체 N건 → 미수집 M건"·"X초 | 성공 Y" → 단지 당 시간 X/Y. step 별 정확 타이밍은 `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs` 의 `started_at`/`completed_at`(텍스트 로그로는 못 본다). `gh run list --status timed_out`(timeout-minutes 도달 = SIGKILL grace 0, graceful break 무효) 과 `--status cancelled`(외부 cancel·concurrency 축출 = grace 5분) 를 분리 집계. timeout-minutes 보다 이르게 끊겼으면 외부 cancel.
2. **직전 success run** 의 단지 당 시간과 비교 — 3% 이내 = 일정 → 코드 결함 0, 단지 수 증가가 원인.
3. **collector 본문 변경 시점** — `git log --oneline -10 -- scripts/collectors/<collector>.mjs`. 직전 변경이 있으면 그 변경이 진앙.
4. **`apartments.created_at` 30일 신규 수** — 0 이면 "신규 단지 폭증" 폐기, 그런데 단지 수가 늘었으면 fetch 로직 변경(§3).

## 안티 패턴 (사고 답습)

- ❌ "timeout 을 단순히 늘리면 정답" — 4-way 없이 단정 금지. 단지 당 시간 일정 + 단지 수 증가면 늘리기가 정답, 아니면 코드 root fix
- ❌ "단지 당 시간 = 의도된 sleep + API 호출 = 정상" 단정 — sleep 자체가 너무 길 수 있다. 옛 collector_runs 값과 비교 의무
- ❌ "apartments 신규 추가 없으면 collector fetch 변경" 단정 — `git log` 1회 의무(다른 collector 의 PostgREST max_rows fix 같은 cross-collector 영향 가능)
- ❌ BACKLOG 의 root cause 박제값을 그대로 답습 — 실측 4-way 의무, 박제값은 환각일 수 있다
- ❌ Supabase update 직렬 for-loop 1000+ row — timeout 진앙 가능. `_shared.mjs createSemaphore(N)` + `Promise.all` 로
- ❌ "cancelled run N건 같은 원인" 단정 — 상태값(timed_out vs cancelled) 먼저, 그다음 jobs API 로 run 마다 step 시간
- ❌ Plan agent 보고 표 + 라인 번호 + 통계 = 환각 위험 100%. 본인 직접 1회 답습 의무
- ❌ "createReporter 사용 = graceful 적용" 단정. `if (rpt.interrupted()) break;` 명시 박힘 grep 의무
- ❌ "PR merge = 실전 동작 확인" 단정. workflow_dispatch dry-run 또는 자연 cron 1회 실증 의무
- ❌ "외부 API 분산 N%" 박힘 단일 표본 단정. N≥10 표본 통계 (평균/σ/Z-score) 답습 의무
- ❌ 예산(`--budget-min`) 안쪽 반복에 DB 쓰기를 더하고 예산 근거를 그대로 둠 — 더했으면 첫 정기 회차 소요를 직전 회차와 맞대 예산 근거를 다시 잰다

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/collector-timeout-rootcause-analysis.md](../../rules-detail/collectors/collector-timeout-rootcause-analysis.md)
