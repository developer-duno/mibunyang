@echo off
:: childcare 로컬 러너 진입점 — Windows 작업 스케줄러 MibunyangChildcareLocal (매일 04:30 KST) 가 실행.
:: 러너가 loadEnv() 로 .env.local/.env 를 직접 로드하므로 여기선 cd + 로그 리다이렉션만.
:: 로그 리다이렉션 필수 — 스케줄러 컨텍스트의 stdio 는 소실됨 (kosis-local-runner.bat 답습).
chcp 65001 >nul
cd /d "%~dp0.."
echo [%date% %time%] childcare 로컬 러너 시작 >> childcare-local.log
node scripts\childcare-local-runner.mjs >> childcare-local.log 2>&1
if errorlevel 1 echo [%date% %time%] ERROR: childcare-local-runner 실패 (exit %errorlevel%) >> childcare-local.log
