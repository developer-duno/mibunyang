# KOSIS 통계표 차원 검증 — raw API sample 박제 의무

## 사고 박제 (세션 249)

NEXT_SESSION + BACKLOG L141 가 "DT_MLTM_2086 시군구별 준공후 미분양 → `regions.unsold_after_completion` JSON 신규 또는 `apartments.unsoldAfterCompletion`, 큰 작업 2~3 세션" 박제. 세션 235 Playwright 박제 (SESSION_LOG L1122: "시도별 분리 불가") 도 있었으나 BACKLOG/NEXT_SESSION 동기화 0 → 세션 249 진입 plan v1 환각 위험.

세션 249 옵션 B 진입 의지 시 0단계 KOSIS API raw sample 호출 (`objL1=ALL objL2=ALL prdSe=A startPrdDe=2023 endPrdDe=2024`) → 58 rows 응답 박제:

```
C1_NM distinct (3 group 분리):
  - 시도별미분양현황 (40 rows: 17 시도 + 전국/수도권/지방 = 20종 × 2년) → ITM_NM 단일 '미분양(12월기준)' 총량만
  - 부문별미분양현황 (8 rows: 계/민간부문/공공부문/(준공후) × 2년) → 전국 단일값
  - 규모별미분양현황 (10 rows: 5 규모 × 2년) → 전국 단일값

(준공후) raw row: { C1_NM: "부문별미분양현황", C2_NM: "(준공후)", C1: "13102871014A.0001" (= 전국 단일 코드), DT: "10857" }
```

→ 차원 = **3 group 분리 (한 차원만 활용)**. 시도별 × 부문별 교차 cell **부재 확정**. mibunyang 단지·시군구 단위 본질 unmatched.

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

## 답습 자산

- 세션 235 Playwright 9 단계 자동화 박제 (SESSION_LOG L1110~1116) — KOSIS 인증 진입 보조 수단
- 세션 236 W2 박제 (SESSION_LOG L1135) — `national_unsold_history` 신규 테이블 가능성 (옵션 A 진입 시)
- 세션 237 W1 `collect-housing-supply-ratio.mjs` (DT_MLTM_2100) 답습 패턴 — KOSIS 시도 17행 UPDATE 가능 통계표 (교차 cell 형태)
- 세션 249 본 사고 박제 (NEXT_SESSION L38 + BACKLOG L141 + 본 룰 신규)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 통계표 박제값 "3 차원 존재" 단정 후 시도 × 부문 교차 collector 작성 | §1 raw sample 박제 의무 발동 → C1_NM 분리 group 발견 → 교차 가설 정정 |
| KOSIS Playwright 메타 검증만 보고 시군구 단위 단정 | §3 보조 수단 명시 → raw API 단정 근거 의무 |
| BACKLOG/NEXT_SESSION 박제값 무검증 답습 | §1 raw sample 30+ 행 박제 의무 → 박제값 stale 발견 + 정정 1 커밋 |
