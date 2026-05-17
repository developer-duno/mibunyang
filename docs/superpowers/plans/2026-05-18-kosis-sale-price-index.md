# KOSIS 매매가격지수 collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) 또는 superpowers:executing-plans. 체크박스(`- [ ]`) 추적.

**Goal:** KOSIS 한국부동산원 `DT_KAB_11672_S5`(아파트 매매 실거래가격지수_시군구_분기별)를 수집해 `market_stats_history.sale_price_index` 컬럼에 117개 시군구 × 분기 시계열로 적재하는 collector 를 신설한다.

**Architecture:** `collect-fertility-rate.mjs`(세션 266) 답습. KOSIS API 1회 호출 → `parseKabRows()` 가 C1 코드 앞 2자리로 시도 판정 → `upsertBatch` 로 `market_stats_history` 시계열 upsert. dry-run 가드·`recordApiQuota`/`recordCollectorRun` 패턴 동일.

**Tech Stack:** Node.js ESM `.mjs`, `// @ts-check` JSDoc, Vitest, GitHub Actions.

설계 문서: `docs/superpowers/specs/2026-05-18-kosis-sale-price-index-design.md`

---

## 배경 — 통계표 실측 (raw API 박제, 2026-05-18)

`DT_KAB_11672_S5` 를 `KOSIS_KEY` 로 직접 호출(`objL1=ALL prdSe=Q`):

- **응답**: 시군구 117개. **집계행(전국/시도) 없음** — `DT_1B81A17`(fertility-rate)
  과 다름. 전부 시군구 행
- **C1 코드** = `SSNNN` 5자리. 앞 2자리가 부동산원 자체 시도 순번:
  `10`=서울(25) `20`=부산(14) `30`=대구(8) `40`=인천(8)
  `50`=광주(5) `60`=대전(5) `70`=울산(5) `80`=경기(47) → 합 117
  (수도권+광역시 8개 시도만 제공. 강원·충청·전라·경상·제주·세종 없음)
- **PRD_DE** = 분기 5자리 `YYYYQ` (예: `20251` = 2025년 1분기, `20244` = 2024년 4분기)
- **ITM_NM** = `지수` 단일. **UNIT_NM** = `2017.4Q＝100`
- raw 샘플 1행:
  `{ C1:"10001", C1_NM:"종로구", PRD_DE:"202501", ITM_NM:"지수", DT:"157.96..." }`
  (응답 PRD_DE 는 `202501` 6자리로 올 수 있음 — `prdSe=Q` 응답 형식은
  `collect-market-stats.mjs` 답습대로 정규식 `/^\d{5,6}$/` 로 5·6자리 모두 허용)

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `scripts/collectors/collect-sale-price-index.mjs` | KOSIS 호출 + parseKabRows + market_stats_history upsert | 신규 ~150줄 |
| `scripts/collectors/collect-sale-price-index.test.mjs` | parseKabRows 단독 테스트 | 신규 ~120줄 |
| `.github/workflows/collect-sale-price-index.yml` | 분기 cron 워크플로 | 신규 ~57줄 |
| `scripts/collectors/data-fill.mjs` | regions 카테고리 scripts 배열 등재 | 수정 1줄 |
| `.github/workflows/monitor-collectors.yml` | workflow_run workflows 목록 추가 | 수정 1줄 |
| `src/types/database.types.ts` | market_stats_history 타입에 sale_price_index | 수정 ~3줄 |
| `supabase/migrations/20260518000000_add_sale_price_index.sql` | ALTER TABLE ADD COLUMN | 신규 ~6줄 |

---

## Task 1: 마이그레이션 SQL 작성

**Files:**

- Create: `supabase/migrations/20260518000000_add_sale_price_index.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

`supabase/migrations/20260518000000_add_sale_price_index.sql` 신규 작성:

```sql
-- market_stats_history 에 매매 실거래가격지수 컬럼 추가
-- mibunyang 전용 테이블 (supabase/CLAUDE.md 소유권 표 확인, naver-estate-web grep 0건)
-- 출처: KOSIS DT_KAB_11672_S5 "아파트 매매 실거래가격지수_시군구_분기별"
--       (한국부동산원, orgId=408, 기준 2017.4Q=100)
-- 주의: 기존 price_index 는 분양가지수(HUG DT_41401N_006, collect-market-stats)
--       — 출처·의미 다름, 혼동 금지
ALTER TABLE market_stats_history
  ADD COLUMN IF NOT EXISTS sale_price_index REAL;
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260518000000_add_sale_price_index.sql
git commit -m "feat(db): market_stats_history 에 sale_price_index 컬럼 (KOSIS 매매가격지수)"
```

> ⚠️ 이 SQL 의 **실제 적용은 사용자가 Supabase Dashboard SQL Editor 에서 수동 실행**
> (`apply-migration.yml` 폐기 — `.claude/rules/workflow-name-hallucination.md`).
> Task 6 dry-run 검증은 컬럼 적용 전에도 가능(upsert 미실행). 운영 적재(Task 7)는
> 컬럼 적용 후.

---

## Task 2: parseKabRows 테스트 작성 (TDD — 실패 먼저)

**Files:**

- Create: `scripts/collectors/collect-sale-price-index.test.mjs`

- [ ] **Step 1: 테스트 파일 작성**

`scripts/collectors/collect-sale-price-index.test.mjs` 신규 작성.
`collect-fertility-rate.test.mjs` 구조 답습:

```javascript
// @ts-check
/**
 * collect-sale-price-index.mjs 테스트 — KOSIS DT_KAB_11672_S5 매매가격지수 파싱 검증
 *
 * 대상: parseKabRows
 * 환각 차단: C1 코드 앞 2자리(부동산원 자체 시도 순번) 판정, 동명 시군구 구분,
 *           8개 시도 외 코드 skip, 분기 base_month 형식
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    upsertBatch: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

const { parseKabRows } = await import("./collect-sale-price-index.mjs");

/**
 * @param {string} c1     C1 코드 (SSNNN 5자리)
 * @param {string} c1Nm   C1_NM (시군구명)
 * @param {string} prd    PRD_DE (분기 YYYYQ 또는 YYYYMM)
 * @param {string|number} value  DT
 * @param {string} [itm]  ITM_NM
 */
function makeRow(c1, c1Nm, prd, value, itm = "지수") {
  return { C1: c1, C1_NM: c1Nm, ITM_NM: itm, PRD_DE: prd, DT: String(value) };
}

describe("parseKabRows (DT_KAB_11672_S5 매매가격지수)", () => {
  it("빈 배열 → matched 빈 배열", () => {
    expect(parseKabRows([])).toEqual({ matched: [], unmatched: [], skipped: 0 });
  });

  it("정상 시군구 행 → region/gu/base_month/sale_price_index 추출", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "20251", 157.97)]);
    expect(result.matched).toEqual([
      { region: "서울", gu: "종로구", base_month: "20251", sale_price_index: 157.97 },
    ]);
  });

  it("C1 앞 2자리로 시도 판정 (10→서울, 80→경기)", () => {
    const result = parseKabRows([
      makeRow("10001", "종로구", "20251", 157.97),
      makeRow("80001", "수원시", "20251", 120.5),
    ]);
    expect(result.matched).toContainEqual(
      { region: "서울", gu: "종로구", base_month: "20251", sale_price_index: 157.97 },
    );
    expect(result.matched).toContainEqual(
      { region: "경기", gu: "수원시", base_month: "20251", sale_price_index: 120.5 },
    );
  });

  it("동명 시군구 — C1 앞 2자리로 구분 (서울 중구 ≠ 부산 중구)", () => {
    const result = parseKabRows([
      makeRow("10002", "중구", "20251", 150.1),
      makeRow("20001", "서구", "20251", 95.3),
      makeRow("20002", "중구", "20251", 88.7),
    ]);
    const seoul = result.matched.find((m) => m.region === "서울" && m.gu === "중구");
    const busan = result.matched.find((m) => m.region === "부산" && m.gu === "중구");
    expect(seoul?.sale_price_index).toBe(150.1);
    expect(busan?.sale_price_index).toBe(88.7);
  });

  it("8개 시도 외 C1 prefix (90xxx) → skipped 증가, matched 미포함", () => {
    const result = parseKabRows([
      makeRow("90001", "가상시", "20251", 100),
      makeRow("10001", "종로구", "20251", 157.97),
    ]);
    expect(result.skipped).toBe(1);
    expect(result.matched).toHaveLength(1);
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "20251", "abc")]);
    expect(result.matched).toEqual([]);
  });

  it("DT<=0 (이상치 가드) → 무시", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "20251", 0)]);
    expect(result.matched).toEqual([]);
  });

  it("PRD_DE 6자리(YYYYMM) 분기 응답도 허용", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "202501", 157.97)]);
    expect(result.matched[0]?.base_month).toBe("202501");
  });

  it("PRD_DE 비정상 포맷(7자리) → 무시", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "2025Q01", 157.97)]);
    expect(result.matched).toEqual([]);
  });

  it("C1 길이 비정상(3·4자리) → 무시", () => {
    const result = parseKabRows([
      makeRow("100", "이상", "20251", 100),
      makeRow("1001", "이상", "20251", 100),
    ]);
    expect(result.matched).toEqual([]);
  });

  it("같은 시군구 여러 분기 → 모두 보존 (시계열)", () => {
    const result = parseKabRows([
      makeRow("10001", "종로구", "20244", 155.0),
      makeRow("10001", "종로구", "20251", 157.97),
    ]);
    expect(result.matched).toHaveLength(2);
  });

  it("ITM_NM '지수' 외 → 무시", () => {
    const result = parseKabRows([
      makeRow("10001", "종로구", "20251", 157.97, "변동률"),
    ]);
    expect(result.matched).toEqual([]);
  });

  it("8개 시도 동시 처리 — prefix별 region 매핑", () => {
    const sido = [
      ["10", "서울"], ["20", "부산"], ["30", "대구"], ["40", "인천"],
      ["50", "광주"], ["60", "대전"], ["70", "울산"], ["80", "경기"],
    ];
    const rows = sido.map(([px, region], i) =>
      makeRow(`${px}001`, `${region}구`, "20251", 100 + i),
    );
    const result = parseKabRows(rows);
    expect(result.matched).toHaveLength(8);
    expect(result.matched.find((m) => m.region === "서울")?.sale_price_index).toBe(100);
    expect(result.matched.find((m) => m.region === "경기")?.sale_price_index).toBe(107);
    expect(result.unmatched).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run scripts/collectors/collect-sale-price-index.test.mjs --no-cache`
Expected: FAIL — `collect-sale-price-index.mjs` 파일이 없어 import 단계에서 실패.
> `Cannot read properties of undefined (reading 'config')` → `--no-cache` 누락, 재실행.

- [ ] **Step 3: 커밋**

```bash
git add scripts/collectors/collect-sale-price-index.test.mjs
git commit -m "test(collector): collect-sale-price-index parseKabRows 테스트 13건"
```

---

## Task 3: collect-sale-price-index.mjs 구현

**Files:**

- Create: `scripts/collectors/collect-sale-price-index.mjs`

- [ ] **Step 1: collector 파일 작성**

`scripts/collectors/collect-sale-price-index.mjs` 신규 작성.
`collect-fertility-rate.mjs` 답습 + `market_stats_history` upsert 는
`collect-market-stats.mjs` 의 `upsertBatch` 패턴:

```javascript
// @ts-check
/**
 * KOSIS 매매가격지수 수집기 (BACKLOG KOSIS #1, 세션 269)
 *
 * KOSIS 국가통계포털 DT_KAB_11672_S5 (아파트 매매 실거래가격지수_시군구_분기별,
 * 한국부동산원 orgId=408) 통계표에서 시군구별 분기 매매가격지수(기준 2017.4Q=100)를
 * 수집하여 market_stats_history.sale_price_index 에 시계열 upsert.
 *
 * - prdSe = 'Q' (분기). 응답 PRD_DE 는 5자리(YYYYQ) 또는 6자리(YYYYMM).
 * - 1차원 통계표 — objL1 만 사용. objL2 주면 KOSIS 에러 21.
 * - C1 코드 체계: SSNNN 5자리. 앞 2자리 = 부동산원 자체 시도 순번
 *   (법정동코드·KOSIS_SIDO 와 다른 체계 — KAB_SIDO_PREFIX 상수).
 * - 수도권+광역시 8개 시도(117 시군구)만 제공. 집계행(전국/시도) 없음.
 * - 동명 시군구("중구" 등) 는 C1 앞 2자리로 구분.
 *
 * 주의: market_stats_history.price_index 는 분양가지수(HUG, collect-market-stats)
 *       — 본 수집기는 sale_price_index 만 건드림.
 *
 * 사용법:
 *   node scripts/collectors/collect-sale-price-index.mjs              (Supabase upsert)
 *   node scripts/collectors/collect-sale-price-index.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ C1: string; C1_NM: string; ITM_NM?: string; PRD_DE: string; DT: string }} KabRow */
/** @typedef {{ region: string; gu: string; base_month: string; sale_price_index: number }} MatchedRow */
/** @typedef {{ matched: MatchedRow[]; unmatched: string[]; skipped: number }} ParseResult */

loadEnv();

const PHASE = "kosis-sale-price-index";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS DT_KAB_11672_S5 의 C1 코드 앞 2자리 → regions.region.
 * 부동산원 자체 시도 순번 — 법정동코드·KOSIS_SIDO 와 다른 체계, 재사용 금지.
 * 값 출처: DT_KAB_11672_S5 raw API 117 시군구 실측 (2026-05-18).
 * 이 통계표는 수도권+광역시 8개 시도만 제공.
 */
const KAB_SIDO_PREFIX = {
  "10": "서울", "20": "부산", "30": "대구", "40": "인천",
  "50": "광주", "60": "대전", "70": "울산", "80": "경기",
};

/**
 * KOSIS DT_KAB_11672_S5 행 → market_stats_history upsert 용 MatchedRow 배열.
 * - C1 길이 5 아닌 행 → 무시
 * - C1 앞 2자리가 KAB_SIDO_PREFIX 에 없으면 → skipped 증가
 * - 같은 시군구 여러 분기 → 전부 보존 (시계열)
 * @param {KabRow[]} rows
 * @returns {ParseResult}
 */
export function parseKabRows(rows) {
  /** @type {MatchedRow[]} */
  const matched = [];
  /** @type {Set<string>} */
  const unmatchedSet = new Set();
  let skipped = 0;

  for (const row of rows) {
    // 방어: itmId 미지정 호출이라 '지수' 외 ITM 이 섞이면 skip
    if (row.ITM_NM && row.ITM_NM !== "지수") continue;

    const code = String(row.C1 ?? "");
    if (code.length !== 5) continue;

    const period = String(row.PRD_DE ?? "");
    // 분기 응답: 5자리(YYYYQ) 또는 6자리(YYYYMM) 허용 — collect-market-stats 답습
    if (!/^\d{5,6}$/.test(period)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0) continue;

    const region = /** @type {Record<string, string>} */ (KAB_SIDO_PREFIX)[code.slice(0, 2)];
    if (!region) {
      skipped++;
      if (row.C1_NM) unmatchedSet.add(row.C1_NM);
      continue;
    }

    matched.push({ region, gu: row.C1_NM, base_month: period, sale_price_index: value });
  }

  return { matched, unmatched: [...unmatchedSet], skipped };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

  const sb = getSupabase();

  // KOSIS API 호출 (DT_KAB_11672_S5 분기, 1차원 → objL1 만)
  const now = new Date();
  const curQ = Math.ceil((now.getMonth() + 1) / 3);
  const endPrd = `${now.getFullYear()}${curQ}`;
  const startPrd = `${now.getFullYear() - 2}${curQ}`;

  log(PHASE, `KOSIS 매매가격지수 조회: ${startPrd} ~ ${endPrd}`);

  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY,
    orgId: "408",
    tblId: "DT_KAB_11672_S5",
    itmId: "ALL",
    objL1: "ALL",
    prdSe: "Q",
    startPrdDe: startPrd,
    endPrdDe: endPrd,
    format: "json",
    jsonVD: "Y",
  });

  const apiUrl = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
  let data;
  try {
    const res = await fetchWithRetry(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    try {
      data = await res.json();
    } catch {
      throw new Error("JSON 파싱 실패");
    }
  } catch (err) {
    throw new Error(`KOSIS ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);

  const rows = Array.isArray(data) ? data : [];
  log(PHASE, `KOSIS 응답: ${rows.length}건`);

  if (rows.length === 0) {
    log(PHASE, "데이터 없음 — 종료");
    return;
  }

  const { matched, unmatched, skipped } = parseKabRows(rows);
  log(PHASE, `시군구 매칭: ${matched.length}개 / skip ${skipped}개`);
  if (unmatched.length > 0) {
    logError(PHASE, `시도 미판정 시군구 ${unmatched.length}개: ${unmatched.join(", ")}`);
  }

  if (matched.length === 0) {
    log(PHASE, "매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)");
    return;
  }

  if (dryRun) {
    log(PHASE, `[DRY-RUN] market_stats_history upsert: ${matched.length}건 예상`);
    log(PHASE, `[DRY-RUN] 샘플: ${JSON.stringify(matched.slice(0, 3))}`);
  } else {
    const inserted = await upsertBatch("market_stats_history", matched, "region,gu,base_month", 500, sb);
    log(PHASE, `market_stats_history upsert: ${inserted}건`);
  }

  if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);
  await recordCollectorRun(PHASE, { ok: matched.length, skip: skipped });

  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

Run: `npx vitest run scripts/collectors/collect-sale-price-index.test.mjs --no-cache`
Expected: PASS — Task 2 의 13건 전부 통과.
FAIL 시 → 실패 테스트명·메시지 보고. parseKabRows 로직과 대조 후 수정.

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck:scripts 2>&1 | grep -E "collect-sale-price-index|Found"`
Expected: `collect-sale-price-index` 관련 에러 0건.

> 시뮬레이션 의무(`.claude/rules/typescript-patterns.md` §11): 위 코드는
> `collect-fertility-rate.mjs`(typecheck 통과 검증됨) 답습이라 신규 패턴 없음.
> `upsertBatch` 는 `_shared.mjs` export(typed). 에러 발생 시 §1~§10 패턴 대조 —
> 주로 `KAB_SIDO_PREFIX` 인덱싱은 이미 `/** @type {Record<string,string>} */` cast
> 적용됨. 그 외 에러 시 메시지 보고 후 patch.

- [ ] **Step 4: 커밋**

```bash
git add scripts/collectors/collect-sale-price-index.mjs
git commit -m "feat(collector): KOSIS 매매가격지수 collect-sale-price-index

DT_KAB_11672_S5 (한국부동산원, orgId=408) 시군구 117개 분기 매매 실거래
가격지수 → market_stats_history.sale_price_index 시계열 upsert.
C1 코드 앞 2자리(부동산원 자체 시도 순번)로 시도 판정 — 수도권+광역시 8개."
```

---

## Task 4: 워크플로 + data-fill + monitor 등재

**Files:**

- Create: `.github/workflows/collect-sale-price-index.yml`
- Modify: `scripts/collectors/data-fill.mjs` (L43 regions 카테고리 scripts 배열)
- Modify: `.github/workflows/monitor-collectors.yml` (workflow_run workflows 목록)

- [ ] **Step 1: 워크플로 파일 작성**

`.github/workflows/collect-sale-price-index.yml` 신규 작성.
`collect-fertility-rate.yml` 답습. **분기 cron** — 매 분기 첫 달(1·4·7·10월)
16일 KST 05:30 (부동산원 분기 지수가 분기 종료 후 1~2개월 공표 → 여유):

```yaml
name: KOSIS Sale Price Index Collection

on:
  schedule:
    - cron: '30 20 16 1,4,7,10 *' # 1·4·7·10월 16일 UTC 20:30 = KST 익일 05:30
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry run (미리보기만, DB 미저장)'
        required: false
        type: boolean
        default: false

concurrency:
  group: data-collection
  cancel-in-progress: false

jobs:
  collect-sale-price-index:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Validate secrets
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KOSIS_KEY: ${{ secrets.KOSIS_KEY }}
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ] || [ -z "$KOSIS_KEY" ]; then
            echo "::error::SUPABASE_URL, SUPABASE_SERVICE_KEY, KOSIS_KEY secret 필요"
            exit 1
          fi
          echo "Secrets validated"

      - name: Collect KOSIS sale price index
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KOSIS_KEY: ${{ secrets.KOSIS_KEY }}
        run: |
          ARGS=""
          if [ "${{ inputs.dry_run }}" = "true" ]; then
            ARGS="--dry-run"
          fi
          node scripts/collectors/collect-sale-price-index.mjs $ARGS
```

- [ ] **Step 2: data-fill.mjs 등재**

`scripts/collectors/data-fill.mjs` L43 의 `regions` 카테고리 `scripts` 배열에
`collect-sale-price-index.mjs` 추가. 현재 (실측):

```javascript
{ category: "regions",   phase: 1, scripts: ["population.mjs", "population-sex-age.mjs", "migration.mjs", "housing-permits.mjs", "collect-housing-supply-ratio.mjs", "collect-fertility-rate.mjs", "collect-housing-price.mjs", "childcare-info.mjs", "childcare-detail.mjs", "collect-avg-income.mjs", "collect-medical-access.mjs"], args: [], envKeys: ["MOIS_POP_KEY", "MOIS_SEX_AGE_KEY", "KOSIS_MIGRATION_KEY", "MOLIT_KEY", "KOSIS_KEY", "CHILDCARE_API_KEY", "CHILDCARE_BASIC_API_KEY"] },
```

`scripts` 배열 끝에 `"collect-sale-price-index.mjs"` 추가 (배열 끝
`"collect-medical-access.mjs"` 다음). `envKeys` 는 `KOSIS_KEY` 이미 포함 —
변경 불필요. 변경 후:

```javascript
{ category: "regions",   phase: 1, scripts: ["population.mjs", "population-sex-age.mjs", "migration.mjs", "housing-permits.mjs", "collect-housing-supply-ratio.mjs", "collect-fertility-rate.mjs", "collect-housing-price.mjs", "childcare-info.mjs", "childcare-detail.mjs", "collect-avg-income.mjs", "collect-medical-access.mjs", "collect-sale-price-index.mjs"], args: [], envKeys: ["MOIS_POP_KEY", "MOIS_SEX_AGE_KEY", "KOSIS_MIGRATION_KEY", "MOLIT_KEY", "KOSIS_KEY", "CHILDCARE_API_KEY", "CHILDCARE_BASIC_API_KEY"] },
```

- [ ] **Step 3: monitor-collectors.yml workflow_run 목록 추가**

`.github/workflows/monitor-collectors.yml` 의 `workflow_run.workflows` 목록
(L10~ 부근)에 `collect-sale-price-index.yml` 의 `name` 값을 알파벳 순서
맞춰 추가. 추가할 항목 — 워크플로 name 그대로:

```yaml
      - "KOSIS Sale Price Index Collection"
```

기존 목록에서 `"KOSIS ..."` 로 시작하는 항목 근처(예: "KOSIS Fertility Rate
Collection" 다음)에 끼워 넣는다. 정확한 삽입 위치는 파일을 Read 해서 기존
"KOSIS" 항목들 사이 알파벳 순서로 결정.

- [ ] **Step 4: monitor 커버리지 audit 로컬 검증**

Run: `node scripts/audit-monitor-coverage.mjs`
Expected: 통과 (exit 0). `collect-sale-price-index.yml` 이 monitor 목록에
없으면 FAIL → Step 3 누락 확인.

- [ ] **Step 5: env-key 3-way audit 로컬 검증**

Run: `node scripts/audit-env-keys.mjs`
Expected: 통과 (exit 0). collector 코드 `process.env.KOSIS_KEY` ↔ yml env
block `KOSIS_KEY` ↔ data-fill `envKeys` 의 `KOSIS_KEY` 3-way 일치.

- [ ] **Step 6: 커밋**

```bash
git add .github/workflows/collect-sale-price-index.yml .github/workflows/monitor-collectors.yml scripts/collectors/data-fill.mjs
git commit -m "ci(collector): collect-sale-price-index 워크플로 + data-fill + monitor 등재

분기 cron(1·4·7·10월 16일). KOSIS_KEY 3-way 동기화 audit 통과.
monitor-collectors workflow_run 목록 추가 (커버리지 audit 통과)."
```

---

## Task 5: database.types.ts 타입 추가

**Files:**

- Modify: `src/types/database.types.ts` (market_stats_history 의 Row/Insert/Update)

- [ ] **Step 1: market_stats_history 타입 위치 확인**

Run: `grep -n "market_stats_history" src/types/database.types.ts`
→ `market_stats_history` 의 `Row`/`Insert`/`Update` 블록 위치 파악.

- [ ] **Step 2: sale_price_index 필드 추가**

`market_stats_history` 의 `Row`/`Insert`/`Update` 세 곳에 `price_index` 와
같은 형식으로 `sale_price_index` 추가. `price_index` 가 `Row` 에서
`number | null`, `Insert`/`Update` 에서 `number | null` (optional `?`) 이면
`sale_price_index` 도 동일하게:

```typescript
// Row 블록 — price_index 줄 근처
sale_price_index: number | null
// Insert / Update 블록 — price_index 줄 근처
sale_price_index?: number | null
```

> 정확한 형식은 같은 테이블의 `price_index` 줄을 그대로 복제하고 이름만
> `sale_price_index` 로 바꿀 것. Row 는 non-optional, Insert/Update 는 optional `?`.

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck`
Expected: 에러 0건.

- [ ] **Step 4: 커밋**

```bash
git add src/types/database.types.ts
git commit -m "types: market_stats_history 에 sale_price_index"
```

---

## Task 6: dry-run 실측 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: dry-run 실행**

Run: `node scripts/collectors/collect-sale-price-index.mjs --dry-run`
Expected:

- `KOSIS 응답: NNN건` (분기 수 × 117 — 최근 8~9분기면 ~1000건 내외)
- `시군구 매칭: NNN개 / skip 0개`
- `[DRY-RUN] market_stats_history upsert: NNN건 예상`
- `[DRY-RUN] 샘플: [{...}]` — region/gu/base_month/sale_price_index 형태
- 에러 종료 없음

> matched 가 0 이거나 skip 이 큰 수면 → KOSIS 응답 형식 변경 또는 C1 prefix
> 가정 깨짐. raw 응답을 다시 확인하고 `KAB_SIDO_PREFIX`/`parseKabRows` 점검.
> dry-run 은 `recordApiQuota`/`recordCollectorRun` 기록 skip (세션 268 가드).
> 컬럼 미적용 상태에서도 upsert 미실행이라 dry-run 가능.

- [ ] **Step 2: 회귀 — 수집기 전체 테스트**

Run: `npx vitest run scripts/collectors --no-cache`
Expected: 전부 PASS (신규 13건 포함).

- [ ] **Step 3: 회귀 — 타입체크 + audit**

Run:

```bash
npm run typecheck
node scripts/audit-env-keys.mjs
node scripts/audit-monitor-coverage.mjs
```

Expected: 전부 0 에러 / exit 0.

---

## Task 7: push + CI + 운영 적재

**Files:** (없음 — 배포·운영)

- [ ] **Step 1: push**

```bash
git push
```

- [ ] **Step 2: CI 확인**

Run: `gh run list --branch main --limit 1 --json conclusion,status`
Expected: CI 완료 후 `conclusion: success`.
CI FAIL 시 → `gh run view --log-failed` 로 실패 step 확인 후 fix.

- [ ] **Step 3: 마이그레이션 적용 (사용자)**

> 👤 **사용자 작업** — Supabase Dashboard SQL Editor 에서
> `supabase/migrations/20260518000000_add_sale_price_index.sql` 본문 실행.
> (`apply-migration.yml` 폐기 — DDL 은 Dashboard 수동 표준)

적용 확인:

```bash
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {error}=await sb.from('market_stats_history').select('sale_price_index').limit(1);console.log(error?'미적용: '+error.message:'sale_price_index 컬럼 적용됨');"
```

Expected: `sale_price_index 컬럼 적용됨`. `미적용` 이면 Step 3 재요청.

- [ ] **Step 4: 운영 적재 (워크플로 dry_run=false)**

워크플로 수동 실행:

```bash
gh workflow run collect-sale-price-index.yml
```

또는 로컬에서 비-dry 실행:

```bash
node scripts/collectors/collect-sale-price-index.mjs
```

- [ ] **Step 5: 적재 결과 검증**

```bash
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {count}=await sb.from('market_stats_history').select('id',{count:'exact',head:true}).not('sale_price_index','is',null);console.log('sale_price_index non-null 행:',count);"
```

Expected: `sale_price_index non-null 행: NNN` — 117 시군구 × 적재 분기 수
(8~9분기면 ~1000건 내외).

- [ ] **Step 6: BACKLOG 갱신**

`.claude/BACKLOG.md` 의 📦 KOSIS `### 🔴 즉시 가치` 표에서 `#1` 행 제거,
완료 색인(`## ✅ 완료된 일`)에 한 줄 추가:

```markdown
- ✅ KOSIS #1 매매가격지수 시군구 → market_stats_history.sale_price_index (세션269)
```

커밋:

```bash
git add .claude/BACKLOG.md
git commit -m "docs: BACKLOG KOSIS #1 매매가격지수 완료 처리"
git push
```

---

## 검증 요약

| Task | 검증 | 통과 기준 |
|---|---|---|
| 1 | 마이그 SQL 작성 | 파일 생성 (적용은 Task 7) |
| 2 | 테스트 실패 확인 | import 단계 FAIL (collector 부재) |
| 3 | 테스트 통과 + 타입체크 | vitest 13건 PASS + typecheck 0 |
| 4 | 워크플로 + audit 2종 | env-key·monitor 커버리지 audit exit 0 |
| 5 | 타입 추가 | npm run typecheck 0 에러 |
| 6 | dry-run 실측 + 회귀 | matched ~1000 / skip 0 + vitest·typecheck 전체 PASS |
| 7 | push + CI + 운영 적재 | CI success + sale_price_index non-null ~1000행 |

## 명시적 비-작업 (YAGNI)

- 매매가격지수 **스코어링 반영** — 가중치 의사결정 필요, 후속 세션
- **프론트 표시** (분양가 vs 시장가 갭 차트) — 데이터 적재 선행
- `regions` 테이블 — 미변경
- `collect-market-stats.mjs` — 미변경 (별도 collector, 같은 테이블 다른 컬럼)

## 한계 / 후속

- 이 통계표는 **수도권+광역시 8개 시도(117 시군구)만** 제공. 강원·충청·전라·
  경상·제주·세종 시군구 매매가격지수는 KOSIS `DT_KAB_11672_S5` 에 없음 —
  전국 커버리지가 필요하면 별도 통계표 조사 필요(후속).
- `market_stats_history` 의 시도 레벨 행(`gu=''`)은 `collect-market-stats`
  가 채움. 본 collector 는 시군구 행(`gu` 비어있지 않음)만 추가 — 충돌 없음.
