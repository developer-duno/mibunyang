# Collector timeout cancelled 원인 진단 — 큐 막힘 환각 차단

## 한 줄

cancelled / failure run 을 보고 **NEXT_SESSION·BACKLOG 박제값**이나 "공통 cancelled = `concurrency` 큐 막힘" 가설로 단정하지 않는다. raw log 1회면 가설 자체를 폐기할 수 있다.

## 재발 방지 (3중)

1. **cancelled run plan 작성 전 raw log 답습 의무** — `gh run list --workflow=<wf>.yml --limit 10 --json databaseId,conclusion,createdAt` 로 id → `gh run view <id> --log | tail -30` → step 타이밍은 `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`(started_at/completed_at), `--status timed_out`(SIGKILL) vs `cancelled`(외부, grace) 분리 → 직전 success run 과 비교. 판정:
   - "정확 60분 cancel" → timeout 부족 (단순 늘리기 정정)
   - "post-job cleanup cancel" → DB 영향 0 (stale 환각, plan 진입 무관)
   - "exit code 1 + failed > 0" → 코드 root fix (별 진단)
   - "API rate limit 429" → 청크 분할 또는 다른 grp
   - "API 응답 지연" → API 자체 사고 (외부 사고, 본인 fix 0)
2. **NEXT_SESSION·BACKLOG·SESSION_LOG 박제값("X 미발화 N일 / Y stale N주") 단정 전 1회 grep** — 마지막 success run 의 수집 로그 + 같은 그룹 자매 워크플로의 `concurrency:` 확인. 박제값과 raw log 가 다르면 박제값 즉시 폐기 + plan 재설계.
3. **concurrency 그룹 분리 가설 진입 시 같은 그룹 cron 시각 grep** — 같은 일자 + ±2h 이내 충돌이 있을 때만 큐 막힘 정당, 그 외는 환각 가설로 확정하고 plan 폐기.

## 안티 패턴 (사고 답습)

- ❌ "cancelled 4건 = 같은 원인 = concurrency 그룹 막힘" — raw log 답습 의무 (5/24 trade-stats post-job cleanup vs 5/6 trades 60분 timeout = 서로 다른 사고)
- ❌ "큐 막힘 = 그룹 분리로 해결" — cron 시각 충돌 답습 0회 후 단정 금지
- ❌ "NEXT_SESSION 박제 '10주 stale' = 진실의 원천" — DB 갱신은 raw log 로 확인 의무
- ❌ "trade-stats cancelled = trade_stats 테이블 stale" — post-job cleanup 단계 cancel 가능, raw log 마지막 30줄 답습 의무
- ❌ "timeout 단순 늘리기 = 무근거 정정" — 4-way 답습 (직전 success 시간 비교) 후 정정 정당. 데이터 자연 증가 (예: 거래량 1.7배) = 단순 늘리기 정답
- ❌ "plan v1 환각 발견 후 plan v2 박제 시점 박제값 그대로 답습" — 환각 5건 발견 시 박제값 전부 폐기 + raw 답습 부터 plan v3 재설계

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/workflows/timeout-rootcause-policy.md](../../rules-detail/workflows/timeout-rootcause-policy.md)
