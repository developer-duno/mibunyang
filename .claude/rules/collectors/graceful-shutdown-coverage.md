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

## 적용 현황 (진실의 원천 = `_graceful-coverage.test.mjs`)

### ⚠️ 진실의 원천 명시 (세션 331 정정)

본 md 의 적용 현황 목록은 **stale 위험**. 실제 진실의 원천 = [`scripts/collectors/_graceful-coverage.test.mjs`](../../../scripts/collectors/_graceful-coverage.test.mjs) (vitest 회귀 가드 + ALLOWLIST). md 와 테스트가 drift 시 = 테스트 우선.

다음 명령으로 break 박힘 collector 실측:

```bash
grep -l "rpt.interrupted\|isInterrupted" scripts/collectors/*.mjs | grep -v test
```

### 완전 적용 (break 박힘) collector — 실측 명령

하드코딩 목록은 stale 재발 (예: "17 collector" 박힘이 작성 당일에도 26 이라 틀린 박제값). 진실의 원천 = `_graceful-coverage.test.mjs` (ALLOWLIST 외 전부 검사 대상 + 통과 = 완전 적용). 실측:

```bash
# 완전 적용 = createReporter/setupGracefulShutdown + break 박힘 collector
grep -l "rpt.interrupted\|isInterrupted\|reporter.interrupted" scripts/collectors/*.mjs | grep -v test | wc -l
# 또는 (회귀 가드 통과 = 완전 적용 증명)
npx vitest run scripts/collectors/_graceful-coverage.test.mjs
```

세션 344 추가 적용 (ALLOWLIST 거짓 음성 정정): `trade-stats` + `molit-units` + `naver-listings` + `reverse-geocode` + `geocode-missing` (전부 cron 실행 + main loop + await 인데 graceful 누락 → setupGracefulShutdown + break 박힘). `collect-trades` 내부 loop break 도 추가.

### ALLOWLIST (graceful 무관 — one-shot / 단발 / calc) — 실측 명령

`_graceful-coverage.test.mjs` 의 ALLOWLIST Set 이 진실의 원천. PR-B (7건) + PR-C (2건) 9 collector 는 세션 330·337 머지로 graceful 적용 완료 + ALLOWLIST 에서 제거됨. 세션 344 거짓 음성 5건도 제거됨. 실측:

```bash
grep -c '.mjs",' scripts/collectors/_graceful-coverage.test.mjs   # = ALLOWLIST 항목 수
```

### 미사용 (graceful 불필요 or 우선순위 낮음) — 20+ collector

graceful shutdown 미적용 → timeout 까지 강제 종료 시 collector_runs row 0건 = silent fail. 본 md 적용 현황과 ALLOWLIST 둘 다 stale 발생 시 = `_graceful-coverage.test.mjs` ALLOWLIST 가 진실.

## 안티 패턴

- ❌ `createReporter` 사용 = graceful 적용 단정 — break 0 시 등록만, SIGTERM 받아도 다음 루프 못 끊음
- ❌ PR merge = 실전 동작 확인 — workflow_dispatch dry-run 또는 자연 cron 1회 의무
- ❌ `createReporter` 를 loop 끝난 뒤 호출 (`infra-kakao` 세션 327 이전 패턴) — SIGTERM 핸들러 등록 0회
- ❌ 단위 테스트 0건 (PR #28 세션 321 사고) — `process.emit('SIGTERM')` mock 의무

## 검증 (실증) — 세션 327 dry-run 답습

### GitHub Actions SIGTERM 동작 (timeout-minutes vs gh run cancel)

세션 327 dry-run run 26502989962 (`timeout-minutes: 2` 임시 박힘 + workflow_dispatch) 실측:

- transport step 09:30:18 → 09:32:19 = **정확 2분 1초 후 cancel**
- **`SIGTERM 받음` 로그 0건 / `[완료] N초 (graceful 중단)` summary 0건 / `[runs] partial` 0건 / collector_runs row 0건**
- **진앙 = job timeout-minutes 도달 = step 즉시 SIGKILL (grace 0)**. `cancel-timeout-minutes` 기본 5분 = `gh run cancel` 수동 명령 시에만 적용.

### 결론 = graceful break 박힘 효과 자리

| cancel 종류 | grace period | graceful break 효과 |
|---|---|---|
| `timeout-minutes` 도달 (자연 timeout) | 0초 (즉시 SIGKILL) | **0** (partial 기록 못함) |
| `gh run cancel` 수동 명령 | 5분 (cancel-timeout-minutes 기본) | **유효** (단지 처리 끝나면 break) |
| 다른 step `continue-on-error: true` step fail | step 단위 (다음 step 진행) | N/A |

→ graceful break = **수동 cancel 대비 보조 기능**. 자연 timeout 사고 = **timeout-minutes 늘리기만 유효**.

### 단지 당 처리 시간 (참고)

- transport-tago 4초/단지 / infra-kakao 0.67초/단지 / schools-neis 1.2초/단지 = 수동 cancel grace 5분 안에 break 평가 = 안전

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
