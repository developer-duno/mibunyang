# 로컬 Claude 자원 (2026-04-14 리뉴얼 · 2026-09-20 세션 548 정정)

## 세션 기록은 어디에 있나 (세션 548 정정 — 옛 "SESSION_LOG 에 append" 서술 폐기)

- **`~/.claude/projects/f--mibunyang/memory/`** (git 미추적): **세션 296+ 의 진실의 원천.** `MEMORY.md` 인덱스(한 줄 = 한 항목) + `session_*.md` 상세 + `archive-*.md` 완결 묶음.
- **`.claude/SESSION_LOG.md`**: 세션 418 에 **스텁화** — 신규 누적을 하지 않는다. 세션 1~354 는 `SESSION_LOG_ARCHIVE_2026H1.md`(grep 전용, 682KB).
- **`.claude/BACKLOG.md`** (커밋 추적): 미해결 과제와 해소 기록. 176KB 라 통째로 읽지 말고 `grep -n '세션NNN'`.
- **팀이 공유해야 하는 원칙·사고 패턴**은 `.claude/rules/<카테고리>/*.md` (커밋 추적). 개인 작업 일지는 메모리 쪽.

## 프로젝트 전용 커맨드 (`.claude/commands/`)

- `/collect-naver` — 네이버 수집 + post-naver-collect 파이프라인

## 프로젝트 전용 스킬 (`.claude/skills/`, 자율 발동 — 세션 418 command→skill 승격)

- `score-recalc` — 점수 재계산 + PROFILES 가중치 합 sanity
- `cross-validate` — simplify + 5교차검증 병렬 (Review 단계 자동화)
- `db-quality` — apartments_flat 품질 지표 재측정

## 프로젝트 전용 서브에이전트 (`.claude/agents/`)

- `scoring-validator` — 가중치/클램핑/null 검증
- `null-safety-checker` — optional chaining·기본값·숫자 포맷 가드
- `collector-contract` — 수집기 배치/upsert/병렬/쿼터/에러 계약
- `code-reviewer` — withHandler·비로그인 블라인드·memo comparator·표현계층·sanitize null 함정 (커밋/PR 직전)
- `migration-safety` — 공용 테이블 ALTER 영향·RLS·security_invoker·롤백 SQL·Dashboard 수동 적용
- `security-reviewer` — XSS·env 노출·인젝션·withHandler 누락·JWT/admin 토큰·CORS
- ⚠️ 목록은 늘어난다 — 단정 전 `git ls-files .claude/agents` (세션 548: 3개로 적혀 있었으나 실제 6개)

## settings.json hooks (비차단 경고)

- `SessionStart`: cwd=mibunyang 확인 (D:\ 재발 방지)
- `PostToolUse(Edit|Write)`: 5파일+ 편집 감지 → `.build-dirty` 플래그
- `Stop`: build 상기 + 카운터/플래그 리셋
