# 네이버 수집 Windows 작업 스케줄러 등록 스크립트
# 관리자 권한 PowerShell에서 실행 (현재 폴더 무관 — 전체 경로로 실행 가능):
#   powershell -ExecutionPolicy Bypass -File F:\mibunyang\scripts\register-naver-task.ps1

$TaskName = "MibunyangNaverCollect"
# 경로는 이 스크립트 자신의 위치($PSScriptRoot = scripts\) 기준으로 잡는다.
# system32 등 다른 폴더에서 -File 로 실행해도 run-naver-local.bat 를 정확히 찾도록 (세션 470 사고 정정:
# Resolve-Path "scripts\..." 상대경로는 실행 위치가 system32 면 실패 → 빈 액션으로 등록되던 버그).
$ScriptPath = Join-Path $PSScriptRoot "run-naver-local.bat"
$WorkDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path  # 프로젝트 루트 (scripts\ 의 상위)

if (-not (Test-Path $ScriptPath)) {
    Write-Error "run-naver-local.bat 를 찾을 수 없습니다: $ScriptPath"
    exit 1
}

# 기존 작업 삭제
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 트리거: 매주 월/목 오전 8시 (naver-estate-web interval 크롤링과 시간 분리)
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Thursday -At 8:00AM

# 액션: 배치 스크립트 실행
$Action = New-ScheduledTaskAction -Execute $ScriptPath -WorkingDirectory $WorkDir

# 설정: PC 깨어있을 때만, 최대 4시간
#  - ExecutionTimeLimit 4시간 (세션 493): 1단계 naver-collect.py 가 --max-minutes=150 으로 스스로
#    멈추고, 그 뒤 2~6단계(sync·presale·units·전용률·점수)가 돌 여유를 둔다. 2시간이던 옛 설정은
#    1단계가 통째로 잘려 2~6단계가 아예 실행되지 않아 분양정보·세대수가 한 달 굶었던 원인.
#  - RestartCount 2 + RestartInterval 10분: 실패 시 10분 뒤 재시도 ×2 (세션 470, 사장님 결정).
#    naver-collect.py resume(최근 7일 내 받은 단지 skip)가 있어 재시도마다 이어서 돎.
#  - MultipleInstances IgnoreNew: 이미 돌고 있으면 새 발화(재시도 포함) 무시 = 절대 겹침 없음.
#    naver-collect.py 의 filelock 이 손실행까지 막는 2중 안전망(세션 470 좀비 더미 사고 정정).
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew `
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
