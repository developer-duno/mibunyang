# KOSIS 의료 인프라 묶음 수집기 설계

> 작성: 2026-05-18 · BACKLOG 📦 KOSIS #11·#12 · 9-GATE 검증 🟢7/🟡2/🔴0 실행 허가

## Context

미분양 아파트 비교 엔진의 `regions` 테이블은 시군구 단위 외부 통계를 누적한다.
BACKLOG 📦 KOSIS 보강 항목 중 #11 인구 천명당 의사수, #12 인구 천명당 병상수가
잔여. 두 지표는 시군구 의료 접근성 시그널 — 84A 평형 수요층(영유아·고령) 판단에
보조 데이터다.

세션 266 합계출산율 collector(`collect-fertility-rate.mjs`)와 raw API 실측 결과
**통계표 구조가 동일**(1차원, C1 코드 2자리 집계행 + 5자리 시군구)하여 답습 비용이
낮다. 따라서 두 통계표를 묶음 collector 1개로 처리한다.

#7·#8(연령/가구)은 차원이 복잡(objL3 필수)해 별도 세션으로 분리 — 이 작업 범위 밖.

## raw API 실측 (kosis-dimension-mismatch-guard §1 충족)

기존 `KOSIS_KEY`로 직접 호출 (2026-05-18):

| 통계표 | rows | 구조 | 천명당 ITM_ID |
|---|---|---|---|
| `DT_1YL20981` 의사수 | 2214 (3년) | 1차원, C1 2자리(전국/시도) + 5자리(시군구) | `T10` |
| `DT_1YL20971` 병상수 | 2198 (3년) | 동일 | `T10` |

- 호출 파라미터: `orgId=101`, `itmId=T10`, `objL1=ALL`, `prdSe=A`, 최근 3년.
  ⚠️ `objL2`를 주면 KOSIS 에러 21 — 1차원 통계표라 `objL1`만.
- ITM 3종: `T001` 분자(의사수/병상수) / `T002` 분모(주민등록인구) /
  `T10` 천명당 지표. **`T10`만 API 단계에서 필터** → 응답 1/3 축소.
- C1_NM = 시군구명 직접("종로구"/"중구"). 동명 시군구는 C1 앞 2자리 시도코드로 구분.
- 매칭 실측: KOSIS 시군구 고유 228개 → `regions` region::gu **고유 조합 227개 매칭**,
  unmatched = `전북::전주시` 1개(KOSIS 통합시 vs regions 완산/덕진 분리 — 정상 한계).
  ⚠️ `regions` 테이블은 gu 있는 행이 **694개**(고유 조합 302개, 단지 매핑상 중복).
  collector 는 694행 전부 순회 UPDATE → **실제 채워질 행 수는 600행대**
  (합계출산율 collector 실적 620행과 동급). "227"은 고유 조합 수일 뿐 행 수 아님.

## 아키텍처 — 묶음 collector 1개

`scripts/collectors/collect-medical-access.mjs` 신규. `collect-fertility-rate.mjs`
직접 답습:

- `KOSIS_SIDO` 상수 (C1 앞 2자리 → region, 17개) — 그대로 복사
- `parseKosisRows` (C1 2자리 집계행 skip / 5자리 시군구 매칭 / 최신 연도 채택)
  — 통계표 2개를 받아 `{ doctors: {...}, beds: {...} }` 2개 맵 반환하도록 확장
- isCLI 패턴, `recordApiQuota`/`recordCollectorRun` — 그대로
- 통계표별 호출 루프 2회 (`DT_1YL20981` → doctors, `DT_1YL20971` → beds)

## DB 스키마

`regions` 2컬럼 신규 (REAL — `fertility_rate` 동일 타입):

```sql
ALTER TABLE regions ADD COLUMN IF NOT EXISTS doctors_per_1k REAL;
ALTER TABLE regions ADD COLUMN IF NOT EXISTS hospital_beds_per_1k REAL;
```

마이그 파일 2개(메인 + `_down`) — `20260517233819_add_regions_fertility_rate.sql`
형식 답습. **Dashboard SQL Editor에서 사용자 직접 적용**
(workflow-name-hallucination 룰 — 워크플로 자동 적용 금지, Dashboard 수동이 표준).

## 데이터 흐름

```
KOSIS DT_1YL20981 (itmId=T10) ─→ parseKosisRows ─→ { "서울::종로구": 3.2, ... } doctors
KOSIS DT_1YL20971 (itmId=T10) ─→ parseKosisRows ─→ { "서울::종로구": 13.8, ... } beds
                                                  ↓
                          regions UPDATE (gu 있는 행, region::gu 키 매칭)
                          doctors_per_1k + hospital_beds_per_1k 동시 set
```

값 범위 가드: `isFinite && value > 0` (출산율 0~5 상한과 달리 병상수는 클 수 있어
상한 느슨). 변경 없는 행은 skip (`Math.abs(기존-신규) < 0.05`).

## 에러 처리

`collect-fertility-rate.mjs` 답습: KOSIS `data.err` 체크 → throw, 통계표 1개
응답 0건/매칭 0건 → 해당 지표 skip(다른 지표는 계속), `regions` 조회 실패 → 종료,
unmatched 시군구 → `logError` 기록하되 중단 안 함. 외부 API 장애 fallback = 다음 cron.

## 단계 구성 (구현 plan 입력)

| 단계 | 파일 | 관심사 | 커밋 |
|---|---|---|---|
| 1 | 마이그 up/down 2개 (신규) | DB 스키마 | 1 |
| 2 | `collect-medical-access.mjs` + `.test.mjs` + `.yml` (신규 3) | collector | 1 |
| 3 | `data-fill.mjs` + `monitor-collectors.mjs` + `monitor-collectors.yml` (수정 3) | 등록·감사 | 1 |

- 단계 1 후 사용자가 Dashboard 적용 → 단계 2 운영 실행 가능(PG 42703 회피).
- ⚠️ **`data-audit.mjs` 는 수정 대상 아님** — 9-GATE 재검증에서 거짓 전제 발견:
  `data-audit` 는 `apartments` 테이블 기준 감사기로, `regions` 는 보조 join
  (L431 select 4컬럼만, L483~492 `region` 키로 시도 레벨 join, `gu` 무시).
  의사수·병상수는 **시군구 단위**라 data-audit 의 시도 join 에 끼우면 데이터가
  뭉개짐. `fertility_rate`·`housing_supply_level` 이 data-audit 미등재인 것도
  같은 이유 — `regions` 테이블 컬럼은 data-audit 감사 대상이 아님.
- 단계 3 `monitor-collectors.mjs`: ④ NULL 점검의 `regions` 핵심 컬럼 감시처에 등재.
  `data-audit` 와 완전 분리된, `regions` 테이블 직접 `count` 쿼리 방식 — 시군구 컬럼에
  정확히 맞음. **2곳 수정**:
  1. `REGION_KEY_COLUMNS` 배열 (현재 `["net_migration", "crime_grade"]`) 에
     `doctors_per_1k`, `hospital_beds_per_1k` 추가
  2. `KO_CATEGORY` 라벨 객체 (`net_migration: "순이동인구"` 옆) 에 한글 라벨 2개 추가
  - ⚠️ `monitor-collectors.test.mjs` 가 `REGION_KEY_COLUMNS` 를 검사할 수 있음
    (세션 264 키 정합성 테스트 박제) → 구현 중 vitest 로 확인 후 동시 정정.
- `data-fill.test.mjs`: 실측 확정 — scripts 배열은 `toEqual` 검사 대상 아님(phase/envKeys만),
  `KOSIS_KEY`도 이미 등재됨 → **변경 불필요**.

## 테스트

`collect-medical-access.test.mjs` — `parseKosisRows` 단위 테스트:
집계행 skip / 동명 시군구 시도코드 구분 / `T10` 외 ITM skip / 통계표 2개 독립 파싱 /
최신 연도 채택 / 값 범위 가드. 합계출산율 14케이스 답습 → 12~16케이스.

회귀 가드: `npx vitest run collect-medical-access.test.mjs monitor-collectors.test.mjs
--no-cache` + `npm run typecheck:scripts` + `node scripts/audit-env-keys.mjs`.
(`data-audit.test.mjs` 는 data-audit 미수정으로 회귀 대상 아님.)

## 워크플로

`collect-medical-access.yml` — 매월 13일 cron(미사용 일자, 실측 확정 — 11일은
`collect-building-info.yml` `0 16 11` ~8,500 API 호출과 충돌, 빈 일자 13·14·17~28) +
`Validate secrets`(`KOSIS_KEY`/`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`) +
`concurrency: data-collection` + `workflow_dispatch`(dry_run). `monitor-collectors.yml`
workflows 배열에 name 등재(세션 265·266 답습).

## 명시적 비-작업 (YAGNI)

- #7·#8 (연령/가구) — objL3 차원, 별도 세션
- 스코어링 통합 — `regions` 적재만. 가중치 의사결정 별도(BACKLOG 🟢 선례)
- `apartments_flat` VIEW 노출 — 프론트 사용 시점(`housing_supply_level` 선례)
- 프론트·API 변경 0 — 백엔드 collector 작업

## 검증 (end-to-end)

1. 단계 1: 마이그 작성 → 사용자 Dashboard 적용 → DB `\d regions`로 2컬럼 확인
2. 단계 2: `collect-medical-access.mjs --dry-run` → 600행대 UPDATE 대상 /
   unmatched `전북::전주시` 1개 확인 → 운영 실행
3. 단계 3 후: `regions` 2컬럼 NULL 아닌 행 수 ≈ 600행대 확인
   (합계출산율 collector 실적 620행 동급 — "227"은 고유 조합 수)
   ```bash
   node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();for(const c of ['doctors_per_1k','hospital_beds_per_1k']){const {count}=await sb.from('regions').select(c,{count:'exact',head:true}).not(c,'is',null);console.log(c,count);}"
   ```
4. CI: push 후 typecheck/vitest/audit-env-keys 통과
