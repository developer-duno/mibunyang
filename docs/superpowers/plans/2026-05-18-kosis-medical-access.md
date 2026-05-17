# KOSIS 의료 인프라 묶음 수집기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KOSIS 의사수·병상수 통계표 2개를 시군구별로 수집해 `regions` 테이블의 `doctors_per_1k`/`hospital_beds_per_1k` 컬럼에 적재한다.

**Architecture:** 합계출산율 collector(`collect-fertility-rate.mjs`, 세션 266)를 답습한 묶음 collector 1개. 1차원 KOSIS 통계표(C1 코드 2자리 집계행 + 5자리 시군구)를 통계표별로 호출 → `region::gu` 키 매칭 → `regions` UPDATE. 모니터링은 `data-audit`이 아닌 `monitor-collectors.mjs`의 ④ NULL 점검(`REGION_KEY_COLUMNS`)에 등재.

**Tech Stack:** Node.js ESM `.mjs`, `// @ts-check` JSDoc, KOSIS OpenAPI, Supabase JS, Vitest, GitHub Actions.

---

## 배경 — 왜 이 작업인가

BACKLOG 📦 KOSIS 보강 #11(의사수)·#12(병상수). 시군구 의료 접근성 지표를
`regions`에 누적한다. 설계 문서 `docs/superpowers/specs/2026-05-18-kosis-medical-access-design.md`
참조. 9-GATE 검증 + 맹점 재검토에서 정정한 3건이 이 plan에 반영됨:

1. **data-audit 미수정** — `data-audit.mjs`는 `apartments` 기준 감사기, `regions`는
   시도 레벨 보조 join(`gu` 무시). 시군구 의료 컬럼 못 받음 → `monitor-collectors.mjs`로 등재.
2. **채워질 행 수 = 600행대** — "227"은 `region::gu` 고유 조합 수. `regions` gu 행은
   694개라 collector는 600행대를 UPDATE(합계출산율 620행 동급).
3. **cron 13일** — 11일은 `collect-building-info.yml` 충돌.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `supabase/migrations/<ts>_add_regions_medical_access.sql` | `regions` 2컬럼 추가 DDL | 신규 |
| `supabase/migrations/<ts>_add_regions_medical_access_down.sql` | 역방향 DDL | 신규 |
| `scripts/collectors/collect-medical-access.mjs` | KOSIS 2통계표 수집 + UPDATE | 신규 |
| `scripts/collectors/collect-medical-access.test.mjs` | `parseKosisRows` 단위 테스트 | 신규 |
| `.github/workflows/collect-medical-access.yml` | 매월 13일 cron 워크플로 | 신규 |
| `scripts/collectors/data-fill.mjs` | regions 카테고리 scripts 배열 | 수정 1줄 |
| `scripts/monitor-collectors.mjs` | ④ NULL 점검 컬럼 + 한글 라벨 | 수정 2곳 |
| `.github/workflows/monitor-collectors.yml` | workflows 배열 등재 | 수정 1줄 |

`<ts>` = 마이그 생성 시각 `YYYYMMDDHHMMSS` (예 `20260518...`). 두 마이그 파일은 같은 `<ts>` 사용(`fertility_rate` 선례).

---

## Task 1: DB 마이그레이션 작성

**Files:**
- Create: `supabase/migrations/<ts>_add_regions_medical_access.sql`
- Create: `supabase/migrations/<ts>_add_regions_medical_access_down.sql`

- [ ] **Step 1: 메인 마이그 작성**

`supabase/migrations/<ts>_add_regions_medical_access.sql` (`<ts>`는 `date +%Y%m%d%H%M%S` 결과):

```sql
-- regions 테이블에 의료 인프라 2컬럼 추가
-- 출처: KOSIS DT_1YL20981 (의사수) + DT_1YL20971 (병상수), orgId=101, itmId=T10, prdSe=A
-- 단위: 명/개 per 인구 1000명 (예: 3.2 = 전국 의사, 13.8 = 전국 병상)
-- collect-medical-access.mjs 가 매월 13일 KST 05:30 UPDATE
-- 적재 단위: gu 있는 시군구 행 (KOSIS C1 5자리 시군구코드 매칭, 2자리 집계행 제외)

ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS doctors_per_1k REAL,
  ADD COLUMN IF NOT EXISTS hospital_beds_per_1k REAL;

COMMENT ON COLUMN regions.doctors_per_1k IS
  'KOSIS DT_1YL20981 인구 천명당 의료기관 종사 의사수 (itmId=T10). 시군구 UPDATE.';
COMMENT ON COLUMN regions.hospital_beds_per_1k IS
  'KOSIS DT_1YL20971 인구 천명당 의료기관 병상수 (itmId=T10). 시군구 UPDATE.';
```

- [ ] **Step 2: 역방향 마이그 작성**

`supabase/migrations/<ts>_add_regions_medical_access_down.sql`:

```sql
-- 역방향: regions 의료 2컬럼 제거
-- 주의: cross-repo (naver-estate-web) 자매 ORM/UI 사전 정정 의무

ALTER TABLE regions
  DROP COLUMN IF EXISTS doctors_per_1k,
  DROP COLUMN IF EXISTS hospital_beds_per_1k;
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/
git commit -m "feat(db): regions 의료 인프라 2컬럼 마이그레이션"
```

- [ ] **Step 4: 사용자에게 Dashboard 적용 요청**

사용자가 Supabase Dashboard SQL Editor에서 메인 마이그 SQL 실행 + `NOTIFY pgrst, 'reload schema';`.
(workflow-name-hallucination 룰 — 워크플로 자동 적용 금지, Dashboard 수동이 표준.)

- [ ] **Step 5: 컬럼 적용 검증**

Run:
```bash
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {data}=await sb.from('regions').select('doctors_per_1k,hospital_beds_per_1k').limit(1);console.log('컬럼 존재:', data ? Object.keys(data[0]) : 'ERR');"
```
Expected: `컬럼 존재: [ 'doctors_per_1k', 'hospital_beds_per_1k' ]` (에러 없음 = Dashboard 적용 완료)

---

## Task 2: collector 테스트 작성 (TDD — 실패 먼저)

**Files:**
- Create: `scripts/collectors/collect-medical-access.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/collectors/collect-medical-access.test.mjs` 전체:

```javascript
// @ts-check
/**
 * collect-medical-access.mjs 테스트 — KOSIS DT_1YL20981/DT_1YL20971 파싱 검증
 *
 * 대상: parseKosisRows
 * 환각 차단: 1차원 통계표 C1 길이 2(집계행)/5(시군구) 분기, itmId=T10 외 ITM skip
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
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

const { parseKosisRows } = await import("./collect-medical-access.mjs");

/**
 * @param {string} c1     C1 코드 (2자리=집계행 / 5자리=시군구)
 * @param {string} c1Nm   C1_NM (시도명 또는 시군구명)
 * @param {string} year   PRD_DE
 * @param {string|number} value  DT
 * @param {string} [itmId]  ITM_ID (T10 = 천명당 지표)
 */
function makeRow(c1, c1Nm, year, value, itmId = "T10") {
  return { C1: c1, C1_NM: c1Nm, ITM_ID: itmId, PRD_DE: year, DT: String(value) };
}

describe("parseKosisRows (DT_1YL20981/DT_1YL20971 의료 인프라)", () => {
  it("빈 배열 → matched 빈 객체", () => {
    expect(parseKosisRows([])).toEqual({ matched: {}, unmatched: [], aggSkipped: 0 });
  });

  it("5자리 C1 시군구 정상 → region::gu 키로 추출", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2024", 3.2)]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(3.2, 2);
  });

  it("동명 시군구 — C1 앞 2자리 시도코드로 구분 (서울 중구 ≠ 부산 중구)", () => {
    const result = parseKosisRows([
      makeRow("11020", "중구", "2024", 5.1),
      makeRow("21010", "중구", "2024", 2.3),
    ]);
    expect(result.matched["서울::중구"]).toBeCloseTo(5.1, 2);
    expect(result.matched["부산::중구"]).toBeCloseTo(2.3, 2);
  });

  it("2자리 C1 집계행 (전국 '00' / 서울 '11') → aggSkipped 증가, matched 미포함", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2024", 3.2),
      makeRow("11", "서울특별시", "2024", 4.5),
      makeRow("11010", "종로구", "2024", 8.1),
    ]);
    expect(result.aggSkipped).toBe(2);
    expect(Object.keys(result.matched)).toEqual(["서울::종로구"]);
  });

  it("최신 연도 우선 (2022 → 2024 덮어쓰기)", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2022", 7.5),
      makeRow("11010", "종로구", "2024", 8.1),
    ]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(8.1, 2);
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2024", "abc")]);
    expect(result.matched).toEqual({});
  });

  it("DT<=0 (이상치 가드) → 무시. 상한 없음 (병상수 큰 값 허용)", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2024", 0),
      makeRow("11020", "중구", "2024", 150),
    ]);
    expect(result.matched["서울::종로구"]).toBeUndefined();
    expect(result.matched["서울::중구"]).toBeCloseTo(150, 2);
  });

  it("알 수 없는 KOSIS 시도코드 (99xxx) → unmatched 에 C1_NM push", () => {
    const result = parseKosisRows([makeRow("99010", "가상시", "2024", 3.0)]);
    expect(result.matched).toEqual({});
    expect(result.unmatched).toEqual(["가상시"]);
  });

  it("ITM_ID='T10' 외 (T001 분자 / T002 분모) → 무시", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2024", 163115, "T001"),
      makeRow("11010", "종로구", "2024", 50000, "T002"),
      makeRow("11010", "종로구", "2024", 8.1, "T10"),
    ]);
    expect(Object.keys(result.matched)).toEqual(["서울::종로구"]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(8.1, 2);
  });

  it("PRD_DE 비-연도 포맷 → 무시", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2024M01", 3.0)]);
    expect(result.matched).toEqual({});
  });

  it("C1 길이 비정상 (3·4자리) → 무시", () => {
    const result = parseKosisRows([
      makeRow("110", "이상", "2024", 3.0),
      makeRow("1101", "이상", "2024", 3.0),
    ]);
    expect(result.matched).toEqual({});
  });

  it("17개 시도 시군구 동시 처리 — 시도코드별 region 매핑", () => {
    const sido = [
      ["11", "서울"], ["21", "부산"], ["22", "대구"], ["23", "인천"], ["24", "광주"],
      ["25", "대전"], ["26", "울산"], ["29", "세종"], ["31", "경기"], ["32", "강원"],
      ["33", "충북"], ["34", "충남"], ["35", "전북"], ["36", "전남"], ["37", "경북"],
      ["38", "경남"], ["39", "제주"],
    ];
    const rows = sido.map(([code, region], i) =>
      makeRow(`${code}010`, `${region}시군구`, "2024", 3.0 + i * 0.1),
    );
    const result = parseKosisRows(rows);
    expect(Object.keys(result.matched)).toHaveLength(17);
    expect(result.matched["서울::서울시군구"]).toBeCloseTo(3.0, 2);
    expect(result.unmatched).toHaveLength(0);
  });

  it("전국 + 시도 + 시군구 혼합 → 시군구만 matched, 나머지 aggSkipped", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2024", 3.2),
      makeRow("11", "서울특별시", "2024", 4.5),
      makeRow("11010", "종로구", "2024", 8.1),
      makeRow("31010", "수원시", "2024", 2.9),
    ]);
    expect(result.aggSkipped).toBe(2);
    expect(Object.keys(result.matched).sort()).toEqual(["경기::수원시", "서울::종로구"]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run scripts/collectors/collect-medical-access.test.mjs --no-cache`
Expected: FAIL — `Failed to resolve import "./collect-medical-access.mjs"` (collector 미존재)

- [ ] **Step 3: 커밋**

```bash
git add scripts/collectors/collect-medical-access.test.mjs
git commit -m "test(collector): 의료 인프라 collector parseKosisRows 테스트 13건"
```

---

## Task 3: collector 구현

**Files:**
- Create: `scripts/collectors/collect-medical-access.mjs`

- [ ] **Step 1: collector 작성**

`scripts/collectors/collect-medical-access.mjs` 전체:

```javascript
// @ts-check
/**
 * KOSIS 의료 인프라 묶음 수집기 (BACKLOG #11·#12, 세션 267)
 *
 * KOSIS 국가통계포털 통계표 2개에서 시군구별 의료 접근성 지표를 수집해
 * regions 테이블 (gu 있는 시군구 행) 업데이트.
 *   - DT_1YL20981 인구 천명당 의료기관 종사 의사수 → doctors_per_1k
 *   - DT_1YL20971 인구 천명당 의료기관 병상수      → hospital_beds_per_1k
 *
 * - itmId = 'T10' (천명당 지표). T001 분자 / T002 분모는 API 단계 필터로 제외.
 * - prdSe = 'A' (연간), 1차원 통계표 — objL1 만 사용.
 * - C1 코드: 2자리 = 집계행(전국/시도, 버림) / 5자리 = 시군구.
 *   5자리 앞 2자리 = KOSIS 시도코드 (법정동코드와 다른 체계 — KOSIS_SIDO).
 * - collect-fertility-rate.mjs (세션 266) 답습 + 통계표 2개 루프.
 *
 * 사용법:
 *   node scripts/collectors/collect-medical-access.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-medical-access.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ C1: string; C1_NM: string; ITM_ID?: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {{ matched: Record<string, number>; unmatched: string[]; aggSkipped: number }} ParseResult */

loadEnv();

const PHASE = "kosis-medical-access";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS C1 코드 앞 2자리 → regions.region.
 * 법정동코드 체계(_shared.REGION_LAWD_PREFIX) 와 다름 — 재사용 금지.
 * 값 출처: KOSIS 시도 집계행 17개 실측 (collect-fertility-rate.mjs 답습).
 */
const KOSIS_SIDO = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주",
  "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
  "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북",
  "38": "경남", "39": "제주",
};

/**
 * 수집 대상 통계표 — { tblId, regions 컬럼명 }.
 */
const TABLES = [
  { tblId: "DT_1YL20981", column: "doctors_per_1k", label: "의사수" },
  { tblId: "DT_1YL20971", column: "hospital_beds_per_1k", label: "병상수" },
];

/**
 * KOSIS 통계표 행 → "region::gu" 키별 천명당 지표값 (최신 연도).
 * - C1 길이 2 (전국/시도 집계행) → aggSkipped 증가, 버림
 * - C1 길이 5 (시군구) → KOSIS_SIDO[C1.slice(0,2)] + C1_NM 으로 매칭
 * - ITM_ID 가 T10 아니면 skip (T001 분자 / T002 분모 제외)
 * @param {KosisRow[]} rows
 * @returns {ParseResult}
 */
export function parseKosisRows(rows) {
  /** @type {Record<string, number>} */
  const matched = {};
  /** @type {Record<string, string>} */
  const latestYear = {};
  /** @type {Set<string>} */
  const unmatchedSet = new Set();
  let aggSkipped = 0;

  for (const row of rows) {
    // itmId=T10 만 호출하지만 다른 ITM 이 섞이면 skip
    if (row.ITM_ID && row.ITM_ID !== "T10") continue;

    const code = String(row.C1 ?? "");
    if (code.length === 2) {
      aggSkipped++;
      continue;
    }
    if (code.length !== 5) continue;

    const year = String(row.PRD_DE ?? "");
    if (!/^\d{4}$/.test(year)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0) continue;

    const region = /** @type {Record<string, string>} */ (KOSIS_SIDO)[code.slice(0, 2)];
    if (!region) {
      if (row.C1_NM) unmatchedSet.add(row.C1_NM);
      continue;
    }

    const key = `${region}::${row.C1_NM}`;
    if (!latestYear[key] || year > latestYear[key]) {
      latestYear[key] = year;
      matched[key] = value;
    }
  }

  return { matched, unmatched: [...unmatchedSet], aggSkipped };
}

/**
 * KOSIS 통계표 1개 호출 → parseKosisRows 결과.
 * @param {string} tblId
 * @param {string} startYear
 * @param {string} endYear
 * @returns {Promise<ParseResult>}
 */
async function fetchTable(tblId, startYear, endYear) {
  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY ?? "",
    orgId: "101",
    tblId,
    itmId: "T10",
    objL1: "ALL",
    prdSe: "A",
    startPrdDe: startYear,
    endPrdDe: endYear,
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
    throw new Error(`KOSIS ${tblId} ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data.err) throw new Error(`KOSIS ${tblId} 에러: ${data.errMsg || data.err}`);

  const rows = Array.isArray(data) ? data : [];
  log(PHASE, `KOSIS ${tblId} 응답: ${rows.length}건`);
  return parseKosisRows(rows);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

  const sb = getSupabase();

  const now = new Date();
  const endYear = String(now.getFullYear());
  const startYear = String(now.getFullYear() - 3);
  log(PHASE, `KOSIS 의료 인프라 조회: ${startYear} ~ ${endYear}`);

  // 통계표별 수집 → { column: matched }
  /** @type {Record<string, Record<string, number>>} */
  const byColumn = {};
  let totalUnmatched = 0;
  for (const { tblId, column, label } of TABLES) {
    const { matched, unmatched, aggSkipped } = await fetchTable(tblId, startYear, endYear);
    log(PHASE, `${label}: 시군구 매칭 ${Object.keys(matched).length}개 / 집계행 skip ${aggSkipped}개`);
    if (unmatched.length > 0) {
      logError(PHASE, `${label} 매칭 실패 ${unmatched.length}개: ${unmatched.join(", ")}`);
      totalUnmatched += unmatched.length;
    }
    byColumn[column] = matched;
  }

  if (Object.values(byColumn).every(m => Object.keys(m).length === 0)) {
    log(PHASE, "전 통계표 매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)");
    return;
  }

  // regions UPDATE (gu 있는 시군구 행)
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu, doctors_per_1k, hospital_beds_per_1k")
    .not("gu", "is", null);

  if (rErr) {
    logError(PHASE, `regions 조회 실패: ${rErr.message}`);
    return;
  }

  /** @type {Array<{ id: string; region: string; gu: string | null; doctors_per_1k: number | null; hospital_beds_per_1k: number | null }>} */
  const regionsTyped = /** @type {any} */ (regions ?? []);

  let updated = 0;
  for (const reg of regionsTyped) {
    const key = `${reg.region}::${reg.gu}`;
    const doctors = byColumn["doctors_per_1k"]?.[key];
    const beds = byColumn["hospital_beds_per_1k"]?.[key];
    if (doctors == null && beds == null) continue;

    /** @type {Record<string, number>} */
    const patch = {};
    if (doctors != null && (reg.doctors_per_1k == null || Math.abs(reg.doctors_per_1k - doctors) >= 0.05)) {
      patch.doctors_per_1k = doctors;
    }
    if (beds != null && (reg.hospital_beds_per_1k == null || Math.abs(reg.hospital_beds_per_1k - beds) >= 0.05)) {
      patch.hospital_beds_per_1k = beds;
    }
    if (Object.keys(patch).length === 0) continue;

    if (dryRun) {
      log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu}: ${JSON.stringify(patch)}`);
      updated++;
      continue;
    }

    const { error } = await sb.from("regions").update(patch).eq("id", reg.id);
    if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
    else updated++;
  }

  log(PHASE, `regions 갱신: ${updated}건 / ${regionsTyped.length}건 대상`);

  if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", TABLES.length);
  await recordCollectorRun(PHASE, { ok: updated, skip: totalUnmatched });

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

Run: `npx vitest run scripts/collectors/collect-medical-access.test.mjs --no-cache`
Expected: PASS — 13 tests passed

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck:scripts 2>&1 | grep -E "collect-medical-access|Found"`
Expected: `collect-medical-access` 관련 에러 0건 (`Found 0 errors` 또는 무관 파일만)

- [ ] **Step 4: dry-run 실측**

Run: `node scripts/collectors/collect-medical-access.mjs --dry-run`
Expected: `의사수: 시군구 매칭 227개` / `병상수: 시군구 매칭 227개` / `regions 갱신: 600건대 / 694건 대상` (unmatched `전북::전주시` 1개 — 정상)

- [ ] **Step 5: 커밋**

```bash
git add scripts/collectors/collect-medical-access.mjs
git commit -m "feat(collector): KOSIS 의료 인프라 묶음 수집기 (#11·#12)"
```

---

## Task 4: GitHub Actions 워크플로

**Files:**
- Create: `.github/workflows/collect-medical-access.yml`

- [ ] **Step 1: 워크플로 작성**

`.github/workflows/collect-medical-access.yml` 전체 (`collect-fertility-rate.yml` 답습, cron만 13일):

```yaml
name: KOSIS Medical Access Collection

on:
  schedule:
    - cron: '30 20 13 * *' # 매월 13일 UTC 20:30 = KST 익일 05:30 (미사용 일자)
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
  collect-medical-access:
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

      - name: Collect KOSIS medical access
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KOSIS_KEY: ${{ secrets.KOSIS_KEY }}
        run: |
          ARGS=""
          if [ "${{ inputs.dry_run }}" = "true" ]; then
            ARGS="--dry-run"
          fi
          node scripts/collectors/collect-medical-access.mjs $ARGS
```

- [ ] **Step 2: audit-env-keys 검증**

Run: `node scripts/audit-env-keys.mjs`
Expected: 에러 0건 (의료 collector + yml 의 `KOSIS_KEY` 3-way 일치 — codeKeys 단방향 검사 통과)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/collect-medical-access.yml
git commit -m "ci: collect-medical-access 워크플로 (매월 13일)"
```

---

## Task 5: data-fill 등록

**Files:**
- Modify: `scripts/collectors/data-fill.mjs:43`

- [ ] **Step 1: regions 카테고리 scripts 배열에 추가**

`scripts/collectors/data-fill.mjs` L43의 `regions` 엔트리 `scripts` 배열 끝에 `"collect-medical-access.mjs"` 추가. 변경 전:

```javascript
  { category: "regions",   phase: 1, scripts: ["population.mjs", "population-sex-age.mjs", "migration.mjs", "housing-permits.mjs", "collect-housing-supply-ratio.mjs", "collect-fertility-rate.mjs", "collect-housing-price.mjs", "childcare-info.mjs", "childcare-detail.mjs", "collect-avg-income.mjs"], args: [], envKeys: ["MOIS_POP_KEY", "MOIS_SEX_AGE_KEY", "KOSIS_MIGRATION_KEY", "MOLIT_KEY", "KOSIS_KEY", "CHILDCARE_API_KEY", "CHILDCARE_BASIC_API_KEY"] },
```

변경 후 (`scripts` 배열에 1개 추가, `envKeys`는 `KOSIS_KEY` 이미 존재 → 무변경):

```javascript
  { category: "regions",   phase: 1, scripts: ["population.mjs", "population-sex-age.mjs", "migration.mjs", "housing-permits.mjs", "collect-housing-supply-ratio.mjs", "collect-fertility-rate.mjs", "collect-housing-price.mjs", "childcare-info.mjs", "childcare-detail.mjs", "collect-avg-income.mjs", "collect-medical-access.mjs"], args: [], envKeys: ["MOIS_POP_KEY", "MOIS_SEX_AGE_KEY", "KOSIS_MIGRATION_KEY", "MOLIT_KEY", "KOSIS_KEY", "CHILDCARE_API_KEY", "CHILDCARE_BASIC_API_KEY"] },
```

- [ ] **Step 2: data-fill 테스트 회귀 확인**

Run: `npx vitest run scripts/collectors/data-fill.test.mjs --no-cache`
Expected: PASS (scripts 배열은 toEqual 검사 대상 아님, envKeys 무변경 — 회귀 없음)

- [ ] **Step 3: 커밋**

```bash
git add scripts/collectors/data-fill.mjs
git commit -m "feat(data-fill): regions 카테고리에 collect-medical-access 등록"
```

---

## Task 6: monitor-collectors NULL 점검 등록

**Files:**
- Modify: `scripts/monitor-collectors.mjs:37` (`REGION_KEY_COLUMNS`)
- Modify: `scripts/monitor-collectors.mjs:89-90` (`KO_CATEGORY` 라벨)

- [ ] **Step 1: REGION_KEY_COLUMNS 에 의료 컬럼 추가**

`scripts/monitor-collectors.mjs` L37. 변경 전:

```javascript
const REGION_KEY_COLUMNS = ["net_migration", "crime_grade"];
```

변경 후:

```javascript
const REGION_KEY_COLUMNS = ["net_migration", "crime_grade", "doctors_per_1k", "hospital_beds_per_1k"];
```

- [ ] **Step 2: 한글 라벨 추가**

`scripts/monitor-collectors.mjs`의 `// regions 핵심 컬럼 (checkNullSurge)` 주석 아래
`crime_grade: "범죄안전등급",` 다음 줄에 2줄 추가. 변경 전:

```javascript
  // regions 핵심 컬럼 (checkNullSurge)
  net_migration: "순이동인구",
  crime_grade: "범죄안전등급",
};
```

변경 후:

```javascript
  // regions 핵심 컬럼 (checkNullSurge)
  net_migration: "순이동인구",
  crime_grade: "범죄안전등급",
  doctors_per_1k: "인구천명당 의사수",
  hospital_beds_per_1k: "인구천명당 병상수",
};
```

- [ ] **Step 3: monitor-collectors 테스트 회귀 확인**

Run: `npx vitest run scripts/monitor-collectors.test.mjs --no-cache`
Expected: PASS — 기존 테스트는 `net_migration`/`crime_grade` 만 검증, 의료 컬럼 추가는 영향 없음. FAIL 시 (테스트가 `REGION_KEY_COLUMNS` 길이를 검사하면) 해당 테스트에 의료 2컬럼 반영.

- [ ] **Step 4: 타입체크**

Run: `npm run typecheck:scripts 2>&1 | grep -E "monitor-collectors|Found"`
Expected: `monitor-collectors` 관련 에러 0건

- [ ] **Step 5: 커밋**

```bash
git add scripts/monitor-collectors.mjs
git commit -m "feat(monitor): ④ NULL 점검에 regions 의료 2컬럼 등록"
```

---

## Task 7: monitor-collectors 워크플로 등재

**Files:**
- Modify: `.github/workflows/monitor-collectors.yml` (workflows 배열)

- [ ] **Step 1: workflows 배열에 의료 collector name 추가**

`.github/workflows/monitor-collectors.yml`의 `workflows:` 배열에서
`- "KOSIS Housing Supply Level Collection"` 다음 줄에 알파벳 순 위치로 추가:

```yaml
      - "KOSIS Fertility Rate Collection"
      - "KOSIS Housing Supply Level Collection"
      - "KOSIS Medical Access Collection"
      - "KOSIS Market Stats Collection"
```

(name 값은 Task 4 yml의 `name:` 필드 `KOSIS Medical Access Collection` 과 정확히 일치해야 함.)

- [ ] **Step 2: audit-monitor-coverage 검증**

Run: `node scripts/audit-monitor-coverage.mjs`
Expected: 에러 0건 (collect-medical-access.yml 의 name 이 monitor workflows 배열에 등재됨)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/monitor-collectors.yml
git commit -m "ci(monitor): workflows 배열에 collect-medical-access 등재"
```

---

## Task 8: 전체 회귀 검증 + push

- [ ] **Step 1: 전체 회귀 가드**

Run:
```bash
npx vitest run scripts/collectors/collect-medical-access.test.mjs scripts/collectors/data-fill.test.mjs scripts/monitor-collectors.test.mjs --no-cache
npm run typecheck:scripts
node scripts/audit-env-keys.mjs
node scripts/audit-monitor-coverage.mjs
```
Expected: 전부 PASS / 에러 0

- [ ] **Step 2: push**

```bash
git push
```

- [ ] **Step 3: CI 확인**

Run: `gh run list --branch main --limit 1 --json conclusion,status`
Expected: CI 완료 후 `conclusion: success`

- [ ] **Step 4: 운영 실행 (사용자 Dashboard 적용 완료 후)**

Run:
```bash
gh run list --status in_progress --json workflowName   # data-collection 그룹 충돌 확인
gh workflow run collect-medical-access.yml
```

- [ ] **Step 5: 적재 검증**

Run:
```bash
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();for(const c of ['doctors_per_1k','hospital_beds_per_1k']){const {count}=await sb.from('regions').select(c,{count:'exact',head:true}).not(c,'is',null);console.log(c,count);}"
```
Expected: 두 컬럼 모두 600행대 (합계출산율 620행 동급)

---

## 검증 요약

| 단계 | 검증 | 통과 기준 |
|---|---|---|
| Task 1 | DB 컬럼 적용 | `regions` select 에러 없음 |
| Task 2-3 | collector 단위 테스트 | vitest 13건 PASS |
| Task 3 | dry-run | 매칭 227개 / 600행대 대상 |
| Task 4 | audit-env-keys | KOSIS_KEY 3-way 일치 |
| Task 7 | audit-monitor-coverage | yml name 등재 확인 |
| Task 8 | CI + 운영 적재 | CI success + 600행대 적재 |
