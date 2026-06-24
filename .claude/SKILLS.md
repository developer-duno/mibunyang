# 이 프로젝트에서 자주 쓰는 스킬

> Claude는 스킬 리스트를 시스템 리마인더로 이미 받고 있음. 아래는 mibunyang에서 유독 자주 쓰는 것 — 상황이 맞으면 **사용자 명령 입력 없이 자동 호출**.
>
> **자율 발동의 진실의 원천 = [WORK_RULES.md §0 매트릭스](WORK_RULES.md)** (0-A 작업모드 / 0-B 편집후 / 0-C 검색위임 / 0-D DB / 0-E 커밋 / 0-G 외부폴링 / 0-F 차단). 아래 목록은 그 매트릭스가 발동하는 스킬의 요약. 충돌 회피 = `/goal`·`ralph`·`ulw-safe` 중 한 task 에 1개만.

## 자율 루프 (완료조건/시간 기반)

- **`/goal`** — 완료조건 명확 + 사용자 검증 가능한 반복 작업. [GOAL_TEMPLATE.md](GOAL_TEMPLATE.md) 4항목 구조 자율 설정. ("vitest 통과까지", "ISSUE-N PR 생성까지")
- **`oh-my-claudecode:ralph`** — 같은 task 완료조건까지 무정지 반복 (PRD형). ulw-safe·/goal 동시 금지
- **`ulw-safe`** — "전부/다/모든" + 30분+ / 7+ 파일. 60분·카운팅 자기정지 안전모드
- **`/loop` · `Monitor`** — CI/cron run cancelled 감시 등 외부 비동기 폴링 (시간 기반)

## 진단 / 검증

- **`/engineering:debug` · `superpowers:systematic-debugging`** — 재현 필요한 버그, "X가 안 됨"
- **`oh-my-claudecode:trace`** — timeout·cancelled 5+ 경쟁 가설 진단 (4-way 답습 형식화)
- **`superpowers:verification-before-completion`** — "완료/통과/고침" 주장 직전 증거 강제
- **`pr-review-toolkit:silent-failure-hunter`** — catch/fallback/silent 처리 변경 시 (collector_runs silent fail 도메인)
- **`/engineering:incident-response`** — 행안부 API 500/502 외부 장애, 네이버 수집 실패 연쇄

## 데이터 / 쿼리

- **`/data:sql-queries` · `/data:explore-data`** — Supabase 쿼리 작성, apartments_flat 품질 진단
- **`/data:analyze`** — price/unsoldRate 트렌드/세그먼트 조사
- **`/data:validate-data` · `/data:statistical-analysis`** — 데이터 품질 검증 / 분석 공유 직전 (NULL률·이상치·denominator shift)

## 프로젝트 전용 스킬 (`.claude/skills/`, 자율 발동)

> 세션 418: cross-validate·db-quality·score-recalc 를 command → **skill 승격** (커맨드는 자동발동 불가, 스킬은 `description`/`when_to_use` 매칭으로 타이핑 0 자율 발동 — [auto-tool-usage.md](../../../Users/user/.claude/rules/auto-tool-usage.md) 공식 메커니즘).

- **`cross-validate`** — 커밋/PR 직전 simplify + 5교차검증 병렬 (빌드·스코어링·null·Hook·보안)
- **`db-quality`** — apartments_flat 품질 지표 재측정 + 세션 318 기준 회귀 점검
- **`score-recalc`** — 스코어 재계산 + PROFILES 5종 가중치 합계 sanity
- **`release`** (세션 439) — PR 머지 후 Vercel 배포 확인 + production(`미분양아파트.com`) 라이브 검증 + 👤 잔여 정리. 머지 직후 자동 발동
- **`worktree-cleanup`** (세션 439) — stale worktree·고아 디렉토리 안전 정리 (메타 확인·미머지 점검 후 PowerShell Remove-Item). worktree 작업 종료 후
- **`backlog-archive`** (세션 439) — BACKLOG 완료 색인(✅) ARCHIVE 이동 (손실 0 검증). BACKLOG 100KB+ 또는 색인 누적 시

## UI / 리뷰 / 마무리

- **`webapp-testing`** — UI 변경 후 브라우저 검증 (Playwright, **필수**)
- **`frontend-design`** — 새 컴포넌트/섹션 작성 시 자동 발동. Pretendard · C.borderStrong · memo 45개 구조 일관성
- **`/code-review:code-review`** — GitHub PR 리뷰 (로컬 5교차검증과는 별개)
- **`/engineering:tech-debt`** — maintenance/builders/benefits 같은 품질 갭 전략 (DB_QUALITY.md 실측 기준)
- **`simplify` · `commit`** — 커밋 전 자동 (Review 단계에서 호출)
- **`session-report` + `/claude-md-management:revise-claude-md`** — 세션 마무리 시
