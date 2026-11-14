// .claude/hooks/warn-worktree-location.mjs — 경고가 필요한 때만 울리는지(BACKLOG A-26 ㉔ 남은 것 · 세션714)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/hooks/warn-worktree-location.mjs");

/** @param {unknown} input */
function run(input) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
  return { code: r.status, warned: r.stdout.includes("작업 폴더 위치 경고") };
}
const bash = (/** @type {string} */ command) => run({ tool_name: "Bash", tool_input: { command } });

describe("warn-worktree-location 훅", () => {
  it.each([
    "git worktree add .claude/worktrees/s714-x -b s714/x",
    "git worktree add -b s714/x .claude/worktrees/s714-x origin/main",
    'cd /f/mibunyang && git worktree add "F:/mibunyang/.claude/worktrees/s714-x" main',
    "git worktree add --detach .claude\\worktrees\\s714-x",
  ])("규칙 밖 위치에 만들면 경고: %s", (cmd) => {
    expect(bash(cmd)).toEqual({ code: 0, warned: true });
  });

  it.each([
    "git worktree add .omc/wt/s714-x -b s714/x",
    "git worktree add -b claude-worktrees .omc/wt/s714-x",
    'printf "훅: git worktree add 를 .claude/worktrees 에 쓰면 경고\\n" > msg.txt && git commit -F msg.txt',
    "git worktree add .omc/wt/s714-x main && ls .claude/worktrees",
    "git worktree list && rm -r .claude/worktrees/old",
  ])("헛경고 안 함: %s", (cmd) => {
    expect(bash(cmd)).toEqual({ code: 0, warned: false });
  });

  it("EnterWorktree name(새로 만들기)은 경고 · path(이미 있는 것 들어가기)는 경고 안 함", () => {
    expect(run({ tool_name: "EnterWorktree", tool_input: { name: "s714-x" } }).warned).toBe(true);
    expect(run({ tool_name: "EnterWorktree", tool_input: {} }).warned).toBe(true);
    expect(run({ tool_name: "EnterWorktree", tool_input: { path: "F:/mibunyang/.omc/wt/s714-x" } }).warned).toBe(false);
  });

  it("입력이 깨져도 막지 않는다(exit 0)", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
