# 워크플로 이름 ≠ 동작 — 본문 grep 의무 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/workflows/workflow-name-hallucination.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 245 → 247)

세션 245 가 `apply-migration.yml` workflow_dispatch run 25797316590 "success" 결과만 보고 "DDL 적용 완료" 박제. 세션 247 수집 시점에 PG 42703 `column does not exist` 발견 → 워크플로 본문 grep 결과 **실제 SQL 실행 0건** (transport 컬럼 확인 + 콘솔 출력만).

raw 본문 (`Read .github/workflows/apply-migration.yml` 또는 `gh run view 25797316590 --log`):

```
# 워크플로 이름: "Apply DB Migration"
# 실제 본문 step: "Check migration status" (transport 컬럼 존재 확인 + SQL 콘솔 출력만)
# 결론: success 결과 = "확인 완료" 의미. "DDL 적용 완료" 단정 환각
```

세션 248 (본 룰 박제 세션) 에서 `apply-migration.yml` 폐기 + `supabase/CLAUDE.md` 의 "Dashboard SQL Editor 수동 실행" 절 박제로 종결.

## 답습 자산

- 세션 247 W6-C v2 본 사고 박제 (`.claude/SESSION_LOG.md` 세션 247 절 참조)
- 세션 248 본 룰 신규 + `supabase/CLAUDE.md` "Dashboard SQL Editor 수동 실행" 절 동시 박제
- 미래 ETL collector 추가 시 마이그 적용 단계 = Dashboard 직접 실행 (표준)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 workflow 이름만 보고 "Y 적용" 단정 | §1 본문 grep 의무 발동 → step name 으로 의도 정정 |
| workflow_dispatch success 만 보고 "동작 완료" 박제 | §2 raw log 1회 의무 발동 → 마지막 step 메시지로 의도 확정 |
| supabase-js `column does not exist` 발생 시 캐시 단정 | §3 두 가능성 표 → Dashboard `\d <table>` 우선 의무 |
