---
name: worktree-cleanup
description: git worktree 머지·완료 후 stale worktree(고아 디렉토리 포함)를 안전하게 정리한다. .claude/worktrees/ 의 복제본이 grep 노이즈·디스크 부채가 되기 전에 점검·제거. Claude 가 스스로 판단해 발동 — worktree 작업 종료 후, "worktree 정리", "worktrees 폴더 비대", ".claude/worktrees 잔재" 표현 시. 사용 안 함 = 활성 worktree 작업 중.
when_to_use: |
  Claude 가 자동 판단해 발동:
  - git worktree 로 분리 작업하다 머지/완료한 직후
  - "worktree 정리", "worktrees 폴더", "stale 복제본" 표현
  - .claude/worktrees/ 가 비대해진 정황 (감사·부팅 점검에서 발견)
  사용 안 함:
  - 활성 worktree 에서 작업 중 (제거 금지)
allowed-tools: Bash, Read
---

`.claude/worktrees/` 의 stale worktree·고아 디렉토리를 안전하게 정리한다. **삭제는 되돌릴 수 없으니** 반드시 아래 안전 점검을 순서대로 거친 뒤, 제거 직전 사용자 승인 1회.

## 안전 점검 절차 (예외 0)

### 1. git worktree 메타 확인 (진짜 worktree vs 고아)
```bash
git worktree list                      # git 이 추적하는 worktree
ls .claude/worktrees/                   # 실제 디렉토리
cat .git/worktrees/*/gitdir 2>/dev/null # 메타 등록 여부
```
- `git worktree list` 에 **있으면** = 진짜 worktree → `git worktree remove <경로>` 사용.
- `git worktree list` 에 **없는데 디렉토리만 있으면** = 고아 디렉토리(메타 prune됨/수동 복사) → 일반 삭제 대상.

### 2. 미머지·uncommitted 손실 위험 점검
```bash
cd <worktree경로> && git status --short && git branch --show-current
git log --oneline -3
```
- uncommitted 변경·미머지 커밋이 있으면 **삭제 금지** → 사용자에게 보고 후 머지/스태시.
- `.gitignore` 로 추적 0(`git ls-files <경로> | wc -l` = 0)이면 git 이력 영향 0 = 안전.

### 3. 크기·내용 확인 (무엇을 지우는지)
```bash
du -sh <worktree경로>
find <worktree경로> -type f | wc -l
find <worktree경로> -name CLAUDE.md   # 중복 CLAUDE.md 가 grep 노이즈인지
```

### 4. 사용자 승인 후 제거
- 위 점검 요약(고아 여부·미머지 0·크기) 보고 + 1회 승인.
- `rm -rf` 는 deny 정책 → Windows: `powershell -NoProfile -Command "Remove-Item -LiteralPath '<절대경로>' -Recurse -Force"`.
- 제거 후 `git worktree prune -v` 로 메타 정합 + `find . -name CLAUDE.md | wc -l` 로 중복 제거 확인.

## 안티 패턴

- ❌ `git worktree list` 확인 없이 바로 삭제 — 진짜 worktree 면 메타 꼬임.
- ❌ uncommitted 변경 확인 없이 삭제 — 작업 손실.
- ❌ `rm -rf` 직접(deny) — PowerShell Remove-Item -LiteralPath 사용.

> 답습: 세션 439 감사 — `.claude/worktrees/collector-cron-spread`(93MB·638파일, git 메타 분리 고아·추적 0) 정리. `.claude/worktrees/` 는 `.gitignore` L32 등재라 추적 0 = 안전.
