# graceful shutdown break 박힘 의무 (PR #28 답습 후 적용 패턴) — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/collectors/graceful-shutdown-coverage.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 327)

PR #28 (세션 321, 커밋 `4bfeaa9`) `setupGracefulShutdown` / `createReporter` 박힘 후:
- 단위 테스트 0건 (`trade-stats-regions.test.mjs` mock 1건만)
- 46+ collector 중 **완전 적용 4건 (9%)** 만 진짜 작동
- 5/26 cancelled 3건 (transport / infra / schools) 모두 = `collector_runs` partial row 0건 = 실전 동작 0

세션 327 fix:
- _shared.test.mjs SIGTERM mock 4건 신규 (`process.emit('SIGTERM')` → `interrupted()` true + `summary().status='partial'`)
- transport-tago / infra-kakao / schools-neis 3 collector main loop break 박힘

## 검증 (실증) — 세션 327 dry-run 답습

### GitHub Actions SIGTERM 동작 (timeout-minutes vs gh run cancel)

세션 327 dry-run run 26502989962 (`timeout-minutes: 2` 임시 박힘 + workflow_dispatch) 실측:

- transport step 09:30:18 → 09:32:19 = **정확 2분 1초 후 cancel**
- **`SIGTERM 받음` 로그 0건 / `[완료] N초 (graceful 중단)` summary 0건 / `[runs] partial` 0건 / collector_runs row 0건**
- **진앙 = job timeout-minutes 도달 = step 즉시 SIGKILL (grace 0)**. `cancel-timeout-minutes` 기본 5분 = `gh run cancel` 수동 명령 시에만 적용.

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
