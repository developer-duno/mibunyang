# TypeScript 부트스트랩 M0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미분양 비교 엔진 v3.0 에 TypeScript 5 + strict:true 도구 세팅을 도입하고, 첫 시범 .ts 파일 1개 + .test.ts 1개로 typecheck/lint/test 3종 통과를 검증한다.

**Architecture:** allowJs:true 점진 도입. tsconfig.json 신규 + eslint.config.js 보강 + vite/vitest 설정 .ts 변환 + alias-loader.mjs `.ts` 분기 + CI Typecheck step + PR template. 본 M0 는 src/ 본 코드 변환 0 (M1 부터).

**Tech Stack:** TypeScript 5, @types/react@19, @types/node@22 (CI Node 22 정합), @typescript-eslint/{parser,eslint-plugin}@^8, eslint 9, vite 8, vitest 4

**Spec:** [docs/superpowers/specs/2026-05-03-ts-bootstrap-design.md](../../f%3A/mibunyang/docs/superpowers/specs/2026-05-03-ts-bootstrap-design.md) (350줄 v2, 9 GATE 5차 통과)

**Plan 파일 사본 (실행 후 박제):** `f:/mibunyang/docs/superpowers/plans/2026-05-03-ts-bootstrap-m0.md` — 이 파일은 plan mode 임시 파일이며, ExitPlanMode 승인 후 사용자가 직접 git 추적 위치로 복사한다.

---

## File Structure (M0 변경 대상)

| 파일 | 종류 | 책임 |
|---|---|---|
| `tsconfig.json` | 신규 | TS 컴파일러 설정 (strict:true, allowJs:true, include src+api) |
| `package.json` | 수정 | typescript + @types + @typescript-eslint devDependencies, typecheck 스크립트, format 패턴 확장 |
| `eslint.config.js` | 수정 | files 패턴 ts/tsx 확장 + @typescript-eslint/parser overrides |
| `vite.config.js` → `vite.config.ts` | 확장자 변경 | 확장자만, 내용 동일 |
| `vitest.config.js` → `vitest.config.ts` | 확장자 변경 + 수정 | include 패턴 ts/tsx 확장 |
| `scripts/alias-loader.mjs` | 수정 | `.ts` 확장자 자동 분기 추가 |
| `.github/pull_request_template.md` | 신규 | TS 마이그 PR 체크박스 (확장자/논리 분리, 미션 A 동시 수정 경고) |
| `.github/workflows/ci.yml` | 수정 | Lint step 다음 Typecheck step 추가 |
| `src/lib/version.ts` (시범 파일, 신규) | 신규 | `export const TS_BOOTSTRAP = "M0";` + 함수 1개. **위치 결정 근거 (2차 검증):** 본 프로젝트 표준 utils 위치는 `src/lib/` (실측). `src/utils/` 신규 생성은 컨벤션 분열 |
| `src/lib/version.test.ts` (시범 테스트, 신규) | 신규 | TS_BOOTSTRAP 상수 검증 |

**커밋 단위:** 1커밋 — `feat(ts): TypeScript 부트스트랩 (M0) — 도구 세팅 + tsconfig strict + typecheck CI`

이유: M0 는 단일 관심사(도구 세팅) + 모든 변경이 같이 동작해야 의미 있음 (tsconfig 만 있고 typecheck 스크립트 없으면 검증 불가). spec 의 9파일 변경 + 2신규 파일은 한 PR에서 함께 검증 후 단일 커밋.

---

## Task 1: 사전 검증 — 기존 환경 baseline 측정

**Files:** (변경 없음, 측정만)

- [ ] **Step 1: 현재 lint/test 통과 확인**

Run:
```bash
npm run lint
npm run test
```
Expected: 둘 다 0 error / 0 fail. 만약 fail 있으면 본 plan 진행 전에 사용자에게 보고.

- [ ] **Step 2: package.json devDependencies 에 typescript 가 없는지 확인**

Run:
```bash
grep -E '"typescript"' package.json
```
Expected: 매치 0건 (typescript 패키지 미설치 상태 확인).

- [ ] **Step 3: typescript-eslint peer 호환 검증**

Run:
```bash
npm view @typescript-eslint/parser@8 peerDependencies
```
Expected: `eslint: '^8.57.0 || ^9.0.0'` (또는 호환 버전). eslint 9 호환 확인.

---

## Task 2: 의존성 설치

**Files:**
- Modify: `package.json` (devDependencies 5개 추가)
- Modify: `package-lock.json` (자동 갱신)

- [ ] **Step 1: TypeScript + 타입 + ESLint 플러그인 설치**

Run:
```bash
npm install -D typescript@5 @types/react@19 @types/react-dom@19 @types/node@22 @typescript-eslint/parser@^8 @typescript-eslint/eslint-plugin@^8 --legacy-peer-deps
```

`--legacy-peer-deps` 사유: 본 프로젝트의 CI(.github/workflows/ci.yml) 정책과 정합 (MEMORY `reference_ci_npm_ci_lock_sync.md` 참조). 로컬 install 시 transitive peer 누락 방지.

Expected: package.json devDependencies 에 위 5개 추가, package-lock.json 동기화.

- [ ] **Step 2: peer 충돌 0 확인**

Run:
```bash
npm ls eslint
```
Expected: eslint 단일 버전 (9.x), peer 충돌 경고 없음.

- [ ] **Step 3: typescript 패키지 동작 확인**

Run:
```bash
npx tsc --version
```
Expected: `Version 5.x.x` 출력.

---

## Task 3: tsconfig.json 신규 작성

**Files:**
- Create: `tsconfig.json`

- [ ] **Step 1: tsconfig.json 작성**

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
    "paths": { "@/*": ["src/*"] },
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/.tsbuildinfo"
  },
  "include": ["src", "api", "vite.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist", "build", ".vercel"]
}
```

선택 근거 (spec § tsconfig.json 권장 초기 설정):
- `strict:true` — 사용자 결정 (회귀 사고 차단)
- `allowJs:true` + `checkJs:false` — 점진 도입 핵심
- `include: ["src", "api", ...]` — api/_lib/*.ts 도 typecheck 대상 (M2 대비)
- `incremental` + `tsBuildInfoFile` — cold/warm 차이 완화, node_modules 캐시
- `paths` — 기존 vite alias `@/` 와 정합

- [ ] **Step 2: tsconfig 단독 검증 (src/ 변환 0이므로 0 error 기대)**

Run:
```bash
npx tsc --noEmit
```
Expected: 0 error. (allowJs:true + checkJs:false 이므로 .js 파일은 통과시키되 검사 안 함.)

만약 error 발생 시: 가장 흔한 원인은 `incremental` 옵션 위치 (compilerOptions 안에 넣어야 함). 오타 점검.

---

## Task 4: package.json 스크립트 갱신

**Files:**
- Modify: `package.json` (scripts 3개 변경/추가)

- [ ] **Step 1: typecheck 스크립트 추가 + format 패턴 확장**

기존 `package.json` scripts 섹션:
```json
{
  "scripts": {
    "dev": "vite",
    "collect": "node scripts/collect-data.mjs",
    "migrate": "node scripts/migrate-to-supabase.mjs",
    "migrate:dry": "node scripts/migrate-to-supabase.mjs --dry-run",
    "prebuild": "node scripts/prebuild.mjs",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "format": "prettier --write \"src/**/*.{js,jsx}\"",
    "format:check": "prettier --check \"src/**/*.{js,jsx}\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

변경 후:
```json
{
  "scripts": {
    "dev": "vite",
    "collect": "node scripts/collect-data.mjs",
    "migrate": "node scripts/migrate-to-supabase.mjs",
    "migrate:dry": "node scripts/migrate-to-supabase.mjs --dry-run",
    "prebuild": "node scripts/prebuild.mjs",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.{js,jsx,ts,tsx}\"",
    "format:check": "prettier --check \"src/**/*.{js,jsx,ts,tsx}\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

변경 3건:
1. `lint` 다음에 `typecheck` 신규 추가 (`tsc --noEmit`)
2. `format` 패턴 `{js,jsx}` → `{js,jsx,ts,tsx}`
3. `format:check` 패턴 동일 확장

- [ ] **Step 2: typecheck 스크립트 동작 확인**

Run:
```bash
npm run typecheck
```
Expected: 0 error (Task 3 와 동일).

---

## Task 5: vite.config.js → vite.config.ts 확장자 변경

**Files:**
- Modify: `vite.config.js` → `vite.config.ts` (rename, 내용 동일)

- [ ] **Step 1: 파일 확장자 변경 + __dirname ESM 호환 패치 (3차 검증 차단)**

**실측 (2026-05-03 검증):** vite.config.js 는 `import path from 'path'` + `path.resolve(__dirname, './src')` 사용. ESM 환경의 `__dirname` 은 Node 자체 미정의 → vite 가 런타임 polyfill 하므로 실행은 OK 이나 **strict + @types/node 도입 후 typecheck 가 `__dirname` 타입 미인식 → 사고 가능성 🔴**.

Run:
```bash
git mv vite.config.js vite.config.ts
```

이어서 vite.config.ts 의 `__dirname` 사용 부분을 ESM 호환으로 패치:

**4차 검증 정정 (placeholder 0 정책):** plan 변경 후 코드는 실제 파일 전체 + ESM 패치만 추가. `// ...` placeholder 사용 시 build/server 옵션 손실 사고 → 절대 금지.

기존 (실제 vite.config.js 전체):
```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://www.xn--hg3bi2ac4o1ig57cnoa.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
```

변경 (vite.config.ts) — ESM 호환 패치 4줄 추가만:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://www.xn--hg3bi2ac4o1ig57cnoa.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
```

선택 근거:
- ESM 모듈에서 `__dirname` 은 표준 미정의. `fileURLToPath(import.meta.url)` 는 ESM 표준 패턴.
- **`rolldownOptions` 유지**: vite 8 (Rolldown) 의 정식 API. `rollupOptions` 는 `@deprecated. Use rolldownOptions instead.` (vite 8 타입 정의 실측 확인). 변경 금지.
- build/server 옵션 전부 보존 — manualChunks vendor 분리 + /api proxy 정책 유지.

**대안 (스피드):** 만약 strict 통과 못 하면 임시로 파일 최상단에 `// @ts-nocheck` 추가 후 M4 (config 정식 타입화) 시점에 정공법 적용.

- [ ] **Step 2: vite dev/build 동작 확인**

Run:
```bash
npm run build
```
Expected: 빌드 성공. dist/ 생성. vite 8 은 vite.config.ts 자동 인식.

만약 fail 시: vite.config.js 내용에 타입 추론 불가 표현이 있을 수 있음. 임시로 파일 최상단에 `// @ts-nocheck` 추가 후 M4 에서 정식 타입 부여.

- [ ] **Step 3: typecheck 재확인**

Run:
```bash
npm run typecheck
```
Expected: 0 error. tsconfig include 에 `"vite.config.ts"` 가 있으므로 검사 대상에 포함됨.

---

## Task 6: vitest.config.js → vitest.config.ts + include 확장

**Files:**
- Modify: `vitest.config.js` → `vitest.config.ts` (rename + include 패턴 확장)

- [ ] **Step 1: 현재 vitest.config.js 내용 확인**

Run:
```bash
cat vitest.config.js
```

**실측 (2026-05-03 검증):** 현재 include 는 3경로:
```js
include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.{js,jsx}', 'scripts/**/*.test.{js,mjs}']
```
coverage 도 별도 include/exclude `.{js,jsx}` 패턴 보유. `environmentMatchGlobs` 도 .{js,jsx} 패턴.

- [ ] **Step 2: 파일 확장자 변경 + __dirname ESM 호환 패치 + include 3경로 모두 확장 (3차 검증 차단)**

**실측 (2026-05-03 검증):** vitest.config.js 도 `path.resolve(__dirname, './src')` 사용. Task 5 와 동일하게 ESM 호환 패치 필요.

Run:
```bash
git mv vitest.config.js vitest.config.ts
```

내용 수정 — __dirname 패치 + 3경로 + coverage + environmentMatchGlobs 모두:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.test.{js,jsx,ts,tsx}',
      'api/**/*.test.{js,jsx,ts,tsx}',
      'scripts/**/*.test.{js,mjs,ts,mts}',
    ],
    setupFiles: ['./src/__tests__/setup.js'],
    environmentMatchGlobs: [
      ['api/**/*.test.{js,jsx,ts,tsx}', 'node'],
      ['scripts/**/*.test.{js,mjs,ts,mts}', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/**/*.test.{js,jsx,ts,tsx}', 'src/__tests__/**'],
    },
  },
});
```

선택 근거: 3경로 모두 확장 안 하면 api/_lib 또는 scripts/ 의 .ts 테스트가 vitest run 에 안 잡힘. M0 시점은 .ts 테스트 1개(version.test.ts in src) 뿐이라 영향 없지만, M1 진입 시 즉시 회귀.

- [ ] **Step 3: 기존 테스트 통과 확인**

Run:
```bash
npm run test
```
Expected: 기존 .test.js 모두 통과 (변환된 .ts 시범 파일은 Task 9 에서 추가).

---

## Task 7: scripts/alias-loader.mjs `.ts` 분기 추가

**Files:**
- Modify: `scripts/alias-loader.mjs`

- [ ] **Step 1: 현재 alias-loader.mjs 내용 확인**

Run:
```bash
cat scripts/alias-loader.mjs
```

**실측 (2026-05-03 검증, 2차 정정):** 현재 분기 **2곳**:
- 첫째 분기 (line 19~22): `@/` 접두사 alias 분기 — `.js` fallback 만
- 둘째 분기 (line 26~34): 상대경로(`./` 또는 `../`) 분기 — `.js` fallback 만

**둘 다** `.ts` 분기 추가 필요. 누락 시 scoring/engine.ts 내부의 `import { ... } from './scorePrice'` 같은 상대 import 가 M1 변환 후 깨짐.

- [ ] **Step 2: `.ts` 확장자 분기 두 곳 모두 추가**

첫째 분기 (`@/` 처리, 기존 line 19~22, 2차 정정):
```js
// 기존
if (!realPath.endsWith(".js") && !realPath.endsWith(".mjs") && existsSync(realPath + ".js")) {
  realPath += ".js";
}

// 변경
if (!realPath.endsWith(".js") && !realPath.endsWith(".mjs") && !realPath.endsWith(".ts")) {
  if (existsSync(realPath + ".ts")) realPath += ".ts";
  else if (existsSync(realPath + ".js")) realPath += ".js";
}
```

둘째 분기 (상대경로 처리, 기존 line 26~34, 2차 정정):
```js
// 기존
if (
  (specifier.startsWith("./") || specifier.startsWith("../")) &&
  !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")
) {
  const parentDir = dirname(fileURLToPath(context.parentURL));
  const candidate = pathResolve(parentDir, specifier) + ".js";
  if (existsSync(candidate)) {
    return nextResolve(pathToFileURL(candidate).href, context);
  }
}

// 변경
if (
  (specifier.startsWith("./") || specifier.startsWith("../")) &&
  !specifier.endsWith(".js") && !specifier.endsWith(".mjs") &&
  !specifier.endsWith(".ts") && !specifier.endsWith(".json")
) {
  const parentDir = dirname(fileURLToPath(context.parentURL));
  const tsCandidate = pathResolve(parentDir, specifier) + ".ts";
  const jsCandidate = pathResolve(parentDir, specifier) + ".js";
  if (existsSync(tsCandidate)) {
    return nextResolve(pathToFileURL(tsCandidate).href, context);
  }
  if (existsSync(jsCandidate)) {
    return nextResolve(pathToFileURL(jsCandidate).href, context);
  }
}
```

선택 근거 (spec M0-9): scripts/compute-scores.mjs 가 `import "@/scoring/engine"` 형태로 호출 시, M1 에서 engine.js → engine.ts 변환 후 alias-loader 가 `.ts` 자동 검색해야 daily-deploy.yml 안 깨짐. 단 첫째 분기만으로는 engine.ts 내부의 상대 import (`./scorePrice` 등) 가 .ts 로 변환됐을 때 못 잡으므로 둘째 분기도 필수.

`.ts` 를 `.js` 보다 **먼저** 검색하는 이유: M1 이후 공존 과도기에 .ts 가 있다는 건 변환 완료. 우선 매칭이 안전.

- [ ] **Step 3: alias-loader 동작 확인 (기존 .js 호출 회귀 0)**

Run:
```bash
node --import ./scripts/alias-loader.mjs scripts/prebuild.mjs
```
Expected: 기존 동작 그대로 (.js 호출 fallback 으로 동작). 0 error.

(주의: 실제 prebuild.mjs 가 alias 사용 안 하면 다른 alias 사용 스크립트로 대체. `npm run prebuild` 로 검증 가능.)

---

## Task 8: eslint.config.js — files 패턴 + parser overrides

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: 현재 eslint.config.js 구조 확인**

Run:
```bash
cat eslint.config.js
```

주요 확인:
- L11 부근의 `files: ['src/**/*.{js,jsx}']`
- react-hooks plugin 적용 범위
- parser 설정

- [ ] **Step 2: files 패턴 확장 + @typescript-eslint/parser overrides 추가 (실제 파일 기반)**

**실측 (2026-05-03 검증):** 현재 eslint.config.js 는 4개 객체 배열:
```js
import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,                                                   // [0]
  prettierConfig,                                                           // [1]
  {                                                                          // [2]
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react: reactPlugin, 'react-hooks': reactHooks },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },
  { ignores: ['dist/', 'node_modules/', 'api/', 'scripts/', 'supabase/'] }, // [3] — **반드시 보존**
];
```

**중요:** [3] 의 `ignores` 객체는 api/, scripts/, supabase/ 를 lint 에서 제외하는 핵심. M0 변경 시 절대 삭제하지 말 것.

변경 — 4개 객체를 5개로 확장 ([2] files 패턴 + [3] 신규 ts overrides + ignores 유지):
```js
import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],                  // ← 패턴 확장 (1차 보강)
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react: reactPlugin, 'react-hooks': reactHooks },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },
  {                                                       // ← 신규 [3]: ts overrides
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // M0 에서는 추가 룰 없음. parser 적용만으로 충분.
    },
  },
  { ignores: ['dist/', 'node_modules/', 'api/', 'scripts/', 'supabase/'] },  // ← **반드시 유지**
];
```

변경 근거:
1. `files: ['src/**/*.{js,jsx}']` → `'src/**/*.{js,jsx,ts,tsx}'` — react/react-hooks 플러그인이 .ts/.tsx 에도 적용
2. .ts/.tsx 한정 overrides 블록 추가 — `@typescript-eslint/parser` 가 .ts 파일만 파싱
3. 기존 .js/.jsx 는 espree(eslint 기본 parser) 그대로 사용 → 회귀 0
4. **`{ ignores: [...] }` 객체 보존** — api/, scripts/, supabase/ lint 제외 정책 유지 (2차 검증 차단)

- [ ] **Step 3: lint 동작 확인**

Run:
```bash
npm run lint
```
Expected: 0 error. 기존 .js/.jsx 파일 그대로 통과.

만약 fail 시: 가장 흔한 원인은 plugin import 경로. `@typescript-eslint/eslint-plugin` 의 ESM/CJS 호환성 — `@typescript-eslint/eslint-plugin@^8` 은 CJS 만 export 함. eslint 9 의 flat config 에서는 default import 가 default export 를 가리키도록 wrapping 필요할 수 있음 (실제 구현 시점에 README 확인).

---

## Task 9: 시범 .ts + .test.ts 파일 작성

**Files:**
- Create: `src/lib/version.ts`
- Create: `src/lib/version.test.ts`

**위치 결정 (2차 검증 실측):** 본 프로젝트의 표준 utils 위치는 **`src/lib/`** (이미 존재). `src/utils/` 신규 생성은 컨벤션 분열 → `src/lib/version.ts` 로 결정.

- [ ] **Step 1: src/lib/ 폴더 존재 확인**

Run:
```bash
ls src/lib/ 2>&1 | head -5
```
Expected: 기존 파일 목록 출력 (폴더 존재).

- [ ] **Step 2: src/lib/version.ts 작성**

```ts
export const TS_BOOTSTRAP_MILESTONE = "M0" as const;

export function getTsBootstrapVersion(): string {
  return `mibunyang TS bootstrap ${TS_BOOTSTRAP_MILESTONE}`;
}
```

선택 근거:
- `as const` — 리터럴 타입 narrow (strict 환경 검증)
- 함수 반환 타입 명시 — strict:true 에서 추론 가능하지만 명시로 학습 효과

- [ ] **Step 3: src/lib/version.test.ts 작성**

```ts
import { describe, it, expect } from 'vitest';
import { TS_BOOTSTRAP_MILESTONE, getTsBootstrapVersion } from './version';

describe('TS bootstrap version', () => {
  it('TS_BOOTSTRAP_MILESTONE 은 "M0" 리터럴 타입', () => {
    expect(TS_BOOTSTRAP_MILESTONE).toBe('M0');
  });

  it('getTsBootstrapVersion 은 milestone 포함 문자열 반환', () => {
    const version = getTsBootstrapVersion();
    expect(version).toContain('M0');
    expect(version).toContain('mibunyang');
  });
});
```

- [ ] **Step 4: typecheck + test + lint 3종 통과 검증**

Run:
```bash
npm run typecheck
npm run lint
npm run test -- src/lib/version
```

Expected:
- typecheck: 0 error (시범 .ts 파일 strict 통과)
- lint: 0 error (.ts 파일 @typescript-eslint/parser 적용)
- test: 2개 통과 (TS_BOOTSTRAP_MILESTONE + getTsBootstrapVersion)

만약 test fail 시: vitest config include 패턴이 `.test.ts` 를 못 잡으면 Task 6 의 include 패턴 점검.

---

## Task 10: .github/pull_request_template.md 신규 작성

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: PR template 작성**

```markdown
## 변경 요약

<!-- 1~3줄로 무엇을 왜 -->

## 체크리스트

### 일반
- [ ] `npm run lint` 통과
- [ ] `npm run typecheck` 통과 (TS 부트스트랩 M0 이후)
- [ ] `npm run test` 통과
- [ ] CLAUDE.md / 서브 CLAUDE.md / BACKLOG 갱신 필요 시 반영

### TypeScript 마이그레이션 PR (해당 시)
- [ ] 확장자 변경(.js→.ts)과 논리 변경이 분리된 커밋입니까?
- [ ] 미션 A (메인 UI 재설계) 와 같은 파일을 동시에 수정합니까? → 분리 PR 권장
- [ ] strict:true 통과 (any 사용 시 사유 명시)

### 운영 영향 (해당 시)
- [ ] 운영 admin 5명 데이터 영향 0
- [ ] 카카오 알림톡 발송 영향 0
- [ ] DB 마이그레이션 포함 시 supabase/CLAUDE.md 절차 준수

## 검증 결과

<!-- typecheck/lint/test 출력, 또는 e2e smoke 결과 -->

## 롤백 시나리오

<!-- 본 PR 머지 후 사고 발생 시 어떻게 되돌릴지 -->
```

선택 근거 (spec M0-10): "확장자/논리 분리 커밋" 강제는 husky pre-commit 으로도 가능하나 husky 도입 자체가 또 다른 의존성 → 경량 대체로 PR template 체크박스. M3 (미션 A 와 동시) 진입 시 강제력이 절실.

- [ ] **Step 2: GitHub PR 생성 시 template 자동 적용 확인**

검증: 본 작업 PR 자체가 template 적용 사례. `gh pr create` 시 body 에 위 template 자동 prefill 되는지 확인.

(참고: GitHub 은 `.github/pull_request_template.md` 를 모든 PR 의 default body 로 자동 사용함. 별도 설정 불필요.)

---

## Task 11: .github/workflows/ci.yml — Typecheck step 추가

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 현재 ci.yml 확인**

Run:
```bash
cat .github/workflows/ci.yml
```

주요 확인:
- jobs 구조
- Lint step 위치
- Node 버전, npm install 명령

- [ ] **Step 2: Lint 다음에 Typecheck step 추가 (실제 파일 기반)**

**실측 (2026-05-03 검증):** 현재 ci.yml 전체:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22                                # ← 22 (1차 보강 정합)
          cache: npm

      - name: Install dependencies
        run: npm ci --legacy-peer-deps                   # ← --legacy-peer-deps 핵심

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build
```

**중요:** `node-version: 22` 와 `npm ci --legacy-peer-deps` 절대 변경하지 말 것. 위 정책이 본 프로젝트 표준.

변경 — Lint step 다음에 Typecheck step 1개 추가만:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Lint
        run: npm run lint

      - name: Typecheck                                   # ← 신규 추가
        run: npm run typecheck                            # ← 신규 추가

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build
```

변경 1건: Lint step 다음에 `Typecheck` step (`npm run typecheck`) 추가만. **다른 모든 줄은 변경 금지** (Node 22, legacy-peer-deps 정합 유지).

선택 근거 (spec M0-8): Vercel 빌드는 typecheck 안 함 → CI 가 단독 typecheck 게이트. 별도 잡 분리 옵션도 있으나 M0 단계에서는 단일 잡 + 순차 실행이 단순.

- [ ] **Step 3: 본 PR 푸시 후 CI 통과 확인**

PR 푸시 후 GitHub Actions 페이지에서:
- ci.yml 잡 success
- Typecheck step 0 error
- 기존 step (lint/test/build) 회귀 0

(참고: 본 PR 의 시범 .ts 파일이 strict 를 통과해야 ci 가 green. Task 9 가 사전 검증 역할.)

---

## Task 12: 통합 검증 + cold typecheck baseline 측정

**Files:** (변경 없음, 측정만)

- [ ] **Step 1: 모든 스크립트 통과 확인**

Run:
```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
Expected: 4종 모두 0 error/fail.

- [ ] **Step 2: cold typecheck 시간 측정**

Run:
```bash
rm -f node_modules/.cache/.tsbuildinfo
time npm run typecheck
```
Expected: 시간 측정값 기록 (예: 6.2초).

- [ ] **Step 3: incremental typecheck 시간 측정**

Run:
```bash
time npm run typecheck
```
Expected: 위 cold 보다 빠름 (예: 1.5초). incremental 캐시 효과 확인.

- [ ] **Step 4: baseline 박제**

Plan 사본 파일 (또는 `.claude/BACKLOG.md`) 에 다음 형태로 추가:
```
## TS 부트스트랩 M0 baseline (2026-05-XX 측정)
- cold typecheck: X.X초
- incremental typecheck: Y.Y초
- 30초 초과 시: spec 의 `tsc -b` 도입 검토 트리거
```

선택 근거 (spec M0-12): 30초가 spec 의 임계값. 현 시점 측정으로 baseline 확보 → M1 이후 회귀 추적 기준.

- [ ] **Step 5: e2e smoke 1회 실행 (선택)**

Run:
```bash
npm run test:e2e -- --grep "smoke"
```

만약 smoke 태그 없으면 가장 짧은 spec 1개 실행. e2e 는 Playwright 자체 ts 실행기로 동작 → typescript 패키지 도입의 영향 0 검증.

---

## Task 13: 단일 커밋 + PR + 머지

**Files:** (모든 Task 1~12 변경분 통합)

- [ ] **Step 1: git status 점검**

Run:
```bash
git status
```

기대 변경 파일:
- 신규: `tsconfig.json`, `.github/pull_request_template.md`, `src/lib/version.ts`, `src/lib/version.test.ts`
- 수정: `package.json`, `package-lock.json`, `eslint.config.js`, `scripts/alias-loader.mjs`, `.github/workflows/ci.yml`
- 이름 변경: `vite.config.js` → `vite.config.ts`, `vitest.config.js` → `vitest.config.ts`

**주의:** `public/data/apartments.json`, `public/data/meta.json` 은 dirty 일 수 있으나 절대 커밋에 포함하지 말 것 (운영 데이터, 사용자 명시 금지).

- [ ] **Step 2: 변경 파일만 명시적으로 add**

Run:
```bash
git add tsconfig.json package.json package-lock.json eslint.config.js \
  scripts/alias-loader.mjs .github/pull_request_template.md \
  .github/workflows/ci.yml \
  src/lib/version.ts src/lib/version.test.ts \
  vite.config.ts vitest.config.ts
```

(`vite.config.js` 와 `vitest.config.js` 는 git mv 로 이미 staged. 위 명령은 멱등성 확인용.)

- [ ] **Step 3: 커밋**

Run:
```bash
git commit -m "$(cat <<'EOF'
feat(ts): TypeScript 부트스트랩 (M0) — 도구 세팅 + tsconfig strict + typecheck CI

- typescript@5 + @types/{react,react-dom,node} + @typescript-eslint/* 설치 (--legacy-peer-deps)
- tsconfig.json 신규 (strict:true, allowJs:true, include src+api, incremental)
- package.json typecheck 스크립트 + format 패턴 ts/tsx 확장
- eslint.config.js files 패턴 확장 + @typescript-eslint/parser overrides
- vite.config.js → vite.config.ts (확장자만)
- vitest.config.js → vitest.config.ts + include ts/tsx 확장
- scripts/alias-loader.mjs .ts 분기 추가 (M1 이후 .js↔.ts 공존 대비)
- .github/pull_request_template.md 신규 (TS 마이그 PR 체크박스)
- .github/workflows/ci.yml Lint 다음 Typecheck step 추가
- src/lib/version.{ts,test.ts} 시범 — typecheck/lint/test 3종 통과 검증

검증:
- npm run typecheck: 0 error (cold X.X초, incremental Y.Y초)
- npm run lint: 0 problem
- npm run test: 모든 기존 테스트 + 시범 2건 통과
- npm run build: 성공
- e2e smoke: pass

spec: docs/superpowers/specs/2026-05-03-ts-bootstrap-design.md (v2, 9 GATE 5차 통과)
plan: docs/superpowers/plans/2026-05-03-ts-bootstrap-m0.md
EOF
)"
```

- [ ] **Step 4: 푸시 + PR 생성**

Run:
```bash
git push -u origin <branch-name>
gh pr create --title "feat(ts): TypeScript 부트스트랩 (M0)" --body "$(cat <<'EOF'
## 변경 요약

미분양 비교 엔진 v3.0 에 TypeScript 5 + strict:true 도구 세팅 도입. spec v2 의 M0 단계 완료. src/ 본 코드 변환 0 (M1 부터).

## 체크리스트

### TypeScript 마이그레이션 PR
- [x] 확장자 변경(.js→.ts)과 논리 변경이 분리된 커밋입니다 (vite/vitest config 만 git mv, 내용 동일)
- [x] 미션 A 와 같은 파일 동시 수정 없음
- [x] strict:true 통과, any 사용 0

### 일반
- [x] npm run lint 통과
- [x] npm run typecheck 통과 (X.X초 cold)
- [x] npm run test 통과
- [x] e2e smoke 1회 통과

### 운영 영향
- [x] 운영 admin 5명 데이터 영향 0
- [x] 카카오 알림톡 발송 영향 0

## 롤백 시나리오

allowJs:true 이므로 .ts → .js 즉시 가능. tsconfig.json 삭제 + package.json devDeps 제거 + git revert 1커밋.

## Spec/Plan

- spec: docs/superpowers/specs/2026-05-03-ts-bootstrap-design.md
- plan: docs/superpowers/plans/2026-05-03-ts-bootstrap-m0.md
EOF
)"
```

- [ ] **Step 5: CI 통과 후 머지 (사용자 결정)**

CI 결과 확인:
- ci.yml: lint + typecheck + test + build 4종 success
- e2e.yml: 기존 통과 유지

머지 방식: squash 또는 rebase merge (본 프로젝트 기존 패턴 확인 후 결정).

---

## Verification Plan (M0 완료 게이트)

| 항목 | 명령 | 기대 |
|---|---|---|
| typecheck | `npm run typecheck` | 0 error |
| lint | `npm run lint` | 0 problem |
| unit test | `npm run test` | 모든 .test.{js,jsx,ts,tsx} 통과 |
| build | `npm run build` | dist/ 생성 + 번들 크기 +5KB 이내 (TS emit 0이므로 사실상 동일) |
| e2e smoke | `npm run test:e2e` | 최소 1 spec pass |
| CI | GitHub Actions ci.yml | green (lint + typecheck + test + build) |
| baseline | `time npm run typecheck` | cold/incremental 기록 |
| 시범 파일 | `src/lib/version.ts` 의 `TS_BOOTSTRAP_MILESTONE` 리터럴 타입 narrow | strict 통과 |

---

## 전제 조건 (실행 전 사용자 확인)

**1. 미푸시 2커밋 처리 (2차 검증 차단):**

현재 origin/main 보다 ahead 인 로컬 커밋 2개:
- `037d866 docs(spec): TypeScript 부트스트랩 설계 박제 (세션 170)`
- `b96c3af docs(spec): TS 부트스트랩 spec v2 — 9 GATE 1~4차 검증 보강 12건`

Task 13 Step 4 의 `git push` 실행 시 위 2커밋도 **함께 푸시됨**. 사용자 명시 정책 "올리지 마라 = push 금지" (세션 170) 와 정합 점검 필요. 옵션:
- (a) 이 plan 의 M0 커밋과 함께 3커밋 동시 push (사용자 동의 필수)
- (b) 본 plan 은 docs/ 박제만 하고 코드 실행은 다음 세션 (옵션 3 추천)
- (c) M0 코드 실행은 진행하되 push 는 사용자 명시 동의 시점까지 보류

**기본값: (b)** — spec § M0 전제 ("미션 A brainstorming 완료 후") 와 정합. 본 세션은 plan 박제까지만.

**2. push 정책:**

Task 13 Step 4 의 `git push -u origin <branch-name>` 와 `gh pr create` 는 **사용자 명시 동의 후에만 실행**. plan 의 `<branch-name>` placeholder 가 자동 실행 차단 역할.

**3. apartments.json + meta.json 격리 (사용자 명시 금지):**

git status 에 dirty 로 보여도 본 plan 의 어떤 명령으로도 commit/checkout/restore 절대 금지. Task 13 Step 2 의 명시적 `git add` 목록에 두 파일 0건 (검증 완료).

---

## Risk Notes

- **eslint 9 + @typescript-eslint/eslint-plugin@^8 의 ESM 호환** — flat config 에서 default export 미지원 가능. Task 8 Step 3 fail 시 wrapping import 사용.
- **vite.config.js 의 TS 추론 불가** — Task 5 Step 2 fail 시 `// @ts-nocheck` 임시 적용. M4 에서 정식 타입.
- **alias-loader 회귀** — Task 7 Step 3 에서 prebuild 가 alias 사용 안 하면 다른 alias 사용 스크립트로 검증.
- **CI Typecheck 실패** — Task 11 Step 3 에서 fail 시 시범 .ts 파일 strict 통과 재검증. 가장 흔한 사고는 import 경로의 .ts 확장자 문제.
- **`public/data/apartments.json` / `meta.json` dirty 동반 커밋** — Task 13 Step 1 의 명시적 add 로 차단. git status 출력에서 두 파일이 dirty 인 채 남아도 무시.

---

## Self-Review Checklist

- [x] **Spec coverage:** spec § M0 의 12개 작업 모두 task 로 매핑. 1→T2, 2→T3, 3→T4, 4→T8, 5→T5, 6→T6, 7→T4, 8→T11, 9→T7, 10→T10, 11→T9, 12→T12. 누락 없음.
- [x] **Placeholder scan:** "TBD/TODO/implement later" 0건. 모든 코드 블록은 실행 가능한 형태.
- [x] **Type consistency:** `TS_BOOTSTRAP_MILESTONE`, `getTsBootstrapVersion` 이름 시범 파일과 테스트에서 동일. tsconfig 의 paths/include 가 전 task 일관.
- [x] **운영 안전:** apartments.json/meta.json dirty 절대 커밋 금지 명시 (T13 S1).
- [x] **롤백:** PR body 에 명시 (allowJs:true 즉시 가능).

---

## Execution Handoff (ExitPlanMode 승인 후)

**옵션 1: Subagent-Driven (추천)** — Task 1~13 을 fresh subagent 에 한 task 씩 dispatch + two-stage review. 13 task × ~5분 = ~65분 + 검토 시간. 회귀 위험 가장 낮음.

**옵션 2: Inline Execution** — 본 세션에서 executing-plans 스킬로 batch 실행. checkpoint 마다 검토. ~45분 + 검토.

**옵션 3: Plan 만 박제 + 다음 세션 실행** — 본 세션은 plan 파일을 docs/ 로 복사 커밋만. M0 코드 실행은 미션 A brainstorming 완료 후 (spec 의 전제 조건).

**옵션 3이 spec 정신과 정합** (spec § M0 전제: "미션 A brainstorming 완료 후, 미션 A 첫 코드 세션 직전 시점"). 단 사용자 결정 사항.
