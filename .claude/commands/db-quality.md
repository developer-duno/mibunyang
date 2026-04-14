---
description: apartments_flat 품질 지표 재측정 및 세션86 기준 비교
allowed-tools: Bash, Read
---

Supabase `apartments_flat` 테이블의 핵심 품질 지표를 재측정하고 회귀 여부를 확인해.

## 기준치 (세션86, 2026-04-12)

| 지표 | 기준 | 허용 하한 |
|------|------|----------|
| total rows | 1,424 | 1,400 |
| units 채움률 | 98.4% | 95% |
| lat/lng 채움률 | 99.9% | 99% |
| price 채움률 | 64.0% | 60% |
| unsoldRate 채움률 | 61.4% | 58% |
| subwayDist 채움률 | 79.0% | 75% |
| dataReliability | 57.4% | 55% |

## 실행 절차

1. **행 수**: `select count(*) from apartments_flat`
2. **컬럼별 null 비율**: units / lat / lng / price / unsoldRate / subwayDist / dataReliability 각 `count(col is null) / count(*)`
3. **세션86 대비 회귀 체크**: 허용 하한 아래면 어느 수집 파이프라인이 누락시켰는지 추적 (`.github/workflows/` + `scripts/collectors/`).
4. **결과 표로 보고**: 기준 / 현재 / 차이 / 상태(✅/⚠️/❌).

## 사용 도구

- Supabase MCP: `mcp__claude_ai_Supabase__execute_sql` 우선. 없으면 `npx supabase db ...`로.
- 환경변수(SUPABASE_URL 등)는 Read 금지 목록 — 툴 레벨에서만 사용.

## 회귀 처리

- ❌ 상태 발견 시 **별도 수정 PR** 권장. 이 커맨드는 진단만 — 수정은 범위 밖.
- 결과를 `SESSION_LOG.md`에 한 줄 요약으로 append하는 건 사용자에게 확인받고 진행.
