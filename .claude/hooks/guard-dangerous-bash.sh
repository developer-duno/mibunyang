#!/bin/bash
# PreToolUse(Bash) hook — 위험 Bash 명령 차단 (exit 2 = 차단, stderr → Claude)
#
# 차단 대상 (감사 리포트 세션 439 — deny 정책 보강):
#   1. main/master 브랜치 직접 push (feature 브랜치 강제)
#   2. prebuild 산출물 public/data/*.json 커밋 (CLAUDE.md 산문 경고 → 강제)
#
# 입력: stdin JSON ({tool_name, tool_input:{command}})  — jq 없으므로 node 파싱
# 차단: exit 2 + stderr 사유  /  통과: exit 0
# 공식 메커니즘: code.claude.com/docs/en/hooks (PreToolUse exit 2 = Blocks the tool call)

set +e
INPUT=$(cat)

CMD=$(node -e "
let d='';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write((j.tool_input && j.tool_input.command) || '');
  } catch (e) { process.stdout.write(''); }
});
" <<< "$INPUT" 2>/dev/null)

[ -z "$CMD" ] && exit 0

# ── 1. main/master 직접 push 차단 ──────────────────────
# git push ... origin main / master (HEAD:main 포함). feature 브랜치 → PR 흐름 강제.
if echo "$CMD" | grep -qE 'git[[:space:]]+push'; then
  if echo "$CMD" | grep -qE '(origin[[:space:]]+(main|master)|(main|master)[[:space:]]*$|HEAD:(main|master)|:(main|master)\b)'; then
    echo "[guard] main/master 직접 push 차단 — feature 브랜치 만들고 PR 로 머지하세요 (감사 세션 439)." >&2
    exit 2
  fi
fi

# ── 2. prebuild 산출물 public/data/*.json 커밋 차단 ────────
# build/prebuild 가 재생성하는 JSON (gitignore 안 됨). git add public/data ... 차단.
if echo "$CMD" | grep -qE 'git[[:space:]]+add'; then
  if echo "$CMD" | grep -qE 'public/data'; then
    echo "[guard] public/data/*.json 은 prebuild 산출물 — 커밋 금지 (git checkout public/data 로 원복). 감사 세션 439." >&2
    exit 2
  fi
fi

exit 0
