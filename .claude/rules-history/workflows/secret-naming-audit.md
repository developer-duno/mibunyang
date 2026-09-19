# Secret 이름 3-way 동기화 감사 — Code ↔ Workflow ↔ Orchestrator — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/workflows/secret-naming-audit.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 232)

`collect-migration.yml` 이 **`MOIS_POP_KEY`** 만 주입하는데 `migration.mjs` 는 **`KOSIS_MIGRATION_KEY`** 만 사용. **2026-04-15 schedule failure 부터 1개월 방치** (월 1회 발화 = 4/15 + 5/15 누적 2회 fail).

`data-fill.mjs` L43 `envKeys: ["MOIS_POP_KEY"]` 도 동일 불일치 (제3 사고). orchestration 사전 validate 무력화.

raw log (gh run view 24481813793 --log-failed):

```
[migration] ERROR: KOSIS_MIGRATION_KEY 환경변수 필요
```

## matrix orchestrator 답습 세부 (세션 304)

검증:
- `scripts/audit-env-keys.test.mjs` — vitest fixture 기반 회귀 가드 4 test
- 세션 304 재현 시뮬 1회 (KOSIS_MIGRATION_KEY env block 일시 제거 → audit exit 1 검출 + ❌ matrix yml env block 누락 메시지 → 복원 → exit 0)
- 신규 사고 동시 발견 + 정정: `schools-neis.mjs` NEIS_KEY/SCHOOLINFO_KEY phase3-external env block 누락 → 2 secrets 추가 (실 사고 가능성 0 자리 박제, GitHub Secrets 자리 박힘 = NEIS_KEY/SCHOOLINFO_KEY)

## 답습 자산

- 세션 222 (KOSIS DT_1YL202001E → DT_MLTM_2082): 통계표 ID 변경 사고 답습
- 세션 224 audit hypothesis: BACKLOG 박제값 단정 근거 사용 금지, raw log 의무
- 세션 232 본 사고: 3-way 환경변수 동기화 검증 자동화 의무

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

본 룰 적용 시 사고 시뮬레이션:

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| collector 에 `process.env.NEW_KEY` 추가, yml 미반영 | CI audit step fail → 머지 차단 |
| yml 에 `NEW_KEY` 주입 추가, secret 미등록 | Validate secrets step fail → schedule run 즉시 exit (월간 데드존 회피) |
| 비호환 키 (KOSIS_KEY vs KOSIS_MIGRATION_KEY) 단정 fallback | 본 룰 §안티 패턴 grep 의무, plan v1 작성 시 막힘 |
