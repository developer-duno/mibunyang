# .claude/rules/ 서브폴더 분리 — 설계 (2026-05-24)

> 글로벌 CLAUDE.md §13 "N>5 시 서브폴더 분리" 트리거 답습. N=7 도달. 도메인 기준 3 폴더 분류.

## 1. 배경

### 1.1 트리거 박제

글로벌 `~/.claude/CLAUDE.md` §13 본문:

> `.claude/rules/` 명명: 카테고리식, 사고 시점은 frontmatter `incident_dates`. **N>5 시 서브폴더 분리**.

현재 `.claude/rules/` = 7 파일 (N=7 ≥ 5 ✅ 트리거 발동):

| 파일 | 크기 (bytes) | 최종 변경 | 도메인 |
|---|---|---|---|
| collector-timeout-rootcause-analysis.md | 5772 | 5/23 | 수집기 운영 |
| kosis-dimension-mismatch-guard.md | 5617 | 5/13 | 수집기 본문 |
| next-session-grep-mandate.md | 5085 | 5/16 | 메타/메모리 |
| parsegu-normalization.md | 4565 | 5/21 | 수집기 본문 |
| secret-naming-audit.md | 6179 | 5/24 | 워크플로 yml |
| typescript-patterns.md | 15084 | 5/10 | 언어/메타 |
| workflow-name-hallucination.md | 3695 | 5/13 | 워크플로 yml |

### 1.2 사고 박제

- 세션 287/295 룰 신규 박제 시 N=6 → 7 도달. NEXT_SESSION L48 박제 = "🟢 `.claude/rules/` 서브폴더 분리 (N>5 트리거 발동)" 후순위.
- 세션 304 (본 세션) E 후보 완결 후 F 진입. 미래 룰 추가 시 N=8+ 도달하면 서브폴더 분리 후 자연 답습 가능.

## 2. 범위

### 2.1 포함

- `.claude/rules/<3 폴더>/` 디렉토리 신설 + 7 파일 `git mv`
- 참조 경로 8건 일괄 갱신 (BACKLOG / BACKLOG_ARCHIVE / NEXT_SESSION / SESSION_LOG / collectors/collector-timeout-rootcause-analysis.md)
- NEXT_SESSION.md F 후보 완결 박제

### 2.2 제외

- 글로벌 CLAUDE.md §13 본문 변경 (서브폴더 사례 추가) = 미래 별 세션 (다른 프로젝트 답습 변경 부담)
- README.md 신규 (각 서브폴더 인덱스) = YAGNI, 새 룰 추가 시 사람 판단 충분
- 심볼릭 링크 (.claude/rules/<원이름>.md → 서브폴더 경로) = Windows 호환성 부담, 답습 자산 stale 위험

## 3. 접근 안 비교

| 기준 | 접근 1 (선택) | 접근 2 | 접근 3 |
|---|---|---|---|
| 구조 | git mv + 참조 일괄 갱신 | 접근 1 + 서브폴더 README | rules/index.md 단일 (서브폴더 0) |
| 글로벌 §13 답습 | ✅ | ✅ | ❌ (서브폴더 실 분리 0) |
| 미래 새 룰 추가 비용 | 사람 판단 1회 | README 갱신 1회 | 인덱스 갱신 1회 |
| 참조 경로 갱신 분량 | ~25줄 | ~30줄 | 0 |
| git history 보존 | ✅ (git mv `--follow`) | ✅ | ✅ |
| 파일 N | 7 → 7 (3 폴더) | 10 (7 + 3 README) | 8 (7 + index) |

**선택 = 접근 1**. 근거:
- §13 트리거 정확 답습 (서브폴더 실 분리 = 의의)
- YAGNI 원칙: README 자체 = 미래 새 룰 추가 시 사람 판단 충분
- 접근 3 = §13 위반 (서브폴더 0 = 분리 의의 0)

## 4. 설계

### 4.1 디렉토리 구조

```
.claude/rules/
├── collectors/   (3 파일 — 수집기 본문/운영)
│   ├── parsegu-normalization.md
│   ├── kosis-dimension-mismatch-guard.md
│   └── collector-timeout-rootcause-analysis.md
├── workflows/    (2 파일 — GitHub Actions yml)
│   ├── secret-naming-audit.md
│   └── workflow-name-hallucination.md
└── meta/         (2 파일 — 메모리/언어/메타)
    ├── next-session-grep-mandate.md
    └── typescript-patterns.md
```

### 4.2 분류 근거

| 파일 | 폴더 | 근거 |
|---|---|---|
| parsegu-normalization | collectors | 수집기 본문 (population.mjs) parseGu 시그니처 사고. 행안부 API SIDO_CODES 검증 의무 |
| kosis-dimension-mismatch-guard | collectors | KOSIS API raw sample 박제 의무 = 수집기 본문 |
| collector-timeout-rootcause-analysis | collectors | collector_runs 4-way 답습 = 수집기 운영 |
| secret-naming-audit | workflows | yml env block 3-way 동기화 (본 세션 304 보강 완료) |
| workflow-name-hallucination | workflows | workflow_dispatch raw log 의무 = yml 본문 |
| next-session-grep-mandate | meta | NEXT_SESSION/메모리 grep 의무 = 메타 |
| typescript-patterns | meta | TypeScript JSDoc 박제 자산 16 패턴 = 언어 |

### 4.3 참조 경로 갱신 (8건)

| 파일 | 라인 | 박제 변경 |
|---|---|---|
| `.claude/BACKLOG.md` | 223 | `rules/collector-timeout-rootcause-analysis.md` → `rules/collectors/collector-timeout-rootcause-analysis.md` |
| `.claude/BACKLOG_ARCHIVE.md` | 25 | `rules/secret-naming-audit.md` → `rules/workflows/secret-naming-audit.md` |
| `.claude/BACKLOG_ARCHIVE.md` | 182 | `rules/kosis-dimension-mismatch-guard.md` → `rules/collectors/kosis-dimension-mismatch-guard.md` |
| `.claude/NEXT_SESSION.md` | 48 | F 후보 완결 박제 (✅ + 본 세션 304 박제) |
| `.claude/SESSION_LOG.md` | 198 | F 후보 박제 본 세션 답습 |
| `.claude/SESSION_LOG.md` | 271 | `rules/next-session-grep-mandate.md` → `rules/meta/next-session-grep-mandate.md` |
| `.claude/SESSION_LOG.md` | 276 | `rules/secret-naming-audit.md` → `rules/workflows/secret-naming-audit.md` |
| `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` | 마지막 줄 | `rules/secret-naming-audit.md` → `rules/workflows/secret-naming-audit.md` |

L325/342/350 SESSION_LOG = `.claude/rules/` 일반 표현 (특정 파일 없음) = 변경 0.

### 4.4 작업 흐름

```
1. mkdir 3 폴더 (.claude/rules/{collectors,workflows,meta})
2. git mv 7 파일
3. 참조 경로 일괄 Edit (~10건)
4. git status + git diff --stat 확정
5. commit 1건 (git mv = rename + content 변경 동시 답습)
6. push (사용자 명시 확인 후)
```

### 4.5 작업 분량

| 단계 | 작업 | 분량 |
|---|---|---|
| 1 | mkdir 3 + git mv 7 | 10 명령 |
| 2 | 참조 경로 Edit (8건) | ~12줄 변경 |
| 3 | NEXT_SESSION.md F 완결 박제 | 1 줄 |
| 4 | commit 1건 + push | - |

**총 변경**: ~13줄 (참조 경로 + NEXT_SESSION 박제), 7 파일 mv (히스토리 보존 `git log --follow`).

### 4.6 검증

1. **git mv 답습 확정** — `git status` 에서 `R100` (100% rename) 또는 `R<XX>%` 확정 (content 변경 없으면 R100)
2. **참조 경로 grep 0** — 갱신 후 `grep -rn "\.claude/rules/<원이름>" .claude/` 결과 0 확정
3. **답습 자산 부재 검증** — sangse-agent/claude-md-improver 등 외부 답습 = 0 (별 codebase)

### 4.7 9 GATE 검증 (실행 단계)

1. **시뮬레이션 의무** = 본 작업은 .md 파일 mv = typecheck 의무 0
2. **자가 점검 1** = 참조 경로 8건 누락 0 확정 (grep `\.claude/rules/.*\.md` 결과 = 7 = 모두 서브폴더 경로)
3. **자가 점검 2** = NEXT_SESSION L48 F 후보 완결 박제 갱신 + claude-md-improver 한계 박제 (§13 답습) 미래 대비

## 5. 위험 + 완화

| 위험 | 완화 |
|---|---|
| Windows git mv case-sensitive | 7 파일 모두 소문자 = 0 위험 |
| CRLF 경고 | 기존 답습 자산, 동작 0 영향 |
| claude-md-improver 한계 | `find . -name CLAUDE.md` 만 답습 → `.claude/rules/<서브폴더>/X.md` 미인지 = 현재도 동일 (변경 0) |
| 답습 자산 stale (외부 codebase) | mibunyang 단독 답습 = sangse-agent 별 codebase, 0 영향 |
| 미래 새 룰 추가 시 폴더 결정 | 사람 판단 1회 = README 회피 (YAGNI), 본 spec §4.2 분류 근거 답습 |

## 6. 답습 자산

- 글로벌 `~/.claude/CLAUDE.md` §13 (트리거 박제)
- NEXT_SESSION.md L48 F 후보 박제 (현재)
- SESSION_LOG.md L325/342/350 (세션 287 박제 — N=6 → 7 트리거 부담 인지)
- 본 spec 종결 후 = writing-plans skill 발동 → 실행 단계 진입
