# SESSION_LOG — 세션 일지 (스텁)

> **이 파일은 세션 418(2026-06-15)에 다이어트되었습니다.** 과거 세션 1~354 기록(10,194줄)은
> [SESSION_LOG_ARCHIVE_2026H1.md](SESSION_LOG_ARCHIVE_2026H1.md) 로 통째 이동했습니다 (이력 손실 0).

## 진실의 원천 (중요)

이 SESSION_LOG는 **세션 296+부터 drift(방치)** 되어 있었습니다 (CLAUDE.md 본문에 "296+ SESSION_LOG drift P1"로 이미 박제). 아카이브 파일도 **세션 354(2026-05-31)에서 멈췄고**, 내용이 시간순이 아니라 편집순으로 누적되어 있습니다.

**세션 296+ 진행 이력의 실제 진실의 원천 = 글로벌 메모리 토픽 파일**:

- `~/.claude/projects/f--mibunyang/memory/MEMORY.md` — 세션별 1줄 인덱스
- `~/.claude/projects/f--mibunyang/memory/session_*.md` — 세션별 상세 일지 (한 세션 = 한 파일)

세션 일지를 찾을 때는 위 메모리 디렉토리를 먼저 보세요. 이 파일(SESSION_LOG.md)이 아닙니다.

## 신규 세션 기록 규칙

- **세션 상세** = 글로벌 메모리 `session_<날짜>_session<N>_<주제>.md` 에 기록 (git 미추적, 개인).
- **팀 공유 의사결정** = `.claude/decisions/` 또는 프로젝트 `.claude/rules/<카테고리>.md` (git 추적).
- 이 SESSION_LOG.md 에는 신규 누적을 **하지 않습니다** (drift 재발 방지). 필요 시 분기별 ARCHIVE 신규 생성.

## 아카이브 색인

| 파일 | 범위 | 비고 |
|---|---|---|
| [SESSION_LOG_ARCHIVE_2026H1.md](SESSION_LOG_ARCHIVE_2026H1.md) | 세션 1~354 (편집순 누적) | 2026 상반기, 10,194줄. 검색 시 `grep '세션 NNN'` |
