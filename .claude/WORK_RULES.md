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
| 보안 영역 (auth/sql/env) 편집 | `security-guidance` 플러그인 자동 검토 | OWASP Top 10 / 비밀키 노출 |
| `withHandler` / `api/_lib/` 편집 | `Task(subagent_type=null-safety-checker)` + 보안 직접 점검 | CORS / Rate Limit / Admin / null |
| catch / try / fallback / silent 처리 변경 | `Task(subagent_type=pr-review-toolkit:silent-failure-hunter)` | 빈 catch / 무로그 fallback (collector_runs silent fail 도메인) |

### 0-C. 검색·답습 자율 위임 (탐색 비용 임계)

| 자리 | 자율 위임 도구 | 사유 |
|---|---|---|
| 3+ 쿼리 예상 검색 | `Agent(subagent_type=Explore)` | 메인 context 보호 |
| 모호한 스코프 / 여러 영역 답습 | `Agent(subagent_type=Explore)` 3 병렬 | 의도 파악 우선 |
| 박제값 (NEXT_SESSION/BACKLOG) 답습 진입 | `next-session-grep-mandate.md` 답습 의무 | 환각 차단 |
| 외부 공식 문서 답습 | `Agent(subagent_type=oh-my-claudecode:document-specialist)` | 추측 0 / 출처 박힘 |
| 5+ 관점 동시 검사 | `Agent(subagent_type=oh-my-claudecode:critic)` 3 병렬 + Sonnet | 다관점 + 비용 절약 |

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

## Plan (새 기능/리팩토링 요청 시 자동 진입)
- 단계당 수정+신규 파일 **3개 이하**
- 단일 파일 **80줄 이내**(고위험 50줄), 단일 컴포넌트 **150줄 미만**
- **5파일+** 수정 시 반드시 단계 분리
- DB 변경과 API 변경은 **다른 단계**에서
- 한 단계에 "타입 + API + 컴포넌트" 동시 생성 금지
- 플랜 필수 포함: 파일 목록+참조처(grep 결과) / 실행 순서+의존 / 영향 범위 / 롤백 / 테스트 / 단계별 예상 줄 수

## 의존 분할 순서
DB 스키마 → 타입 → API → 훅/유틸 → 하위 컴포넌트 → 메인 컴포넌트 → 페이지 라우트

## Guard (위반 시 실행 금지)
- 5파일+ 수정 → 단계 분리
- DB 변경 → 롤백 마이그레이션 명시
- API 변경 → 사용하는 프론트 페이지 나열
- 새 기능 → **에러 처리 / 로딩 상태 / 빈 데이터 / 입력 검증 / 반응형(375px) / 중복 제출 방지** 필수
- "영향 없음" 판정은 **grep 결과 기반**만 인정

## Work
- 계획에 없는 파일 수정/리팩토링 금지 (하고 싶으면 "범위 초과" 표시 후 승인 대기)
- 단계 끝날 때마다 `npx vite build`
- 에러 자동 수정 **3회 실패** 시 중단+보고
- 새 코드에 한국어 주석으로 목적 설명, 기존 네이밍/패턴 따를 것

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
