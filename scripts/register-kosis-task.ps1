# KOSIS 로컬 러너 Windows 작업 스케줄러 등록 스크립트 (세션 289)
# kosis.kr 이 GitHub 러너(해외 Azure IP)를 차단 → KOSIS 수집기 10종을 집서버 로컬로 이전.
# register-naver-task.ps1 답습 (Interactive+Limited 최소 권한, naver-units-night 선례 실증).
# 실행: powershell -ExecutionPolicy Bypass -File scripts\register-kosis-task.ps1

$TaskName = "MibunyangKosisLocal"
$ScriptPath = (Resolve-Path "scripts\kosis-local-runner.bat").Path
$WorkDir = (Resolve-Path ".").Path

# 기존 작업 삭제 (멱등 재등록)
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 트리거: 매일 05:30 KST — kosis-local-runner.mjs DAY_TABLE 일자 디스패치 (due 없으면 즉시 종료).
# 같은 집서버의 02:00 naver-units-night 와 시간 분리 (kosis.kr 호출이라 네이버 IP 보호와는 무관).
$Trigger = New-ScheduledTaskTrigger -Daily -At 5:30AM

$Action = New-ScheduledTaskAction -Execute $ScriptPath -WorkingDirectory $WorkDir

# StartWhenAvailable: 05:30 에 꺼짐/절전이면 같은 날 깨어날 때 보충 실행.
# 날짜가 지나 통째로 놓친 달은 monitor ⑤ 신선도 분기(stale_days 초과)가 텔레그램으로 알림.
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

# 최소 권한: HTTP fetch + Supabase upsert 뿐 — 관리자 상승 불필요.
# LogonType Interactive = 로그인 상태에서만 발화 (집서버 자동 로그인 전제, naver-units-night 동일).
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
    -Description "KOSIS 수집기 10종 로컬 디스패치 (매일 05:30, kosis.kr 해외 IP 차단 대응 — 세션 289)"

Write-Host "작업 등록 완료: $TaskName"
Write-Host "  스케줄: 매일 오전 5:30 (StartWhenAvailable)"
Write-Host "  권한: Limited / LogonType: Interactive (로그인 상태에서 발화)"
Write-Host "  스크립트: $ScriptPath"
Write-Host ""
Write-Host "확인: Get-ScheduledTask -TaskName $TaskName | Format-List"
Write-Host "수동 실행: Start-ScheduledTask -TaskName $TaskName"
Write-Host "삭제: Unregister-ScheduledTask -TaskName $TaskName"
