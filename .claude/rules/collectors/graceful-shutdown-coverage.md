# graceful shutdown break 박힘 의무 (PR #28 답습 후 적용 패턴)

## 사고 박제 (세션 327)

PR #28 (세션 321, 커밋 `4bfeaa9`) `setupGracefulShutdown` / `createReporter` 박힘 후:
- 단위 테스트 0건 (`trade-stats-regions.test.mjs` mock 1건만)
- 46+ collector 중 **완전 적용 4건 (9%)** 만 진짜 작동
- 5/26 cancelled 3건 (transport / infra / schools) 모두 = `collector_runs` partial row 0건 = 실전 동작 0

세션 327 fix:
- _shared.test.mjs SIGTERM mock 4건 신규 (`process.emit('SIGTERM')` → `interrupted()` true + `summary().status='partial'`)
- transport-tago / infra-kakao / schools-neis 3 collector main loop break 박힘

## 정확 패턴 (3중 의무)

### 1. 함수 등록 (loop 이전)

```js
import { createReporter } from "./_shared.mjs";  // OR setupGracefulShutdown
// ...
const rpt = createReporter(PHASE);  // loop 이전 반드시
for (const item of items) {
  // ...
}
```

- ⚠️ **infra-kakao 사고 답습**: `createReporter` 가 loop 끝난 뒤 호출 = SIGTERM 핸들러 등록 0회 = graceful 효과 0
- loop 이전 호출 의무

### 2. break 박힘 (필수)

```js
for (const item of items) {
  if (rpt.interrupted()) break;  // 또는 if (isInterrupted()) break;
  // ...
}
```

- 다중 loop = 외부 + 내부 둘 다 박힘 (`molit-building-info.mjs` L187 + L214 답습 사례)
- `Promise.all` batch loop = batch 단위 break 박힘 (`infra-kakao.mjs` 세션 327 사례)

### 3. 단위 테스트 (회귀 가드)

```js
import { setupGracefulShutdown, createReporter } from "./_shared.mjs";

describe("graceful shutdown", () => {
  it("SIGTERM emit 후 interrupted true", () => {
    const isInterrupted = setupGracefulShutdown("test");
    process.emit("SIGTERM");
    expect(isInterrupted()).toBe(true);
  });

  it("SIGTERM 후 summary status partial", () => {
    const rpt = createReporter("test");
    rpt.success(5);
    process.emit("SIGTERM");
    expect(rpt.summary().status).toBe("partial");
  });
});
```

## 적용 현황 (세션 327 답습)

### 완전 적용 (break 박힘) — 4 → 7 collector (세션 327 fix 후)

- `collect-unsold-kosis` L127 + L193
- `housing-permits` L90 + L105
- `molit-building-info` L157 + L187 + L214 (외부+내부 2중)
- `trade-stats-regions` L119 + L128 + L177
- `transport-tago` L215 + L218 (세션 327 신규)
- `infra-kakao` L87 + L132 (세션 327 신규)
- `schools-neis` L373 + L374 (세션 327 신규)

### 등록만 (break 0) — 15 collector

`calc-school-walk` / `collect-housing-price` / `collect-market-stats` / `collect-trades` / `naver-presale` / `population` / `population-sex-age` / `childcare-info` / `childcare-detail` / `childcare-info-jeju` / `collect-nearby-childcare` / `collect-air-quality` / `collect-applyhome` / `collect-building-hub` / `collect-crime-safety`

→ 별 PR 보강 의무 (BACKLOG P1 박힘)

### 미사용 — 24+ collector

graceful shutdown 미적용 → timeout 까지 강제 종료 시 collector_runs row 0건 = silent fail. 우선순위 낮음.

## 안티 패턴

- ❌ `createReporter` 사용 = graceful 적용 단정 — break 0 시 등록만, SIGTERM 받아도 다음 루프 못 끊음
- ❌ PR merge = 실전 동작 확인 — workflow_dispatch dry-run 또는 자연 cron 1회 의무
- ❌ `createReporter` 를 loop 끝난 뒤 호출 (`infra-kakao` 세션 327 이전 패턴) — SIGTERM 핸들러 등록 0회
- ❌ 단위 테스트 0건 (PR #28 세션 321 사고) — `process.emit('SIGTERM')` mock 의무

## 검증 (실증)

GitHub Actions `cancel-timeout-minutes` 기본값 = 5분 (300s). SIGTERM 후 5분 안에 SIGKILL.
- transport-tago 단지 당 4초 → SIGTERM 후 다음 단지 진입 전 break = 4초 안 = 안전
- schools-neis 단지 당 1.2초 → 1.2초 안 = 안전
- infra-kakao batch 30건 × 0.67초 = 20초 batch 단위 break = 안전

## 답습 자산

- `molit-building-info.mjs` L157 + L187 + L214 = 외부+내부 break 정확 사례
- `trade-stats-regions.mjs` L119 + L128 + L177 = 조기 return + 루프 break 패턴
- `collect-childcare.mjs` L98 + L101 = 단일 loop break 박힘
- `_shared.test.mjs` SIGTERM mock 4 테스트 = 단위 테스트 회귀 가드

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 collector `createReporter` 박힘 후 break 0 단정 | §2 break 박힘 의무 발동 → main loop grep + break 박힘 |
| PR merge 후 실전 동작 0회 단정 | §실증 절 답습 의무 → workflow_dispatch dry-run |
| `createReporter` 를 loop 끝난 뒤 호출 | §1 함수 등록 절 → loop 이전 호출 의무 |
| 단위 테스트 0건 | §3 SIGTERM mock 의무 → `_shared.test.mjs` 답습 |
