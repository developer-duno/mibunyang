# 스코어링 엔진 규칙

> 스코어링 모듈 수정 시 반드시 이 규칙을 따를 것.

## on-demand 1개로 전량 이관 (세션568)

이 디렉토리의 상세 규칙(파일 구조·함수 시그니처·가중치 합계·클램핑·PIR 구간·fairPrice
폴백·연식/신축 계수·괴리도·scoreFuture 3축·서브지표 점수 테이블·null 처리)은
**전부 [.claude/rules/scoring/scoring-engine.md](../../.claude/rules/scoring/scoring-engine.md)** 로 옮겼다
(`paths: src/scoring/**`, `src/constants/{scoringTiers,brands,profiles}*` — 이 디렉토리를 수정·조회할 때 자동 로드).

⚠️ 파일을 안 읽고 `node -e` 로 DB 만 만지는 세션에서는 안 불려온다 — 해당하면 직접 Read.

## 세션576 (2026-09-26) — 주차 산식 위치
- 주차 비율 **추정 산식은 `src/constants/parkingEstimate.ts` 한 곳**(`estimateParkingRatio(presaleParking, units, presaleGeneralSupply)` = 주차대수 ÷ max(총세대, 일반분양, 1), `0 < r ≤ 3` 만 값). `scoreProduct.ts` 는 이 함수를 부른다(값·문구 무변경, 리팩터 전후 동일성 시험 `parkingEstimate.test.js`). constants → scoring 방향 import 금지(순환) — 그래서 constants 층에 둔다.
