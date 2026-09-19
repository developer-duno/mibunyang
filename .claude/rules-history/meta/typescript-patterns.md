# TypeScript Patterns — JSDoc + // @ts-check 답습 자산 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/meta/typescript-patterns.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 박제 누적 사고 (자가 학습)

| 사고 | 세션 | 정착 |
|---|---|---|
| `.find(...)!.score` 환각 (TS8013) | 218 (M7-B2) | [§6] |
| calc-layout highFloor null narrow 신규 발생 | 201 | [§11] |
| Supabase GenericStringError 직접 cast 거부 | 198 | [§3] |
| D 패턴 unknown 인덱싱 → string-only 함수 호출 | 192 (M5a-extra) | [§9] |
| spread conditional TS2339 | 201 | [§7] |

## §6 사건

**사건**: 세션 218 M7-B2 — plan §B2 답습 박제값에 `.find(...)!.score` 환각. 64건 일괄 substitution 후 64 errors → 즉시 환각 발견 + 옵셔널 체인 정정. **plan 박제 패턴도 환각 가능 → 작업 중 1 substitution 직후 1 측정 의무**.

## §9 사고

**사고**: 세션 192 (M5a-extra) — D 패턴 27 errors fix 후 잔여 1 errors. L119 parenthesized cast 1건 추가로 해소. M5d collectors 35+ 변환 시 5~15 잔여 errors 가능 → 호출처 grep 으로 일괄 캐스팅.

### Why

calc-layout (세션 201) 사고: 사전 측정 9 errors 확인 후 모든 정정 적용했더니 **신규 errors 2건 발생** (TS18047 highFloor possibly null L59/L60). JSDoc 의 `highFloor: number | null` 명시가 본체 strict 추론으로 narrow 실패. 본체 가드 강화 (`highFloor != null && highFloor > 0`) 로 해결.

reverse-geocode plan v1부터 §"시뮬레이션 의무" 명시 → Agent A 가 plan 검증에서 시뮬 1회 → 1차 정정만으로 12→0 정확 예측. 본 작업도 시뮬 결과 그대로 0 errors 달성.

## §13. 입력 자산 (글로벌 메모 인덱스)

다음 글로벌 메모가 본 문서의 원천. 본문은 점에 박힌 사례, 본 문서는 정착된 패턴 카탈로그:

| 메모 | 역할 |
|---|---|
| `~/.claude/projects/f--mibunyang/memory/feedback_session218_new_patterns.md` | M7-B2 신규 6 패턴 ([§2.1][§2.2][§3.5][§3.6][§3.7][§4.3 변형]) |
| `feedback_session204_new_patterns.md` | M5d-3c-9 신규 5 패턴 ([§2.4][§3.1][§3.4][§4.1][§4.3]) |
| `feedback_session201_new_pattern.md` | spread conditional ([§7]) |
| `feedback_session198_new_patterns.md` | Group D 4 패턴 ([§3.3][§4.2][§5.1][§5.2 v2]) |
| `feedback_ts8013_non_null_assertion.md` | non-null assertion 환각 ([§6]) |
| `feedback_simulation_mandate.md` | 시뮬레이션 의무 ([§11]) |
| `feedback_d_pattern_record_unknown_limit.md` | D 패턴 한계 ([§9]) |

→ 글로벌 메모는 보존 (사고 박제 + 인용 출처). 본 문서는 미래 .ts/// @ts-check 작업의 검색 가능 카탈로그.

## §15 장점 실측

**장점**: glob 전환 = 미래 신규 collector 자동 포함 → "@ts-check 박았는데 include 미등재로 검사 안 받는 거짓 안전" 사각지대 영구 해소. 세션 350 = 거짓 안전 53파일 211에러 발견 (75개 열거 방식의 누적 사각지대).

## §16 사건

> **사건**: 세션 350 — naver-presale.test.mjs factory cast 후 LSP 가 L435/452/460 등 TS2739/TS18047 계속 보고. tsc -p tsconfig.scripts.json 실측 = 0. LSP 추측 폐기 후 tsc 만 기준으로 진행.
