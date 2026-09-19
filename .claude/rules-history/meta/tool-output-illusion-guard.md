# 도구·집계 출력값 착시 차단 — 실데이터 교차 확인 의무 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/meta/tool-output-illusion-guard.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 446)

수집기 전수검사 중 `data-audit.mjs --json` 출력의 "채움률 0%/저채움" 값을 **실데이터로 직접 확인하지 않고 그대로 믿고** "silent fail 후보 10개"로 단정 → 서브에이전트 워크플로에 그 잘못된 전제를 그대로 넣어 보냄. 사장님 "착시 실수 강력하게 막아라" 지적.

진짜였던 것 (직접 라이브 확인 후):
- `transport.ktxDist 0%` → **실제 base/VIEW 100% 채워짐**(2001/2001). data-audit 의 `MASKED_DEFAULTS = { subwayDist: 9999, icDist: 99, ktxDist: 99 }`(L40) + L151 `if (field in MASKED_DEFAULTS && value === MASKED_DEFAULTS[field]) return true`(=미수집 간주) 때문에 "값은 99로 정상 저장됐는데 채움률은 0%로 표시"되는 **측정 방식 착시**. KTX/IC 가 측정 반경 밖이면 99(sentinel)로 저장 = 정상 수집인데, audit 은 "유의미하게 가까운 값" 비율만 채움률로 셈.
- 서브에이전트는 한술 더 떠 "transport 수집기 미실행"으로 오판 → 실제 `collector_runs` 에 `transport-tago 0.7일 전 ok=1001 success`.

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| data-audit "X 0%" 보고 → silent fail 단정 | §1 base 직독 의무 → 100% 채워짐(sentinel 착시) 발견 |
| ktxDist/icDist 0% → 수집 사고 의심 | §2 MASKED_DEFAULTS 직독 → 99=정상 sentinel 확인 |
| 서브에이전트 "수집기 미실행" → 고장 보고 | §3 collector_runs ok=1001 + cron 확인 → 정상 |
| collector_runs ok=0 → 사고 단정 | §1+안티패턴 → 멱등/미출시/skip 정상 가능성 교차 |

## 답습 자산

- 세션 446 본 사고 박제 (data-audit 0% 착시 + 서브에이전트 미실행 오판 직독 정정)
- `scripts/collectors/data-audit.mjs` L40 MASKED_DEFAULTS + L151 마스킹 로직 = 착시 원천
- [[feedback-subagent-report-trust]] · [[feedback-memory-not-authoritative]] 답습
- 본 룰 박제와 함께 data-audit.mjs 출력에 sentinel 경고 1줄 추가(세션446) — 사람이 0% 를 silent fail 로 오인하지 않게
