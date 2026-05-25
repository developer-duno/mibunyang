# Trade Stats DSR Batch Fix — 세션 309 (2026-05-25)

## Context

세션 308 PR #11 머지 = `fill-missing-data` Phase 3+4+5 폐기 = `trade_stats` 갱신 흐름이 `collect-trade-stats.yml` 자체 cron 만 남음. NEXT_SESSION + BACKLOG = P0 "3회 연속 cancelled 진단 (5/24/17/10)".

세션 309 plan v1 = NEXT_SESSION 박힘 답습 단정 → 환각 5건. plan v2 = 자가 점검 1 1차 정정. plan v3 = 사용자 "맹점 답습" 재요청 + 서브에이전트 3개 병렬 결과 환각 추가 2건 발견.

## 박힘 환각 7건 정정 (자가 점검 1+2 누적)

| # | 박힘 환각 | 실측 정정 |
|---|---|---|
| 1 | "9주+ cancelled 같은 원인 = DSR 직렬 timeout" | 5/17 (57분) + 5/10 (58분) = 옛 cron `0 21` 시기 큐 충돌 (5/18 fix 정정 완료). 5/24 (15분) = DSR 직렬 timeout = 별 사고 |
| 2 | "post-job cleanup cancel = DB 영향 0" | step 본문 timeout (job timeout 15분 boundary). apartments.dsr40pass 41건 미반영 (1960/2001 = 98%) |
| 3 | "5/24 큐 충돌 가설" | 5/24 = data-collection group 단독 발화 ✓. 5/17 큐 충돌만 정당 |
| 4 | "DB 자체 stale" | trade_stats = 2001건 + updated_at = 5/24 17:08:07 정상 |
| 5 | "timeout 단순 늘리기 = 정답" | 코드 root fix 의무 (직렬 1960 row × 150ms = 4분 54초 → semaphore(10) 30초) |
| 6 | "dsrUpdates.length = 2001 (전체)" | 실측 = 1960 (조건부, pir > 0 && aptPrice > 0) |
| 7 | "Option A Promise.all BATCH=100 청크" | `_shared.mjs createSemaphore(max)` 답습 자산 (infra-kakao 답습) |

## 진단 결과 (실측 4-way + 서브에이전트 3개)

### §1 raw log (5/24 단독)

```
16:57:14 - Set up job
16:57:30 - Calculate trade stats step 시작
17:07:57 - [calc] 2001건 통계 산출 완료 (10분 27초)
17:08:07 - [done] trade_stats 2001/2001 upsert 완료
17:12:26 - ##[error]The operation was canceled. (DSR 루프 4분 19초 후 job timeout 15분 boundary)
```

DSR 루프 완료 메시지 (`apartments.dsr40pass M/N건 업데이트 완료`) 없음 = DSR 루프 도중 cancel 확정.

### §2 5/17 + 5/10 = 옛 cron 큐 충돌 (별 사고, 5/18 fix 정정 완료)

```
5/17 21:44 Fill Missing Data       cancelled
5/17 21:57 Trade Stats Calculation cancelled (큐 대기 57분 후 cancel)
5/17 22:54 Exclusive Ratio         cancelled
```

옛 cron `0 21 * * 0` UTC = data-collection group 충돌. 5/18 fix (cron `0 21` → `0 16`) = 정정 완료.

### §3 변경 시점

- `scripts/collectors/trade-stats.mjs` 본문 = 3/19 success 이후 변경 0
- `.github/workflows/collect-trade-stats.yml` = `608ca5c` (5/18) cron 변경

### §4 DB 실측

- trades = 716,637건
- trade_stats = 2001건 + updated_at = 5/24 17:08:07
- apartments.dsr40pass NOT NULL = **1960/2001 = 98%** (41건 누락)

### §5 진앙 자리 (L596-607)

```js
for (const { id, dsr40pass } of dsrUpdates) {     // 직렬 for-loop
  const { error: e } = await sbMibunyang
    .from("apartments")
    .update({ dsr40pass })                         // 개별 update
    .eq("id", id);
  if (!e) dsrOk++;
}
```

문제: 1960 row × Supabase RTT ~150ms = **4분 54초** (실측 4분 19초 일치).

## 정정 (Option D = 사용자 확정)

### A. 코드 root fix

```js
import { createSemaphore } from "./_shared.mjs";

if (dsrUpdates.length > 0) {
  const limit = createSemaphore(10);
  const results = await Promise.all(
    dsrUpdates.map(({ id, dsr40pass }) =>
      limit(() => sbMibunyang.from("apartments").update({ dsr40pass }).eq("id", id))
    )
  );
  const dsrOk = results.filter((/** @type {any} */ r) => !r.error).length;
  log("done", `apartments.dsr40pass ${dsrOk}/${dsrUpdates.length}건 업데이트 완료`);
}
```

예상: 1960 / 10 동시 × 150ms = **약 30초** (10배 단축).

### B. timeout 안전망

```yaml
timeout-minutes: 30  # 15 → 30
```

자연 증가 2배 대비.

## 답습 자산

- `_shared.mjs createSemaphore(max)` 헬퍼 (infra-kakao.mjs L134 답습 자산)
- `trade-stats.mjs` L571 `BATCH = 500` upsert (같은 파일 내 답습)
- `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 4-way 답습 룰
- `.claude/rules/workflows/timeout-rootcause-policy.md` 큐 막힘 가설 환각 룰

## 검증

### 로컬 (PR 진입 전, 본 spec 작성 시점에 완료)

- ✅ vitest 25/25 passed
- ✅ eslint 0 errors
- ✅ typecheck 0 errors
- ✅ dry-run 정상 (2001 row 계산 + dsrUpdates = 1960건 plan 박힘 일치)

### 실증 (PR 머지 후 자동 발화)

- **5/31 (일) UTC 16:00 = KST 6/1 월 01:00** = trade-stats 자체 cron 1차 실증
  - 기대: conclusion = success
  - Calculate trade stats step 시간 < 12분 (이전 14분 56초 대비 4분+ 단축)
  - apartments.dsr40pass NOT NULL = 2001/2001 = 100% (조건부 1960 + 누락 41 복구)

- **6/7 (일) UTC 16:00** = 2차 실증 (2회 연속 success = spec 종결)

## 후속 (선택)

- P1: `recordCollectorRun()` 호출 추가 (collector_runs 테이블 박힘) — 답습 자리 0건 박힘 자료
- P2: PostgreSQL bulk update RPC (`bulk_update_dsr40pass(JSONB)`) — semaphore(10) 30초 → RPC 단일 호출 ~1초

## 안티 패턴 박힘 (rule 본문 보강)

`.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 안티 패턴 자리 추가:

> ❌ "Supabase update 직렬 for-loop = 단순 코드 패턴" — 1000+ row 자리 시 timeout 진앙 가능성. 답습 자산 (createSemaphore + Promise.all) 답습 의무

## 박힘 자료 정정 범위 (사용자 확정 = 전부 정정)

- NEXT_SESSION L9-49 = 환각 7건 정정 박힘
- BACKLOG = P0 trade-stats 자리 제거 + 환각 정정
- SESSION_LOG = 세션 309 절 신규
- `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 룰 본문 안티 패턴 자리 추가
