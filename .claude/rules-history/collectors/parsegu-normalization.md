# parseGu 정규화 + SIDO_CODES 박제값 검증 — 행안부 data.go.kr API — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/collectors/parsegu-normalization.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 285)

`scripts/collectors/population.mjs` 세 사고 통합 정정. 2개월 누락 (2026-03-21 `09e25fef` ~ 2026-05-21 `78a862d`, 61일).

### 1. parseGu() 자치구 정보 손실

```js
// 빨강 (이전 본문, population.mjs L99-113 영역):
const region = parseRegion(ctpvNm);
const gu = [ctpvNm, sggNm].join(" ").split(/\s+/)[1] || null;
// → sggNm = "용인시 기흥구" 같은 자치구 자리 시도+시 단위로 잘림

// 초록 (population.mjs L116-122, population-sex-age.mjs v2 답습):
function parseGu(ctpvNm, sggNm) {
  const region = parseRegion(ctpvNm);
  return region ? { region, gu: sggNm || null } : null;
}
// 시도 단위 집계 중복 차단 (⚠️ 옛 `hasGuLevel` 플래그는 폐기 — 세션501/546 정정 이력은 아래 §2)
```

### 2. SIDO_CODES 환각 3건 (2개월 누락)

raw API 17 시도 ctpvNm 응답 검증으로 발견:

- 세종: `3600000000` → `3611000000` (이전 빈 응답)
- 강원: `4200000000` → `5100000000` (이전 빈 응답)
- 전북: `4500000000` → `5200000000` (이전 빈 응답)

**자매 drift 영역** (세션 286 본 룰 박제 시점 발견):

- `population-sex-age.mjs` L26-31 — **본 룰 박제 시점 동시 fix** (세션 286 커밋 5)
- `naver-presale.mjs` L47 세종 `3600000000` — **본 룰 박제 시점 동시 fix** (세션 286 커밋 6, raw API 검증 선행)

### 3. items.item 객체/배열 양형 처리

행안부 API 응답이 1행일 때 `items.item` = 객체, 다행일 때 = 배열.

```js
// population.mjs L66-71 답습
const items = json?.Response?.items?.item;
if (Array.isArray(items)) { allItems.push(...items); }
else if (items && typeof items === "object") { allItems.push(items); }
```

## 답습 자산

- 세션 285 본 사고 박제 (`78a862d` 커밋)
- 세션 286 자매 drift 동시 fix (population-sex-age.mjs + naver-presale.mjs)
- `scripts/collectors/population.mjs` L116-122 parseGu 정형 답습 원천
- `scripts/collectors/population-sex-age.mjs` v2 (세션 286 시점에 SIDO_CODES drift 동시 fix 완결)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 collector SIDO_CODES 박제값 단정 후 적재 | §1 raw API 17 시도 박제 의무 발동 |
| sggNm parts[1] split 으로 자치구 손실 | §2 parseGu 시그니처 답습 의무 |
| 1행 응답 환각 (items.item 객체 단일 처리) | §3 Array.isArray 가드 의무 |
| 자매 SIDO 매핑 변수 drift 미발견 | §4 자매 grep 의무 발동 |
