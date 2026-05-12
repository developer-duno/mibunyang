#!/bin/bash
# naver-collect.py 완료 후 자동 실행 스크립트
# 사용법: naver-collect.py 완료 후 자동 실행되도록 설정
#   bash scripts/post-naver-collect.sh

set -e
cd "$(dirname "$0")/.."

echo "[post-naver] === 후속 수집 시작 $(date) ==="

# 1. sync-naver-complex (22개 필드 동기화)
echo "[post-naver] 1/4 sync-naver-complex.mjs 실행..."
node scripts/collectors/sync-naver-complex.mjs
echo "[post-naver] 1/4 완료"

# 2. molit-units (세대수 보정 — 국토부 공동주택 API)
# 세션89: 네이버 IP 차단으로 naver-units 폐기 → molit-units 단독 사용 (세션 233 영구 제거)
echo "[post-naver] 2/4 molit-units.mjs 실행..."
if node scripts/collectors/molit-units.mjs; then
  echo "[post-naver] 2/4 완료"
else
  echo "[post-naver] 2/4 molit-units 실패 (비치명적, 계속 진행)"
fi

# 3. collect-unsold-kosis (KOSIS 비례배분)
echo "[post-naver] 3/4 collect-unsold-kosis.mjs 실행..."
node scripts/collectors/collect-unsold-kosis.mjs
echo "[post-naver] 3/4 완료"

# 4. compute-scores (cats_cache 최종 갱신)
echo "[post-naver] 4/4 compute-scores.mjs 실행..."
node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs
echo "[post-naver] 4/4 완료"

echo "[post-naver] === 모든 후속 수집 완료 $(date) ==="
