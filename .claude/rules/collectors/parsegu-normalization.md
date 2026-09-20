---
paths:
  - "scripts/collectors/population*.mjs"
  - "scripts/collectors/_shared.mjs"
  - "scripts/collectors/migration.mjs"
---

# parseGu 정규화 + SIDO_CODES 박제값 검증 — 행안부 data.go.kr API

> 사건·이력 (세션285 — population.mjs 61일 누락 사고 통합 정정: parseGu 자치구 정보 손실 · SIDO_CODES 환각 3건(세종·강원·전북) · items.item 객체/배열 양형 처리. 세션286 에 자매 drift 동시 fix) → [rules-history/collectors/parsegu-normalization.md](../../rules-history/collectors/parsegu-normalization.md)

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

신규 행안부/KOSIS 시군구 단위 collector 시 `parseGu(ctpvNm, sggNm)` 시그니처 답습 의무. sggNm 그대로 박힘.

⚠️ **시도 집계 중복 차단은 `hasGuLevel` 플래그가 아니다** — 그 방식은 세션501에 폐기됐고(구 없는 시·군 111개
동반 유실), 뒤이은 `pickParentCities(rows)`(접힌 `gu` 기준)도 세션546에 폐기됐다. 별칭표가 "화성시 동탄구"를
"화성시"로 접어 공백이 사라지므로 부모 시가 안 잡혀 경기 시도행이 **+999,673** 부풀었다. 현재 정답은 둘을 함께 쓴다:
- `pickCanonicalPopulationRows(items)` — 같은 키로 접힌 원문 중 **시 단위 원문 우선**으로 키당 1행(저장용).
- `rawParents(items)` — 부모 시 판정을 **원문 `sggNm`** 으로(시도 합 계산용, `sumSidoFromRaw`).
- 그리고 시도행 자체는 손으로 더하지 말고 **`lv=1` API 값**을 쓴다(`fetchSidoTotals`·`buildSidoRows`).
  시군구 합은 교차검증과 lv=1 실패 시 fallback 에만 쓴다.

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

> 답습 자산·차단 검증 이력 → [rules-history/collectors/parsegu-normalization.md](../../rules-history/collectors/parsegu-normalization.md)
