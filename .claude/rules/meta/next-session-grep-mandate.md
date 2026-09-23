# NEXT_SESSION 박제값 단정 금지 — 본문/메모리/grep 의무 v2

> 사건·이력 (세션251 — 어린이집 진입 시 NEXT_SESSION 박제값을 답습해 5턴 연속 환각 발생. 메모리·collector 본문 grep·사용자 콘솔 실증을 모두 안 해서 발급 보유 사실을 놓치고 "활용신청 신규 의무"까지 잘못 박제) → [rules-history/meta/next-session-grep-mandate.md](../../rules-history/meta/next-session-grep-mandate.md)

## 근본 원인 = NEXT_SESSION 박제값 신뢰

NEXT_SESSION.md = 다음 세션 시작점 답습이지만 **stale 위험 박제값**. 메모리 룰 §"메모리는 진실의 원천 아님" 답습 미준수.

박제값 단정 시 외부 시스템 상태 (사용자 콘솔 발급 자리 / 실제 collector 본문 / .env.local 박제) 검증 0회 = 환각 누적.

## 재발 방지 (3중)

### 1. NEXT_SESSION 박제값 grep 의무 (작업 진입 직전)

작업 진입 직전 NEXT_SESSION 박제값 1건 단정 전 다음 3 grep 의무:

```bash
# 박제 환경변수명
grep -rn "<ENV_KEY>" .claude/ scripts/ .env.example 2>/dev/null

# 박제 service ID / 사이트명
grep -rn "<SERVICE_ID>\|<SITE_NAME>" .claude/ ~/.claude/projects/<project>/memory/

# collector 본문 (확장 vs 신규 결정 자리)
head -50 scripts/collectors/<collector>.mjs
grep -n "process.env\." scripts/collectors/<collector>.mjs
```

### 2. 사용자 콘솔 실증 1회 의무 (활용신청/SSO/시크릿 자리)

박제값에 "사용자 활용신청 의무" / "사용자 콘솔 작업" 박제 자리 시 사용자 직접 응답 1회 의무. 단정 금지.

```
빨강 (사고 답습): "사용자가 활용신청 콘솔 1분 작업 → MOHW_KEY 발급 후 .env.local 박제"
초록 (정정): "사용자 콘솔 발급 자리 확인 필요. .env.local 박제 환경변수명 응답 의무"
```

### 3. 메모리 grep 의무 (도메인 첫 진입 시)

도메인/외부 API 첫 진입 시 메모리 grep 의무:

```bash
grep -rn "<도메인>\|<API명>\|<사이트URL>" ~/.claude/projects/<project>/memory/
```

도메인 답습 박제 (예: `info.childcare.go.kr` 별도 사이트) 메모리 부재 시 = 미박제 도메인 자리 단정 환각 위험 100%.

### 4. 기대값은 **개수 + 명단** — 개수만 맞으면 내용이 뒤바뀌어도 통과한다 (세션566)

기대값을 적을 때는 **id 목록(길면 파일 경로)** 을 같이 적고, 받는 쪽은 명단을 한 번 대조한다("14 · past:6" 이 맞았는데 3곳씩 뒤바뀌어 있었다 — 경위는 이력 파일).

## 안티 패턴 (사고 답습)

- ❌ "NEXT_SESSION L34 박제값 = 진실의 원천" — stale 위험 박제값, grep 1회 의무
- ❌ "사용자 직접 콘솔 작업 의무 = 미발급 단정" — 사용자가 이미 발급 보유 자리 가능, 응답 의무
- ❌ "collector 명명으로 본문 추측" (collect-childcare = MOHW 단정) — 실제 Kakao 기반 작동 가능 자리
- ❌ "5턴 누적 환각 발생 시 사용자 정정 메시지 직후 plan 작성" — 룰 §12 답습 사고 박제 의무 우선

> 답습 자산·차단 검증 이력 → [rules-history/meta/next-session-grep-mandate.md](../../rules-history/meta/next-session-grep-mandate.md)
