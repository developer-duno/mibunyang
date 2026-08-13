# 수집기를 파이프 뒤에 두지 마라 — `| tail` 이 프로세스를 죽인다

## 한 줄

**`node scripts/collectors/X.mjs | grep ... | tail -4` 는 수집기를 중간에 죽인다.**
`tail` 이 필요한 줄을 다 받고 파이프를 닫으면 상류 프로세스가 **SIGPIPE** 로 종료된다.
DB 쓰기 루프가 돌던 중이면 **일부만 반영되고 끝난다** — 그런데 로그도 `collector_runs` 행도
안 남아서, 겉보기에는 "정상 종료"다.

## 사고 박제 (세션511, 2026-08-13)

`industry-match.mjs` 에 "매칭 안 된 단지의 옛 값을 지운다" 로직을 넣고 실행했다:

```bash
node scripts/collectors/industry-match.mjs 2>&1 | grep -v "..." | tail -4
```

- 로그 마지막 줄: `[result] 산업단지 매칭: 1909/2696건 · 옛 값 정리 55건`
- **그 뒤 `[supabase] N/1964건 업데이트` 로그가 없다**
- `collector_runs` 최신 행이 **이전 실행 것**(ok=1909) — 이번 실행 기록이 아예 없다
- 백그라운드 래퍼는 **`exit 0`(완료)** 로 보고했다

DB 를 세어 보니 정리 대상 55곳 중 **23곳만** 반영돼 있었다. 파이프 없이 다시 돌리니
1,941건을 완주했다(`· 옛 값 정리 32건` — 남은 32곳).

**데이터 개수를 세지 않았으면 영영 못 봤다.** 로그도 종료코드도 정상이라고 말했다.

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

- ❌ `node <수집기> | tail -N` — **프로세스를 죽인다**
- ❌ "exit 0 이니 완주했다" — SIGPIPE 는 래퍼에 따라 0 으로 보인다
- ❌ "마지막 로그가 정상이니 됐다" — 그 로그가 **마지막이 아니라 잘린 지점**일 수 있다
- ❌ "로그에 실패 0 이라 나왔다" — 루프가 중간에 끊기면 실패로 세지도 않는다

## 관련

- [[guards-must-be-mutation-tested]] §"exit code 측정 함정" — `cmd | head` 로 `$?` 를 재면
  `head` 의 종료코드가 잡힌다는 세션491 지적. **이 룰은 그보다 심한 경우**로,
  종료코드를 잘못 읽는 게 아니라 **작업 자체가 중단된다.**
- [[tool-output-illusion-guard]] — 도구가 주는 신호를 1차 진실로 믿지 말 것. 같은 결.

## 차단 검증

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 수집기를 `\| tail` 로 돌려 일부만 반영 | §1 파일 리다이렉트 → 완주 |
| exit 0 을 보고 "완료" 판정 | §2 `collector_runs` 행·요약 로그·DB 개수로 판정 |
| 로그가 정상이라 넘어감 | §3 전후 개수 비교에서 불일치 발견 |
