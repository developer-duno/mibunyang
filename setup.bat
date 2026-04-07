@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

echo ============================================
echo   미분양 아파트 비교 엔진 - 개발 환경 세팅
echo ============================================
echo.

:: 현재 스크립트 위치 = 프로젝트 루트
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo [1/7] 프로젝트 경로: %PROJECT_DIR%
echo.

:: -----------------------------------------------
:: 2. Node.js 확인
:: -----------------------------------------------
echo [2/7] Node.js 확인...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [오류] Node.js가 설치되어 있지 않습니다.
    echo   https://nodejs.org 에서 LTS 버전을 설치해주세요.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo   Node.js %NODE_VER% 감지됨
echo.

:: -----------------------------------------------
:: 3. Git 확인 + safe.directory 설정
:: -----------------------------------------------
echo [3/7] Git 확인 + 외장 SSD safe.directory 설정...
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [오류] Git이 설치되어 있지 않습니다.
    echo   https://git-scm.com 에서 설치해주세요.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('git --version') do set "GIT_VER=%%v"
echo   %GIT_VER% 감지됨

:: 외장 SSD 핵심: dubious ownership 방지
set "SAFE_DIR=%PROJECT_DIR:\=/%"
git config --global --get-all safe.directory | findstr /i "%SAFE_DIR%" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    git config --global --add safe.directory "%SAFE_DIR%"
    echo   safe.directory 추가됨: %SAFE_DIR%
) else (
    echo   safe.directory 이미 등록됨
)

:: git 사용자 정보 확인
git config user.name >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   [주의] Git 사용자 정보가 없습니다. 아래 명령어로 설정하세요:
    echo     git config --global user.name "이름"
    echo     git config --global user.email "이메일"
)
echo.

:: -----------------------------------------------
:: 4. npm install
:: -----------------------------------------------
echo [4/7] npm 패키지 설치...
cd /d "%PROJECT_DIR%"
if not exist "node_modules" (
    echo   node_modules 없음 - npm install 실행중...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo   [오류] npm install 실패
        pause
        exit /b 1
    )
    echo   npm install 완료
) else (
    echo   node_modules 존재 - 업데이트 확인중...
    call npm install --prefer-offline
    echo   패키지 동기화 완료
)
echo.

:: -----------------------------------------------
:: 5. VS Code 확인 + 확장 프로그램 설치
:: -----------------------------------------------
echo [5/7] VS Code 확장 프로그램 설치...
where code >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [스킵] VS Code CLI(code)를 찾을 수 없습니다.
    echo   VS Code를 설치하거나, PATH에 추가해주세요.
    echo   (VS Code 열고 Ctrl+Shift+P → "Shell Command: Install 'code'" 실행)
    echo.
    goto :skip_extensions
)

:: extensions.json에서 권장 확장 자동 설치
set "EXT_FILE=%PROJECT_DIR%\.vscode\extensions.json"
if exist "%EXT_FILE%" (
    for /f "usebackq tokens=*" %%a in (`findstr /r "\"[a-zA-Z]" "%EXT_FILE%"`) do (
        set "line=%%a"
        set "line=!line:"=!"
        set "line=!line:,=!"
        set "line=!line: =!"
        if not "!line!"=="" if not "!line:~0,2!"=="//" (
            echo   설치중: !line!
            code --install-extension !line! --force >nul 2>&1
        )
    )
    echo   확장 프로그램 설치 완료
) else (
    echo   [스킵] .vscode/extensions.json 파일 없음
)
:skip_extensions
echo.

:: -----------------------------------------------
:: 6. 빌드 테스트
:: -----------------------------------------------
echo [6/7] 빌드 검증...
cd /d "%PROJECT_DIR%"
call npx vite build >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   빌드 성공!
) else (
    echo   [경고] 빌드 실패 - 환경변수 누락일 수 있습니다.
    echo   .env 파일을 확인해주세요.
)
echo.

:: -----------------------------------------------
:: 7. 환경변수 확인
:: -----------------------------------------------
echo [7/7] 환경변수 체크...
set "ENV_FILE=%PROJECT_DIR%\.env"
if exist "%ENV_FILE%" (
    echo   .env 파일 존재함
) else (
    echo   [주의] .env 파일이 없습니다. 필요한 환경변수:
    echo     VITE_SUPABASE_URL=...
    echo     VITE_SUPABASE_ANON_KEY=...
    echo     VITE_USE_SUPABASE=true
    echo   .env.example 또는 Vercel 대시보드에서 값을 복사하세요.
)
echo.

:: -----------------------------------------------
:: 완료 요약
:: -----------------------------------------------
echo ============================================
echo   세팅 완료!
echo ============================================
echo.
echo   개발 서버 시작:  npm run dev
echo   빌드:           npm run build
echo   테스트:          npm test
echo   E2E 테스트:      npm run test:e2e
echo   린트:           npm run lint
echo.
echo   VS Code 열기:   code "%PROJECT_DIR%"
echo.
pause
