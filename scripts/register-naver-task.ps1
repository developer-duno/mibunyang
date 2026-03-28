# 네이버 수집 Windows 작업 스케줄러 등록 스크립트
# 관리자 권한 PowerShell에서 실행:
#   powershell -ExecutionPolicy Bypass -File scriptsegister-naver-task.ps1

$TaskName = "MibunyangNaverCollect"
$ScriptPath = (Resolve-Path "scriptsun-naver-local.bat").Path
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

# 등록 (현재 사용자)
Register-ScheduledTask `
    -TaskName $TaskName `
    -Trigger $Trigger `
    -Action $Action `
    -Settings $Settings `
    -Description "미분양 네이버 부동산 수집 (주 2회: 월/목 08:00)" `
    -RunLevel Highest

Write-Host "작업 등록 완료: $TaskName"
Write-Host "  스케줄: 매주 월/목 오전 8시"
Write-Host "  스크립트: $ScriptPath"
Write-Host ""
Write-Host "확인: Get-ScheduledTask -TaskName $TaskName | Format-List"
Write-Host "수동 실행: Start-ScheduledTask -TaskName $TaskName"
Write-Host "삭제: Unregister-ScheduledTask -TaskName $TaskName"
