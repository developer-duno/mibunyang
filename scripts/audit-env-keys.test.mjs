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
    const noValidate = FIXTURE_OK.replace(/- name: Validate secrets[\s\S]*?exit 1\n\s+fi\n/, "");
    const file = path.join(TMP, "no-validate.yml");
    await writeFile(file, noValidate, "utf-8");

    const jobs = await extractMatrixJobs(file);
    const migration = jobs.get("migration");
    expect(migration?.validateRefs.size).toBe(0);
    expect(migration?.envBlock.size).toBeGreaterThan(0);
  });
});
