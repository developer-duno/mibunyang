---
paths:
  - "scripts/collectors/*kosis*.mjs"
  - "scripts/collectors/collect-medical-access.mjs"
  - "scripts/collectors/collect-market-stats.mjs"
  - "scripts/kosis-local-runner.mjs"
---

# KOSIS 통계표 차원 검증 — raw API sample 박제 의무

> 사건·이력 (세션249 — NEXT_SESSION/BACKLOG 박제값을 그대로 답습할 뻔했으나 KOSIS API raw sample 58 rows 호출로 검증. C1_NM 이 3 group 분리 형태(시도별×부문별 교차 cell 부재)임을 확정) → [rules-history/collectors/kosis-dimension-mismatch-guard.md](../../rules-history/collectors/kosis-dimension-mismatch-guard.md)

## 근본 원인 = 차원 분리 vs 교차 환각

KOSIS 통계표 = ITM_NM × N 차원 구조. 그러나 차원 형태 두 가지:

| 형태 | 응답 구조 | 활용 가능 |
|---|---|---|
| **분리 group rows** | C1_NM 별 group 메타 행 (예: "시도별미분양현황" / "부문별미분양현황" 각각 다른 group) | 한 차원만 활용. 차원 간 교차 0 |
| **교차 cells** | 각 row = (dim1, dim2) 교차 cell (예: (서울, 민간부문, 2024)) | N 차원 cross-tab 활용 가능 |

박제값 박는 시점에 "3 차원 존재" 만 보고 "교차 가능" 가설 단정 시 환각 (세션 249 plan v1 박제값 정정 의무 발생).

## 재발 방지 (3중)

### 1. raw API sample 30+ 행 박제 의무

plan 작성 시 KOSIS 통계표 의존 단계가 있으면 본 sample 검증 1회 의무. plan 본문 또는 답습 자산에 raw 30 행 + C1_NM/C2_NM/ITM_NM distinct 박제 의무. 통계표 메타 (KOSIS Playwright 진입 또는 검색 결과) 단정 근거 사용 금지.

```bash
node --input-type=module -e "
import { loadEnv, fetchWithRetry } from './scripts/collectors/_shared.mjs';
loadEnv();
const params = new URLSearchParams({
  method: 'getList', apiKey: process.env.KOSIS_KEY,
  orgId: '<ORG>', tblId: '<TBL>',
  itmId: 'ALL', objL1: 'ALL', objL2: 'ALL', objL3: 'ALL',
  prdSe: '<A|M|Q>', startPrdDe: '<YYYY>', endPrdDe: '<YYYY>',
  format: 'json', jsonVD: 'Y',
});
const res = await fetchWithRetry('https://kosis.kr/openapi/Param/statisticsParameterData.do?' + params);
const data = await res.json();
console.log('rows:', data.length);
const c1 = new Set(), c2 = new Set(), itm = new Set();
for (const r of data) { if (r.C1_NM) c1.add(r.C1_NM); if (r.C2_NM) c2.add(r.C2_NM); if (r.ITM_NM) itm.add(r.ITM_NM); }
console.log('C1_NM:', [...c1]);
console.log('C2_NM:', [...c2]);
console.log('ITM_NM:', [...itm]);
"
```

### 2. C1_NM 값 종류 = 차원 분리 vs 교차 판정 근거

| 판정 | C1_NM sample |
|---|---|
| **분리 group** | `"시도별미분양현황"` / `"부문별미분양현황"` / `"규모별미분양현황"` (group 메타 행) |
| **교차 cells** | `"서울"` / `"부산"` / ... (각 row = 시도 직접 값) |

분리 group 형태 = 차원 간 교차 활용 불가. 박제값 설계 시 한 group 만 단일 차원 적재 의무.

### 3. KOSIS Playwright SSO 진입 메타 검증 = 보조 수단

세션 235 Playwright 자동화 박제 = 활용신청 단위 (1키/모든 통계표) 확정에 유용. 그러나 통계표 차원 형태 단정 근거 사용 금지. **raw API 응답이 단정 근거**.

## 안티 패턴 (사고 답습)

- ❌ "통계표 3 차원 존재 = 시도 × 부문 교차 cell 활용 가능" — 분리 group 형태 확인 의무
- ❌ "KOSIS 검색 페이지 (kosis.kr/statHtml/...) Playwright 메타 검증 = 차원 단정 근거 충분" — raw API objL1+objL2 ALL 응답 박제 의무
- ❌ "plan v1 박제값 (NEXT_SESSION/BACKLOG) = 진실의 원천" — 메모리 룰 §"메모리는 진실의 원천 아님" 답습. raw sample 실측 1회 의무
- ❌ "frontend 박제 (UnsoldChart placeholder 등) = 작업 의도 단정" — 본 사고 정정 사례 = secondaryData 작동 중 + DT_MLTM_2082 미제공으로 NULL 채움 대기 (placeholder 환각)

> 답습 자산·차단 검증 이력 → [rules-history/collectors/kosis-dimension-mismatch-guard.md](../../rules-history/collectors/kosis-dimension-mismatch-guard.md)
