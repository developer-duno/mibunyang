# 컬럼별 NULL 비율 모니터 — 구현 plan

> 출처 spec: `docs/superpowers/specs/2026-05-17-category-null-monitor-design.md`
> BACKLOG/NEXT_SESSION #4 (세션 258 후속) · 작성 세션 263

## Context

`monitor-collectors.mjs` ④번 NULL 급증 점검이 `regions` 테이블 2개 컬럼만 본다.
`apartments` 계열 19 카테고리(122 필드)의 NULL 률은 `data-audit.mjs --json` 이
산출하나 감시 장치가 없다. 수집기가 조용히 망가져 카테고리 전체가 NULL 이 되어도
알림이 안 간다. 기존 ④번을 `data-audit` 카테고리 점검으로 확장한다.

## 사전 확인 결과 (실측)

- `data-audit.mjs` — `computeAudit`(L159) · `fetchAllFromView`(L413) · `AUDIT_FIELDS`(L41)
  모두 이미 `export`. → import 만으로 재사용, `data-audit.mjs` 코드 변경 0줄.
- `data-audit --json` 실측 (2026-05-17, 2001 단지) → `categories` 19개 각각
  `{ collector, filled, total, rate }`. baseline 표는 spec 참조.
- `monitor-collectors.mjs:33` `REGION_KEY_COLUMNS = ["net_migration", "crime_grade"]`
  — 기존 ④번 점검 대상. 유지.
- `monitor-collectors.mjs` 는 `// @ts-check` 모드.
- `sendTelegram`/`formatIssue` (`notify-telegram.mjs`) · `Issue` 타입 재사용.
- `monitor-collectors.test.mjs` 존재 — 순수 함수 단위 테스트 패턴.

## 단계 1 — monitor-collectors.mjs ④번 카테고리 점검 추가

- **수정 파일**: `scripts/monitor-collectors.mjs` (1파일)
- **변경 내용**:
  1. import 에 `data-audit.mjs` 추가:
     `import { computeAudit, fetchAllFromView } from "./collectors/data-audit.mjs";`
  2. 상수 `AUDIT_CATEGORY_BASELINE` 추가 — 12개 카테고리 `{ 카테고리: 기대최저rate }`
     (spec 표: core 70 / price 75 / building 50 / risk 90 / infra 70 /
     transport 45 / schools 90 / trade_stats 75 / environment 65 /
     competition 45 / air 90 / safety 60). **plan 실행 직전 `data-audit --json`
     재실측으로 값 확정.**
  3. 순수 함수 `checkCategoryNullSurge(categories, baseline)` 추가:
     - `categories` = `Record<string, { collector, filled, total, rate }>`
     - baseline 에 있는 카테고리만 순회. `total === 0` 가드. `rate < baseline` 이면
       `Issue { kind: "nulls", collector: "<cat> 카테고리 (<collector>)", detail: ... }`
     - `export` (테스트 대상)
  4. I/O: daily 모드 ④번에 카테고리 점검 추가:
     `issues = issues.concat(checkCategoryNullSurge(computeAudit(await fetchAllFromView(getSupabase(), null)).categories, AUDIT_CATEGORY_BASELINE));`
  5. 헤더 주석 ④ 설명 갱신: "regions 핵심 컬럼 + apartments 19 카테고리 NULL 비율"
- **변경량**: ~36줄 (상수 13 + 함수 18 + import 1 + 호출 2 + 주석 2)
- **유지(변경 0)**: `checkNullSurge` · `fetchRegionColumnStats` · `REGION_KEY_COLUMNS`
- **커밋**: `feat(monitor): data-audit 19 카테고리 NULL 비율 점검 추가`

## 단계 2 — monitor-collectors.test.mjs 테스트 추가

- **수정 파일**: `scripts/monitor-collectors.test.mjs` (1파일)
- **변경 내용**:
  1. L15 import 구조분해 목록에 `checkCategoryNullSurge` 추가
     (`const { checkFailedRuns, ..., checkNullSurge, checkCategoryNullSurge } = await import(...)`)
  2. `checkCategoryNullSurge` 단위 테스트 `describe` 추가 (fake categories 주입):
     - baseline 아래 rate → Issue 1건, detail 에 rate·baseline 포함
     - baseline 이상 rate → Issue 0건
     - allowlist 미포함 카테고리(benefits 등) → 무시 (Issue 0건)
     - `total === 0` → Issue 0건
- **변경량**: ~32줄 (import 1 + describe 1 + it 4)
- **선행**: 단계 1 (함수 export 후)
- **커밋**: `test(monitor): checkCategoryNullSurge 단위 테스트`

## 검증

1. **typecheck** (CLAUDE.md `typescript-patterns.md` §11 시뮬레이션):
   `npm run typecheck:scripts` 또는 `npx tsc --noEmit` — `data-audit` import 후 errors
   변동 0 확인. `computeAudit` 반환 타입 `AuditResult` ↔ `checkCategoryNullSurge`
   인자 타입 정합 확인 (불일치 시 JSDoc cast 또는 typedef 정정).
2. **단위 테스트**: `npx vitest run monitor-collectors.test.mjs --no-cache` — 기존 +
   신규 전부 pass. (stale 캐시 함정 → `--no-cache`, MEMORY 박제)
3. **로컬 실행 검증**: `node scripts/monitor-collectors.mjs --mode=daily`
   (`.env.local` 의 SUPABASE 키 필요) — 카테고리 점검이 실제 categories 를 받아
   동작하는지, baseline 아래 카테고리가 있으면 Issue 출력되는지 확인. 텔레그램
   토큰 미설정 시 "전송 스킵" 정상.
4. **audit 회귀**: `node scripts/audit-monitor-coverage.mjs` 실행 (실재 확인됨,
   `.test.mjs` 동반). 이 audit 은 "수집기 워크플로 ↔ monitor 목록" 커버리지를
   점검 — `monitor-collectors.mjs` 내부 함수 추가와 무관할 가능성이 높으나,
   변경이 audit 을 깨뜨리지 않는지 1회 실행으로 확인 (단정 금지).

## 회귀 위험

전 단계 🟢. `monitor-collectors.mjs` 1파일 + test 1파일. `data-audit.mjs` 0줄.
기존 ④번(regions) 점검 미변경 — 회귀 0. 신규 함수는 순수 함수 + daily 모드에만
호출 추가 (run 모드 영향 0).

## 9 GATE 검증 결과 (세션 263 — plan 작성 단계)

| GATE | 항목 | 판정 | 근거 |
|---|---|---|---|
| 0 | Sonnet 크기 | 🟢 | 2단계, 각 1파일 ~36/32줄 |
| 1 | 영향 범위 | 🟢 | data-audit export grep 실측, test import 패턴 Read 실측 |
| 2 | 실행 순서 | 🟢 | 단계 2 = 단계 1 선행, 독립 커밋 |
| 3 | 완전성 | 🟢 | #4 요청 + 빈데이터/에러 가드 + 테스트 매핑 |
| 4 | 적정성 | 🟢 | data-audit 재사용, 신규 워크플로 0 |
| 5 | 보안 | 🟢 | 신규 시크릿 0, --json PII 미포함 (data-audit.mjs:558) |
| 6 | 프↔백↔DB | 🟢 | DB 변경 0, 타입 정합은 검증 1(typecheck) |
| 7 | 롤백 | 🟢 | 단계별 1커밋, 마이그 0 |
| 8 | UX/확장성 | 🟢 | 알림에 수집기명 명시, 조회 1회/일 |

**9 GATE(0~8) 중 🟢9 🟡0 🔴0 → 실행 허가.** 코드 변경은 다음 세션 진입 시.
다음 세션 plan 실행 직전 `data-audit --json` 재실측으로 baseline 값만 재확인
(`next-session-grep-mandate` §1).
