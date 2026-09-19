# KOSIS 통계표 차원 검증 — raw API sample 박제 의무 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/collectors/kosis-dimension-mismatch-guard.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 249)

NEXT_SESSION + BACKLOG L141 가 "DT_MLTM_2086 시군구별 준공후 미분양 → `regions.unsold_after_completion` JSON 신규 또는 `apartments.unsoldAfterCompletion`, 큰 작업 2~3 세션" 박제. 세션 235 Playwright 박제 (SESSION_LOG L1122: "시도별 분리 불가") 도 있었으나 BACKLOG/NEXT_SESSION 동기화 0 → 세션 249 진입 plan v1 환각 위험.

세션 249 옵션 B 진입 의지 시 0단계 KOSIS API raw sample 호출 (`objL1=ALL objL2=ALL prdSe=A startPrdDe=2023 endPrdDe=2024`) → 58 rows 응답 박제:

```
C1_NM distinct (3 group 분리):
  - 시도별미분양현황 (40 rows: 17 시도 + 전국/수도권/지방 = 20종 × 2년) → ITM_NM 단일 '미분양(12월기준)' 총량만
  - 부문별미분양현황 (8 rows: 계/민간부문/공공부문/(준공후) × 2년) → 전국 단일값
  - 규모별미분양현황 (10 rows: 5 규모 × 2년) → 전국 단일값

(준공후) raw row: { C1_NM: "부문별미분양현황", C2_NM: "(준공후)", C1: "13102871014A.0001" (= 전국 단일 코드), DT: "10857" }
```

→ 차원 = **3 group 분리 (한 차원만 활용)**. 시도별 × 부문별 교차 cell **부재 확정**. mibunyang 단지·시군구 단위 본질 unmatched.

## 답습 자산

- 세션 235 Playwright 9 단계 자동화 박제 (SESSION_LOG L1110~1116) — KOSIS 인증 진입 보조 수단
- 세션 236 W2 박제 (SESSION_LOG L1135) — `national_unsold_history` 신규 테이블 가능성 (옵션 A 진입 시)
- 세션 237 W1 `collect-housing-supply-ratio.mjs` (DT_MLTM_2100) 답습 패턴 — KOSIS 시도 17행 UPDATE 가능 통계표 (교차 cell 형태)
- 세션 249 본 사고 박제 (NEXT_SESSION L38 + BACKLOG L141 + 본 룰 신규)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 통계표 박제값 "3 차원 존재" 단정 후 시도 × 부문 교차 collector 작성 | §1 raw sample 박제 의무 발동 → C1_NM 분리 group 발견 → 교차 가설 정정 |
| KOSIS Playwright 메타 검증만 보고 시군구 단위 단정 | §3 보조 수단 명시 → raw API 단정 근거 의무 |
| BACKLOG/NEXT_SESSION 박제값 무검증 답습 | §1 raw sample 30+ 행 박제 의무 → 박제값 stale 발견 + 정정 1 커밋 |
