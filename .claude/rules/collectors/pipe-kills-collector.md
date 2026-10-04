# 수집기를 파이프 뒤에 두지 마라 — `| tail` 이 프로세스를 죽인다

## 한 줄

**`node scripts/collectors/X.mjs | grep ... | tail -4` 는 수집기를 중간에 죽인다.**
`tail` 이 필요한 줄을 다 받고 파이프를 닫으면 상류 프로세스가 **SIGPIPE** 로 종료된다.
DB 쓰기 루프가 돌던 중이면 **일부만 반영되고 끝난다** — 그런데 로그도 `collector_runs` 행도
안 남아서, 겉보기에는 "정상 종료"다.

## 규칙

1. **수집기·마이그레이션 등 쓰기 작업은 파이프 없이 파일로 받고 나서 읽는다** — `node scripts/collectors/X.mjs > /tmp/x.log 2>&1; echo "exit=$?"` 뒤 `tail -5 /tmp/x.log`. `head`·`tail`·`grep -m N`·`sed q` 처럼 입력을 끝까지 안 읽는 명령이 전부 해당 — 습관을 가르지 말고 쓰기 작업은 무조건 파일 리다이렉트.
2. **종료코드·마지막 로그를 완료 근거로 쓰지 않는다** — 완료 판정은 그 수집기가 스스로 남기는 것: `collector_runs` 에 이번 실행 행(`finished_at` 이 방금) · 마지막 요약 로그(`[완료] N초 | 성공 X | 실패 Y`) · **DB 실제 개수가 기대한 만큼 변했는가**(가장 확실).
3. **쓰기 작업 뒤에는 전후 행 수를 센다.**

## 안티 패턴

- ❌ `node <수집기> | tail -N` — **프로세스를 죽인다**
- ❌ "exit 0 이니 완주했다" — SIGPIPE 는 래퍼에 따라 0 으로 보인다
- ❌ "마지막 로그가 정상이니 됐다" — 그 로그가 **마지막이 아니라 잘린 지점**일 수 있다
- ❌ "로그에 실패 0 이라 나왔다" — 루프가 중간에 끊기면 실패로 세지도 않는다

## 관련

- [[guards-must-be-mutation-tested]] §"exit code 측정 함정" — `cmd | head` 로 `$?` 를 재면 `head` 의 종료코드가 잡힌다. 이 룰은 작업 자체가 중단되는 더 심한 경우.
- [[tool-output-illusion-guard]] — 도구가 주는 신호를 1차 진실로 믿지 말 것. 같은 결.

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/collectors/pipe-kills-collector.md](../../rules-detail/collectors/pipe-kills-collector.md)
