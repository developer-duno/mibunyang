# 설계서 — 편차 줄 「점과 눈금」(안 A) · 2026-10-21 세션653 (BACKLOG A-22 🔵 재설계 1단계)

> 그림 = `.omc/artifacts/session653/design/deviation-redesign.html`(아티팩트 EWAWqsb2aFGPArWHaB57K6 · 계정 바뀌면 원본으로 재발행). 코드 자리 실측은 2026-10-21 main `2f026cf8` 기준 — 구현 전 다시 grep(그 뒤 #757·#758 합침). 사장님 결정 10/21 09:3x: ① 안 A 먼저, C(공공 준거)는 2단계 ② 카드 3줄에 이 단지 값·지역 한가운데 값 둘 다 ③ 주차·전용률 판정색·판정어도 뺌 ④ 머리글 모집단·출처 문구 적음(추천대로).

## 1. 목표
막대(길이 = 백분위, 색 = 판정) 를 **눈금 위 점**으로 바꿔 ① 판정 없이 "분포 어디쯤"만 보이고 ② 길이·숫자가 모두 **값** 한 잣대가 되게 하고 ③ 비교 모집단·출처를 머리글에 적는다. 점수·정렬·필터·추천은 건드리지 않는다(편차는 표시 전용 파생값 — `lib/deviation.ts` 머리 주석 그대로).

## 2. 화면 규칙(카드 3줄 = 종합 탭 8줄, 같은 부품)
- **눈금**: 가로선 + 세 눈금 글자(하한 · 한가운데 · 상한). 하한/상한 = 그 지역 분포의 **p10 / p90**(극값이 눈금을 깨뜨리지 않게 — 그림의 "9km+" 는 p90 위를 뜻함) · 한가운데 = `median`. 글자는 `formatDeviationValue` 와 같은 서식(만원·%·m·배·대/세대). 점 = 이 단지(`percentileOf` 그대로 → 트랙 x 좌표, p10 아래·p90 위는 끝에 붙이고 끝 눈금 글자에 `+`/`−`).
- **오른쪽 두 값**: 윗줄 굵게 이 단지 값, 아랫줄 작게 `한가운데 N`. 카드도 같다(결정 ②) → `ROW_HEIGHT` 22 → 30, 카드 높이 +24px(3줄) — 무한스크롤 행 높이 추정값(`AptListSection`/가상 목록 상수) 함께 고침.
- **색·말**: 점·눈금 전부 중립색. `goodWord/badWord/lowWord/highWord` 는 눈금 양 끝 말(`낮다/높다` 등)로만 남기고 "여유로워요/좁아요"·파랑/주황은 **8줄 모두 제거**(결정 ③ — `parkingRatio`·`exclusiveRatio` 도 `neutral: true`). 값 문구(`12% 높음`)는 스크린리더 문장(`deviationAriaLabel`)에만 남긴다(눈에 보이는 숫자는 두 값으로 충분).
- **머리글**(`DeviationStrip` 제목 줄): `경기 분양 단지 312곳과 견줌 · 우리 수집(네이버·청약홈)` — n 은 `stat.n`, 전국 폴백이면 `전국 분양 단지 N곳`. 도움말(`deviationHelpText`)은 "판정 없이 위치와 값만" 으로 다시 쓴다.
- **빠진 값·표본 부족·추정치** 줄의 동작은 지금 그대로(`sparse`·`uniform`·`missing`·`estimated` 분기 유지, 추정치는 값만).

## 3. 코드 자리(실측 2026-10-21 main 2f026cf8)
| 자리 | 바꿀 것 |
|---|---|
| `src/scoring/regionalStats.ts` `FieldStat` | `p10`·`p90` 추가(`sorted` 에서 계산 — 이미 `sorted` 보존) · `MIN_REGION_SAMPLE` 등 변경 없음 |
| `src/lib/deviation.ts` | `Deviation` 에 `pct`(백분위)·`median`·`p10`·`p90` 노출 · `fav` 뒤집기(`better==="low"`) 삭제 — 전부 neutral · `deviationText` 는 aria 전용 |
| `src/constants/deviationFields.ts` | 8줄 `neutral: true` · `goodWord/badWord` 제거(타입에서 optional 로) · 주차 `fallback` 유지 |
| `src/components/DeviationRow.tsx` | 막대 → 눈금+점 그림(SVG 또는 div 3개) · 오른쪽 두 값 · `ROW_HEIGHT` 30 · `toneColor` 제거 |
| `src/components/DeviationStrip.tsx` | 머리글 모집단·출처 문구 · 도움말 문구 |
| `src/components/AptCard.tsx`·목록 높이 상수 | 카드 높이 +24 반영(가상 목록 추정치) · memo 비교(`deviationInputsEqual`) 그대로 |
| 시험 | `DeviationRow.test.tsx`·`DeviationStrip.test.tsx`·`deviation.test`·`regionalStats.test` — 판정색·판정어 단언 삭제, p10/p90·두 값·머리글 n 단언 추가 · 변이: ① 점 위치 식 뒤집기 ② p10/p90 바꿔치기 ③ 머리글 n 고정값 — 셋 다 빨강이어야 함 |
| 문구 가드 | `src/components/sections/info/GuideSections.tsx` 의 편차 설명 문장 grep → "오른쪽이 좋다" 류 문장 제거(규칙 `score-meaning-and-wording-are-a-pair` §1 전수 grep, `head` 금지) |

## 4. 하지 않는 것
공공 준거 값(안 C) · 점수 엔진 · 카드 칩 · 정렬. 안 B(표) 는 넣지 않는다.

## 5. 검증·절차
① 구현(Opus 작업반, 워크트리) → 표적 vitest + `npm run typecheck` ② playwright 전/후 캡처(390px + 데스크톱 · 카드 3장 + 종합 탭 1곳, 로컬 vite + 운영 /data) → 사장님께 보여 드린 뒤 "진행" ③ 검사관 = 화면만 바꾸므로 `ui-adversary`(Sonnet) 1인 + 맹점은 생략(실행 코드 50줄 넘으면 Opus 맹점 추가) ④ 합치기 → Vercel → 라이브 눈 확인. 2단계(안 C)는 오늘 공공 기준 조사 보고(`public-standards.md`)로 줄별 출처가 확정된 것만 별도 설계.

## 6. 함께 끝낸 결정(세션653)
SGIS 시도 불일치 2곳(`ap-6023092`·`ap-6024718`, 강동리엔파크 13·14 임대) = 좌표 정상(카카오 138m·출처 없음) → **감시 예외 명단** — 지금 `checkSgisMapMarkers` 는 `SGIS_SIDO_MISMATCH=N` 개수만 읽고 예외 장치가 없다 → 처방 = `sgis-map-emd.mjs` 에 `SIDO_MISMATCH_ALLOWLIST`(id 2개 + 이유 주석) 를 두고 그 id 는 `skip sido-mismatch` 대신 `skip allowlisted`(N 에서 제외, 로그 한 줄) + 시험 1건(명단 밖 id 는 그대로 센다). B-3 뒤 작은 PR(검사관 1인).
