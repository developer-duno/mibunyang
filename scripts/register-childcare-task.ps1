# childcare 로컬 러너 Windows 작업 스케줄러 등록 스크립트 (세션 399)
# api.childcare.go.kr (평문 HTTP) 가 GitHub 러너(해외 Azure IP)를 차단 → childcare 수집기 3종을 집서버 로컬로 이전.
# register-kosis-task.ps1 답습 (Interactive+Limited 최소 권한).
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-childcare-task.ps1

$TaskName = "MibunyangChildcareLocal"
$ScriptPath = (Resolve-Path "scripts\childcare-local-runner.bat").Path
$WorkDir = (Resolve-Path ".").Path

# 기존 작업 삭제 (멱등 재등록)
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 트리거: 매일 04:30 KST — 3종 전부 실행 (detail DAILY_LIMIT 누적 + info/jeju 매일 최신).
# KOSIS 러너 05:30 / naver 02:00·08:00 와 시간 분리 (집서버 동시 발화 회피).
$Trigger = New-ScheduledTaskTrigger -Daily -At 4:30AM

$Action = New-ScheduledTaskAction -Execute $ScriptPath -WorkingDirectory $WorkDir

# StartWhenAvailable: 04:30 에 꺼짐/절전이면 같은 날 깨어날 때 보충 실행.
# 통째로 놓친 날은 monitor ⑤ 신선도 분기(stale_days 14 초과)가 텔레그램으로 알림.
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

# 최소 권한: HTTP fetch + Supabase upsert 뿐 — 관리자 상승 불필요.
# LogonType Interactive = 로그인 상태에서만 발화 (집서버 자동 로그인 전제, kosis 러너 동일).
$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Trigger $Trigger `
    -Action $Action `
    -Settings $Settings `
    -Principal $Principal `
    -Description "childcare 수집기 3종 로컬 디스패치 (매일 04:30, api.childcare.go.kr 해외 IP 차단 대응 — 세션 399)"

Write-Host "작업 등록 완료: $TaskName"
Write-Host "  스케줄: 매일 오전 4:30 (StartWhenAvailable)"
Write-Host "  권한: Limited / LogonType: Interactive (로그인 상태에서 발화)"
Write-Host "  스크립트: $ScriptPath"
Write-Host ""
Write-Host "확인: Get-ScheduledTask -TaskName $TaskName | Format-List"
Write-Host "수동 실행: Start-ScheduledTask -TaskName $TaskName"
Write-Host "삭제: Unregister-ScheduledTask -TaskName $TaskName"
