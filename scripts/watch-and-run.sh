#!/bin/bash
# naver-collect.py 프로세스 완료 감시 + 자동 후속 실행
# 사용법: bash scripts/watch-and-run.sh
#
# naver-collect.py가 끝나면 post-naver-collect.sh를 자동 실행합니다.

cd "$(dirname "$0")/.."

echo "[watch] naver-collect.py 완료 대기 중..."
echo "[watch] 30초마다 프로세스 확인합니다."

while true; do
  # Python naver-collect 프로세스 확인
  if ! pgrep -f "naver-collect.py" > /dev/null 2>&1; then
    echo "[watch] naver-collect.py 완료 감지! $(date)"
    echo "[watch] 후속 수집 시작..."
    bash scripts/post-naver-collect.sh 2>&1 | tee scripts/post-naver-collect.log
    echo "[watch] 모든 작업 완료. $(date)"
    exit 0
  fi
  sleep 30
done
