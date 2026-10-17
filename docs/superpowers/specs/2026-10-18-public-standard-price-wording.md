# 설계서 — 공공기관 준거 시세 비교 ① 판정어 삭제 + 같은 면적 정확히 같음 (세션651 · 2026-10-18)

> 사장님 결정(10/18 03:3x): **(가) 판정어·색을 빼고 숫자·출처만** · **(A) 같은 집 = 부동산원식 면적 정확히 같음** · **전세가율은 유지하되 칩 색·좋음/나쁨 삭제 + 산식 표시** · **10/22 01:00 trade-stats 회차 전에 합침**.
> 조사 원문·측정 = `.omc/artifacts/session651/`(research-public-standards.md · research-data-terms.md · measure-exact-area.md · design-draft-public-standard.md · peer-replies-own-method-audit.md). 전/후 그림 = https://claude.ai/artifact/Lc9ojrJ4PatNxTw5eMKXTd
> 범위 밖(다음 설계): 공공 비교값 나열(부동산원 지역 전세가율·실거래가격지수·공시가격 수집기 — "다음 단계(다)") · 점수 괴리도 곡선·종합 등급·AHP 문구 · 위험 높음 나머지 7개(credibility-inventory #3~#9).

## 0. 근거(원문)
- 한국부동산원 공동주택 실거래가격지수 "단지, 면적, 동, 층그룹(1,2층/최상층/중간층)이 같은 아파트를 동일 주택(아파트)으로 가정"(조사개요, reb.or.kr mi=9811 cntntsId=1193 · 2022-09-29 동일주택 가정 변경). 면적에 허용 폭 없음.
- 국토부 실거래 API(공공데이터포털 15126469) 이용허락범위 "제한 없음". 부동산원 R-ONE 제10조② 출처 표시 조건 자유 이용·제9조② 임의 변경 금지.
- 공공기관이 손님용 용어 "적정가"를 쓰는 원문 없음(2차).
- 측정(손님 목록 1,941 · 탐침 = 운영 DB 와 1,941곳 전부 일치): 적정가 값 있음 1,446 → 정확히 같음 943(같은 단지 같은 면적 470 · ㎡당 328 · 동네 또래 145 · 빈칸 998) · 전세가율 338 → 239. 국토부 면적은 소수 둘째까지, 우리 대표 면적 43%는 셋째·넷째 자리.

## 1. PR-1 문구(표현계층, `src/` 만 — 점수 산식·칸 이름 불변)

원칙: "적정가"라는 이름 · ±10% 판정("저렴/비쌈/수준") · 초록/빨강 색을 **손님 화면에서 없앤다**. 그 자리에 **비교 대상의 사실**(무엇과 · N건 · 기간 · 중앙값 · 분양가 · 차이 %)과 **출처**를 적는다. 차이는 `분양가가 X% 낮음/높음`(두 숫자의 산술 차이를 적는 말 · 부호 = `deviation` 그대로: +면 분양가가 낮음). 관리자 전용 화면(`AdminScoreBreakdown`·`AdminHelpGuide`)은 범위 밖(손님 노출 0).

| # | 자리(파일:줄, main 3636742e) | 지금 | 바꾼 뒤 |
|---|---|---|---|
| W1 | `src/constants/cardChips.ts:244-269` 칩 `priceCheap`·`priceExpensive`·`priceFair` | `적정가보다 12% 저렴 (이 단지 실거래 기준)` 초록 굵게 / `… 비쌈` 빨강 / `적정가 수준` | 칩 **하나** `priceCompare`: `{기준} 중앙 {fmtPrice(cmpFairPrice)} ({cmpN}건·{cmpMonths}개월)` · tone `plain` · layer `core` · bold 없음. 기준 = `priceBasisLabel` 재사용(`이 단지 실거래`·`이 단지 분양권 거래`·`같은 동 또래 실거래`) + per_m2 면 ` ㎡당 환산`. 괴리율 숫자는 칩에 **안 적는다**(카드는 짧게 — 그림 ①). 범위 none → 칩 없음(지금과 같음). `DEV_NEUTRAL_BAND_PCT` 는 이 파일에서 안 읽는다 |
| W2 | `src/constants/cardChips.ts:355-367` 전세가율 칩 | `전세가율 72%` 초록(70~80)/주황(>80·<50)/회색 | 칩 **하나** `jeonseRate`: `전세가율 72% (전세 {complexJeonseN}건 ÷ 매매 {complexSaleN}건)` · tone `plain` · layer `neutral`. 건수 칸이 없으면 `전세가율 72%`. `jeonseHigh`·`jeonseTooHigh`·`jeonseLow` 칩 id 삭제(소비처 grep: `cardChips.ts:89·101·115` 층 표 — 같이 정리. `sortOptions.ts:37`·`useDataPipeline.ts:64·87`·`types/hooks.ts:42` 의 `jeonseHigh` 는 **정렬 키**라 다른 것 — 건드리지 않는다) |
| W3 | `src/components/detail/PricePositionBox.tsx` 시세 탭 상자 | 머리 줄 `… 기준 — 적정가 7.8억, 분양가는 12% 저렴` + "적정가 대비 위치" 눈금(`PositionGauge`, ±35) + 전세가율 줄 | 머리 줄 `이 단지 같은 평수(전용 {area}㎡) 실거래와 견주면`(dong_peer 면 `같은 동 비슷한 연식(±10년)·같은 평수 …`) + **표 3~4줄**: `분양가 X` · `{기준} 중앙값 Y ({n}건 · 최근 {m}개월)` · `차이 분양가가 Z% 낮음/높음` · `전세가율 R% (전세 j건 ÷ 매매 s건)` + 출처 줄 `출처: 국토교통부 아파트 실거래가(공공데이터포털) · 같은 집 기준 = 한국부동산원 실거래가격지수 정의(단지·면적 같음)`. **눈금(PositionGauge)·"적정가 대비 위치" 제목·`DEV_*` import 삭제**. 범위 none → `비교할 실거래가 아직 없어요`(그대로). 동네 사실 줄(`dongFactParts`)은 그대로. 면적은 `apt.area`(`hasKnownArea`) 없으면 "같은 평수" 토막 생략 |
| W4 | `src/constants/subContext.ts:107-120` 점수 탭 판정 | `적정가보다 저렴/비쌈/수준` · 기준 `적정가 ±10% 이내` | 키 이름은 서브 이름(W6)에 맞춰 바꾸고 interpret = `분양가가 {abs}% 낮음/높음` (0.0% 면 `같음`) · 산출 불가 = `비교할 실거래 없음` · benchmark = `같은 단지 같은 평수 실거래 중앙값 대비 · 국토부 실거래가` |
| W5 | `src/constants/subContext.ts:128-138` 전세가율 판정 | `전세가율 적정 (70~80%)`·`높음`·`낮음`·`매우 높음 — 매매가에 근접` · benchmark `70~80% 적정 (높아도 낮아도 감점)` | interpret = `전세 중앙값 ÷ 매매 중앙값 = {jr}%` · benchmark = `같은 단지 같은 평수 전세·매매 각 3건 이상일 때 계산` (점수 곡선은 그대로 — 문구만 판정어 삭제) |
| W6 | `src/scoring/scorePrice.ts` 서브 `name: "적정가 괴리도"`·`devDetail`(`+11.5% (…) — 이 단지 실거래 12건(최근 12개월) 대비`) | | 서브 이름 `실거래 대비 분양가` · detail = `분양가가 11.5% 낮음 — 이 단지 같은 평수 실거래 12건(최근 12개월) 중앙값 대비` (`DEV_BAND_LABEL` 토막 삭제) · none 은 그대로. ⚠️ 이름을 바꾸면 `subContext` 키·`DetailModal:519` 핵심지표 라벨·`CategoryMiniCard`·`CatPanel`·`AdminScoreBreakdown`·시험(`engine.test.js`·`wordingHonesty.test.js`·`subContext` 시험)에서 "적정가 괴리도" grep 전수 교체. `catsCache` 에 구워지므로 머지 뒤 daily-deploy(03:00) 또는 `compute-scores` 재계산 뒤 화면에 닿는다(규칙 score-meaning §6) |
| W7 | `src/constants/catVerdict.ts:34-39` 카테고리 한 줄 | `적정가 대비 12% 저렴/비쌈`·`적정가 수준` | `실거래보다 12% 낮은 분양가` / `… 높은 분양가` / 차이 0 = `실거래와 같은 분양가`. 비교 없음 분기는 그대로 |
| W8 | `src/components/DetailModal.tsx:519·527-533·539` 종합 탭 핵심지표 | `l: "적정가 괴리"` · 값 색 = `DEV_NEUTRAL_BAND_PCT` 3분기(초록/빨강) · hint "…'적정가'와 …" | `l: "실거래 대비 분양가"` · 값 색 **중립 하나**(`DEV_NEUTRAL_BAND_PCT` import 삭제) · hint = 같은 단지 같은 평수 실거래 중앙값(없으면 같은 동 또래)과 분양가의 차이. +면 분양가가 낮음. 출처 국토부 실거래가. "좋은 신호" 같은 평가어 삭제 |
| W9 | `src/components/sections/info/FAQSection.tsx:51-59` · `GuideSections.tsx:54·64·89·229` · `ScoringEngine.tsx:39` | "적정가 괴리도란?" 등 | "적정가" → "같은 단지 실거래 중앙값" · "저평가" → "실거래보다 낮은 분양가" · 전세가율 가이드 64 는 산식만. `ScoringEngine.tsx:87` "AHP 계층분석법" 문구는 범위 밖(inventory #6) |
| W10 | `src/constants/scoringTiers.ts:939 DEV_NEUTRAL_BAND_PCT` 주석·`src/types/scoring.ts` 주석 | | 소비처가 점수·관리자만 남으면 주석에 "손님 문구에서는 안 쓴다(세션651)" 한 줄. 상수 자체는 유지(관리자 toneLabel·눈금 상수 `DEV_FULL_MIN_PCT` 등은 `AdminScoreBreakdown` 이 쓸 수 있음 — 안 쓰면 import 정리) |

시험·가드(실측 — 옛 id·문구를 기대하는 시험 12파일: `AptCard.test.jsx`·`AdminScoreBreakdown.test.jsx`·`PricePositionBox.test.tsx`·`DetailModal.test.jsx`·`cardChips.test.ts`·`catVerdict.test.ts`·`scoringTiers.test.ts`·`sortOptions.test.js`(정렬 키 — 그대로)·`subContext.test.js`·`useDataPipeline.test.js`(정렬 — 그대로)·`engine.test.js`·`wordingHonesty.test.js` · e2e 에 "적정가|저렴|비쌈|전세가율" 0건): `cardChips` 시험(`priceCheap`/`jeonse*` 기대 → 새 id) · `PricePositionBox.test.tsx`(머리 줄·표·출처 줄 · 눈금 없음) · `subContext`·`catVerdict`·`wordingHonesty.test.js`(판정어 "저렴|비쌈|적정가" 가 손님 문자열에 0건인 **부정 가드** 추가 — 변이: 옛 문구 되돌리면 red) · e2e 는 상세 모달 시세 탭 한 번(`e2e/*detail*`). 전수 grep 의무(규칙 score-meaning §1): `grep -rn "적정가\|저렴\|비쌈" src --include=*.ts --include=*.tsx | grep -v test` 가 **주석·관리자 전용 외 0건**.

## 2. PR-2 같은 면적 = 정확히 같음(수집기 `scripts/collectors/_trade-scope.mjs` + 시험 + 문서)

| # | 바꿈 |
|---|---|
| A1 | `sameArea(a, A)`(적정가 T1·T2·`sale_same_n` 진단)·`jeonseSameArea`(전세가율) 를 **하나의 판정** `sameAreaExact(a, A) = round2(a) === round2(A)`(`Math.round(x * 100) / 100`) 로 통일. `SAME_AREA_TOL_M2`·`JEONSE_SAME_AREA_TOL_M2` 상수 삭제(소비처 grep: `_trade-scope.mjs`·`_trade-scope.test.mjs`·`trade-stats.mjs` 요약 진단·`scripts/CLAUDE.md`·`docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md`·plans). `PER_M2_TOL_M2`(20㎡ ㎡당 환산)·`PEER_YEARS`(또래 10년)·`MIN_DEALS`(3건)·`CMP_MONTHS`(12)는 **그대로**(결정 2 — 아래 §4 열린 점 ①) |
| A2 | 머리 주석: 부동산원 정의 원문 + URL + "소수 둘째 반올림 = 국토부 면적 자릿수(측정: 거래 창 1,057,870행 중 셋째 자리 이상 0건)" |
| A3 | 시험 `_trade-scope.test.mjs`: 84.92 vs 84.99 → 다름 · 84.985 vs 84.99 → 같음(반올림) · 84.9871(우리 넷째) vs 84.99(국토부) → 같음 · 84.98 vs 84.99 → 다름 · 폭 10/3 되돌리면 red 되는 변이 케이스 · 전세가율도 같은 판정 사용 확인 |
| A4 | `trade-stats.mjs` 요약 진단(`sale_same_n` 문구 "10㎡")·로그 문구 → "같은 면적" |
| A5 | 문서: `scripts/CLAUDE.md` 세션590 줄 · `docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md` R1·R3 에 "세션651 개정: 정확히 같음(부동산원)" 한 줄 · `.claude/rules/scoring/scoring-engine.md` 적정가 절 한 줄 · `src/constants/scoringTiers.ts:862` 근처 주석 |
| A6 | 2u 통보(합친 뒤 SendMessage): `complex_jeonse_rate`·`complex_jeonse_n`·`complex_sale_n`·`cmp_*` 칸 이름·형식 불변 · 10/22 회차부터 값 있는 단지 수 줄어듦(전체 3,291 기준 전세가율 488→334) · 2u 가 "같은 평수" 라벨을 쓰면 "전용 면적 같음(소수 둘째)" 로 |

예상 영향(손님 1,941): 적정가 값 1,446→943 · 전세가율 338→239. 첫 회차(10/22) 뒤 확인 = `cmp_scope` 분포(complex same_area ≈470 · per_m2 ≈328 · dong_peer ≈145)·`complex_jeonse_rate` not null ≈334(전체). 되돌리기 = A1 한 함수.

## 3. 순서·검증
1. PR-1(src)·PR-2(scripts) **병렬**(겹치는 파일 0 — PR-1 은 `scoringTiers.ts` 주석만, PR-2 는 `scripts/**` + 문서). 각 작업반 Opus, 전용 워크트리(C:).
2. 각 PR: 표적 시험 + `typecheck`(src / scripts) + `lint` + `format:check` + 전체 시험 1회(구현자 마지막) + 관련 audit(`audit-customer-facing-excuses` 는 PR-1).
3. PR-1 합친 뒤 **playwright 전/후 캡처**(규칙 show-screen-changes-first — preview 빌드, 휴대폰 390 + 데스크톱, 카드·시세 탭·점수 탭) → 사장님 "진행" 뒤 운영 반영. 문구는 `catsCache` 때문에 03:00 재굽기 뒤 전부 닿는다.
4. 검사관(합치기 전): 적대 Opus(PR-2 수집기 + PR-1 표현 묶어 1인) · 맹점 Opus(설계서 대조 — 자가점검 3) · 할루 Sonnet(마무리).
5. 10/22 01:00 전 둘 다 main. 그 뒤 §2 첫 회차 확인 3가지(세션650 것과 합쳐).

## 4. 열린 점(사장님 결정 — 설계서 승인 질문과 함께)
① **㎡당 환산(20㎡ 이내)·같은 동 또래(±10년)** 는 부동산원 정의에 없는 우리 보조 범위다. 이번엔 **유지하되 기준을 문장에 그대로 밝힌다**(`면적 20㎡ 이내 ㎡당 환산`·`같은 동 비슷한 연식(±10년)`)가 초안. 없애면 적정가 값 943→470.
② 카드 칩에 차이 %를 넣을지(초안 = 안 넣음, 시세 탭·점수 탭에만).
