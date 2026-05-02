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

### M0 — 부트스트랩 (1세션, 2026-05 중순)

**전제:** 미션 A brainstorming 완료 후, 미션 A 첫 코드 세션 직전 시점.

작업:
1. `npm install -D typescript@5 @types/react@19 @types/react-dom@19 @types/node@20`
2. `tsconfig.json` 신규 작성 (아래 § 참조)
3. `package.json` 에 `"typecheck": "tsc --noEmit"` 스크립트 추가
4. `eslint.config.js` 에 `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` 통합
5. `vite.config.js` → `vite.config.ts` 로 변환 (확장자만, allowJs 가 켜져 있으므로 영향 0)
6. `vitest.config.js` → `vitest.config.ts` 로 변환 (실측 존재 확인)
7. `package.json` `lint` 스크립트 `eslint src/` 유지 — 이미 eslint 가 .ts 인식하므로 변경 불필요
8. `package.json` `format` 스크립트 패턴 `src/**/*.{js,jsx,ts,tsx}` 로 확장
9. CI 게이트 (`.github/workflows/*` 중 lint/test 워크플로우) 에 `npm run typecheck` 추가 — 빌드 막지 않고 별도 잡으로
10. 첫 .ts 시범 파일 1개 작성 (예: `src/types/apt.ts` 빈 파일 + 더미 export) → typecheck 통과 확인

산출물:
- `tsconfig.json` 신규
- `package.json` scripts/devDependencies 갱신
- `eslint.config.js` 갱신
- 1커밋: `feat(ts): TypeScript 부트스트랩 (M0) — 도구 세팅 + tsconfig strict + typecheck CI`

### M1 — scoring/ 변환 (M0 + 2주, 2026-05 말 ~ 6월 초)

**전제:** scoring/ 7파일에 이미 JSDoc 12식별자 박제 (BACKLOG L68 완료)

작업:
1. `src/types/scoring.ts` 신규 — Apt, Res, Cats, Profile, ProfileWeights, ScoringContext 타입 정의 (JSDoc 기반)
2. scoring/ 7파일 .js → .ts 확장자 변경 (논리 변경 0)
3. JSDoc → 정식 TS 타입 어노테이션 변환 (각 파일 독립 커밋)
4. profileWeights 6필드(price/location/product/risk/benefit/future) 합 100 불변식을 타입으로 표현 시도 (Branded Type 또는 일반 number, 결정은 plan 단계)
5. null/undefined 분기를 strictNullChecks 에 맞춰 명시화

산출물:
- `src/types/scoring.ts`
- scoring/ 7파일 .ts 변환
- 7~10커밋 (파일별 또는 그룹별)

### M2 — api/ + Supabase 응답 타입 정의 (M1 + 4주, 2026-06 ~ 6월 말)

작업:
1. `src/types/supabase.ts` — apartments_flat VIEW, presale, applyhome_events, users 등 핵심 테이블 타입 정의. 생성 명령: `supabase gen types typescript --project-id rwdtljipvmqpazrimyns > src/types/supabase.ts` (CLI 위치: `~/scoop/shims/supabase`, 실측 확인)
2. `src/types/api.ts` — api/* 핸들러 응답 공통 타입 (ApiResponse<T>, ErrorResponse 등)
3. api/* 21개 핸들러 중 **공용 헬퍼**(withHandler HOF, sanitize 헬퍼) 만 .ts 변환
4. api/* 개별 핸들러 변환은 본 마일스톤 외 (후속 분기)

산출물:
- `src/types/supabase.ts`, `src/types/api.ts`
- api/_lib/* 또는 api/_utils/* (있다면) .ts
- 5~7커밋

### M3 — components/ 변환 (M2 + 8주, 2026-07 ~ 9월 초, 미션 A 와 동시)

**전제:** 미션 A (메인 UI 재설계) 진행 중. 새로 짜는 컴포넌트는 처음부터 .tsx.

작업:
1. 미션 A 에서 신규 작성 컴포넌트 → 모두 .tsx (변환 부담 0)
2. 미션 A 에서 손보는 기존 컴포넌트 → .jsx → .tsx 확장자 변경 + props 타입 추가 (별도 커밋)
3. 우선순위:
   - AptCard, DetailModal, CompareSheet (소비자 핵심)
   - HeaderSection, SearchFilterBar (UI 진입점)
   - filters/* 7개 (drop-down 패턴 통일)
   - sections/* 9개
   - expert/* 9개 (전문가 페이지 PC 우선)
   - admin/* 5개 (마지막)
4. 36개 memo 컴포넌트 props 타입 100% 명시. comparator 가 있는 경우(AptCard 1개) 타입 정합 검증
5. icons.jsx → icons.tsx (9 SVG)

산출물:
- `src/types/components.ts` (props 공통 타입: AptDetailHandler, ProfileSelectHandler 등)
- components/ 80% .tsx
- 30~40커밋 (미션 A 커밋과 별개로 "확장자+타입" 커밋 분리)

**중요 규칙:** 한 커밋 = "확장자 변경 + 타입 추가 + 논리 변경 0" 또는 "UI 재설계 (.tsx 안에서)" — 둘을 섞지 않음.

### M4 — hooks + 잔여 components (M3 + 4주, 2026-09 ~ 10월 초)

작업:
1. `src/hooks/` 8~12개 훅 .js → .ts. useMemo 13개 체인의 반환 타입 명시
2. `src/utils/` 유틸 함수 .ts
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
  "include": ["src", "vite.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist", "build", ".vercel"]
}
```

선택 근거:
- `strict:true` — 사용자 결정
- `allowJs:true` + `checkJs:false` — 점진 도입의 핵심. JS 파일은 통과시키되 타입 검사는 안 함
- `noUnusedLocals:false` — 마이그레이션 중 임시 변수 허용. M6 에서 true 로 전환 검토
- `paths` — 기존 vite alias `@/` 와 정합
- `target/lib ES2022` — Node 20+ engine 과 정합

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
- **M6 (allowJs:false) 이후**: 전면 롤백은 tsconfig 만 되돌리면 됨. 하지만 이 시점엔 src/ 100% TS 라 사실상 의미 없음

전면 롤백 트리거 (옵션):
- 사용자가 6개월 시점에 "TS 도입이 운영 효율을 떨어뜨렸다" 판단 시
- 신규 협업자 합류로 JS 표준 회귀 결정 시 (가능성 매우 낮음)

## 검증 (각 마일스톤 완료 시)

- [ ] `npm run typecheck` 통과 (0 error)
- [ ] `npm run lint` 통과 (0 problems)
- [ ] `npm run test` 통과 (Vitest 단위 테스트)
- [ ] `npm run build` 성공 + 번들 크기 측정 (+5KB 이내)
- [ ] 변경 파일 git-tracked 확인
- [ ] `find src -name '*.ts*' | wc -l` 측정 (월간 진행률 기록)

## Critical Files (구현 plan 작성 시 참조)

| 파일 | 역할 | 마일스톤 |
|---|---|---|
| `tsconfig.json` (신규) | TS 컴파일러 설정 | M0 |
| `package.json` | typescript + @types 의존성, typecheck 스크립트 | M0 |
| `eslint.config.js` | TS 파서/플러그인 통합 | M0 |
| `vite.config.js` → `.ts` | TS 인식 빌더 | M0 |
| `src/types/scoring.ts` (신규) | Apt/Res/Cats/Profile 핵심 타입 | M1 |
| `src/types/supabase.ts` (신규) | DB 응답 타입 (Supabase CLI 생성) | M2 |
| `src/types/api.ts` (신규) | API 핸들러 공통 타입 | M2 |
| `src/types/components.ts` (신규) | props 공통 핸들러 타입 | M3 |
| `src/scoring/*.js` (7개) | 첫 변환 대상 | M1 |
| `src/components/*.jsx` (45 memo) | 미션 A 와 동시 변환 | M3 |
| `src/hooks/*.js` | 13 useMemo 체인 타입 | M4 |
| `.github/workflows/lint.yml` (있다면) | typecheck CI 잡 | M0 |

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
- `~/.claude/projects/f--mibunyang/memory/feedback_view_alias_source_of_truth.md` — VIEW 별칭 사고 (TS 로 차단 가능 사례)
- `~/.claude/projects/f--mibunyang/memory/feedback_admin_token_storage_unified.md` — admin 토큰 사고 (TS 로 차단 가능 사례)
- BACKLOG L68 — JSDoc 시리즈 7파일 12식별자 (M1 출발점)
