# 컬럼별 NULL 비율 모니터 — 설계 문서

> 작성: 2026-05-17 · BACKLOG/NEXT_SESSION #4 (세션 258 후속) · 세션 263 brainstorming

## 문제

`monitor-collectors.mjs` 의 ④번 "NULL 급증" 점검이 `regions` 테이블의 단 2개 컬럼
(`net_migration`, `crime_grade`) 만 본다 (`monitor-collectors.mjs:33` `REGION_KEY_COLUMNS`).

`apartments` 계열 데이터는 19개 카테고리 122개 필드를 가지며, `data-audit.mjs --json`
이 이들의 NULL 비율(`filled`/`total`/`rate`) 을 산출한다. 그러나 이 결과를 보는
감시 장치가 없다. 수집기 하나가 조용히 망가져 한 카테고리 전체가 NULL 로 채워져도
(예: `infra` 수집기가 빈손 success → 모든 단지 인프라 거리 NULL) 텔레그램 알림이 안 간다.

`monitor-db-size.yml` 은 테이블별 "행 수"만 본다 — 행은 있는데 컬럼이 NULL 인 경우를
못 잡는다.

## 목표

`apartments` 계열 19개 카테고리의 NULL 률을 매일 점검해, 카테고리 rate 가 기대치보다
크게 떨어지면 텔레그램으로 알린다. 기존 ④번(regions 컬럼) 점검은 그대로 유지한다.

## 접근

기존 `monitor-collectors.mjs` ④번을 **확장**한다 — 신규 워크플로·신규 Secret 0.

### 왜 카테고리 단위인가 (필드 단위 아님)

`data-audit --json` 출력은 두 층위가 있다:
- `fields` — 122개. 너무 세밀하다. 매일 알림 폭주 위험.
- `categories` — 19개. 각각 `{ collector, filled, total, rate }`. 카테고리 = 수집기
  1:1 대응이라 "어느 수집기가 망가졌나" 가 알림에 바로 나온다.

→ 카테고리 단위로 점검한다.

### 왜 카테고리별 baseline 인가 (단일 임계값 아님)

실측 (`data-audit --json`, 2026-05-17, 2001 단지):

| 카테고리 | 실측 rate | 성격 |
|---|---|---|
| core | 84.5% | 자동수집 (정상) |
| price | 90% | 자동수집 |
| building | 67% | 자동수집 (일부 필드 부분) |
| **maintenance** | **1%** | K-apt 부분 매칭 (정상 — 의도적 저율) |
| **benefits** | **0%** | 시행사 수기입력 (자동수집 대상 아님) |
| infra | 87.7% | 자동수집 |
| transport | 61.7% | 자동수집 (ktxDist 0% 등 의도적 NULL 포함) |
| schools | 99.2% | 자동수집 |
| **builders** | **5.7%** | DART 부분 매칭 (정상 — 의도적 저율) |
| regions | 24.7% | 일부 컬럼 미수집 (priceIndex/avgPriceSqm 등 0%) |
| trade_stats | 88.8% | 자동수집 |
| naver | 57% | 로컬 전용 수집 (부분) |
| environment | 83.8% | 자동수집 |
| **future** | **30.6%** | 부분 수집 (cityDev/industryDev 저율) |
| **energy** | **29%** | BldEngyHub 주거용 데이터 부재 (의도적 저율) |
| competition | 63.1% | 무순위 단지 한정 (정상 부분) |
| air | 99.2% | 자동수집 |
| safety | 79% | 자동수집 (emergencyName/Type 50% 부분 매칭) |

단일 임계값(예: rate < 60%) 을 모든 카테고리에 적용하면 `benefits`·`maintenance`·
`builders`·`energy`·`future` 가 **정상인데도 매일 오탐**을 낸다.

→ 점검 대상 카테고리를 **명시적 허용목록**으로 한정하고, 각 카테고리에 "기대 최저
rate" 를 박는다. 현재 rate 가 baseline 아래로 떨어질 때만 알림.

## baseline 값 (실측 기반 도출)

원칙: **실측 rate 에서 안전 마진(약 15~20%p) 을 뺀 값**을 baseline 으로 박는다.
정상 변동은 통과시키되, 수집기 고장 수준의 급락만 잡는다.

점검 대상 (allowlist) — 자동수집 + rate 가 안정적으로 높은 카테고리:

| 카테고리 | 실측 rate | baseline (기대 최저) | 비고 |
|---|---|---|---|
| core | 84.5% | 70 | 단지 기본정보 |
| price | 90% | 75 | 분양가 |
| building | 67% | 50 | 건물 상세 (부분 필드 多) |
| infra | 87.7% | 70 | Kakao 인프라 |
| transport | 61.7% | 45 | 교통 (의도적 NULL 多) |
| schools | 99.2% | 90 | NEIS 학군 |
| trade_stats | 88.8% | 75 | 실거래 통계 |
| environment | 83.8% | 65 | 환경 |
| competition | 63.1% | 45 | 무순위 청약 |
| air | 99.2% | 90 | 대기질 |
| safety | 79% | 60 | 범죄/응급의료 |

**제외** (점검 안 함 — 의도적 저율/수기입력):
`benefits`(수기), `maintenance`(부분 매칭), `builders`(DART 부분), `energy`(주거용
데이터 부재), `future`(부분 수집), `regions`(apartments-VIEW 측 regions 카테고리는
priceIndex 등 미수집 컬럼 포함 — regions 테이블 직접 점검은 기존 ④번이 담당).

> baseline 값은 plan 작성 시 실측 재확인 후 확정. 위 값은 2026-05-17 1회 실측 기준
> 초안. CLAUDE.md `next-session-grep-mandate` §1 — plan 진입 시 `data-audit --json`
> 재실행으로 rate 변동 확인 의무.

## 컴포넌트

### 1. `data-audit.mjs` — 변경 0줄

`computeAudit`(L159) · `fetchAllFromView`(L413) · `AUDIT_FIELDS`(L41) 모두 이미
`export` 됨. `monitor-collectors.mjs` 가 직접 import 해서 함수 호출 — 자식 프로세스
spawn 불필요.

### 2. `monitor-collectors.mjs` — ④번 확장

신규:
- 상수 `AUDIT_CATEGORY_BASELINE` — `{ 카테고리: 기대최저rate }` (위 표의 11개)
- 순수 함수 `checkCategoryNullSurge(categories, baseline)` — categories 의 rate 가
  baseline 아래면 `Issue` 생성. `kind: "nulls"` 재사용. `collector` 필드에는
  카테고리명 + 담당 수집기명(예: `"infra 카테고리 (infra-kakao)"`).
- I/O 래퍼: `computeAudit(await fetchAllFromView(sb, null))` 호출해 categories 추출

유지 (변경 0):
- `checkNullSurge`(regions 컬럼) · `fetchRegionColumnStats` · `REGION_KEY_COLUMNS`
  — 커버리지 손실 0
- daily 모드 ④번에 `checkCategoryNullSurge` 호출 1줄 추가

헤더 주석 ④ 설명 갱신: "regions 핵심 컬럼 + apartments 19 카테고리 NULL 비율".

### 3. `monitor-collectors.test.mjs` — 테스트 추가

`checkCategoryNullSurge` 순수 함수 단위 테스트:
- baseline 아래 카테고리 → Issue 1건
- baseline 이상 → Issue 0건
- allowlist 에 없는 카테고리(benefits 등) → 무시 (Issue 0건)
- `total === 0` 가드

## 데이터 흐름

```
monitor-collectors.mjs (daily 모드)
  → fetchAllFromView(sb, null)        # data-audit 의 조회 함수 재사용
  → computeAudit(rows)                # data-audit 의 계산 함수 재사용 → categories 19개
  → checkCategoryNullSurge(categories, AUDIT_CATEGORY_BASELINE) → Issue[]
  → checkNullSurge(fetchRegionColumnStats())  # 기존 regions 컬럼 점검 (유지)
  → formatIssue → sendTelegram        # 기존 알림 경로 재사용
```

`run` 모드(workflow_run 트리거)는 카테고리 점검 안 함 — daily 전체 스윕에서만.
이유: 카테고리 점검은 무거운 전체 조회(2001 단지 + 7 테이블 merge)라 매 수집기
종료마다 돌릴 필요 없음. 하루 1회로 충분.

## 워크플로

`monitor-collectors.yml` 변경 0. daily cron(`0 0 * * *`)·workflow_dispatch 그대로.
필요 환경변수 `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`·`TELEGRAM_*` 이미 yml 에 주입됨.

## 에러 처리 / 빈 데이터

- `fetchAllFromView` 가 0건 반환 → `computeAudit` 가 `categories: {}` 반환 →
  `checkCategoryNullSurge` 는 빈 categories 에 대해 Issue 0건 (기존 `checkNullSurge`
  의 `total === 0 continue` 와 동일 가드 패턴).
- `data-audit` 조회 자체가 throw 하면 → `main()` 의 `.catch` 가 잡아 exit 1.
  CLAUDE.md 정책상 감시 스크립트 실패는 GitHub Actions 가 빨강으로 표시 → 별도
  알림 불필요 (monitor 자신의 실패는 Actions UI 가 알림).

## 회귀 위험

- `monitor-collectors.mjs` 1파일 + `monitor-collectors.test.mjs` 1파일 수정.
  `data-audit.mjs` 0줄.
- 기존 ④번(regions) 점검 미변경 — 회귀 0.
- `// @ts-check` 모드 — `data-audit` import 시 typecheck 통과 확인 의무
  (CLAUDE.md `typescript-patterns.md` §11 시뮬레이션).

## 명시적 비-작업

- `data-audit.mjs` 자체 로직 변경 (categories/fields 정의는 세션 262 확정분 사용)
- `monitor-db-size.yml` 변경 (행 수 점검은 별개 — 그대로 유지)
- 카테고리별 시계열 추세 분석 (지난 NULL률 대비 증가폭) — 현재는 절대값 baseline
  만. 추세는 별도 후보.
- UI 노출 (`data-audit` 결과의 관리자 페이지 표시 등)
