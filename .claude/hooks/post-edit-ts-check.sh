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

# 레포 루트 = 이 스크립트(.claude/hooks/) 기준 두 단계 위.
# 세션 485: `cd /f/mibunyang` 절대경로 하드코딩이었음 — 레포를 다른 드라이브/경로로 옮기면
# cd 가 실패해 훅이 조용히 무력화된다(세션 485 "죽은 훅" 사고와 같은 실패 유형).
#
# ⚠️ 센티널이 필요한 이유 (세션 485 적대검증 지적):
# BASH_SOURCE 가 빈 값으로 전개되는 셸에서는 dirname "" → "." → cd "./../.." 가
# **rc=0 으로 성공**한다. 즉 `|| exit 0` 이 못 잡고, 그대로 진행하면 아래
# `touch .claude/.ts-dirty` 가 엉뚱한 상위 디렉토리에 파일을 만든다.
# 옛 하드코딩은 실패 시 아무것도 안 하는 fail-closed 였으므로, 센티널 없이는
# 그 한 경로만 옛것보다 나빠진다. package.json 존재로 "진짜 레포 루트"를 확인한다.
SELF="${BASH_SOURCE[0]:-$0}"
ROOT=$(cd "$(dirname "$SELF")/../.." 2>/dev/null && pwd) || exit 0
[ -f "$ROOT/package.json" ] || exit 0
cd "$ROOT" || exit 0

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
