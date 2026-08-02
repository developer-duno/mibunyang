// @ts-check
import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { findUnwiredHooks } from "./audit-hooks-wiring.mjs";

describe("findUnwiredHooks", () => {
  it("settings 본문에 이름이 있으면 배선됨 = 빈 배열", () => {
    expect(
      findUnwiredHooks(
        ["guard-dangerous-bash.sh"],
        '{"hooks":{"PreToolUse":[{"hooks":[{"command":".claude/hooks/guard-dangerous-bash.sh"}]}]}}',
      ),
    ).toEqual([]);
  });

  it("세션 485 사고 재현 — 파일은 있는데 호출부 0건이면 검출", () => {
    expect(
      findUnwiredHooks(
        ["guard-dangerous-bash.sh", "post-edit-ts-check.sh"],
        '{"hooks":{"PreToolUse":[{"hooks":[{"command":".claude/hooks/guard-dangerous-bash.sh"}]}]}}',
      ),
    ).toEqual(["post-edit-ts-check.sh"]);
  });

  it(".sh 아닌 파일은 검사 대상 아님", () => {
    expect(findUnwiredHooks(["README.md", "helper.mjs"], "{}")).toEqual([]);
  });

  it("다중 미배선 = 알파벳 정렬 반환", () => {
    expect(findUnwiredHooks(["b.sh", "a.sh", "c.sh"], '{"x":"c.sh"}')).toEqual(["a.sh", "b.sh"]);
  });

  it("훅 0건이면 빈 배열", () => {
    expect(findUnwiredHooks([], "{}")).toEqual([]);
  });
});

describe("실제 레포 배선 상태 (회귀 가드)", () => {
  it(".claude/hooks/*.sh 전부 settings.json 에 배선돼 있다", async () => {
    const files = await readdir(".claude/hooks");
    const settingsText = await readFile(".claude/settings.json", "utf-8");
    expect(findUnwiredHooks(files, settingsText)).toEqual([]);
  });
});
