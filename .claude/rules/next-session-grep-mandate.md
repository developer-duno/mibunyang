# NEXT_SESSION 박제값 단정 금지 — 본문/메모리/grep 의무 v2

## 사고 박제 (세션 251)

세션 251 첫 turn W6-D 어린이집 진입 의지 시 NEXT_SESSION L32~38 박제값 ("MOHW_KEY 활용신청 의무 / 15012690 service ID / Kakao 미사용 단정") 답습 단정 5턴 누적 환각 발생.

사용자 콘솔 스크린샷 (info.childcare.go.kr 보육정보공개 API 발급 4건 보유, 2026-04-07 승인 만료 2027-04-07) 박제 시 사용자 5번째 정정 메시지로 환각 확정.

raw 사고 (NEXT_SESSION 답습 → 환각 5건):

- 메모리 grep 0회 (`grep -rn 어린이집 ~/.claude/projects/`) → info.childcare.go.kr 답습 누락
- collect-childcare.mjs 본문 grep 0회 → Kakao Places 기반 작동 자리 답습 누락
- 사용자 콘솔 실증 0회 단정 → "활용신청 신규 의무" 박제

5턴 누적:

1. turn 3 — service ID `15012690` 단정 (NEXT_SESSION L34 답습)
2. turn 5 — "보건복지부_어린이집 표준 데이터" 제공기관 단정 (실제 = 한국사회보장정보원)
3. turn 7 — (b) "기본정보" OpenAPI 후보 박제 (실제 = CSV archived 2022-07-10)
4. turn 9 — data.go.kr 단일 발급 사이트 단정 (실제 별도 info.childcare.go.kr)
5. turn 9 — "활용신청 신규 의무" 박제 (실제 = 사용자 콘솔 4건 발급 보유)

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

## 안티 패턴 (사고 답습)

- ❌ "NEXT_SESSION L34 박제값 = 진실의 원천" — stale 위험 박제값, grep 1회 의무
- ❌ "사용자 직접 콘솔 작업 의무 = 미발급 단정" — 사용자가 이미 발급 보유 자리 가능, 응답 의무
- ❌ "collector 명명으로 본문 추측" (collect-childcare = MOHW 단정) — 실제 Kakao 기반 작동 가능 자리
- ❌ "5턴 누적 환각 발생 시 사용자 정정 메시지 직후 plan 작성" — 룰 §12 답습 사고 박제 의무 우선

## 답습 자산

- 세션 251 본 사고 박제 (NEXT_SESSION L32~38 환각 4건 정정 + 본 룰 신규)
- 미래 W6-D plan v2 작성 시 = info.childcare.go.kr API endpoint + parameter 발급 페이지 본문 fetch 1회 의무
- 도메인 새 진입 시 메모리 grep + collector 본문 grep + 사용자 콘솔 실증 3중 의무

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| NEXT_SESSION 박제값 ("X 활용신청 의무") 답습 단정 | §1 grep 의무 발동 → .env.local/collector 본문/메모리 3 grep |
| 사용자 콘솔 발급 자리 답습 0 단정 | §2 사용자 응답 1회 의무 → 환각 차단 |
| collector 명명 추측 (X 도메인 기반 단정) | §1 collector 본문 head -50 + process.env grep → 실제 도메인 자리 확정 |
