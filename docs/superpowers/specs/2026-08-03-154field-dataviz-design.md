# 154필드 시각화 설계 — 카드 1장 + 팝업 6탭 (세션 486)

> **상태**: 설계 확정 · 목업 검토 완료 · **구현 미착수**
> **목업(웹)**: https://claude.ai/code/artifact/c3a7a293-47e7-4ae8-ad6e-a93a104ba64e
> **산출 경위**: 워크플로 13에이전트(실측 3 → 조사 3 → 설계 3안 → 3렌즈 심사 → 종합)

## ⚠️ 이 문서를 쓰기 전에 — 세션 486 자가 적대검증에서 확인된 정정 2건

| 문서/목업의 표현 | 실측 결과 | 조치 |
|---|---|---|
| 미래가치 “전국 1위” | 같은 90점이 **132곳(공동 1위)** | 등수는 반드시 **“공동 N위”** 로 표기 |
| 미분양 “평균이면 126집” | 중위율×규모 추정치. 다른 방법은 18집(**7배 차**) | 추정을 사실처럼 쓰지 말고 **비율끼리 비교** |

점수가 정수라 **동점이 대량 발생**한다(실측: 가격 24곳·안전 74곳·입지 83곳 동점).
“N등” 단독 표기는 과장이 된다.

## 구현 전 반드시 재확인할 것

- 본문의 모든 수치는 **2026-08-02~03 시점 실측**이다. 착수 전 재측정 후 대조할 것.
- 혜택(benefit) 축 제거는 **사장님이 “제휴 업체 슬롯”으로 성격을 확정**한 데 따른 것이다
  (나중에 클릭 → 자사 블로그형 홈페이지 연결). 데이터 근거(80% 0점)와 별개로 **제품 결정**이다.
- 제휴 배지는 **점수 구역과 시각적으로 분리**한다 — “돈 낸 업체라 점수가 높나” 오해 차단.

---
모든 핵심 수치를 레포에서 직접 재측정했습니다. 심사 3건이 서로 엇갈린 지점(`CAT_ORDER` 중복, `catsCache` 키 순서, A의 보안 경고, FIELD_META 차집합)은 전부 실측으로 결론냈습니다. 아래가 최종 통합 설계입니다.

---

# 미분양 비교 엔진 — 154필드 시각화 최종 통합 설계 v1

> 채택: **B(편차형) 뼈대 + C(FIELD_META 개방·거리 축분리·CI 가드) + A(백분위 언어·visual 구멍·comparator 재현 테스트·혜택축 제거) + 심사 3렌즈가 공통으로 지적한 맹점 6건 해소**
> 이 문서의 모든 수치는 **이 세션에서 직접 실행해 얻은 값**입니다. 재현 불가/미검증은 명시했습니다.

---

## 0. 착수 전에 확정한 사실 (내가 직접 측정)

| 항목 | 실측 | 설계 영향 |
|---|---|---|
| `apartments-list.json` | **154키 × 1,581행** (union·row0 동일) | 매핑표 기준 = 이 154 |
| **`catsCache` 키 순서** | 1,581행 **전부** `risk>price>future>benefit>product>location` | ⚠️ 아래 §0-1 |
| `calcCats()` 반환 순서 (`engine.ts:136`) | `price>location>product>benefit>risk>future` | **운영과 폴백 순서가 다름** |
| `CAT_ORDER` | **이미 존재** — `profiles.ts:39`, `["location","product","price","risk","benefit","future"]`, module-private, 동점 tie-break 용 | C의 "신설" 제안은 **동명 충돌** |
| `AptCard` topCats | `Object.entries(res.cats).sort(가중치)` — **tie-break 없음** | 동점 시 `catsCache` 키 순서에 의존 |
| comparator (L528-579) | 28개 비교문. **`res.cats.*`·`price`·`region` 전부 없음** | silent stale 위험 |
| `FIELD_META` | **145키** / `hidden:true` **8개** / `better`(방향) 키 **0개** | |
| 154 ∖ FIELD_META | **10개**: `announcementUrl` `bankDist` `cafeDist` `catsCache` `cultureDist` `lat` `lng` `pharmacyDist` `scoresComputedAt` `updatedAt` | B의 CI 테스트 집합 오류 확정 |
| FIELD_META ∖ 154 | **1개**: `benefits` (상세 버킷 배열) | |
| `FIELD_SECTIONS` | 9그룹 **142필드** (−`benefits` = 141) | 141 + 3(META만: `elecUsageKwh`·`gasUsageMj`·`energyCollectedAt`) + 10 = **154** ✓ |
| 미노출 4필드 | `bankDist` **96.5%** · `cafeDist` **95.0%** · `cultureDist` **97.0%** · `pharmacyDist` **76.2%** — `FIELD_SECTIONS`에도 없음 | 무료 커버리지 +4 |
| sentinel 제거 후 채움 | `ktxDist` **0.0%** · `icDist` **3.9%** · `subwayDist` **82.7%** · `supplyRatio` **0.0%** | |
| 카드 4후보 채움 | price 94.8 / unsoldRate 84.8 / jeonseRate 98.2 / subwayDist 82.7 | |
| `benefit` 0점 | **1,267 = 80.1%** | 6축 → 5축 |
| 지역 표본 | 경기543 서울297 인천147 부산95 … 전북21 **제주16(유일 n<20)** | G1 임계 n≥20 근거 |
| `computeRegionalMedians` | 5필드만, `useDataPipeline:173` **needsFallback일 때만 호출** | 상시 훅 필수 |
| `visual.spec.ts` | L38·L57 `mask: [locator('[role="button"]')]` = **카드 30장 통째 가림** | 시각 회귀 0건 |
| `GuideSections.tsx:186` | 사용자에게 **"레이더 차트"** 안내 중 — 세션 409에서 제거된 기능 | **현재 라이브에서 거짓 안내** |
| A의 `useAppNavigation` 보안 경고 | `L84 = if (!isLoggedIn && k === "map")` **정상 가드**, `if (false` grep 0건 | **재현 불가 — 근거 없음** |
| 워킹트리 | `M src/components/sections/KakaoMapView.tsx` (**다른 세션 작업 중**) | 착수 전 재확인 필요 |

### 0-1. ⚠️ 착수 전 반드시 고쳐야 할 **현존 잠재 결함**

세 심사가 "색 순서를 바꾸자"고 했지만, 실측 결과 **문제의 성격이 다릅니다.**

화면의 6카테고리 순서를 정하는 곳은 `DetailModal.tsx:483`·`:233`, `AptCard.tsx:165`의 **`Object.entries(res.cats)`** 이고, `res.cats`는 운영에서 서버 `catsCache`를 그대로 씁니다. 즉 **현재 화면 순서 = `risk→price→future→benefit→product→location`** 이며 이것은:

1. **약속된 계약이 아니라 JSON 직렬화 부산물**입니다. 수집기가 필드 대입 순서를 바꾸면 화면 순서가 소리 없이 뒤집히고 **어떤 테스트도 red가 되지 않습니다.**
2. **폴백 경로(`calcCats`)와 순서가 다릅니다.** `catsCache` 누락 단지는 다른 순서로 그려집니다.
3. 마지막 두 자리가 `product(#7C3AED 보라) → location(#2563EB 파랑)` 로 **CVD 최악 쌍이 인접**합니다.
4. `AptCard` topCats에 tie-break가 없어(`live`는 benefit 5/future 5 동점, `retire`도 benefit 5/future 0) **상위 3칸의 마지막 자리가 이 불안정한 순서에 의존**합니다.

→ **PR-0에서 `CAT_DISPLAY_ORDER` 단일 출처를 신설**하고 세 렌더 사이트를 전환합니다. 이건 시각화의 전제 조건이지 부수 작업이 아닙니다.

**이름 충돌 주의**: `profiles.ts`의 기존 `CAT_ORDER`는 **동점 tie-break 용**이고 순서가 다릅니다. 같은 이름을 새로 만들면 안 됩니다. 기존 것은 `CAT_TIEBREAK_ORDER`로 개명하고, 화면 순서는 `CAT_DISPLAY_ORDER`로 분리합니다.

---

## 1. 최종 설계 요약

**카드**는 총점 배지(기존)를 그대로 두고, 그 아래에 **"이 단지 vs 지역 중위값" 편차 막대 3줄**을 넣습니다. 막대는 SVG가 아니라 div이고, 규칙은 하나 — **오른쪽으로 길수록 유리**. 막대 양끝에 한글 라벨(`싸다`/`비싸다`)이 박혀 범례가 필요 없고, 오른쪽 값 슬롯은 숫자가 아니라 **짧은 한국어 문장 조각**(`12% 싸요`)입니다. 카테고리 3칸은 등급 문자 + 3px 막대 한 줄로 압축합니다. **팝업**은 탭마다 [요약 시각화 1개 → 세부 → **전체 데이터 아코디언**] 3층 골격으로 통일하고, 그 아코디언은 새로 만드는 게 아니라 **이미 완성돼 관리자에게만 잠겨 있던 `FIELD_META` 145엔트리 레지스트리를 소비자에게 여는 것**입니다. 여기에 지금까지 수집만 하고 한 번도 안 보여준 은행·카페·문화시설·약국 거리 4개가 처음 노출됩니다. 154필드 전량 도달은 문서 표가 아니라 **`apartments-list.json` 실제 키에서 뽑아 대조하는 CI 테스트**로 잠급니다. 차트 라이브러리는 **0개** 추가하고, 데이터가 없는 필드는 그리지 않고 **왜 없는지를 한국어로 말합니다**(전국 기준 사용 / 이 지역 공통값 / 미수집).

---

## 2. 카드 최종 명세

### 2-1. 변경 요약

| 현재 (`AptCard.tsx`) | 조치 | 후 |
|---|---|---|
| ⓪ 등급 그라디언트 바 h4 (L207) | 유지 | 그대로 |
| ② 헤더 + `ScoreBadge` 56 (L220-271) | 유지 | 그대로 |
| ③ 추천이유 칩 (L273) | 유지 | 그대로 |
| — | **신설** | **③.5 편차 스트립 3줄 (h 86)** |
| ④ 카테고리 3칸 grid + `Bar` h5 (L275-299, ≈40px) | **압축** | **④′ 신호등 1줄 (h 26)** |
| ⑤ infoRow 칩 최대 16종 (L301-412) | **1개만 제거** (역세권 — 스트립이 흡수) | 나머지 15종 그대로 |
| ⑥ 혜택 박스 (L415-432) | 유지 (`benefitWon>0` 게이트) | 그대로 |
| ⑦ alertRow 배지 (L441-499) | 유지 | 그대로 |
| ⑧ 버튼행 minHeight 36 (L502-524) | 유지 | 그대로 |

**칩은 1개만 뺍니다.** B는 5개를 뺐지만 "역세권 340m"(절대 사실)와 "역세권 −41%"(상대값)는 같은 정보가 아니라는 심사 지적이 옳습니다. 정보 삭제는 최소화하고, 높이는 목업에서 사장님이 고르게 합니다.

**높이 수지**: `+86(스트립) −14(카테고리 압축) = 순증 +72px`. 카드 343 → **약 415px**.

### 2-2. 편차 스트립 한 줄 (`DeviationRow`) — 실치수

```
┌───────────────────────────────────────────────────────┐
│ 분양가  싸다 ▏████████│              ▕ 비싸다  12% 싸요 │
│ ←48px→  20  ←──── 트랙 T ────→        20     ←─76px─→  │
└───────────────────────────────────────────────────────┘   행 높이 22, 행 간격 5
```

| 요소 | 치수 | 스타일 | 데이터 |
|---|---|---|---|
| 라벨 | `w 48` 고정 | `F.sm(12)` `C.muted` `nowrap` | 한글 2~3자 |
| **좌 끝말** | `w 20` | `F.sm(12)` `C.muted` | `싸다`/`적다`/`가깝다` |
| 트랙 | `flex:1` `minWidth 100` `h 8` `radius 99` | `#ECEEF4` | — |
| **중앙 기준선** | `w 2` `h 12` (트랙 위아래 2px 돌출) | **`#9CA3AF`** | 지역 중위값 = 50% 지점 |
| 편차 막대 | `h 8` `radius 99`, 폭 `|fav−50|/50 × T/2` | 유리 `C.blue` / 불리 `C.amber` / ±3% 내 `C.muted` | 백분위 |
| 희소 캡 | `w 3 h 8` 진한 사각 (막대 끝) | 막대색 90% | 백분위 ≤10 또는 ≥90 |
| **우 끝말** | `w 20` | `F.sm(12)` `C.muted` | `비싸다`/`많다`/`멀다` |
| **값 슬롯** | `w 76` 우정렬 | **`F.base(14)`** weight 700, 유리=`C.blue`/불리=`C.amber`/중립=`C.muted` | **문장 조각** |

`fav = better==="low" ? 100−백분위 : 백분위` → **오른쪽이 항상 유리**.

**값 슬롯이 숫자가 아니라 문장 조각인 것이 이 설계의 핵심 선택입니다.** `−12%`는 "왜 마이너스인데 오른쪽이지?"를 만들지만 `12% 싸요`는 막대 방향과 어긋나지 않습니다. 심사 3렌즈 중 두 곳이 지적한 부호/방향 충돌을 이걸로 해소합니다.

| 지표 | 라벨 | 좌·우 끝말 | 값 슬롯 예시 |
|---|---|---|---|
| `price` | 분양가 | 싸다 · 비싸다 | `12% 싸요` / `8% 비싸요` / `평균 수준` |
| `unsoldRate` | 미분양 | 적다 · 많다 | `3%p 많아요` / `평균 수준` |
| `subwayDist` | 역세권 | 가깝다 · 멀다 | `41% 가까워요` |

`%p`는 **화면에 쓰지 않습니다**(비율 지표는 "3%p 많아요" 대신 `3%p`를 유지하되 툴팁에서 풀이 — §9).

### 2-3. 스트립 블록 헤더

```
서울 아파트 평균과 비교          ← F.sm(12) C.muted, marginBottom 4, h 16
```
"중위값"이라는 전문어를 화면에서 **완전히 제거**합니다. 정확한 정의는 `HelpHint`(?) 안에 넣습니다(§9).

### 2-4. 카드 3지표 — 선정 근거 (전부 실측)

| 지표 | 유효채움 | 지역중위 산출 | 답하는 질문 |
|---|---|---|---|
| `price` | **94.8%** | 17/17 | "싼가?" |
| `unsoldRate` | **84.8%** | 17/17 | "안 팔리나?" |
| `subwayDist` | **82.7%** (sentinel 274건 제외) | 17/17 | "교통 되나?" |

- `jeonseRate`(98.2%) 제외 = 줄 수 예산. 팝업 종합 탭 8줄에 포함.
- `pir` 제외 = 이미 지역 소득으로 정규화된 값이라 지역 편차를 또 내면 이중 정규화.
- **`supplyRatio` 영구 제외** = 원천 **0.0%**, 17시도 중위값 전부 null. 기존 `computeRegionalMedians`가 계산은 하지만 쓸 수 없습니다.

### 2-5. ④′ 신호등 1줄 (카테고리 3칸 압축)

```
가격 A  ▮▮▮▮▮▯▯    입지 B+ ▮▮▮▮▯▯▯    안전 A  ▮▮▮▮▮▮▯
```
`repeat(3,1fr)` gap `6px 10px`(데스크톱 `8px 12px`), 각 칸 = [2자 라벨 `F.sm` + 등급문자 `F.base` 700 `gr().c`] 한 줄 + 그 아래 **기존 `Bar` `h={3}`**. 총 **h 26** (현재 40에서 −14).
카테고리 선정은 기존 `topCats` 재사용하되 **`getTopCats(profileWeights, 3)`로 교체**해 동점 tie-break를 얻습니다(§0-1 ④).

### 2-6. 3종 뷰포트 실치수

| 뷰포트 | 컨테이너 | 열/gap | 카드 폭 | body 패딩 | 내부 가용폭 | **트랙 T** |
|---|---|---|---|---|---|---|
| **375 모바일** | 375−32 | 1열 | 343 | `14px 16px` | 311 | **147** |
| **768 태블릿** | 768−32 | 2열 gap16 | 360 | `14px 16px` | 328 | **164** |
| **1024 데스크톱(최악)** | 1024−48 | 3열 gap20 | 312 | `16px 20px` | 272 | **108** |
| 1280 데스크톱 | 1200−48 | 3열 gap20 | 370 | `16px 20px` | 330 | **166** |

`T = 가용폭 − 48(라벨) − 20 − 20(끝말) − 76(값) − gap 6×4`.
**최악 108px**에서도 1 백분위점 = 1.08px이라 중앙 기준선 대비 좌/우 판독이 성립합니다. `minWidth 100` 가드로 그 이하는 방지.

**뷰포트별로 줄 수를 바꾸지 않습니다.** 폭만 늘고 구성은 불변 — 30장 세로 스캔과 "세 번째 줄은 역세권" 학습을 지키기 위함입니다.

### 2-7. 결측 시 높이 고정 (심사 공통 맹점 ④)

`price` 5.2%·`unsoldRate` 15.2% 결측이라 단지마다 줄 수가 달라지면 무한스크롤에서 스크롤 위치가 튑니다. → **결측이어도 행을 제거하지 않고 h22를 유지**하고, 트랙을 45° 회색 해칭 + 값 슬롯 `미수집`으로 채웁니다. 스트립 블록 전체 높이는 **항상 86px 고정**.

---

## 3. 팝업 최종 명세

### 3-1. 공통 3층 골격 (6탭 동일)

```
[탭 칩] 종합 시세 입지 분양 금융 점수
├── ① 요약 시각화 1개               (h 96~180)
├── ② 세부 (기존 컴포넌트 + 신규 차트)
└── ③ ▸ 이 탭의 전체 데이터 N개      ← 접힘. FieldTable
```
③이 `AdminDataAudit.tsx`의 `FieldSection` 렌더 로직을 **공용 `FieldTable`로 추출**한 것입니다(관리자·소비자 공유, 중복 0).

### 3-2. 탭별 요약 시각화

| 탭 | 요약 시각화 | 신규? | 핵심 결정 |
|---|---|---|---|
| **종합** | **편차 스트립 8줄** (카드 3 + `jeonseRate`·`pir`·`parkingRatio`·`avgMaintenanceCost`·`exclusiveRatio`) — 카드와 **완전히 같은 컴포넌트**, 트랙만 넓음 | 신규 | 카드에서 배운 읽는 법이 그대로 통함. `CategoryMiniCard` 6개는 **유지**(세션 409 결정 존중) |
| **시세** | `AreaPriceScatter` — `priceByArea`(96.6%, 단지당 중앙 **28포인트**, min·max·count) 산점 + min~max 세로 범위 밴드 + 이 단지 분양가 가로선 | 신규 | 154필드 중 **유일하게 단지 하나로 분포가 성립**하는 자산 |
| **입지** | `DistanceDots` — 거리 12종 도트 플롯. **캡별 축 3분리** | 신규 | 실측 캡이 499·989·2,971·**69,072m**로 제각각 → 공통 축은 거짓말 |
| **분양** | `PresaleTimeline` 4스텝 + `presaleMinPrice↔MaxPrice` 범위 막대 + **로그축** 경쟁률 | 신규 | `competitionRate` max **437,995** → 선형축이면 나머지 전부 0폭 |
| **금융** | `LoanStack` 2조각 (LTV 대출 / 자기자금) + DSR 40% 통과선 | 신규 | 조각 3개 이상 금지(밑변 불일치) |
| **점수** | 기존 `CatPanel` 6개 + `ProfileWeightBar` | **신규 없음** | **§10-3 참조 — 슬로프 그래프는 의도적으로 뺍니다** |

### 3-3. 154필드 전량 도달 매핑표

> 출처: `apartments-list.json` 실제 키 154개 (내가 직접 union 추출). 산술 검증: 141(FIELD_SECTIONS) + 3(META만) + 10(레지스트리 밖) = **154** ✓

| 탭 | 개수 | 필드 (전량) | 형식 |
|---|---|---|---|
| **T1 종합** | **36** | **[개요 21]** `id` `name` `dong` `gu` `region` `address` `roadAddress` `district` `area` `price` `pp` `floors` `maxFloor` `units` `unsold` `builder` `completion` `layout` `heating` `avgMaintenanceCost` `primaryDirection` · **[상품성 10]** `parkingRatio` `floorAreaRatio` `energyGrade` `greenBldg` `quakeDesign` `exclusiveRatio` `hasPool` `heatFuel` `corridorType` `buildingCoverageRatio` · **[에너지 3]** `elecUsageKwh` `gasUsageMj` `energyCollectedAt` · **[메타 2]** `updatedAt` `scoresComputedAt` | 요약=편차 스트립 8줄 / 세부=`OVERVIEW_SECTIONS`+미니카드6 / 전체=**FieldTable** / 메타 2개=footer "데이터 기준 …" |
| **T2 시세** | **24** | **[가격 13]** `nearbyMedian` `jeonseRate` `pir` `psr` `dataReliability` `nearbyBuildYear` `avgFloor` `floorRange` `priceIndex` `avgPriceSqm` `landCostRatio` `netMigration` `housingSupplyLevel` · **[네이버 교차검증 11]** `naverNearbyMedian` `naverNearbyAvg` `naverJeonseRate` `naverSellCount` `naverJeonseCount` `naverWolseCount` `naverBuildYear` `naverAvgFloor` `naverSchoolWalkMin` `naverNearbyCount` `naverFetchedAt` | 요약=`AreaPriceScatter` / 세부=`PRICE_SECTIONS`+`PriceTable`+`PriceChart`+`UnsoldChart`+`MarketStatsCharts` / 전체=FieldTable |
| **T3 입지** | **42** | **[입지 36]** `subwayDist` `subwayName` `subwayLines` `busRoutes` `busStopNames` `icDist` `ktxDist` `schoolScore` `schoolGrade` `hospital` `hospitalDist` `mart` `martDist` `conv` `convDist` `park` `parkDist` `cafe` `culture` `bank` `pharmacy` `police` `policeDist` `childcare` `childcareDist` `emergency` `emergencyDist` `view` `sunlight` `noise` `noxious` `noxiousDist` `airQuality` `fertilityRate` `doctorsPer1k` `hospitalBedsPer1k` · **★[신규 노출 4]** `bankDist` `cafeDist` `cultureDist` `pharmacyDist` · **[좌표 2]** `lat` `lng` | 요약=`DistanceDots`(★4 포함) / 세부=`LOCATION_SECTIONS`+`SchoolInfo`+`KakaoMapView`+시설 **점 매트릭스** / 전체=FieldTable |
| **T4 분양** | **38** | **[안전 18]** `unsoldRate` `competitionRate` `competitionSupply` `competitionApplicants` `unsoldEventCount` `lastUnsoldEventAt` `crimeSafetyGrade` `recentTrades6m` `cancelRatio6m` `supplyRatio` `builderCreditGrade` `builderDebtRatio` `hugGuarantee` `isRegulated` `dsr40pass` `popGrowth` `newSupply` `initialSaleRate` · **[분양 19]** `presaleMinPrice` `presaleMaxPrice` `presalePp` `presaleType` `presaleStage` `presaleStageCode` `presaleHousingType` `presaleGeneralSupply` `presaleBuildings` `presaleParking` `presaleMoveIn` `presaleRecruitDate` `presaleSchedule` `presaleInquiry` `presaleFeatures` `presaleImageUrl` `naverPresaleNo` `naverPresaleSeq` `presaleFetchedAt` · `announcementUrl` | 요약=`PresaleTimeline`+범위막대+로그축 경쟁률 / 세부=`PresaleInfo` 3섹션+`AnnouncementLink` / 전체=FieldTable |
| **T5 금융** | **9** | `discountPct` `loanFree` `loanFreePct` `optionFree` `optionValue` `balconyFree` `balconyValue` `cashback` `contractDiscount` | 요약=`LoanStack` / 세부=`LoanAnalysis`+`LoanRatesSection` / **혜택 9필드 전부 0.0% → "혜택 정보 없음" 1줄로 접음** |
| **T6 점수** | **5** | `transitDev` `devDist` `cityDev` `industryDev` · `catsCache` | 세부=`CatPanel` 6개(41 세부지표) + `ProfileWeightBar` |
| **상세 버킷 8** | — | `priceByArea` `priceByFloor` `jeonseByArea` `rentByArea` → T2 / `nearbySchools` `nearbyChildcare` `nearbyFacilities` → T3 / `benefits` → T5 | 154 밖. `nearbyChildcare`·`nearbyFacilities`·`benefits`는 **전 단지 0%** → 섹션 통째 미렌더 |
| | **154** | | |

**클릭 깊이**: 팝업 1 + 탭 1 + 아코디언 1 = **최대 3클릭**. 팝업 헤더 필드 검색 입력 사용 시 **1클릭 + 타이핑**.

### 3-4. ⚠️ 이중 노출 방지 (심사 공통 맹점 — 실측 확인)

`src/scoring/score*.ts`에 `info:`/`detail:` 문자열이 **93건** 있고, 이들이 `energyGrade`·`quakeDesign`·`landCostRatio`·혜택 블록 등을 **이미 점수 탭 `CatPanel`에 텍스트로 노출**하고 있습니다(예: `scoreProduct.ts:123` → `${energyGrade}등급`).

세션 409가 레이더를 뺀 기준이 정확히 "이중 노출"이었으므로 **PR-6 착수 전에 `grep -n "info:\|detail:" src/scoring/score*.ts` 93건이 어느 필드를 이미 노출하는지 전수 대조**하고, FieldTable에서 중복되는 필드는 **"점수 탭에서 자세히" 링크로 대체**합니다. 이 대조는 PR-6의 필수 선행 작업입니다.

**A의 41지표 퍼센타일 스트립은 채택하지 않습니다** — `CatPanel`이 이미 같은 41개를 라벨·값·설명과 함께 보여주고 있어 정확히 이중 노출입니다.

---

## 4. 채움률 낮은 필드 처리 규칙 (3중 게이트)

**진실의 원천**: `src/constants/sentinels.ts`(신설) — `scripts/collectors/data-audit.mjs:40` `MASKED_DEFAULTS`와 값이 어긋나면 CI가 exit 1.

```ts
export const SENTINEL = { subwayDist: 9999, icDist: 99, ktxDist: 99 } as const;
export const isSentinel = (f: string, v: unknown) =>
  f in SENTINEL && Number(v) >= SENTINEL[f as keyof typeof SENTINEL];
```

| 게이트 | 조건 | 화면 | 문구 |
|---|---|---|---|
| **G1 표본** | 시도 `n ≥ 20` | 정상 막대 | — |
| | `8 ≤ n < 20` | 전국 기준으로 그림 + 회색 배지 | `전국` |
| | `n < 8` | 막대 없음 | `비교할 단지가 적어요` |
| **G2 변별력** | `mad === 0` 또는 `distinct ≤ 2` | 막대 없음, 값만 | `이 지역은 다 같아요` |
| **G3 본인값** | `null` 또는 `isSentinel()` | 45° 회색 해칭 트랙 | `미수집` |

**G2가 이 설계의 구조적 방어선입니다.** 지역 상수 13필드 + 구 상수 14필드(경기 543단지가 전부 같은 값)를 **필드명 하드코딩 없이 자동 배제**합니다. `popGrowth`·`priceIndex`·`landCostRatio`가 실수로 들어와도 스스로 사라지고, 새 필드가 늘어도 유지보수할 "제외 목록"이 생기지 않습니다.

**G1 임계 근거**: 17시도 중 20 미만은 **제주(16)** 뿐이고 다음이 전북(21). 구 단위는 213그룹·중앙 5단지라 중위값이 불안정 → **대조군은 시도 고정**.

**아코디언(FieldTable)의 저채움 필드**: 값이 없으면 `미수집`, `hidden:true` 8개 중 `greenBldg`·`presaleStageCode`는 해제, 나머지 6개(`presaleImageUrl`·`naverPresaleNo`·`naverPresaleSeq`·에너지 3)는 **소비자 화면에선 숨김 유지하되 CI 도달 테스트의 `INTENTIONALLY_UNRENDERED`에 사유 주석과 함께 등재**합니다.

**분양 18필드**: 결측이 랜덤이 아니라 **단지 단위 통째**(813 있음 / 768 전무)이므로 `presaleStage == null`이면 **탭 섹션 통째 미렌더**. 개별 필드마다 "자료없음"을 뿌리지 않습니다.

---

## 5. 색 팔레트 확정

### 5-1. 편차 스트립 — **새 hex 0개**

| 역할 | hex | 토큰 | 흰 배경 대비 |
|---|---|---|---|
| 유리 | `#2563EB` | `C.blue` | 5.17:1 |
| 불리 | `#D97706` | `C.amber` | 3.19:1 |
| 중립·라벨·끝말 | `#6B7280` | `C.muted` | 4.83:1 |
| 트랙 | `#ECEEF4` | (기존 차트 트랙 리터럴) | 장식 |
| **중앙 기준선** | **`#9CA3AF`** | 신규 상수 `C.gridStrong` | **2.54:1** |

⚠️ 기준선을 `C.borderStrong(#D1D5DB, 1.47:1)`이 아니라 **`#9CA3AF`로 상향**합니다. 이 눈금은 장식이 아니라 정보 전달 요소이므로 3:1이 목표인데 2.54:1이라 미달 — 그래서 **트랙 위아래 2px씩 돌출**시켜 형태로도 구분되게 합니다(색 단독 의존 금지).

**적록(빨강↔초록)은 쓰지 않습니다.** 적록은 색각이상의 주 혼동 축입니다.

### 5-2. 카테고리 6색 — hex 변경 0, **표시 순서만 단일 출처화**

```ts
// src/constants/catOrder.ts (신설 — 화면 순서 단일 출처)
export const CAT_DISPLAY_ORDER = ["price","location","benefit","product","risk","future"] as const;
```

| 순서 | 카테고리 | hex | vs `#FFFFFF` |
|---|---|---|---|
| 1 | 가격 | `#16A34A` | 3.20:1 |
| 2 | 입지 | `#2563EB` | 5.17:1 |
| 3 | **혜택** | `#D97706` | 3.19:1 |
| 4 | **상품** | `#7C3AED` | 6.29:1 |
| 5 | 안전 | `#DC2626` | 4.26:1 |
| 6 | 미래 | `#0891B2` | 3.68:1 |

파랑(입지)과 보라(상품) 사이에 앰버(혜택)를 끼워 **CVD 최악 인접 쌍을 해소**합니다.

> **검증 필요**: 조사 단계에서 인용된 "최악 인접 ΔE 0.4 → 19.5" 수치는 **내가 재실행하지 않았습니다.** PR-0에서 `<dataviz skill>/scripts/validate_palette.js` 를 1회 실행해 exit 0을 확인한 뒤 커밋합니다. 통과 전제는 **인접 쌍만 맞닿는 형태**(고정 순서 스트립·막대)이며, 레이더·산점도·지도처럼 모든 쌍이 이웃이 될 수 있는 형태에서는 **6색 전부 사용 금지**(3색까지만).

### 5-3. 다크모드 — 이번 범위 밖 (정직한 선언)

전 소스에서 `prefers-color-scheme`은 **`filters/FilterDropdown.tsx:25` 단 1곳**이고, `C` 토큰은 전부 고정 hex이며 `theme.test.js:15`가 `/^#[0-9A-Fa-f]{6}$/`로 잠가둬 CSS 변수 전환 시 그 테스트가 깨집니다.

→ **모든 신규 컴포넌트는 hex 리터럴 0개**(전부 `C`/`R`/`F` import)로 작성해, 나중에 theme만 변수화하면 자동으로 따라오게 합니다. 다크 값은 아래에 미리 계산해 두되 **이번엔 소비하지 않습니다.**

```
유리 #60A5FA(6.99:1) / 불리 #F59E0B(8.27:1) / 중립 #9CA3AF(6.99:1)
트랙 #242832 / 기준선 #6B7280
발산 5단계(다크): #FBBF24 #F59E0B #9CA3AF #60A5FA #93C5FD   ← 라이트의 자동 반전이 아니라 재선택
```

### 5-4. 타이포 — **값은 14px 이상**

| 용도 | 토큰 | px |
|---|---|---|
| **값 슬롯 / 등급 문자** | `F.base` | **14** ← 심사 지적 반영(주 구매층 40~60대) |
| 라벨 · 끝말 · 헤더 | `F.sm` | 12 |
| 팝업 SVG 축 라벨 | `F.xs` | 11 |
| `F.micro`(10px) | **신규 요소에서 사용 금지** | — |

---

## 6. 기술 스택 결정 — **라이브러리 0개 추가**

### 6-1. 카드는 SVG조차 쓰지 않습니다

편차 스트립은 **div 5개**입니다. 전례가 레포 안에 이미 있습니다 — `PriceTable.tsx:104-135`가 `position:absolute` div 3겹으로 범위 막대 + 마커선을 만들고 있습니다.

### 6-2. 팝업 SVG도 라이브러리 불필요

| 시각화 | 필요 요소 | d3 필요? |
|---|---|---|
| `AreaPriceScatter` | `circle` `line` `text` + `niceTicks` | ✗ |
| `DistanceDots` | `circle` `line` `text` `pattern`(해칭) | ✗ |
| `PresaleTimeline` | `rect` `line` `text` | ✗ |
| `LoanStack` | `rect` `line` | ✗ |

**곡선 보간·도넛 호·레이더 폐곡선이 하나도 없습니다** — 그게 `d3-shape`의 존재 이유인데 이 설계는 레이더를 의도적으로 배제했으므로 쓸 자리가 없습니다. `niceTicks(min,max)`는 `LineChart.tsx:21`에 **이미 export**되어 있고 0나눗셈 방어·"모든 값 동일" 예외가 완비돼 있습니다.

### 6-3. 번들 영향

| | gzip |
|---|---|
| 현재 초기 필수 (index + vendor + runtime) | **약 123~128 KB** |
| recharts | 147.5 KB (**초기 예산의 116%**) → 불가 |
| @visx/shape+scale | 28.2 KB → 초과 |
| d3-shape | 5.7 KB → **쓸 자리 없음** |
| **이 설계 (카드)** | **+약 1.5 KB** (div + 훅 + 상수) |
| **이 설계 (팝업)** | **+약 10 KB** — `DetailModal` lazy 청크(현 27.1 KB gz)로 격리 |

> 참고: 실측 초기 전송 약 3,024 KB 중 **데이터 JSON이 2,382 KB(79%)**, JS는 125 KB(4%)입니다. 번들이 이 설계의 제약이 되지 않습니다.

**코드에 남길 주석 (oss-first 룰 요구)**:
```ts
// 차트 라이브러리 미사용 판단: recharts 147.5KB(gzip)=초기 예산의 116%, 최소 대안 d3-shape 5.7KB도
// 곡선/호/레이더용인데 본 설계는 div·rect·line·circle 만 씀(레이더 의도적 배제).
// 기존 자체 SVG 자산 9개 + niceTicks(LineChart.tsx:21 export) 재사용.
// 시세 탭 포인트가 수천을 넘으면 그때 uPlot(21.9KB gz, dep 0, MIT)을 dynamic import 로 격리.
```

---

## 7. 신규 컴포넌트 목록

| # | 파일 | 역할 | 줄 | 재사용 기존 자산 |
|---|---|---|---|---|
| 1 | `src/constants/catOrder.ts` | `CAT_DISPLAY_ORDER` 단일 출처 | 15 | — |
| 2 | `src/constants/sentinels.ts` | `SENTINEL`·`isSentinel` | 20 | `data-audit.mjs:40` 값 동기 |
| 3 | `src/constants/deviationFields.ts` | 카드3/종합8 목록 + `better` 폴라리티 + 라벨·끝말·문장 템플릿 | 90 | `FIELD_META`(label/unit/fmt) |
| 4 | `src/scoring/regionalStats.ts` | `FieldStat{sorted,n,median,mad,distinct}` · `percentileOf` · **기존 `computeRegionalMedians` 감싸 하위호환 유지** | 130 | `computeRegionalMedians` |
| 5 | `src/hooks/useRegionalStats.ts` | **상시** `useMemo([apartments])` — `needsFallback` 게이트 우회 | 40 | — |
| 6 | `src/lib/deviation.ts` | 3게이트 + `fav` + **문장 조각 생성** + aria 문장 생성 | 110 | `FIELD_META.fmt` |
| 7 | `src/components/DeviationRow.tsx` | 스트립 한 줄 (div 5노드) | 95 | `R`·`C`·`F` |
| 8 | `src/components/DeviationStrip.tsx` | 블록 (헤더 + N줄 + `HelpHint`) | 70 | `HelpHint` |
| 9 | `src/components/charts/ChartFrame.tsx` | 축·격자·빈상태·에러+재시도·`role=img`+`<title>` 공통 껍데기 | 110 | `niceTicks`·`SkeletonBox`·LineChart 관습 |
| 10 | `src/components/charts/AreaPriceScatter.tsx` | 면적별 가격 산점 + 툴팁 | 180 | `niceTicks`·`HIT_AREA_RADIUS 16`·`TOOLTIP_DISMISS_MS 3000` |
| 11 | `src/components/charts/DistanceDots.tsx` | 거리 도트 (캡 3분리 + sentinel 해칭) | 150 | `ChartFrame` |
| 12 | `src/components/charts/PresaleTimeline.tsx` | 4스텝 + 범위막대 + 로그축 | 130 | `PriceTable` 불릿 패턴 |
| 13 | `src/components/charts/LoanStack.tsx` | 자금 2조각 + DSR선 | 75 | `calcLTV` |
| 14 | `src/components/detail/FieldTable.tsx` | `FIELD_META` 소비자 아코디언 (검색·완성도) — `AdminDataAudit`에서 추출 | 170 | `FIELD_META`·`dataValueColor`·`fieldsOf` |
| 15 | `src/lib/fieldCoverage.test.ts` | **154 도달 CI 가드** | 85 | `fieldsOf`(`dataSections.ts:13`) |
| | 테스트 14파일 | | ~700 | |
| | **합계** | | **약 2,170줄** | |

---

## 8. 구현 PR 분할 계획

**전 PR 공통 원칙**: 표현계층만. `src/scoring/score*.ts` 산식·필터·블라인드 정책 로직은 한 줄도 안 건드립니다. 백분위는 **표시 전용 파생값**이며 정렬·필터·추천에 절대 쓰지 않습니다.

### PR-0 — `CAT_DISPLAY_ORDER` 단일 출처 (선행 필수, §0-1)
- `catOrder.ts` 신설 / `profiles.ts`의 기존 `CAT_ORDER` → **`CAT_TIEBREAK_ORDER` 개명**(동명 충돌 방지)
- `DetailModal.tsx:233`·`:483`, `AptCard.tsx:165`의 `Object.entries(res.cats)` → `CAT_DISPLAY_ORDER.map()` 전환
- `AptCard` topCats → `getTopCats(profileWeights, 3)` 로 교체(tie-break 확보)
- **hex 변경 0**
- 위험 🟡 — 미니카드 순서를 인덱스/스냅샷으로 잡는 테스트가 깨질 수 있음
- 검증: ① `theme.test.js` 무변경 ② **`catsCache` 순서를 일부러 뒤집은 픽스처에서도 화면 순서가 불변**한지 테스트 1건(이게 이 PR의 존재 이유) ③ `validate_palette.js` exit 0 ④ 라이브 DOM에서 6칸 순서 실측

### PR-1 — 데이터 층 (UI 변경 0)
- `sentinels.ts`·`regionalStats.ts`·`useRegionalStats`·`deviation.ts`·`deviationFields.ts`
- `computeRegionalMedians` 시그니처·반환 **불변 유지**(폴백 소비처 무영향)
- 위험 🟢 **최저** — 렌더 변경 0
- 검증: vitest ~45건 (백분위 0/50/100 경계·동률·n=1·`mad=0`·sentinel·중위값 0 나눗셈·문장 조각 분기) + **`sentinels.ts` 값이 `data-audit.mjs:40`과 일치하는지 잠그는 테스트** + `deviationFields` 등재 필드가 전부 `better`를 갖는지 검사

### PR-2 — ⚠️ `visual-card.spec.ts` 신설 (카드 손대기 **전** 필수)
- `page.route()`로 `/api/supabase/apartments`를 **고정 픽스처 3단지로 스텁** → mask 불필요 → 요소 단위 스냅샷
- 위험 🟢 없음 (테스트 추가만)
- **이 PR 없이 PR-3을 하면 카드 변경의 시각 회귀가 0건 잡힙니다** (`visual.spec.ts:38·57`이 카드 30장을 통째로 가림)

### PR-3 — 카드 편차 스트립 + 신호등 압축 (본체)
- `DeviationRow`·`DeviationStrip` + `AptCard` 배선 + 카테고리 1줄 압축 + 역세권 칩 1개 제거
- **comparator를 상수 배열에서 파생**(심사 공통 맹점 ②):
  ```ts
  for (const k of CAT_DISPLAY_ORDER)
    if (prev.res.cats[k]?.total !== next.res.cats[k]?.total) return false;
  for (const f of CARD_DEVIATION_FIELDS)          // deviationFields.ts 단일 출처
    if (prev.apt[f] !== next.apt[f]) return false;
  if (prev.apt.region !== next.apt.region) return false;
  if (prev.regionStats !== next.regionStats) return false;   // useMemo 안정 참조
  ```
- **피처 플래그 뒤에 배치** (`isFeatureDeviationStrip`) — 배포 후 재배포 없이 롤백 가능
- 위험 🔴 **최고**
- 검증: ① **comparator 재현 테스트** — `price` 비교를 일부러 빼면 정확히 red가 되는지 1회 확인(세션 479 패턴) ② "총점 같고 카테고리 구성만 다른" 픽스처로 리렌더 발생 확인 ③ 3게이트 렌더 3종 ④ 결측 시 높이 86px 고정 ⑤ 비로그인 스냅샷 ⑥ DOM 노드 수(현재 카드당 50.2 → 목표 55±3) ⑦ 3뷰포트 실측(375/768/1024, 트랙 T = 147/164/108) ⑧ **200% 확대 뷰** ⑨ `visual-card.spec.ts` 스냅샷 ⑩ E2E 30건 무회귀

### PR-4 — 팝업 종합 탭 스트립 8줄 + **`GuideSections` 갱신**
- 같은 컴포넌트, 트랙만 확대
- **`GuideSections.tsx:186`의 "레이더 차트" 거짓 안내 정정** + "단지 카드 읽는 법"에 스트립 설명 추가
- 위험 🟡 — 안내문 잔재 grep은 **영어 식별자 + 한글 노출 문구 이중**으로(세션 484 #268 재발 방지)
- 검증: 한글 grep `레이더|바 차트|히스토리` 0건

### PR-5 — 시세·입지 시각화 + **미노출 4필드 노출**
- `ChartFrame`·`AreaPriceScatter`·`DistanceDots` + `FIELD_META`에 `bankDist`·`cafeDist`·`cultureDist`·`pharmacyDist` 4엔트리 신설 + `FIELD_SECTIONS` 입지 그룹에 추가
- 위험 🟡 — **sentinel 가드가 이 PR의 전부**
- 검증: ① `ktxDist`(유효 0.0%)·`icDist`(3.9%) 단지에서 `미수집` 표시, 거리축에 안 올라옴 ② `emergencyDist` max **69,072m** 단지에서 축 파괴 없음 ③ `priceByArea` 5포인트 미만(3.5%) 미렌더 ④ `nearbyChildcare`/`nearbyFacilities` 0% → 섹션 통째 미렌더

### PR-6 — `FieldTable` 소비자 개방 + 154 CI 가드
- **선행 필수**: §3-4 이중 노출 전수 대조(`grep -n "info:\|detail:" src/scoring/score*.ts` 93건)
- `AdminDataAudit`의 `FieldSection` → 공용 `FieldTable` 추출, 6탭 아코디언 배선, 팝업 헤더 필드 검색
- `hidden:true` 중 `greenBldg`·`presaleStageCode` 해제
- **`fieldCoverage.test.ts`** — 검사 대상을 `FIELD_META`가 **아니라 `apartments-list.json` 실제 키**에서 뽑음(B안 결함 회피):
  ```ts
  const all = Object.keys(listJson.data[0]);   // 실측 154
  expect(all.filter(k => !reached.has(k))).toEqual([]);
  ```
- 위험 🟡 — 관리자 화면 회귀. 관리자 표 필드 수 기대값은 **137**(145 − hidden 8)이며, `AdminDataAudit.tsx:123`의 "141필드" 주석은 **stale이라 함께 정정**
- 검증: 미도달 키 0 / 관리자 표 무회귀 / 검색이 전 탭 가로지름

### PR-7 — 분양·금융 시각화
- `PresaleTimeline`·`LoanStack`
- 위험 🟢 낮음 (`presaleStage == null` 게이트로 768단지는 미렌더)

### 전 PR 공통 게이트
`typecheck`×3 → `lint` → **`prettier` 로컬 선실행** → `format:check` → `audit`×5 → `test` → `build`
→ 커밋·머지·배포 **각각** 직전에 `git fetch origin` + 다른 세션 활동 보고 + 승인
⚠️ 착수 시점에 `M src/components/sections/KakaoMapView.tsx`(다른 세션)가 있었으므로 첫 쓰기 전 `git status` 재확인.

---

## 9. 일반인 이해 장치 (실제 문구)

### 9-1. 스트립 헤더 + 도움말

```
서울 아파트 평균과 비교   [?]
```
`HelpHint` 본문:
> **막대가 오른쪽으로 길수록 이 아파트가 유리해요.**
> 가운데 세로선은 서울 아파트들의 한가운데 값입니다. 서울 아파트 297채를 값 순서대로 줄 세웠을 때 정확히 가운데 있는 집이 기준이에요. 평균과 달리, 아주 비싼 집 몇 채 때문에 기준이 흔들리지 않습니다.

### 9-2. 값 슬롯 문구 (전 케이스)

| 상황 | 문구 |
|---|---|
| 유리 | `12% 싸요` `41% 가까워요` `3%p 적어요` |
| 불리 | `8% 비싸요` `2배 멀어요` `3%p 많아요` |
| 중립(±3%) | `평균 수준` |
| G1 폴백 | `12% 싸요` + 회색 `전국` 배지 |
| G1 미달 | `비교할 단지가 적어요` |
| G2 | `이 지역은 다 같아요` |
| G3 | `미수집` |

`%p` 사용 시 그 행 라벨에 도움말 점 하나: *"%p는 퍼센트끼리의 차이예요. 15%에서 18%로 오르면 3%p 오른 겁니다."*

### 9-3. 스크린리더 (그리고 이 문장이 미래의 카드 요약 후보)

```html
<div role="group" aria-label="서울 아파트 평균과 비교">
  <div role="img" aria-label="분양가 3억 2천만원. 서울 아파트 한가운데 값보다 12% 쌉니다.
                              서울 297개 단지 중 싼 쪽에서 22번째 정도입니다.">
```
⚠️ **`aria-label`에 "점수" 글자 금지** — `DetailModal` 테스트의 `getAllByRole("img",{name:/점수/})`와 충돌합니다(`CompletenessDonut.tsx:20` 주석에 박제된 함정). 신규 aria 문구는 기존 테스트 쿼리와 반드시 대조.

### 9-4. 비로그인 안내

```
🔒 우리가 매긴 점수는 로그인하면 보여요.
   아래 비교는 공개된 자료라 그냥 보실 수 있어요.
```

### 9-5. 아코디언 헤더

```
▸ 이 탭의 자료 전부 보기 (36개)
```
빈 값 옆: `아직 모으지 못한 자료예요`

---

## 10. 남은 위험과 미해결 항목 (정직하게)

### 10-1. 🔴 사용자 이해 검증 절차가 아직 없다 — 반드시 넣어야 함

이 설계는 typecheck×3·vitest·DOM 노드·번들 gzip·E2E 30건까지 촘촘히 계획했지만, **"부동산 모르는 사람이 이 막대를 읽는가"를 확인하는 절차는 여전히 0건**입니다. 목업 대상이 사장님(=내부 전문가)이면 이 렌즈는 검증되지 않습니다.

→ **처방(비용 30분)**: 목업 단계에서 비전문가 3명에게 라벨을 가린 채 보여주고 ①"어느 아파트가 더 싼가요?" ②"이 회색 빗금은 무슨 뜻일까요?" ③"가운데 세로선은 뭘까요?" 를 묻습니다. 3명 중 2명이 못 맞히면 그 요소는 재설계.

### 10-2. 🟡 대조군이 시도(市道) 하나뿐 — 강남과 평택이 같은 기준

경기 543단지가 한 덩어리입니다. 화성 단지가 "경기보다 30% 싸다"고 나와도 그 기준에 판교·과천이 섞여 있습니다.

**구 단위로 못 내리는 이유**: 실측 213그룹·중앙 5단지, 10단지 이상 확보 그룹 53개뿐. 표본 5개 중위값은 한 단지만 바뀌어도 흔들립니다.

**권역(서울 강남권/강북권, 경기 남부/북부) 정의는 데이터가 아니라 부동산 도메인 판단**이라 자동 산출이 불가능합니다. **미해결 — 사장님 결정이 필요한 별도 과제**입니다.

### 10-3. 🟡 프로필 5개 중 3개가 사실상 같다 — 그래서 슬로프 그래프를 **의도적으로 뺐다**

`PROFILES` 가중치 실측:

| 프로필 | location | product | price | risk | benefit | future |
|---|---|---|---|---|---|---|
| 실거주 | 40 | 20 | 20 | 10 | 5 | 5 |
| **자녀교육** | **45** | **20** | **15** | **10** | **5** | **5** |
| 은퇴 | 35 | 25 | 20 | 15 | 5 | 0 |
| 신혼부부 | 30 | 15 | 30 | 10 | 10 | 5 |
| 투자 | 15 | 10 | 30 | 25 | 10 | 10 |

실거주↔자녀교육은 **가중치가 5점만** 다르고, 상위 50개 중 **48개가 겹칩니다**(A안·심사 3렌즈가 독립적으로 같은 값을 얻었고, 저도 가중치 표로 재확인했습니다).

A·C가 제안한 프로필 순위 슬로프 그래프는 **이 사실을 화면에 그리는 도구**입니다. 정직하지만, 손님이 "실거주 → 자녀교육"을 눌렀는데 목록이 그대로면 결론은 "이 토글은 가짜다"입니다. **이건 시각화 문제가 아니라 가중치 설계 문제이고, 표현계층 무변경 원칙 때문에 이 설계로는 고칠 수 없습니다.**

→ **결정: 슬로프 그래프는 채택하지 않습니다.** 가중치 재설계 여부를 사장님이 결정한 **뒤**에 다시 올립니다. 지금 그리면 우리 돈을 들여 제품 약점을 확대해 보여주는 셈입니다.

### 10-4. 🟡 혜택 카테고리는 데이터가 통째로 없다

`benefit` 원천 9필드가 **전부 0.0%**, `catsCache.benefit` 0점이 **1,267단지(80.1%)**. 6칸 시각화를 만들면 5채 중 4채가 한 칸 비어 "혜택이 나쁘다"는 거짓말이 됩니다.
→ **편차 스트립·신호등은 5카테고리 기준**, 혜택은 팝업 금융 탭에 "혜택 정보 없음" 1줄. 기존 `CategoryMiniCard` 6개는 유지(이미 `noData` 처리가 있음). **데이터가 채워지면 되돌립니다.**

### 10-5. 🟡 다크모드는 나중에 6배로 돌아온다

§5-3대로 라이트 전제입니다. 순차/발산 램프는 다크에서 **자동 반전이 아니라 재선택**이라 토큰 교체만으로 해결되지 않고, `AreaPriceScatter`·`DistanceDots` 최소 2개는 다크 도입 시 다시 손봐야 합니다.
총비용만 보면 `theme` CSS 변수화 + `theme.test.js:15` 갱신을 PR -1로 먼저 하는 게 쌉니다. **그렇게 안 하는 이유는 단 하나 — 테스트를 건드리는 선행 PR이 전체 착수를 지연시키기 때문입니다. 옳아서가 아니라 속도를 위해 부채를 지는 것입니다.**

### 10-6. 🟢 카드가 72px 길어진다

30장 스크롤 +약 21%. 칩 1개 제거로만 상쇄하므로 B안(+62px, 칩 5개 제거)보다 정보 손실은 적고 높이는 큽니다.
→ 목업에서 **3안**(스트립 3줄 / 2줄 / 기본 접힘+펼치기 토글)을 나란히 보여드리고 고르시게 합니다.

### 10-7. ⚪ 재현 불가로 판정한 것

- **A안 서두의 `useAppNavigation.ts` 보안 경고**(비로그인 지도 차단 무력화) — 실측 결과 `L84 = if (!isLoggedIn && k === "map")` **정상 가드**, `if (false` grep 0건. 다른 세션이 원복했을 수는 있으나 **현재 시점 기준 근거 없음**.
- **CVD ΔE 0.4 → 19.5 수치** — 내가 재실행하지 않았습니다. PR-0의 게이트로 걸었습니다(§5-2).
- **저사양 모바일 성능** — 인용된 "프로필 전환 27ms / longtask 0"은 데스크톱 기준입니다. 카드는 div 기반이라 SVG 안보다 안전하지만, **저가 안드로이드 실측은 아직 0건**입니다. PR-3 검증에 1회 추가 권고.

---

## 11. 목업 계획 (구현 전 — 사장님 확인용)

`Artifact` 1장에 **실제 `C`/`F`/`R` 토큰 + 진짜 단지 값**으로:

1. **3뷰포트 나란히** (375 / 768 / 1024) — 트랙 폭 147/164/108 차이를 눈으로
2. **카드 높이 3안** (스트립 3줄 / 2줄 / 접기 토글)
3. **게이트 4종 실물** (정상 / `전국` 배지 / `이 지역은 다 같아요` / `미수집` 해칭)
4. ⚠️ **최악 결손 단지 1건** — 분양 정보 전무(768단지 = 48.6%) + 혜택 0 + `ktxDist`/`icDist` sentinel. **6탭 중 2탭이 사실상 비는 화면**을 반드시 함께 봐야 합니다. 잘 채워진 단지만 보고 결정하면 이 화면을 못 봅니다.
5. **비로그인 상태** — 점수는 가려지고 스트립만 보이는 화면
6. **색맹 시뮬레이션 토글** (정상 / 2형 / 1형)
7. **200% 확대 뷰** 1장

세션 484 선례대로 **목업 단계에서 "안 하는 게 낫겠다"는 결론이 나와도 그게 성공**입니다(그때 낭비가 0이었습니다).

---

**쉬운 말로 정리하면:**

- **핵심 아이디어 하나**: "3억 2천만원"이라고만 쓰면 비싼지 싼지 모릅니다. 대신 작은 막대로 **"서울 평균보다 12% 싸요"**를 보여줍니다. 외울 규칙은 **딱 하나** — 막대가 **오른쪽으로 길면 좋은 것**. 막대 양 끝에 `싸다`/`비싸다`라고 한글로 써놔서 설명서가 필요 없고, 오른쪽 숫자도 그냥 숫자가 아니라 **"12% 싸요"라는 짧은 말**입니다.

- **카드에는 3줄만** 넣습니다 — 분양가·미분양·역세권. "싼가 / 안 팔리나 / 교통 되나"에 하나씩 답합니다. 카드마다 순서가 늘 같아서 보다 보면 저절로 외워집니다.

- **좋은 소식 셋**: ① 필요한 숫자가 이미 목록 데이터에 다 들어 있어서 **서버·수집기를 전혀 안 건드립니다** ② 이 막대는 그림이 아니라 **네모 상자 몇 개**라 카드 30장에 넣어도 지금과 거의 똑같이 가볍습니다 ③ **차트 프로그램은 하나도 안 씁니다**(제일 유명한 게 압축 후 147KB인데 지금 첫 화면 전체가 123KB입니다).

- **작업 시작 전에 꼭 고쳐야 할 진짜 문제를 하나 찾았습니다.** 6개 항목이 화면에 나오는 순서가 **약속된 게 아니라 데이터 파일에 저장된 우연한 순서**를 그대로 쓰고 있습니다(지금은 위험→가격→미래→혜택→상품→입지). 그래서 ① 수집기가 조금만 바뀌어도 **화면 순서가 소리 없이 뒤집히고 아무 경고도 안 뜹니다** ② 자료가 빠진 단지는 아예 다른 순서로 그려집니다 ③ 하필 마지막 두 자리가 파랑·보라라서 **색약이신 분(남성 20명 중 1명)께는 같은 색**으로 보입니다. 첫 번째 작업으로 이 순서를 **한 곳에 못 박습니다.** 색은 하나도 안 바꾸고 순서만 바꿉니다.

- **"자료가 없는 항목"은 이렇게 처리합니다**: ① 그 지역에 단지가 8개도 안 되면 → 전국 기준으로 바꾸고 "전국"이라고 표시 ② 그 지역 단지가 **전부 같은 값**이면(경기도 543개가 다 똑같은 인구증가율 같은 것) → "이 지역은 다 같아요" ③ 이 단지만 값이 없으면 → 회색 빗금으로 "미수집". 특히 ②는 **자동**이라 나중에 항목이 늘어도 사람이 목록을 관리할 필요가 없습니다.

- **팝업의 154개 정보는 사실 이미 다 만들어져 있었습니다.** 145개 항목의 이름·단위·표시법이 정리된 파일이 **관리자만 볼 수 있게 잠겨 있었습니다.** 자물쇠만 풀면 됩니다. 덤으로 **은행·카페·문화시설·약국까지의 거리 4개가 각각 96%·95%·97%·76% 잘 모여 있는데 화면에 한 번도 안 나왔다**는 것도 확인했습니다. 이번에 처음 보입니다.

- **일부러 안 만들기로 한 것 두 가지**: ① **거미줄 그림(레이더)** — 사람 눈이 각도·넓이를 제일 못 읽고, 6개를 원형으로 놓으면 색약 안전 기준을 어떤 색으로도 못 맞춥니다. ② **프로필 5개 순위 비교 그래프** — 확인해보니 **실거주와 자녀교육은 상위 50개 중 48개가 똑같습니다**(점수 배합이 5점밖에 안 다름). 그래프를 만들면 손님이 "이 기능 가짜네"라고 먼저 알아챕니다. 이건 그림 문제가 아니라 점수 배합 문제라, **배합을 손볼지 사장님이 정하신 뒤에** 다시 올리겠습니다.

- **제일 위험한 곳 하나**: 카드는 "값이 안 바뀌면 다시 안 그린다"는 최적화가 걸려 있는데, 새 막대가 읽는 값을 그 목록에 안 넣으면 **값이 바뀌어도 화면이 옛것 그대로** 남습니다. 이 프로젝트가 이미 세 번(세션 430·461·479) 당한 사고입니다. 그래서 이번엔 **목록을 손으로 적는 대신 상수 하나를 돌게** 만들어서, 나중에 항목이 늘어도 자동으로 따라오게 했습니다.

- **그리고 지금 손님용 안내문이 거짓말을 하고 있습니다.** "상세창에 레이더 차트가 있다"고 써 있는데 그건 예전에 뺐습니다. 카드 고치는 김에 같이 정정합니다.

- **다음 단계**: 코드 짜기 전에 **웹 목업 한 장**을 만들어 드리겠습니다. 카드 높이 3안을 나란히 놓고, **꼭 "자료가 제일 많이 빠진 단지"도 하나 넣겠습니다** — 아파트 절반(768개)은 분양 정보가 통째로 없어서 탭 두 개가 텅 빕니다. 잘 채워진 단지만 보고 정하면 그 화면을 못 보십니다. 그리고 목업 나오면 **부동산 잘 모르는 분 세 분께 30분만 보여드리고 "이게 무슨 뜻 같으세요?"를 물어보는 절차**를 넣었으면 합니다 — 지금 계획서에 프로그램 검사는 잔뜩 있는데 정작 그게 없습니다.