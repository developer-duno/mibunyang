# KOSIS 매매가격지수 collector 설계

> 작성: 2026-05-18 (세션 269). BACKLOG 📦 KOSIS #1 항목.

## 배경

BACKLOG 📦 섹션 KOSIS #1 — "아파트 매매가격지수(시군구)"를 수집해 분양가
대비 시장가 갭 산출 기반을 마련한다. 현재 mibunyang 은 분양가지수
(`collect-market-stats.mjs`, HUG `DT_41401N_006`)만 보유 — 실거래 시장가
지표가 없다.

### 실측으로 정정된 박제값 (BACKLOG stale 2건)

BACKLOG 박제값을 KOSIS_KEY raw API 호출로 검증한 결과:

1. **`regions.market_stats` JSONB 는 존재하지 않음.** `regions` 는 직접
   컬럼만 사용(`price_index`, `avg_price_sqm` 등). 박제의 저장 위치
   `market_stats.priceIndexSale` 은 틀림.
2. **`price_index`(분양가지수)는 스코어링에 직접 사용 중.** `scorePrice.ts`
   에서 신뢰도 +5/+3점 보정. 박제의 "단순 표시용" 은 오해.

### 통계표 실측 (raw API 박제)

`DT_KAB_11672_S5` 를 `KOSIS_KEY` 로 직접 호출(`objL1=ALL prdSe=Q`):

- **통계표명**: "아파트 매매 실거래가격지수_시군구_분기별" (기준 2017.4Q=100)
- **제공기관**: 한국부동산원 (`orgId=408`)
- **주기**: 분기 (`prdSe=Q`). 응답 `PRD_DE` = 5자리 `YYYYQ` (예: `20251`)
- **차원**: 1차원 (`objL1` 행정구역별). `ITM_NM` = `지수` 단일
- **범위**: 시군구 117개, **수도권+광역시 8개 시도만 제공**
  (서울·부산·대구·인천·광주·대전·울산·경기). 강원·충청·전라·경상·
  제주·세종은 시군구 매매 실거래가격지수 없음
- **C1 코드** = `SSNNN` 형태. 앞 2자리가 시도 순번:
  `10`=서울(25) `20`=부산(14) `30`=대구(8) `40`=인천(8)
  `50`=광주(5) `60`=대전(5) `70`=울산(5) `80`=경기(47) → 합 117
- C1_NM 은 동명 시군구 다수(`중구` 등) → C1_NM 단독으로 시도 판정 불가,
  C1 코드 prefix 필수

## 저장 위치 결정 — `market_stats_history` 컬럼 추가

3개 후보 중 `market_stats_history` 에 컬럼 1개 추가를 채택.

| 후보 | 평가 |
|---|---|
| **A (채택)** `market_stats_history.sale_price_index` 컬럼 추가 | 분기 시계열용으로 이미 설계된 테이블 (`region`+`gu`+`base_month` UNIQUE). 117 시군구 무손실. 기존 `collect-market-stats` 와 일관 |
| B `regions` 시군구 행 UPDATE | `regions` 시군구 행이 `recorded_at` 날짜별 시계열 + 일반구 표기 혼재(수원시 vs 수원팔달구) → unmatched 다수. "단단한 DB" 와 반대 |
| C 신규 테이블 `sale_price_index_history` | 분기 시계열 테이블이 이미 있는데 중복 신설 — YAGNI 위반 |

### cross-repo 안전 검증 (3중)

`market_stats_history` 는 **mibunyang 전용 테이블** — 확인 완료:

1. `supabase/CLAUDE.md` 소유권 표 — 공용 테이블은 `complexes`/`articles`/
   `complex_price_history`/`trades` 4개뿐. `market_stats_history` 없음
2. mibunyang 사용처 — 수집기·API·타입 정의 전부 mibunyang 내부
3. naver-estate-web grep — `market_stats_history` 사용처 0건

→ 컬럼 추가가 다른 프로젝트에 영향 없음. 단 같은 DB 인스턴스
(`rwdtljipvmqpazrimyns`) 공유이므로 마이그 본문 출처 주석 + Dashboard
SQL Editor 수동 적용 절차는 유지.

## 데이터 흐름

```text
KOSIS API (DT_KAB_11672_S5, orgId=408, prdSe=Q)
  → collect-sale-price-index.mjs
      ├─ parseKabRows()  : C1 prefix → 시도 판정, 117 시군구 × 분기
      └─ upsert          : market_stats_history
                           (region, gu, base_month, sale_price_index)
  → GitHub Actions (분기 cron) + data-fill.mjs 오케스트레이션
```

`collect-fertility-rate.mjs`(세션 266) 답습. 차이 2가지:

- **시도 판정**: fertility-rate 는 법정동코드 앞 2자리(`KOSIS_SIDO`).
  이번엔 부동산원 자체 코드 앞 2자리 → 새 상수 `KAB_SIDO_PREFIX`
- **저장**: fertility-rate 는 `regions` UPDATE. 이번엔
  `market_stats_history` upsert (collect-market-stats 패턴)

## 컴포넌트

### `scripts/collectors/collect-sale-price-index.mjs`

| 함수 | 역할 |
|---|---|
| `parseKabRows(rows)` | KOSIS 응답 파싱. C1 앞 2자리 → `KAB_SIDO_PREFIX` 시도 판정, `base_month` = `PRD_DE` 5자리 그대로, 지수값 범위 검증(`0 < DT`). 반환 `{ matched: [{region, gu, base_month, sale_price_index}], unmatched, skipped }` |
| `main()` | API 호출(최근 8분기) → `parseKabRows` → `market_stats_history` upsert(`onConflict: "region,gu,base_month"`) → `recordApiQuota`/`recordCollectorRun` → dry-run 가드 |

- **환경변수**: `KOSIS_KEY` (기존 공용 키 — fertility-rate·market-stats 동일)
- **새 상수** (파일 내 정의):

  ```js
  const KAB_SIDO_PREFIX = {
    "10": "서울", "20": "부산", "30": "대구", "40": "인천",
    "50": "광주", "60": "대전", "70": "울산", "80": "경기",
  };
  ```

- **upsert 대상 컬럼**: `region`/`gu`/`base_month`/`sale_price_index` 4개만.
  기존 `price_index`(분양가지수) 등 다른 컬럼 미변경 (upsert 시 해당 키만 전달)

### 마이그레이션

```sql
-- mibunyang 전용 (supabase/CLAUDE.md 소유권 표 확인, naver-estate-web grep 0건)
-- 출처: KOSIS DT_KAB_11672_S5 "아파트 매매 실거래가격지수_시군구_분기별"
--       (한국부동산원, orgId=408)
-- 기존 price_index 는 분양가지수(HUG, collect-market-stats) — 출처 다름, 혼동 금지
ALTER TABLE market_stats_history
  ADD COLUMN IF NOT EXISTS sale_price_index REAL;
```

- `src/types/database.types.ts` 의 `market_stats_history` 타입에
  `sale_price_index` 추가
- 적용: Dashboard SQL Editor 수동 실행 (apply-migration.yml 폐기됨 —
  `workflow-name-hallucination.md` 룰)

### 워크플로 + 오케스트레이션

- **`.github/workflows/collect-sale-price-index.yml`** — `collect-fertility-rate.yml`
  답습. 분기 cron (부동산원 분기 지수 공표 주기 고려 — 분기 첫 달 중순).
  `Validate secrets` step 에 `KOSIS_KEY` 포함. workflow_dispatch dry-run 옵션
- **`scripts/collectors/data-fill.mjs`** — `regions` 카테고리 `scripts` 배열에
  `collect-sale-price-index.mjs` 추가. `envKeys` 의 `KOSIS_KEY` 유지(이미 존재)
- **`scripts/audit-env-keys.mjs`** — 3-way 동기화 자동 검증 대상에 자연 편입

## 테스트

### `scripts/collectors/collect-sale-price-index.test.mjs`

`parseKabRows` 단독 테스트. `collect-fertility-rate.test.mjs` 답습.
핵심 케이스:

- C1 prefix별 시도 판정 (`10`→서울, `80`→경기)
- 동명 시군구 구분 (서울 `중구` vs 부산 `중구` — 코드 prefix 로 분리)
- 지수값 이상치 가드 (`DT <= 0` / 비숫자 제외)
- `base_month` 분기 형식 (`YYYYQ` 5자리)
- 8개 시도 외 C1 코드 → skip (에러 아님)

## 에러 처리

- KOSIS 에러 응답(`err`/`errMsg`) → `recordCollectorRun` 실패 기록 후 exit 1
- 8개 시도 외 C1 코드 → skip (통계표가 원래 8개 시도만 제공 — 정상)
- dry-run → `recordApiQuota`/`recordCollectorRun` 기록 skip
  (`_shared.mjs` argv 가드 자동 적용 — 세션 268 fix)

## 검증

- 회귀: `npx vitest run --no-cache` + `npm run typecheck` +
  `node scripts/audit-env-keys.mjs`
- dry-run 실측: `node scripts/collectors/collect-sale-price-index.mjs --dry-run`
  → matched 117 / unmatched 0 기대
- 운영 적재: 마이그 적용 후 비-dry 1회 실행 → `market_stats_history` 의
  `sale_price_index` non-null 행 117 × 분기수 확인

## 명시적 비-작업 (YAGNI)

- 매매가격지수의 **스코어링 반영** — 별도 의사결정(가중치) 필요. 후속 세션.
  분양가지수는 `scorePrice.ts` 신뢰도 보정에 쓰이지만 매매가격지수 활용은
  이번 범위 밖
- **프론트 표시** (분양가 vs 시장가 갭 차트) — 데이터 적재가 선행
- `regions` 테이블 — 미변경
- `collect-market-stats.mjs` 의 기존 분기 처리(`initial_sale_rate`) — 미변경
