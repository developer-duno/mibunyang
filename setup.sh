#!/usr/bin/env bash
set -euo pipefail

echo "============================================"
echo "  미분양 아파트 비교 엔진 - 개발 환경 세팅"
echo "============================================"
echo

# 프로젝트 루트 = 이 스크립트의 위치
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[1/7] 프로젝트 경로: $PROJECT_DIR"
echo

# -----------------------------------------------
# 2. Node.js 확인
# -----------------------------------------------
echo "[2/7] Node.js 확인..."
if ! command -v node &>/dev/null; then
    echo "  [오류] Node.js가 설치되어 있지 않습니다."
    echo "  https://nodejs.org 에서 LTS 버전을 설치해주세요."
    exit 1
fi
echo "  Node.js $(node --version) 감지됨"
echo

# -----------------------------------------------
# 3. Git 확인 + safe.directory
# -----------------------------------------------
echo "[3/7] Git 확인 + 외장 SSD safe.directory 설정..."
if ! command -v git &>/dev/null; then
    echo "  [오류] Git이 설치되어 있지 않습니다."
    exit 1
fi
echo "  $(git --version) 감지됨"

# 외장 SSD 핵심: dubious ownership 방지
if ! git config --global --get-all safe.directory 2>/dev/null | grep -qiF "$PROJECT_DIR"; then
    git config --global --add safe.directory "$PROJECT_DIR"
    echo "  safe.directory 추가됨: $PROJECT_DIR"
else
    echo "  safe.directory 이미 등록됨"
fi

# git 사용자 정보 확인
if ! git config user.name &>/dev/null; then
    echo
    echo "  [주의] Git 사용자 정보가 없습니다:"
    echo '    git config --global user.name "이름"'
    echo '    git config --global user.email "이메일"'
fi
echo

# -----------------------------------------------
# 4. npm install
# -----------------------------------------------
echo "[4/7] npm 패키지 설치..."
cd "$PROJECT_DIR"
if [ ! -d "node_modules" ]; then
    echo "  node_modules 없음 - npm install 실행중..."
    npm install
    echo "  npm install 완료"
else
    echo "  node_modules 존재 - 업데이트 확인중..."
    npm install --prefer-offline
    echo "  패키지 동기화 완료"
fi
echo

# -----------------------------------------------
# 5. VS Code 확장 프로그램 설치
# -----------------------------------------------
echo "[5/7] VS Code 확장 프로그램 설치..."
if ! command -v code &>/dev/null; then
    echo "  [스킵] VS Code CLI(code)를 찾을 수 없습니다."
else
    EXT_FILE="$PROJECT_DIR/.vscode/extensions.json"
    if [ -f "$EXT_FILE" ]; then
        grep -oP '"[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z0-9._-]+"' "$EXT_FILE" | tr -d '"' | while read -r ext; do
            echo "  설치중: $ext"
            code --install-extension "$ext" --force >/dev/null 2>&1 || true
        done
        echo "  확장 프로그램 설치 완료"
    fi
fi
echo

# -----------------------------------------------
# 6. 빌드 테스트
# -----------------------------------------------
echo "[6/7] 빌드 검증..."
cd "$PROJECT_DIR"
if npx vite build >/dev/null 2>&1; then
    echo "  빌드 성공!"
else
    echo "  [경고] 빌드 실패 - 환경변수 누락일 수 있습니다."
fi
echo

# -----------------------------------------------
# 7. 환경변수 확인
# -----------------------------------------------
echo "[7/7] 환경변수 체크..."
if [ -f "$PROJECT_DIR/.env" ]; then
    echo "  .env 파일 존재함"
else
    echo "  [주의] .env 파일이 없습니다. 필요한 환경변수:"
    echo "    VITE_SUPABASE_URL=..."
    echo "    VITE_SUPABASE_ANON_KEY=..."
    echo "    VITE_USE_SUPABASE=true"
fi
echo

# -----------------------------------------------
# 완료
# -----------------------------------------------
echo "============================================"
echo "  세팅 완료!"
echo "============================================"
echo
echo "  개발 서버 시작:  npm run dev"
echo "  빌드:           npm run build"
echo "  테스트:          npm test"
echo "  E2E 테스트:      npm run test:e2e"
echo "  린트:           npm run lint"
echo
echo "  VS Code 열기:   code \"$PROJECT_DIR\""
