# regions 멀티 collector 새-recorded_at-행 lag + VIEW latest CTE 최신행 함정

## 한 줄

regions 는 여러 collector 가 나눠 채운다 — **행 생성자**(population)가 매월 새 `recorded_at` 행을 자기 컬럼만 채워 INSERT 하고, **후행 채움자**(migration 등)는 UPDATE 만 하며, VIEW `latest_regions` 가 최신 행만 보면 후행 컬럼이 NULL 로 노출된다. `collector_runs` 는 정상이라 **silent fail**.

## 규칙 (재발 방지 3중 — 적용됨)

1. **VIEW 는 컬럼별 최신 non-null** — `GROUP BY region` + `(array_agg(<col> ORDER BY recorded_at DESC) FILTER (WHERE <col> IS NOT NULL))[1]`(`20260609000000_view_regions_latest_nonnull.sql`). VIEW 를 DROP+CREATE 하면 `WITH (security_invoker = on)` 을 CREATE 에 직접 명시.
2. **cron 순서 = 행 생성자가 후행보다 앞** — 로컬 러너 5일 population → 6일 market-stats → 7일 migration → 8일 crime-safety. 후행 채움자의 정답 패턴은 `collect-market-stats.mjs` 처럼 `.is("gu", null)` 로 **모든 시도 행을 recorded_at 무관 전수 UPDATE**.
3. **monitor ⑥ `checkViewRegionStale()`** + `VIEW_REGION_STALE_TARGETS` — regions 원본 ≥20% 채움인데 `apartments_flat` VIEW ≤5% 면 텔레그램 경보.

## 신규 multi-collector regions 컬럼 추가 시 (의무)

regions 에 새 컬럼을 추가하고 VIEW 가 노출하면 다음 grep 의무:
1. **VIEW 가 그 컬럼 노출하나?** — `grep <col> supabase/migrations/<최신 view>.sql` (latest_regions SELECT)
2. **새 recorded_at 행을 채우는 collector 있나?** — population 이 그 행을 만들 때 새 컬럼이 INSERT 에 빠지면
   후행 collector 가 전수 UPDATE(`.is("gu",null)` 모든 행, market-stats 식)인지 확인. UPDATE-only 면 cron 순서 확인.
3. **VIEW latest_regions 가 컬럼별 최신 non-null 인가?** — `array_agg ... FILTER` 패턴이면 안전, `DISTINCT ON` 1행이면 lag 위험.
4. **monitor ⑥ 등재** — `VIEW_REGION_STALE_TARGETS` 에 1줄 + `REGION_KEY_COLUMNS` 에 regionColumn 추가.

## 안티 패턴 (사고 답습)

- ❌ "collector_runs 정상 = 데이터 정상" — VIEW 가 최신 행 NULL 노출하면 원본 채움도 silent fail
- ❌ "VIEW latest CTE 는 DISTINCT ON 1행이 자연스럽다" — 멀티 collector 가 행을 시점차로 채우면 최신 행 일부 NULL
- ❌ "cron 순서만 맞추면 재발 0" — 적대검증 정정: A안은 공백 축소(≤1일), 완전 0 은 B안(컬럼별 최신 non-null)만
- ❌ "data-audit 0% = 외부 API 사고" — 원본 vs VIEW 교차로 "원본 있음+VIEW 없음" 회귀 vs "원본 부재" 구분 의무
- ❌ "VIEW DROP+CREATE 하면 security_invoker 유지" — ALTER 로 켠 옵션은 DROP 시 날아감, CREATE 에 명시 의무

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/regions-multicollector-recorded-at-lag.md](../../rules-detail/collectors/regions-multicollector-recorded-at-lag.md)
