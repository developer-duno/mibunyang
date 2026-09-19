# NEXT_SESSION 박제값 단정 금지 — 본문/메모리/grep 의무 v2 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/meta/next-session-grep-mandate.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

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

## 답습 자산

- 세션 251 본 사고 박제 (NEXT_SESSION L32~38 환각 4건 정정 + 본 룰 신규)
- 미래 W6-D plan v2 작성 시 = info.childcare.go.kr API endpoint + parameter 발급 페이지 본문 fetch 1회 의무
- 도메인 새 진입 시 메모리 grep + collector 본문 grep + 사용자 콘솔 실증 3중 의무
- 세션 255 답습: 세션 254 가 dry-run sample 응답 (필드값 01~70 순번) 을 "운영 모드 실제 데이터" 로 NEXT_SESSION+SESSION_LOG+plan 4 파일 박제 (사용자 확정이라며 세션 253 placeholder 의심 폐기). 세션 255 raw API 1회 호출로 개발계정 순번 placeholder 확정 — **API 응답 내용·태그명은 운영키 raw 실측으로만 단정 가능. dry-run sample/박제값 답습 단정 금지**. 개발계정(테스트, 조회 50행 제한, 순번 응답) vs 운영계정(실서비스, 별 신청+심의) 2단계 인지 의무

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| NEXT_SESSION 박제값 ("X 활용신청 의무") 답습 단정 | §1 grep 의무 발동 → .env.local/collector 본문/메모리 3 grep |
| 사용자 콘솔 발급 자리 답습 0 단정 | §2 사용자 응답 1회 의무 → 환각 차단 |
| collector 명명 추측 (X 도메인 기반 단정) | §1 collector 본문 head -50 + process.env grep → 실제 도메인 자리 확정 |
