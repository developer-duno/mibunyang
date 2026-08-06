@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0.."
set "LOG=%~dp0..\naver-collect.log"
echo [%date% %time%] naver collect start >> "%LOG%"

REM env is loaded by each step itself (naver-collect.py has its own .env.local parser;
REM every .mjs calls _shared.mjs loadEnv). No batch env pre-load needed.
REM Session 470 fix: the old "for /f delims==" loop mis-parsed .env.local and poisoned
REM os.environ with truncated values -> Python kept them (only-if-unset) -> SUPABASE
REM missing -> exit 1 -> whole pipeline failed. Removed. Also converted file to CRLF and
REM ASCII-only comments (chcp 65001 + Korean :: comments made cmd.exe mis-parse lines).

echo === 1/6 naver listing collect (Python) ===
REM Session 118: use MIBUNYANG_PYTHON if set, else py -3 (avoid Windows Store stub loop).
if defined MIBUNYANG_PYTHON (
  set "PY_CMD=%MIBUNYANG_PYTHON%"
) else (
  set "PY_CMD=py -3"
)
REM --max-minutes: cap step 1 so steps 2-6 always get to run (see scripts/CLAUDE.md, session 493).
%PY_CMD% scripts/collectors/naver-collect.py --max-minutes=120
if errorlevel 1 (
  echo [%date% %time%] ERROR: naver-collect.py failed >> "%LOG%"
  exit /b 1
)

echo === 2/6 sync naver to apartments ===
call node scripts/collectors/sync-naver-complex.mjs
if errorlevel 1 (
  echo [%date% %time%] ERROR: sync-naver-complex.mjs failed >> "%LOG%"
  exit /b 1
)

echo === 3/6 naver presale info (pre.land) ===
call node scripts/collectors/naver-presale.mjs
if errorlevel 1 (
  echo [%date% %time%] WARNING: naver-presale.mjs failed (non-fatal) >> "%LOG%"
)
REM reset errorlevel so a non-fatal WARNING above does not fail the next step
verify >nul

echo === 4/6 units correction (molit-units) ===
call node scripts/collectors/molit-units.mjs
if errorlevel 1 (
  echo [%date% %time%] WARNING: molit-units.mjs failed (non-fatal) >> "%LOG%"
)
REM reset errorlevel
verify >nul

echo === 5/6 exclusive ratio ===
call node scripts/collectors/calc-exclusive-ratio.mjs
if errorlevel 1 (
  echo [%date% %time%] ERROR: calc-exclusive-ratio.mjs failed >> "%LOG%"
  exit /b 1
)

echo === 6/6 recompute scores ===
call node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs
if errorlevel 1 (
  echo [%date% %time%] WARNING: compute-scores.mjs failed (non-fatal) >> "%LOG%"
)

echo [%date% %time%] naver collect done >> "%LOG%"
echo Done!
