# audit-env-keys matrix orchestrator 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/audit-env-keys.mjs` 가 `fill-missing-data.yml` 의 matrix job 안 각 collector 항목별 env block 누락도 검출하도록 보강한다 (세션 232 → 294 동일 사고 3년 2회 재발 차단).

**Architecture:** TDD + hardcoded MATRIX_ORCHESTRATORS 리스트 + 일반화 함수 `extractMatrixJobs()` 추가. 기존 1대1 매칭 (`findWorkflowForCollector`) audit 자산 보존, matrix 매칭 audit 별도 루프로 추가. vitest fixture 기반 회귀 가드.

**Tech Stack:** Node.js ES Modules (`.mjs`) + `// @ts-check` JSDoc + vitest + 정규식 (yaml lib 미사용).

---

## File Structure

| 파일 | 역할 | 변경 |
|---|---|---|
| `scripts/audit-env-keys.mjs` | matrix orchestrator 답습 함수 + main 루프 추가 | Modify |
| `scripts/audit-env-keys.test.mjs` | vitest fixture + 회귀 가드 | Create |
| `.claude/rules/secret-naming-audit.md` | §1 한계 박제 줄 삭제 + 본 보강 박제 | Modify |

---

## Task 1: 회귀 테스트 fixture + extractMatrixJobs 단위 테스트 (Red)

**Files:**
- Create: `scripts/audit-env-keys.test.mjs`
- Reference: `scripts/collectors/_shared.test.mjs:1-10` (test 답습 패턴)

- [ ] **Step 1: Create test file with fixtures and failing tests**

```js
// @ts-check
/**
 * audit-env-keys.mjs 테스트 — matrix orchestrator 답습 회귀 가드
 * 사고 박제: 세션 232 → 294 동일 (KOSIS_MIGRATION_KEY env block 누락) 3년 2회.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { extractMatrixJobs } from "./audit-env-keys.mjs";

const TMP = path.join(process.cwd(), ".tmp-audit-test");

const FIXTURE_OK = `name: Fill Missing Data

jobs:
  phase4-independent:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        script:
          - { name: "전입출 순이동", cmd: "migration" }
          - { name: "인구 증감률", cmd: "population" }
    env:
      SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
      MOIS_POP_KEY: \${{ secrets.MOIS_POP_KEY }}
      KOSIS_MIGRATION_KEY: \${{ secrets.KOSIS_MIGRATION_KEY }}
    steps:
      - name: Validate secrets
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$MOIS_POP_KEY" ] || [ -z "$KOSIS_MIGRATION_KEY" ]; then
            exit 1
          fi
      - name: "\${{ matrix.script.name }}"
        run: node scripts/collectors/\${{ matrix.script.cmd }}.mjs

  phase3-external:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    strategy:
      fail-fast: false
      matrix:
        script:
          - { name: "교통 수집", cmd: "transport-tago" }
    env:
      SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
      TAGO_KEY: \${{ secrets.TAGO_KEY }}
    steps:
      - run: echo dummy
`;

describe("extractMatrixJobs", () => {
  beforeAll(async () => {
    await mkdir(TMP, { recursive: true });
  });

  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("정상 fixture — 모든 matrix 항목별 envBlock 답습", async () => {
    const file = path.join(TMP, "fill-ok.yml");
    await writeFile(file, FIXTURE_OK, "utf-8");

    const jobs = await extractMatrixJobs(file);

    expect(jobs.size).toBe(3); // migration + population + transport-tago

    const migration = jobs.get("migration");
    expect(migration).toBeDefined();
    expect(migration?.envBlock.has("KOSIS_MIGRATION_KEY")).toBe(true);
    expect(migration?.envBlock.has("MOIS_POP_KEY")).toBe(true);
    expect(migration?.envBlock.has("SUPABASE_URL")).toBe(true);
    expect(migration?.validateRefs.has("KOSIS_MIGRATION_KEY")).toBe(true);

    const transport = jobs.get("transport-tago");
    expect(transport?.envBlock.has("TAGO_KEY")).toBe(true);
    expect(transport?.envBlock.has("KOSIS_MIGRATION_KEY")).toBe(false); // 다른 job
  });

  it("세션 294 사고 재현 — KOSIS_MIGRATION_KEY env block 누락 검출", async () => {
    const missing = FIXTURE_OK.replace(/.*KOSIS_MIGRATION_KEY:.*\n/g, "");
    const file = path.join(TMP, "fill-missing.yml");
    await writeFile(file, missing, "utf-8");

    const jobs = await extractMatrixJobs(file);
    const migration = jobs.get("migration");
    expect(migration?.envBlock.has("KOSIS_MIGRATION_KEY")).toBe(false);
    expect(migration?.envBlock.has("MOIS_POP_KEY")).toBe(true); // 다른 키는 정상
  });

  it("matrix 없는 yml — 빈 Map 반환", async () => {
    const noMatrix = `name: simple
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`;
    const file = path.join(TMP, "no-matrix.yml");
    await writeFile(file, noMatrix, "utf-8");

    const jobs = await extractMatrixJobs(file);
    expect(jobs.size).toBe(0);
  });

  it("validate step 없음 — validateRefs 빈 Set", async () => {
    const noValidate = FIXTURE_OK.replace(/- name: Validate secrets[\s\S]*?exit 1\n\s+fi\n/, "");
    const file = path.join(TMP, "no-validate.yml");
    await writeFile(file, noValidate, "utf-8");

    const jobs = await extractMatrixJobs(file);
    const migration = jobs.get("migration");
    expect(migration?.validateRefs.size).toBe(0);
    expect(migration?.envBlock.size).toBeGreaterThan(0); // env block 은 정상
  });
});
```

- [ ] **Step 2: Run test to verify it fails (Red)**

Command: `cd f:/mibunyang && npx vitest run scripts/collectors/audit-env-keys.test.mjs --no-cache 2>&1 | tail -20`

Expected: 4 tests FAIL with `extractMatrixJobs is not a function` 또는 import 에러 (함수 미존재).

> 답습 자산: `feedback_vitest_stale_cache.md` (세션 258) — vitest 캐시 함정 → `--no-cache` 의무.

---

## Task 2: extractMatrixJobs 함수 구현 (Green)

**Files:**
- Modify: `scripts/audit-env-keys.mjs` — `extractYmlEnvVars` 함수 (L46~68) 뒤에 추가

- [ ] **Step 1: Add MATRIX_ORCHESTRATORS constant + extractMatrixJobs function + export 의무**

`scripts/audit-env-keys.mjs` 상단 import 블록 직후 (L17 `import path from "node:path";` 다음) 에 추가:

```js
const MATRIX_ORCHESTRATORS = [
  ".github/workflows/fill-missing-data.yml",
];
```

`extractYmlEnvVars()` 함수 (L46~68) 정의 직후에 추가:

```js
/**
 * matrix orchestrator yml 답습 → matrix script 항목별 env 매핑
 * @param {string} file
 * @returns {Promise<Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>>}
 */
export async function extractMatrixJobs(file) {
  const text = await readFile(file, "utf-8");
  /** @type {Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>} */
  const result = new Map();

  // Top-level job 블록 추출 (2 space indent, 다음 top-level job 또는 EOF 까지)
  const jobBlockRe = /^ {2}([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^ {2}[a-z]|^[a-z]|\Z)/gm;
  let m;
  while ((m = jobBlockRe.exec(text)) !== null) {
    const jobBody = m[2];

    // matrix.script[] 항목의 cmd 키 추출
    /** @type {string[]} */
    const scriptNames = [];
    const scriptRe = /-\s*\{\s*name:\s*"[^"]*",\s*cmd:\s*"([^"]+)"/g;
    let cm;
    while ((cm = scriptRe.exec(jobBody)) !== null) {
      scriptNames.push(cm[1]);
    }
    if (scriptNames.length === 0) continue;

    // job 블록의 env: 와 Validate secrets step 추출 (기존 정규식 재활용)
    /** @type {Set<string>} */
    const envBlock = new Set();
    /** @type {Set<string>} */
    const validateRefs = new Set();

    const envRe = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/gm;
    let em;
    while ((em = envRe.exec(jobBody)) !== null) {
      if (!SECRET_PATTERN.test(em[1])) continue;
      envBlock.add(em[1]);
    }

    const validateRe = /-z\s+"?\$([A-Z][A-Z0-9_]*)"?/g;
    let vm;
    while ((vm = validateRe.exec(jobBody)) !== null) {
      if (!SECRET_PATTERN.test(vm[1])) continue;
      validateRefs.add(vm[1]);
    }

    // 모든 script 항목이 같은 env 공유 (matrix 특성)
    for (const name of scriptNames) {
      result.set(name, { envBlock, validateRefs });
    }
  }

  return result;
}
```

- [ ] **Step 2: Run tests to verify they pass (Green)**

Command: `cd f:/mibunyang && npx vitest run scripts/collectors/audit-env-keys.test.mjs --no-cache 2>&1 | tail -20`

Expected: 4 tests PASS.

- [ ] **Step 3: Commit (TDD checkpoint)**

Command:
```
cd f:/mibunyang
git add scripts/audit-env-keys.mjs scripts/collectors/audit-env-keys.test.mjs
git commit -m "test(audit-env-keys): extractMatrixJobs 회귀 가드 + 함수 구현"
```

(긴 본문 HEREDOC 사용 — 본 plan 본문에 별도 박제)

Commit message body:
```
세션 232 → 294 동일 사고 (KOSIS_MIGRATION_KEY env block 누락) 3년 2회 재발 차단.
matrix orchestrator (fill-missing-data.yml) 답습 함수 신규.

- audit-env-keys.test.mjs 신규 — 4 test (fixture 기반)
- extractMatrixJobs() 함수 + MATRIX_ORCHESTRATORS 상수 신규
- yaml lib 0 의존성 (정규식 기반, 기존 envRe/validateRe 재활용)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 3: main() audit 루프 보강 — matrix 검출 + 출력

**Files:**
- Modify: `scripts/audit-env-keys.mjs` — `main()` 함수 안 기존 audit 루프 (L122~164) 직후

- [ ] **Step 1: Add matrix audit loop after existing 1-to-1 audit**

`main()` 함수의 기존 `for (const mjs of collectorMjs) { ... }` 루프 종료 직후 (L164 `}` 직후, `// 출력` 주석 직전) 에 추가:

```js
  // ── matrix orchestrator 추가 audit (세션 294 사고 대응) ─────
  /** @type {{collector: string, orchestrator: string, codeKeys: string[], ymlEnvKeys: string[], validateKeys: string[], issues: string[]}[]} */
  const matrixReports = [];

  for (const orchYml of MATRIX_ORCHESTRATORS) {
    /** @type {Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>} */
    let matrixJobs;
    try {
      matrixJobs = await extractMatrixJobs(orchYml);
    } catch (err) {
      console.warn(`⚠️ matrix orchestrator 답습 실패: ${orchYml} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const [name, { envBlock, validateRefs }] of matrixJobs) {
      const mjs = `${name}.mjs`;
      if (!collectorMjs.includes(mjs)) {
        console.warn(`⚠️ matrix script "${name}" 의 ${mjs} 본문 부재 (${path.basename(orchYml)})`);
        continue;
      }

      const codePath = path.join(COLLECTORS_DIR, mjs);
      const codeKeys = await extractCodeEnvVars(codePath);
      if (codeKeys.size === 0) continue;

      /** @type {string[]} */
      const issues = [];
      for (const k of codeKeys) {
        if (!envBlock.has(k)) {
          issues.push(`❌ matrix yml env block 누락: ${k} (in ${path.basename(orchYml)}, script=${name})`);
          errorCount++;
        }
        if (envBlock.has(k) && !validateRefs.has(k)) {
          issues.push(`⚠️ matrix yml validate step 미참조: ${k} (script=${name})`);
        }
      }

      matrixReports.push({
        collector: mjs,
        orchestrator: path.basename(orchYml),
        codeKeys: [...codeKeys].sort(),
        ymlEnvKeys: [...envBlock].sort(),
        validateKeys: [...validateRefs].sort(),
        issues,
      });
    }
  }
```

이어서 기존 `// 출력` 블록 (L166~) 의 reports 출력 직후, summary 직전에 matrix reports 출력 추가:

```js
  // matrix orchestrator audit 출력
  for (const r of matrixReports) {
    if (r.issues.length === 0) continue;
    console.log(`\n[${r.collector} (matrix in ${r.orchestrator})]`);
    console.log(`  code     : ${r.codeKeys.join(", ")}`);
    console.log(`  yml env  : ${r.ymlEnvKeys.join(", ") || "(empty)"}`);
    console.log(`  yml valid: ${r.validateKeys.join(", ") || "(none)"}`);
    for (const issue of r.issues) console.log(`  ${issue}`);
  }
```

마지막으로 summary 의 cleanCount 산정 라인 (L178) 수정 — matrixReports 도 합산:

```js
  const cleanCount = reports.filter(r => r.issues.length === 0).length
    + matrixReports.filter(r => r.issues.length === 0).length;
  const totalCount = reports.length + matrixReports.length;
  console.log(`\n=== summary: ${cleanCount}/${totalCount} clean, ${errorCount} errors ===`);
```

- [ ] **Step 2: Run full audit to verify clean state**

Command: `cd f:/mibunyang && node scripts/audit-env-keys.mjs 2>&1 | tail -10`

Expected: `summary: N/N clean, 0 errors` + `✅ all clean` + exit 0. N 이 기존 36 보다 큰 값 (matrix 항목 추가 = 약 13 phase2~4 collector 추가, 단 collector 본문 부재 제외).

- [ ] **Step 3: Run vitest full to ensure 0 regression**

Command: `cd f:/mibunyang && npx vitest run --no-cache 2>&1 | tail -15`

Expected: 모든 test pass (기존 + 신규 4).

---

## Task 4: 세션 294 사고 재현 시뮬레이션 (실증 검증)

**Files:**
- Backup/Restore: `.github/workflows/fill-missing-data.yml` (변경 후 복원 의무)

- [ ] **Step 1: Backup fill-missing-data.yml**

Command: `cd f:/mibunyang && cp .github/workflows/fill-missing-data.yml /tmp/_fill_backup.yml`

- [ ] **Step 2: Remove KOSIS_MIGRATION_KEY env block line (사고 재현)**

Command:
```
cd f:/mibunyang
sed -i '/^      KOSIS_MIGRATION_KEY: \${{ secrets.KOSIS_MIGRATION_KEY }}$/d' .github/workflows/fill-missing-data.yml
grep -n "KOSIS_MIGRATION_KEY" .github/workflows/fill-missing-data.yml
```

Expected grep 결과: validate step shell 의 `-z "$KOSIS_MIGRATION_KEY"` 라인만 남고 env block 라인 0 (사고 재현 완료).

- [ ] **Step 3: Run audit — expect exit 1 with matrix detection**

Command:
```
cd f:/mibunyang
node scripts/audit-env-keys.mjs 2>&1 | tail -15
echo "EXIT: $?"
```

Expected 출력 포함:
```
[migration.mjs (matrix in fill-missing-data.yml)]
  ...
  ❌ matrix yml env block 누락: KOSIS_MIGRATION_KEY (in fill-missing-data.yml, script=migration)
...
❌ audit failed.
EXIT: 1
```

- [ ] **Step 4: Restore original file**

Command:
```
cd f:/mibunyang
cp /tmp/_fill_backup.yml .github/workflows/fill-missing-data.yml
git diff --stat .github/workflows/fill-missing-data.yml
```

Expected: `git diff --stat` 변동 0 (복원 확정).

- [ ] **Step 5: Run audit again — expect exit 0 (clean)**

Command:
```
cd f:/mibunyang
node scripts/audit-env-keys.mjs 2>&1 | tail -5
echo "EXIT: $?"
```

Expected:
```
=== summary: N/N clean, 0 errors ===
✅ all clean
EXIT: 0
```

> 답습 자산: `typescript-patterns.md §11` (시뮬레이션 의무) — 백업→정정→측정→복원 사이클로 git diff 변동 0 보장.

---

## Task 5: 룰 문서 갱신 + Commit

**Files:**
- Modify: `.claude/rules/secret-naming-audit.md`

- [ ] **Step 1: secret-naming-audit.md §1 한계 박제 줄 삭제 + 본 보강 박제 추가**

`.claude/rules/secret-naming-audit.md` 열어서 `#### 한계 박제 (세션 294 발견)` 절 (현재 §1 안의 sub-section, 약 L60~L75 영역) 전체를 다음으로 교체:

**기존** (삭제 대상):
```
#### 한계 박제 (세션 294 발견)

현재 audit-env-keys.mjs 는 **1대1 매칭 자리** (collect-X.yml ↔ X.mjs) 만 답습. 다음 자리 답습 0:

- fill-missing-data.yml 의 phase4-independent matrix ({ cmd: "migration" }) — collector 명이 yml 파일명에 박혀 있지 않음 자리
- data-fill.mjs orchestrator 의 envKeys 배열은 답습되지만 matrix yml 자체의 env block 누락은 미답습

세션 294 사고: fill-missing-data.yml L141 env block 에 KOSIS_MIGRATION_KEY 누락. audit 결과 30/36 clean 통과했는데도 phase4-independent → migration 실 발화 시 exit 1.

미래 보강 자리 (별 세션 진입 의무):
- audit 에 matrix orchestrator (fill-missing-data.yml) 답습 자리 추가
- yml 의 strategy.matrix.script[].cmd 자리 grep → 각 항목의 collector 의 envVars vs orchestrator yml env block 교차 검증
- 빈틈 0 자리 도달 시 본 한계 박제 줄 삭제 의무
```

**신규** (대체):
```
#### matrix orchestrator 답습 (세션 304 보강 완료)

세션 232 → 294 동일 사고 (KOSIS_MIGRATION_KEY env block 누락) 3년 2회 재발 차단. audit-env-keys.mjs 에 MATRIX_ORCHESTRATORS 상수 + extractMatrixJobs() 함수 추가. matrix yml 안의 각 script 항목 (예: { cmd: "migration" }) 별 envBlock vs collector codeKeys 교차 검증.

답습 범위:
- .github/workflows/fill-missing-data.yml 의 phase2-calc / phase3-external / phase4-independent matrix
- data-fill.mjs orchestrator envKeys 는 기존 extractDataFillEnvKeys() 가 답습 중 (변경 0)

새 matrix orchestrator yml 추가 시: scripts/audit-env-keys.mjs 의 MATRIX_ORCHESTRATORS 배열에 yml 경로 1줄 추가 (사람 박제).

검증:
- scripts/collectors/audit-env-keys.test.mjs — vitest fixture 기반 회귀 가드 4 test
- 세션 304 재현 시뮬 1회 (KOSIS_MIGRATION_KEY env block 일시 제거 → audit exit 1 검출 → 복원)
```

- [ ] **Step 2: Stage + commit (단일 커밋)**

Task 2 에서 이미 audit-env-keys.mjs + .test.mjs 의 함수 단위는 커밋 완료. 본 Step 은 main() 보강분 + secret-naming-audit.md 추가 커밋:

Command:
```
cd f:/mibunyang
git add scripts/audit-env-keys.mjs .claude/rules/secret-naming-audit.md
git status --short
git diff --cached --stat
git commit -m "feat(audit): main() matrix audit 루프 + 룰 §1 한계 박제 줄 삭제"
```

Commit message body:
```
Task 3~5 완결: matrix orchestrator 답습이 실제 audit 흐름에 합류.
세션 294 재현 시뮬 1회 통과 (exit 1 검출 + 복원 후 exit 0).

- audit-env-keys.mjs main() 에 matrix audit 루프 + summary 합산
- secret-naming-audit.md §1 한계 박제 줄 삭제, 보강 완료 박제 추가
- 회귀 가드: vitest 4 test + 시뮬 1회 (git diff 변동 0)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 6: CI green 확인 + push

**Files:** (없음 — push 만)

- [ ] **Step 1: Local final check**

Command:
```
cd f:/mibunyang
npx vitest run --no-cache 2>&1 | tail -10
node scripts/audit-env-keys.mjs 2>&1 | tail -5
git log origin/main..HEAD --oneline
```

Expected:
- vitest 모든 test pass
- audit `summary: N/N clean, 0 errors` + exit 0
- 미푸시 커밋 2개 (Task 2 + Task 5)

- [ ] **Step 2: Push**

Command: `cd f:/mibunyang && git push origin main`

- [ ] **Step 3: CI 통과 확인 (1~3분 대기)**

Command: `cd f:/mibunyang && gh run list --workflow=ci.yml --limit 1 --json conclusion,createdAt,status,databaseId`

Expected: `"conclusion":"success"` (또는 `"status":"in_progress"` 면 대기 후 재조회).

`success` 시 본 plan 완결. `failure` 시 `gh run view <id> --log-failed` 답습 후 정정 plan 작성.

---

## Self-Review Checklist

✅ **Spec coverage**: design doc §4.1~4.6 의 모든 항목 (MATRIX_ORCHESTRATORS / extractMatrixJobs / 정규식 / 에러 처리 / 회귀 테스트) 각 Task 매핑 완료.
✅ **Placeholder scan**: "TBD/TODO/구체 안 함" 0건. 모든 step 의 코드 블록 + 명령어 완전 박제.
✅ **Type consistency**: `extractMatrixJobs(file): Promise<Map<string, {envBlock, validateRefs}>>` Task 1 fixture + Task 2 구현 + Task 3 사용처 시그니처 일치 확정.
✅ **Frequent commits**: 커밋 2개 (Task 2 = TDD Red→Green 단위 + Task 5 = main() 통합 + rule 갱신).
✅ **답습 자산**: vitest --no-cache (세션 258), 시뮬레이션 의무 (세션 201), TDD Red→Green (TDD 표준).
