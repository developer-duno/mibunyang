---
paths:
  - "scripts/**/*.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## scripts/ 가 쓰는 외부 패키지는 반드시 package.json 에 선언 (세션518)

**`npm run lint` 은 `eslint src/` 라 `scripts/` 를 아예 안 본다.** 그래서
eslint-plugin-import 의 `no-extraneous-dependencies` 같은 규칙이 이 디렉토리에 닿지 않고,
**남의 패키지에 얹힌 import 가 조용히 살아남는다.**

사고: `js-yaml` 이 dependencies·devDependencies 어디에도 없이 **eslint 의 transitive 로만**
존재했다. eslint 10 시험 업그레이드가 46개 패키지를 정리하며 그 사슬을 끊자
`Cannot find package 'js-yaml'` 로 **감사·테스트 5개가 통째로 죽었다**
(`audit-env-keys`·`audit-cron-concurrency`·`audit-collect-transport-budget`·
`audit-fill-matrix`·`noxious.test`). `@types/js-yaml` 만 선언돼 있어 **"선언돼 있다"는
착시**까지 있었다 — 타입만 있고 본체가 없는 상태였다.

- 가드 = `scripts/audit-declared-deps.mjs` (CI 등재). `scripts/**` 의 bare import 를 뽑아
  `package.json` 과 대조하고, 미선언이면 exit 1.
- 제외 대상: Node 내장(`node:` 접두사·`builtinModules`) · `@/` 별칭 · 상대/절대 경로 ·
  `scripts/probes/`(`.gitignore` 대상이라 CI 체크아웃엔 없다 — 훑으면 로컬만 빨개진다).
- ⚠️ **`from` 뒤 공백이 판별의 핵심**이다. import 는 `from "pkg"`(괄호 없음)인데 Supabase 는
  `sb.from("apartments")`(괄호 있음)라, 괄호를 허용하면 **테이블 이름이 전부 패키지로 잡힌다**
  (첫 구현이 실제로 26종 오검출). 회귀 가드가 `audit-declared-deps.test.mjs` 에 있고
  뮤테이션 3종(괄호 허용·stripComments 우회·내장 검사 제거)으로 red 실증했다.
- 새 패키지를 쓸 땐 `npm i -D <이름>` 으로 **명시 선언**하고, 버전은 지금 해석되는 것과
  **같은 메이저로 고정**한다(`npm i -D js-yaml` 은 메이저 5를 끌어와 타입 정의 4와 어긋났다).

