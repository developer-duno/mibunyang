# parseGu 정규화 + SIDO_CODES 박제값 검증 — 행안부 data.go.kr API

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
// 시도 단위 집계 hasGuLevel 플래그로 중복 차단
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

## 재발 방지 (4중)

### 1. 행안부 data.go.kr API raw sample 박제 의무

신규 collector + 행안부 API 의존 자리 시 raw 호출 1회 의무. SIDO_CODES 박제값 단정 금지.

```bash
node --input-type=module -e "
import { loadEnv, fetchWithRetry } from './scripts/collectors/_shared.mjs';
loadEnv();
const params = new URLSearchParams({
  ServiceKey: process.env.MOIS_POP_KEY,
  searchYear: '2024',
  pageNo: '1', numOfRows: '20',
  format: 'json',
});
const res = await fetchWithRetry('https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus?' + params);
const data = await res.json();
const items = data.response?.body?.items?.item ?? [];
console.log('rows:', Array.isArray(items) ? items.length : 1);
for (const r of Array.isArray(items) ? items : [items]) {
  console.log(r.ctpvNm, r.sggNm, r.ctpvCd);
}
"
```

### 2. parseGu 시그니처 정형 답습

신규 행안부/KOSIS 시군구 단위 collector 시 `parseGu(ctpvNm, sggNm)` 시그니처 답습 의무. sggNm 그대로 박힘 + 시도 집계 hasGuLevel 플래그로 중복 차단.

### 3. items.item 객체/배열 양형 처리 의무

행안부/KOSIS/공공API 응답 자리 `items.item` 1행 응답 시 객체. Array.isArray 가드 + 단일 객체일 때 `[items.item]` 변환.

### 4. 신규 SIDO 매핑 변수 박제 시 자매 grep 의무

`SIDO_CODES` / `REGION_CORTAR` / 비슷한 시도 매핑 상수 박제 시 자매 collector grep 의무. 환각 박제값 자매 drift 발견 시 동시 fix.

```bash
grep -rn '"3600000000"\|"4200000000"\|"4500000000"' scripts/ src/
```

## 안티 패턴 (사고 답습)

- ❌ "SIDO_CODES 박제값 = 행안부 표준 코드" — raw API 17 시도 응답 검증 의무
- ❌ "sggNm = 시 단위 (자치구 자리 무시)" — sggNm 그대로 박힘 의무
- ❌ "items.item = 배열 단일 형" — 1행 응답 시 객체. Array.isArray 가드 의무
- ❌ "자매 SIDO 매핑 변수 = 답습 자산이라 안전" — 자매 drift 발견 시 동시 fix 의무 (세션 286 박제)

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
