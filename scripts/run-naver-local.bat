@echo off
setlocal enabledelayedexpansion
chcp 65001 >/dev/null
echo [%date% %time%] 네이버 수집 시작 >> "%~dp0..
aver-collect.log"

cd /d "%~dp0.."

:: .env.local 환경변수 로드
if exist .env.local (
  for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
    set "line=%%a"
    if not "!line:~0,1!"=="#" (
      set "%%a=%%b"
    )
  )
)

echo === 1/5 네이버 매물 수집 (Python) ===
python scripts/collectors/naver-collect.py
if errorlevel 1 (
  echo [%date% %time%] ERROR: naver-collect.py 실패 >> "%~dp0..\naver-collect.log"
  exit /b 1
)

echo === 2/5 네이버→아파트 동기화 ===
call node scripts/collectors/sync-naver-complex.mjs
if errorlevel 1 (
  echo [%date% %time%] ERROR: sync-naver-complex.mjs 실패 >> "%~dp0..\naver-collect.log"
  exit /b 1
)

echo === 3/5 네이버 세대수 보정 ===
call node scripts/collectors/naver-units.mjs
if errorlevel 1 (
  echo [%date% %time%] ERROR: naver-units.mjs 실패 >> "%~dp0..\naver-collect.log"
  exit /b 1
)

echo === 4/5 전용률 계산 ===
call node scripts/collectors/calc-exclusive-ratio.mjs
if errorlevel 1 (
  echo [%date% %time%] ERROR: calc-exclusive-ratio.mjs 실패 >> "%~dp0..\naver-collect.log"
  exit /b 1
)

echo === 5/5 스코어 재계산 ===
call node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs
if errorlevel 1 (
  echo [%date% %time%] WARNING: compute-scores.mjs 실패 (비필수) >> "%~dp0..\naver-collect.log"
)

echo [%date% %time%] 네이버 수집 완료 >> "%~dp0..
aver-collect.log"
echo 완료!
