# TypeScript 부트스트랩 설계 (세션 170)

> 작성일: 2026-05-03 · 세션: 170 · 단계: brainstorming spec
> 후속: 다음 세션에서 `superpowers:writing-plans` 로 구현 plan 작성 후 실행

## Context

미분양 비교 엔진 v3.0 은 현재 `src/` 100% JS/JSX 로 작성돼 있고 `tsconfig.json` 이 0개다. 그러나 다음 사정이 누적되면서 TypeScript 도입의 ROI 가 임계를 넘었다:

1. **데이터 복잡도 증가** — apt 95필드 + presale 19컬럼 + 점수 res 6카테고리 41지표 + 13개 useMemo 체인. 신규 미션(applyhome events 시계열, 카카오 알림톡, 메인 UI 재설계) 모두 데이터 모양을 더 복잡하게 만든다.
2. **회귀 사고 누적** — 세션 162 admin 토큰 storage, 세션 165 VIEW 별칭, 세션 168 alertRow comparator 6필드 누락 — 셋 다 타입이 있었으면 컴파일 단계에서 잡혔을 사고.
3. **운영 데이터 노출 단계** — admin 5명 운영 + 곧 베타테스터 + 카카오 알림톡 발송. 사고 비용이 사용자 영향으로 직결되기 시작.
4. **혼자 + AI 도구 운영 모델** — 사용자 1인이 Claude Code/ChatGPT 를 적극 활용. AI 도구는 TS 코드를 30~50% 더 정확히 다룬다 (2026년 시점). 즉 TS 도입은 운영 모델과 직접 정합.
5. **부분 도입 흔적** — `e2e/*.spec.ts` 13개 + `playwright.config.ts` 가 이미 .ts. typescript 패키지 자체는 없으며, Playwright 자체 ts 실행기로 동작 중.

목표: **6개월(2026-05-03 ~ 2026-11-03) 안에 `src/` 100% TypeScript 마이그레이션 완료**, allowJs:false 전환으로 종결.

## Goals

- `src/` 하위 모든 .js/.jsx 파일을 .ts/.tsx 로 변환
- `tsconfig.json` strict:true 유지 (처음부터 엄격)
- scoring · api · components · hooks 의 핵심 도메인 타입(Apt, Res, Cats, Profile, PresaleEvent, ApiResponse 등) 단일 출처(`src/types/`) 정의
- 미션 A (메인 UI 재설계, 5~10세션) 진행과 충돌 없이 동시 진행 — 오히려 가속
- 번들 크기 +5KB 이내 (TS 자체는 빌드 시 제거, zod 같은 런타임 검증 라이브러리 도입 시에만 증가)
- **런타임 동작 변화 0** — 타입 소거 후 emit 결과는 기존 JS 와 의미적 동등. 검증: 각 마일스톤마다 `npm run test` 100% 통과 + e2e smoke 1회. Vercel 빌드는 typecheck 안 함 — CI(ci.yml) 가 단독 typecheck 게이트

## Non-Goals

- `scripts/` 100% TS 변환은 본 6개월 범위 외 (외부 API 응답 변동성 높아 ROI 낮음 — 50% 까지만 목표, 나머지는 후속 분기)
- `api/*` Vercel 함수 100% TS 변환은 본 범위 외 (타입 정의는 완료하되 핸들러 변환은 후속)
- 런타임 검증(zod/io-ts) 전면 도입은 본 범위 외 — 외부 API 응답 검증 한정으로만 시범 적용
- TypeScript 5.x 의 모든 신기능 도입(Decorator, const Type Parameters 등) — strict + 기본 타입만 사용

## 결정된 핵심 선택

| 결정 | 선택 | 사유 |
|---|---|---|
| 도입 범위 | `src/` 전체 100% + scripts/api 단계적 | 사용자 결정 (이번 세션) |
| 일정 | 6개월 (2026-05-03 ~ 2026-11-03) | 미션 A 와 동시 진행 가능, 어정쩡한 상태 6개월 이상 방치 위험 차단 |
| 점진 방식 | allowJs:true + 파일별 점진 | 수평적 경계 최소, 대부분 대형 프로젝트 표준 |
| strict 강도 | strict:true 처음부터 | 회귀 사고 최소화 목적과 정합. any 남발 방지 |
| 번들 허용 | +5KB 까지 | zod 같은 경량 런타임 검증 도입 여지, 그 이상은 거부 |
| 미션 A 와의 관계 | M3 단계에서 동시 진행 | 어차피 컴포넌트 36개 손볼 작업, 변환 비용 0 |

## 마일스톤 (M0 ~ M6)

> **각 마일스톤은 다수 세션의 묶음.** Sonnet 1세션 = 1커밋 = 1~3파일 변경 단위로 분할 진행. M3/M4/M5 는 4~10세션 분량의 묶음이므로 plan 단계에서 세션 단위로 재분할 필요.

### M0 — 부트스트랩 (1세션, 2026-05 중순)

**전제:** 미션 A brainstorming 완료 후, 미션 A 첫 코드 세션 직전 시점.

작업:
1. `npm install -D typescript@5 @types/react@19 @types/react-dom@19 @types/node@20 @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8 --legacy-peer-deps`
   - eslint 9 호환 메이저(@8). `--legacy-peer-deps` 는 ci.yml 과 정합 (기존 정책 유지)
   - 설치 후 `npm ls eslint` 로 peer 충돌 0 확인
   - `npm view @typescript-eslint/parser@latest peerDependencies` 결과 `eslint: ^8 || ^9 || ^10` 호환 검증됨 (4차 검증)
2. `tsconfig.json` 신규 작성 (아래 § 참조)
   - `include: ["src", "api", "vite.config.ts", "vitest.config.ts"]` — api/ 포함 (4차 신규)
   - `incremental: true`, `tsBuildInfoFile: "./node_modules/.cache/.tsbuildinfo"` 추가
   - e2e/ 는 별도 `tsconfig.e2e.json` 분리 (M5 진입 시 작성)
3. `package.json` 에 `"typecheck": "tsc --noEmit"` 스크립트 추가
4. `eslint.config.js` 보강:
   - L11 `files: ['src/**/*.{js,jsx}']` → `'src/**/*.{js,jsx,ts,tsx}'` 확장
   - `@typescript-eslint/parser` 를 .ts/.tsx 한정 overrides 로 적용
   - `react-hooks` 룰이 .tsx 에서도 동작하도록 files 패턴 통일
5. `vite.config.js` → `vite.config.ts` 로 변환 (확장자만, allowJs 가 켜져 있으므로 영향 0)
6. `vitest.config.js` → `vitest.config.ts` 로 변환 + include 패턴 `*.test.{js,jsx,ts,tsx}` 로 확장 (1차 차단)
7. `package.json` `format` 스크립트 패턴 `src/**/*.{js,jsx,ts,tsx}` 로 확장
8. CI 게이트 — `.github/workflows/ci.yml` 의 `Lint` step 다음에 `Typecheck` step (`npm run typecheck`) 추가. 별도 잡 분리는 선택. e2e.yml/daily-deploy.yml 은 미변경
9. **`scripts/alias-loader.mjs` 에 `.ts` 확장자 분기 추가** (3차 차단):
   ```js
   if (!realPath.endsWith(".js") && !realPath.endsWith(".mjs") && !realPath.endsWith(".ts")) {
     if (existsSync(realPath + ".ts")) realPath += ".ts";
     else if (existsSync(realPath + ".js")) realPath += ".js";
   }
   ```
10. **PR template 신규** — `.github/pull_request_template.md` 작성:
    - "TS 마이그 PR: 확장자 변경과 논리 변경이 분리됐습니까? [ ]"
    - "미션 A 와 같은 파일 동시 수정이 있습니까? [ ]" (1차 husky 차단의 경량 대체)
11. 첫 .ts 시범 파일 + 그에 대한 .test.ts 1개 작성 → `npm run typecheck` + `npm run test` + `npm run lint` 3종 통과 검증
12. M0 직후 cold/incremental typecheck 시간 측정 후 spec 또는 BACKLOG 에 baseline 박제. **30초 초과 시** `tsc -b --incremental` + `tsBuildInfoFile` 도입 검토

산출물:
- `tsconfig.json` 신규
- `package.json` scripts/devDependencies 갱신
- `eslint.config.js` files 패턴 + parser overrides
- `vitest.config.ts` include 확장
- `scripts/alias-loader.mjs` `.ts` 분기 추가
- `.github/pull_request_template.md` 신규
- `.github/workflows/ci.yml` Typecheck step 추가
- 1커밋: `feat(ts): TypeScript 부트스트랩 (M0) — 도구 세팅 + tsconfig strict + typecheck CI`

### M1 — scoring/ 변환 (M0 + 2주, 2026-05 말 ~ 6월 초)

**전제:** scoring/ 7파일에 이미 JSDoc 12식별자 박제 (BACKLOG L68 완료). 4차 검증 실측 — 7파일 모두 200줄 미만, JSDoc 비율 30~45%, 변환 안전성 입증

작업:
1. **선행 — `scripts/compute-scores.mjs:12` 의 `from "@/scoring/engine.js"` 명시 import 확장자 제거** (4차 차단):
   - `import ... from "@/scoring/engine.js"` → `from "@/scoring/engine"` 변경
   - alias-loader 가 .ts/.js 둘 다 자동 검색하도록 M0-9 와 정합
   - **이 선행 안 하면 M1 첫 변환 즉시 daily-deploy.yml 매일 실패**
2. `src/types/scoring.ts` 신규 — Apt, Res, Cats, Profile, ProfileWeights, ScoringContext 타입 정의 (JSDoc 기반)
3. scoring/ 7파일 .js → .ts 확장자 변경 (논리 변경 0). 변환 후 줄 수 예상치 (4차 측정):
   - engine.js (143→165), scorePrice.js (170→185), scoreLocation.js (109→130), scoreProduct.js (79→100), scoreBenefit.js (56→75), scoreRisk.js (119→140), scoreFuture.js (97→115), computeRegionalMedians.js (27→35) — **모두 200줄 미만 유지**
4. JSDoc → 정식 TS 타입 어노테이션 변환 (각 파일 독립 커밋)
5. profileWeights 6필드(price/location/product/risk/benefit/future) 합 100 불변식을 타입으로 표현 시도 (Branded Type 또는 일반 number, 결정은 plan 단계)
6. null/undefined 분기를 strictNullChecks 에 맞춰 명시화
7. M1 종료 시점 검증: `npm run collect` (또는 daily-deploy 시뮬레이션) + `npm run test` 통과 확인

산출물:
- `src/types/scoring.ts`
- scoring/ 7파일 .ts 변환
- scripts/compute-scores.mjs L12 import 경로 변경 (선행)
- 7~10커밋 (파일별 또는 그룹별)

### M2 — api/ + Supabase 응답 타입 정의 (M1 + 4주, 2026-06 ~ 6월 말)

**경고 — 4차 검증 신규 차단:**
- `vercel.json` 의 `"functions": { "api/**/*.js": ... }` glob 이 `.js` 만 매칭. M2 에서 api/_lib/*.ts 변환 시 **vercel.json 동시 변경 필수**

작업:
1. **vercel.json 갱신** (4차 차단): `"api/**/*.js"` → `"api/**/*.{js,ts}"` 동시 변경. 변경 안 하면 Vercel functions maxDuration 30 → 기본 10 강등
2. `src/types/supabase.ts` 생성 — apartments_flat VIEW, presale, applyhome_events, users 등 핵심 테이블 타입.
   - 명령: `SUPABASE_ACCESS_TOKEN=$SBP_TOKEN supabase gen types typescript --project-id rwdtljipvmqpazrimyns > src/types/supabase.ts`
   - 토큰 발급/폐기 절차는 `MEMORY.md` `reference_supabase_management_api.md` 참조 (1회용 환경변수, .env 저장 금지, 작업 후 즉시 폐기)
   - CLI 위치 실측: `~/scoop/shims/supabase`
3. `src/types/api.ts` — api/* 핸들러 응답 공통 타입 (ApiResponse<T>, ErrorResponse 등)
4. **최소 1개 src/ 측 사용 사례 박제** (M3 진입 전 검증 보장): 예를 들어 `src/hooks/useApartmentData.js` 가 `import type { Apt } from '@/types/supabase'` 1회 시도 (M3 본 변환 전 dry-run)
5. api/* 21개 핸들러 중 **공용 헬퍼**(api/_lib/*) 만 .ts 변환. 실측 위치: `f:\mibunyang\api\_lib\` (handler.js, adminAuth.js, auth.js, cors.js, finlife.js, apartmentValidation.js)
6. api/* 개별 핸들러 변환은 본 마일스톤 외 (후속 분기)
7. **`tsc --noEmit` 가 api/_lib/ 검사하는지 검증** — M0-2 에서 include 에 `"api"` 추가했으므로 동작 확인

산출물:
- `vercel.json` glob 패턴 갱신
- `src/types/supabase.ts`, `src/types/api.ts`
- ~~api/_lib/* 일부 .ts (handler, adminAuth, cors 우선)~~ → **세션 175 M2 완료: 13파일 전부 .ts 변환** (handler/auth/tokenBlacklist/redis/cors/rateLimit/adminAuth/proxyValidation/finlife/apartmentValidation/timeseriesHandler/validators/supabase). M5 진입 시 _lib 잔여 0 = 가속
- 5~7커밋

### M3 — components/ 변환 (M2 + 8주, 2026-07 ~ 9월 초, 미션 A 와 동시)

**전제:** ~~미션 A (메인 UI 재설계) 진행 중~~ → **세션 175 사용자 결정 G-E: M3 단독 진행 + 미션 A 는 spec/plan 만 박제 (코드 0)**. 안전망 4건 (Feature Flag + 라우팅 분기 + 코드 보존 + 1커밋 롤백) 미션 A spec 무조건 포함 (`memory/feedback_ux_redesign_rollback.md`). components/ ~~실측 약 45개~~ → **세션 175 정확 실측 67파일** (root 15 + sections 13 + sections/info 3 + filters 8 + expert 9 + admin 8 + detail 11)

**대형 컴포넌트 분할 규칙 (3차 차단):**
- AptCard.jsx 현재 182줄 → .tsx 변환 시 ~212줄 예상. **GATE 0 200줄 상한 초과**
- 대응: 컴포넌트 1개를 한 커밋에 변환할 때 **타입 정의를 별도 .ts 파일로 추출**:
  - `src/types/components/AptCard.types.ts` (타입만, ~30줄)
  - `src/components/AptCard.tsx` (본체, import 만 추가, 줄 수 +5 미만)
  - 단일 커밋 변경량 분산 → 200줄 미만 유지
- 동일 분할 적용 대상: DetailModal(130줄+α), CompareSheet, ExpertDashboard 등 150줄+ 컴포넌트 모두

작업:
1. 미션 A 에서 신규 작성 컴포넌트 → 모두 .tsx (변환 부담 0)
2. 미션 A 에서 손보는 기존 컴포넌트 → .jsx → .tsx 확장자 변경 + props 타입 추가 (별도 커밋)
3. 150줄+ 컴포넌트는 **타입 추출 분할** (위 규칙). 단일 커밋 200줄 이내 강제
4. 우선순위:
   - AptCard, DetailModal, CompareSheet (소비자 핵심) — 분할 변환
   - HeaderSection, SearchFilterBar (UI 진입점)
   - filters/* 7개 (drop-down 패턴 통일)
   - sections/* 9개
   - expert/* 9개 (전문가 페이지 PC 우선)
   - admin/* 5개 (마지막)
5. ~45개 memo 컴포넌트 props 타입 100% 명시. comparator 가 있는 경우(AptCard 1개) 타입 정합 검증 — Apt 타입 필수/선택 필드 일치 강제
6. icons.jsx → icons.tsx (9 SVG)

산출물:
- `src/types/components.ts` (props 공통 타입)
- `src/types/components/*.types.ts` (대형 컴포넌트 타입 추출)
- components/ 80% .tsx
- 30~40커밋 (미션 A 커밋과 별개로 "확장자+타입" 커밋 분리)

**중요 규칙:** 한 커밋 = "확장자 변경 + 타입 추가 + 논리 변경 0" 또는 "UI 재설계 (.tsx 안에서)" — 둘을 섞지 않음. 강제 도구는 M0-10 PR template 체크박스로 경량 강제. husky 도입은 ROI 검토 후 결정.

### M4 — hooks + 잔여 components (M3 + 4주, 2026-09 ~ 10월 초)

작업:
1. `src/hooks/` ~~8~12개~~ → **세션 175 정확 실측 27개** 훅 .js → .ts. useMemo 13개 체인의 반환 타입 명시 (200줄+ 2건 = useFilterSort 307 + useAdminMode 227 분할 강제)
2. ~~`src/utils/`~~ → **세션 175 정확 실측: src/lib/ (10파일, 200줄- 모두)** 유틸 함수 .ts
3. `src/constants/` .ts
4. `src/theme/` .ts
5. M3 에서 미션 A 가 안 건드린 잔여 components/ 변환

산출물:
- src/ 95% .ts/.tsx
- 15~20커밋

### M5 — scripts + e2e + API 핸들러 일부 (M4 + 4주, 2026-10 ~ 11월 초)

작업:
1. `scripts/` 50% TS — 자체 작성 스크립트 우선, 외부 API 호출 스크립트는 후순위
2. 외부 API 응답이 자주 바뀌는 영역(예: 청약홈, 행안부)은 zod schema 도입 여부 결정 (번들 영향 X, 빌드 영향 X — 스크립트는 별도 실행)
3. `e2e/*.spec.ts` 13개 + `playwright.config.ts` 에 타입 보강 (현재는 사실상 .ts in name only)
4. api/* 핸들러 30% 변환 시작 (본 6개월 범위 외 작업의 시작점)

산출물:
- scripts/ 50% .ts
- e2e/ 100% 정식 TS
- api/ 30% .ts
- 10~15커밋

### M6 — 완료 게이트 (1세션, 2026-11-03 전후)

작업:
1. `src/` 100% .ts/.tsx 검증 (`find src -name '*.js*' | wc -l` = 0)
2. `tsconfig.json` 에서 `allowJs: false` 로 전환 + `checkJs: false` (필요 시)
3. `npm run typecheck` 통과 확인 (0 error)
4. 마이그레이션 회고 메모 작성 (`docs/superpowers/specs/2026-11-03-ts-migration-retro.md`)
5. BACKLOG / CLAUDE.md / src/components/CLAUDE.md / src/hooks/CLAUDE.md / api/CLAUDE.md 의 "JS 전제" 표현 갱신
6. 1커밋: `feat(ts): src/ 100% TypeScript 마이그레이션 완료 (M6)`

산출물:
- allowJs:false 적용
- 회고 문서
- CLAUDE.md 갱신

## tsconfig.json 권장 초기 설정

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "allowJs": true,
    "checkJs": false,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "api", "vite.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist", "build", ".vercel"],
  "incremental": true,
  "tsBuildInfoFile": "./node_modules/.cache/.tsbuildinfo"
}
```

선택 근거:
- `strict:true` — 사용자 결정
- `allowJs:true` + `checkJs:false` — 점진 도입의 핵심. JS 파일은 통과시키되 타입 검사는 안 함
- `noUnusedLocals:false` — 마이그레이션 중 임시 변수 허용. M6 에서 true 로 전환 검토
- `paths` — 기존 vite alias `@/` 와 정합
- `target/lib ES2022` — Node 20+ engine 과 정합
- `include: ["src", "api", ...]` — api/_lib/*.ts 도 typecheck 대상 (4차 GATE 6 차단 해소)
- `incremental` + `tsBuildInfoFile` — 큰 프로젝트 cold/warm 차이 완화. .gitignore 의 node_modules/ 안에 캐시 두므로 별도 ignore 불필요
- e2e/ 는 본 tsconfig 에 포함하지 않음. M5 에서 `tsconfig.e2e.json` 별도 생성. 이유: e2e 는 Playwright 자체 ts 실행기로 동작하며 dev/CI typecheck 와 분리 운영이 자연스러움

## 위험 신호와 대응

| 신호 | 트리거 | 대응 |
|---|---|---|
| `any` 누적 | grep 으로 `: any` 5개 이상 src/ 에 등장 | 학습 부족. unknown + narrowing 으로 리팩터. 페이스 다운 |
| 진행률 정체 | 2개월 연속 .ts 파일 비율 변화 < 5% | 일정 재조정 (3개월 연장 또는 범위 축소) |
| 번들 폭증 | dist 측정 결과 +10KB 초과 | zod 사용 줄이기. 런타임 검증 영역 좁히기 |
| typecheck 가 dev 흐름 방해 | tsc --noEmit 가 빌드 또는 vite dev 를 막는 보고 | typecheck 를 별도 CI 잡으로 격리 (이미 권장 구조) |
| 미션 A 와 충돌 | 같은 파일을 두 작업이 동시 수정 | 한 커밋에 두 변화 안 섞는 규칙 강제. PR 분리 |

## 롤백 시나리오

- **M0~M2 동안**: allowJs:true 이므로 .ts → .js 즉시 가능. 영향 범위 = 변환된 파일만
- **M3 (미션 A 와 동시) 시작 후**: 미션 A 커밋과 묶인 .tsx 는 부분 롤백만 가능. 한 커밋에 두 변화 안 섞기 규칙으로 분리됐다면 .tsx 만 .jsx 로 되돌리기 가능
- **부분 strict 다운그레이드 (M3~M5 중 strict:true 가 너무 엄격해진 경우)**: spec 변경 없이 대응 불가 — `tsconfig.lenient.json` (strict:false extend) 별도 작성 후 임시 사용. 또는 개별 `// @ts-nocheck` per-file. 단 strict 다운은 **회귀 사고 차단 목적과 정면 충돌** 이므로 최후 수단
- **M6 (allowJs:false) 이후 긴급 .js 추가 필요**: tsconfig 의 `allowJs: true` 로 임시 1커밋 복귀 → 핫픽스 머지 → allowJs:false 재전환. 1주 베타 운영 후 영구화 (UX 메모 `feedback_ux_redesign_rollback.md` 정신 적용)
- **전면 롤백 (typescript 패키지 제거)**: 기술적으로는 1커밋 가능하나 30~40 파일 + 의존성 + tsconfig 동시 처리 = 거대 diff. 실용적으로는 **단계별 git revert** 권장 (M6 → M5 → M4 → ... 역순)

전면 롤백 트리거 (옵션):
- 사용자가 6개월 시점에 "TS 도입이 운영 효율을 떨어뜨렸다" 판단 시
- 신규 협업자 합류로 JS 표준 회귀 결정 시 (가능성 매우 낮음)

**MEMORY `feedback_ux_redesign_rollback.md` 정합:** 4종(Feature Flag / 라우팅 분기 / 코드 보존 / 1커밋 롤백) 그대로 적용 불가 (TS 는 빌드 도구). 단 "롤백 가능성 본능적 차단" 원칙은 본 spec 도 동일 — M0~M2 의 즉시 롤백 + M6 의 단계별 revert 가 그 정신의 적용

## 검증 (각 마일스톤 완료 시)

- [ ] `npm run typecheck` 통과 (0 error)
- [ ] `npm run lint` 통과 (0 problems)
- [ ] `npm run test` 통과 (Vitest 단위 테스트)
- [ ] `npm run typecheck` 통과 (0 error)
- [ ] `npm run build` 성공 + 번들 크기 측정 (+5KB 이내)
- [ ] 변경 파일 git-tracked 확인
- [ ] `find src -name '*.ts*' | wc -l` 측정 (월간 진행률 기록)
- [ ] `npm run dev` cold start 시간 측정 (M0 baseline 대비 +10% 이내)

## Critical Files (구현 plan 작성 시 참조)

| 파일 | 역할 | 마일스톤 |
|---|---|---|
| `tsconfig.json` (신규) | TS 컴파일러 설정, include 에 src+api 포함 | M0 |
| `package.json` | typescript + @types + @typescript-eslint 의존성, typecheck 스크립트 | M0 |
| `eslint.config.js` | files 패턴 ts/tsx 확장 + parser overrides | M0 |
| `vite.config.js` → `.ts` | TS 인식 빌더 | M0 |
| `vitest.config.js` → `.ts` | include 패턴 ts/tsx 확장 | M0 |
| `scripts/alias-loader.mjs` | `.ts` 확장자 자동 분기 추가 (3차 차단) | M0 |
| `.github/pull_request_template.md` (신규) | "분리 커밋" 체크박스 (husky 경량 대체) | M0 |
| `.github/workflows/ci.yml` | Typecheck step 추가 | M0 |
| `vercel.json` | functions glob `*.js` → `*.{js,ts}` (4차 차단) | M2 |
| `scripts/compute-scores.mjs` | L12 import `.js` 명시 제거 (4차 차단, M1 선행) | M1 |
| `src/types/scoring.ts` (신규) | Apt/Res/Cats/Profile 핵심 타입 | M1 |
| `src/types/supabase.ts` (신규) | DB 응답 타입 (Supabase CLI 생성, 토큰 절차 박제) | M2 |
| `src/types/api.ts` (신규) | API 핸들러 공통 타입 | M2 |
| `src/types/components.ts` (신규) + `src/types/components/*.types.ts` | props 공통 + 대형 컴포넌트 타입 추출 | M3 |
| `src/scoring/*.js` (7개) | 첫 변환 대상 (4차 측정 모두 200줄 미만) | M1 |
| `src/components/*.jsx` (~45개, M3 진입 시 재집계) | 미션 A 와 동시 변환, 150줄+ 는 타입 추출 분할 | M3 |
| `src/hooks/*.js` | 13 useMemo 체인 타입 | M4 |

## 후속 작업 (본 spec 외)

- 본 spec 승인 후 → 다음 세션에서 `superpowers:writing-plans` 로 M0 부트스트랩 plan 작성
- M0 plan 실행은 미션 A brainstorming 완료 후
- 본 6개월 종료 후: scripts/api 100% TS 변환을 후속 분기 spec 으로 분리

## 관련 메모/참조

- `f:\mibunyang\CLAUDE.md` — 아키텍처 개요
- `f:\mibunyang\src\scoring\CLAUDE.md` — 가중치 합계 100 불변식
- `f:\mibunyang\src\components\CLAUDE.md` — memo 36개 + 반응형
- `f:\mibunyang\src\hooks\CLAUDE.md` — Hook 호출 순서 + React 성능 패턴
- `f:\mibunyang\api\CLAUDE.md` — JS null 함정, withHandler
- `C:\Users\user\.claude\projects\f--mibunyang\memory\feedback_view_alias_source_of_truth.md` — VIEW 별칭 사고 (TS 로 차단 가능 사례)
- `C:\Users\user\.claude\projects\f--mibunyang\memory\feedback_admin_token_storage_unified.md` — admin 토큰 사고 (TS 로 차단 가능 사례)
- `C:\Users\user\.claude\projects\f--mibunyang\memory\reference_supabase_management_api.md` — Supabase Management API 토큰 발급/폐기 절차 (M2 인용)
- `C:\Users\user\.claude\projects\f--mibunyang\memory\feedback_ux_redesign_rollback.md` — UX 재설계 4종 롤백 (TS 정신 적용)
- `C:\Users\user\.claude\projects\f--mibunyang\memory\reference_ci_npm_ci_lock_sync.md` — npm ci ↔ legacy-peer-deps 정책 (M0 의존성 추가 시 정합)
- BACKLOG L68 — JSDoc 시리즈 7파일 12식별자 (M1 출발점)

## 변경 이력 (보강 차수)

- v1 (affe041, 2026-05-03 brainstorming) — 초기 spec 261줄
- v2 (2026-05-03 1·2·3·4차 9 GATE 검증 후 보강) — 신규 차단 12건 반영:
  1. M0 `--legacy-peer-deps` + typescript-eslint peer 검증 명시
  2. M0 eslint.config.js files 패턴 + parser overrides 보강
  3. M0 vitest.config include 확장
  4. M0 scripts/alias-loader.mjs `.ts` 분기 추가
  5. M0 PR template 신규
  6. M0 ci.yml Typecheck step 명시 (lint.yml 부재 정정)
  7. M1 scripts/compute-scores.mjs `.js` import 제거 선행
  8. M2 vercel.json glob `*.{js,ts}` 동시 변경
  9. M2 Supabase 토큰 절차 박제
  10. M3 대형 컴포넌트 타입 추출 분할 규칙
  11. tsconfig include 에 api 추가 + incremental 캐시
  12. 롤백 시나리오 부분 strict 다운 + M6 이후 긴급 .js 보강
