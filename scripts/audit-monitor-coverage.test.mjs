// @ts-check
/**
 * audit-monitor-coverage.mjs 순수 함수 테스트
 * 대상: extractWorkflowName, extractMonitoredWorkflows, findUncoveredWorkflows
 */
import { describe, it, expect } from "vitest";
import {
  extractWorkflowName,
  extractMonitoredWorkflows,
  findUncoveredWorkflows,
  extractRunCollectors,
  findUnrecordedCollectors,
} from "./audit-monitor-coverage.mjs";

describe("extractWorkflowName", () => {
  it("따옴표 없는 name 필드를 추출한다", () => {
    expect(extractWorkflowName("name: Transport Accessibility Collection\non:\n")).toBe(
      "Transport Accessibility Collection",
    );
  });

  it("따옴표로 감싼 name 의 따옴표를 벗긴다", () => {
    expect(extractWorkflowName('name: "Collect Building Hub (에너지+인허가)"\n')).toBe(
      "Collect Building Hub (에너지+인허가)",
    );
  });

  it("name 필드가 없으면 null", () => {
    expect(extractWorkflowName("on:\n  schedule:\n")).toBeNull();
  });
});

describe("extractMonitoredWorkflows", () => {
  it("workflow_run.workflows 목록을 추출하고 types: 에서 멈춘다", () => {
    const yml = `on:
  workflow_run:
    workflows:
      - "Air Quality Collection"
      - "Transport Accessibility Collection"
      - "소음 추정 수집"
    types: [completed]
  schedule:
    - cron: '0 0 * * *'
`;
    expect(extractMonitoredWorkflows(yml)).toEqual([
      "Air Quality Collection",
      "Transport Accessibility Collection",
      "소음 추정 수집",
    ]);
  });

  it("schedule 의 - cron 항목을 목록에 섞지 않는다 (types: 에서 이미 종료)", () => {
    const yml = `    workflows:
      - "A"
    types: [completed]
  schedule:
    - cron: '0 0 * * *'
`;
    expect(extractMonitoredWorkflows(yml)).toEqual(["A"]);
  });

  it("workflows: 가 없으면 빈 배열", () => {
    expect(extractMonitoredWorkflows("on:\n  schedule:\n    - cron: '0 0 * * *'\n")).toEqual([]);
  });
});

describe("findUncoveredWorkflows", () => {
  it("감시 목록에 빠진 collect 워크플로를 찾는다", () => {
    const uncovered = findUncoveredWorkflows(
      ["A", "B", "C"],
      ["A", "C"], // B 누락
    );
    expect(uncovered).toEqual(["B"]);
  });

  it("모두 커버되면 빈 배열", () => {
    expect(findUncoveredWorkflows(["A", "B"], ["A", "B", "C"])).toEqual([]);
  });

  it("collect 워크플로가 0개면 빈 배열", () => {
    expect(findUncoveredWorkflows([], ["A"])).toEqual([]);
  });
});

// ── 검사 2: 실행되는데 기록을 안 남기는 수집기 (세션 504) ──────────
//
// 사고: collector_runs 에 행이 안 생기면 monitor 가 볼 표 자체가 없어
// "워크플로는 초록불인데 실제로는 아무것도 안 한" 회차를 아무도 못 본다.
// 실제로 그런 수집기가 8개 있었고, 그중 geocode-missing·reverse-geocode 는
// 워크플로가 continue-on-error 라 실패해도 초록불이어서 완전 무음이었다.
// 세션504 에 전부 배선했고(현재 0건), 이 검사는 **새 수집기로 재발하는 것**을 막는다.
describe("extractRunCollectors — 워크플로가 무엇을 돌리는지", () => {
  it("직접 실행(node scripts/collectors/X.mjs)을 잡는다", () => {
    const yml = `      - name: 수집\n        run: node scripts/collectors/noxious.mjs --force`;
    expect(extractRunCollectors(yml)).toEqual(["noxious"]);
  });

  it("matrix 형태(cmd: \"X\")도 잡는다 — 이걸 놓치면 matrix 수집기가 통째로 사각", () => {
    const yml = `        script:\n          - { name: "층수 계산", cmd: "calc-floors" }\n          - { name: "규제", cmd: "regulation-seed" }`;
    expect(extractRunCollectors(yml).sort()).toEqual(["calc-floors", "regulation-seed"]);
  });

  it("같은 수집기가 여러 번 나와도 한 번만", () => {
    const yml = `run: node scripts/collectors/a.mjs\nrun: node scripts/collectors/a.mjs --dry-run`;
    expect(extractRunCollectors(yml)).toEqual(["a"]);
  });
});

describe("findUnrecordedCollectors — 기록 안 남기는 것 색출", () => {
  it("recordCollectorRun 을 안 부르면 잡는다", () => {
    const m = new Map([["bad", "async function main(){ log('done'); }"]]);
    expect(findUnrecordedCollectors(m, new Set())).toEqual(["bad"]);
  });

  it("부르면 통과", () => {
    const m = new Map([["good", "await recordCollectorRun(PHASE, rpt.summary());"]]);
    expect(findUnrecordedCollectors(m, new Set())).toEqual([]);
  });

  it("ALLOWLIST 는 건너뛴다 (파일명·이름 둘 다 허용)", () => {
    const m = new Map([["skipme", "no record here"]]);
    expect(findUnrecordedCollectors(m, new Set(["skipme.mjs"]))).toEqual([]);
    expect(findUnrecordedCollectors(m, new Set(["skipme"]))).toEqual([]);
  });

  it("여러 건이면 정렬해서 준다 (출력이 흔들리지 않게)", () => {
    const m = new Map([["z", "x"], ["a", "y"]]);
    expect(findUnrecordedCollectors(m, new Set())).toEqual(["a", "z"]);
  });

  it("주석 안의 문자열에 속지 않는다 — 호출 형태(괄호)만 인정", () => {
    // "recordCollectorRun 을 배선해야 함" 같은 TODO 주석이 있어도 통과시키면 안 된다.
    const m = new Map([["todo", "// TODO: recordCollectorRun 배선 필요\nmain();"]]);
    expect(findUnrecordedCollectors(m, new Set())).toEqual(["todo"]);
  });
});
