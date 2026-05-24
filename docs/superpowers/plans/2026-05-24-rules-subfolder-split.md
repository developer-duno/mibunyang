# .claude/rules/ 서브폴더 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.claude/rules/` 7 파일을 도메인 기준 3 서브폴더 (collectors/workflows/meta) 로 분리하고 참조 경로 15건 일괄 갱신.

**Architecture:** `git mv` 7회 + Edit 15건 + 1 commit. git history 보존 (`git log --follow`). 코드 변경 0 (md 만), CI 영향 0.

**Tech Stack:** Bash (mkdir + git mv), Edit tool.

---

## File Structure

| 파일 | 역할 | 변경 |
|---|---|---|
| `.claude/rules/collectors/` | 디렉토리 신설 (수집기 본문/운영 3 파일) | Create |
| `.claude/rules/workflows/` | 디렉토리 신설 (yml 2 파일) | Create |
| `.claude/rules/meta/` | 디렉토리 신설 (메모리/언어 2 파일) | Create |
| `.claude/rules/<7 파일>` | git mv → 각 서브폴더 | Rename |
| `.claude/BACKLOG.md` | 경로 갱신 1건 (L223) | Modify |
| `.claude/BACKLOG_ARCHIVE.md` | 경로 갱신 2건 (L25, L182) | Modify |
| `.claude/NEXT_SESSION.md` | F 후보 완결 박제 (L48~) | Modify |
| `.claude/SESSION_LOG.md` | 경로 갱신 8건 + F 진척 박제 | Modify |
| `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` | L82 secret-naming 참조 갱신 | Modify (mv 후) |

> 참조 경로 갱신 = **spec § 4.3 박제 8건 + 본 plan 발견 7건 = 총 15건** (spec 누락 7건 박제: SESSION_LOG L502/533/917/972/1326/1500/1548)

---

## Task 1: 3 서브폴더 신설 + git mv 7 파일

**Files:**
- Create dir: `.claude/rules/{collectors,workflows,meta}/`
- Rename: 7 파일 (collector-timeout / kosis-dimension / parsegu / secret-naming / workflow-name / next-session-grep / typescript-patterns)

- [ ] **Step 1: mkdir 3 폴더**

Command: `cd f:/mibunyang && mkdir -p .claude/rules/collectors .claude/rules/workflows .claude/rules/meta`

Expected: 3 폴더 신설, 에러 0.

- [ ] **Step 2: git mv 3 collectors 파일**

Command:
```
cd f:/mibunyang
git mv .claude/rules/parsegu-normalization.md .claude/rules/collectors/parsegu-normalization.md
git mv .claude/rules/kosis-dimension-mismatch-guard.md .claude/rules/collectors/kosis-dimension-mismatch-guard.md
git mv .claude/rules/collector-timeout-rootcause-analysis.md .claude/rules/collectors/collector-timeout-rootcause-analysis.md
```

Expected: 에러 0.

- [ ] **Step 3: git mv 2 workflows 파일**

Command:
```
cd f:/mibunyang
git mv .claude/rules/secret-naming-audit.md .claude/rules/workflows/secret-naming-audit.md
git mv .claude/rules/workflow-name-hallucination.md .claude/rules/workflows/workflow-name-hallucination.md
```

Expected: 에러 0.

- [ ] **Step 4: git mv 2 meta 파일**

Command:
```
cd f:/mibunyang
git mv .claude/rules/next-session-grep-mandate.md .claude/rules/meta/next-session-grep-mandate.md
git mv .claude/rules/typescript-patterns.md .claude/rules/meta/typescript-patterns.md
```

Expected: 에러 0.

- [ ] **Step 5: git status 답습 — R100 7건 확정**

Command: `cd f:/mibunyang && git status --short`

Expected: 7 rename 라인 (`R  .claude/rules/<원>.md -> .claude/rules/<폴더>/<원>.md`).

---

## Task 2: BACKLOG + BACKLOG_ARCHIVE 참조 갱신 (3건)

**Files:**
- Modify: `.claude/BACKLOG.md` (L223)
- Modify: `.claude/BACKLOG_ARCHIVE.md` (L25, L182)

- [ ] **Step 1: BACKLOG.md L223 갱신**

`old_string`:
```
  - 답습 자산: `.claude/rules/collector-timeout-rootcause-analysis.md` 신규 (4-way 답습 의무 박제)
```

`new_string`:
```
  - 답습 자산: `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 신규 (4-way 답습 의무 박제)
```

- [ ] **Step 2: BACKLOG_ARCHIVE.md L25 갱신**

`old_string`:
```
  - 답습: `.claude/rules/secret-naming-audit.md` (3-way 동기화 의무 룰 박힘)
```

`new_string`:
```
  - 답습: `.claude/rules/workflows/secret-naming-audit.md` (3-way 동기화 의무 룰 박힘)
```

- [ ] **Step 3: BACKLOG_ARCHIVE.md L182 갱신**

`old_string`:
```
  - 답습: `.claude/rules/kosis-dimension-mismatch-guard.md` (통계표 차원 = 분리 group vs 교차 cell 판정, raw API sample 박제 의무)
```

`new_string`:
```
  - 답습: `.claude/rules/collectors/kosis-dimension-mismatch-guard.md` (통계표 차원 = 분리 group vs 교차 cell 판정, raw API sample 박제 의무)
```

---

## Task 3: SESSION_LOG.md 참조 갱신 (8건)

**Files:**
- Modify: `.claude/SESSION_LOG.md` (L271, L276, L502, L533, L917, L972, L1326, L1500, L1548 — 총 9건이지만 L1500/L1548 = kosis-dimension 동일 박제 자리 = 2건)

> 본 plan 발견: spec § 4.3 박제 2건 (L271, L276) 이외 7건 추가 (L502, L533, L917, L972, L1326, L1500, L1548). L325/342/350 = 일반 표현 변경 0.

- [ ] **Step 1: L271 next-session-grep 갱신**

`old_string`:
```
`.claude/rules/next-session-grep-mandate.md` §1 답습 효과 확정 (NEXT_SESSION 박제값 단정 금지 + 메모리/collector/사용자 콘솔 grep 의무).
```

`new_string`:
```
`.claude/rules/meta/next-session-grep-mandate.md` §1 답습 효과 확정 (NEXT_SESSION 박제값 단정 금지 + 메모리/collector/사용자 콘솔 grep 의무).
```

- [ ] **Step 2: L276 secret-naming 갱신**

`old_string`:
```
- 4 파일 동시 정정 = `.claude/rules/secret-naming-audit.md` §"3-way 동기화" 답습 (code + workflow + orchestrator)
```

`new_string`:
```
- 4 파일 동시 정정 = `.claude/rules/workflows/secret-naming-audit.md` §"3-way 동기화" 답습 (code + workflow + orchestrator)
```

- [ ] **Step 3: L502 parsegu 갱신**

`old_string`:
```
- 자매 SIDO 매핑 변수 박제 시 grep 의무 (`.claude/rules/parsegu-normalization.md` §4)
```

`new_string`:
```
- 자매 SIDO 매핑 변수 박제 시 grep 의무 (`.claude/rules/collectors/parsegu-normalization.md` §4)
```

- [ ] **Step 4: L533 parsegu 갱신**

`old_string`:
```
- `.claude/rules/parsegu-normalization.md` (세션 286 박제) §1·2·3·4 답습 원천
```

`new_string`:
```
- `.claude/rules/collectors/parsegu-normalization.md` (세션 286 박제) §1·2·3·4 답습 원천
```

- [ ] **Step 5: L917 workflow-name 갱신**

`old_string`:
```
- **"세션 N에 작성됐고 CI pass" ≠ "동작한다"** — 세션 237 collector 는 코드·테스트·CI 모두 green 이었으나 마이그 Dashboard 적용 누락으로 운영 0회. NEXT_SESSION "#4 작업량 가장 가벼움" 박제도 "완성 작업"으로 오해 유발. plan 진입 시 dry-run 실측으로 미완 상태 확정 (`.claude/rules/workflow-name-hallucination.md` 답습 — 이름·기록 ≠ 동작)
```

`new_string`:
```
- **"세션 N에 작성됐고 CI pass" ≠ "동작한다"** — 세션 237 collector 는 코드·테스트·CI 모두 green 이었으나 마이그 Dashboard 적용 누락으로 운영 0회. NEXT_SESSION "#4 작업량 가장 가벼움" 박제도 "완성 작업"으로 오해 유발. plan 진입 시 dry-run 실측으로 미완 상태 확정 (`.claude/rules/workflows/workflow-name-hallucination.md` 답습 — 이름·기록 ≠ 동작)
```

- [ ] **Step 6: L972 workflow-name 갱신**

`old_string`:
```
- 마이그레이션 `20260516090916_add_schools_nearby_childcare.sql` Dashboard SQL Editor 직접 실행 (👤 사용자) — `.claude/rules/workflow-name-hallucination.md` 답습
```

`new_string`:
```
- 마이그레이션 `20260516090916_add_schools_nearby_childcare.sql` Dashboard SQL Editor 직접 실행 (👤 사용자) — `.claude/rules/workflows/workflow-name-hallucination.md` 답습
```

- [ ] **Step 7: L1326 next-session-grep 갱신**

`old_string`:
```
## 룰 신규 박제 — `.claude/rules/next-session-grep-mandate.md` (+85줄)
```

`new_string`:
```
## 룰 신규 박제 — `.claude/rules/meta/next-session-grep-mandate.md` (+85줄)
```

- [ ] **Step 8: L1500 + L1548 kosis-dimension 일괄 갱신 (replace_all)**

`old_string`:
```
.claude/rules/kosis-dimension-mismatch-guard.md
```

`new_string`:
```
.claude/rules/collectors/kosis-dimension-mismatch-guard.md
```

`replace_all`: true (2건 동시 일괄)

---

## Task 4: collectors/collector-timeout 본문 참조 갱신 (1건)

**Files:**
- Modify: `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` (L82)

- [ ] **Step 1: L82 secret-naming 참조 갱신**

`old_string`:
```
- `.claude/rules/secret-naming-audit.md` §"운영 모니터링 (월간 schedule)" 절 답습 (월간 cron 데드 존 박제)
```

`new_string`:
```
- `.claude/rules/workflows/secret-naming-audit.md` §"운영 모니터링 (월간 schedule)" 절 답습 (월간 cron 데드 존 박제)
```

---

## Task 5: NEXT_SESSION.md F 후보 완결 박제

**Files:**
- Modify: `.claude/NEXT_SESSION.md` (L48~50)

- [ ] **Step 1: F 후보 완결 박제 추가**

`old_string`:
```
### F. 🟢 `.claude/rules/` 서브폴더 분리 (N>5 트리거 발동)

세션 295 신규 룰 박제 후 N=7 도달. CLAUDE.md §13 답습 트리거. 카테고리 4 서브폴더 + 인덱스 갱신.
```

`new_string`:
```
### F. ✅ `.claude/rules/` 서브폴더 분리 (세션 304 완료)

세션 295 신규 룰 박제 후 N=7 도달. CLAUDE.md §13 답습 트리거. 도메인 기준 3 서브폴더 분류 완료 (collectors/3 + workflows/2 + meta/2). 참조 경로 15건 일괄 갱신.
```

---

## Task 6: 검증 + Commit + Push

**Files:** (없음 — 검증 + commit 만)

- [ ] **Step 1: 참조 경로 grep 0 확정 (자가 점검)**

Command: `cd f:/mibunyang && grep -rn '\.claude/rules/[a-z][a-z-]*\.md' .claude/ 2>&1 | grep -v 'collectors/\|workflows/\|meta/' | head -10`

Expected: 0건 (모든 참조 경로 = 서브폴더 박힘 ✅).

- [ ] **Step 2: git status 답습**

Command: `cd f:/mibunyang && git status --short`

Expected: 7 R100 rename + 4~5 M (modified: BACKLOG / BACKLOG_ARCHIVE / NEXT_SESSION / SESSION_LOG / collectors/collector-timeout-...).

- [ ] **Step 3: git diff --stat 답습 — 변경 분량 확정**

Command: `cd f:/mibunyang && git diff --cached --stat`

Expected: ~15줄 변경 + 7 rename (총 ~12 파일 표시).

- [ ] **Step 4: Commit**

Command:
```
cd f:/mibunyang
git commit -m "refactor(rules): .claude/rules/ 서브폴더 분리 (N=7 → 3 폴더)"
```

Commit message body:
```
글로벌 CLAUDE.md §13 "N>5 시 서브폴더 분리" 트리거 답습.
도메인 기준 3 폴더 분류 + 참조 경로 15건 일괄 갱신.

- collectors/ (3): parsegu-normalization / kosis-dimension-mismatch-guard / collector-timeout-rootcause-analysis
- workflows/ (2): secret-naming-audit / workflow-name-hallucination
- meta/ (2): next-session-grep-mandate / typescript-patterns

- git mv 7회 (history 보존, `git log --follow`)
- 참조 경로 갱신 15건 (BACKLOG 1 + BACKLOG_ARCHIVE 2 + SESSION_LOG 9 + NEXT_SESSION 1 + collectors/collector-timeout 본문 1 + NEXT_SESSION F 완결 박제 1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 5: Push**

Command: `cd f:/mibunyang && git push origin main`

Expected: push success.

- [ ] **Step 6: CI 통과 확인 (1~3분 대기)**

Command: `cd f:/mibunyang && gh run list --workflow=ci.yml --limit 1 --json conclusion,createdAt,status,databaseId`

Expected: docs only 변경 = CI skip 또는 즉시 success.

---

## Self-Review Checklist

✅ **Spec coverage**: spec § 4.1 (디렉토리) → Task 1 / § 4.2 (분류) → Task 1 / § 4.3 (참조 8건) → Task 2~4 (8건 + 본 plan 발견 7건 = 15건 전체).
✅ **Placeholder scan**: "TBD/TODO/구체 안 함" 0건. 모든 Edit 의 `old_string` + `new_string` 완전 박제.
✅ **Type consistency**: 본 작업 = md 파일 mv 만 = 타입 자리 0.
✅ **Frequent commits**: 단일 commit (docs only, 분리 의의 0).
✅ **자가 점검 1**: spec 누락 7건 (L502/533/917/972/1326/1500/1548) plan 작성 시 grep 1회로 박제 완료.
✅ **자가 점검 2**: grep `\.claude/rules/[a-z][a-z-]*\.md` 자체 검증 step 6.1 박힘.
