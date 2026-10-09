#!/usr/bin/env bash
# 2u(naver-estate-web) 가 이쪽에 남긴 공유 DB 통보 이슈 중 안 읽은(열린) 것을 세션 시작 때 보여 준다 (세션617).
# 설계서 docs/superpowers/specs/2026-10-09-shared-db-ownership-registry-design.md §3-3 — 닫음 = 읽음.
# 0건이면 아무것도 출력하지 않는다. gh 가 실패하면 조용히 넘어가지 않고 "확인 못 함" 한 줄.
# 배선 = .claude/settings.json SessionStart(matcher startup · timeout 10) — resume·compact 때는 안 부른다.
REPO="developer-duno/naver-estate-web"

open_line=$(gh issue list -R "$REPO" --label cross-repo-notice --state open --json number,title --limit 20 \
  --jq '"\(length)\t\(.[0:3] | map("#\(.number) \(.title)") | join(" · "))"' 2>/dev/null) || {
  echo "📬 2u 통보 확인 못 함(gh 오류)"
  exit 0
}
stale=$(gh issue list -R "$REPO" --label stale-unread --state closed --json closedAt --limit 50 \
  --jq '[.[] | select((.closedAt | fromdateiso8601) > (now - 14*86400))] | length' 2>/dev/null) || stale=0

n=${open_line%%$'\t'*}
titles=${open_line#*$'\t'}
[ -z "$n" ] && n=0
[ -z "$stale" ] && stale=0

if [ "$n" -gt 0 ] || [ "$stale" -gt 0 ]; then
  extra=""
  [ "$stale" -gt 0 ] && extra=" · 14일 넘어 닫힘 ${stale}건"
  echo "📬 2u 통보 ${n}건(안 읽음${extra}): ${titles}"
fi
exit 0
