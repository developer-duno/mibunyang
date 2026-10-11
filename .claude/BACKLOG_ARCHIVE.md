# 백로그 아카이브 — 조각 색인

> 원본이 205KB(1,150줄, CRLF)로 Read 도구 1회 한도(≈50KB)를 넘어 조각으로 분할했다(세션568). 내용은 그대로이며 순서·문구를 고치지 않았다 — 바이트 단위 완전 일치 검증 완료(줄바꿈 문자까지 보존).

각 조각은 `## `(1차) 경계에서 나누되, 단일 절이 40KB를 넘으면 그 안의 `### `(2차) 경계로 더 나눴다. h3 하위구조가 없는 대형 단일 절(part05·part07)은 원자적이라 그대로 뒀다(50KB 안쪽).

| 조각 | 크기 | 내용 |
|---|---|---|
| [part01.md](backlog-archive/part01.md) | 25.8KB | 세션557 정리(완료 46건) · 즉시섹션 완료분(26건) · 세션512 적대검증 잔여·전수조사·P0-1 |
| [part02.md](backlog-archive/part02.md) | 27.8KB | 곧섹션 완료분(20건) |
| [part03.md](backlog-archive/part03.md) | 39.1KB | 즉시/곧/여유 완료 · 환각정정 종결 · 의도적 보류 · KOSIS 보강 · 인프라코드품질 · 완료답습 사고카탈로그 |
| [part04.md](backlog-archive/part04.md) | 7.1KB | NEXT_SESSION 산출 회고 · 세션285 regions root fix · 세션~271이하 완료색인 |
| [part05.md](backlog-archive/part05.md) | 51.8KB | 세션462 감사 — BACKLOG 비대 정리로 이동 |
| [part06.md](backlog-archive/part06.md) | 3.8KB | 세션478~479 완료 |
| [part07.md](backlog-archive/part07.md) | 47.9KB | 세션524 이관 — 완료 색인(세션465 미만 완료분) |
| [part08.md](backlog-archive/part08.md) | 1.7KB | 세션566 이관 · 네이버지도 전면제거(카카오 단일화) |
| [part09.md](backlog-archive/part09.md) | 41.0KB | 세션628 이관 — BACKLOG A-0~A-15 절의 끝난(✅) 최상위 항목 · 절 제목 그대로 |
| [part10.md](backlog-archive/part10.md) | 22.8KB | 세션628 이관 — BACKLOG A(날짜 확인)·A-2·B·D·세션538 절의 끝난(✅) 최상위 항목 |

> ⚠️ **세션628 복구**: 세션568 이 part01~08(과 세션 로그 조각 19개)을 만들었지만 `.claude/*` 무시 규칙 때문에 **커밋되지 않아** 9/24~10/11 동안 조각이 어디에도 없었다(색인만 있음). 세션628 이 git 원본(`a0343059^` 의 `BACKLOG_ARCHIVE.md`·`SESSION_LOG_ARCHIVE_2026H1.md`)에서 같은 자리로 다시 잘라 복구했다 — 이으면 원본과 바이트 단위로 같고 조각 크기 27개 전부 이 표와 같다. `.gitignore` 에 두 조각 폴더를 허용했다.

## 사용법

```bash
grep -l "세션 NNN" .claude/backlog-archive/part*.md
```
