# 스코어링 엔진 규칙

> `engine.js` 수정 시 반드시 이 규칙을 따를 것.

## 함수 시그니처

| 함수 | 시그니처 | 반환 |
|------|---------|------|
| `calcCats(apt, ctx)` | ctx = { regionMedians } | 6개 카테고리 { total, subs[] } |
| `calcAll(apt, profile, ctx)` | profile 가중치 적용 | { total, cats, weights } |
| `computeRegionalMedians(apts)` | 전체 아파트 배열 | 지역별 중위값 객체 |

**ctx 파라미터**: App.jsx에서 `computeRegionalMedians(apartments)`로 생성하여 전달.

## 가중치 합계 = 100% (또는 1.00)

수정 시 반드시 합계를 검증할 것. 한 곳이라도 틀리면 전체 점수가 왜곡됨.

| 위치 | 항목 | 합계 |
|------|------|------|
| profiles.js PROFILES.live | location(40)+product(20)+price(20)+risk(10)+benefit(5)+future(5) | **100** |
| profiles.js PROFILES.invest | location(15)+product(10)+price(30)+risk(25)+benefit(10)+future(10) | **100** |
| profiles.js PROFILES.newlywed | location(30)+product(15)+price(30)+risk(10)+benefit(10)+future(5) | **100** |
| profiles.js PROFILES.edu | location(45)+product(20)+price(15)+risk(10)+benefit(5)+future(5) | **100** |
| profiles.js PROFILES.retire | location(35)+product(25)+price(20)+risk(15)+benefit(5)+future(0) | **100** |
| engine.js scorePrice 내부 | 0.30+0.20+0.15+0.25+0.10 | **1.00** |
| engine.js scoreLocation 내부 | 0.30+0.25+0.20+0.10+0.15 | **1.00** |
| engine.js infra 서브가중치 | 0.20+0.10+0.05+0.15+0.15+0.15+0.05+0.15 | **1.00** |
| engine.js scoreRisk 내부 | 0.20+0.15+0.15+0.20+0.10+0.10+0.10 | **1.00** |
| engine.js scoreFuture 내부 | 동적 가중치 (아래 참조) | **항상 1.00** |
| engine.js scoreProduct max | 20+15+15+10+10+10+10+5+5 | **100** |

## 모든 점수 0~100 클램핑

모든 서브스코어와 카테고리 총점은 `Math.min(..., 100)` 또는 `Math.max(0, Math.min(100, ...))` 클램핑 필수.
특히 PSR 서브스코어는 psr < 0.7일 때 100 초과 가능 → Math.min 필수.

## 새 카테고리 추가 시

1. `engine.js`에 `scoreNewCategory(apt, ctx)` 함수 작성 (반환: `{ total, subs[] }`)
2. `calcCats()` 내 호출 추가
3. `src/constants/profiles.js` — **PROFILES 5개 전부** 가중치 재조정 (합계 100 유지)
4. `src/theme/index.js` — catCol, catBg에 새 색상 추가
5. CompareSheet, CatPanel, Radar에 키 추가

## scoreFuture 동적 가중치

교통/도시/산업 데이터 부재 시 인구에 가중치 집중 (합계 항상 1.00):

| 교통 | 도시 | 산업 | wTr | wCity | wPop | wInd | 합계 |
|------|------|------|-----|-------|------|------|------|
| 있음 | 있음 | 있음 | 0.30 | 0.25 | 0.25 | 0.20 | **1.00** |
| 있음 | 있음 | 없음 | 0.40 | 0.30 | 0.30 | 0 | **1.00** |
| 있음 | 없음 | 있음 | 0.40 | 0 | 0.30 | 0.30 | **1.00** |
| 있음 | 없음 | 없음 | 0.55 | 0 | 0.45 | 0 | **1.00** |
| 없음 | 있음 | 있음 | 0 | 0.35 | 0.35 | 0.30 | **1.00** |
| 없음 | 있음 | 없음 | 0 | 0.45 | 0.55 | 0 | **1.00** |
| 없음 | 없음 | 있음 | 0 | 0 | 0.60 | 0.40 | **1.00** |
| 없음 | 없음 | 없음 | 0 | 0 | 1.00 | 0 | **1.00** |

## scoreFuture 키워드 그룹

### 교통개발 키워드

| 배열 | 용도 | 키워드 |
|------|------|--------|
| TRANSIT_ACTIVE | 기존/운행 중 교통 | 기존, 운행중, 개통 |
| TRANSIT_PLANNED | 계획/공사 중 교통 | 계획, 착공, 공사중, 추진, 확정, 예정, 인가 |
| TRANSIT_HIGH | 고가치 교통 (1.2x 보너스) | GTX, KTX역, SRT, 지하철연장, 신설역, 광역급행, BRT, 트램, 경전철, 도시철도 |

### 도시개발 키워드

| 그룹 | 점수 | 키워드 |
|------|------|--------|
| CITY_HIGH (80점) | 대규모 개발 | 테크노, 주거타운, 신도시, 신도심, 복합도시, 재건축, 혁신, 스마트시티, 자족도시, 행정중심, 경제자유구역, 국가산단 |
| CITY_MID (50점) | 중규모 개발 | 재생, 리모델링, 관광, 산업단지, 공항, 특구, 메디컬, 역세권개발, 도시정비, 택지개발, 물류단지, 연구단지 |
| 기타 (30점) | 기본 | (위 키워드 미매칭 시) |

새 키워드는 적절한 점수 그룹에 배치. `includes()` 부분 매칭 주의 (예: "신도" → "신도시"+"신도심" 모두 매칭).

## popGrowth 7단계 점수 (한국 현실 기반)

| 인구 증감률 | 점수 | 비고 |
|-----------|------|------|
| null (데이터 없음) | 35 | 중립 (비관적 기본값 아님) |
| ≥ +1.0% | 95 | 신도시급 유입 |
| ≥ +0.5% | 80 | 성장 도시 |
| ≥ 0% | 65 | 안정적 |
| ≥ -0.3% | 50 | 한국 평균 수준 |
| ≥ -0.8% | 35 | 일반적 감소 |
| ≥ -2.0% | 20 | 주의 구간 |
| < -2.0% | 10 | 인구 급감 |

근거: 한국 전체 평균 인구 성장률 약 -0.3%, 서울 -0.1%~-0.8%가 67%.

## 순이동(netMigration) 보너스/페널티

popSc에 가산/감산. 인구 증감률과 별개로 실제 전입/전출 데이터 반영:

| 조건 | 효과 | 클램핑 |
|------|------|--------|
| 순이동 > 0 (순유입) | popSc + 10 | Math.min(100) |
| 순이동 ≤ -5000 (대규모 유출) | popSc - 5 | Math.max(0) |
| 순이동 null 또는 -5000~0 | 변경 없음 | — |

## null/undefined 처리

- `??` (nullish coalescing) 사용: `apt.schoolScore ?? 50` — falsy-zero(0)도 정상 처리
- `||` (logical OR) 금지: `apt.schoolScore || 50` — 0이 50으로 대체되는 함정
- 배열 가드: `(apt.noxious || []).length`
- 숫자 가드: `(apt.units ?? 0).toLocaleString()`
