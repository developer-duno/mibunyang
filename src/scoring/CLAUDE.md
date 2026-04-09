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

## 새 카테고리 추가 시

1. `engine.js`에 `scoreNewCategory(apt, ctx)` 작성 (반환: `{ total, subs[] }`)
2. `calcCats()` 내 호출 추가
3. `src/constants/profiles.js` — PROFILES 5개 전부 가중치 재조정 (합계 100 유지)
4. `src/theme/index.js` — catCol, catBg에 새 색상 추가
5. CompareSheet, CatPanel, Radar에 키 추가

---

## scoreFuture 동적 가중치

교통/도시/산업 데이터 부재 시 인구에 가중치 집중 (합계 항상 1.00):

| 교통 | 도시 | 산업 | wTr | wCity | wPop | wInd |
|------|------|------|-----|-------|------|------|
| O | O | O | 0.30 | 0.25 | 0.25 | 0.20 |
| O | O | X | 0.40 | 0.30 | 0.30 | 0 |
| O | X | O | 0.40 | 0 | 0.30 | 0.30 |
| O | X | X | 0.55 | 0 | 0.45 | 0 |
| X | O | O | 0 | 0.35 | 0.35 | 0.30 |
| X | O | X | 0 | 0.45 | 0.55 | 0 |
| X | X | O | 0 | 0 | 0.60 | 0.40 |
| X | X | X | 0 | 0 | 1.00 | 0 |

## scoreFuture 키워드 그룹

| 그룹 | 용도 | 키워드 |
|------|------|--------|
| TRANSIT_ACTIVE | 기존/운행 중 | 기존, 운행중, 개통 |
| TRANSIT_PLANNED | 계획/공사 중 | 계획, 착공, 공사중, 추진, 확정, 예정, 인가 |
| TRANSIT_HIGH | 고가치 (1.2x) | GTX, KTX역, SRT, 지하철연장, 신설역, 광역급행, BRT, 트램, 경전철, 도시철도 |
| CITY_HIGH | 80점 | 테크노, 주거타운, 신도시, 신도심, 복합도시, 재건축, 혁신, 스마트시티 등 |
| CITY_MID | 50점 | 재생, 리모델링, 관광, 산업단지, 특구, 역세권개발 등 |
| 기타 | 30점 | 위 키워드 미매칭 시 |

`includes()` 부분 매칭 주의 ("신도" → "신도시"+"신도심" 모두 매칭).

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
| naverSellCount | scoreRisk liqSc | 50건+ → +5, 30건+ → +2 페널티 |
| presaleType | scoreRisk finSc | "공공" 포함 시 -15 보너스 |
| newSupply | scoreRisk supSc | 5000+ → +5, 1000- → -3 |
| priceIndex | scorePrice relSc | 130+ → +5, 110+ → +3 |
| presaleParking/presaleGeneralSupply | scoreProduct | parkingRatio null 폴백 |
| presaleHousingType | scoreProduct | 오피스텔/도시형 brandSc 상한 15 |

---

## null/undefined 처리

- `??` (nullish coalescing) 사용: `apt.schoolScore ?? 50` — 0도 정상 처리
- `||` (logical OR) 금지: `apt.schoolScore || 50` — 0이 50으로 대체되는 함정
- 배열 가드: `(apt.noxious || []).length`
- 숫자 가드: `(apt.units ?? 0).toLocaleString()`
