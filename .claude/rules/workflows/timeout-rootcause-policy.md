---
title: Collector timeout cancelled 원인 = 큐 막힘 환각 차단
incident_dates: ["2026-04-06", "2026-05-06", "2026-05-22", "2026-05-23", "2026-05-24"]
related_workflows:
  - .github/workflows/collect-trades.yml
  - .github/workflows/fill-missing-data.yml
---

# Collector timeout cancelled 원인 진단 — 큐 막힘 환각 차단

## 사고 박제 (세션 306)

세션 305 NEXT_SESSION + BACKLOG 박제 = "collect-trades 18일 미발화 + trade-stats 9주 stale + molit-units 10주 stale + fill-missing-data 5/24 cancelled = 큐 막힘 사고". 세션 306 plan v1 가 박제값 답습 + concurrency `data-collection` 그룹 분리 가설 단정.

서브에이전트 3개 병렬 검증 결과 plan v1 환각 5건 발견. raw `gh run view --log` 4건 답습 후 진짜 사고 원인 확정 = **단순 timeout 부족**.

raw 사고 4건:

| run | conclusion | raw 마지막 메시지 | 진짜 원인 |
|---|---|---|---|
| collect-trades 5/6 (25461419374) | cancelled | API 3150건, 491691건 수집 중 (21:12 시작 → 22:12 정확 60분) | **60분 timeout 부족** + 거래량 1.7배 자연 증가 (4/6 289k → 5/6 491k) |
| collect-trade-stats 5/24 (26367266566) | cancelled | "trade_stats 2001/2001 upsert 완료" 17:07:57 → 17:12:26 post-job cleanup cancel | **DB 영향 0** (정상 upsert + runner cleanup 단계 cancel, stale 환각) |
| fill-missing-data 5/24 (26353355165) | cancelled | Phase 3 schools-neis 120분 timeout + Phase 4 molit-building-info 60분 timeout | **Phase 별 timeout 부족** |
| collect-molit-units 5/6 (25457081712) | failure | 보정 32 / 실패 40 / 건너뛰기 9 → exit 1 | **failed > 0 exit 1 조건** (별 PR 진단) |

세션 306 정정 (커밋 X):
- `fill-missing-data.yml` Phase 3 timeout 120 → 180
- `fill-missing-data.yml` Phase 4 timeout 60 → 90
- `collect-trades.yml` timeout 60 → 120

## 근본 원인 = 큐 막힘 가설 환각 진입

plan v1 사고 패턴:

1. **NEXT_SESSION/BACKLOG 박제값 단정** — "18일 미발화 / 9주 stale / 10주 stale" 박제값을 진실의 원천으로 답습. 메모리 룰 §"메모리는 진실의 원천 아님" 답습 미준수
2. **공통 cancelled 패턴 = 큐 막힘 가설 단정** — 4건 cancelled 보고 `concurrency: group: data-collection` 단일화를 원인으로 추측. raw log 답습 0회
3. **그룹 분리 = 해결 환각** — 세션 273 `calc-collection` 분리 답습 패턴을 사고 자리 4개 확장 적용. 그러나 raw 답습 결과 cron 시각 충돌 0 + 데이터 stale 0 (3/4건 환각)

→ raw log 답습 1회로 가설 자체 폐기 가능했으나 plan v1 박제 직전 의무 미준수.

## 재발 방지 (3중)

### 1. cancelled run plan 작성 진입 자리 raw log 답습 의무

ETL collector cancelled / failure 진단 plan 작성 시 다음 grep + 1회 raw 답습 의무.

```bash
# step 1: cancelled run id 추출
gh run list --workflow=<workflow>.yml --limit 10 --json databaseId,conclusion,createdAt --jq '.[] | select(.conclusion == "cancelled" or .conclusion == "failure") | "\(.createdAt) \(.conclusion) id=\(.databaseId)"'

# step 2: raw log 마지막 30줄 답습 (timeout vs 큐 막힘 vs 코드 결함 진단)
gh run view <id> --log 2>&1 | tail -30

# step 3: 직전 success run 비교 (4-way §2 답습)
gh run view <prev_success_id> --log | grep "API.*건\|건 수집\|소요" | tail -10
```

raw log 답습 결과 박제:

- "정확 60분 cancel" → timeout 부족 (단순 늘리기 정정)
- "post-job cleanup cancel" → DB 영향 0 (stale 환각, plan 진입 무관)
- "exit code 1 + failed > 0" → 코드 root fix (별 진단)
- "API rate limit 429" → 청크 분할 또는 다른 grp
- "API 응답 지연" → API 자체 사고 (외부 사고, 본인 fix 0)

### 2. plan v1 환각 박제값 grep 의무

NEXT_SESSION + BACKLOG + SESSION_LOG 박제값 ("X 미발화 N일 / Y stale N주") 단정 직전 다음 1회 grep 의무.

```bash
# DB 자체 stale 검증 (apartments.X 컬럼 updated_at)
gh run view <마지막 success run id> --log | grep "수집 완료\|upsert\|성공" | tail -10

# 외부 cron 박힌 자매 collector grep (큐 막힘 가설 검증)
grep -A 3 "concurrency:" .github/workflows/<workflow>.yml
grep -A 3 "concurrency:" .github/workflows/<같은 그룹 자매>.yml
```

박제값과 raw log 결과 차이 발견 시 박제값 즉시 폐기 + plan 재설계 진입. 메모리 룰 §"메모리는 진실의 원천 아님" 답습 의무.

### 3. concurrency 그룹 분리 가설 진입 시 cron 충돌 답습 의무

큐 막힘 가설 진입 plan 작성 시 다음 cron 시각 grep 의무.

```bash
# 같은 그룹 cron 시각 grep
for wf in $(grep -l "group: <그룹>" .github/workflows/*.yml); do
  echo "=== $wf ==="
  grep "cron:" $wf
done
```

cron 시각 충돌 (같은 일자 + 같은 시각대 내 ±2h 이내) 박힘 시 = 큐 막힘 정당. 그 외 = 환각 가설 확정 + plan 폐기.

세션 306 fill cron `0 2 * * 0` (일 UTC 02:00) + trades cron `0 20 6 * *` (매월 6일 UTC 20:00) = 14시간 간격 = 충돌 0 = 큐 막힘 환각.

## 안티 패턴 (사고 답습)

- ❌ "cancelled 4건 = 같은 원인 = concurrency 그룹 막힘" — raw log 답습 의무 (5/24 trade-stats post-job cleanup vs 5/6 trades 60분 timeout = 서로 다른 사고)
- ❌ "큐 막힘 = 그룹 분리로 해결" — cron 시각 충돌 답습 0회 후 단정 금지
- ❌ "NEXT_SESSION 박제 '10주 stale' = 진실의 원천" — DB 자체 갱신 자리 raw log 답습 의무
- ❌ "trade-stats cancelled = trade_stats 테이블 stale" — post-job cleanup 단계 cancel 가능, raw log 마지막 30줄 답습 의무
- ❌ "timeout 단순 늘리기 = 무근거 정정" — 4-way 답습 (직전 success 시간 비교) 후 정정 정당. 데이터 자연 증가 (예: 거래량 1.7배) = 단순 늘리기 정답
- ❌ "plan v1 환각 발견 후 plan v2 박제 시점 박제값 그대로 답습" — 환각 5건 발견 시 박제값 전부 폐기 + raw 답습 부터 plan v3 재설계

## 답습 자산

- 세션 273 calc-collection 그룹 분리 (커밋 68c5051) — 진짜 큐 막힘 사고 정정 답습 자산
- 세션 291 phase2-calc 매트릭스 6→3 (외부 cron 박힌 calc 제외) — sub-step 동시 실행 cancelled 정정
- 세션 298 phase3-external timeout 60→120 (noxious+transport-tago 8주 만성 cancelled) — 본 세션 120→180 답습 원천
- 세션 306 본 사고 박제 + 본 룰 신규 + collector-timeout-rootcause-analysis.md §4-way 답습 답습 자산

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 ETL collector cancelled plan 작성 시 NEXT_SESSION 박제값 단정 | §2 grep 의무 발동 → DB 자체 stale 답습 → 박제값 폐기 |
| cancelled 4건 보고 "큐 막힘" 가설 단정 | §1 raw log 답습 의무 + §3 cron 충돌 답습 → 가설 폐기 |
| concurrency 그룹 분리 plan v1 작성 | §3 cron 시각 grep 의무 → 14시간 간격 발견 → plan 폐기 |
| timeout 60→120 박제 (4-way 답습 0회) | `collector-timeout-rootcause-analysis.md` §1~§4 의무 → 직전 success 비교 (1.7배 자연 증가) 답습 → 정정 정당 |
