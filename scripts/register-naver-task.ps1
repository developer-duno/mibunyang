# 네이버 수집 Windows 작업 스케줄러 등록 스크립트
# 관리자 권한 PowerShell에서 실행:
#   powershell -ExecutionPolicy Bypass -File scripts\register-naver-task.ps1

$TaskName = "MibunyangNaverCollect"
$ScriptPath = (Resolve-Path "scripts\run-naver-local.bat").Path
$WorkDir = (Resolve-Path ".").Path

# 기존 작업 삭제
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 트리거: 매주 월/목 오전 8시 (naver-estate-web interval 크롤링과 시간 분리)
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Thursday -At 8:00AM

# 액션: 배치 스크립트 실행
$Action = New-ScheduledTaskAction -Execute $ScriptPath -WorkingDirectory $WorkDir

# 설정: PC 깨어있을 때만, 최대 2시간
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

# 실행 주체: 현재 로그인 사용자 + 최소 권한 (RunLevel Limited)
#   네이버 수집 6단계(naver-collect.py + .mjs 5개)는 HTTP fetch + Supabase upsert + 산술뿐.
#   레지스트리/서비스 제어/시스템 디렉토리 쓰기 없음 → 관리자 상승(Highest) 불필요 = 최소 권한 원칙.
#   LogonType Interactive 라 PC 로그인 상태에서만 발화 — 같은 PC 의 naver-units-night /
#   LuxuryResale_* 작업이 이미 Interactive+Limited 로 정상 동작 중(실증). 네이버 수집은
#   한국 IP 로컬 PC 가 켜져 있어야만 의미가 있으므로 무인 부팅 실행 요건도 없음.
$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

# 등록 (현재 사용자, 최소 권한)
Register-ScheduledTask `
    -TaskName $TaskName `
    -Trigger $Trigger `
    -Action $Action `
    -Settings $Settings `
    -Principal $Principal `
    -Description "미분양 네이버 부동산 수집 (주 2회: 월/목 08:00)"

Write-Host "작업 등록 완료: $TaskName"
Write-Host "  스케줄: 매주 월/목 오전 8시"
Write-Host "  권한: Limited (최소 권한) / LogonType: Interactive (로그인 상태에서 발화)"
Write-Host "  스크립트: $ScriptPath"
Write-Host ""
Write-Host "확인: Get-ScheduledTask -TaskName $TaskName | Format-List"
Write-Host "수동 실행: Start-ScheduledTask -TaskName $TaskName"
Write-Host "삭제: Unregister-ScheduledTask -TaskName $TaskName"
