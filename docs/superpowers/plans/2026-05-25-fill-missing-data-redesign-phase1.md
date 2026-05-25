# 세션 308 — fill-missing-data Phase 1 PR #11 구현

> 세션 307 spec 답습. 외부 cron 가진 11 collector fill matrix 제외 + audit 가드 신규 + 5/31 (일) KST 11:00 cron 발화 6번째 누적 cancelled 차단.

원천 spec: `docs/superpowers/specs/2026-05-25-fill-missing-data-redesign.md`

## 결론

PR #11 = fill-missing-data.yml Phase 3+4+5 일괄 폐기 (-108줄) + `audit-fill-matrix.mjs` CI 가드 신규. 5 일꾼 (Phase 1 좌표 2 + Phase 2 matrix 3) 만 잔존. trade-stats 폐기 직접 유발 = 세션 309 P0 즉시 진단.

## 변경 파일 (11 개)

| 파일 | 변경 | 라인 |
|---|---|---|
| `.github/workflows/fill-missing-data.yml` | Phase 3+4+5 본문 일괄 삭제 | -108 |
| `scripts/audit-fill-matrix.mjs` | 신규 (CI 가드, `findViolations` 순수 함수 + `extractMatrixJobs` 답습) | +80 |
| `scripts/audit-fill-matrix.test.mjs` | 신규 (vitest, `audit-monitor-coverage.test` 패턴 답습) | +40 |
| `.github/workflows/ci.yml` | audit step 1 개 추가 | +3 |
| `.github/workflows/CLAUDE.md` | 유틸리티 절 정정 | ~10 |
| `.claude/rules/workflows/timeout-rootcause-policy.md` | 신규 절 (세션 307 안티 패턴 11 일꾼 정정) | +10 |
| `.claude/SESSION_LOG.md` | 세션 308 절 신규 | +40 |
| `.claude/BACKLOG.md` | ✅ 색인 + 🔴 P0 신규 + 🟢 후순위 | +10 |
| `.claude/NEXT_SESSION.md` | 세션 309 다음 작업 완전 재박힘 | ~100 |
| `docs/superpowers/plans/2026-05-25-fill-missing-data-redesign-phase1.md` | 본 plan 신규 | (본 파일) |
| **소계** | | **net -25 lines + 2 신규 파일** |

## 단계

### Step 1 — feat 브랜치 생성

```bash
git checkout -b feat/session-308-fill-phase1
```

### Step 2 — fill-missing-data.yml Phase 3+4+5 삭제

Edit: L91~L198 전체 본문 (Phase 3 헤더 ~ Phase 5 마지막 줄) 삭제.

검증: `wc -l .github/workflows/fill-missing-data.yml` = ~90줄 박힘.

### Step 3 — audit-fill-matrix.mjs 신규

`extractMatrixJobs` (audit-env-keys.mjs L81) named export 답습. `findViolations` 순수 함수 named export 의무 (test import).

### Step 4 — audit-fill-matrix.test.mjs 신규

`audit-monitor-coverage.test.mjs` 패턴 답습 (TMP fixture 0). 4 it (정확 일치 / 교집합 0 / 부분 일치 0 / 다중 위반 정렬).

### Step 5 — ci.yml audit step 추가

L46 후 "fill matrix 외부 cron 교집합 audit" step 추가.

### Step 6 — 메모 5 파일 정정

`.github/workflows/CLAUDE.md` 유틸리티 절 + `.claude/rules/workflows/timeout-rootcause-policy.md` 신규 절 + `.claude/SESSION_LOG.md` 세션 308 절 + `.claude/BACKLOG.md` 3 곳 + `.claude/NEXT_SESSION.md` 완전 재박힘.

### Step 7 — 로컬 검증

```bash
npm run typecheck:scripts
node scripts/audit-env-keys.mjs
node scripts/audit-monitor-coverage.mjs
node scripts/audit-collector-patterns.mjs
node scripts/audit-fill-matrix.mjs
npx vitest run scripts/audit-fill-matrix.test.mjs --no-cache
```

기대: 모두 exit 0.

### Step 8 — commit + push + PR 생성

```bash
git add .
git commit -m "refactor(fill-missing-data): Phase 3+4+5 폐기 + audit-fill-matrix CI 가드 (세션 308)"
git push -u origin feat/session-308-fill-phase1
gh pr create --base main --head feat/session-308-fill-phase1 --title "..." --body "..."
```

### Step 9 — workflow_dispatch dry-run 1회 실증

```bash
gh workflow run fill-missing-data.yml --ref feat/session-308-fill-phase1 -f dry_run=true
RUN_ID=$(gh run list --workflow=fill-missing-data.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN_ID
gh run view $RUN_ID --log | grep -E "Phase 1|Phase 2|dry-run|geocode|reverse|sync-naver|calc-floors|regulation"
```

기대: phase1-coords success + phase2-calc matrix 3 success, ~30분 이내.

### Step 10 — PR #11 머지

CI 통과 + dry-run success 확인 후:

```bash
gh pr merge 11 --merge --delete-branch
```

### Step 11 — 5/31 (일) KST 11:00 cron 발화 자동 검증 (다음 세션)

```bash
gh run list --workflow=fill-missing-data.yml --limit 1 --json conclusion,databaseId,createdAt
gh run view <id> --log | grep -E "Phase 1|Phase 2|success|failure|cancelled"
```

기대: conclusion = success, 5 일꾼 success, 외부 API 호출 0 (Phase 1 Kakao 별도), ~30분 이내 종결.

## 위험 + 정정

| 위험 | 정정 |
|---|---|
| 5/31 이전 머지 실패 | 본 세션 머지 (5/26~5/30 5 일 여유) + dry-run 의무 |
| trade-stats stale 직접 유발 | 세션 309 P0 즉시 진단 (BACKLOG 신규) |
| audit-fill-matrix 36 yml read 성능 | 36 × 5KB = 1초 미만 (OK) |
| `extractMatrixJobs` import 환각 | audit-env-keys.mjs L81 named export 박힘 확정 |
| dry-run 0회 직접 머지 | workflow_dispatch dry-run 의무 (Step 9) |
| `findViolations` named export 누락 | audit-fill-matrix.mjs 본문 명시 박힘 (Step 3) |

## Rollback

PR #11 머지 후 5/31 발화 cancelled / failure 시:

- `gh run view <id> --log` raw log 답습 (`timeout-rootcause-policy.md` §1)
- 진앙 분류: (a) timeout 부족 / (b) Phase 1 Kakao API 사고 / (c) Phase 2 matrix 일꾼 사고
- 정정: timeout 늘리기 또는 collector 본문 진단
- 최악 시 `git revert <merge_commit>` + 새 PR

## 답습 자산

- `docs/superpowers/specs/2026-05-25-fill-missing-data-redesign.md` (원천 spec)
- `scripts/audit-env-keys.mjs` L81 `extractMatrixJobs()` named export
- `scripts/audit-monitor-coverage.mjs` + test (순수 함수 패턴)
- `.github/workflows/ci.yml` L39~46 audit step 패턴
- 세션 306 PR #10 schools-neis 제거 (`7988127`)
- 세션 291 phase2-calc 6→3 (외부 cron 박힌 calc 제외)
- 세션 273 calc-collection 그룹 분리 (`68c5051`)
- `.claude/rules/workflows/timeout-rootcause-policy.md`
- `.claude/rules/workflows/collector-timeout-rootcause-analysis.md`
