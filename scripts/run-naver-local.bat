@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0.."
set "LOG=%~dp0..\naver-collect.log"
set "PYLOG=%~dp0..\naver-collect-py.log"
echo [%date% %time%] naver collect start >> "%LOG%"

REM env is loaded by each step itself (naver-collect.py has its own .env.local parser;
REM every .mjs calls _shared.mjs loadEnv). No batch env pre-load needed.
REM Session 470 fix: the old "for /f delims==" loop mis-parsed .env.local and poisoned
REM os.environ with truncated values -> Python kept them (only-if-unset) -> SUPABASE
REM missing -> exit 1 -> whole pipeline failed. Removed. Also converted file to CRLF and
REM ASCII-only comments (chcp 65001 + Korean :: comments made cmd.exe mis-parse lines).

REM Session 518: every step redirects stdout+stderr to a log file. The scheduler runs
REM this .bat with no arguments (task MibunyangNaverCollect: Command=run-naver-local.bat,
REM no redirect), so console output went nowhere and a failing step left only a one-line
REM "ERROR: ... failed" with no reason. The 2026-08-14 step-2 failure is unrecoverable
REM for exactly that reason. Step 1 (Python) writes to its own file because it prints
REM per-complex lines that would otherwise bury the step markers in the main log.
REM Timestamps on the step markers also show where the time went (step 1 is capped at
REM 120 min and the whole task is capped at 4h by ExecutionTimeLimit).
REM Sibling runners kosis-local-runner.bat / childcare-local-runner.bat already do this.
REM run-naver-local.sh is intentionally left alone: it is the hand-run path where the
REM operator watches the console, so redirecting would hide progress.

echo === 1/6 naver listing collect (Python) ===
echo [%date% %time%] === 1/6 naver listing collect (Python) === >> "%LOG%"
REM Session 118: use MIBUNYANG_PYTHON if set, else py -3 (avoid Windows Store stub loop).
if defined MIBUNYANG_PYTHON (
  set "PY_CMD=%MIBUNYANG_PYTHON%"
) else (
  set "PY_CMD=py -3"
)
REM --max-minutes: cap step 1 so steps 2-6 always get to run (see scripts/CLAUDE.md, session 493).
%PY_CMD% scripts/collectors/naver-collect.py --max-minutes=120 >> "%PYLOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: naver-collect.py failed - reason in naver-collect-py.log >> "%LOG%"
  exit /b 1
)

echo === 2/6 sync naver to apartments ===
echo [%date% %time%] === 2/6 sync naver to apartments === >> "%LOG%"
call node scripts/collectors/sync-naver-complex.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: sync-naver-complex.mjs failed >> "%LOG%"
  exit /b 1
)

echo === 3/6 naver presale info (pre.land) ===
echo [%date% %time%] === 3/6 naver presale info (pre.land) === >> "%LOG%"
call node scripts/collectors/naver-presale.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARNING: naver-presale.mjs failed - non-fatal >> "%LOG%"
)
REM reset errorlevel so a non-fatal WARNING above does not fail the next step
verify >nul

echo === 4/6 units correction (molit-units) ===
echo [%date% %time%] === 4/6 units correction (molit-units) === >> "%LOG%"
call node scripts/collectors/molit-units.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARNING: molit-units.mjs failed - non-fatal >> "%LOG%"
)
REM reset errorlevel
verify >nul

echo === 5/6 exclusive ratio ===
echo [%date% %time%] === 5/6 exclusive ratio === >> "%LOG%"
call node scripts/collectors/calc-exclusive-ratio.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: calc-exclusive-ratio.mjs failed >> "%LOG%"
  exit /b 1
)

echo === 6/6 recompute scores ===
echo [%date% %time%] === 6/6 recompute scores === >> "%LOG%"
call node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARNING: compute-scores.mjs failed - non-fatal >> "%LOG%"
)

echo [%date% %time%] naver collect done >> "%LOG%"
echo Done!
