# 청약홈 seed 보류 정책 B-4 — "이름 같고 블록·차수도 안 어긋나면 좌표 없이도 중복" (세션543, 사장님 결정 2026-09-09)

## 결정

`collect-applyhome-seed.mjs` 의 `findDuplicate` 는 후보(청약홈 새 공고)나 기존 단지에 좌표가 없으면 무조건 `defer`(이번 run 보류,
다음 주 재시도)다. 매주 같은 10건이 보류로 반복된다(dry-run run 34241144316). 새 규칙:

> 후보 좌표가 없어도 **① 이름 유사도 ≥ 0.95 ② 블록/차수 일관(`phaseConsistent(cand.name, best.name) === "ok"`) ③ 기존 단지에 좌표 있음**
> 이면 `skip`(중복, `by: "name"`). 하나라도 아니면 지금처럼 `defer`.

기대 효과(보류 10건 실측, `phaseConsistent` 사전 실행 확인):
- **skip 6** = 제일풍경채 검단Ⅳ · 호반써밋 풍무Ⅲ · 오산세교 A-13블록 호반써밋(2차) · 의왕고천 디에트르 센트럴(B1BL)(2차) · 엘리프 성성호수공원 1BL · 2BL
- **defer 4** = 더샵 검단레이크파크 **(AB23BL)↔(AB22BL) 블록 충돌** · 평택 A-55 모아엘가 **(3차)↔(2차) 충돌**(공고 회차일 가능성이 크지만 안전 쪽) ·
  호반써밋 풍무Ⅱ(sim 0.88) · 업성 푸르지오 레이크시티(sim 0.88)

## 왜 세 조건인가

- `normName`(`collect-applyhome-detail.mjs`)은 **괄호를 통째로 지운다** → `(AB23BL)`↔`(AB22BL)` 가 sim 1.00. 유사도만으로 skip 하면 **별개 단지를 영영 못 넣는다.**
  블록/차수 숫자 집합의 **교집합**(`extractPhases`/`phaseConsistent`, 세션540 정정 도구 검증 자산)이 그 구멍을 막는다.
  교집합 방식이라 회차 숫자가 덧붙어도 블록이 같으면 ok(`(A36BL)(4차)` vs `(A36BL) 무순위 3차` → {36,4}∩{36,3} = ok), 블록이 다르면 conflict.
- 기존 단지 좌표 있음 = 세션541 제안 그대로(좌표 없는 행에 얹지 않는다).
- 0.95 는 `MATCH_SIM_MIN`(0.85, 후보 선정)보다 한 단계 높은 문턱이지만 **"사실상 같은 이름"은 아니다**(v2 H2 정정):
  `stringSimilarity = 2·LCS/(la+lb)` 라 정규화 20자짜리 두 이름은 **한 글자만 달라도 정확히 0.95**(2·19/40).
  실제로 걸러내는 건 "20자 미만에서 2글자 이상 차이" 뿐이고 20자 이상의 1글자 차이는 통과한다 —
  그래서 블록·차수 가드(`phaseConsistent` + `blockConflict`)가 **같이** 있어야 한다.

## 구현 (최소 변경)

1. **함수 이동**: `extractPhases`·`phaseConsistent`(+`PHASE_RE`)를 `scripts/fix-placeholder-addresses.mjs` → `scripts/collectors/_kakao-poi.mjs` 로 옮기고,
   도구는 `export { extractPhases, phaseConsistent } from "./collectors/_kakao-poi.mjs";` 로 **재수출**(세션541 `pickKakaoCandidate` 이동과 같은 방식)
   → 도구 테스트(`fix-placeholder-addresses.test.mjs`)의 import 는 무변경. `_kakao-poi.test.mjs` 에 두 함수 기본 케이스 3건(이동으로 가드가 끊기지 않았음을 원 위치에서 확인).
2. **`collect-applyhome-seed.mjs`**
   - `import { …, phaseConsistent } from "./_kakao-poi.mjs";`
   - 상수 `const NAME_ONLY_SKIP_SIM = 0.95;` (기존 상수 옆, 주석에 근거).
   - `findDuplicate` 좌표 없음 분기:
     ```js
     if (cand.lat == null || cand.lng == null || best.lat == null || best.lng == null) {
       const nameOnly =
         bestSim >= NAME_ONLY_SKIP_SIM &&
         best.lat != null && best.lng != null &&
         phaseConsistent(cand.name, best.name) === "ok";
       if (nameOnly) return { action: "skip", matchedId: best.id, matchedName: best.name, sim: bestSim, dist: null, by: "name" };
       return { action: "defer", matchedId: best.id, matchedName: best.name, sim: bestSim, dist: null };
     }
     ```
     기존 좌표 기반 skip 은 `by: "coord"` 를 붙여 두 경로를 구분(JSDoc 반환 타입 갱신).
   - main 루프: `verdict.action === "skip"` 안에서 `verdict.by === "name"` 이면 별도 카운터 `dupByName++` + 로그
     `[중복·이름] ${name} (${region}) ≒ ${matched} [${id}] sim=… (좌표 없음 — 블록·차수 일치)`; 요약 줄에 `중복(이름) N` 추가.
   - `dedupeWithinBatch` 는 `insert` 아니면 drop 이라 동작 동일(이유만 바뀜) — 손대지 않는다.
3. 파일 헤더(L11~13 "판정불가 보류" 설명)에 새 규칙 한 줄. `.claude/rules/collectors/placeholder-coordinates-truth-sources.md` "재발 방지" 절의
   "seed 의 정밀 중복 판정은 좌표 없으면 보류" 문장에 "단, 이름 ≥0.95 + 블록/차수 일관 + 기존 좌표 있음이면 중복(세션543 B-4)" 덧붙임.

## 테스트 (`collect-applyhome-seed.test.mjs` `findDuplicate` describe 에 추가)

- sim 1.0 + phase ok + 기존 좌표 O + 후보 좌표 X → `skip`, `by: "name"`, `dist: null`
- `더샵 검단레이크파크(AB23BL)` vs 기존 `더샵 검단레이크파크(AB22BL)` → `defer` (블록 충돌)
- `…(3차)` vs 기존 `…(2차)` → `defer` (차수 충돌)
- sim 0.88 (`호반써밋 풍무Ⅱ` vs `호반써밋김포풍무Ⅱ(오)`) → `defer`
- 기존 좌표 null → `defer` (이름·phase 만족해도)
- 경계: sim 정확히 0.95 → skip / 0.949 → defer (stringSimilarity 로 그 값이 나오는 실제 문자열 쌍을 찾아 쓰거나, 문턱 비교만 순수 함수로 빼서 검사)
- 기존 좌표 기반 skip 이 `by: "coord"` 인지(회귀)
- 뮤테이션 ≥3(각 red, 원복은 **사본 `cp`+`cmp`** — `git checkout` 금지): ①phase 조건 제거 → AB23 테스트 red ②문턱 0.95→0.85 → 0.88 테스트 red ③기존 좌표 조건 제거 → 좌표 null 테스트 red.
- 기존 테스트 30건 + 도구 테스트 120건 + `_kakao-poi` 53건 전부 green 유지(`npx vitest run scripts/collectors/collect-applyhome-seed.test.mjs scripts/collectors/_kakao-poi.test.mjs scripts/fix-placeholder-addresses.test.mjs`).

## 검증 명령

```bash
node --check scripts/collectors/collect-applyhome-seed.mjs
npx vitest run scripts/collectors/collect-applyhome-seed.test.mjs scripts/collectors/_kakao-poi.test.mjs scripts/fix-placeholder-addresses.test.mjs
npm run typecheck:scripts
node scripts/audit-env-keys.mjs
```

라이브: 머지 후 `collect-applyhome.yml` workflow_dispatch **dry-run** → 로그 `판정: 등록 0 / 중복 N / 중복(이름) 6 / 보류 4` 기대(오케스트레이터).

## 금지

- 커밋 금지(오케스트레이터가 fetch·보고·승인 후). `src/` 무변경. `dedupeWithinBatch`·`geocodeAddr`·main 의 다른 분기 무변경.

---

## v2 — 독립 리뷰 반영 (2026-09-09, 머지 전 필수 H1 + 동반 H2~H6)

리뷰어 실증(실함수 실행): `(AB23BL)`↔`(AA23BL)`·`(AA19BL)`↔`(AB19BL)`·`(C3블록)`↔`(D3블록)` 전부 `skip by=name sim 1.000`.
`PHASE_RE` 가 **숫자만** 캡처해 글자 접두 블록 차이가 게이트에 안 보인다. 로스터 실재 = 수원 `엘리프 한신더휴 C3블록`(ah-2025910250)/`D3블록`(ah-2025910251) 220m 별개 단지, 청약홈 괄호 블록 표기 ah-* 52건 중 글자접두 42건.
지오코딩 실패(이 경로의 전제)는 블록식 주소에서 가장 잘 나므로 위험 이름꼴과 실패 조건이 함께 온다.

### H1 (차단) 블록 토큰(글자+숫자) 충돌 가드
- `_kakao-poi.mjs` 에 공유 함수 추가(정정 도구와 같은 잣대를 한 곳에):
  ```js
  export const BLOCK_RE = /([A-Za-z]{1,2})-?(\d+)\s*(?:BL|블록|블럭)/gi;
  /** 글자 접두 블록 토큰 집합 — "(AB23BL)"→{"AB23"}, "A-13블록"→{"A13"}, "C3블록"→{"C3"} */
  export function extractBlockTokens(name) { … m[1].toUpperCase() + String(Number(m[2])) … }
  /** 둘 다 블록 토큰이 있는데 교집합이 없으면 true */
  export function blockConflict(aName, bName) { … }
  ```
  ⚠️ `g` 플래그 정규식은 `matchAll` 로만 쓴다(주석 한 줄, H6).
- seed `findDuplicate` 의 `nameOnly` 에 `&& !blockConflict(cand.name, best.name)` 추가.
- 도구(`fix-placeholder-addresses.mjs`)의 C-매칭에도 같은 가드가 유효하지만 **이 PR 범위 밖** — BACKLOG 후속 1줄.
- 테스트(seed): `(AA19BL)`↔`(AB19BL)` → defer · `(C3블록)`↔`(D3블록)` → defer · `A-13블록`↔`A13BL` 은 토큰 동일(A13) — 단 이 쌍은 sim 0.848 로 후보 자체가 안 되므로 **`extractBlockTokens` 단위 테스트**로 하이픈·BL/블록 정규화 회귀를 지킨다(`_kakao-poi.test.mjs`). 뮤테이션: `!blockConflict` 제거 → 2건 red.

### H2 문턱 주석 정정
- `stringSimilarity = 2·LCS/(la+lb)` 라 정규화 20자에서 **한 글자 차이 = 정확히 0.95**. 상수 주석 "사실상 같은 이름" → "20자 미만에서 2글자 이상 차이를 걸러낸다(20자↑는 1글자 차이가 0.95 — 그래서 H1 블록 가드가 같이 필요)". 스펙 상단 L22 동일 정정.

### H3 동점 tie-break
- `sim > bestSim` 이라 sim 1.00 동점(`X(AB22BL)`·`X(AB23BL)`·네이버 `X`)이면 `selectAll` 순서가 판정을 정한다(실증: 기존 [AB22, AB23] 순 → 후보 (AB23BL) defer, 반대 순 → skip). 동점이면 **`phaseConsistent === "ok" && !blockConflict` 인 후보 우선**:
  `if (sim > bestSim || (sim === bestSim && best && !bestOk && ok))`. 테스트: 기존 순서 두 가지 모두 같은 결과(skip, matchedId = AB23 행).

### H5 로그 문구
- `[중복·이름] … (좌표 없음 — 블록·차수 일치)` → `(좌표 없음 — 블록·차수 비충돌)` (둘 다 블록·차수가 없어 ok 인 경우도 있으므로).

### H6 주석
- `PHASE_RE`·`BLOCK_RE` export 옆: "`g` 플래그 — `matchAll`/`replace` 만 쓸 것(`.test/.exec` 는 lastIndex 가 샌다)".

### BACKLOG 후속(코드 변경 없음, 1~2줄)
- seed 이름 경로에 `gu` 게이트 없음(시도만) — 같은 시도 동명 이단지(예: 광주 `라펜트 힐` 3.2km)는 좌표 경로만 가른다. 실측상 시도 교차 skip 0.
- 정정 도구 C-매칭에 `blockConflict` 미적용.

### 검증
- `npx vitest run scripts/collectors/collect-applyhome-seed.test.mjs scripts/collectors/_kakao-poi.test.mjs scripts/fix-placeholder-addresses.test.mjs` · `npm run typecheck:scripts` · 뮤테이션 H1(가드 제거)·H3(tie-break 제거 → 순서 의존 테스트 red) 각각 red, 원복 `cp`+`cmp`(git checkout 금지).
- 오케스트레이터: 로컬 dry-run 재실행 → 여전히 `중복(이름) 7 / 보류 4`(이번 주 로스터엔 글자접두 충돌 쌍이 없어 수치 불변이어야 함).
