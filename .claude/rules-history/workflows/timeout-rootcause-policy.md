# Collector timeout cancelled 원인 진단 — 큐 막힘 환각 차단 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/workflows/timeout-rootcause-policy.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

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

## 세션 307 안티 패턴 11 일꾼 정정 (NEXT_SESSION 박제 6건 vs 실측 11건)

세션 306 NEXT_SESSION 박힘 "위반 6건" 박제값 답습 plan 진입 시 grep 의무 발동 = 환각 5건 추가 발견 (transport-tago / infra-kakao / noise-estimate / molit-building-info / trade-stats). 본 5건 fill matrix 안 박힘 + collect-*.yml 자체 cron 박힘 → sub-step cancelled 사고 원인 동일.

**재발 방지**: `scripts/audit-fill-matrix.mjs` (CI 가드, 세션 308 PR #11) = collect-*.yml cron 박힘 추출 + fill matrix script 교집합 박힘 시 exit 1. 신규 collector 등록 시 fill matrix 동시 등록 차단.

**trade-stats 별도 진단 의무**: PR #11 머지 = trade-stats 폐기 직접 유발 = `trade_stats` 갱신 흐름 0건. `collect-trade-stats.yml` 자체 cron 3회 연속 cancelled (5/24/17/10) 진단 plan 즉시 진입 (P0 BACKLOG, 세션 309).

**답습 자산**: 세션 308 PR #11 = Phase 3+4+5 일괄 폐기 (-108줄) + audit-fill-matrix.mjs 신규 (CI 가드) + 5/31 dry-run 실증 1회 의무.
