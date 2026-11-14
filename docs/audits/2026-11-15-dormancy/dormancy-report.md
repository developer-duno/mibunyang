<!-- 세션716(2026-11-15) 조사·검사 보고 원문 — 작업반 최종 보고를 그대로 옮김(휴면 요약의 근거) -->

휴면 준비 점검 보고(읽기 전용 · 파일 수정 0 · 수집기·빌드 실행 0)

## 결론 3줄
1. 가장 큰 위험은 GitHub 의 60일 규칙입니다. 이 레포는 공개(PUBLIC)이고, 공식 문서는 "공개 레포에서 60일간 레포 활동이 없으면 예약 워크플로를 자동으로 끈다"고만 하고 무엇을 "활동"으로 치는지는 정하지 않았습니다. 매일 봇 커밋이 들어가지만 그게 활동으로 쳐지는지는 확인하지 못했습니다. 꺼지면 감시(monitor)도 같이 꺼져서 알림이 하나도 오지 않습니다.
2. 고장 알림은 텔레그램 한 길뿐입니다. GitHub 쪽 감시와 로컬 러너가 둘 다 이 길로 보냅니다. 집 PC나 F: 드라이브가 멈추면 로컬 수집은 전부 서지만, 대기질 3일·네이버 4일 신선도 감시가 GitHub 쪽에서 잡습니다.
3. 날짜가 걸린 확인 중 "작업이 실패(빨강)하는 것"은 감시가 잡습니다. 하지만 "성공했는데 값이 틀린 것"(11/17 카카오, 11/22 dsr40pass 값, 12/06 계측)은 사람이 직접 보는 수밖에 없습니다. 12/31 지방 스트레스 유예 끝은 사람이 상수를 고치는 PR 이 필요합니다(12/17 부터 감시 ㉕ 가 매일 알림).

## B1~B6 표
| 항목 | 근거 | 휴면 중 위험 | 처방 후보 |
|---|---|---|---|
| B1 GitHub 예약 작업 23개 | cron grep: 매일 = daily-deploy 03:00 · collect-naver-listings 04:00 · purge-consults 04:00 · monitor 09:00 / 화·금 05:30 incremental(카카오) · 수 05:30 nearby-childcare · 화 02:00 playwright 캐시 / 월 = calc-layout 08:00, applyhome 3종 11:30·12:30·13:30, notify 14:00 · 일 11:00 backfill / 매월 = police 1일 01:00, environment 1일 02:00, childcare 1일 05:00, db-size 1일 06:00, noise 1일 13:00, noxious 3일 03:00, industry 7일 04:00, trade-stats 8·22일 01:00, trade-stats-regions 8·22일 01:30 / 분기 = dart 1·4·7·10월 15일 12:00 | 하 | — |
| B1 최근 7일 실패 | 실패 4건·취소 6건이 전부 pull_request(dependabot jsdom-31 CI 2건·minor-and-patch 1건·s705 1건, 나머지는 덮어쓰기 취소). 예약 실행 실패는 0건. skipped 24건 = monitor-collectors.yml:93 `if` 로 일부러 건너뛴 것 | 하 | — |
| B1 60일 규칙 | 문서 원문 확인 · 레포 visibility = PUBLIC · daily-deploy.yml:117-125 는 "변경 있을 때만" 커밋하지만 collect-data.mjs:1068 이 fetchedAt 을 매번 써서 사실상 매일 커밋(11/09~11/13 매일 확인) · 워크플로 34개 지금 전부 active · "활동" 정의는 문서에 없음 | **상** | 아래 결정 1 |
| B1 로컬 러너 | register-kosis-task.ps1:15·29-33(매일 05:30, Interactive = 로그인 상태에서만) · register-childcare-task.ps1:15(04:30, 러너는 화요일만) · register-naver-task.ps1:21(월·목 08:00) · 작업 폴더 = F:\mibunyang(ps1:8 `Resolve-Path "."`) · bat 에 git pull 없음 = 지금 체크아웃된 main d5314046 코드로 돈다 | 중 | — |
| B1 PC나 F: 가 멈추면 서는 것 | kosis 러너: air-quality 매일 + 날짜표(local-runners.md 표: KOSIS 10종·trades·molit-building·maintenance·building-hub·emergency·population 2종·crime-safety·govlist·housing-price·naver-devplan·lhzone) · childcare 3종 · 네이버 4단계(naver-collect·presale·molit-units·pipeline) · sgis-map-emd. GitHub 쪽 후처리·daily-deploy 는 낡은 데이터로 계속 돈다 | 중 | 자동 로그인·재부팅 확인(결정 6) |
| B1 놓친 날 보충 | local-runners.md "놓친 날 보충" 표: 하루씩 따라잡고, 10일 넘게 밀리면 logError | 하 | — |
| B1 오늘 상태 | kosis-local.log 11/14 05:30 "3개 전부 성공" · naver-collect.log 11/12 12:26 done(성공 5) | — | — |
| B2 알림 길 | 텔레그램뿐: monitor-collectors.yml:117-118 · kosis-local-runner.mjs:58,413-419(실패하면 바로 보냄) · 그 밖에 GitHub 기본 메일(문서상 "cron 을 마지막에 고친 사람"에게) | 중 | — |
| B2 감시 목록 | ①실패/취소 ②성공인데 0건 ③GitHub 미발화 ④NULL 급증 ⑤외부 API 중단(-a 연속 0건, -b 미발화) ⑥VIEW 회귀 ⑦~⑨·⑪~⑱·㉑~㉖ · ⑩권한 점검과 ⑲소유권 대조는 월요일만(monitor-collectors.mjs:5409-5502) · EXTERNAL_API_COLLECTORS 50항목(:334~ — 대기질 3일, naver-pipeline 4일, 주간 14일, 월간 38일, 분기 100일) | — | — |
| B2 11/17 카카오 5회차 | "Naver Post-Processing (Incremental)" 은 workflow_run 감시 목록에 있음 → 빨강이면 ①이 잡음. DEFERRED 0 · 명단 수 · 19곳 재조회는 감시 없음(BACKLOG:424 = 손으로 확인) | 중 | — |
| B2 11/22 trade-stats | "Trade Stats Calculation" 이 감시 목록에 있음 → ERR_MODULE_NOT_FOUND 로 실패하면 ①이 텔레그램. CI 가드 `_regulations-plain-node-import.test.mjs` 가 있음. dsr40pass 다시 구워졌는지(⑱)는 감시 안 함(BACKLOG:411 "monitor-collectors.mjs:261 은 이름표뿐") | 중 | 결정 3 |
| B2 12/06 계측 4주 판정 | BACKLOG:412 ⑩ — Analytics 를 사람이 보는 판정. 자동 없음 | 하 | — |
| B2 12/10 molit-building | 러너 10일 정기 실행. BACKLOG 에 날짜 걸린 확인 줄은 못 찾음 · 실패하면 러너 텔레그램 + ⑬, 안 돌면 ⑤-b(38일) | 하 | — |
| B2 12/17 | 감시 ㉕ 가 STRESS_RATE_LOCAL_UNTIL 14일 전부터 매일 알림(BACKLOG:365,461) · 12/31 뒤 상수 PR 은 사람 몫 · 12/31 뒤 칩은 "유예 끝"인데 계산은 0.75 그대로(BACKLOG:412 ③) | **상** | 결정 2 |
| B2 12/21 lhzone | 택지 API 가 10/21 부터 점검 중(BACKLOG:427) · 실패 행 → ⑬ 1회 + ⑤-b 매일 "미발화" 소음 · 복구되면 수동 1회 | 중 | 결정 4 |
| B3 만료일 | API_REGISTRY.md 에 만료일·활용기간 없음(grep 0) · 다른 .claude 문서에도 도메인·Vercel 만료 0 · Supabase Spend cap 꺼짐(메모리 09-27) · 열린 보안 알림 2건 medium(uuid runtime → 11.1.1 · minimatch dev) | 중 | 외부 콘솔은 확인 못 함 |
| B4 dependabot | dependabot.yml: npm·actions 둘 다 매주 월 06:00 KST, 한도 5, minor/patch 는 묶음, eslint major 는 끔 · 지금 열린 PR 0 · 자동 합치기 워크플로 없음(최근 #892·#893 은 developer-duno 가 직접 합침) · 공식 문서: 한도에 닿으면 새 버전 PR 을 멈춤, 보안 PR 은 따로 10개 한도 · automated-security-fixes enabled:true | 하(main 은 안 바뀜) · 보안 패치가 안 들어가는 건 중 | 결정 5 |
| B5 러너 | runs-on 34곳 전부 ubuntu-latest · annotation 원문 "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026"(CI 43598260967 · daily-deploy 11/13 run) · 지금 이미지는 ubuntu-24.04(20261111.370) · node-version 34곳 전부 24로 고정 · checkout@v7·setup-node@v7·cache@v6·upload-artifact@v7(SHA 가 아니라 주 버전 꼬리표) · 운영 워크플로는 node + `npm ci` 뿐(apt-get·python 0) · `playwright install --with-deps` 는 e2e.yml·warm-playwright-cache.yml:50 에만 | 하~중(E2E·캐시만 위험) | ubuntu-24.04 로 고정 |
| B6 사람이 하던 일 | 목요일 PC 재시작이 네이버 러너를 죽임(메모리 feedback_thursday_restart_kills_runner) · ⑩권한 기준선 재승인(CLAUDE.md — 2u 가 권한을 바꾸면 매주 월요일 알림) · govlist 차단기 다시 재기 12/08(BACKLOG:446) · lhzone 복구 뒤 수동 1회 · 12/31 상수 PR + 2u 알림(BACKLOG:461) · 법령해석 회신(BACKLOG:411 ⑰) · 서치콘솔 4주 측정(BACKLOG:401) | 중 | — |

## 사장님 결정이 필요한 것
1. 60일 규칙 대비
   - A) 50일마다 달력 알림을 걸고, 사람이 아무 커밋이나 넣거나 워크플로를 다시 켠다. 장점: 0원·확실. 단점: 사람 손이 필요.
   - B) 로컬 러너가 매일 GitHub API 로 워크플로 상태를 보고 "꺼짐"이면 텔레그램을 보내게 한다(작은 PR). 장점: GitHub 바깥에서 오는 알림이라 감시가 같이 꺼져도 살아 있음. 단점: PC 가 켜져 있어야 함. **추천 = B + A**
   - C) 그대로 둔다. 봇 커밋이 활동으로 쳐질 거라는 기대뿐이고 근거가 없습니다.
   - D) 비공개로 바꾼다. 장점: 60일 규칙이 적용되지 않음. 단점: Actions 사용 시간이 과금될 수 있음(추정).
2. 12/31 유예 끝
   - A) 휴면 전에 미리 정해 둔다. 단점: 금융위가 연장하면 틀림.
   - B) 12/17 ㉕ 알림이 오면 그때 세션을 연다. **추천**
   - C) 그대로 둔다. 손님 화면에서 칩과 계산이 어긋남.
3. 11/17·11/22·12/06·12/08 확인
   - A) 날짜마다 짧은 세션을 연다.
   - B) ⑱ 값 확인을 감시에 추가한다(PR 필요).
   - C) 휴면이 끝난 뒤 한꺼번에 본다. 단점: 그 사이 틀린 값이 노출될 수 있음.
4. lhzone 매일 소음: 외부 사고 기간에는 하루 한 줄로 접을지(작은 PR · 소음이 진짜 알림을 묻는 문제 · BACKLOG:427), 아니면 그대로 둘지.
5. dependabot: 휴면 중 버전 PR 한도를 0 으로 두고 보안 PR 만 받을지, 아니면 그대로 둘지(쌓이면 알아서 멈춤).
6. 집 PC 자동 로그인과 재부팅 정책: Interactive 작업이라 재부팅 뒤 로그인하지 않으면 로컬 수집이 전부 멈춥니다.

## 지금 코드·설정으로 바로 고칠 수 있는 것
- purge-consults.yml:8 주석이 "KST 04:30" 인데 cron `0 19 * * *` 은 KST 04:00 입니다(주석 오기).
- 로컬 러너에 GitHub 예약 워크플로 꺼짐 감시 추가(결정 1B).
- runs-on 34곳을 ubuntu-24.04 로 고정.
- uuid runtime 보안 알림을 고칠 업데이트 PR.
- ⑤-b 외부 사고 기간 dedup(결정 4) · ⑱ 값 감시(결정 3B).

## 확인 못 한 것
- Windows 작업 스케줄러의 실제 등록 상태와 다음 실행 시각(Get-ScheduledTask 조회가 자동 분류기에 거부됨) — 대신 로그 파일로 오늘 돈 것만 확인.
- 봇 커밋이 "활동"으로 쳐지는지 · 텔레그램 실제 수신 · data.go.kr 키 활용기간 · 도메인 만료 · Vercel 요금제 · 집 PC 자동 로그인 · sgis 첫 회차 진행 상태.

로그 사본: C:\Users\user\AppData\Local\Temp\claude\f90357b50929317c\8489a083-c68d-45fd-b768-b2900f4b6a11\scratchpad\ci.log · ...\dd.log
