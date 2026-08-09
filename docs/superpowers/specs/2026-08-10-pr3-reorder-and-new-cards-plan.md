# PR-3 "순서 재배치 + 신설 카드" 구현 플랜 **v2** (세션 508)

> v1 을 6렌즈 적대검증(+완결성 비평)에 걸어 **지적 40건(blocker 3 · high 15)**을 받고 전면 개정한 판.
> v1 의 오류는 아래 §"v1 에서 틀렸던 것"에 그대로 남긴다 — 지운 채 고치면 같은 실수를 또 한다.
>
> 근거: 결정 원장 PR-3 행 · 세션508 전수조사 · 적대검증 결과(6렌즈 전원 needs-fix).
> 승인: 사장님 2026-08-10 — 시공사 카드에서 hugGuarantee 제외(Q6 유지) · 진행 · 기본값 2건.
> 원칙: **새 시각 언어 금지** — 기존 부품 조합. 신규는 "계단 칸"과 "판정 한 줄" 둘뿐.

## v1 에서 틀렸던 것 (박제 — 되풀이 금지)

| # | v1 의 주장 | 실제 | 교훈 |
|---|---|---|---|
| 1 | 센티널(subwayDist 9999·icDist/ktxDist 99)을 **"미수집"**으로 표기 | fieldMeta 가 이미 정확히 구분 중 — 9999는 **"없음"**, 99는 **"반경 밖"**(측정했고 90km 넘게 멀다) | 세션500 원칙("4km를 원거리라 부를 수 없다")을 지키려다 **반대 방향 거짓**을 새로 만들 뻔. 기존 문구가 이미 정답이면 새로 짓지 마라 |
| 2 | "종합 판정 한 줄은 **없다**" | `ProfileWeightBar` 가 이미 "강점 X · 보완 Y"를 같은 탭에 그림 | "없다" 단정 전 같은 탭 컴포넌트 본문까지 읽어라 |
| 3 | 경쟁률 3필드가 막대에 **이미 있다** | `PresaleTimeline` 은 `competitionRate` **하나만** 그림. 공급세대수·신청수는 어디에도 없음 | "이미 있다"는 props 목록으로 확인 |
| 4 | 아코디언 0화 위험 = **종합·입지·분양** | 실제로는 **종합·시세·분양**이 0이 되고 **입지는 4로 안전** | 위험 지도는 감으로 그리지 말고 셈해라 |
| 5 | 회귀 가드 = `tabExtraFields.test.ts` 뿐 | `DetailModal.test.jsx`·`dataSections.test.ts`·`SourceComparison.test.jsx`·`DataSectionBlock.test.jsx`·`ExtraFieldsAccordion.test.tsx` **5파일**이 직접 깨짐 | 바꾸는 상수를 **import 하는 테스트**를 grep 해라 |
| 6 | `:92` 가 grid→카드 이동을 잡는다 | `:92` 는 아코디언→표면 **단방향**. 표면끼리는 `:271-274`(세션507 신설). **둘 다 "grid 에서 빼고 아무 데도 등재 안 함"은 못 잡는다** | 가드가 무엇을 **안** 잡는지까지 읽어라 |
| 7 | `DetailModal.tsx:718` **만** raw apt | 452(DeviationStrip)·808(AdminUnitSupply)도 raw apt | "만"이라는 단정은 전수 grep 후에만 |
| 8 | `getHighlights` 재사용 | CatPanel 안 **모듈 비공개**(export 없음) | 재사용 선언 전 export 여부 확인 |

## 착수 전 사장님 확인 1건 (구현 중 되돌리면 비쌈)

**아코디언("아직 안 보여드린 자료" 서랍)이 4탭 중 3탭에서 사라진다.** 이는 "모든 자료를 카드로
정직하게 꺼냈다"는 뜻이라 **목표 달성**으로 읽히지만, 눈에 보이는 변화라 확인이 필요하다.

**실측(2026-08-10, `TAB_EXTRA_SECTIONS`·`extraCount` 직접 호출)** — 적대검증의 계산과 일치:

| 탭 | 현재 n | 서랍 안의 필드 | PR-3 후 | 흡수처 |
|---|---|---|---|---|
| sec-overview | **6** | floors·maxFloor·layout·floorAreaRatio·corridorType·buildingCoverageRatio | **0** | C4 건물 정보 카드 |
| sec-price | **1** | naverSchoolWalkMin | **0** | B2 학군 카드 승격 |
| sec-presale | **4** | unsoldEventCount·lastUnsoldEventAt·builderCreditGrade·builderDebtRatio | **0** | C1 재공고 + C2 시공사 |
| sec-location | **4** | transitDev·devDist·cityDev·industryDev(미래가치) | **4 유지** | PR-3 가 안 건드림 |
| sec-finance | **0** | — | 0 | 이미 0 |

확정 시 `ExtraFieldsAccordion.test.tsx:40` 의 4탭 하드코딩을 "입지만 버튼 있음 + 나머지 3탭은 n=0→null" 로 재작성한다.

---

## PR 분할 (v1 의 3커밋 → **3 PR**)

blast radius 가 커서 한 PR 로 묶지 않는다. 각 PR 은 독립 머지·독립 롤백 가능.

| PR | 범위 | 이유 |
|---|---|---|
| **3a** | 종합 탭 순서 + 판정 한 줄 + 핵심지표 해체 + 금융 색 통일 | 레지스트리 무관(getZone 계산값) — 가장 안전 |
| **3b** | 입지(교통 카드·학군 승격·한 줄 요약) + 시세(층별가 계단) | 레지스트리 이동 시작 |
| **3c** | 분양(재공고·시공사·청약 실값) + 건물 정보 카드 + 점수 "세부 N개" | 아코디언 0화가 여기서 확정 |

---

## PR-3a — 종합 탭 재배치 + 금융 색 통일

### A1. 종합 판정 한 줄 (신설) — **ProfileWeightBar 요약 줄을 대체한다**
- 적대검증 지적: 신설하면 `ProfileWeightBar.tsx:73-77` 의 "강점 X · 보완 Y"와 **같은 탭에서 같은 말 두 번**.
- **결정**: 새 `aptVerdict` 가 그 자리를 **대체**하고, `ProfileWeightBar` 는 **막대만** 남긴다(요약 줄 삭제).
  - 이유: ProfileWeightBar 는 `profile && !blind` 일 때만 뜬다 → 비로그인·프로필 미선택 손님은 결론 문장을 못 봤다.
    판정 한 줄은 항상 필요하므로 이쪽이 상위 개념이다.
- 위치: 종합 탭 **맨 위**(ScoreBadge 보다 먼저) — 세션488 설계안 slot1.
- 문구: `${gr(total).l}등급 — ${SHORT_LABEL[최고]} 강점 · ${SHORT_LABEL[최저]} 보완`
  - **SHORT_LABEL 필수**(`theme/index.ts:79-86`) — CategoryMiniCard 와 같은 어휘. 원문 라벨 쓰면 한 화면 두 어휘.
  - benefit `noData` 제외(ProfileWeightBar 로직 그대로 이관).
  - **투자 조언처럼 읽히지 않게** 점수 서술에 한정. "사도 된다/좋다" 류 금지.
- **비로그인**: 점수 파생이므로 blind. `blind` 면 등급·카테고리 없이 "점수는 로그인 후 볼 수 있어요" 한 줄.
- **슬림 catsCache 가드**: `subs=[]`·cats 비어 있으면 렌더 생략(NaN·"—등급" 금지).

### A2. 핵심지표 4행 → 2행
- `DetailModal.tsx:467-485` 에서 **규제현황·LTV한도 두 행 제거**(적정가 괴리·입주만 남김).
- 미사용이 되는 `zone`·`zoneName`·`calcLTV` import 정리(`:4`, `:338-339`).
- ⚠️ **회귀**: `DetailModal.test.jsx:155-167` 이 4개 라벨을 전부 단언 + 제목이 "4행" → **2행으로 갱신**.
  `:224`·`:292` 의 `getByText("핵심 지표")` 는 유지되므로 블록 자체를 없애지 말 것.

### A3. 금융 탭 — 규제 색 2단 통일
- 현재 어긋남: 종합 `zone==="normal" ? green : red`(2단) vs `LoanAnalysis.tsx:25,67`(green/amber/red 3단).
  `ZONE_MAP` 이 전 항목을 `overheated` 하나로만 매핑(PR-1)하므로 **규제지역이 종합=빨강, 금융=주황**으로 실제로 갈린다.
- **결정**: `LoanAnalysis` 를 2단(`normal ? green : red`)으로 통일. `speculative` 분기는 **삭제하지 않고**
  주석으로 "두 목록이 갈라지면 여기서 3단 복원"만 남긴다(`regulations.ts:10` 주석과 짝).
- 규제·LTV 정보 자체는 금융 탭이 이미 배지+3칸으로 보유 → **정보 손실 0**(A2 로 지운 2행의 대체처).
- `CompareSheet.tsx:340` 은 이미 2단이라 무변경. `LoanStack.tsx:108` 은 색 없음(중립) — 무변경.

### A4. 종합 탭 DOM 순서 (세션488 설계안 slot 순서 채택)
```
판정 한 줄 → ScoreBadge → 핵심지표(2행) → CategoryMiniCard 6 → ProfileWeightBar(막대만)
→ DeviationStrip(8줄) → 혜택칩 → 재공고배지 → 단지 기본정보 격자 → 여분 서랍
```
- v1 은 편차 스트립(231px)을 미니카드 **앞**에 뒀는데, 미니카드를 올리려던 이유 자체가
  "595~812px 구간이라 첫 화면 밖"이었다 → 스트립이 앞을 막으면 목표가 무효. **스트립을 미니카드 뒤로.**
- ProfileWeightBar 는 **미니카드 바로 다음**(설계안 slot6 "왜 이 점수인지의 근거, 미니카드 바로 다음이 제자리").

### A5. `PresaleInfo` 를 `mergedApt ?? apt` 로 통일 (`:718`)
- 452(DeviationStrip)·808(AdminUnitSupply)도 raw apt 지만 **의도적 제외** — detail 버킷
  (`staticDataApi.ts:63-73`: priceByArea·rentByArea·jeonseByArea·priceByFloor·catsCache·nearbySchools·
  nearbyChildcare·nearbyFacilities·benefits)에 이들이 읽는 필드가 없어 값이 안 바뀐다. 주석으로 명시.

**PR-3a 회귀 가드**
- `src/components/DetailModal.test.jsx:155-167` — 핵심지표 4행 라벨 단언 → **2행**(제목 문구도).
- `src/components/detail/ProfileWeightBar.test.tsx` — 요약 줄을 단언하는 **3건**을 aptVerdict 쪽으로 이관:
  `:47`("강점/보완 1줄 — 최고·최저 total"), `:57`("benefit noData 는 후보 제외"), `:27` 주석의 getAllByText 전제.
  `data-testid="weight-bar-summary"` 가 사라지므로 `getByTestId` 는 반드시 옮기거나 지워야 한다.
- 신규 `aptVerdict` 단위 테스트: 등급 문구 · 최고/최저 선정 · **benefit noData 제외**(이관) ·
  blind · 빈 cats(슬림 catsCache) 5케이스.
- 뮤테이션: `=== false`/`noData` 제외 로직을 되돌려 red 실증.

---

## PR-3b — 입지 + 시세

### B1. 교통 카드 (신설) — `LOCATION_SECTIONS[0]` "교통 상세" 격자 폐기
- 필드 6: `subwayName`·`subwayLines`·`busRoutes`·`busStopNames`·`icDist`·`ktxDist`.
- ⚠️ **센티널 문구는 fieldMeta 것을 그대로 재사용**(v1 오류 정정):
  `subwayDist>=9000 → "없음"` / `icDist·ktxDist>=90 → "반경 밖"` / **`null` 일 때만 "미수집"**.
  (`fieldMeta.ts:299,307-309,315-316` — 이미 정확한 문구가 있다.)
- 기본 **접힘**(DataSectionBlock 패턴) — 입지 판단의 1차 신호는 `DistanceDots` 가 이미 그린다.
- 레지스트리: 6필드 → `FIELDS_SHOWN_IN_DETAIL_CARDS` + `tabExtraFields.test.ts` `CARD_SOURCE` 정규식 6건.
- ⚠️ **회귀**: `dataSections.test.ts:8-15` 가 `toHaveLength(4)`(OVERVIEW1+LOCATION2+PRICE1) → **3으로 갱신**.

### B2. 학군 카드 승격 — `naverSchoolWalkMin`
- `SchoolInfo` 에 "초등 도보 N분" 한 줄. **≤5분 강조 / 6분+ 회색 / null 은 줄 자체를 숨김**
  (AptCard 칩 관례 그대로 — "미수집" placeholder 금지). 채움률 42.5%.
- `SchoolInfo` 렌더 조건은 `nearbySchools` 기반이라 이 필드가 카드 존폐를 좌우하지 않음.
- ⚠️ **회귀**: `tabExtraFields.test.ts:445`("naverSchoolWalkMin 은 시세 탭 서랍") **반전** →
  이 필드가 카드로 갔으므로 시세 탭 여분이 **0**이 된다(아래 공통 표 참조).

### B3. 층별가 계단 — `priceByFloor` + `avgFloor`·`floorRange` 흡수
- `PriceByFloorBlock` 을 계단 칸으로 재표현 + 문장 "평균 거래 층수 N층 · 거래 층 X~Y층".
- ⚠️ **폴백 가드 필수**: `apt._fallbackAvgFloor === true` 면 평균 거래 층수를 **"미수집"**으로
  (SourceComparison 이 하던 은폐를 그대로 이관 — 안 하면 네이버 값을 우리 값처럼 말하게 된다).
  `floorRange` 는 대응 폴백 플래그 없음(확인 완료).
- `SourceComparison.ROWS` 4→3행(avgFloor 제거) · `PRICE_SECTIONS.grid` 에서 `floorRange` 제거 · 레지스트리 이동.
- 권장(선택): `priceByFloor` 를 `FIELD_META` 에 `hidden:true` 로 등재 — 지금은 어떤 가드도 이 필드를 안 지킨다.
- ⚠️ **회귀**: `SourceComparison.test.jsx:36-45`(4라벨)·`:47-53`("+1층")·`:76-82`(평균 거래 층수 폴백) 3건 ·
  `dataSections.test.ts:52-56`(`toContain("floorRange")` → `not.toContain`).

### B4. 입지 한 줄 요약
- `catVerdict("location", cats.location)` + 상위 서브 1개. **`getHighlights` 를 CatPanel 에서 export**
  (지금 모듈 비공개 — 안 하면 TS2305 로 막힘) 또는 `lib/` 로 이동.
- blind·슬림 catsCache 가드는 A1 과 동일.

### B5. `InfrastructureSection` 삭제 (죽은 코드)
- `pairs` 를 세팅하는 SECTION 0개 확인 완료 → `DataSectionBlock.tsx:8`(import)·`:108`(렌더 분기) 함께 제거.
- `src/components/CLAUDE.md` 상세 그룹 개수 **21→20** 갱신(개수는 드리프트 단골 — 실측 후 반영).

---

## PR-3c — 분양 + 건물 정보 + 점수

### C1. 재공고 이력 카드 — **ah- 게이트 + "추가 모집" 어휘**
- ⚠️ v1 은 게이트도 어휘도 틀렸다. 실측:
  - `unsoldEventCount>0` 777건은 **전부 `ah-` 접두**. 비-ah 단지 1,066건(52.2%)은 구조적으로 항상 0
    → 게이트 없이 만들면 절반이 영구히 "이력 없어요"만 본다.
  - `unsoldEventCount=0` 인데 `lastUnsoldEventAt` 이 있는 단지 **540건(42.6%)** → "이력 없어요"는 거짓.
  - `unsoldEventCount>0` 인데 `lastUnsoldEventAt` 이 null **224건(28.8%)** → "· 마지막 YYYY.MM" 이 빈칸/Invalid Date.
- **결정**:
  - `id.startsWith("ah-")` 인 단지에만 카드를 그린다(`AptCard.tsx:524` 게이트 재사용).
  - 라벨은 손님이 이미 보는 **"추가 모집"**(`AptCard.tsx:525`). 관리자 용어 "무순위 공고" 금지.
  - "없음" 분기는 `lastUnsoldEventAt == null` 기준. 날짜 null 이면 "· 마지막 …" 절을 **생략**.
  - 종합 탭 "재공고 N회"(siblingIds 기반)와 **다른 개념**이므로 라벨을 벌려 둔다.

### C2. 시공사 카드 — builder · builderCreditGrade · builderDebtRatio (**hugGuarantee 제외, 사장님 확정**)
- ⚠️ **표시 텍스트는 `FIELD_META.builderCreditGrade.fmt` 를 그대로 재사용**(색만 챙기면 안 된다).
  실측: 등급 null 85.3% 중 **48.7%는 "해당없음"(공기업·신탁·조합)** 이고 **36.5%는 진짜 미수집**
  (삼성물산·디엘이앤씨 등 대형사 포함) — fmt 가 이 둘을 이미 갈라 말한다.
- `builderDebtRatio` 는 `_fallbackBuilderDebt`/null 이면 "미수집"(Track A 와 일관).
- `builder` 를 종합 "단지 기본정보" 격자에서 제거(표면 중복 → `:271-274` red).
- 기본 **접힘**("④믿어도 되나" 층).

### C3. 청약 위치 막대 — **경쟁률만 중복. 나머지 2필드는 신규 병기**
- ⚠️ v1 오류: `PresaleTimeline` 은 `competitionRate` 하나만 그린다.
- **결정**: `PresaleTimeline` 에 `competitionSupply`·`competitionApplicants` prop 을 추가해
  막대 아래 실값 병기("N명 신청 / M세대 모집"). 그 뒤 **3필드 전부** 레지스트리 등재 + `CARD_SOURCE` 3건.
- `PRESALE_SECTIONS.grid` 에서 3필드 제거.
- ⚠️ **자동 가드 없음**: "grid 에서 빼고 아무 데도 등재 안 함"은 `:92`·`:271-274` 둘 다 못 잡는다
  → **렌더 레벨 단언 1건 신규**(막대에 신청수·모집세대가 실제로 나오는지).
- ⚠️ **회귀**: `DataSectionBlock.test.jsx:119-127`("437,995:1")·`:130-135`("5.2:1") 2건 이관 또는 삭제.

### C4. 건물 정보 카드 (종합 탭)
- 필드 8: `maxFloor`·`floors`·`corridorType`·`heatFuel`·`primaryDirection`·`floorAreaRatio`·`buildingCoverageRatio`·`layout`.
  실측 채움률 평균 73%(layout 만 23.6%) — null → "미수집".
- 🔴 **`layout` 은 `FIELD_META.layout.fmt` 재사용 금지**: 그 fmt 는 `${v} (${sc}점)` 로 **점수 엔진 원재료
  (LAYOUT_SCORE)를 문자열에 박아** 내보낸다. 이 카드는 비로그인도 도달하는 종합 탭이라
  점수 블라인드 정책을 우회하게 된다. → 점수 접미어 없는 별도 포맷(`v || "미수집"`). 주석으로 못박을 것.
- `heatFuel`·`primaryDirection` 을 "단지 기본정보" 격자에서 제거. `primaryDirection` 색 규칙
  (`dataSections.ts:31-35` 남향 green/북향 red) 답습.
- **DeviationStrip 3필드(parkingRatio·exclusiveRatio·avgMaintenanceCost)는 스트립에 유지** — "지역 대비" 성격.
- 기본 **접힘**.

### C5. CatPanel "세부 N개"
- 헤더에 `subs.length > 0` 일 때만 표기(슬림 catsCache 는 `subs=[]` → "세부 0개" 금지).
- 문법은 `ExtraFieldsAccordion.tsx:96` 답습.

---

## 전 PR 공통 — 회귀 가드 (v1 이 빠뜨린 5파일 포함)

| 파일 | 무엇이 깨지나 |
|---|---|
| `src/lib/tabExtraFields.test.ts` | `:92`(단방향) · **`:271-274`(표면끼리 — grid 제거 누락을 잡는 진짜 가드)** · `:202`(카드 소스 대조) · `:290/:410`(차트) · **`:425`(여분>0 — 3탭 0화로 재작성 필요)** · `:445`(학군) · `:461`(개수) |
| `src/components/detail/ExtraFieldsAccordion.test.tsx:40` | it.each 4탭 하드코딩 → 입지만 버튼, 3탭은 n=0→null 케이스로 분리 |
| `src/components/DetailModal.test.jsx:155-167` | 핵심지표 4행 라벨 단언 → 2행 |
| `src/lib/dataSections.test.ts:8-15, :52-56` | 섹션 `toHaveLength(4)`→3 · `toContain("floorRange")`→`not.toContain` |
| `src/components/detail/SourceComparison.test.jsx:36-45,47-53,76-82` | 4행/`+1층`/평균 거래 층수 폴백 |
| `src/components/detail/DataSectionBlock.test.jsx:119-135` | 경쟁률 콤마 포맷 2건 |

- **뮤테이션 최소 2종/PR**: ⓐ 레지스트리 등재 한 줄 삭제 → red ⓑ 신설 카드의 센티널·빈값·폴백 가드 제거 → red.
  치환 실발생(`n===s`) 확인 의무.
- e2e: `e2e/*.spec.ts` 에서 상세 DOM·텍스트 단언 grep 후 영향 갱신.
- 표현계층 전용 — **점수·DB·API 무변경**(Track A 와 파일이 겹치지 않게 순서 조정).
- 머지 후 운영 검증은 **DetailModal lazy 청크** grep(index 청크만 보면 옛/새 문자열 둘 다 0회로 오판).

## 남은 사각 (자동 가드가 없는 자리 — 사람이 봐야 함)

1. **"grid 에서 빼고 아무 데도 등재 안 함"** 은 어떤 테스트도 못 잡는다 → C3 렌더 단언으로 국소 방어.
2. `CARD_SOURCE` 는 일반 객체라 **같은 필드를 두 카드가 등재하면 나중 것이 앞을 덮어쓴다**.
   이번 신설 카드들의 필드 교집합은 공집합(확인 완료)이나, PR-4 에서 재발 가능 → BACKLOG.
3. `priceByFloor` 는 `FIELD_META` 밖이라 전량 도달 가드 사정권 밖(B3 선택 작업으로 해소 권장).
