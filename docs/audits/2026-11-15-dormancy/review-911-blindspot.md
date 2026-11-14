<!-- 세션716(2026-11-15) 조사·검사 보고 원문 — 작업반 최종 보고를 그대로 옮김(휴면 요약의 근거) -->

**결론**: 휴면 요약은 "사람 없이 도는 것"은 잘 정리했습니다. 그러나 **바깥 일정 하나(Supabase 옛 키 삭제)는 사이트 API·수집·감시가 한꺼번에 죽을 수 있는데 0줄입니다.** 또 "알림이 오면 연다"만 있고, 알림이 안 올 때와 돌아왔을 때 무엇을 할지가 비어 있습니다. 판정 🟠(🔴 1건, 날짜는 미정).

| 급 | 무엇 | 왜 위험 | 근거 | 가장 작은 처방 |
|---|---|---|---|---|
| 🔴 | Supabase 옛 키(anon·service_role)를 지우는 날이 "Late 2026, TBC"(2026년 말, 날짜 미정) | 비밀값 `SUPABASE_SERVICE_KEY`를 워크플로 62곳·api·수집기가 쓰고, 감시(monitor)도 DB 조회로 같이 죽음. 공유 DB 라 **2u 창이 옛 키를 끄기만 해도 즉시** 끊김. 레포에서 `sb_secret`·`publishable`·`legacy key` grep 0건 | [Supabase 공지](https://github.com/orgs/supabase/discussions/29260) 원문 "Legacy API keys will be deleted… your app will break" · `package.json:30` supabase-js ^2.119 | 문서: §5 에 한 줄(대시보드 API Keys 화면에서 새 키 유무 확인 · 이메일 공지가 오면 GitHub Secrets·Vercel·집 PC `.env` 세 곳 교체) + 2u 쪽지 "mibunyang 휴면 중 — 옛 키 끄기·JWT 비밀 교체 금지, 사장님께 먼저". 코드 변경은 없고 값만 바꾸면 됨 |
| 🟠 | 요약 §2 는 "텔레그램이 죽으면 못 잡는다"고만 씀 | 실제로는 아침 브리핑이 이상이 있든 없든 매일 1통 옴. **이 브리핑이 하루 이틀 안 오면** 감시·텔레그램·워크플로 꺼짐 중 하나가 죽은 것. 이것이 유일한 두 번째 길인데 적혀 있지 않음 | `scripts/monitor-collectors.mjs:5540`(sendDailyBriefing), `:5851` | 문서: §2 에 "아침 브리핑이 2일 안 오면 연다" 한 줄 |
| 🟠 | 근거 원문이 git 에 안 올라가는 곳에 있음 | `.omc/handoffs/session716/*`, `artifacts/notification-logs-적용안내.md` 둘 다 `.gitignore` 대상(56·157줄). 외장 F: 가 고장 나거나 다른 PC 에서 열면 요약이 가리키는 원문이 사라짐 | `git check-ignore -v` 실측 | 문서: B1 표·census 요지를 docs/ 나 메모리로 옮기거나, 요약에 핵심만 직접 적기 |
| 🟠 | 12/31 지방 스트레스 금리 대응이 "발표 확인 → 상수 PR"뿐 | 금융위 발표가 12/31 까지 없거나 사장님이 못 열면 대책이 없음. 1/1 뒤 화면에 "지방 0.75%p(2026-12-31까지)"라는 지난 날짜가 그대로 보이고, 계산도 옛 금리로 함 | `src/components/detail/FundingPlanner.tsx:778` · BACKLOG 451 ③ | 사장님 결정을 지금 받아 적기: 발표가 없으면 무엇을 보여 줄지. 코드: 기한이 지나면 계산 칸을 "미정"으로 바꾸는 장치는 나중 일 |
| 🟠 | 돌아왔을 때 첫 30분 순서가 없음 | 집 PC 러너는 `F:\mibunyang` 에 체크아웃된 코드를 pull 없이 그대로 돌림. 다음 세션이 본 폴더에서 가지를 바꾸면 운영 코드가 바뀜. 로컬 main 도 봇 커밋만큼 뒤처져 있음 | `scripts/kosis-local-runner.mjs`(git pull 0건) · `admin-district-code-reform.md` §6 | 문서: §0 「돌아오면」 ① 📮 쪽지 ② `gh workflow list --all` · 아침 브리핑 마지막 날짜 ③ 러너 시각(04:30·05:30·08:00)을 피해 `pull --ff-only` ④ 편집은 워크트리에서만 |
| 🟠 | 알림 대처법이 비어 있음 | "워크플로 꺼짐" 알림이 와도 할 일(꺼진 워크플로마다 다시 켜기 `gh workflow enable` + 커밋 1개)이 없음. 매주 오는 lhzone 미발화처럼 **이미 아는 잡음** 목록도 없어서, 그것 때문에 열 수 있음 | 요약 §3 · BACKLOG 466 | 문서: 알림 종류별 할 일 한 줄 + 이미 아는 잡음 목록 |
| 🟠 | 결제 수단 만료 | Supabase(사용 한도 꺼짐 = 유료 플랜)·도메인 결제가 실패하면 사이트가 통째로 섬. §5 에는 "만료일 확인"만 있고 결제 카드 줄이 없음 | 요약 §5 · 메모리(09-27 사용 한도 꺼짐) | 문서: §5 에 "결제 카드 만료일 — Supabase·도메인 등록처" 한 줄 |
| 🟠 | 반복 실수 ②(prettier 가 `.omc/` 아래 워크트리 파일을 건너뜀) | 이 규칙이 어디에도 없음. 워크트리 위치를 `.omc/wt` 로 정한 바로 그 줄이 함정을 만듦 | `WORK_RULES.md:136` · prettier 관련 grep 0건 | `WORK_RULES.md:136` 뒤에 한 줄: "검사(prettier·eslint)는 워크트리를 작업 폴더로 두고 돌린다 — 본 폴더에서 절대경로로 돌리면 `.gitignore` 의 `.omc/` 때문에 조용히 빠진다" |
| 🟠 | 반복 실수 ①③(종료 알림 놓침 · 전체 시험 겹침) | 처방은 전역에 이미 있음(`long-tests.md:5-6`: 작업반 2명 이상이면 차례로, 결과 파일 요약 줄로 대기). 그런데 이 레포 WORK_RULES 에서 `long-tests` grep 0건이라 지시서에 안 들어감 | `skills/worker-brief/long-tests.md:5` | `WORK_RULES.md` 「구현자·검사관」 절에 한 줄: "작업반이 2명 이상이면 long-tests.md 처방을 지시서에 넣는다" |
| 🟡 | DB 크기 감시가 사실상 없음 | `monitor-db-size` 는 행 수만 세고 `::warning::` 만 냄(텔레그램 없음, 바이트 측정 없음). 사용 한도가 꺼져 있어 요금이 조용히 늘 수 있음 | `.github/workflows/monitor-db-size.yml:58-60` | 기록만(나중에 텔레그램으로 연결) |
| 🟡 | `apartments.json` 크기가 계속 큼 | 13MB(5/15) → 32MB(10/15) → 30MB. GitHub 는 50MB 에서 경고, 100MB 면 push 거부 → 화면 굽기 멈춤 | `git cat-file -s` 실측 | 기록만 |
| 🟡 | 요약 문장 셋이 헷갈림 | ① §4 "되돌릴 것"이 12/17 한 번만 여는 날에도 적용되는지 모호. 거기서 dependabot 한도를 5로 되돌리면 휴면 중에 버전 PR 이 몰려옴 ② trade-stats 줄의 "죽는 양상"이 아직 안 고친 결함처럼 읽힘(실제로는 #901 에서 고치고 가드도 있음) ③ 12/06·12/08 확인을 휴면 중에 해야 하는지 불명 | 요약 26·27줄 | 문서: "완전히 돌아온 뒤만" · "고침, 첫 실전 확인용" · "돌아온 뒤 몰아서" |
| 🟡 | 빠진 안내 둘 | ① 구독자가 생기면 `notification_logs` 표가 없어 월요일 알림 작업이 매주 실패함 ② 외부 API 장기 중단 감시(⑤)는 3회 연속 0건이어야 울려서, 월간 수집기는 키가 만료돼도 약 3달 뒤에야 앎 | `notify-subscribers.mjs:368-372` · 규칙 external-api-outage | 기록만 |

검사 결과 문제가 없던 것:
- 감시 중복 막기 저장소(`monitor_alert_state`)는 지금 열쇠로만 조회하고 주 단위로 아주 조금씩만 늘어 문제없음.
- actions 판(v7)·Node 24 는 충분히 오래 지원됨.
- ㉘(a)는 날짜가 지나면 저절로 조용해짐.

**#909 가 만든 새 위험**: 크지 않습니다. 매주 반복 알림과 매일 브리핑이 겹쳐 알림에 무뎌질 위험은 있습니다. 위 "이미 아는 잡음 목록"이 그 처방입니다.

**다음 세션 시작 블록에 꼭 있어야 할 것**: 위 5행의 4단계(쪽지 → 워크플로 상태·브리핑 날짜 → 러너 시각 피해 pull → 워크트리)와 Supabase 키 확인 한 줄.

**한 줄 판정**: 🟠. 문서 몇 줄과 지금 받을 사장님 결정 하나(12/31 발표가 없을 때)로 대부분 막을 수 있습니다. 🔴 Supabase 키는 지금 쪽지·문서로 대비하고, 실제 교체는 공지가 오면 값만 바꾸면 됩니다.

공책: `C:\Users\user\.claude\agent-memory\blindspot-critic\mibunyang.md` 를 새로 만들고 색인에 한 줄 덧붙였습니다.

Sources: [Supabase API 키 변경 공지(GitHub discussion 29260)](https://github.com/orgs/supabase/discussions/29260) · [Supabase API keys 문서](https://supabase.com/docs/guides/api/api-keys) · [새 키로 옮기는 안내](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
