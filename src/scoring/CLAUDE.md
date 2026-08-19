# 스코어링 엔진 규칙

> 스코어링 모듈 수정 시 반드시 이 규칙을 따를 것.

## 파일 구조

```
src/scoring/
  engine.js              — 오케스트레이터 (sanitize + calcCats + calcAll + re-export)
  scorePrice.js          — 가격 매력도 (scorePrice, getAgeCoeff, getAreaAdj)
  scoreLocation.js       — 입지/생활권 (scoreLocation)
  scoreProduct.js        — 상품성 (scoreProduct)
  scoreBenefit.js        — 혜택/할인 (scoreBenefit)
  scoreRisk.js           — 안전도 (scoreRisk)
  scoreFuture.js         — 미래가치 (scoreFuture + matchAny + 키워드 상수)
  computeRegionalMedians.js — 지역별 중위값 계산
  engine.test.js         — 전체 테스트
```

모든 함수는 engine.js에서 re-export. import 경로: `@/scoring/engine`

## 함수 시그니처

| 함수 | 시그니처 | 반환 |
|------|---------|------|
| `calcCats(apt, ctx)` | ctx = { regionMedians } | 6개 카테고리 { total, subs[] } |
| `calcAll(apt, profile, ctx)` | profile 가중치 적용 | { total, cats, weights } |
| `computeRegionalMedians(apts)` | 전체 아파트 배열 | 지역별 중위값 객체 |

---

## 가중치 합계 = 100% (또는 1.00)

수정 시 반드시 합계 검증. 한 곳이라도 틀리면 전체 점수 왜곡됨.

| 위치 | 합계 |
|------|------|
| PROFILES 5개 (live/invest/newlywed/edu/retire) | 각각 **100** |
| scorePrice 내부 (괴리도/전세가율/PIR/PSR/신뢰도/택지비) | **1.00** |
| scoreLocation 내부 (5개 서브) | **1.00** |
| infra 서브가중치 (10항목) | **1.00** |
| scoreRisk 내부 (11개 서브) | **1.00** |
| scoreFuture 내부 (동적, 아래 참조) | **항상 1.00** |
| scoreProduct max (9개 항목) | **100** |

## 모든 점수 0~100 클램핑

`Math.min(..., 100)` 또는 `Math.max(0, Math.min(100, ...))` 필수.
특히 PSR 서브스코어는 psr < 0.7일 때 100 초과 가능.

## PIR 점수 구간 (세션108 재설계)

개인소득 PIR 분포(중앙값 18.3년)에 맞춘 4단계. 세션107 소득 정상화 후 기존 `≤3/≤5/≤7` 구간이 83%를 하위 10점대로 몰던 문제 해소.

| 구간 | 점수 | 경계 |
|------|------|------|
| ≤ 10 | 100 | 우수 |
| 10~20 | 80→100 선형 | 양호 |
| 20~30 | 60→80 선형 | 보통 |
| > 30 | 60-(pir-30)×2 (0 하한) | 부담 |

상수: `src/constants/scoringTiers.js` → `PIR_SCORE_TIERS = { EXCELLENT_MAX: 10, GOOD_MAX: 20, MODERATE_MAX: 30, BURDEN_PENALTY: 2 }`.

## fairPrice 폴백 + 신뢰도 차감 (세션114)

`nearbyMedian` 부재 시 `fairPrice` 산정은 3단 폴백:

1. `trade_stats.nearby_median`  (1순위)
2. `regions.avg_price_sqm` × 면적 → `fairPriceFromSidoAvg=true` 플래그 설정
3. `presale_pp` × 면적/3.3058 → 동일 플래그 설정

**폴백 사용 시**: `dataReliability -= PRICE_FALLBACK_RELIABILITY_PENALTY` (기본 15, `src/constants/scoringTiers.js`). 괴리도 `detail`에 `" — 광역 시도 평균 기준(실시세 왜곡 가능)"`, 신뢰도 `info/detail`에 `" -폴백차감15"` 접미. 점수 계산 로직·가중치는 불변, UX 정직성 보정만.

영향 단지: 섬·군 10개(인천 동구 2·옹진군 2·경기 가평군 3·양평군 2·연천군 1). 세션115 Playwright 실측으로 전문가 대시보드 `ExpertScoreBreakdown`에서 5/5 DOM 노출 확인.

## 새 카테고리 추가 시

1. `engine.js`에 `scoreNewCategory(apt, ctx)` 작성 (반환: `{ total, subs[] }`)
2. `calcCats()` 내 호출 추가
3. `src/constants/profiles.js` — PROFILES 5개 전부 가중치 재조정 (합계 100 유지)
4. `src/theme/index.js` — catCol, catBg에 새 색상 추가
5. CompareSheet, CatPanel, Radar에 키 추가

---

## scoreFuture 고정 가중치 (세션511 — 동적 재분배 폐기)

`FUTURE_WEIGHTS` = **pop .55 · tr .225 · city .135 · ind .09** (호재 몫 합 0.45).
raw 총점을 `FUTURE_RAW_MAX`(= `FUTURE_AXIS_MAX` × `FUTURE_WEIGHTS` 의 합, **코드에서 계산**)로
나눠 0~100 정규화한다. 숫자를 여기 적지 않는다 — 축 상한이 바뀌면 이 문서만 조용히 어긋난다
(`scoringTiers.test.js` 가 그 합을 검사한다).

### 왜 동적 재분배를 버렸나

옛 `FUTURE_WEIGHT_MAP` 은 8조합의 합이 전부 1.00 이라 항등식이 성립했다:

```
total − (호재 전무일 때 total) = Σ wᵢ(축ᵢ − popSc)
```

즉 **"켜진 축들의 가중평균 < popSc 이면 무조건 역전"**. `"0,0,0"` 이 pop 1.00 이라 호재가 없으면
그 몫이 100% 인구로 갔기 때문이다. 인구는 실측 중앙 75인데 옛 교통 상한은 72라, 교통 호재를
가진 단지가 구조적으로 손해를 봤다.

**⚠️ 모집단을 반드시 함께 적는다.** 이 저장소는 모집단이 셋이라(정적 JSON 1,646 / VIEW 2,101 /
base 2,696) before 를 한 모집단으로, after 를 다른 모집단으로 재면 결론이 뒤집힌다 — 세션511에
실제로 그런 표를 만들었고 적대검증이 잡았다. 아래는 **손님이 보는 정적 JSON 1,646곳**으로 통일해
옛 코드·옛 데이터 vs 새 코드·새 데이터를 잰 것이다.

| 실측 (정적 JSON **1,646곳** 통일) | 옛 구조 | 새 구조 |
|---|---|---|
| 역전(호재 채웠는데 내려감) | **485곳 / 762** | **0곳** |
| corr(총점, 교통 서브) | **−0.097** (음수) | **+0.489** |
| R²(인구가 총점을 설명) | 76.8% | 69.1% |
| 총점 고유값 | 40 | 71 |
| 총점 최빈 몰림 | 21.8% | 3.9% |
| 교통축 만점 | 0곳 | 26곳 |

> VIEW 2,101 로 재면 새 구조의 R² 는 67.0% 인데, **같은 모집단의 옛 구조는 53.3%** 라 R² 가
> 오히려 올라간다. 그 모집단에서는 "R² 감소"를 개선 근거로 쓸 수 없고, 근거를 **corr 부호 반전**과
> **역전 0곳**으로 옮겨야 한다. 두 근거는 모집단과 무관하게 성립한다.

고정 가중치에서는 각 항이 비음수 가산이라 **채우면 오르기만 한다** — 실측이 아니라 정의로 보장된다.
`engine.test.js` 의 단조성 가드가 이 성질을 잠근다(동적 재분배로 되돌리면 red).

## scoreFuture 교통축 (세션511 재설계)

`transit_dev` 는 `transit-match.mjs` 가 만든 **`"{노선} {역}역 {상태}"`** 문자열이다.
옛 산식은 이 문자열을 키워드 부분매칭으로 훑었는데, **20개 키워드 중 14개가 어떤 문자열에도
닿지 않는 죽은 값**이었다(ACTIVE 3/3 · PLANNED 4/7 · HIGH 7/10). 특히 만점(100)이 `TRANSIT_ACTIVE`
가지에만 있는데 시드는 "앞으로 생길 노선" 목록이라 **5개월간 아무도 만점을 못 받았다.**

새 산식 = **확실성 + 근접 + 노선급 가산** (합 최대 100, 클램프 불필요):

| 요소 | 값 |
|---|---|
| 확실성 `TRANSIT_CERTAINTY` | 공사중·착공 40 / 추진 22 / 계획 12 / 구상 6 |
| 근접 `TRANSIT_DIST_TIERS` | ≤0.5km 40 / ≤1 34 / ≤1.5 27 / ≤2 20 / ≤3 12 / ≤4 5 / 그 외 0 |
| 노선급 `TRANSIT_GRADE` | GTX 20 / 도시철도 15 / 지하철연장 12 / 경전철 8 / 트램 6 |

- **개통(`TRANSIT_OPEN`)은 0점** — 입지 축의 `subwayDist`(Kakao = 운행 중인 역)가 이미 센다.
  넣으면 미래가치·입지지하철·입지KTX **삼중 계상**이 된다.
- **문자열 형식 불일치도 0점** — "무슨 호재인지 모르는데 점수는 있다"를 만들지 않는다.
- 노선 종류는 문자열에 없어서 `TRANSIT_LINE_TYPE`(노선명→종류)로 되찾는다.
  **시드(`public/data/transit-dev.json`)와 1:1이어야 하고**, 어긋나면 그 노선이 조용히
  기본급(8)으로 떨어진다 — `engine.test.js` 가 시드를 읽어 대조한다.

### 세션520 — 교통축 출처가 시드 하나가 아니다

시드는 손으로 적은 **14노선 55역**(2026-03-14 동결)이라 채움률이 48.5% 에 묶여 있었다. 산업축이
세션511에 시드 24건 → `dev_plans` 618건으로 갈아탄 교체를 **교통축만 아직 안 받은 상태**였다.
`transit-match.mjs` 가 이제 네이버 개발계획 역사(`dev_plans` `kind='station'`)를 같은 풀에 넣는다.

| | 시드만 | 시드 + 네이버 144역 |
|---|---|---|
| 채움률(화면 2,182곳) | 48.5% | **56.1%** |
| 70점+ | 5.6% | **10.9%** |
| 0점 | 51.5% | **43.9%** |

- **개통분은 뺀다**(`openDate` 가 지난 6건). 개통한 역은 입지 축 `subwayDist`(Kakao 실시간)가 이미
  센다 — `TRANSIT_OPEN` 을 0점 처리하는 것과 같은 이유. 실측으로 확인했다: 운정역 0.27km 단지의
  `subwayDist` 가 276m 로 정확히 잡혀 있다.
- **`rail`·`road` 는 안 넣는다.** 접근성은 *탈 수 있는 지점*까지의 거리인데, `rail`(34건)은 전부
  "예정" 노선이라 역 위치가 미정이고(station 대응 9%), `road`(75건)는 나들목 위치가 원본에 없다.
  소음으로 쓰는 길도 막혔다 — `raw` 에 노선 선형 좌표가 없어 **27km 고속도로가 점 하나**다.
- ⚠️ **`engine.test.js` 의 1:1 가드는 시드 파일만 읽는다** — 네이버 노선명은 DB 에 있어 그 가드가
  못 본다. 네이버 노선 12종 중 5종은 **표에 이미 있는 노선의 다른 이름이거나 기존 노선의 연장**이라
  값을 물려받게 적어 뒀고(대전지하철2호선·광주2호선1단계·수도권광역급행철도·7호선청라연장·
  9호선4단계 = 109역), 나머지 6종(35역)은 종류를 추측으로 적지 않고 기본급(8)에 둔다.

### 대표 역을 고르는 규칙 — 최근접이 아니라 **최고점** (세션520)

수집기는 5km 안 후보 중 **그 역이 받게 될 점수가 가장 높은** 하나를 고른다(동점이면 가까운 쪽).
옛 "가장 가까운" 규칙은 채점이 거리 말고 **확실성·노선급**도 본다는 사실과 어긋나서, 트램역이
0.2km 더 가깝다는 이유로 GTX역을 밀어냈다 — **후보를 늘렸는데 점수가 내려가는 단지가 35곳**
(최대 −12점) 생겼다. 점수로 고르면 **하락 0**, 평균 40.2 → 40.9.

그래서 `transit-match.mjs` 가 채점 상수 네 종류(`*_MIRROR`)를 복제해 갖는다 — `.mjs` 라 `.ts` 를
import 할 수 없기 때문이다. **`transit-match.test.mjs` 가 `@/constants/scoringTiers` 를 직접
import 해 네 표를 통째로 대조**한다(한쪽만 바꾸면 red). 소스를 정규식으로 긁지 않는 이유는,
줄 끝 주석 하나에 항목이 안 잡혀 "어긋난 채 초록불"이 되기 때문이다(세션520에 실제로 겪었다).

## scoreFuture 도시·산업축 (세션511 재설계)

옛 산식은 이름 키워드만 훑어 **거리를 아예 안 봤다.** 결과가 사실상 이진이었다 —
도시축은 값 보유 111곳이 **전부 80점**, 산업축은 239곳 중 **206곳이 같은 35점**.
출처도 손으로 적은 시드(도시 27건·산업 24건, 2026-03-14 동결)라 **수도권 편중**이었다.

**출처 교체**: 시드 → `dev_plans`(V-WORLD 전국). 수집기가 거리를 문자열에 담는다.

| 축 | 수집기 | 출처 `kind` | 출력 형식 |
|---|---|---|---|
| 도시 | `transit-match.mjs` | `lh_zone` (1,174건) **+ `jigu`**(네이버 지구단위, 부분준공 제외 135건) | `"{지구명} {거리}km"` |
| 산업 | `industry-match.mjs` | `industrial_complex` (618건) | `"{단지명} {거리}km"` |

**세션520 — 지구단위 합류.** 부분준공(59건, jigu 최다)은 뺀다. 이미 입주가 시작된 지구는 앞으로 좋아질
몫이 없고, 그 지구가 만든 생활 인프라는 입지 축 `infra` 가 이미 센다. ⚠️ `lh_zone` 은 원본에
진행단계가 **전부 null** 이라 같은 걸러내기를 못 한다(비대칭은 데이터 한계이지 설계 의도가 아니다).
경계는 그대로 둔다 — 만점 비율이 21.3% → **22.2%** 로만 움직였다(LH 가 이미 촘촘해서다).

**거리 등급 — 두 표가 다르다:**

| 거리 | 도시(LH 지구) | 산업단지 |
|---|---|---|
| ≤0.5km | 100 | — |
| ≤1km | 70 | 100 |
| ≤2km | 40 | 75 |
| ≤3km | 20 | 50 |
| ≤5km | 0 | 25 |

⚠️ **같은 표를 쓰면 한쪽이 죽는다.** 최근접 거리 중앙이 LH 지구 **1.03km** vs 산업단지
**3.28km** 로 스케일이 다르다(2,696단지 실측). `engine.test.js` 가 두 표가 서로 다름을 잠근다.

⚠️ **수집기 출력 형식과 `CITY_DEV_PATTERN`/`INDUSTRY_DEV_PATTERN` 은 한 쌍이다.** 한쪽만 바꾸면
점수가 조용히 0이 된다(에러가 아니라 침묵). 거리 없는 옛 형식이 0점이 되는 것을 테스트가 못 박는다.

---

## 서브지표 점수 테이블

### popGrowth (인구 증감률)

| 증감률 | 점수 | 비고 |
|--------|------|------|
| null | 35 | 중립 |
| >= +1.0% | 95 | 신도시급 |
| >= +0.5% | 80 | 성장 도시 |
| >= 0% | 65 | 안정적 |
| >= -0.3% | 50 | 한국 평균 |
| >= -0.8% | 35 | 일반적 감소 |
| >= -2.0% | 20 | 주의 |
| < -2.0% | 10 | 급감 |

### cancel_ratio_6m (계약해제율) — scoreRisk 가중치 0.04

점수 높을수록 위험. `100 - cancelSc`가 최종 서브점수.

| 해제율 | 점수 |
|--------|------|
| null | 35 |
| <= 3% | 10 |
| <= 8% | 25 |
| <= 15% | 45 |
| <= 25% | 65 |
| > 25% | 85 |

### competitionRate (경쟁률) — scoreRisk 가중치 0.09

점수 높을수록 위험. `100 - compSc`가 최종 서브점수.

| 경쟁률 | 점수 |
|--------|------|
| null | 40 |
| >= 10:1 | 5 |
| >= 3:1 | 15 |
| >= 1:1 | 30 |
| >= 0.5:1 | 45 |
| >= 0:1 | 55 |
| >= -0.5 | 70 |
| < -0.5 | 85 |

### crimeSafetyGrade (치안) — scoreRisk 가중치 0.05

crimeSc = gradeRisk * 0.7 + policeRisk * 0.3. `100 - crimeSc`가 최종.

| 등급 | gradeRisk | policeDist | policeRisk |
|------|-----------|------------|------------|
| null | 35 | null | 35 |
| 1등급 | 10 | <= 500m | 5 |
| 2등급 | 25 | <= 1km | 15 |
| 3등급 | 40 | <= 2km | 30 |
| 4등급 | 60 | <= 3km | 50 |
| 5등급 | 80 | > 3km | 70 |

### netMigration (순이동) — popSc 보정

| 조건 | 효과 |
|------|------|
| 순유입 (> 0) | popSc + 10, Math.min(100) |
| 대규모 유출 (<= -5000) | popSc - 5, Math.max(0) |
| 그 외 | 변경 없음 |

### initialSaleRate (초기분양률) — scoreRisk 가중치 0.03

점수 높을수록 위험. `100 - initSc`가 최종.

| 분양률 | 점수 |
|--------|------|
| null | 40 |
| >= 90% | 10 |
| >= 70% | 25 |
| >= 50% | 45 |
| >= 30% | 65 |
| < 30% | 85 |

### landCostRatio (택지비비율) — scorePrice 가중치 0.03

점수 높을수록 안전.

| 비율 | 점수 |
|------|------|
| null | 50 |
| >= 60% | 80 |
| >= 40% | 60 |
| >= 20% | 40 |
| < 20% | 25 |

### 기타 보정 필드

| 필드 | 적용 위치 | 효과 |
|------|----------|------|
| airSc (대기질 복합) | scoreLocation env | PM2.5*0.4 + PM10*0.35 + O3*0.25 |
| naverSchoolWalkMin | scoreLocation school | <= 5분: +10, <= 10분: +5, <= 20분: -5, > 20분: -10 |
| isRegulated | scoreRisk regSc | DB값 우선, null이면 getZone() 폴백 |
| hugGuarantee | scoreRisk finSc | **false(확인된 무보증)일 때만 +40**, null(모름)·true 무페널티 (세션508) |
| loanFree | scoreRisk loanSc | **false(확인된 유이자)일 때만 +15**, null(모름)·true 무페널티 (세션508) |
| noise | scoreLocation noiseSc | null → NOISE_UNKNOWN_SCORE(중립 15점, 65dB 구간과 동일) (세션508) |
| builderDebtRatio | scoreRisk finSc | null → BUILDER_DEBT_UNKNOWN_ADJ(중립 +10, "주의" 구간과 동일) (세션508) |
| quakeDesign | scoreProduct quakeSc | **false(확인된 미적용)일 때만 0점**, null(모름)·true 5점 (세션508) |
| naverSellCount | scoreRisk liqSc | 50건+ → +5, 30건+ → +2 페널티 |
| presaleType | scoreRisk finSc | "공공" 포함 시 -15 보너스 |
| housingSupplyLevel | scoreRisk supSc **주 지표** | 96%↓ 5 / 101%↓ 25 / 104%↓ 50 / 초과 75, null 75 |
| supplyRatio (인허가율) | scoreRisk supSc 보정 | 2.2%+ → +5, 1.5%- → -3, null 무보정 |
| priceIndex | scorePrice relSc | 130+ → +5, 110+ → +3 |
| presaleParking/presaleGeneralSupply | scoreProduct | parkingRatio null 폴백 |
| presaleHousingType | scoreProduct | 오피스텔/도시형 brandSc 상한 15 |

---

## null/undefined 처리

- `??` (nullish coalescing) 사용: `apt.schoolScore ?? 50` — 0도 정상 처리
- `||` (logical OR) 금지: `apt.schoolScore || 50` — 0이 50으로 대체되는 함정
- 배열 가드: `(apt.noxious || []).length`
- 숫자 가드: `(apt.units ?? 0).toLocaleString()`

### unknown(null) 처리 원칙 — 이진 vs 연속 (세션508)

"모르는 것을 나쁘게 단정하는" 기본값을 막기 위한 필드 종류별 규칙. #367(hugGuarantee)이 드러낸
패턴을 규칙으로 명문화한다 — 지금까지 필드마다 제각각이던 것을 두 갈래로 통일.

| 필드 종류 | 규칙 | 근거 |
|---|---|---|
| **이진(있음/없음)** | `=== false`(확인된 부재)일 때만 불이익. **null(모름)은 "있음"과 같은 대우** | 중간값이 성립하지 않음. loanFree·quakeDesign·hugGuarantee(#367) |
| **연속·구간** | null 이면 **중립 구간 점수**(알려진 값들의 중앙값이 떨어지는 구간) | noise·builderDebtRatio·cancelRatio(35)·competitionRate(40)·crime(35)·unsoldRate(40) |

**중립을 쓰고 최고점을 안 쓰는 이유(데이터 관리)**: 미수집에 최고점을 주면 수집할 이유가
사라진다. 중립은 "재면 오를 수도 내릴 수도" 라서 수집 동기가 유지된다. 자세한 근거 수치는
`docs/superpowers/specs/2026-08-10-unknown-defaults-neutral-plan.md` 참조.

#### 문구판 — 점수뿐 아니라 **말**도 같은 원칙을 따른다 (세션512)

점수를 중립으로 두고 **문구가 "없음"이라 단정하면** 손님은 여전히 거짓을 읽는다.

| 원본 | 문구 |
|---|---|
| `null`(안 재봄) | **"미수집"** |
| 확인된 `0`/`false` | "없음" |

⚠️ **`sanitize` 가 누르는 필드는 엔진이 null 을 볼 수 없다.** 그래서 누르기 **전에** 사실을 남긴다 —
`_noDiscount`·`_noCashback`·`_noMaint`(기존 `_noParking`·`_noFar`·`_noSunlight` 와 같은 꼴).
이걸 빠뜨리면 코드는 맞아 보이는데 화면은 그대로다(세션512 실사고 — 단위 테스트 green, 실전 무효).
**가드는 반드시 `calcCats` 경유**로 쓴다.

축이 재는 것과 문구가 말하는 것을 맞추는 전반 원칙은
[.claude/rules/meta/score-meaning-and-wording-are-a-pair.md](../../.claude/rules/meta/score-meaning-and-wording-are-a-pair.md).
