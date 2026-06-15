# 로컬 Claude 자원 (2026-04-14 리뉴얼)

## SESSION_LOG.md vs memory 역할 분리

- **`.claude/SESSION_LOG.md`** (커밋 추적): 과거 지향·불변. 날짜/커밋 SHA/결정 근거. 세션 종료 시 1회 append.
- **`~/.claude/projects/f--mibunyang/memory/`** (gitignored): 현재 지향·휘발. 진행 중 가설·다음 단계·TODO.
- **중복 금지**: 확정 사실은 SESSION_LOG로 이관 후 memory에서 삭제. 같은 사실 두 곳 작성 금지.
- CLAUDE.md "현재 진행 상황"은 한 줄 요약만 — 상세는 SESSION_LOG.

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

## settings.json hooks (비차단 경고)

- `SessionStart`: cwd=mibunyang 확인 (D:\ 재발 방지)
- `PostToolUse(Edit|Write)`: 5파일+ 편집 감지 → `.build-dirty` 플래그
- `Stop`: build 상기 + 카운터/플래그 리셋
