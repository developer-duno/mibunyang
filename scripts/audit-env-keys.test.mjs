// @ts-check
/**
 * audit-env-keys.mjs 테스트 — matrix orchestrator 답습 회귀 가드
 * 사고 박제: 세션 232 → 294 동일 (KOSIS_MIGRATION_KEY env block 누락) 3년 2회.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { extractMatrixJobs, extractStepCollectorEnv } from "./audit-env-keys.mjs";

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

    expect(jobs.size).toBe(3);

    const migration = jobs.get("migration");
    expect(migration).toBeDefined();
    expect(migration?.envBlock.has("KOSIS_MIGRATION_KEY")).toBe(true);
    expect(migration?.envBlock.has("MOIS_POP_KEY")).toBe(true);
    expect(migration?.envBlock.has("SUPABASE_URL")).toBe(true);
    expect(migration?.validateRefs.has("KOSIS_MIGRATION_KEY")).toBe(true);

    const transport = jobs.get("transport-tago");
    expect(transport?.envBlock.has("TAGO_KEY")).toBe(true);
    expect(transport?.envBlock.has("KOSIS_MIGRATION_KEY")).toBe(false);
  });

  it("세션 294 사고 재현 — KOSIS_MIGRATION_KEY env block 누락 검출", async () => {
    const missing = FIXTURE_OK.replace(/.*KOSIS_MIGRATION_KEY:.*\n/g, "");
    const file = path.join(TMP, "fill-missing.yml");
    await writeFile(file, missing, "utf-8");

    const jobs = await extractMatrixJobs(file);
    const migration = jobs.get("migration");
    expect(migration?.envBlock.has("KOSIS_MIGRATION_KEY")).toBe(false);
    expect(migration?.envBlock.has("MOIS_POP_KEY")).toBe(true);
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
    const noValidate = `name: Fill Missing Data

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
      - run: node scripts/collectors/migration.mjs
`;
    const file = path.join(TMP, "no-validate.yml");
    await writeFile(file, noValidate, "utf-8");

    const jobs = await extractMatrixJobs(file);
    const migration = jobs.get("migration");
    expect(migration?.validateRefs.size).toBe(0);
    expect(migration?.envBlock.size).toBeGreaterThan(0);
  });
});

// ── collector → yml-step env 역방향 매핑 (세션 328 사고 대응) ─────
// 1:1 매칭(yml명=collector명)이 못 잡던 사각지대: yml명≠collector명 + multi-collector yml.
// 9개 collector(transport-tago/schools-neis/infra-kakao 등)가 미검증 clean 오집계됐던 사고.

// incremental.yml 축약 재현: workflow/job env 없음, step.env 만 (3 collector, step 별 다른 env)
const FIXTURE_INCREMENTAL = `name: Naver Post-Processing (Incremental)

jobs:
  post-process-incremental:
    runs-on: ubuntu-latest
    steps:
      - name: Collect transport (incremental)
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          KAKAO_KEY: \${{ secrets.KAKAO_KEY }}
          TAGO_KEY: \${{ secrets.TAGO_KEY }}
        run: node scripts/collectors/transport-tago.mjs
      - name: Collect infra (incremental)
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          KAKAO_KEY: \${{ secrets.KAKAO_KEY }}
        run: node scripts/collectors/infra-kakao.mjs
      - name: Collect schools (incremental)
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          KAKAO_KEY: \${{ secrets.KAKAO_KEY }}
          NEIS_KEY: \${{ secrets.NEIS_KEY }}
          SCHOOLINFO_KEY: \${{ secrets.SCHOOLINFO_KEY }}
        run: node scripts/collectors/schools-neis.mjs
`;

// 이름 불일치 재현: collect-transport.yml ↔ transport-tago.mjs (1:1 매칭 실패하던 케이스)
const FIXTURE_NAME_MISMATCH = `name: Transport Data Collection

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: Validate secrets
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$TAGO_KEY" ]; then
            exit 1
          fi
      - name: Collect transport data
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          KAKAO_KEY: \${{ secrets.KAKAO_KEY }}
          TAGO_KEY: \${{ secrets.TAGO_KEY }}
        run: node scripts/collectors/transport-tago.mjs
`;

// 1:N 재현: 한 step 에 collector 2개 (building-info.yml 패턴)
const FIXTURE_MULTI_COLLECTOR_STEP = `name: Building Info

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: Collect
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          MOLIT_KEY: \${{ secrets.MOLIT_KEY }}
        run: |
          node scripts/collectors/molit-building-info.mjs
          node scripts/collectors/sync-naver-complex.mjs
`;

// job.env fallback 재현: step.env 없는 step 이 job.env 상속
const FIXTURE_JOB_ENV = `name: Job Env

jobs:
  collect:
    runs-on: ubuntu-latest
    env:
      SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
      KAKAO_KEY: \${{ secrets.KAKAO_KEY }}
    steps:
      - name: Geocode
        run: node scripts/collectors/geocode-missing.mjs
`;

// B형 validate 재현: -z "\${{ secrets.X }}" (collect-schools/air-quality/police 패턴)
const FIXTURE_VALIDATE_SECRETS_EXPR = `name: Schools

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: Validate secrets
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$KAKAO_KEY" ]; then
            exit 1
          fi
          if [ -z "\${{ secrets.NEIS_KEY }}" ]; then
            echo "::warning::NEIS_KEY 미설정"
          fi
      - name: Collect school data
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          KAKAO_KEY: \${{ secrets.KAKAO_KEY }}
          NEIS_KEY: \${{ secrets.NEIS_KEY }}
        run: node scripts/collectors/schools-neis.mjs
`;

// matrix yml: extractStepCollectorEnv 가 matrix job 을 skip 해야 함 (이중평가 방지)
const FIXTURE_MATRIX_SKIP = `name: Fill Missing Data

jobs:
  phase4-independent:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        script:
          - { name: "전입출", cmd: "migration" }
    env:
      MOIS_POP_KEY: \${{ secrets.MOIS_POP_KEY }}
    steps:
      - name: "\${{ matrix.script.name }}"
        run: node scripts/collectors/\${{ matrix.script.cmd }}.mjs
`;

describe("extractStepCollectorEnv", () => {
  beforeAll(async () => {
    await mkdir(TMP, { recursive: true });
  });
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it("세션 328 재현 — multi-collector yml 의 schools step NEIS_KEY 누락 검출 (transport row 무영향)", async () => {
    // schools step 에서 NEIS_KEY env 줄 제거
    const missing = FIXTURE_INCREMENTAL.replace(/ *NEIS_KEY: \$\{\{ secrets\.NEIS_KEY \}\}\n/g, "");
    const file = path.join(TMP, "incremental-missing.yml");
    await writeFile(file, missing, "utf-8");

    const map = await extractStepCollectorEnv(file);
    const schools = map.get("schools-neis.mjs");
    expect(schools).toBeDefined();
    expect(schools?.length).toBe(1);
    expect(schools?.[0].envBlock.has("NEIS_KEY")).toBe(false); // 누락 검출
    expect(schools?.[0].envBlock.has("SCHOOLINFO_KEY")).toBe(true); // 다른 키는 유지

    // transport row 는 무영향
    const transport = map.get("transport-tago.mjs");
    expect(transport?.[0].envBlock.has("TAGO_KEY")).toBe(true);
    expect(transport?.[0].envBlock.has("NEIS_KEY")).toBe(false); // step 격리: transport 엔 NEIS 없음
  });

  it("이름 불일치 매칭 — collect-transport.yml ↔ transport-tago.mjs (1:1 매칭으로는 못 찾던 것)", async () => {
    const file = path.join(TMP, "name-mismatch.yml");
    await writeFile(file, FIXTURE_NAME_MISMATCH, "utf-8");

    const map = await extractStepCollectorEnv(file);
    const transport = map.get("transport-tago.mjs");
    expect(transport).toBeDefined();
    expect(transport?.[0].envBlock.has("TAGO_KEY")).toBe(true);
    expect(transport?.[0].envBlock.has("KAKAO_KEY")).toBe(true);
    expect(transport?.[0].validateRefs.has("TAGO_KEY")).toBe(true); // A형 validate 참조
  });

  it("1:N — 한 step 에 collector 2개 호출 시 둘 다 같은 env 상속", async () => {
    const file = path.join(TMP, "multi-collector-step.yml");
    await writeFile(file, FIXTURE_MULTI_COLLECTOR_STEP, "utf-8");

    const map = await extractStepCollectorEnv(file);
    expect(map.get("molit-building-info.mjs")?.[0].envBlock.has("MOLIT_KEY")).toBe(true);
    expect(map.get("sync-naver-complex.mjs")?.[0].envBlock.has("MOLIT_KEY")).toBe(true);
    expect(map.get("sync-naver-complex.mjs")?.[0].envBlock.has("SUPABASE_URL")).toBe(true);
  });

  it("job.env fallback — step.env 없는 step 이 job.env 상속", async () => {
    const file = path.join(TMP, "job-env.yml");
    await writeFile(file, FIXTURE_JOB_ENV, "utf-8");

    const map = await extractStepCollectorEnv(file);
    const geocode = map.get("geocode-missing.mjs");
    expect(geocode?.[0].envBlock.has("KAKAO_KEY")).toBe(true); // step.env 없어도 job.env 상속
    expect(geocode?.[0].envBlock.has("SUPABASE_URL")).toBe(true);
  });

  it("B형 validate — -z \"${{ secrets.X }}\" 형식도 validateRefs 에 잡힘", async () => {
    const file = path.join(TMP, "validate-secrets-expr.yml");
    await writeFile(file, FIXTURE_VALIDATE_SECRETS_EXPR, "utf-8");

    const map = await extractStepCollectorEnv(file);
    const schools = map.get("schools-neis.mjs");
    expect(schools?.[0].validateRefs.has("KAKAO_KEY")).toBe(true); // A형
    expect(schools?.[0].validateRefs.has("NEIS_KEY")).toBe(true); // B형 (${{ secrets.NEIS_KEY }})
  });

  it("matrix job skip — extractStepCollectorEnv 는 matrix 를 잡지 않음 (extractMatrixJobs 담당, 이중평가 방지)", async () => {
    const file = path.join(TMP, "matrix-skip.yml");
    await writeFile(file, FIXTURE_MATRIX_SKIP, "utf-8");

    const map = await extractStepCollectorEnv(file);
    // matrix job 은 skip → ${{ }} 치환 collector 미수집
    expect(map.has("migration.mjs")).toBe(false);
    expect(map.size).toBe(0);
  });
});
