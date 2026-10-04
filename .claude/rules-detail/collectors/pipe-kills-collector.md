> 핵심 = [../../rules/collectors/pipe-kills-collector.md](../../rules/collectors/pipe-kills-collector.md) · 이 파일은 필요할 때 Read

# 수집기를 파이프 뒤에 두지 마라 — `| tail` 이 프로세스를 죽인다

## 한 줄

> 사건·이력 (세션511 — `industry-match.mjs` 를 `| tail -4` 로 돌려 SIGPIPE 로 중단, exit 0·정상 로그였지만 DB 는 55곳 중 23곳만 반영됨) → [rules-history/collectors/pipe-kills-collector.md](../../rules-history/collectors/pipe-kills-collector.md)

## 규칙

### 1. 수집기·마이그레이션 등 **쓰기 작업**은 파이프 없이 실행한다

```bash
# 빨강 — tail 이 파이프를 닫는 순간 수집기가 죽는다
node scripts/collectors/X.mjs 2>&1 | tail -5
node scripts/collectors/X.mjs | grep 완료

# 초록 — 파일로 받고 나서 읽는다
node scripts/collectors/X.mjs > /tmp/x.log 2>&1; echo "exit=$?"
tail -5 /tmp/x.log
```

`head`·`tail`·`grep -m N`·`sed q` 처럼 **입력을 끝까지 안 읽는 명령**이 전부 해당한다.
`grep`(전부 읽음)·`cat` 은 상대적으로 안전하지만, 습관을 가르지 말고 **쓰기 작업은 무조건
파일 리다이렉트**로 통일한다.

### 2. 종료코드·마지막 로그를 완료 근거로 쓰지 않는다

SIGPIPE 로 죽은 프로세스의 종료 상태는 래퍼에 따라 0 으로 보일 수 있다.
**완료 판정은 그 수집기가 스스로 남기는 것으로** 한다:

- `collector_runs` 에 이번 실행 행이 생겼는가 (`finished_at` 이 방금인가)
- 마지막 요약 로그(`[완료] N초 | 성공 X | 실패 Y`)가 찍혔는가
- **DB 실제 개수가 기대한 만큼 변했는가** ← 가장 확실하다

### 3. 쓰기 작업 뒤에는 **개수를 센다**

"성공했다"는 로그보다 **전후 행 수 차이**가 강하다. 이번 사고도 개수를 세서 잡았다.

```bash
# 전후 비교 (예: 특정 형식이 몇 건 남았나)
node --input-type=module -e "
import { loadEnv, getSupabase, selectAll } from './scripts/collectors/_shared.mjs';
loadEnv(); const sb = getSupabase();
const rows = await selectAll((s)=>s.from('<table>').select('id,<col>'), sb);
const bad = rows.filter(r => r.<col> && !<기대형식>.test(String(r.<col>)));
console.log('전체', rows.length, '| 기대 형식 아님', bad.length);
" > /tmp/check.log 2>&1; cat /tmp/check.log
```

## 안티 패턴

## 관련

- [[guards-must-be-mutation-tested]] §"exit code 측정 함정" — `cmd | head` 로 `$?` 를 재면
  `head` 의 종료코드가 잡힌다는 세션491 지적. **이 룰은 그보다 심한 경우**로,
  종료코드를 잘못 읽는 게 아니라 **작업 자체가 중단된다.**

> 차단 검증 이력 → [rules-history/collectors/pipe-kills-collector.md](../../rules-history/collectors/pipe-kills-collector.md)
