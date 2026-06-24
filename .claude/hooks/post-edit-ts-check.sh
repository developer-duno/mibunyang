#!/bin/bash
# PostToolUse hook — TS/TSX 편집 시 eslint 단일 파일만 (비차단, 빠름)
#
# 입력: stdin JSON ({tool_input: {file_path: ...}, tool_name: ..., ...})
# 동작: file_path 가 .ts/.tsx 면 eslint <file> 만 (전역 tsc 는 Stop hook 으로 이동)
# 출력: stderr 로 마지막 5줄만 (Claude transcript 가독성)
# 종료: 항상 exit 0 (비차단 경고)
#
# 세션 439 감사: 전역 tsc(5~10초)를 매 편집마다 돌려 편집 흐름을 막던 문제 →
#   tsc 는 Stop hook(세션 끝 1회)으로 이동, PostToolUse 는 eslint 단일 파일만 (즉시).

set +e

INPUT=$(cat)

# stdin JSON 에서 file_path 추출 (jq 없으므로 node 사용)
FP=$(node -e "
let d='';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d);
    const fp = (j.tool_input && j.tool_input.file_path) || '';
    process.stdout.write(fp);
  } catch (e) {
    process.stdout.write('');
  }
});
" <<< "$INPUT" 2>/dev/null)

# 비-TS 파일이면 즉시 종료
case "$FP" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd /f/mibunyang || exit 0

# TS/TSX 편집 마커 — Stop hook 이 이 마커가 있을 때만 전역 tsc 1회 실행 (세션 439).
mkdir -p .claude && touch .claude/.ts-dirty

# eslint 단일 파일 (즉시 — 전역 tsc 는 Stop hook 으로 이동, 세션 439 감사)
ESLINT_OUT=$(npx eslint "$FP" 2>&1)
ESLINT_RC=$?
if [ "$ESLINT_RC" -ne 0 ]; then
  echo "[ts-check] eslint 경고 ($FP):" >&2
  echo "$ESLINT_OUT" | tail -5 >&2
fi

exit 0
