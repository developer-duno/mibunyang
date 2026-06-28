# 주택보급률(housing_supply_level) 화면 노출 — 설계

> 작성: 2026-06-29 (세션 457) · 상태: 설계 승인 대기

## Context (왜 이 작업을 하는가)

세션 457 부팅 시 NEXT_SESSION 의 "외부 대기 4건"(supply_ratio·eslint10·households·청약홈)을
라이브 실측한 결과 **전부 "지금 못 함"** 으로 확정(세션 454~456 연속 "신규 0" 연장). 그 진단
과정(16-에이전트 워크플로 + 적대검증 8 confirmed)에서 **부수 발견**:

`regions.housing_supply_level`(KOSIS DT_MLTM_2100 주택보급률, 다가구 구분거처 반영)은:
- **데이터는 17개 시도 전부 양질로 채워져 있음**(서울 93.9% / 경기 99.4% / 경북 114.4% … 2024 수록)
- 그러나 **코드 어디서도 안 읽힘**(src/api/VIEW 전수 grep 0건) = "버그로 죽은 컬럼"이 아니라
  **"데이터는 살아있는데 화면 연결만 끊긴 미완성 기능"** (세션 237 W1 에서 컬럼·collector 만 만들고
  화면 배선 후속을 안 함).
- KOSIS collector(`collect-housing-supply-ratio.mjs`, 로컬 매월 2일)는 이 컬럼을 계속 채우는 중.

**사장님 결정 = "완성"**(제거 아님). 양질 데이터를 손님 화면에 노출. 기준(사장님 명시):
"프로젝트 목적 부합 + 사용자 편의 + 미래가치·실증 근거 + 데이터 관리".

**의도한 결과**: 손님이 상세 화면에서 그 단지 시도의 "주택보급률 99.4%"를 보고 지역 수급(집이
남는지/모자라는지)을 판단할 수 있다. 표현계층 + DB VIEW 노출 + 데이터 관리(monitor/audit) 변경.
**점수·엔진 무변경**(표시만, 세션 391 net_migration 이 "표시는 가격섹션·점수는 미래" 식으로 분리된
선례와 달리 본 필드는 점수 미반영 — 사장님 "기본은 표시만, 점수 불변" 확정).

## 모델 케이스 = netMigration (동일 패턴 답습)

`netMigration`(순이동)이 본 작업의 완벽한 선례 — 똑같이 `regions` 시도행에서 오고, VIEW
`latest_regions` CTE에서 `array_agg FILTER` 컬럼별 최신 non-null 로 뽑고, camelCase 노출,
API에서 `?? null`(점수 강제 안 함), 타입 `number | null`, fieldMeta "가격" 섹션. **housingSupplyLevel
을 netMigration 과 1:1 대응으로 추가한다.**

## 변경 범위 (파일별 체크리스트)

### A. DB VIEW 노출 (신규 마이그레이션) — 핵심

신규 파일 `supabase/migrations/20260629000000_view_add_housing_supply_level.sql`:
- `CREATE OR REPLACE VIEW apartments_flat WITH (security_invoker = on) AS ...` (전체 재정의,
  supabase/CLAUDE.md "DROP VIEW 금지 — GRANT 동반 삭제" → `CREATE OR REPLACE` 사용. 최신
  정의 `20260627000000_view_clamp_unsold_rate.sql` 본문 복제 후 2줄만 추가)
- `latest_regions` CTE(L49-62, `WHERE gu IS NULL`)에 1줄:
  `(array_agg(housing_supply_level ORDER BY recorded_at DESC) FILTER (WHERE housing_supply_level IS NOT NULL))[1] AS housing_supply_level`
  → **세션 391 lag 회피**(population 이 새 recorded_at 행을 housing_supply_level NULL 로 INSERT 해도
  옛 non-null 값을 가져옴). 이게 "데이터 관리 잘"의 핵심.
- 최종 SELECT 에 1줄: `r.housing_supply_level AS "housingSupplyLevel"` (netMigration L191 옆)
- 끝에 `NOTIFY pgrst, 'reload schema';`
- rollback 짝 파일: `20260629000001_rollback_*.sql`(직전 `20260627000000` 본문으로 되돌리는
  CREATE OR REPLACE — 기존 rollback 마이그 `20260627000001` 패턴 답습)
- **적용**: supabase CLI `db query --file`(BEGIN;…ROLLBACK; 시뮬 1회 후) 또는 Dashboard 수동.
  regions = mibunyang 전용 테이블이라 상대 프로젝트(naver-estate-web) 영향 0.

### B. API 매핑 (`api/supabase/apartments.ts`)

- L267(netMigration) 옆: `housingSupplyLevel: row.housingSupplyLevel ?? null,`
  → **`?? null`** (점수 안 쓰므로 비관적 기본값 150 같은 강제 없음. netMigration 동일).
- `_fallback*` 플래그 **불필요**(netMigration 도 없음 — "미수집" 표시는 값 null 로 fieldMeta fmt 가 처리).

### C. 타입 (`src/types/database.types.ts` + `src/types/scoring.ts`)

- `database.types.ts`: apartments_flat VIEW row 타입에 `housingSupplyLevel: number | null;`
  (netMigration L1955 옆).
- `scoring.ts`: Apartment 인터페이스(L73 netMigration 옆) `housingSupplyLevel?: number | null;`.
  ⚠️ **scoring.ts L225-231 의 `{ pir, psr, unsoldRate, supplyRatio, maint }` 타입은 regionMedians
  (점수용 중위값) 타입이지 apartments_flat row 가 아님 — housingSupplyLevel 은 점수 미반영이므로
  여기 추가 금지.** Apartment 인터페이스(화면/표시용)에만 추가.
  ⚠️ database.types.ts 는 보통 supabase gen 산출물 — 본 프로젝트는 수동 유지하므로 직접 편집(grep
  로 supplyRatio/netMigration 이 수동 박혀있음 확인됨).

### D. 화면 노출 (`src/constants/fieldMeta.ts`) — 2곳

1. fieldMeta 객체에 항목(L17 `n(v, unit, fallback)` 헬퍼 = `v != null ? `${v}${unit}` : fallback`):
   ```ts
   housingSupplyLevel: {
     label: "주택보급률",
     section: "가격",
     unit: "%",
     fmt: (v) => n(v, "%", "미수집"),
   },
   ```
   → `n(99.4, "%", "미수집")` → `"99.4%"`, null → `"미수집"`. (supplyRatio 는 `n(v, "%")` =
   fallback "—" 인데, 본 필드는 netMigration 톤의 "미수집" 명시 — regions 시계열 미수집 표현 일관.)
2. "가격" 섹션 fields 배열(L567-580)에 `"housingSupplyLevel"` 추가(netMigration L579 옆).

**섹션 = "가격/시장 지표"** 결정 근거(실증): netMigration·priceIndex·avgPriceSqm 등 **모든 regions
지역 시장통계가 이미 이 섹션에 모여 있음**(L567-580 실측) → 일관성. 주택보급률 = 지역 수급 지표라
의미상 "가격/시장" 정확. 별도 섹션 신설은 surgical 위배(YAGNI).
**라벨 = "주택보급률"**(KOSIS 공식 지표명 그대로 = netMigration "순이동"·priceIndex "분양가격지수"
컨벤션 답습). **형식 = "99.4%"**. 데이터 없으면 "미수집"(netMigration 동일).

### E. 데이터 관리 (사장님 강조점) — monitor + audit 등재

**세션 391 룰 `.claude/rules/collectors/regions-multicollector-recorded-at-lag.md`의 "신규
multi-collector regions 컬럼 추가 시 (의무)" 4단계 이행:**

1. `scripts/collectors/data-audit.mjs` L91 AUDIT_FIELDS 의 regions 카테고리 fields 배열에
   `"housingSupplyLevel"` 추가 + L497 영역에 `apt.housingSupplyLevel = r.housing_supply_level;`
   (supplyRatio L497 / netMigration L498 패턴). → 채움률 감사 대상에 편입.
2. `scripts/monitor-collectors.mjs`:
   - `REGION_KEY_COLUMNS`(L50)에 `"housing_supply_level"` 추가.
   - `VIEW_REGION_STALE_TARGETS`(L221-223)에 1줄:
     `{ viewKey: "regions.housingSupplyLevel", regionColumn: "housing_supply_level", label: "주택보급률 (KOSIS)" }`
   → VIEW NULL 회귀 시 텔레그램 알림(net_migration 과 동일 안전망).
   - ⚠️ collector(`collect-housing-supply-ratio.mjs`)는 이미 `.is("gu", null)` **모든 recorded_at
     행 전수 UPDATE** 구조라(net_migration 의 후행 lag 위험과 다름) VIEW array_agg FILTER 만으로도
     안전. monitor 등재는 미래 회귀 대비 보강.

### F. 테스트 (회귀 가드)

- `api/supabase/apartments.test.ts`: housingSupplyLevel 매핑 검증(netMigration/supplyRatio 테스트
  답습 — row 에 값 있을 때/null 일 때 응답 확인).
- `src/constants/` 의 fieldMeta/subContext 테스트가 있으면 "가격" 섹션에 housingSupplyLevel
  포함 확인(기존 netMigration 검증 패턴 따라).
- `scripts/collectors/data-audit.test.mjs`: AUDIT_FIELDS regions 카테고리 필드 수 변경 시 따라
  수정(있으면).
- monitor 테스트(`monitor-collectors.test.mjs`)에 VIEW_REGION_STALE_TARGETS 항목 수 하드코딩
  있으면 +1.

## 명시적 비-작업 (YAGNI)

- **점수 엔진 무변경**: engine.ts sanitize / computeRegionalMedians / scoreRisk 안 건드림. fieldMeta
  등록만으로 점수에 자동 반영되는 메커니즘 없음(확인됨 — 점수는 명시적 필드 리스트 기반).
- **collector·local-runner 무변경**: 이미 정상 작동. recorded_at 무필터 구조도 "전수 UPDATE"라
  무해(net_migration market-stats 식 정답 패턴). 굳이 housing-permits 식 "최신행만"으로 안 바꿈
  (지금 손대면 회귀 위험 > 이득).
- 툴팁/설명 인프라 신설 안 함(fieldMeta description 필드 부재, 과한 신규 구조).
- supply_ratio(인허가 증가율, MOLIT 장애로 0%) 는 **별개 컬럼·별개 문제** — 본 작업 무관(우리가
  못 고침, 관찰만).

## 검증 (end-to-end)

1. **VIEW 마이그 시뮬**: `BEGIN; <마이그>; SELECT housing_supply_level FROM apartments_flat LIMIT 3; ROLLBACK;`
   → 시도행 값(99.4 등) 나오는지. (supabase CLI db query 또는 Dashboard)
2. **회귀 가드**: `npm run lint` + `npm run format:check`(src 편집 후 필수, 세션456 교훈) +
   `npm run typecheck` + `npm run typecheck:scripts` + `npm run test` + `npm run build`.
   api/ 는 CI typecheck 사각 → `npm run build`(esbuild) 로 간접 검증.
3. **라이브 적용 후**: production apartments_flat 에서 housingSupplyLevel 노출 확인 + 손님 상세
   화면(가격/시장 지표 섹션)에 "주택보급률 99.4%" 표시 확인(👤 또는 빌드 후 로컬 dev).
4. **데이터 관리 검증**: `data-audit.mjs --json` 에 housingSupplyLevel 채움률(~100% 기대) 표시 +
   monitor checkViewRegionStale 가 새 타깃 인식.

## 리스크 / 롤백

- VIEW `CREATE OR REPLACE` 라 GRANT 보존(DROP 아님). security_invoker=on 명시(supabase/CLAUDE.md).
- 실패 시 rollback 마이그(`20260629000001`)로 직전 VIEW 정의 복원.
- 점수 무변경이라 cats_cache 재계산 불필요(표시 전용). production 점수 영향 0.
