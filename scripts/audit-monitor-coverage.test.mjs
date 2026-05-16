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
