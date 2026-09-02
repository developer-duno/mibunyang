# 세션539 전수 감사 — 확정 계획 (2026-09-02)

> **만든 법**: ①세션539 부팅 점검 중 메인이 직접 실측 ②6렌즈 병렬 스캔 + 발견별 적대검증
> (워크플로 `wf_7081be8a-e71` · 29 에이전트 · 22발견 → 21 생존 · 1 반박) ③합성 에이전트가 병합·분류
> ④**메인이 모든 핵심 주장을 직접 Read/Grep 으로 재확인**.
> 모든 수치는 2026-09-02 18:30~19:00 KST 실측. 라이브 정적 JSON = `fetchedAt 2026-09-01T18:08:28Z`(1,821곳),
> base `apartments` 2,905행.

---

## 이번 감사가 스스로 정정한 것 (계획을 실행 전에 고친 자리)

1. **주차 0-sentinel 적용은 회귀다.** 초안은 `parkingRatio` 에도 형제 필드와 같은 3자리 패턴을 적용하려
   했으나, `src/scoring/CLAUDE.md:556`(*"개수 필드는 0 이 진짜 값 — `parkingRatio`"*)과
   `regionalStats.ts:57`(*"0도 가능 … 미수집으로 바꾸면 안 된다"*)이 **명시적 반대 결정**을 문서화해 뒀다.
   → 처방을 **write-path 한 줄**(B-3)로 좁혔다.
2. **`trade-stats` 조용한 catch 의 심각도는 high 가 아니라 low.** `:464` 가 `recent6m.length || null` 이라
   0건이 **null(미수집)** 로 가고 `scoreRisk` 가 중립 처리한다 → 손님이 거짓을 읽지 않는다. 진짜 잔여
   위험은 **로그 공백**(아무도 모르게 값이 후퇴).
3. **`transit-match.mjs:319-330` 은 잠복이 아니다.** `lh_zone` 만 1,174건 > 1,000 이라 **오늘도 매주 2페이지**를 돈다.
4. **`floors` 층수 모순은 손님에게 안 보인다.** 세션508이 `INTERNAL_ONLY_FIELDS` 로 내렸다 → 관리자 표만.
5. **`audit-node-esm-chain.mjs` 는 `isCLI` 대상이 아니다.** `main()` 자체가 없고 import 성공이 곧 검사다.
6. **`isPlausibleExclRatioFor` 의 "라벨 미상" 완화 분기는 도달 사례 0건**(재료 보유 809곳 중 라벨 없음 0곳)
   → 스캔 발견 1건 **REFUTED**.

---

## 세션539 부팅 점검에서 메인이 직접 찾은 것 (스캔에는 없던 항목)

### F-1. 소사역 프라힐스 15곳 — 남의 주소가 박혀 좌표가 651m 어긋남 【medium · 화면 1곳】

| | 주소 | 좌표 | 지하철 | 인근시세 | 병원 |
|---|---|---|---|---|---|
| 부천 소사 현진에버빌(별개 단지) | 소사본동 **148-30** | 37.4762,126.7922 | — | 34,000 | — |
| 프라힐스 **15곳** | 소사본동 **148-30** ← 남의 주소 | 같은 좌표 | **784m** | **34,000** | **67** |
| 프라힐스 10차(정상) | 소사본동 **70-6** | 37.4818,126.7941 | **153m** | **36,000** | **113** |

네이버 실단지 `149270`(현대프라힐스소사역더프라임(주상복합)·아파트·160세대·준공 20240628)이
10차 좌표와 **13m**. 즉 **148-30 이 틀린 주소**다.

⚠️ **점수만 보면 멀쩡해 보인다** — 교통 -18점과 학군 +15점이 상쇄돼 입지 총점은 77 vs 79(2점차)뿐이다.
**틀린 것은 손님이 읽는 사실 쪽**이다(지하철 153m → 784m).

**부작용(계획 단계에서 발견)**: `collect-applyhome-seed.mjs` 의 `findDuplicate` 는 **이름 유사도 + 거리**로
중복을 판정한다. 좌표를 651m 옮기면 다음 회차 후보가 거리 밖으로 나가 **신규 삽입**될 수 있다.
`geocode-missing.mjs:108` 은 `lat.is.null,lng.is.null` 만 대상이라 **덮어쓰지 않는다**(확인 완료).

**회귀 가드**: 좌표가 네이버 `149270` 과 100m 이내인지.

### F-2. `molit-units.mjs:98-100` — `unsold_rate` 를 clamp 없이 씀 【low · 잠복】

형제 4 writer(`collect-data`·`sync-naver-complex`·`applyhome-seed`)는 `clampUnsoldRate`,
`collect-unsold-kosis` 는 `calcProportionalUnsold` 내부(:118)에 `>100 → null` 을 갖는데 **여기만 없다.**
이 수집기의 **대상이 바로 `unsold_rate>=100` 인 망가진 행**(`:52-53`)이라 자기가 다시 써넣을 자리다.
현재 base 21건은 전부 `unit_source=null` 이라 **molit 이 만든 게 아니다**(잠복 확인).
손님 노출 0 — VIEW `CASE WHEN >100 THEN NULL` + `collect-data` clamp + 화면 모순 숨김 **3중 방어**.

### F-3. `calc-floors.mjs:44` — 빈 것만 채워 층수 범위가 화석화 【low · 관리자만】

`targets = apts.filter(a => !a.floors)` 라 `max_floor` 가 갱신돼도 `floors` 는 옛 값에 멈춘다.
실측 **화면 207곳(11.4%)·base 314곳** 이 어긋나고 극단은 *"최고 90층인데 중층(6~15F)"*.
`floors` 는 `classifyFloors(max_floor)` 의 **100% 파생**이다. 손님에겐 안 보인다(위 정정 4).
**고치는 법**: `!a.floors || a.floors !== classifyFloors(a.max_floor)`.

### F-4. `scripts/audit-env-keys.mjs` 마지막 줄 — `isCLI` 가드 없음 【low】

`main()` 을 조건 없이 호출해 테스트가 import 하면 `process.exit(2)` 가 튄다(세션538 2회 관측).
자매 `audit-fill-matrix.mjs` 의 `isCLI` 패턴이 정답. **다른 8개 audit 스크립트는 전부 가드 보유**(전수 확인).

### F-5. 【정책 — 승인 필요】 "모르면 최저점" 이 필드마다 다르다

| 필드 | 모를 때 | 만점 | 채워진 곳 **점수 중앙** | 미수집 |
|---|---|---|---|---|
| 세대수 | 8 (별도 중립점) | 15 | — | 24곳 ✅중립 |
| 내진설계 | 5 (만점) | 5 | — | 1,030곳 ✅중립 |
| 용적률 | **3 (최저)** | 10 | 7 | **527곳 28.9%** |
| 전용률 | **4 (최저)** | 10 | 6 | 142곳 7.8% |
| 최고층 | **2 (최저)** | 5 | 4 | 97곳 5.3% |
| 주차 | **5 (최저)** | 15 | 8 | 71곳 3.9% |

상품성 배점 합계가 정확히 100이라 **감점 = 화면 점수 손실**. 최소 하나를 모르는 단지 **585곳(32.1%)**,
평균 +4.78점, 최대 +11점. **순위 영향** — 은퇴(상품성 45%) 평균 **74.3계단**·최대 507·상위20 중 3곳 교체 /
실거주 25.5 / 신혼 19.3 / 투자 14.5 / 자녀교육 9.3.
왜곡이 가장 큰 건 **최고층**(미수집에 2점을 주는데 채워진 곳 중 2점은 **10%뿐**).
⚠️ 코드만 고치면 화면이 안 바뀐다 — `catsCache` 재계산 필요.
⚠️ 반론: 용적률은 채워진 곳의 **44%가 최저점(3)** 이라 중앙 7 이 후하다는 지적이 가능하다.

### F-6. 【정책 — 승인 필요】 오피스텔 전용률 3곳의 출처가 "막힌 재료"

`하나스테이대명 56.1`·`대전관평 1345/1356 각 50` 의 값이 **오피스텔 매물 area2/area1** 과
0.3~0.5%p 일치 = #466 게이트가 "쓰면 안 된다"고 막은 재료. 특히 1356 은 자기 값(47.7)보다
**옆 단지 1345 값(49.7)에 더 가깝다**. 세션538 은 "재료가 없어 판정 불가"라 놔뒀는데, 재료가
없는 이유가 **게이트가 그 재료를 막았기 때문**이다.
나머지 2곳(힐스테이트송파더그리드 58·중화역라온 58)은 네이버에 단지 자체가 없어 **출처 미상**.
라벨 검증: 대전관평 2곳·하나스테이대명은 네이버 동명 단지와 **세대수 정확 일치**(270·234·96) + 유형 오피스텔 → **라벨 맞음**.

---

모든 핵심 주장을 실제 파일로 확인했다. 아래가 병합·분류·순서 정리 결과다.

---

# 미분양 비교 엔진 감사 — 21건 병합 후 **14건**

## 0. 병합 결과 요약

| 병합 후 | 원본 | 뿌리 |
|---|---|---|
| **M1** 전용률 경계 77 vs 80 | #3 + #4 | 경계가 4곳에 손으로 적혀 있고 **한 곳만 77** |
| **M2** 무정렬 페이징 잔여 | #11 + #12 | 세션534 전수종결이 `apartments`/`complexes` 만 훑음 |
| **M3** 지역 중앙값이 주택유형을 안 가림 | #14 + #15 | `computeRegionalStats` · `computeRegionalMedians` 둘 다 `region` 단독 그룹 |
| **M4** 조용한 `.catch(() => [])` | #10 + #13 | 실패와 "없음"이 같은 값으로 수렴 |
| 나머지 8건 | #1,2,5,6,7,8,9,16,17,18,19,20,21 | 각각 독립 |

---

## A. 지금 손님이 거짓을 읽고 있다 (최우선)

### A-1. 전용률 "우수" 경계가 한 곳만 77% — 나머지 셋은 전부 80% 【M1 = #3+#4】

같은 값(전용률)의 "우수" 기준이 네 곳에 손으로 박혀 있는데 **세 곳은 80, 한 곳만 77**이다.

| 자리 | 값 |
|---|---|
| `src/constants/subContext.ts:276` — `benchmark: "80%+ 우수"` | 80 |
| `src/constants/cardChips.ts:351` — `const high = exclRatio >= 80;` | 80 |
| `src/components/sections/info/ScoringEngine.tsx:36` — `전용률(80%↑ 우수)` | 80 |
| **`src/constants/subContext.ts:275`** — `sc >= 8 ? "실사용 면적 넓음"` | **77** |

`sc >= 8` 이 왜 77인지: `src/constants/scoringTiers.ts:477-481` 의 `EXCL_RATIO_TIERS` 가 `{min:80→10, min:77→8, min:74→6}` 이라 8점은 **77%부터** 나온다.

**구체 입력 → 결과**: 전용률 **78%** 단지 →
- 목록 카드: 회색 중립 칩 `전용률 78%` (강점 아님)
- 상세 모달 점수 탭: **"실사용 면적 넓음"** ← 긍정 판정
- 그 바로 옆 기준선: **"80%+ 우수"** ← 78은 기준 미달이라 말함

한 위젯 안에서 판정과 기준이 서로 다른 말을 하고, 카드와 모달도 다른 인상을 준다.
정적 JSON 실측: 전용률 보유 1,679곳 중 **77~80% 구간 307곳(18.3%)** — 드물지 않다.

**방어층 없음**. `cardChips.ts` 는 `SAFE_CREDIT_GRADES`·`DEV_NEUTRAL_BAND_PCT` 는 `scoringTiers` 에서 import 하면서 이 80만 손으로 적었다. `scoreProduct.ts:174-175` 에 정확한 3단계 detail 문구가 있으나 `CatPanel` 이 소비하지 않아(관리자 화면에서만 쓰임) 손님은 어긋난 쪽만 본다.

> **방향 판정**: 세 곳이 80이므로 **틀린 쪽은 `subContext.ts:275` 의 interpret** 이다. `sc >= 10`(=80%) 으로 올리고, 77~79 구간에 중간 라벨("전용률 양호")을 준다. benchmark 를 77로 내리면 나머지 두 곳까지 따라 고쳐야 하고 카드의 초록 강점 문턱까지 낮아진다.

**회귀 테스트 한 줄**: `EXCL_RATIO_TIERS[0].min`(80)을 리터럴로 못 박고 `interpret(10,...)`=넓음 / `interpret(8,...)`≠넓음 / benchmark 문자열에 그 리터럴이 들어가는지 — 세 개를 한 테스트에 묶는다(경계만 밀면 red).

---

### A-2. 평면 안내가 배점표에 **없는 값**을 예시로 들고, 순서도 반대 【#7】

`src/components/sections/info/ScoringEngine.tsx:36` — `평면(판상형>혼합>타워)`

실제 `src/constants/brands.ts:191-197`:
```
"4베이판상":10  "4베이타워":8  "3베이판상":7  "3베이타워":5  "2베이이하":3
```
- **"혼합"이라는 값이 배점표에 없다** — 어느 단지에도 대응되지 않는 죽은 서술
- 순서도 틀렸다: **4베이타워(8) > 3베이판상(7)** 이라 "판상형 > 타워"가 아니다. 베이 수가 먼저다.

**구체 입력 → 결과**: 4베이타워 단지(8점)와 3베이판상 단지(7점)를 비교하는 손님이 "판상형이 낫다"고 배운 뒤, 실제 점수는 타워 쪽이 높은 것을 본다.

**이건 저장소 스스로 이미 지적한 결함이다** — `src/scoring/scoreProduct.ts:181-183` 주석이 *"혼합형은 배점표에도 데이터에도 없는 값이고, 순서도 틀렸다 — 베이 수가 판상/타워보다 먼저다"* 라고 적고 detail 문구를 이미 고쳐뒀다. **안내 페이지만 안 고쳤다.** `HeaderSection.tsx:153` 은 "평면"이라고만 적어 오류가 없다 — `ScoringEngine.tsx` 한 파일만 stale.

**회귀 테스트**: `LAYOUT_SCORE` 키를 점수 내림차순으로 뽑아 만든 문자열이 `ScoringEngine.tsx` 안에 그대로 있는지(표에서 파생 → 배점 바뀌면 문구가 따라옴).

---

### A-3. 혐오시설 "500m 이내 감점" / "1km+ 안심" 이 산식과 어긋남 【#8】

두 자리가 같은 오해를 손님에게 준다.

**① `ScoringEngine.tsx:32`** — `혐오시설(500m 이내 감점)`
실제 `src/scoring/scoreLocation.ts:138`:
```js
if (noxiousDist != null && noxiousDist >= NOXIOUS_DIST_THRESHOLD) noxPen = noxPen * NOXIOUS_REDUCTION;
```
500m 는 **컷오프가 아니라 반감선**이다(0.5배). 수집기(`noxious.mjs` `SEARCH_RADIUS=2000`)는 2km 까지 담는다. 즉 500m 를 넘어도 감점은 계속된다.

**② `src/constants/cardChips.ts:386-388`**
```js
const noxSafe = noxiousDist != null && noxiousDist > 1000;
if (noxCount > 0 && noxSafe) out.push({ id:"noxiousSafe", text:"혐오시설 안심(1km+)", tone:"green", layer:"good" });
```
이 게이트는 **그 시설이 감점 대상인지 전혀 안 본다.**

**구체 입력 → 결과**: `신진주역세권 데시앙`(정적 JSON 실측: `noxious=["장례식장","고압선","공장"]`, `noxiousDist=1197`) → 고압선 감점을 (반감된 채로) **실제로 받으면서** 카드에는 초록 **"혐오시설 안심(1km+)"** 강점 칩이 뜬다. 같은 조건 단지 **14곳** 확인.

**부분 방어 있음**: `subContext.ts` 의 `countPenalty` 는 `NOXIOUS_PENALTY` 로 걸러 정직하다 — 그래서 문제 범위가 위 두 곳으로 좁혀진다. `ScoringEngine.test.jsx` 에 혐오시설 문구 가드는 없다.

⚠️ **충돌 주의**: `src/components/CLAUDE.md` 에 *"혐오시설 빨강 933곳 중 890곳(95.4%)이 감점 0 — `NOXIOUS_PENALTY` 7키와 수집 카테고리 10종 교집합이 3종뿐, 점수 재계산이 걸려 별도 PR"* 이라는 **미착수 항목**이 있다. 그 PR 이 `NOXIOUS_PENALTY` 를 확장하면 "감점 대상 없음" 집합이 통째로 바뀐다 → **A-3 의 칩 게이트 수정은 그 PR 과 같은 방향으로 맞춰야 한다**(둘 다 "감점 대상인가"를 단일 출처에서 읽게).

**회귀 테스트**: `noxiousDist=1200 + noxious=["고압선"]` 입력이 `noxiousSafe` 칩을 **안 만든다**(감점 대상 보유) / `noxious=["공장"]` 은 만든다 — 두 케이스 동시.

---

### A-4. 혜택 도움말이 **100% 미수집 항목만** 예시로 듦 【#9】

`src/constants/catHelp.ts:13`
```
benefit: "중도금 무이자·발코니 확장 같은 분양 혜택이 얼마나 있는지 보는 항목이에요."
```
`scoreBenefit.ts:50,58` 주석(세션512 실측): 분양가 할인·중도금 무이자·옵션 무상·발코니 확장·캐시백 5종은 **1,646곳 전부 null**, 금액이 있는 548곳은 **전부 '관리비 절감' 단독**.

**같은 실측으로 이미 다 고친 형제들이 있다** — `FAQSection.tsx:80`·`ScoringEngine.tsx:42` 는 *"관리비 절감을 만원 단위로 환산합니다. …할인·중도금 무이자…는 자료가 확보되면 반영됩니다"* 로 정직하게 갱신됐다. **`catHelp.ts` 만 이 정정을 놓쳤다.**

**구체 입력 → 결과**: 손님이 카테고리 제목 옆 `?` 를 눌러 "중도금 무이자·발코니 확장"을 배우고, 혜택 점수가 있는 단지를 열면 그 둘은 항상 비어 있다.

**방어층 없음**: `CatPanel.tsx:143` 이 데이터 상태와 무관하게 `<HelpHint text={catHelp(k)} />` 를 무조건 렌더한다. `catHelp.test.ts` 는 "비어있지 않은지"만 보므로 가드가 아니다.

**회귀 테스트**: `catHelp("benefit")` 이 `scoreBenefit` 이 내려주는 `wonSource` 대표값("관리비 절감")을 포함하고, 미수집 5종 이름을 **단정형으로는** 안 쓰는지.

---

### A-5. 정보 페이지 안내 2건 — 기능 축소 서술 · 같은 단어 두 정의 【#5 + #6】

같은 파일(`src/components/sections/info/GuideSections.tsx`)의 stale copy 2건.

**① `:153` — `정렬 (12가지)`** 인데 실제는 **17가지**.
`src/constants/sortOptions.ts:19-57` 실측 17개. 빠진 5개(`maintenanceLow` 관리비순 · `crimeSafe` 치안안전 · `parkingHigh` 주차넉넉 · `hospitalNear` 병원가까움 · `parkNear` 공원가까움)는 **살아있는 기능**이다 — `useDataPipeline.ts:69-104` 에 비교 함수가 전부 구현돼 있고, `SortPanel.tsx:28` 이 `SORT_OPTIONS` 전체를 slice 없이 map 하므로 드롭다운엔 **17개가 다 뜬다**.
→ 있는 기능을 손님이 몰라서 못 쓴다(과대약속이 아니라 과소약속).

**② `:97` vs `:129` — '소형'의 정의가 자기모순**
- `:97` — `소형(60㎡ 이하)`
- `:129` — `신혼부부(5억 이하 + 소형 + 혜택)` ← 실제 `filterPresets.ts:29` 는 `areaMin:"60", areaMax:"85"`

**구체 입력 → 결과**: 위에서 아래로 읽는 손님이 "소형=60 이하"를 배운 직후 60~85(국민평형 84 포함)를 '소형'이라 부르는 문장을 만난다.
**부분 방어**: `PresetPanel.tsx:55/88` 이 버튼 `title` 로 `"5억 이하 · 60㎡~85㎡ · 혜택"` 정확값을 준다 — 그러나 가이드 페이지 내부 모순은 못 막는다.

**회귀 테스트**: ① 가이드의 정렬 항목 수 == `SORT_OPTIONS.length`(파생시키면 테스트 불필요) ② `filterPresets.ts` 의 `desc` 문자열이 가이드 문장에 그대로 들어가는지.

---

### A-6. 지역 비교 헤더가 "아파트"라고 단정 — 실제로는 오피스텔·재건축 혼합 【M3 앞부분 = #14의 문구 절반】

`src/components/DeviationStrip.tsx:82`
```jsx
<span>{regionLabel} 아파트 한가운데 값과 비교</span>
```
`src/scoring/regionalStats.ts:90` 은 `region` 하나로만 묶는다:
```ts
const region = ((apt as ...).region as string) || "기타";
```
`presaleHousingType`(`scoreProduct.ts:58` 에서 실제로 쓰는 살아있는 필드)을 전혀 안 본다.

→ 모집단이 아파트+오피스텔+재건축 혼합인데 헤더는 **"아파트"라고 단정**한다.

**문구만 즉시 고칠 수 있다**(A). 버킷을 실제로 가르는 것은 표본 수 문제라 **D-3 으로 분리**한다.

**회귀 테스트**: 헤더 문자열이 `regionLabel` 과 함께 모집단 서술을 **하드코딩하지 않는지**(파생 or "분양 단지" 같은 중립어).

---

## B. 데이터가 조용히 썩고 있다 (화면엔 아직 안 나옴)

### B-1. 무정렬 `.range()` 페이징 잔여 4자리 【M2 = #11 + #12】

이 저장소는 `.claude/rules/collectors/unordered-pagination-loses-rows.md` 에서 **"정렬 없는 OFFSET 페이징은 큰 표에서 행을 잃는다 — 에러도 경고도 없다"** 를 8곳 이상 실증했다. 세션534 PR-7 이 전수종결했다고 했지만 그 범위는 **`apartments`/`complexes` 테이블만**이었다. 다른 테이블에 4자리 남았다.

| 위치 | 표 | 같은 파일에 정답이 있음 |
|---|---|---|
| `scripts/collectors/schools-neis.mjs:521-524` | `schools` | **`:444` `rescaleOnly()` 는 `.order("apartment_id")` 를 이미 붙였다.** `:507` 의 `apartments` 조회는 `selectAll(...,"id")` 커서. `main()` 만 빠짐 |
| `scripts/collectors/transit-match.mjs:288-299` | `dev_plans` (kind=station) | `:269` `apartments` 는 `selectAll` 커서 |
| `scripts/collectors/transit-match.mjs:319-330` | `dev_plans` (kind IN lh_zone,jigu) | 〃 |
| `scripts/collectors/industry-match.mjs:54-65` | `dev_plans` (industrial_complex) | `:86` `apartments` 는 `selectAll` 커서 |

**중요 정정 — "지금은 무해"가 아니다**: `transit-match.mjs:232` 주석이 *"lh_zone 실측 1144/1174(97.4%)"* 라 적는다. **`lh_zone` 하나로 이미 1,174건 > 1,000** 이라 `:319-330` 은 **오늘도 매주(일요일 11:00 KST `backfill-new-apartments.yml`) 2페이지를 돈다.** `industry-match`(618건)·station(수십 건)만 아직 1페이지다.

**구체 입력 → 결과**: `dev_plans` 의 `lh_zone`+`jigu` 가 1,174건일 때 페이지 경계에서 일부 지구가 빠지면 → `filterCityDevs` 를 거쳐 그 지구 근처 단지의 `city_dev` 매칭이 실제보다 낮게 계산돼 upsert 된다. **에러 없이.**

**기존 방어가 못 잡는 이유**: `transit-match.mjs:332-336`·`industry-match.mjs:66-68` 의 `logError` + `process.exit(1)` 은 **`devs.length === 0`(전량 실패)만** 잡는다. "일부 페이지 누락"은 통과한다.

`schools` 쪽은 결과가 좁다 — `buildEnrichedIds`(skip 판정) 재료라, 누락 시 **이미 보강된 단지가 불필요하게 NEIS 재호출**되는 것뿐이고 저장값이 틀리진 않는다. 다만 세션338/339 가 3주 연속 timeout 을 막으려고 만든 게 바로 그 skip 로직이다.

**고치는 법(전부 같은 파일에 패턴이 이미 있음)**:
- `schools-neis.mjs:521-524` → `.order("apartment_id", { ascending: true })` 한 줄 추가(`:444` 답습) 또는 `selectAll(..., "apartment_id")`
- `dev_plans` 3곳 → `select` 에 `id` 추가 후 `selectAll((s) => s.from("dev_plans")...., sb, "id")`

**회귀 테스트**: 각 조회의 `select` 리터럴에 커서 키가 있고 `.range(` 가 없는지 — ⚠️ 소스 grep 가드는 `toContain("id")` 로 쓰면 옆 옵션 줄에 오매칭된다(세션535 M4). **select 문자열 리터럴 조각으로 고정**할 것.

---

### B-2. 실패와 "없음"이 같은 값이 되는 자리 【M4 = #10 + #13】

**① `scripts/collectors/trade-stats.mjs`** — 같은 `Promise.all` 안에서 **한 줄만** 로그가 있다.

```
:233-238  articles          → logError 있음 ✅ (세션513 사고 후 추가)
:230      trades            → .catch(() => [])
:231      regions           → .catch(() => [])
:239      complexes         → .catch(() => [])
:243      complex_price_history → .catch(() => [])
:245      cancelledTrades   → .catch(() => [])
```
`fetchAll` 내부는 에러 시 throw 하므로(순단·RLS 변경·statement timeout 무엇이든) 위 5개는 조용히 빈 배열이 된다.

> ⚠️ **원 보고서의 피해 시나리오는 과장이었다 — 정정한다.** `:464` 가 `const recentTrades6m = recent6m.length || null;` 이라 **0건은 `null`(미수집)이 되지 "0건"이 되지 않는다.** `scoreRisk.ts:110` 이 null 을 `LIQUIDITY_UNKNOWN_SCORE`(중립)로 받고 문구도 "미수집"이라 표시한다. `nearbyMedian`·`jeonseRate`·`pir`·`psr` 도 각각 독립 폴백이 있다. 즉 **손님이 거짓을 읽지는 않는다.**
> 진짜 잔여 위험은 **로그 공백**뿐: 조회가 죽어도 워크플로는 success, `recordCollectorRun` 은 큰 `ok` 를 기록, `monitor-collectors.mjs` 의 outage 감지도 `ok_count>0` 이라 안 울린다 → **아무도 모르게 값이 미수집으로 후퇴**한다. 심각도는 **medium 아니라 low**.

**② `scripts/collect-data.mjs:667,671,677`** (버스 `.catch(()=>0)` / IC·KTX `.catch(()=>99)`) — API 실패와 "반경 밖"이 같은 값.
**하지만 운영 경로에 도달하지 않는다(방어층 3겹, info 급)**: `daily-deploy.yml:46` 은 `--from-supabase-only` 라 `main()` 이 `supabaseOnlyMode()` 후 즉시 return(phase6 미호출) / `prebuild.mjs:8-13` 은 Vercel 빌드에서 collect 자체 스킵 / `ci.yml` 에는 `KAKAO_KEY` 가 없어 `:651` 조기 반환. 게다가 이 파일은 **Supabase 로 write 하는 코드가 0줄**(grep 확인). → **기록만**.

**회귀 테스트**(①만): `fetchAll` 이 throw 하도록 mock 했을 때 `logError` 가 호출되는지 — 조회 6개 각각.

---

### B-3. `parking_ratio` 반올림 0 이 한 writer 에만 방어가 없다 【#1 — **범위를 크게 좁힘**】

`scripts/collectors/sync-naver-complex.mjs:421-422`
```js
if (apt.parking_ratio == null && cpx.total_parking_count && cpx.total_household_count > 0) {
  row.parking_ratio = Math.round((cpx.total_parking_count / cpx.total_household_count) * 100) / 100;
}
```
바로 위 `:416` 의 용적률은 세션538 에서 `> 0` 게이트를 받았는데(`if (!(Number(apt.floor_area_ratio) > 0) && Number(cpx.floor_area_ratio) > 0)`) **주차만 옛 형태**다. `#466` 커밋 diff 를 열어 확인: 그 커밋은 `molit-building-info.mjs` 에만 `>0` 게이트와 `.eq.0` 재대상선정을 넣었고 이 파일의 주차 블록은 손대지 않았다(같은 커밋에서 전용률·미분양률은 이 파일도 함께 고쳤는데 주차만 빠짐).

**구체 입력 → 결과**: 주차 1대/300세대 → `Math.round((1/300)*100)/100 = 0` 이 저장되고, 읽기 가드가 `== null` 이라 **이 수집기는 다시 안 건드린다**(자가 화석화). 다음 달 `molit-building-info.mjs` 의 `.eq.0` 이 잡아 재조회할 때까지 남는다.

> ⚠️ **원 보고서의 처방(engine/fieldMeta/scoreProduct 3자리에 0-sentinel 적용)은 채택하지 않는다 — D-1 참조.** 여기서 고칠 것은 **write-time `>0` 게이트 한 줄뿐**이다.

**회귀 테스트**: `total_parking_count=1, total_household_count=300` 입력에 `row.parking_ratio` 가 **설정되지 않는지**(0 이 아니라 아예 미기입).

---

## C. 가드가 껍데기라 다음 사고를 못 막는다

### C-1. 주석 제거기가 문자열 안 `*/*` 를 주석 시작으로 읽어 **34줄을 지운다** 【#17】

`scripts/collectors/_exit-quota-coverage.test.mjs:58`
```js
.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))   // ← 줄머리 고정 없음
```
같은 저장소의 **다른 4곳은 전부 이미 고쳐져 있다**:
`audit-orphan-collectors.mjs:74` · `_graceful-coverage.test.mjs:109` · `naver-presale.test.mjs:44` 모두 `^[ \t]*\/\*[\s\S]*?\*\//gm`.
세션531 이 `.claude/rules/meta/guards-must-be-mutation-tested.md` 에 **정확히 이 결함**(`"Accept": "application/json, text/plain, */*"` 의 `/*`)을 박제해 뒀는데 **이 파일만 미반영**이다.

**구체 입력 → 결과**: `scripts/collectors/` 에서 `*/*` 를 가진 파일은 **naver-presale.mjs · naver-listings.mjs · naver-devplan.mjs 3개**(grep 확인). 이 세 파일에 `recordApiQuota` 를 곁들인 `try/finally` 를 새로 넣으면서 **이 가드가 정확히 막으려는 결함 형태(try 안 `process.exit`)로 작성해도 vitest 는 초록불**을 낸다 — `stripComments` 가 그 구간을 공백으로 지워 `extractQuotaTryFinally` 가 `null` 을 반환하고, `if (!found) return;` 으로 assertion 없이 통과하기 때문.

**현재 실피해 0**: `recordApiQuota` 를 쓰는 27개 파일에 `*/*` 매치 0건. **"뚫릴 수 있는데 아직 안 뚫린 구멍"**이다. `scripts/CLAUDE.md` 의 Exit Code 정책이 확장 중이라 개연성 있는 다음 변경이다.

**회귀 테스트**: `naver-presale.mjs` 의 Accept 헤더 뒤에 결함 패턴을 넣은 문자열을 `stripComments` 에 통과시켰을 때 **그 코드가 남아 있는지** + 옛 정규식으로 되돌리는 뮤테이션이 red 인지.

---

### C-2. `toContain` 이 import 존재만 봄 【#18 — **info 로 강등**】

`src/components/DeviationRow.bundle.test.ts:37` — `expect(src).toContain("formatDeviationValue");`
문자열이 어디든 있으면 통과한다(호출 확인 아님).

**다만 시나리오는 이미 다른 가드가 막는다**: 같은 파일 `:25-33` 루프의 `not.toMatch(/from\s+["'][^"']*fieldMeta["']/)` 가 `FIELD_META` 정적 import 자체를 차단하고, `DeviationRow` 의 props(`spec/dev/value/regionLabel/compact`)에 `FIELD_META` 를 넘길 채널이 없다. → **실질 위험 없음, 정리 대상**.
**고치는 법**: `expect(src).toMatch(/formatDeviationValue\(spec,/)` 처럼 호출 문맥까지 고정.

---

## D. 정책·스펙 결정이 먼저 — **코드로 밀면 반대 방향 버그** (수정 금지, 기록만)

### D-1. `parkingRatio` 를 0-sentinel 로 만들면 **회귀다** 【#1 원 처방】

원 보고서는 형제 필드(`maxFloor`·`exclusiveRatio`)처럼 화면(`nPos`)·플래그(`===0`)·점수 기본값 3자리를 고치라고 했다. **이 저장소가 명시적으로 반대 결정을 해 뒀다.**

- `src/scoring/regionalStats.ts:58` 주석: *"⚠️ `unsoldRate`(0%=완판=유효)·`subwayDist`(자체 센티널)·**`parkingRatio`(0도 가능)**는 제외 — 이들에서 0은 진짜 값이므로 미수집으로 바꾸면 안 된다."*
- `regionalStats.ts:61` `ZERO_MEANS_MISSING` 에 `exclusiveRatio` 는 있고 **`parkingRatio` 는 없다**
- `src/scoring/CLAUDE.md:552-575` §*"0 도 sentinel 인 필드가 있다"* 가 `parkingRatio` 를 **분포 실측 근거(실제 최솟값 0.13)**와 함께 분리해 두고 *"코드가 이미 '0 도 가능'으로 일관 처리 중 — 건드리면 회귀"* 라 못박음
- 세션538(`#466`) 자신도 이 결정에 따라 **write-path 한 곳만** 고쳤다

**왜 코드로 밀면 안 되나**: 주차 0.0x 대/세대 단지가 실제로 존재한다. 0 을 "미수집"으로 바꾸면 **진짜로 주차가 거의 없는 단지가 중립 점수를 받아** 위험을 감춘다 — 이 저장소가 막으려는 거짓의 **정반대 방향** 거짓이 생긴다.
**결정 필요**: "반올림 0(1/300)"과 "실측 0.0"을 구분할 것인가. 구분하려면 소수 자리를 늘리는 게 정답이지 0-sentinel 이 아니다. → **B-3(write 게이트)만 하고 나머지는 보류.**

### D-2. 지역 중앙값 버킷을 주택유형으로 가를 것인가 【M3 뒷부분 = #14+#15 본체】

두 자리가 같은 뿌리다.
- `src/scoring/regionalStats.ts:90` — 편차 스트립(표시). 오피스텔(전용률 p50 **48.3%**)이 아파트 중앙값(p50 **74~75%**)과 비교돼 `deviation.ts` 가 **"26%p 좁아요"** 빨간 배지를 만든다 — 오피스텔에겐 **정상 범위**인데.
- `src/scoring/computeRegionalMedians.ts:31` — `_regionAvgMaint` → `scoreBenefit` 의 "관리비 절감 연 N만원"·"약 N만원" 금액 라벨(`DetailModal.tsx:580-589`)에 반영. `compute-scores.mjs:100-136` 이 매 배포마다 전 단지에 굽는다.

**왜 코드로 밀면 안 되나**: `regionalStats.ts:74-77` 주석이 *"대조군을 **시도로 고정**하는 이유 — 구 단위는 실측 213그룹·중앙 5단지라 중위값이 단지 하나에 흔들린다"* 라고 **표본 수를 근거로** 이미 한 번 결정했다. 유형으로 또 쪼개면 같은 문제가 재발하고, G1/G2/G3 게이트가 표본 부족으로 막아 **편차 스트립이 통째로 사라지는** 반대 방향 손해가 난다. 유형 혼입은 오히려 분산을 늘려 G2 를 **더 쉽게** 통과시킨다.
**결정 필요**: ① 완전 분리 ② "아파트류 vs 오피스텔/도시형" 이진 분리 ③ 유형이 다르면 그 필드만 편차 표시 생략. **`presaleHousingType` 커버리지가 59.3%**(기지 항목 2)라 나머지 40.7% 를 어디에 넣을지도 같이 정해야 한다. `scoreBenefit` 은 **가중치 0**(`profiles.ts:77-101` 5개 프로필 전부)이라 순위 영향은 0 — 금액 라벨만 영향.
→ **A-6(헤더 문구)만 먼저.** 단, 나중에 버킷을 가르면 헤더가 또 바뀌므로 **모집단에서 파생되게** 쓸 것.

### D-3. 이미 문서화된 의도적 트레이드오프 3건 — **수정 금지** 【#19, #20, #21】

| 항목 | 근거 |
|---|---|
| **비로그인 점수 블라인드가 UI 뿐**(`DetailModal.tsx:146,240`, `api/supabase/apartments.ts:400`) — DevTools 로 우회 가능 | `api/CLAUDE.md` §"비로그인 블라인드 정책"이 **세션442 보안감사 #4** 로 정확히 이 내용을 적고 *"의도된 제품 결정(점수는 공개, 로그인은 UX 유인) — 공개 부동산 분석값이라 비밀·PII 아님"* 으로 종결. SEO(구글봇 색인) 목적으로 **일부러 열어둔 경로**이며 같은 문서가 *"게이트를 되살리지 말 것"* 경고. `DetailModal.tsx:144-146` 주석도 세션503 재확인 |
| **토큰 localStorage 저장**(`src/hooks/useAuth.ts:56-57`, TTL 30일 `api/_lib/auth.ts:63`) | src 전체에 `dangerouslySetInnerHTML`·`innerHTML`·`eval`·`new Function` **프로덕션 매치 0건**. 게다가 `vercel.json:23` CSP 가 `script-src 'self'`(unsafe-inline 없음) — XSS 가 생겨도 CSP 우회가 먼저 필요. SPA+서버리스의 흔한 트레이드오프 |
| **공개 POST 가 service_role 로 INSERT**(`api/subscribers.ts:49`, `api/consults.ts` 동일) — RLS 우회 | 애플리케이션 검증(`PHONE_RE`/`REGION_RE`/`APT_ID_RE`+consent)이 견고. 아키텍처 패턴이지 우연한 실수 아님. **다만 `api/subscribers.ts:3` 주석 "RLS: anon-only INSERT"는 실제 동작과 다르다** → E-3 |

**왜 코드로 밀면 안 되나**: 셋 다 "고치면 더 안전"이 아니라 **제품/SEO/아키텍처 결정을 되돌리는 일**이다. 블라인드를 서버측으로 올리면 구글 색인이 끊기고, 쿠키 전환은 서버리스 인증 흐름을 다시 짜는 일이다.

---

## E. 저위험 정리

| # | 위치 | 내용 |
|---|---|---|
| **E-1** | `src/scoring/engine.ts:23` | 주석 *"rm(regionMedians[region]) 우선 → 지역 중위값으로 위험 필드 폴백(unsoldRate 제외)"* 이 **거짓**. 실제 `pir`(:35)·`psr`(:36)·`unsoldRate`(:40) 전부 `num(apt.X, null)` 로 `rm` 미참조. `rm` 소비처는 `supplyRatio`(:56)와 `_regionAvgMaint`(:111) **둘뿐**(전수 grep: `rm.pir`/`rm.psr`/`rm.unsoldRate` 참조 0건). `computeRegionalMedians.ts` 는 여전히 셋을 계산 → **죽은 계산**. 채점 영향 0, 다음 세션 오판 유발 |
| **E-2** | `src/components/detail/AdminUnitSupply.tsx:26` vs `:30` | `recalculated`(`units > 0`)와 `unitsUnknown`(`!(units > 1)`)의 문턱이 다르다. `units=1, unsold=1` 이면 **"총 세대 —"와 "미분양률 100.0%"가 나란히** 뜬다. 가상 아님 — `collect-applyhome-seed.mjs:118-132` 가 '무순위' 회차에서 `units=unsold=1, unsold_rate=100` 을 실제로 만들고, `molit-units.mjs:48-52` 가 `.or("units.lte.1,unsold_rate.gte.100")` 를 **보정 대상**으로 조회한다(= 그 상태가 실재). **관리자 전용**(`DetailModal.tsx:909` `adminLoggedIn` 게이트)이라 손님 무영향 |
| **E-3** | `api/subscribers.ts:3` | 주석이 `"RLS: anon-only INSERT"` 라 적지만 `:49` 는 `getMibuyangSupabase()`(service_role = BYPASSRLS). migration `20260502200000_create_subscribers.sql:27-31` 의 anon 정책은 **이 경로에서 죽은 정책**. 주석만 정정 |
| **E-4** | C-2 (`DeviationRow.bundle.test.ts:37`) | 위 참조 |
| **E-5** | B-2 ② (`scripts/collect-data.mjs:667,671,677`) | 운영 3중 방어로 도달 불가. 기록만 |

---

## 수정 순서 (위험 낮은 순: 죽은 코드 → 상수/순수함수 → 게이트 → 배관 → UI)

| 순 | 항목 | 성격 | 재계산 필요? |
|---|---|---|---|
| 1 | **E-1** engine.ts:23 주석 + `computeRegionalMedians` 죽은 계산 표시 | 주석/죽은 코드 | 불필요 |
| 2 | **E-3** subscribers.ts:3 주석 | 주석 | 불필요 |
| 3 | **C-1** `_exit-quota-coverage.test.mjs:58` 스트리퍼 (다른 4곳과 동일화) | 테스트 유틸 | 불필요 |
| 4 | **C-2/E-4** `DeviationRow.bundle.test.ts:37` | 테스트 | 불필요 |
| 5 | **A-2·A-4·A-5** 안내 문구 3건 (`ScoringEngine:36`, `catHelp:13`, `GuideSections:97,153`) | 순수 상수/문구 | 불필요 |
| 6 | **A-1** `subContext.ts:275` interpret 77→80 + 중간 라벨 | 순수 상수 | **불필요**(렌더 시 계산) |
| 7 | **A-6** `DeviationStrip.tsx:82` 헤더 | UI 문구 | 불필요 |
| 8 | **A-3** `ScoringEngine:32` 문구 + `cardChips:386-388` 게이트 | 게이트 | 불필요 (⚠️ 아래 충돌) |
| 9 | **E-2** `AdminUnitSupply.tsx:26/30` 문턱 통일 | 관리자 UI | 불필요 |
| 10 | **B-3** `sync-naver-complex.mjs:421` `>0` 게이트 | 수집기 write | 불필요 |
| 11 | **B-2①** `trade-stats.mjs` 5곳 logError | 수집기 배관 | 불필요 |
| 12 | **B-1** 무정렬 페이징 4자리 | 수집기 배관 | 다음 수집 실행 후 값 변동 가능 |
| — | **D-1~D-3** | 결정 대기 | — |

### 서로 충돌하는 수정

1. **A-3(혐오시설 안심칩) ↔ 미착수 `NOXIOUS_PENALTY` 확장 PR** — `src/components/CLAUDE.md` 에 *"혐오시설 빨강 933곳 중 890곳 감점 0, 점수 재계산이 걸려 별도 PR"* 로 예약돼 있다. 그 PR 이 감점 키를 넓히면 "감점 대상 없음" 집합이 바뀌어 A-3 의 게이트 결과가 뒤집힌다. → **둘을 같은 단일 출처(`NOXIOUS_PENALTY` 키 집합)에서 읽게** 맞추거나, 그 PR 뒤로 미룬다.
2. **A-6(헤더 문구) ↔ D-2(버킷 분리)** — 버킷을 가르면 헤더가 또 바뀐다. → 문구를 **모집단에서 파생**시켜 두 번 안 고치게.
3. **B-3(주차 write 게이트) ↔ D-1** — write 게이트만 하면 안전하지만, D-1 을 "0-sentinel 채택"으로 결정하면 downstream 3자리가 따라오고 `regionalStats.ts:61`·`src/scoring/CLAUDE.md:552-575` 문서까지 동시에 바꿔야 한다. **B-3 를 D-1 결정의 근거로 삼지 말 것**(반올림 아티팩트 차단 ≠ 0 이 불가능하다는 뜻).

### 공통 주의 (이 저장소 룰)

- 위 수정은 **전부 렌더 시 계산 또는 수집기** 라 `catsCache` 재계산이 필요 없다. 만약 `score*.ts` 의 `info`/`detail` 을 건드리면 **재계산 전에는 화면이 안 바뀐다**(`.claude/rules/meta/score-meaning-and-wording-are-a-pair.md` §6).
- 새 가드는 전부 **뮤테이션 2종 이상**(옛 값 복원 + **기각한 경쟁 후보값**)으로 red 확인. A-1 처럼 값을 고르는 수정은 경쟁 후보(77)를 반드시 뮤테이션 목록에 넣는다.
- 소스 grep 가드는 **좌변·문자열 리터럴 조각까지 고정** — 선언부·주석·옆 옵션 줄 오매칭 전례 다수(세션491·535).
---

## 구현 중에 새로 배운 것 (2026-09-02~03)

### 1. 주차 "미수집 71곳"은 맞다 — 계획 검사관의 80곳과는 **다른 것을 센 값**

계획 검사관이 *"80곳(4.4%)이 맞다"* 고 지적해 재측정했다. 실제 분해:

| | 곳수 |
|---|---|
| `parkingRatio` 가 비어 있음(`_noParking`) | 147 |
| ├ 청약자료로 **추정 가능**(`usableFallbackPR`) — 실제 값으로 채점 | 76 |
| └ **추정도 불가 = 진짜 모름** | **71** ← 정책 변경 대상 |
| 최저점(5) 받는 곳 **전체** | 433 |
| 그 중 추정값이 낮아서 받은 곳 | 9 |

검사관의 80 = `71 + 9`(= `_noParking` 중 최저점을 받는 수). 뒤 9곳은 **모르는 게 아니라 실측이 낮은**
곳이라 중립 정책의 대상이 아니다. 표의 열 이름을 "미수집" → **"진짜 모름(추정도 불가)"** 로 고쳐 읽는다.

### 2. ★ C-1 을 고치며 **내 가드가 먼저 껍데기였다**

`stripComments` 를 고치고 회귀 테스트를 붙였는데 **뮤테이션이 green** 이었다(128건 전부 통과).
원인 = 검사 대상을 **지워지는 구간 바깥**에서 골랐다. 옛 정규식은 `*/*` 의 `/*` 부터 **다음 `*/`
(아래 JSDoc 닫기)까지**를 먹는데, 내가 겨눈 `const AFTER_COMMENT` 는 그 `*/` 뒤라 옛 판본에서도 살아남았다.

**처방 = 무엇이 실제로 지워지는지 먼저 재라.** 옛/새 두 판본을 같은 파일에 돌려 줄 단위로 비교했더니:

| 파일 | 옛 판본이 먹는 줄 |
|---|---|
| `naver-presale.mjs` | **32줄** (57~95) — `IMAGE_DOMAINS` 선언 포함 |
| `naver-listings.mjs` | 11줄 (81~91) |
| `naver-devplan.mjs` | 11줄 (120~130) |

세 파일 공통으로 `sec-fetch-site` 가 그 구간 안에 있어 표적으로 삼았다 → 뮤테이션 **4건 red**.

### 3. 줄머리 고정만으로는 부족하다 — **두 위험이 반대 방향**

세션531 이 처방한 `^[ \t]*` 고정만 걸었더니 **기존 테스트가 red** 로 잡아냈다:
`finally { await recordApiQuota(); /* process.exit(1); */ }` 같은 **줄 중간 블록 주석**을 못 지워
주석 처리된 exit 이 "안전장치 있음"으로 오인된다(가짜 초록불, 반대 방향 거짓).

→ **두 단계로 나눠** 처리한다: ①줄머리 블록 주석(고정, 문자열 오인 없음) ②줄 중간 블록 주석
(`(?<!\*)` 로 `*/*` 의 `/*` 만 제외). 다른 4개 형제 파일은 줄 중간 주석 케이스가 없어 고정만으로
충분했던 것이고, 이 파일은 그 케이스를 **테스트로 지키고 있었다**.

### 4. 셸 인라인 치환은 역슬래시를 먹는다

뮤테이션 스크립트를 `node -e` / heredoc 으로 인라인 작성했다가 `\s\S` 가 `sS` 로, `\/` 가 `/` 로
붕괴해 **문법 오류로 죽은 것을 "red"로 오독**할 뻔했다. 정규식이 든 치환은 **파일로 저장 후 실행**하고
`String.raw` 를 쓴다. 그리고 뮤테이션 후 **`node --check` 로 문법부터 확인**해야
"고장 나서 red"와 "깨져서 red"를 가른다.

### 5. 계획 검사관이 "계획이 낡았다"고 한 것은 정확했다

검토 시점에 이미 구현이 병행되고 있었다. 다만 이번엔 의도된 병행(오케스트레이터가 계획 검증과
구현을 동시에 띄움)이었고, 검사관이 그 사실을 `git status` 로 스스로 발견해 보고한 것 자체가
정상 작동이다. **다음부터는 계획 검증을 구현 착수 전에 끝내거나, 검사관에게 "구현이 병행 중"임을
알려 중복 지적을 줄인다.**
