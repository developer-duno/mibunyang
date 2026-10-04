# NEXT_SESSION 박제값 단정 금지 — 본문/메모리/grep 의무 v2

## 한 줄

NEXT_SESSION.md 는 다음 세션 시작점이지만 **stale 위험 박제값**이다(메모리는 진실의 원천 아님). 외부 상태(사용자 콘솔 발급·collector 본문·`.env.local`)를 검증하지 않고 박제값을 단정하면 환각이 누적된다.

## 규칙

1. **작업 진입 직전, 박제값 1건을 단정하기 전 3 grep** — 박제 환경변수명(`grep -rn "<ENV_KEY>" .claude/ scripts/ .env.example`) · 박제 service ID/사이트명(`.claude/` + `~/.claude/projects/<project>/memory/`) · collector 본문(`head -50` + `grep -n "process.env\."` — 확장 vs 신규 결정).
2. **"사용자 활용신청 / 사용자 콘솔 작업" 박제는 사용자 직접 응답 1회 의무, 단정 금지** — 이미 발급 보유일 수 있다. ".env.local 에 박힌 환경변수명을 알려 달라"고 묻는다.
3. **도메인·외부 API 첫 진입 시 메모리 grep 의무** — `grep -rn "<도메인>\|<API명>\|<사이트URL>" ~/.claude/projects/<project>/memory/`.
4. **기대값은 개수 + 명단** — id 목록(길면 파일 경로)을 같이 적고, 받는 쪽은 명단을 한 번 대조한다(개수만 맞으면 내용이 뒤바뀌어도 통과한다). 감시·가드 코드의 기준선도 같다 — 지시서에 "기준선은 이름 목록, 값은 실제 DB 결과에서"를 적는다.

## 안티 패턴 (사고 답습)

- ❌ "NEXT_SESSION L34 박제값 = 진실의 원천" — stale 위험 박제값, grep 1회 의무
- ❌ "사용자 직접 콘솔 작업 의무 = 미발급 단정" — 이미 발급 보유일 수 있다, 응답 의무
- ❌ collector 이름으로 본문 추측(collect-childcare = MOHW 단정) — 실제는 Kakao 기반일 수 있다
- ❌ 여러 턴 환각 누적 뒤 사용자 정정 직후 바로 plan 작성 — 사고 박제가 우선

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/meta/next-session-grep-mandate.md](../../rules-detail/meta/next-session-grep-mandate.md)
