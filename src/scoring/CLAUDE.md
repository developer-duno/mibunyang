# 스코어링 엔진 규칙

> `engine.js` 수정 시 반드시 이 규칙을 따를 것.

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
| engine.js scoreFuture 내부 | 0.40+0.30+0.30 | **1.00** |
| engine.js scoreProduct max | 20+15+15+10+10+10+10+5+5 | **100** |

## 모든 점수 0~100 클램핑

모든 서브스코어와 카테고리 총점은 `Math.min(..., 100)` 또는 `Math.max(0, Math.min(100, ...))` 클램핑 필수.
특히 PSR 서브스코어는 psr < 0.7일 때 100 초과 가능 → Math.min 필수.

## 새 카테고리 추가 시

1. `engine.js`에 `scoreNewCategory(apt)` 함수 작성 (반환: `{ total, subs[] }`)
2. `calcAll()` 내 호출 추가
3. `src/constants/profiles.js` — **PROFILES 5개 전부** 가중치 재조정 (합계 100 유지)
4. `src/theme/index.js` — catCol, catBg에 새 색상 추가
5. CompareSheet, CatPanel, Radar에 키 추가

## scoreFuture 키워드 그룹

| 그룹 | 점수 | 기존 키워드 |
|------|------|------------|
| 80점 | 대규모 개발 | 테크노, 주거타운, 신도시, 신도심, 복합도시, 재건축, 혁신 |
| 50점 | 중규모 개발 | 재생, 리모델링, 관광, 산업단지, 공항, 특구, 메디컬 |
| 30점 | 기본 | (위 키워드 미매칭 시) |

새 키워드는 적절한 점수 그룹에 배치. `includes()` 부분 매칭 주의 (예: "신도" → "신도시"+"신도심" 모두 매칭).

## null/undefined 처리

- `??` (nullish coalescing) 사용: `apt.schoolScore ?? 50` — falsy-zero(0)도 정상 처리
- `||` (logical OR) 금지: `apt.schoolScore || 50` — 0이 50으로 대체되는 함정
- 배열 가드: `(apt.noxious || []).length`
- 숫자 가드: `(apt.units ?? 0).toLocaleString()`
