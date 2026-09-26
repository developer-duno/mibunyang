# 작업 규칙 (0. Auto-Tool → Plan → Guard → Work → Review)

> 새 기능·리팩토링·버그 수정 시작 시 이 파일을 먼저 참조. 진실의 원천 = [CLAUDE_TOOLBOX.md](CLAUDE_TOOLBOX.md) (도구 박힘 카탈로그).

## 0. Auto-Tool 자율 발동 매트릭스 (사용자 메시지 받자마자 0턴 판단)

> Claude 가 사용자 명령 입력 0건이라도 다음 표 답습 의무. 명시 트리거 부재 = 자율 판단.

### 0-A. 작업 모드 발동 (메시지 수신 직후)

| 사용자 메시지 신호 | 자율 발동 도구 | 미발동 시 위반 |
|---|---|---|
| "전부" / "다" / "모든" / "전체" / "싹다" / "통째로" | `Skill(ulw-safe)` | 30분+ 노출 / 다중 의사결정 누적 |
| 30분+ 예상 / 7+ 파일 동시 변경 / 풀스택 / 마이그레이션 | `Skill(ulw-safe)` | 같음 |
| "X 해줘" + 검증 방법 부재 / "알아서" / "완벽하게" / "잘" | `Skill(goal-setting)` → `/goal` 조건 설계 | 무한 루프 / 토큰 낭비 |
| 완료조건 명확 + 사용자 직접 검증 가능 ("vitest 통과까지" / "회귀 0까지" / "ISSUE-N PR 생성까지") | **`/goal` 자율 설정** — [GOAL_TEMPLATE.md](GOAL_TEMPLATE.md) 4항목 구조 (목표·범위 / 세부규칙 / 종료조건+증명 / 제약) + DECISION_LOG 카운터 | ulw-safe·ralph 동시 금지 |
| 같은 task 완료조건까지 무정지 반복 (PRD형 다단계) | **`Skill(oh-my-claudecode:ralph)`** | ulw-safe 동시 금지 (종료 철학 정반대) |
| 5+ 경쟁 가설 / timeout·cancelled 원인 진단 | **`Skill(oh-my-claudecode:trace)`** | 4-way 답습의 형식화 엔진 |
| "Y MCP 추가" / "도구 등록" / "스킬 꺼내" 류 | `Skill(tool-discovery)` | 글로벌 오염 위험 |
| 새 기능 / 컴포넌트 / 디자인 | `Skill(superpowers:brainstorming)` | 의도 파악 0회 위반 |
| 버그 / 에러 / "X 안 됨" | `Skill(superpowers:systematic-debugging)` 또는 `Skill(engineering:debug)` | 추측 fix 위반 |
| 인시던트 / 외부 API 500 / 503 | `Skill(engineering:incident-response)` | 진단 분산 |
| DB 쿼리 / apartments_flat / 품질 진단 | `Skill(data:sql-queries)` / `Skill(data:explore-data)` | 직접 SQL 답습 위반 |
| 트렌드 / 세그먼트 / 분포 | `Skill(data:analyze)` | 통계 추측 위반 |
| 데이터 품질 검증 / 분석 공유 직전 | `Skill(data:validate-data)` / `Skill(data:statistical-analysis)` | NULL률·denominator shift·이상치 카탈로그 |
| "완료" / "통과" / "고침" 주장 직전 | `Skill(superpowers:verification-before-completion)` | 회귀 가드 룰 강제 엔진 (증거 없이 성공 단정 금지) |
| 외부 자원 부재 단정 직전 | `feedback_external_resource_existence_check.md` 답습 | 본문 손상 위험 |

### 0-B. 파일 편집 직후 자동 발동 (Edit/Write hook)

| 변경 자리 | 자동 호출 도구 | 무엇을 점검 |
|---|---|---|
| `*.ts` / `*.tsx` 편집 | `typescript-lsp` MCP 자동 진단 | 타입 에러 / import 누락 / unused |
| `src/scoring/` 편집 | `Task(subagent_type=scoring-validator)` 의무 | 가중치 합계 / 클램핑 / null 처리 |
| `scripts/collectors/*.mjs` 편집 | `Task(subagent_type=collector-contract)` 의무 | 배치 / upsert / Promise.all / 에러 |
| 수집 / API / 렌더 코드 편집 | `Task(subagent_type=null-safety-checker)` 의무 | optional chain / 기본값 / 숫자 포맷 |
| 보안 영역 (auth/sql/env) 편집 | `Task(subagent_type=security-reviewer)` (세션 439 로컬 핀) + `security-guidance` 플러그인 | XSS·env/secret 노출·인젝션·CORS / OWASP Top 10 |
| `withHandler` / `api/_lib/` 편집 | `Task(subagent_type=null-safety-checker)` + `Task(subagent_type=code-reviewer)` (세션 439) | withHandler 순서 / 블라인드 / CORS / RateLimit / Admin / null |
| `supabase/migrations/*.sql` / DB 스키마 편집 | `Task(subagent_type=migration-safety)` (세션 439 로컬 핀) | 공용 테이블 ALTER·security_invoker·롤백·Dashboard 수동 |
| 커밋/PR 직전 도메인 코드리뷰 | `Task(subagent_type=code-reviewer)` (세션 439) | 표현계층 무변경·memo comparator·블라인드 정책 |
| catch / try / fallback / silent 처리 변경 | `Task(subagent_type=pr-review-toolkit:silent-failure-hunter)` | 빈 catch / 무로그 fallback (collector_runs silent fail 도메인) |

### 0-C. 검색·답습 자율 위임 (탐색 비용 임계)

| 자리 | 자율 위임 도구 | 사유 |
|---|---|---|
| 3+ 쿼리 예상 검색 | `Agent(subagent_type=Explore)` | 메인 context 보호 |
| 모호한 스코프 / 여러 영역 답습 | `Agent(subagent_type=Explore)` 3 병렬 | 의도 파악 우선 |
| 박제값 (NEXT_SESSION/BACKLOG) 답습 진입 | `next-session-grep-mandate.md` 답습 의무 | 환각 차단 |
| 외부 공식 문서 답습 | `Agent(subagent_type=oh-my-claudecode:document-specialist)` | 추측 0 / 출처 박힘 |
| 검사관(코드 적대검증·할루시네이션 감사·맹점 비판) | **검사 종류별 급** — 할루 = Sonnet · 적대 = 백엔드(`api/`)·DB(`supabase/`)·수집기(`scripts/collectors/`)·인증·점수 엔진(`src/scoring/`)을 건드렸으면 Opus, 화면 문구·표시·문서만이면 Sonnet · 맹점 = Opus. 셋을 한 명으로 합치지 않음 | 아래 「모델 사다리」 절 · 정본 글로벌 `model-selection.md` 1-1 (2026-09-26 개정, 옛 "critic 3 병렬 + Sonnet" 폐기) |

### 0-D. DB / 인프라 자율 호출 (Supabase MCP)

| 사용자 표현 | 자율 발동 자리 |
|---|---|
| "DB 에서 ..." / "supabase 에서 ..." / "apartments 테이블 ..." | `plugin:supabase:supabase` MCP 자동 호출 (첫 호출 OAuth 1회) |
| "SQL 실행" / "스키마 확인" / "마이그 적용" | 같음 |
| "Edge Function 배포" | 같음 |
| Vercel 배포 / env 조회 / 빌드 | **`vercel` CLI 직접 호출** ([mcp-vs-cli.md](../rules/mcp-vs-cli.md) 룰 = CLI 우선) |

### 0-E. 커밋 / 머지 자율 발동

| 자리 | 자율 도구 |
|---|---|
| 코드 변경 + 사용자 "커밋" 표현 | `Skill(commit-commands:commit)` 또는 `Skill(commit-commands:commit-push-pr)` |
| 커밋 직전 | `Skill(cross-validate)` (5교차검증 병렬) — Review 절 답습 |
| PR 직전 | `Skill(code-review medium)` 또는 사용자 명시 시 `ultra` |
| 머지 직후 | `Skill(claude-md-management:revise-claude-md)` + `Skill(session-report:session-report)` 검토 |

### 0-G. 외부 비동기 폴링 자율 발동 (시간 기반 — /loop · Monitor)

> 완료조건 기반 반복(/goal·ralph)과 다름. 외부 시스템(GitHub Actions·배포)이 비동기로 바뀌길 기다리는 자리 = 시간 기반 폴링.

| 자리 | 자율 발동 도구 | 비고 |
|---|---|---|
| CI run / cron run 완료·cancelled 감시 | `Monitor` (백그라운드, until-loop) | gh run 폴링. 완료 시 자동 통보 |
| 배포 / 외부 큐 / 원격 상태 주기 추적 | **`/loop <간격> <폴링 명령>`** (네이티브, v2.1.72+) | 세션 스코프. 7일 만료 |
| harness 추적 가능 작업 (서브에이전트·workflow) | 폴링 금지 — 완료 시 자동 재호출됨 | 폴링 = 토큰 낭비 |

### 0-F. 자율 발동 차단 자리 (의무)

- 사용자 "직접 해줘" / "그냥 X 해" 명시 = 자율 발동 차단
- 5분 이내 단순 작업 (typo / 1줄 정정 / 단순 grep) = 자율 발동 차단
- 이미 완료 조건 명확 ("test pass = 완료") = `goal-setting` 차단 (단 `/goal` 직접 설정은 OK)
- 자가 점검 1+2 발동 직전 = 자율 발동 보류 (Plan 우선)
- plan mode 활성 시 = 코드 변경 자율 발동 0건
- **`/goal` · `ralph` · `ulw-safe` 중 2개 동시 발동 금지** — 모두 종료 정책을 가진 경쟁 loop. 한 task에 1개만 (goal-setting·ralph·ulw-safe 동시 금지는 글로벌 [auto-tool-usage.md](../../../Users/user/.claude/rules/auto-tool-usage.md) 충돌 회피 절 답습)

## 모델 사다리 — 구현자·검사관 급 (2026-09-26 글로벌 개정 반영, 세션578)

> 정본 = 글로벌 `~/.claude/rules/model-selection.md` 「메인 모델 운용 관습」·「권장 모델은 시작 블록에」(1-1 검사관 급). 이 절은 그 규칙이 **이 레포에 어떻게 적용되는지**만 적는다. 메인 모델은 사장님의 `/model` 로만 바뀐다.

- **구현자**(메인이 Fable 이든 Opus 든 사다리는 같다): 표준·복잡(애매하면 여기) = `Agent(subagent_type:"opus-coder")`(Opus) · 정말 단순(설계 판단 0 · 파일 2개 이하 · 회귀 위험 낮음, 셋 다) = `model:"sonnet"` · 1~2줄 사소한 수정·문서·`.claude/**`·메모리 = 메인 직접. Opus 서브가 사용량 한도(429)로 막힌 작업은 **지시서에 코드가 그대로 적힌 것만** Sonnet 이 이어받고, 설계가 남은 작업은 대기(Haiku 로 안 내린다). 옛 "메인이 Opus 폴백이면 코딩 서브 전부 Sonnet"(2026-09-24) 은 폐기 — 구현자를 내리면 구현 품질이 같이 내려간다.
- **검사관 급은 검사 종류별**: 할루시네이션 감사 = Sonnet(세션이 한 말을 파일·DB·git 과 맞춰 보는 목록형) · 코드 적대검증 = 백엔드 로직(`api/`)·DB 쿼리·마이그(`supabase/`)·예약 작업·수집기(`scripts/collectors/`)·인증·점수 엔진(`src/scoring/`)을 건드렸으면 Opus, 화면 문구·표시·문서만이면 Sonnet · 맹점·플랜 비판 = Opus · **셋을 한 명으로 합치지 않는다**(첫 관점에 끌려 나머지가 얕아진다). 세 결과 합치기(지적 판정) = 평소 메인 Opus 로 충분, 지적이 많거나 엇갈리거나 운영 반영이 큰 날은 Fable.
- **프로젝트 에이전트 6개**(`.claude/agents/*.md`) 는 `model:` 을 명시한다 — `inherit` 는 메인을 따라가 Fable 이 될 수 있다. code-reviewer · collector-contract · migration-safety · security-reviewer · scoring-validator = `model: opus` + `effort: high`(Opus 를 직접 지정할 땐 effort 동반 — 세션 effort xhigh 에서 opus 스폰이 400 으로 죽은 사고, opus-coder 와 같은 처방) · null-safety-checker = `model: sonnet`. 스폰 시 `model:` 인자로 덮어쓸 수 있다(공식: 호출 인자 > 정의 파일 > env > 메인).
- **시작 블록 헤더 둘째 줄**에 `# 권장 메인 모델: Fable|Opus · 이유: <한 줄> · 구현자: Opus(표준·복잡)/Sonnet(단순) · 검사관: 할루 Sonnet · 적대 Opus|Sonnet · 맹점 Opus` 를 적고, **세션 첫 보고**에 `모델: 지금 X / 권장 Y` 한 줄(다르면 "바꾸시려면 `/model …`", 같으면 "일치", 옛 블록이면 "권장 없음"). 판정 = Fable 이 값을 하는 날: 새 하위 시스템 설계·원인 불명 사고·운영 반영이 큰 배포 창과 마무리(검사관 3인)·사장님 결정 여럿 / Opus 로 충분한 날: 설계서·계획서가 있는 PR 구현 이어가기·문서·조회. 애매하면 Fable.
## Plan (새 기능/리팩토링 요청 시 자동 진입)
- 단계당 수정+신규 파일 **3개 이하**
- 단일 파일 **80줄 이내**(고위험 50줄), 단일 컴포넌트 **150줄 미만**
- **5파일+** 수정 시 반드시 단계 분리
- DB 변경과 API 변경은 **다른 단계**에서
- 한 단계에 "타입 + API + 컴포넌트" 동시 생성 금지
- 플랜 필수 포함: 파일 목록+참조처(grep 결과) / 실행 순서+의존 / 영향 범위 / 롤백 / 테스트 / 단계별 예상 줄 수
- **화면 결함(문구·빈칸·단위)은 "그 문구를 누가 그리나"를 확정한 뒤에만 표적 file:line 을 적는다** — ① `grep -rn "<문구>" src/components src/lib src/constants` 로 후보 부품 전부 ② 라이브 DOM(또는 로컬 vite) 텍스트에서 그 문구가 실제로 어느 부품의 것인지 1회 확인 ③ 그 부품을 표적으로. 조사 보고서의 "종합 탭 '미수집'" 같은 **탭 이름만 보고** 표적을 고르면 폴백이 관리자 화면에만 닿는다(세션576 D5 → D5-b 재작업: `fieldMeta` 표는 `tabExtraFields` 가 편차 필드를 빼서 손님에겐 안 그려짐, 손님이 본 "미수집"은 `DeviationStrip`).

## 의존 분할 순서
DB 스키마 → 타입 → API → 훅/유틸 → 하위 컴포넌트 → 메인 컴포넌트 → 페이지 라우트

## Guard (위반 시 실행 금지)
- 5파일+ 수정 → 단계 분리
- DB 변경 → 롤백 마이그레이션 명시
- API 변경 → 사용하는 프론트 페이지 나열
- 새 기능 → **에러 처리 / 로딩 상태 / 빈 데이터 / 입력 검증 / 반응형(375px) / 중복 제출 방지** 필수
- "영향 없음" 판정은 **grep 결과 기반**만 인정

## Work
- **feature 브랜치 강제** (세션 439 감사) — 코드 변경 작업은 `main` 에서 직접 하지 말고 `fix/`·`feat/`·`chore/` 브랜치에서. 작업 시작 시 `git branch --show-current` 가 `main` 이면 먼저 브랜치 생성(`git checkout -b <type>/<주제>-s<세션>`). main 직접 push 는 `.claude/hooks/guard-dangerous-bash.sh` 가 차단(exit 2).
  - 머지: `gh pr create` → CI/e2e/Vercel green → `gh pr merge --squash --delete-branch` → `git checkout main && git pull`.
  - 단순 문서 1줄·조회는 브랜치 불필요(판단).
- 계획에 없는 파일 수정/리팩토링 금지 (하고 싶으면 "범위 초과" 표시 후 승인 대기)
- 단계 끝날 때마다 `npx vite build`
- 에러 자동 수정 **3회 실패** 시 중단+보고
- 새 코드에 한국어 주석으로 목적 설명, 기존 네이밍/패턴 따를 것
- **`public/data/*.json` 커밋 금지** — prebuild/build 산출물. `git checkout public/data` 로 원복. `git add public/data` 는 guard hook 차단.
- **작업반(서브에이전트)에 워크트리 작업을 맡길 때 지시서 첫 절 = "⛔ 작업 위치"**(세션567 사고 — 작업반이 워크트리 대신 본 폴더를 고쳤다. 본 폴더는 로컬 러너가 그대로 실행하는 운영 코드): ⚠️ 작업반의 Bash 는 **호출마다 작업 폴더가 본 폴더로 돌아간다** — 첫 `cd` 는 다음 호출에서 풀린다(검사관 3). 그래서 **명령마다 `cd <워크트리> && …` 또는 `git -C <워크트리>`**, 편집 도구엔 `<워크트리>/...` 절대경로만, 끝나기 전 `git -C F:/mibunyang status --short` 가 비었는지 보고. Agent 도구의 `isolation: "worktree"` 도 선택지. 메인도 작업반이 끝나면 본 폴더 clean 을 본다. 진단 경고(`new-diagnostics`)에 본 폴더 경로가 뜨면 즉시 확인.
- **검사관의 뮤테이션도 본 폴더가 아니라 워크트리에서** — 세션567 검사관이 지시서대로 본 폴더에서 뮤테이션(백업→고장→복원)을 해 운영 코드 3파일이 01:57~01:59 잠시 바뀌었다(바이트 동일 원복 · 러너 시각 아님). 검사관 지시서에는 합친 브랜치의 워크트리 경로를 준다.
- **새 SQL 함수·권한/RLS 마이그는 합치기 전 운영 DB 되돌림 시험 1회**(`SET lock_timeout='2s'; SET statement_timeout='30s'; BEGIN; \i 파일; SELECT 새함수(); ROLLBACK;`) — 세션567 에 단위 시험·검사관이 놓친 오류 3개(`pg_catalog.coalesce` · `aclexplode` 빈 배열 · 너무 엄격한 자체검사)를 이것만 잡았다. ⚠️ DROP POLICY·REVOKE 는 가장 강한 잠금을 건다 — **잠금을 기다리는 동안 손님 조회도 막히므로** `lock_timeout` 을 꼭 건다(검사관 3). 대상은 카탈로그를 읽는 함수·권한 마이그로 한정. 적용은 `psql -v ON_ERROR_STOP=1 --single-transaction -f`. 접속 경로는 사장님 지시 때만([supabase/CLAUDE.md](../supabase/CLAUDE.md) "SQL 적용·시험"), 아니면 이 SQL 을 사장님께 드린다.
- **감시 규칙은 실제 DB 스냅숏을 대조군으로 먼저 돌린 뒤 합친다** — 세션567 #588 은 합성 데이터로만 통과한 뒤 첫 실측에서 R1 280건·R4 40 vs 12 잡음이 나와 재작업(#589)했다.
- **상수(기준 명단·목록)를 고치면 그 상수를 보는 시험 파일을 전부 돌린다** — `grep -rln "<상수명>" --include=*.test.* .` 로 목록을 먼저 뽑고, 문서의 옛 개수도 `grep -n "<옛 개수>" .claude/BACKLOG.md` 로 잡는다(세션577: `HOLD_BASELINE_IDS` 1줄 추가 뒤 `monitor-collectors.test` 만 돌려 초록을 봤는데 13곳을 박은 시험은 `monitor-applyhome-unsold.test.mjs` 에 있었다 — 검사관이 잡음).
- **워크트리엔 `.env` 를 `cp` 도 못 한다(deny)** — DB·KOSIS 를 읽는 재시뮬·탐침은 합친 뒤 **본 폴더**에서(러너 창 04:30~06:30 밖). 지시서엔 "재시뮬은 메인이 한다" 로 적어 작업반이 시도하지 않게(세션577). ⚠️ 수집기 로직 PR 은 **pull 한 순간부터 러너가 새 코드를 돌린다** — pull 뒤 다음 러너 회차 전에 재시뮬·전이표 승인을 끝내고, 못 하면 pull 을 보류한다(검사관 C).
- **새 e2e spec 은 워크트리에서 1회 로컬 실행**한 뒤 올린다 — `cd <워크트리> && PATH="/f/mibunyang/node_modules/.bin:$PATH" node ../../../node_modules/@playwright/test/cli.js test e2e/<spec>.ts --project=chromium`(dev 서버는 playwright 가 띄움 — `reuseExistingServer` 라 **시작 전에도** 5173 리스너 0 을 확인하고, 작업반 병렬이면 `PW_BASE_URL` 로 포트를 나눈다; 끝나면 5173 리스너 0 확인). 세션577 A-12 는 CI 가 첫 실행이라 `getByLabel` strict-mode 로 1 failed 났다.
- **수집기를 바꾸면 "자기 출력 위에서 2회차 실행" 시험을 둔다** — 세션567 미분양 수리는 뮤테이션 8종·검사관 2회를 통과했지만, 자기가 쓴 값이 다음 회차에 "보존"으로 분류돼 동결되는 것을 못 봤다(검사관 3).

## Review (커밋 전 자동 수행)
1. **simplify** 스킬 — 변경 코드 재사용성/품질/효율 리뷰
2. **5교차검증 병렬 에이전트** — `Skill(cross-validate)` 자율 발동 (커밋 직전 description 매칭) 또는 Task 도구로 **동일 메시지에서 동시 기동**:
   - **빌드**: 메인 agent가 `npx vite build` 실행 + import 누락 + 번들 크기
   - **스코어링**: `Task(subagent_type="scoring-validator")` — 전용 서브에이전트 호출 **필수**. 메인이 직접 grep 금지
   - **null 안전성**: `Task(subagent_type="null-safety-checker")` — 전용 서브에이전트 호출 **필수**
   - **Hook 규칙**: 메인 agent가 직접 검사 (호출 순서·의존성·조건부 호출)
   - **보안**: 메인 agent가 직접 검사 (XSS·인젝션·env 노출·innerHTML·withHandler)
   - 수집기 관련 변경 시 추가로 `Task(subagent_type="collector-contract")` 호출
3. **세션 메모리에 교차검증 섹션 기록** (글로벌 `~/.claude/projects/f--mibunyang/memory/session_*.md`) — 어느 에이전트가 찍었는지 (예: "스코어링: PASS (scoring-validator)"). 에이전트 호출 이력이 없으면 "검증 미실행"으로 표기
4. console.log 잔재 제거
5. `git commit` + `git push` (자동)
6. CLAUDE.md "현재 진행 상황" 업데이트
7. 세션 일지 = 글로벌 메모리 `~/.claude/projects/f--mibunyang/memory/session_*.md` 에 기록 (한 세션 = 한 파일) + `MEMORY.md` 인덱스 1줄. **`.claude/SESSION_LOG.md` 누적 금지** (세션 296+ drift 재발 방지 — 세션 418 다이어트)

**금지**: 전용 에이전트가 존재하는 축(스코어링, null 안전성, 수집기 계약)을 메인 agent가 **직접 검사하는 것 금지**. 전용 에이전트가 있는데 우회하면 커버리지 누락·결과 비교 불가·SESSION_LOG 추적 불가.

## 안티패턴
1회용 유틸 금지 / 과도한 추상화 금지 / 추측 금지(도구 실행 결과만 인정) / 테스트는 새 기능당 정상 1 + 에러 1 최소
