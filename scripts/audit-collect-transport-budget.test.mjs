// @ts-check
/**
 * collect-transport.yml 의 --budget-min 회귀 가드 (세션 496).
 *
 * 사고 배경: transport-tago.mjs 의 기본 벽시계 예산(180분)은 collect-naver-listings-
 * incremental.yml(job timeout 240분)을 겨냥한 값이다. 그런데 같은 스크립트를 도는
 * collect-transport.yml 의 job timeout 은 60분이라, 예산 인자를 안 넘기면 스크립트는
 * 기본값 180분으로 동작해 job timeout(60분)이 먼저 온다. job timeout 도달은
 * `.claude/rules/collectors/graceful-shutdown-coverage.md` 가 실증 박제한 대로
 * grace 0 즉시 SIGKILL 이라 [budget] 로그도 recordCollectorRun 도 못 남기고 죽는다
 * — monitor 가 못 보는 조용한 실패가 이 워크플로에서만 재발한다.
 *
 * 이 파일이 없으면(=세션 496 이전 상태) 다음 회귀를 아무 가드도 못 잡는다:
 *   1. collect-transport.yml 의 `--budget-min=` 인자를 통째로 지워도 전체 테스트/감사가
 *      green 이다 (실측: audit-env-keys/audit-fill-matrix/audit-monitor-coverage 전부
 *      yml env 변수·cron 등록만 보지 스크립트 인자는 안 본다).
 *   2. `--budget-min=` 을 넣긴 했는데 실수로 180(다른 워크플로용 기본값)처럼 60분
 *      job timeout 을 넘는 값으로 적어도 아무 가드가 없다.
 *
 * 좌변·선언까지 고정: `ARGS="--budget-min=..."` 처럼 실제 초기화 대입에만 매칭시킨다.
 * 단순 `--budget-min` 부분 문자열 검색은 이 파일 상단 주석(방금 그 문장)에도 걸려
 * "삭제해도 주석 때문에 통과"하는 함정(레포 박제: guards-must-be-mutation-tested.md)
 * 이 생긴다 — 그래서 대상은 이 테스트 파일이 아니라 yml 의 `run:` 스크립트 본문이고,
 * 그 본문 안에서도 주석(#으로 시작하는 줄)과 대입 줄을 구분해야 한다.
 */
import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

const YML_PATH = ".github/workflows/collect-transport.yml";
const STEP_NAME = "Collect transport data";

// `ARGS="--budget-min=NN"` 형태의 실제 초기화 대입만 매칭 (줄 시작 공백만 허용,
// `#` 주석 줄이나 `ARGS="$ARGS ..."` 이어붙이기 줄과는 구조적으로 다름).
const BUDGET_ASSIGN_RE = /^[ \t]*ARGS="--budget-min=(\d+)"\s*$/m;

/** @returns {Promise<{ timeoutMinutes: number, runText: string }>} */
async function loadCollectTransportStep() {
  const text = await readFile(YML_PATH, "utf-8");
  /** @type {any} */
  const doc = yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
  const job = doc?.jobs?.["collect-transport"];
  expect(job, "jobs.collect-transport 가 yml 구조에서 사라짐").toBeTruthy();

  const timeoutMinutes = Number(job["timeout-minutes"]);
  expect(Number.isFinite(timeoutMinutes), "timeout-minutes 파싱 실패").toBe(true);

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const step = steps.find((/** @type {any} */ s) => s?.name === STEP_NAME);
  expect(step, `step "${STEP_NAME}" 를 찾지 못함 — 이름이 바뀌었으면 이 테스트도 갱신`).toBeTruthy();

  const runText = typeof step.run === "string" ? step.run : "";
  return { timeoutMinutes, runText };
}

describe("collect-transport.yml — --budget-min 이 job timeout 안에서 발동하는가", () => {
  it("timeout-minutes 는 60 이다 (바뀌면 아래 예산 여유 계산도 같이 재검토)", async () => {
    const { timeoutMinutes } = await loadCollectTransportStep();
    expect(timeoutMinutes).toBe(60);
  });

  it("run 스크립트가 ARGS 초기값으로 --budget-min= 을 명시한다 (삭제 회귀 가드)", async () => {
    const { runText } = await loadCollectTransportStep();
    const m = runText.match(BUDGET_ASSIGN_RE);
    expect(m, `"${STEP_NAME}" 의 run 본문에 ARGS="--budget-min=NN" 초기화 대입이 없다`).toBeTruthy();
  });

  it("그 budget-min 값이 job timeout 보다 충분히 작다 (SIGKILL 전 발동 보장, 여유 5분+)", async () => {
    const { timeoutMinutes, runText } = await loadCollectTransportStep();
    const m = runText.match(BUDGET_ASSIGN_RE);
    expect(m).toBeTruthy();
    const budgetMin = Number(m?.[1]);
    expect(budgetMin).toBeGreaterThan(0);
    expect(budgetMin).toBeLessThanOrEqual(timeoutMinutes - 5);
  });

  it("주석(#)에 --budget-min 언급이 있어도 오탐 없음 — 실제 대입 값(50)만 잡는다", async () => {
    const { runText } = await loadCollectTransportStep();
    // 이 스텝의 run 본문 자체에 사고 배경 설명 주석이 있다 — 그 주석이 아니라
    // 그 아래 실제 대입 줄에서 정확히 하나만 매칭되는지 확인.
    const matches = [...runText.matchAll(new RegExp(BUDGET_ASSIGN_RE, "gm"))];
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe("50");
  });
});
