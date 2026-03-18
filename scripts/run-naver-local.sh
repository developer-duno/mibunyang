#!/bin/bash
# 네이버 부동산 수집 — 로컬 실행 스크립트
# 한국 IP에서만 동작 (GitHub Actions 미국 IP 차단됨)
#
# 사용법:
#   bash scripts/run-naver-local.sh              # 전체 수집
#   bash scripts/run-naver-local.sh --limit=10   # 10개 단지만
#   bash scripts/run-naver-local.sh --dry-run    # DB 미저장 테스트

set -e
cd "$(dirname "$0")/.."

# .env.local에서 환경변수 로드
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

echo "=== 1/3 네이버 매물 수집 ==="
node scripts/collectors/naver-listings.mjs "$@"

echo ""
echo "=== 2/3 네이버→아파트 동기화 ==="
node scripts/collectors/sync-naver-complex.mjs

echo ""
echo "=== 3/3 네이버 세대수 보정 ==="
node scripts/collectors/naver-units.mjs "$@"

echo ""
echo "=== 4/4 전용률 계산 ==="
node scripts/collectors/calc-exclusive-ratio.mjs

echo ""
echo "✅ 네이버 수집 파이프라인 완료"
