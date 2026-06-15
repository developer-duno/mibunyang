# Claude 도구 카탈로그 (mibunyang)

> 작성: 세션 184 (2026-05-05). 갱신: 세션 340 (2026-05-28) — supabase + typescript-lsp + security-guidance 3 플러그인 project scope 신규 + stale `.mcp.json` 박힘 정정.
>
> **원칙**: 글로벌 자산은 함부로 수정 금지. 사용만 가능. 신규 도입 시 사용자 동의 + 스코프 결정 필수.

---

## 세션 340 적용 결과 (자율 발동 강화)

본 세션 추가:
- ✅ Supabase MCP read-only 우선 + project_ref scoping (`.mcp.json` 신규)
- ✅ typescript-lsp 글로벌 의존 설치 (`typescript-language-server` + `typescript`)
- ✅ security-guidance 도메인 가이드 (`.claude/claude-security-guidance.md` 60줄) + 결정적 패턴 (`.claude/security-patterns.yaml` 13 rule)
- ✅ WORK_RULES.md §0 Auto-Tool 자율 발동 매트릭스 6 카테고리 신규
- ✅ 자가 점검 = security-guidance PostToolUse 자동 발화 정상 작동 검증

세션 340 이후 자동 발동:
- TS 파일 편집 → typescript-lsp 자동 진단
- 보안 영역 편집 → security-guidance pattern 체크 (model 호출 0건, 비용 0)
- 턴 종료 시 → security-guidance diff 리뷰 (background, 응답 지연 0)
- git commit/push 시 → security-guidance 깊이 리뷰 (시간당 20회 cap)
- DB 조회 표현 → `supabase-readonly` MCP 자동 호출 (첫 OAuth 1회 후)

---

## 한 화면 요약 — 어떤 상황에 무슨 도구

| 상황 | 1순위 도구 | 호출 |
|---|---|---|
| 새 기능·리팩토링 시작 | `superpowers:brainstorming` + `superpowers:writing-plans` | Skill |
| 버그·테스트 실패·재현 | `superpowers:systematic-debugging` + `engineering:debug` | Skill |
| 새 코드 작성 (TDD) | `superpowers:test-driven-development` | Skill |
| UI/컴포넌트 만들기 | `frontend-design:frontend-design` | Skill (자동) |
| UI 변경 후 검증 | `webapp-testing` (Playwright MCP) | Skill |
| Supabase 쿼리·DB 진단 | `data:sql-queries` / `data:explore-data` | Skill |
| 트렌드/세그먼트 분석 | `data:analyze` | Skill |
| 외부 장애 (행안부/네이버 500) | `engineering:incident-response` | Skill |
| 품질 갭 전략 (price 64% 등) | `engineering:tech-debt` | Skill |
| 커밋 전 5교차검증 | `cross-validate` (프로젝트 스킬, 자율 발동) | Skill |
| 커밋·PR | `commit-commands:commit` / `commit-commands:commit-push-pr` | 슬래시 |
| PR 코드 리뷰 | `pr-review-toolkit:review-pr` 또는 `/code-review:code-review` | 슬래시 |
| 스코어링 검증 | `Task(subagent_type="scoring-validator")` | Task |
| null 안전성 | `Task(subagent_type="null-safety-checker")` | Task |
| 수집기 계약 | `Task(subagent_type="collector-contract")` | Task |
| 네이버 수집 실행 | `/collect-naver` | 슬래시 |
| 점수 재계산 | `score-recalc` (스킬, 자율) | Skill |
| DB 품질 측정 | `db-quality` (스킬, 자율) | Skill |
| 세션 종료 정리 | `session-report` + `/claude-md-management:revise-claude-md` | Skill |
| CLAUDE.md 점검·갱신 | `claude-md-management:claude-md-improver` | Skill |
| **Vercel 배포·env 조회** | Vercel MCP 도구 (`/mcp` 인증 후) | MCP tool |
| **Supabase 쿼리 (read-only)** | Supabase MCP 도구 (`/mcp` 인증 후) | MCP tool |
| **PDF 분석/생성** | document-skills (자동 활성, plugin) | Skill |
| **TS/TSX 편집 후 자동 검증** | PostToolUse hook (자동, 무조작) | 자동 |

---

## 글로벌 자산 (`~/.claude/`) — 수정 금지, 사용만

> 위치: `C:\Users\user\.claude\settings.json`
> 변경 시 백업: `~/.claude/backups/` 또는 `_backup/` 디렉토리에 미리 보관 후

### 활성 Plugin (10) — 자동 사용 가능

| 플러그인 | 출처 | 주요 산출 | 호출 예 |
|---|---|---|---|
| `code-review@claude-plugins-official` | 공식 | `/code-review:code-review` | 슬래시 |
| `pr-review-toolkit@claude-plugins-official` | 공식 | `/pr-review-toolkit:review-pr` + 6 서브에이전트 | 슬래시 / Task |
| `commit-commands@claude-plugins-official` | 공식 | `/commit` `/commit-push-pr` `/clean_gone` | 슬래시 |
| `claude-md-management@claude-plugins-official` | 공식 | `claude-md-improver` skill + `/revise-claude-md` | Skill / 슬래시 |
| `hookify@claude-plugins-official` | 공식 | hook 자동 생성 | `/hookify:configure` `/hookify:hookify` |
| `code-simplifier@claude-plugins-official` | 공식 | `simplify` 스킬 | Skill |
| `typescript-lsp@claude-plugins-official` | 공식 | LSP 도구 | 자동 (LSP 호출) |
| `pyright-lsp@claude-plugins-official` | 공식 | Python LSP | 자동 |
| `frontend-design@claude-plugins-official` | 공식 | `frontend-design` skill | Skill (UI 작업 시 자동) |
| `superpowers@claude-plugins-official` | 공식 | brainstorming / TDD / debugging / verification 등 13+ skills | Skill |

### Hooks (2)

| 이벤트 | 스크립트 | 효과 |
|---|---|---|
| `SessionStart` | `~/.claude/hooks/session-start-load.sh` | 직전 세션 NEXT_SESSION.md 컨텍스트 주입 |
| `SessionEnd` | `~/.claude/hooks/session-end-snapshot.sh` | 다음 세션용 시작 명령어 자동 박제 |

### MCP Server (1)

| 서버 | 명령 | 용도 |
|---|---|---|
| `playwright` | `npx -y @playwright/mcp@latest` | webapp-testing skill (Playwright 브라우저 제어) |

### 환경변수 / 권한

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — Agent Teams 활성 (`team_name` 파라미터)
- `ENABLE_CLAUDEAI_MCP_SERVERS=false` — claude.ai 원격 MCP 차단
- `effortLevel=max` — 최대 추론 강도
- 권한 `allow`: git/npm/npx tsc/tsx/vitest/playwright, node -e, awk, curl
- `additionalDirectories`: mibunyang plans, sangse, ~/.claude

### 자주 쓰는 Skills (system-reminder의 available skills 리스트 참조)

- **superpowers**: brainstorming / writing-plans / executing-plans / TDD / systematic-debugging / verification-before-completion / receiving-code-review / requesting-code-review / dispatching-parallel-agents / using-git-worktrees / writing-skills
- **engineering**: debug / architecture / code-review / documentation / deploy-checklist / standup / incident-response / testing-strategy / tech-debt / system-design
- **data**: analyze / create-viz / explore-data / data-visualization / sql-queries / write-query / build-dashboard / validate-data / statistical-analysis / data-context-extractor
- **frontend-design** / **webapp-testing** / **claude-api** / **session-report** / **claude-md-improver**

---

## 프로젝트 자산 (`f:\mibunyang\.claude\`) — 살아있음

### 활성 Plugin (6) — 세션 340 갱신 (+3)

| 플러그인 | 출처 | 용도 |
|---|---|---|
| `engineering@knowledge-work-plugins` | knowledge-work | 디버깅·아키텍처·인시던트 등 10개 skill |
| `data@knowledge-work-plugins` | knowledge-work | SQL·시각화·분석 10개 skill |
| `session-report@claude-plugins-official` | 공식 | 세션 토큰/스킬 사용 HTML 리포트 |
| `supabase@claude-plugins-official` | 공식 (세션 340 신규, v0.1.9) | Supabase MCP — DB SQL + 스키마 + Edge Function (25 tool, 공식 답습 검증) |
| `typescript-lsp@claude-plugins-official` | 공식 (세션 340 신규, v1.0.0) | TS 진단 자동 + goto definition + find references (TS 98% 프로젝트 필수). 사전 의무 = `npm i -g typescript-language-server typescript` (세션 340 완료) |
| `security-guidance@claude-plugins-official` | 공식 (세션 340 신규, v2.0.0) | 3 layer hook — 편집 직후 pattern + 턴 종료 diff 리뷰 + commit/push 깊이 리뷰 (사전 의무 = Python 3.8+, 첫 실행 시 venv 자동 생성) |

### MCP 서버 (2) — 세션 340 갱신

| 서버 | 출처 | URL | 인증 | 용도 |
|---|---|---|---|---|
| `plugin:supabase:supabase` | 플러그인 경유 | `https://mcp.supabase.com/mcp` | OAuth 첫 호출 시 자동 | read-write 가능 (Edge Function 배포 등) |
| `supabase-readonly` | `.mcp.json` 직접 (세션 340 신규) | `https://mcp.supabase.com/mcp?project_ref=rwdtljipvmqpazrimyns&read_only=true` | OAuth | mibunyang 운영 DB 보호 모드 |

**우선순위**: 일상 조회 / 분석 = `supabase-readonly` 권장. 스키마 변경 / 마이그 / Edge Function 배포 = 플러그인 기본 + 사용자 명시 의무.

**Supabase MCP 25 tool 카테고리** (공식 답습): Database 5 (list_tables / list_extensions / list_migrations / apply_migration / execute_sql) + Debugging 2 (get_logs / get_advisors) + Development 3 (get_project_url / get_publishable_keys / generate_typescript_types) + Edge Functions 3 + Account 6 + Docs 1 (search_docs) + Branching 6 + Storage 2.

**Vercel MCP 추가 시**: 글로벌 룰 [mcp-vs-cli.md](../../.claude/rules/mcp-vs-cli.md) 답습 = CLI 우선. Vercel 조회 = `vercel` CLI 직접 호출이 정확 + 안전.

### Subagents (3) — `Task(subagent_type=...)`

| 에이전트 | 검증 영역 | 호출 시점 |
|---|---|---|
| `scoring-validator` | 가중치 합계·클램핑·null 처리 | 스코어링 코드 변경 시 자동 (Review 단계) |
| `null-safety-checker` | optional chaining·기본값·숫자 포맷 | 수집/API/렌더 코드 변경 시 자동 |
| `collector-contract` | 배치/upsert/Promise.all/에러 처리 | scripts/collectors/ 변경 시 자동 |

### Slash Commands (4) — `.claude/commands/`

| 항목 | 종류 | 용도 |
|---|---|---|
| `/collect-naver` | 커맨드 | 네이버 수집 + post-naver-collect 파이프라인 |
| `score-recalc` | 스킬 (자율) | 점수 재계산 + PROFILES 가중치 sanity (세션 418 command→skill 승격) |
| `cross-validate` | 스킬 (자율) | simplify + 5교차검증 병렬 (Review 단계 자동화) |
| `db-quality` | 스킬 (자율) | apartments_flat 품질 지표 재측정 |

### Hooks (4)

| 이벤트 | 효과 |
|---|---|
| `SessionStart` | cwd가 mibunyang인지 확인 (D:\ 재발 방지) |
| `PostToolUse(Edit\|Write)` 1번 | 5파일+ 편집 시 `.build-dirty` 플래그 → 단계 분리 경고 |
| `PostToolUse(Edit\|Write)` 2번 | TS/TSX 편집 시 `tsc --noEmit` + `eslint <file>` 자동 (2026-05-06 도입, 비차단 stderr) |
| `Stop` | build 권장 + 카운터/플래그 리셋 |

스크립트 파일: `f:\mibunyang\.claude\hooks\post-edit-ts-check.sh` (38줄, jq 미설치 환경 대응 — node 로 stdin JSON 파싱).

### 인덱스 문서 (`.claude/*.md`)

| 파일 | 용도 |
|---|---|
| `CLAUDE_TOOLBOX.md` | **본 파일** — 도구 카탈로그 |
| `SKILLS.md` | mibunyang 자주 쓰는 스킬 10개 매핑 |
| `LOCAL_RESOURCES.md` | 커맨드·서브에이전트·훅 요약 |
| `WORK_RULES.md` | Plan → Guard → Work → Review 4단계 |
| `META_RULES.md` | CLAUDE.md 본문 편집 메타 규칙 (150줄 상한) |
| `EASY_WORDS.md` | 사용자 대화 시 쉬운 말 원칙 |
| `ENV_VARS.md` | 환경변수 목록 |
| `NEXT_SESSION.md` | 다음 세션 시작점 (세션 종료 시 갱신) |
| `SESSION_LOG.md` | 세션 1~ 누적 일지 (불변, append만) |
| `BACKLOG.md` | 보류 작업 |
| `DB_QUALITY.md` | apartments_flat 품질 지표 |
| `IMPROVE_REPORT_2026-05-02.md` | /improve 33건 분석 |

---

## 외부 후보

### Tier 1 — 도입 완료 (2026-05-06 세션 184)

위의 "프로젝트 자산 — Plugin (4) / MCP 서버 (2) / Hooks (4)" 섹션 참조. 4종 모두 프로젝트 스코프(`f:\mibunyang\.claude\` + `.mcp.json`)로 박제됨.

도입 후 1주 사용 후 가치 재평가 예정. 사용 안 하면 제거.

### Tier 2 — 잠재 가치

| # | 도구 | 출처 | 1줄 | 가치 |
|---|---|---|---|---|
| 5 | **VoltAgent/awesome-claude-code-subagents** | github.com/VoltAgent | react-specialist / typescript-pro / postgres-pro 등 100+ | 중간 (개별 복사 후 `.claude/agents/` 박제) |
| 6 | **ComposioHQ/awesome-claude-skills** | github.com/ComposioHQ | vercel-automation / supabase-automation 스킬 | 중간 |
| 7 | **rohitg00/awesome-claude-code-toolkit** | github.com/rohitg00 | 135 agents + 35 skills 통합 | 미검증 |

### Tier 3 — 한국어 도메인 (결론: mibunyang 적합 도구 사실상 부재)

| # | 도구 | 출처 | 결론 |
|---|---|---|---|
| 8 | **uju777/mcp-server-naver-search** | github.com | 검색 MCP — mibunyang은 매물 직접 크롤링이라 별 가치 |
| 9 | **zeikar/kimcp** | github.com | 네이버+카카오+TMAP — 부동산 전용 도구 0건 (WebFetch 실측) |
| 10 | **한국 부동산 전용 MCP** | — | **존재하지 않음 (확정)** — 자체 collector-contract + scripts/가 더 적합 |
| 11 | **Korean NLP MCP** (KoNLPy/Kiwi) | — | 공식 MCP 없음. mibunyang에 NLP 작업 없음 → 불필요 |
| 12 | **공공데이터포털 MCP** | — | 존재하지 않음. `MOLIT_KEY` + scripts 직접 호출이 최적 |

**한국어 도메인 결론**: mibunyang의 한국 부동산 도메인 특화 외부 도구는 사실상 부재. 자체 자산(scripts/, collector-contract agent, .claude/commands)이 이미 도메인 최적화돼 있음. 신규 도입 불필요.

---

## 신규 도입 시 의무 절차

외부 도구를 도입하기로 결정하면:

1. **사용자 동의** — 별도 plan 생성, 도구 1개씩
2. **스코프 결정** — 글로벌(`~/.claude/`) vs 프로젝트(`.claude/`)
   - 모든 프로젝트에 공통 = 글로벌
   - mibunyang 전용 = 프로젝트 (글로벌 오염 방지)
3. **백업** — 변경 전 settings.json 백업 (`_backup/settings.json.bak-YYYYMMDD`)
4. **검증** — 1주일 사용 후 가치 판정. 안 쓰면 제거
5. **카탈로그 갱신** — 본 파일에 활성 자산으로 이동, 외부 후보에서 삭제

---

## 외부 후보 stale 가능성

본 카탈로그의 외부 후보는 **2026-05-05 시점 조사**. 1주일+ 경과 후 도입 검토 시:
- URL 유효성 재확인 (404 가능)
- 별점/star 변동 확인
- 한국 부동산 MCP "없음" 단정도 stale 가능 → 도입 직전 search 1회 재실행
