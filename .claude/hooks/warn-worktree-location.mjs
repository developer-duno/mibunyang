// PreToolUse(Bash|PowerShell|EnterWorktree) hook — 작업 폴더 위치 경고 (막지 않음 · exit 0)
//
// 규칙: 작업반 워크트리는 `.omc/wt/<이름>` (WORK_RULES.md 「작업반 워크트리 위치」 · 세션695~).
// `.claude/worktrees/` 에 만들면 VS Code 가 쥔 빈 폴더 잔재가 남는다(세션705·706·709 반복 · BACKLOG A-26 ㉔).
// 👤 2026-11-14 결정 = 「경고만 띄우기」 → permissionDecision 을 내지 않고 systemMessage(사장님 눈) +
// additionalContext(Claude 눈)만 낸다. 공식 형식 = code.claude.com/docs/en/hooks (PreToolUse · exit 0 + JSON).
// 고장 나도 도구 호출을 막지 않게 모든 오류는 조용히 exit 0.

// `git … worktree add [옵션] <경로>` 의 <경로>(첫 위치 인자)가 .claude/worktrees 아래일 때만 참.
// 명령 글자 어딘가에 두 낱말이 따로 있는 것(커밋 메시지 printf 등)은 헛경고였다(세션714 · ㉔ 남은 것).
// 따옴표 안 글자(커밋 메시지 `-m '… git worktree add .claude/worktrees …'`·echo)는 낱말 하나로 읽어
// 명령으로 치지 않는다 — 검사관 rv-s714 🟠 지적으로 정규식 대신 작은 셸 낱말 쪼개기.
const OPT_WITH_VALUE = new Set(["-b", "-B", "--reason"]);
const GIT_OPT_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const SHELL_PREFIX = new Set(["then", "do", "else", "time", "{", "!", "&"]);

/** 셸 글자를 명령 조각(낱말 배열)들로 — 따옴표·역슬래시·줄 이음을 알고, ; & | 줄바꿈 ( ) $( 에서 조각을 끊는다 */
function shellSegments(cmd) {
  const segs = [];
  let seg = [];
  let tok = null;
  let q = null;
  const endTok = () => { if (tok !== null) seg.push(tok); tok = null; };
  const endSeg = () => { endTok(); if (seg.length) segs.push(seg); seg = []; };
  const s = cmd.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      // 큰따옴표 안 역슬래시는 $ ` " \ 앞에서만 이스케이프(bash 규칙) — 그 밖엔 글자 그대로("F:\…\.claude\worktrees")
      else if (c === "\\" && q === '"' && /[$`"\\]/.test(s[i + 1] ?? "")) tok += s[++i];
      else tok += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; tok = tok ?? ""; continue; }
    // 역슬래시는 따옴표·공백·구분자 앞에서만 이스케이프 — 그 밖엔 글자 그대로(PowerShell·Windows 경로 `.claude\worktrees`)
    if (c === "\\" && i + 1 < s.length && /[\s'"\\;&|()$]/.test(s[i + 1])) { tok = (tok ?? "") + s[++i]; continue; }
    if (/\s/.test(c) && c !== "\n") { endTok(); continue; }
    if (c === "$" && s[i + 1] === "(") { endSeg(); i++; continue; }
    if (";&|\n()".includes(c)) { endSeg(); continue; }
    tok = (tok ?? "") + c;
  }
  endSeg();
  return segs;
}

function gitAddsUnderClaudeWorktrees(cmd) {
  for (const toks of shellSegments(cmd)) {
    let i = 0;
    // 앞 환경 변수 대입 · 셸 꾸밈 낱말(then·do·else·time·{·!) 건너뜀
    while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || SHELL_PREFIX.has(toks[i]))) i++;
    if (!/(?:^|[\\/])git(?:\.exe)?$/i.test(toks[i] ?? "")) continue;
    i++;
    while (i < toks.length && toks[i].startsWith("-")) i += GIT_OPT_WITH_VALUE.has(toks[i]) ? 2 : 1;
    if (toks[i] !== "worktree" || toks[i + 1] !== "add") continue;
    for (i += 2; i < toks.length; i++) {
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
