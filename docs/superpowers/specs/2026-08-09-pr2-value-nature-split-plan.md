# PR-2 플랜 v2 — 값 성격 분리 + 서랍 재표현 1차 (세션 507, 2026-08-09)

> 근거: 결정 원장 [2026-08-09-three-screen-redesign-decisions.md](2026-08-09-three-screen-redesign-decisions.md) PR-2 행
> + 승인 목업 ④(시세)·⑥(분양) + 세션 506 메모리. 코드 실측 2026-08-09 (main `62c1404`, vitest 4,921 전green·tsc 0 기준선).
> **v2 = 적대검증 2렌즈(할루시네이션·맹점) 반영본.** v1 대비 정정: 대조표 폴백 오염 차단(P0-3)·테스트 파일 누락(P0-1)·
> 레지스트리 도달/껍데기 가드(P0-2)·단위 고지 오류(P0-4)·avgFloor 대조 4행 승격(P1-3)·이동 9필드 정정 등.

## 미결 2건 → 사장님 결정 완료 (2026-08-09 세션 507)

- **Q-A (P0-5)**: 시세 새 섹션 이름. 목업의 "이 단지 거래 기록"은 거짓 — 이 단지의 거래 기록이 아니라
  PIR·PSR(이 단지 분양가 ÷ 동네 잣대 — 단지별 파생값, `collect-data.mjs:806-809,1163-1171` 실측)과
  동네값(층수범위·공시가격)이다. → **결정: "이 동네 거래 시세"** — hint 에 "{gu} 실거래·공시 기준" +
  "PIR·PSR 은 이 단지 분양가를 동네 소득·시세로 잰 값" 설명 포함.
- **Q-B (D-1)**: 분양 지역통계 서랍 닫힘 문구. 승인 문구 "{region} 전체 통계예요"는 7필드 중 4개(시군구 단위)에 거짓.
  → **결정: 구·시도 병기** — "이 단지 값이 아니라 {gu}·{region} 통계예요" (gu 없으면 "이 단지 값이 아니라
  {region} 전체 통계예요" 자동 축약) + 각 행 라벨 단위 접두(1-3).

## 0. 배정 확정 (설계 문서 §5·§6 모순 + 검증 발견 반영)

현재 "시장/투자 지표" 14필드(highlight 3 + grid 11)의 행선지 — **잔류 4 · 대조표 3 · 지역통계 7** (누락 0):

| 행선지 | 필드 |
|---|---|
| 시세 새 섹션 잔류 (4) | pir, psr (highlight) / floorRange, housingPrice (grid) |
| 두 출처 대조 표 — 우리측 열 (3) | nearbyMedian, nearbyBuildYear, **avgFloor** |
| 분양 "이 지역 통계" (7) | popGrowth, netMigration, housingSupplyLevel, fertilityRate, doctorsPer1k, hospitalBedsPer1k, recentTrades6m |

- avgFloor 를 v1 의 "섹션 잔류"에서 **대조표 4행으로 승격**한 이유(P1-3):
  `api/supabase/apartments.ts:303` 이 `avgFloor ?? naverAvgFloor` 폴백이라, 섹션의 avgFloor 와 서랍의
  naverAvgFloor 가 같은 숫자를 두 번 그리는 이중 노출이 있었다. 대조표가 두 값을 한 행에 나란히 놓으면
  해소되고, 설계 문서 §6 의 "평균층↔네이버" 배정과도 일치한다.
- jeonseRate 는 편차 스트립(charts) 소속 유지 — 대조표는 우리측 값을 재인용(맥락 재사용, pir 선례).

## 1. 변경 상세

### 1-1. 시세 탭 — 섹션 개편 (`src/lib/dataSections.ts`)

```ts
// PRICE_SECTIONS = 1개 섹션
{
  title: "<Q-A 결정>",
  highlight: ["pir", "psr"],
  grid: ["floorRange", "housingPrice"],
  hint: 재작성 — 반드시 유지할 문구 3개: "공시가격" · "세금" · "낮은 게 정상"
        (dataSections.test.ts:46-51 가드 존치) + PIR/PSR 은 "이 단지 분양가를 동네 소득·시세로 잰 값" 설명
        + "인구·거래량 같은 지역 통계는 분양 탭 '이 지역 통계' 서랍으로 옮겼어요"
}
// "네이버 교차검증" 섹션 삭제 → 1-2 가 대체
```

### 1-2. 신설 `src/components/detail/SourceComparison.tsx` — "같은 값을 두 곳에서 재봤어요"

표 4행 (공공데이터 | 네이버 | 차이):

| 행 | 우리측 | 네이버측 | 차이 | **폴백 플래그 (P0-3 필수)** |
|---|---|---|---|---|
| 주변 시세 | nearbyMedian | naverNearbyMedian | % | `_fallbackNearbyMedian` |
| 전세가율 | jeonseRate | naverJeonseRate | %p | `_fallbackJeonseRate` |
| 주변 건축연도 | nearbyBuildYear | naverBuildYear | 년 | `_fallbackNearbyBuildYear` |
| 평균 거래 층수 | avgFloor | naverAvgFloor | 층 | `_fallbackAvgFloor` |

- **폴백 규칙 (이 PR 의 정직성 핵심)**: `api/supabase/apartments.ts:299-306` 이 우리측 값을 네이버로
  폴백시키므로(`jeonseRate` 는 상수 40), `_fallback* === true` 면 우리측 열을 **"미수집"** 으로 그리고
  차이 칸은 "—". 이 처리 없이는 같은 네이버 값을 두 열에 놓고 "차이 0% = 믿을 만"이라는 거짓
  상호검증을 출시하게 된다(비로그인 공개 = 구글 색인 대상이라 더 치명).
- 행 규칙: 양쪽 다 없음 → 행 숨김 / 한쪽만 없음 → 행 유지 + "미수집"(차이 "—")
- 차이 색: **중립(무색)** — 임계 실측 없음 + 폴백 오염 시 초록이 거짓 안심을 주므로
- 칩: 매매·전세·월세 N건 (naverSellCount·naverJeonseCount·naverWolseCount, null 숨김)
- 각주: "두 출처가 가까우면 그 자체가 믿을 근거 · 주변 N개 단지 기준 · 네이버 수집 M/D"
  (naverNearbyCount·naverFetchedAt, null 조각 생략)
- 네이버 필드 전부 null → 컴포넌트 null
- 배선: DetailModal 시세 탭 UnsoldChart 다음 → SourceComparison → PRICE_SECTIONS map → PriceByFloorBlock (그 외 무변경)

### 1-3. 신설 `src/components/detail/RegionStats.tsx` + `src/constants/regionStatsFields.ts`

- `export const REGION_STATS_FIELDS = [...7종] as const` — **export 필수** (테스트 reachable 이 임포트)
- 닫힘(기본): `🗂 이 지역 통계 — <Q-B 결정 문구>`
- 열면: `<MarketStatsCharts region gu/>` (무변경 재사용) + 7행
- **행 라벨 단위 접두 (P0-4·D-1)** — 도움말 한 줄보다 라벨이 확실하다:
  - 시·도 3행: `{region} 인구증감률` · `{region} 순이동` · `{region} 주택보급률` (VIEW `latest_regions` 소속)
  - 시·군·구 4행: `{gu} 합계출산율` · `{gu} 의사수` · `{gu} 병상수` · `{gu} 최근 6개월 거래` (VIEW `latest_regions_gu`·trade-stats guTrades 소속. gu 없으면 region 폴백)
  - 값 포맷은 FIELD_META fmt 재사용
- 도움말(HelpHint): "인구·순이동·주택보급률·그래프는 시·도, 출산율·의료·거래량은 시·군·구 단위 통계예요"
  (⚠️ v1 문구는 인구를 시군구로 적은 오류 — 운영 VIEW `20260809000000_view_add_housing_price.sql:51-71` 실측으로 정정)
- 채움 도넛 **생략** — 도넛은 "이 단지 자료 채움률" 기호라 지역값에 그리면 같은 기호가 두 뜻이 된다.
  제목줄·▼·hint 무늬는 DataSectionBlock 과 동일하게(형태 일관), popGrowth 의 "양수면 유입" 설명은
  HIGHLIGHT_DESC 에서 지우고 이 도움말로 이관
- 배선: DetailModal 분양 탭 기존 `<MarketStatsCharts/>` 자리 교체 (순서 무변경)

### 1-4. Q6 — 변별력 0 필드 6개 손님 화면 제외

- `INTERNAL_ONLY_FIELDS` += hasPool(전부 없음)·quakeDesign(98.9% 적용)·sunlight(전부 "양호")·energyGrade(수집 0%)·supplyRatio(수집 0%)·hugGuarantee(수집 0%)
- `LOCATION_SECTIONS` "치안/환경" grid 에서 sunlight 제거 + hint 의 "일조(햇빛)" 문구 제거
- **의도된 화면 변화 (실측 2026-08-09)**: 나머지 6필드 동시 null 단지 = **459/2,043 (22.5%)** → 이 단지들은
  "일조: 양호"(정보 0)로 채워진 척하던 표 대신 "데이터 수집 중..." 빈 상태 한 줄 — 더 정직해지는 것. 채움
  도넛 % 하락도 같은 이유로 의도됨.
- 무변경 확인 대상: 관리자 전수 표(FIELD_META 직독) · 스코어링 — scoreProduct(hasPool·energyGrade·quakeDesign)
  · scoreRisk(supplyRatio·hugGuarantee) · **scoreLocation(sunlight L97-101,176-177) + engine.ts `_noSunlight`(L91,120)**
  (v1 은 sunlight 를 scoreProduct/Risk 로 오귀속 — 정정)

### 1-5. 레지스트리 (`src/lib/tabExtraFields.ts`)

- `INTERNAL_ONLY_FIELDS` +6 (1-4)
- `FIELDS_SHOWN_IN_DETAIL_CARDS` += 대조표 12필드: 우리측 nearbyMedian·nearbyBuildYear·avgFloor +
  naver 9종(naverNearbyMedian·naverJeonseRate·naverBuildYear·naverAvgFloor·naverSellCount·naverJeonseCount·naverWolseCount·naverNearbyCount·naverFetchedAt)
  ※ jeonseRate 는 charts 등재라 제외(이중 등재 금지)
- alreadySeen 유니온에 `REGION_STATS_FIELDS` 추가
- `tabOf` 의 "미래 naver*" 특례는 **도달 불가 죽은 분기**(naver 필드는 전부 `교차검증` 섹션 소속) — 코드는
  건드리지 않고 주석만 사실로 정정. 서랍 결과: sec-price 여분 = `naverSchoolWalkMin` 1개
  (v1 서술 정정 — naverAvgFloor 는 원래 서랍이었다가 대조표로 **나가고**, naverSchoolWalkMin 이 새로 온다.
  naverSchoolWalkMin 의 최종 자리는 입지 학군 카드 = PR-3 승격 예정)

### 1-6. 테스트 (기존 3파일 + 신규 2파일)

**`src/lib/dataSections.test.ts` (v1 누락 — P0-1)**:
- L7-14 섹션 수 5 → **4**
- L27-31 sunlight 포함 → **미포함** 단언으로 반전
- L33-35 housingSupplyLevel → priceFields 미포함 단언 (지역통계 이동 잠금)
- L39-42 인접성 가드(housingPrice 가 nearbyMedian 옆) → nearbyMedian 이 대조표로 가서 성립 불가.
  취지(공시가격 오해 방지)는 라벨 "(시군구 평균)" + hint 문구 가드가 이미 담당 → 이 단언은
  "priceFields 에 housingPrice·floorRange 포함 + nearbyMedian 미포함" 으로 교체
- L46-51 hint 문구 가드("공시가격"·"세금"·"낮은 게 정상") **존치** — 새 hint 가 세 문구를 유지해야 통과

**`src/lib/tabExtraFields.test.ts`**:
- `INTENTIONALLY_UNRENDERED` += Q6 6종 (사유 문구)
- **reachable 집합(L61-71)에 `REGION_STATS_FIELDS` 추가 (P0-2 — 안 하면 7필드 orphan RED)**
- CARD_SOURCE += 대조표 12필드 (파일 `../components/detail/SourceComparison.tsx`, regex 좌변 고정)
- **RegionStats 전용 소스 대조 블록 신설** — CARD_SOURCE 루프(L166)는 FIELDS_SHOWN_IN_DETAIL_CARDS 만
  순회하므로 REGION_STATS_FIELDS 를 CARD_SOURCE 에만 넣으면 검사가 0회 실행되는 껍데기가 된다(P0-2).
  `for (const f of REGION_STATS_FIELDS)` 별도 루프로 RegionStats.tsx 소스 대조
- gone 목록 += 이동 9(popGrowth·netMigration·housingSupplyLevel·fertilityRate·doctorsPer1k·hospitalBedsPer1k·recentTrades6m·nearbyMedian·nearbyBuildYear) + avgFloor + 대조 naver 9 + Q6 6
  (⚠️ 잔류 pir·psr·floorRange·housingPrice 는 넣지 않는다 — gone 은 "서랍에 없어야"의 뜻이라 오등재 시 목록이 거짓.
   naverSchoolWalkMin 은 서랍 잔류라 넣으면 즉시 RED — 제외)
- L309-315 대표값 테스트: 죽은 특례("미래가 아니라") 전제를 버리고 **"교차검증 섹션 필드는 sec-price 서랍"**
  으로 재작성 (대표 naverSchoolWalkMin, sec-location 미포함 동시 단언) — 뮤테이션으로 살아있음 실증(아래)

**`src/components/DetailModal.test.jsx`**: "시장/투자 지표" **3곳**(L317 it 제목 + L321 + L759) → 새 이름
+ 시세 탭 대조 헤더·분양 탭 지역통계 문구 존재 단언 추가

**`src/components/detail/DataSectionBlock.test.jsx`**: **5곳**(L88·L90·L92 교차검증 / L163·L164 시장투자) —
교차검증 섹션 소멸로 도넛 테스트는 잔존 섹션(예: 치안/환경)으로 대체

**신규 `SourceComparison.test.jsx`**: 4행 렌더 / 한쪽 미수집 / **폴백 플래그 true → 우리측 "미수집"·차이 "—"** /
전부 null → null / 차이 계산(%·%p·년·층) / 칩·각주
**신규 `RegionStats.test.jsx`**: 닫힘 문구 / 열면 7행+차트 마운트 / 시도·시군구 라벨 접두 / gu 없음 폴백

## 2. 검증 계획

1. 회귀: typecheck×3 · vitest 전체(기준선 4,921) · lint · format:check · build(후 public/data 원복)
2. 화면 눈확인(dev 부팅 로그 경고 0 포함): 시세(대조표 4행·폴백 단지 "미수집" 표기·새 섹션·서랍 1개) /
   분양(지역통계 닫힘 문구·열면 그래프+7행 라벨 접두) / 입지(일조 소멸·459곳 유형의 빈 상태 문구) /
   종합 서랍 9→6 · 분양 서랍 6→4
3. 뮤테이션 (백업→고장→RED 확인→원복→diff 0, 각 치환 후 `n!==s` 확인):
   - SourceComparison 에서 naverJeonseRate 렌더 제거 → CARD_SOURCE RED
   - REGION_STATS_FIELDS 에서 1개 제거 → 전량 도달 RED
   - dataSections 에 popGrowth 되돌리기 → gone RED
   - `SECTION_TO_TAB.교차검증` 을 sec-location 으로 변조 → 재작성한 대표값 테스트 RED (죽은 가드 소생 실증)
   - SourceComparison 폴백 분기 제거 → 폴백 테스트 RED

## 3. 검증 완료 사항 (재확인 불필요 — 근거는 두 검증 보고서)

- 이동/제외 필드의 UI 소비처 0 (AptCard·CompareSheet·ShareSheet·hooks grep 0) · 스코어링/관리자 표 무영향
- e2e 15개 spec 문자열 참조 0 · 비로그인 블라인드는 점수 계열만이라 새 컴포넌트 공개 = 정책 준수(SEO 이득)
- 서랍 개수 예측 수기 재현 일치: 종합 9→6, 분양 6→4, 전 탭 >0 유지
- 별도 트랙 분리: hugGuarantee 가 `?? false` + scoreRisk +40 으로 전 단지 상시 페널티(수집 0% 상태) — 이 PR 범위 밖
