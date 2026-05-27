---
description: apartments_flat 품질 지표 재측정 및 세션86 기준 비교
allowed-tools: Bash, Read
---

Supabase `apartments_flat` (VIEW 1,424행) 또는 `apartments` 테이블 (2,001건) 핵심 품질 지표를 재측정하고 회귀 여부를 확인해.

## 기준치 (세션 318, 2026-05-26 — data-audit.mjs --json 실측, [DB_QUALITY.md](../DB_QUALITY.md) 참조)

| 지표 | 기준 | 허용 하한 | 비고 |
|------|------|----------|------|
| `apartments` 행 수 | 2,001 | 1,950 | 30일+ 신규 0 (자연 정체) |
| `apartments_flat` 행 수 | 1,424 | 1,400 | VIEW 조인 결과 (분양 진행 단지만) |
| 평균 dataReliability | 92 | 85 | 0~100 척도 (4/20 80 → +12) |
| price 채움률 | 90% | 85% | area/price/pp 3 컬럼 |
| risk 채움률 | 99% | 95% | isRegulated + dsr40pass |
| schools 채움률 | 99.6% | 95% | NEIS 3 컬럼 |
| infra 채움률 | 88.2% | 85% | 카카오 17 컬럼 |
| transport 채움률 | 62% | 58% | tago 7 컬럼 일부 NULL |
| maintenance 채움률 | 15.7% | 10% | 세션 319 부분 박힘 (10.8% → 15.7%), 6/15 cron 시 추가 누적 예상 |
| builders 채움률 | 5.7% | 5% | DART 매칭 한계 |
| benefits 채움률 | 0% | 0% | **의도된 미수집** (시행사 운영자 수기 입력) |

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
