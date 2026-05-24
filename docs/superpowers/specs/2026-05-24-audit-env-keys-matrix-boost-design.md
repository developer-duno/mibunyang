# audit-env-keys matrix orchestrator 보강 — 설계 (2026-05-24)

> 세션 232 → 세션 294 → 본 세션 (E 후보) — 동일 사고 (`KOSIS_MIGRATION_KEY` env block 누락) 가 3년에 2회 재발. 본 보강은 matrix orchestrator 답습 blind spot 영구 차단.

## 1. 배경

### 1.1 사고 박제

- **세션 232 (1차 사고)**: `collect-migration.yml` 이 `MOIS_POP_KEY` 만 주입 → `migration.mjs` 가 `KOSIS_MIGRATION_KEY` 요구 → 1개월 schedule fail 방치. `secret-naming-audit.md` 박제 + `scripts/audit-env-keys.mjs` 신규.
- **세션 294 (2차 사고)**: `fill-missing-data.yml` 의 phase4-independent matrix `{ cmd: "migration" }` 에 `KOSIS_MIGRATION_KEY` env block 누락. audit 결과 `30/36 clean ✅` 통과한 상태인데 실 발화 시 `[migration] ERROR: KOSIS_MIGRATION_KEY 환경변수 필요` exit 1.
- **본 세션 (3차 박제)**: 5/22 15:09 KST schedule failure 알림 = 세션 294 사고의 알림 발화. fix 는 `b313b56` 에서 완료됐으나 audit 한계는 미해소.

### 1.2 현재 audit 한계

`scripts/audit-env-keys.mjs` 의 `findWorkflowForCollector()` L93~100 = **1대1 매칭만 답습**:

```js
return candidates.find(f => {
  const ymlBase = path.basename(f, ".yml");
  return ymlBase === `collect-${base}` || ymlBase === base;
}) ?? null;
```

→ `migration.mjs` ↔ `collect-migration.yml` 매칭은 답습되지만, `fill-missing-data.yml` 의 phase4-independent matrix `{ cmd: "migration" }` 답습 0.

`secret-naming-audit.md` §1 한계 박제 (현재 본문):

> 현재 audit-env-keys.mjs 는 **1대1 매칭** (`collect-X.yml` ↔ `X.mjs`) 만 답습. 다음 답습 0:
> - `fill-missing-data.yml` 의 phase4-independent matrix (`{ cmd: "migration" }`) — collector 명이 yml 파일명에 박혀 있지 않음
> - `data-fill.mjs` orchestrator 의 envKeys 배열은 답습되지만 matrix yml 자체의 env block 누락은 미답습

본 보강 완결 후 본 한계 박제 줄 = **삭제**.

## 2. 범위

### 2.1 포함

- `scripts/audit-env-keys.mjs` 에 matrix orchestrator 답습 함수 추가
- `scripts/audit-env-keys.test.mjs` 신규 (vitest 회귀 가드)
- `.claude/rules/secret-naming-audit.md` 갱신 (한계 박제 줄 삭제 + 본 보강 박제 추가)
- 재현 시뮬레이션 1회 (세션 294 사고 재현 후 audit exit 1 확정 후 복원)

### 2.2 제외

- `data-fill.mjs` orchestrator envKeys 답습 = **현재 audit 자산 (`extractDataFillEnvKeys()` L70~87) 답습 중**. 본 보강 범위 외.
- yml glob + 자동 matrix 감지 = YAGNI. 현재 matrix orchestrator yml = 1개 (실측). hardcoded 1줄 리스트 답습.
- 다른 phase (phase1-coords / phase5-fill-trades) = matrix 아님 (단일 job). 기존 1대1 매칭과 동일 패턴 = 본 보강 범위 외.

## 3. 접근 안 비교

| 기준 | 접근 1 (선택) | 접근 2 | 접근 3 |
|---|---|---|---|
| 구조 | hardcoded 리스트 + 일반화 함수 | yml glob + 자동 감지 | 정규식 fragile |
| 미래 orchestrator 추가 비용 | 사람 1줄 박제 | 0 (자동) | 0 (자동) |
| 일반 collector yml 오탐 가능 | 0 | 있음 (matrix 가진 일반 yml) | 있음 (indent 변경 시) |
| yaml lib 의존성 추가 | 0 | + js-yaml 등 | 0 |
| 구현 복잡도 | 낮음 (~70줄) | 높음 | 중간 |

**선택 = 접근 1**. 근거:
- 현재 matrix orchestrator yml = `fill-missing-data.yml` 단일 (위 §1.2 grep 결과)
- YAGNI 원칙: 미래 일반화 가치 미실증
- hardcoded 1줄 답습 = 명확, 사용자 진입 편의성 ↑
- 새 orchestrator 추가 비용 = 1줄 갱신 = 미미

## 4. 설계

### 4.1 아키텍처

`scripts/audit-env-keys.mjs` 에 다음 추가:

```js
// 상수
const MATRIX_ORCHESTRATORS = [
  ".github/workflows/fill-missing-data.yml",
];

// 함수
async function extractMatrixJobs(file) {
  // yml 1개 → Map<cmd, {envBlock: Set<string>, validateRefs: Set<string>}>
  // 각 matrix job (phase2-calc / phase3-external / phase4-independent) 별로:
  //   1. job 블록 추출
  //   2. matrix.script[].cmd 추출
  //   3. job 블록의 env: 와 Validate secrets step 답습 (기존 extractYmlEnvVars 재활용)
  //   4. 각 cmd 별로 동일한 envBlock, validateRefs 매핑 (job 안의 모든 matrix cmd 가 같은 env 공유)
}

// 메인 main() 안에 추가 audit 루프
for (const orchYml of MATRIX_ORCHESTRATORS) {
  const matrixJobs = await extractMatrixJobs(orchYml);
  for (const [cmd, { envBlock, validateRefs }] of matrixJobs) {
    const mjs = `${cmd}.mjs`;
    const codePath = path.join(COLLECTORS_DIR, mjs);
    if (!collectorMjs.includes(mjs)) continue;

    const codeKeys = await extractCodeEnvVars(codePath);
    const issues = [];
    for (const k of codeKeys) {
      if (!envBlock.has(k)) {
        issues.push(`❌ matrix yml env block 누락: ${k} (in ${path.basename(orchYml)}, cmd=${cmd})`);
        errorCount++;
      }
      if (envBlock.has(k) && !validateRefs.has(k)) {
        issues.push(`⚠️ matrix yml validate step 미참조: ${k} (cmd=${cmd})`);
      }
    }
    // report 별도 섹션 출력
  }
}
```

### 4.2 데이터 흐름

```
1. 기존 1대1 매칭 audit (변경 0, findWorkflowForCollector)
2. ⇩ 추가
3. MATRIX_ORCHESTRATORS 순회
4. extractMatrixJobs(yml) → matrix 안 cmd 별 {envBlock, validateRefs} 답습
5. 각 cmd 의 collector envVars vs matrix job env block 교차 검증
6. mismatch 시 errorCount++ (기존과 동일)
7. report 출력 (matrix orchestrator 별도 섹션)
```

핵심 결정: **1대1 매칭 + matrix 매칭 두 곳 동시 답습**. 한 collector 가 두 곳 (단독 yml + matrix yml) 박힐 수 있음 — 둘 다 검증 (`migration.mjs` 가 `collect-migration.yml` + `fill-missing-data.yml` phase4 둘 다 박힘).

### 4.3 matrix yml 파싱 정규식

```js
// Job 블록 추출 (top-level 2 space indent)
const jobBlockRe = /^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z]|^[a-z]|\Z)/gm;

// matrix.script[].cmd 추출
const cmdRe = /-\s*\{\s*name:\s*"[^"]*",\s*cmd:\s*"([^"]+)"/g;

// env: 블록 안의 KEY: ${{ secrets.X }} — 기존 envRe 재활용
const envRe = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/gm;

// validate step shell 의 -z "$X" — 기존 validateRe 재활용
const validateRe = /-z\s+"?\$([A-Z][A-Z0-9_]*)"?/g;
```

**한계 박제**: yml indent 변경 시 깨질 위험 (정규식 fragile). vitest fixture 로 indent 변경 보호 가드 의무.

### 4.4 회귀 테스트

**(A) 재현 시뮬레이션** (1회):

```bash
# 1. 백업
cp .github/workflows/fill-missing-data.yml /tmp/_fill.bak

# 2. KOSIS_MIGRATION_KEY env block 제거 (sed)
sed -i '/KOSIS_MIGRATION_KEY: .* secrets.KOSIS_MIGRATION_KEY/d' .github/workflows/fill-missing-data.yml

# 3. audit 실행 → exit 1 + 누락 위치 표시 확인
node scripts/audit-env-keys.mjs
# 기대 출력:
#   [migration.mjs (matrix in fill-missing-data.yml)]
#     ❌ matrix yml env block 누락: KOSIS_MIGRATION_KEY (in fill-missing-data.yml, cmd=migration)

# 4. 복원
cp /tmp/_fill.bak .github/workflows/fill-missing-data.yml

# 5. audit 재실행 → exit 0 확인 + git diff 변동 0
node scripts/audit-env-keys.mjs && git diff --stat .github/workflows/fill-missing-data.yml
```

**(B) vitest 회귀 가드** (`scripts/audit-env-keys.test.mjs` 신규):

```js
// fixture
const FIXTURE_OK = `
jobs:
  phase4-independent:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        script:
          - { name: "전입출 순이동", cmd: "migration" }
    env:
      SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
      KOSIS_MIGRATION_KEY: \${{ secrets.KOSIS_MIGRATION_KEY }}
    steps:
      - name: Validate secrets
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$KOSIS_MIGRATION_KEY" ]; then
            exit 1
          fi
`;

const FIXTURE_MISSING_ENV = FIXTURE_OK.replace(/KOSIS_MIGRATION_KEY: .*\n/, "");

// 테스트
// 1. extractMatrixJobs(FIXTURE_OK) → Map { "migration" => { envBlock: {SUPABASE_URL, KOSIS_MIGRATION_KEY}, validateRefs: {...} } }
// 2. extractMatrixJobs(FIXTURE_MISSING_ENV) → envBlock 에 KOSIS_MIGRATION_KEY 없음
// 3. matrix job 2개 (phase3 + phase4) 동시 답습 fixture
// 4. cmd 없는 matrix (script 빈) → 빈 Map 반환
```

vitest test 개수 = ~3~4건 (~120줄 fixture 포함).

### 4.5 에러 처리

- yml 본문 read 실패 시 = `console.warn` + 다음 orchestrator 답습 (기존 답습 자산)
- matrix 0인 yml (단일 job yml 잘못 박힘) = `console.warn` + skip
- 동일 collector 이중 매핑 = 각 yml 별 issue 박제 (중복 명시)
- collector 본문 부재 (matrix cmd 가 실제 .mjs 파일과 매칭 안 됨) = `console.warn` + skip

### 4.6 미래 확장

```js
// 새 matrix orchestrator 추가:
const MATRIX_ORCHESTRATORS = [
  ".github/workflows/fill-missing-data.yml",
  // 미래: .github/workflows/seed-data.yml 등
];
```

본 보강 후 `secret-naming-audit.md` §1 한계 박제 줄 = **삭제**.

## 5. 작업 분량

| 단계 | 작업 | 분량 |
|---|---|---|
| 1 | `audit-env-keys.mjs` 보강 (`MATRIX_ORCHESTRATORS` 상수 + `extractMatrixJobs()` 함수 + main() 안 추가 audit 루프) | ~70줄 |
| 2 | `audit-env-keys.test.mjs` 신규 (fixture + 3~4 test) | ~120줄 |
| 3 | 재현 시뮬레이션 1회 실측 | 5분 |
| 4 | `.claude/rules/secret-naming-audit.md` §1 한계 박제 줄 삭제 + 본 보강 박제 추가 | ~20줄 |
| 5 | `ci.yml` 의 `node scripts/audit-env-keys.mjs` step 답습 확인 (이미 박힘 L35, 변경 0) | 검증 |
| 6 | commit 1건 (보강 + 테스트 + 룰 갱신) | - |

**총 신규/수정**: ~210줄 (audit ~70 + test ~120 + rule ~20).

## 6. 9 GATE 검증 (실행 단계)

1. **시뮬레이션 의무** (typescript-patterns.md §11) — 정정 적용 후 typecheck 재측정 의무. 본 작업은 `.mjs` 파일 답습 → `// @ts-check` 활성화 시 typecheck 의무
2. **자가 점검 1** (맹점/할루시네이션) — matrix yml 파싱 정규식 fragile 영역 vitest fixture 로 가드 확정
3. **자가 점검 2** (plan 빈틈 0) — fill-missing-data.yml 외 다른 matrix orchestrator 0 확정 (위 grep 결과)
4. **회귀 가드 1회 실행** — vitest + audit-env-keys 실측

## 7. 답습 자산

- `.claude/rules/secret-naming-audit.md` §1 한계 박제 (본 작업 종결 트리거)
- `scripts/audit-env-keys.mjs` L70~87 `extractDataFillEnvKeys()` (답습 자산 재활용)
- `scripts/audit-env-keys.mjs` L46~68 `extractYmlEnvVars()` (envRe + validateRe 재활용)
- 세션 232 / 294 / 본 세션 사고 박제 (3년 2회 동일 사고)
- 본 spec 종결 후 = writing-plans skill 발동 → 실행 단계 진입
