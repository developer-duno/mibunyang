// PreToolUse(Bash|PowerShell|EnterWorktree) hook — 작업 폴더 위치 경고 (막지 않음 · exit 0)
//
// 규칙: 작업반 워크트리는 `.omc/wt/<이름>` (WORK_RULES.md 「작업반 워크트리 위치」 · 세션695~).
// `.claude/worktrees/` 에 만들면 VS Code 가 쥔 빈 폴더 잔재가 남는다(세션705·706·709 반복 · BACKLOG A-26 ㉔).
// 👤 2026-11-14 결정 = 「경고만 띄우기」 → permissionDecision 을 내지 않고 systemMessage(사장님 눈) +
// additionalContext(Claude 눈)만 낸다. 공식 형식 = code.claude.com/docs/en/hooks (PreToolUse · exit 0 + JSON).
// 고장 나도 도구 호출을 막지 않게 모든 오류는 조용히 exit 0.

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(raw);
    const tool = j.tool_name ?? "";
    const cmd = String(j.tool_input?.command ?? "");
    const viaGit = /\bworktree\s+add\b/i.test(cmd) && /\.claude[\\/]+worktrees/i.test(cmd);
    // EnterWorktree 도구는 늘 `.claude/worktrees/` 아래에 만든다
    const viaTool = tool === "EnterWorktree";
    if (!viaGit && !viaTool) process.exit(0);
    const msg =
      "작업 폴더 위치 경고: 이 레포 규칙은 .omc/wt/<이름> 이에요(.claude/worktrees 는 VS Code 잔재가 남아요 · WORK_RULES.md · BACKLOG A-26 ㉔).";
    process.stdout.write(
      JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            msg +
            " 꼭 이 위치여야 하는 이유가 없으면 `git worktree add .omc/wt/<이름>` 으로 다시 만들고, 만든 직후 safe.directory 등록 + 빈 node_modules mkdir.",
        },
      }),
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
