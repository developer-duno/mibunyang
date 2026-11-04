// @ts-check
/**
 * collect-schools.yml 수동 입력(limit·ids) 검증이 살아 있는지 — 워크플로의 **진짜 run 글자**를 bash 로 돌려 잰다
 * (BACKLOG 99 · #605 · 세션567·569 입력 검사 · 세션696 반C).
 *
 * 왜 글자 대조가 아니라 실행인가: 정규식 끝 `$` 하나만 빠져도 `1; 명령`·`1(줄바꿈)--rescale-only` 가 통과한다(세션569 —
 * grep 은 줄 단위라 첫 줄만 봤다). 글자 대조 시험은 그 변이에 초록이다.
 *
 * 방법: yml 을 읽어 「Collect school data」 단계의 run 을 꺼내 `${{ inputs.dry_run }}` 만 값으로 바꾸고, 앞에 `node` 셸 함수를
 * 붙여(실제 수집기는 안 돈다 — 받은 인자만 찍는다) GitHub Actions 기본 셸과 같은 `bash --noprofile --norc -eo pipefail` 로 돌린다.
 * limit·ids 는 워크플로처럼 환경변수(LIMIT·IDS)로 넣는다. 외부 호출 0.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as yaml from "js-yaml";

const YML_PATH = new URL("../.github/workflows/collect-schools.yml", import.meta.url);
const STEP_NAME = "Collect school data";
const NODE_ARGS_PREFIX = "NODE_ARGS:";

/** @returns {{ run: string, env: Record<string, string> }} */
function loadStep() {
  // FAILSAFE_SCHEMA — 값은 전부 글자(이 저장소의 yml 파싱 관습 · secret-naming-audit)
  const doc = /** @type {any} */ (yaml.load(readFileSync(YML_PATH, "utf8").replace(/\r\n/g, "\n"), { schema: yaml.FAILSAFE_SCHEMA }));
  const jobs = Object.values(doc?.jobs ?? {});
  /** @type {any[]} */
  const steps = jobs.flatMap((j) => /** @type {any} */ (j).steps ?? []);
  const hits = steps.filter((s) => s?.name === STEP_NAME);
  if (hits.length !== 1) throw new Error(`「${STEP_NAME}」 단계가 ${hits.length}개 — 정확히 1개여야 한다`);
  return { run: String(hits[0].run ?? ""), env: hits[0].env ?? {} };
}

/**
 * @param {{ limit?: string, ids?: string, dryRun?: boolean }} input
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runStep({ limit = "", ids = "", dryRun = false }) {
  const { run } = loadStep();
  const script = run.split("${{ inputs.dry_run }}").join(dryRun ? "true" : "false");
  if (script.includes("${{")) throw new Error("run 안에 dry_run 말고 다른 ${{ }} 가 남았다 — 입력을 셸에 직접 끼우면 안 된다");
  const stub = `node() { echo "${NODE_ARGS_PREFIX}$*"; }\n`;
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", stub + script], {
    env: { ...process.env, LIMIT: limit, IDS: ids },
    encoding: "utf8",
  });
  if (r.error) throw r.error; // bash 가 없으면 시끄럽게(건너뛰지 않는다)
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** @param {{ stdout: string }} r */
const nodeLines = (r) => r.stdout.split(/\r?\n/).filter((l) => l.startsWith(NODE_ARGS_PREFIX));

describe("collect-schools.yml — 입력은 환경변수로만 받는다(구조)", () => {
  it("env 에 LIMIT·IDS 가 inputs 에서 오고, run 글자에는 inputs.limit·inputs.ids 가 직접 안 들어간다", () => {
    const { run, env } = loadStep();
    expect(String(env.LIMIT)).toBe("${{ inputs.limit }}");
    expect(String(env.IDS)).toBe("${{ inputs.ids }}");
    expect(run).not.toMatch(/inputs\.limit/);
    expect(run).not.toMatch(/inputs\.ids/);
    expect(run).toContain("node scripts/collectors/schools-neis.mjs $ARGS");
  });
});

describe("collect-schools.yml — 맞는 입력은 그대로 수집기로 간다(양성 대조군)", () => {
  /** @type {Array<[string, { limit?: string, ids?: string, dryRun?: boolean }, string]>} */
  const ok = [
    ["입력 없음", {}, ""],
    ["limit 1200", { limit: "1200" }, "--limit 1200"],
    ["limit 5자리 99999", { limit: "99999" }, "--limit 99999"],
    ["ids 하나", { ids: "ap-123" }, "--ids=ap-123"],
    ["ids 여럿(영문·숫자·-·_)", { ids: "ap-1,ah-2025_910146,X9" }, "--ids=ap-1,ah-2025_910146,X9"],
    ["dry_run + limit + ids", { dryRun: true, limit: "3", ids: "a,b" }, "--dry-run --limit 3 --ids=a,b"],
  ];
  for (const [label, input, args] of ok) {
    it(`${label} → exit 0 · 수집기 인자 「${args || "(없음)"}」`, () => {
      const r = runStep(input);
      expect(r.status, r.stderr).toBe(0);
      const want = ["scripts/collectors/schools-neis.mjs", args].filter(Boolean).join(" ");
      expect(nodeLines(r)).toEqual([`${NODE_ARGS_PREFIX}${want}`]);
    });
  }
});

describe("collect-schools.yml — 틀린 입력은 수집기를 부르기 전에 exit 1", () => {
  /** @type {Array<[string, { limit?: string, ids?: string }]>} */
  const bad = [
    ["limit 뒤 명령 `1; echo PWNED`", { limit: "1; echo PWNED" }],
    ["limit 줄바꿈 뒤 인자(세션569 grep 함정)", { limit: "1\n--rescale-only" }],
    ["limit 6자리", { limit: "123456" }],
    ["limit 음수", { limit: "-1" }],
    ["limit 글자", { limit: "abc" }],
    ["limit 명령 치환", { limit: "$(echo PWNED)" }],
    ["ids 명령 붙이기", { ids: "ap-1;echo PWNED" }],
    ["ids 줄바꿈", { ids: "ap-1\n--force" }],
    ["ids 빈 칸 끼움 `a,,b`", { ids: "a,,b" }],
    ["ids 끝 쉼표", { ids: "a," }],
    ["ids 앞 쉼표", { ids: ",a" }],
    ["ids 띄어쓰기", { ids: "a b" }],
    ["ids 명령 치환", { ids: "$(echo PWNED)" }],
    ["ids 옵션 끼움 `a --force`", { ids: "a --force" }],
  ];
  for (const [label, input] of bad) {
    it(`${label} → exit 1 · 수집기 호출 0 · 주입 실행 0`, () => {
      const r = runStep(input);
      expect(r.status).toBe(1);
      expect(nodeLines(r)).toEqual([]);
      expect(r.stdout + r.stderr).not.toContain("PWNED");
      expect(r.stdout).toMatch(/::error::(limit|ids) 형식 오류/);
    });
  }
});
