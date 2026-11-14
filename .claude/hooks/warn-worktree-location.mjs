// PreToolUse(Bash|PowerShell|EnterWorktree) hook — 작업 폴더 위치 경고 (막지 않음 · exit 0)
//
// 규칙: 작업반 워크트리는 `.omc/wt/<이름>` (WORK_RULES.md 「작업반 워크트리 위치」 · 세션695~).
// `.claude/worktrees/` 에 만들면 VS Code 가 쥔 빈 폴더 잔재가 남는다(세션705·706·709 반복 · BACKLOG A-26 ㉔).
// 👤 2026-11-14 결정 = 「경고만 띄우기」 → permissionDecision 을 내지 않고 systemMessage(사장님 눈) +
// additionalContext(Claude 눈)만 낸다. 공식 형식 = code.claude.com/docs/en/hooks (PreToolUse · exit 0 + JSON).
// 고장 나도 도구 호출을 막지 않게 모든 오류는 조용히 exit 0.

// `git … worktree add [옵션] <경로>` 의 <경로>(첫 위치 인자)가 .claude/worktrees 아래일 때만 참.
// 명령 글자 어딘가에 두 낱말이 따로 있는 것(커밋 메시지 printf 등)은 헛경고였다(세션714 · ㉔ 남은 것).
const OPT_WITH_VALUE = new Set(["-b", "-B", "--reason"]);
function gitAddsUnderClaudeWorktrees(cmd) {
  for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
    const m = seg.match(/(?:^|\s)git\b.*?\bworktree\s+add\s+(.*)$/i);
    if (!m) continue;
    const toks = m[1].trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ""));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (OPT_WITH_VALUE.has(t)) { i++; continue; }
      if (t.startsWith("-")) continue;
      if (/(?:^|[\\/])\.claude[\\/]+worktrees(?:[\\/]|$)/i.test(t)) return true;
      break;
    }
  }
  return false;
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(raw);
    const tool = j.tool_name ?? "";
    const cmd = String(j.tool_input?.command ?? "");
    const viaGit = gitAddsUnderClaudeWorktrees(cmd);
    // EnterWorktree 는 `name`(새로 만들기)일 때만 `.claude/worktrees/` 아래에 만든다 —
    // `path`(이미 있는 워크트리로 들어가기, 예: .omc/wt/<이름>)는 새 폴더를 안 만드니 경고 안 함
    const viaTool = tool === "EnterWorktree" && !j.tool_input?.path;
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
