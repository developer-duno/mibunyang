---
name: db-quality
description: Supabase apartments_flat / apartments 핵심 품질 지표를 재측정하고 세션 318 기준 대비 회귀를 점검한다. 채움률·dataReliability·행 수를 표로 보고. Claude 가 스스로 판단해 발동 — 사용자 타이핑 불필요. 트리거 = "DB 품질", "apartments_flat 품질", "채움률 확인", "데이터 회귀", "품질 재측정". 사용 안 함 = 단일 행 조회, 스키마 질문.
when_to_use: |
  Claude 가 자동 판단해 발동:
  - "DB 품질", "품질 재측정", "채움률 확인", "데이터 회귀 점검" 의도
  - apartments_flat / apartments 핵심 지표를 세션 318 기준과 대조해야 할 때
  - collector 변경·머지 후 데이터 회귀 의심
  사용 안 함:
  - 단일 행/단일 컬럼 조회 (그냥 SQL)
  - 스키마 구조 질문 (supabase MCP 직접)
allowed-tools: Bash, Read
---

Supabase `apartments_flat` (VIEW 1,424행) 또는 `apartments` 테이블 (2,001건) 핵심 품질 지표를 재측정하고 회귀 여부를 확인한다.

## 기준치 (세션 318, 2026-05-26 — data-audit.mjs --json 실측, [DB_QUALITY.md](../../DB_QUALITY.md) 참조)

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
3. **세션 318 대비 회귀 체크**: 허용 하한 아래면 어느 수집 파이프라인이 누락시켰는지 추적 (`.github/workflows/` + `scripts/collectors/`).
4. **결과 표로 보고**: 기준 / 현재 / 차이 / 상태(✅/⚠️/❌).

## 사용 도구

- Supabase MCP (`supabase-readonly`, `.mcp.json`) 우선. 없으면 `npx supabase db ...` 또는 `node scripts/data-audit.mjs --json`.
- 환경변수(SUPABASE_URL 등)는 Read 금지 목록 — 툴 레벨에서만 사용.

## 회귀 처리

- ❌ 상태 발견 시 **별도 수정 PR** 권장. 이 스킬은 진단만 — 수정은 범위 밖.
- 결과 요약은 세션 메모리(`session_*.md`)에 기록. SESSION_LOG.md 누적 금지(drift 방지).
