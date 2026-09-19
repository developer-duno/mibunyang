# 워크플로 이름 ≠ 동작 — 본문 grep 의무

> 사건·이력 (세션245→247 — `apply-migration.yml` workflow_dispatch "success" 만 보고 "DDL 적용 완료"로 단정했으나 실제 본문은 SQL 콘솔 출력만 하는 확인 step. PG 42703 발견 후 워크플로 폐기 + Dashboard 수동 실행으로 전환) → [rules-history/workflows/workflow-name-hallucination.md](../../rules-history/workflows/workflow-name-hallucination.md)

## 근본 원인

워크플로 이름과 동작 사이 동기화 검증 0. step name `Check migration status` 만 봤어도 의도 파악 가능했으나 plan 작성 시 이름만 보고 박제. workflow_dispatch success = 단정 근거로 사용 금지.

## 재발 방지 (3중)

### 1. 워크플로 본문 grep 의무

신규 plan 작성 시 workflow 의존 단계가 있으면 workflow yml **본문 step + run 블록** Read 1회 의무. 이름만 보고 단정 금지.

```bash
# 빨강 (이름만 보고 단정)
# plan v1: "<workflow>.yml workflow_dispatch 트리거 → DDL 적용"

# 초록 (본문 grep 후 박제)
grep -A 20 "steps:" .github/workflows/<workflow>.yml
# 실제 동작 파악 → "Dashboard SQL Editor 직접 실행" 등 정정
```

### 2. run log raw 1회 의무

`gh run view <id> --log` 또는 `--log-failed` 1회 의무. JSON `conclusion: success` 만 신뢰 금지.

```bash
gh run view 25797316590 --log | tail -50
# 마지막 줄: "transport 새 컬럼: ✅ 정상" 또는 "⚠️ 새 컬럼이 아직 적용되지 않았습니다"
# success ≠ 동작 완료. step 내부 메시지로 의도 확정
```

### 3. DDL stale 진단 패턴

supabase-js 가 `column does not exist` (PG 42703) 반환 시 두 가능성:

| 진단 | 정정 |
|---|---|
| PostgREST 캐시 미갱신 | `NOTIFY pgrst, 'reload schema'` 1회 |
| 컬럼 자체 부재 | Dashboard SQL Editor 에서 `\d <table>` 또는 마이그 본문 직접 Run |

Dashboard SQL Editor 직접 확인이 가장 빠른 진단법. CLI/MCP 경유는 캐시 layer 때문에 진단 신호 흐려짐.

## 안티 패턴 (사고 답습)

- ❌ "workflow_dispatch success = 동작 완료" — step 본문 확인 없이 단정 금지
- ❌ "workflow 이름이 'Apply X' 면 X 가 적용된다" — 이름 ≠ 동작
- ❌ "JSON conclusion: success 만으로 충분" — raw log 1회 의무
- ❌ "supabase-js `column does not exist` = PostgREST 캐시 문제" — 컬럼 자체 부재 가능성 동시 검토

> 답습 자산·차단 검증 이력 → [rules-history/workflows/workflow-name-hallucination.md](../../rules-history/workflows/workflow-name-hallucination.md)
