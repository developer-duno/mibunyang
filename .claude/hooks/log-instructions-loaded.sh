#!/bin/bash
# InstructionsLoaded hook — 무엇이 언제 로드됐는지 기록만 한다 (문서 다이어트 2단계 실측 검증용)
#
# 왜 필요한가 (세션551 → 552):
#   .claude/rules/ 22개 중 8개에 paths frontmatter 를 붙여 "그 파일을 읽을 때만" 로드되게 바꿨다.
#   상시 로드가 179KB → 107KB 로 줄었지만, "정말 필요할 때 불려오는가" 는 아직 안 쟀다.
#   특히 이 레포는 파일을 안 열고 node -e 로 DB 만 만지는 세션이 많아,
#   그런 세션에서 on-demand 규칙이 한 장도 안 불려올 위험이 있다 (doc-diet 스킬 §"가장 중요한 함정").
#
# 원칙:
#   - 기록만 한다. 어떤 경우에도 작업을 막지 않는다 (항상 exit 0).
#   - stdin 으로 오는 훅 페이로드를 그대로 한 줄 JSON 으로 남긴다 (가공하면 무엇이 왔는지 모르게 된다).
#   - 로그는 git 미추적 (.claude/.instructions-loaded.log) — 측정용 일회성 자산.
#
# 제거: .claude/settings.json 의 InstructionsLoaded 블록을 지우면 끝 (이 파일은 남아도 무해).

set -u

LOG_DIR=".claude"
LOG_FILE="$LOG_DIR/.instructions-loaded.log"

mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

# stdin 페이로드 (없거나 읽기 실패해도 진행)
PAYLOAD=$(cat 2>/dev/null || true)

# 한 줄 = 한 로드 이벤트. 앞에 시각·세션 구분자를 붙여 나중에 세션별로 가를 수 있게.
{
  printf '%s\t%s\t%s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
    "${CLAUDE_SESSION_ID:-unknown}" \
    "$(printf '%s' "$PAYLOAD" | tr -d '\n\r')"
} >> "$LOG_FILE" 2>/dev/null

exit 0
