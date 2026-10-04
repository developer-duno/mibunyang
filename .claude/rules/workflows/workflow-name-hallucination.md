# 워크플로 이름 ≠ 동작 — 본문 grep 의무

## 한 줄

워크플로 이름과 동작은 동기화 검증이 없다. `workflow_dispatch` 의 "success" 를 "그 동작이 끝났다"의 근거로 쓰지 않는다.

## 재발 방지 (3중)

1. **plan 에 workflow 의존 단계가 있으면 yml 본문 step + run 블록을 Read 1회**(`grep -A 20 "steps:" .github/workflows/<workflow>.yml`) — 이름만 보고 단정 금지.
2. **run log raw 1회** — `gh run view <id> --log`(또는 `--log-failed`), 마지막 줄의 step 내부 메시지로 의도를 확정. JSON `conclusion: success` 만 신뢰 금지.
3. **supabase-js `column does not exist`(PG 42703) 는 두 가능성** — PostgREST 캐시 미갱신(`NOTIFY pgrst, 'reload schema'` 1회) 또는 컬럼 자체 부재(Dashboard SQL Editor 에서 `\d <table>` 또는 마이그 본문 직접 Run). Dashboard SQL Editor 직접 확인이 가장 빠르다(CLI/MCP 는 캐시 layer 로 신호가 흐려진다).

## 안티 패턴 (사고 답습)

- ❌ "workflow_dispatch success = 동작 완료" — step 본문 확인 없이 단정 금지
- ❌ "workflow 이름이 'Apply X' 면 X 가 적용된다" — 이름 ≠ 동작
- ❌ "JSON conclusion: success 만으로 충분" — raw log 1회 의무
- ❌ "supabase-js `column does not exist` = PostgREST 캐시 문제" — 컬럼 자체 부재 가능성 동시 검토

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/workflows/workflow-name-hallucination.md](../../rules-detail/workflows/workflow-name-hallucination.md)
