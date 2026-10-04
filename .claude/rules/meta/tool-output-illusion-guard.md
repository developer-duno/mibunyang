# 도구·집계 출력값 착시 차단 — 실데이터 교차 확인 의무

## 한 줄

`data-audit` 채움률·`collector_runs` 상태·monitor 집계·서브에이전트 보고는 전부 **2차 가공값**이다. 원본(base 테이블·VIEW·raw API 응답)이 1차 진실. 가공값 하나만 보고 "사고/정상" 단정 = 착시.

## 규칙

1. **"0% / ok=0 / stale / 미실행" 신호는 단정 전 원본 1회 직독** — 그 컬럼을 base 에서 `count: 'exact'` 전체 vs `.not(col,'is',null)` 로 센다. base ≠ 가공값 = 측정/마스킹 차이(착시), base 도 0 = 진짜 미수집.
2. **sentinel/마스킹 규칙 먼저 확인** — `data-audit.mjs` `MASKED_DEFAULTS`(subwayDist:9999·icDist:99·ktxDist:99) 같은 상수를 채움률 해석 전에 직독.
3. **"미실행" 단정 전 `collector_runs`(이름이 PHASE 상수라 파일명과 다를 수 있음) + 워크플로 cron 둘 다** 확인(분기/월간이면 stale 이 정상인지).
4. **서브에이전트 보고의 수치·"부재 단정"은 직독 후만 신뢰** — base SELECT·코드 grep 1회로 교차.
5. **"grep 0건"으로 출처를 추측 단정 금지** — "없다"는 "우리 게 아니다"만 증명한다. "X 것"이라 하려면 X 소스를 직접 grep 한 양성 증거 1개. 우리가 로드하는 모든 스크립트(번들+인라인+외부 SDK)를 전수 grep. 콘솔 VM숫자 = 동적 주입 신호, 시크릿 모드 재현으로 확장 vs 사이트를 가른다. CSP eval 차단은 우리/SDK 번들 `eval(`·`new Function(` 0이면 외부 주입의 정상 차단 — `'unsafe-eval'` 추가로 막지 말 것.
6. **남이 준 실측도 "측정된 것"과 "해석"을 갈라 받고, 인용할 때 갈라 적는다.** 처방의 근거는 인과가 부정돼도 성립하는 쪽으로. 감사 보고도 직독 검증 대상 — 심각도가 높을수록 먼저 재현한다.
7. **구간별 통계는 버킷팅 전에 null 을 걷어낸다** — `null >= 0` 과 `null < 60` 은 둘 다 true. `a.area != null && a.area > 0 && a.area >= lo && a.area < hi`. 첫 구간의 n 이 유난히 크면 null 이 섞였는지부터 의심.
8. **담당(서브에이전트) 보고의 합계·단정은 원본으로 다시 잰다** — 합계는 원본 로그 세부 항목으로 다시 더하고, "매일 실패" 류는 실행 경로(워크플로 인자)부터, "N만 읽는다" 류는 잘림(1,000행)과 무정렬(끝까지 읽되 빠짐·겹침)을 구분.

## 안티 패턴 (사고 답습)

- ❌ "data-audit 채움률 0% = silent fail" — MASKED_DEFAULTS sentinel 착시 가능. base 직독 의무
- ❌ "collector_runs ok=0 = 사고" — 멱등 재실행(이미 채워 갱신 0건)·연간통계 미출시·전수 skip(데이터 미제공)이면 정상. 세션444 building-hub·regional-economy 선례
- ❌ "서브에이전트가 미실행이라 했으니 미실행" — collector_runs + cron 직독 교차 의무
- ❌ "집계 도구 출력 = 1차 진실" — 전부 2차 가공값. 원본(base/VIEW/raw API)이 진실
- ❌ "stale N일 = 사고" — 월간/분기/연간 cron 주기 대비 정상 범위 먼저 계산

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/meta/tool-output-illusion-guard.md](../../rules-detail/meta/tool-output-illusion-guard.md)
