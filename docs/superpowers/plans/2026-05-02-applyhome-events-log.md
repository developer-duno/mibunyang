# 청약홈 무순위 공고 이벤트 로그 — 실행 plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 청약홈 무순위 공고를 시계열 테이블에 적재하고 1,263개 단지에 "추가 모집" 빨간 배지를 즉시 노출.

**Architecture:** DB 신규 테이블(`applyhome_events`) + `apartments_flat` VIEW 확장 + 수집기 `upsertBatch` 적재 + BFF sanitize 화이트리스트 + AptCard alertRow 배지 1개. 6단계, PR 3묶음(DB / 코드+BFF / UI+테스트)으로 적용.

**Tech Stack:** PostgreSQL 시계열 + Supabase + Node.js 수집기 + React 19 + Vitest + Vercel Serverless.

**Spec:** `docs/superpowers/specs/2026-05-02-applyhome-events-log-design.md` (10차 GATE 통과)

---

## 사전 환경 확인 (시작 전 반드시)

- [ ] **Step 0-1: 작업 디렉토리·환경 확인**

Run:
```bash
pwd
git status
git log origin/main..HEAD --oneline
type claude
```

Expected: `f:\mibunyang`, working tree clean, `claude` 래퍼 살아있음.

- [ ] **Step 0-2: dry-run 매칭률 재측정 (스펙 가정값 확인)**

Run: `node scripts/collectors/collect-applyhome.mjs --dry-run 2>&1 | tail -3`

Expected: `매칭: 1263/1314건` 또는 그 비슷한 매칭률 (96% 이상). 매칭률이 70% 미만이면 즉시 중단하고 사용자에게 보고.

- [ ] **Step 0-3: 직전 VIEW 마이그 컬럼 수 확인 (스펙 117 가정)**

Run: `grep -E "AS\s+\"" supabase/migrations/20260419000000_view_dedup_prefer_general.sql | grep -oE '"[a-zA-Z_]+"' | sort -u | wc -l`

Expected: `117`. 다르면 스펙 § 2 의 컬럼 수 박제 갱신 필요.

---

## PR #1 — DB 마이그레이션 (Task 1·2)

### Task 1: `applyhome_events` 테이블 마이그레이션 생성

**Files:**
- Create: `supabase/migrations/20260502000000_create_applyhome_events.sql`
- Create: `supabase/migrations/_rollbacks/20260502000001_rollback_create_applyhome_events.sql`

- [ ] **Step 1-1: forward 마이그 SQL 작성**

Create `supabase/migrations/20260502000000_create_applyhome_events.sql`:

```sql
-- BEGIN/COMMIT 사용 안 함: 기존 신규 테이블 마이그(consults / api_quota_log /
-- market_stats_history / add_competition_rate) 모두 평면 SQL. Supabase가 자동 적용.

CREATE TABLE applyhome_events (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,
  supply INTEGER NOT NULL,
  applicants INTEGER NOT NULL,
  rate REAL,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(apartment_id, house_manage_no)
);

CREATE INDEX idx_applyhome_events_apt ON applyhome_events(apartment_id, recorded_at DESC);
CREATE INDEX idx_applyhome_events_recorded ON applyhome_events(recorded_at DESC);

COMMENT ON TABLE applyhome_events IS '청약홈 무순위/잔여세대 공고 이벤트 로그. 같은 단지 2회+ 출현 = 미분양 시그널';
COMMENT ON COLUMN applyhome_events.house_manage_no IS '청약홈 HOUSE_MANAGE_NO. 공고 1건당 1번호 → 차수 식별';
COMMENT ON COLUMN applyhome_events.recorded_at IS '수집기 실행일 (공고일 아님 — API에 공고일 필드 없음)';

ALTER TABLE applyhome_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON applyhome_events FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_events FOR ALL USING (auth.role() = 'service_role');
```

- [ ] **Step 1-2: 롤백 마이그 SQL 작성**

Create `supabase/migrations/_rollbacks/20260502000001_rollback_create_applyhome_events.sql`:

```sql
-- 롤백용 마이그레이션 — 20260502000000_create_applyhome_events.sql 되돌리기
-- ⚠️ 미적용. 비상용. CASCADE로 모든 적재 데이터 손실됨.
-- 사용법: Supabase SQL Editor 에서 이 파일 전체 실행 → forward 마이그 로그 수동 삭제
--
-- ⚠️ 실행 순서: 이 파일을 실행하기 전 반드시 VIEW 롤백
--    (`20260502100001_rollback_view_add_applyhome_events.sql`) 부터 먼저 실행할 것.
--    이유: apartments_flat VIEW가 applyhome_events 를 LEFT JOIN 으로 참조 → 테이블만
--    먼저 DROP 하면 VIEW가 깨진 상태로 남음(쿼리 실패).

DROP TABLE IF EXISTS applyhome_events CASCADE;
```

- [ ] **Step 1-3: 커밋**

Run:
```bash
git add supabase/migrations/20260502000000_create_applyhome_events.sql supabase/migrations/_rollbacks/20260502000001_rollback_create_applyhome_events.sql
git commit -m "feat(db): add applyhome_events table for unsold event log"
```

---

### Task 2: `apartments_flat` VIEW 확장 마이그레이션

**Files:**
- Create: `supabase/migrations/20260502100000_view_add_applyhome_events.sql`
- Create: `supabase/migrations/_rollbacks/20260502100001_rollback_view_add_applyhome_events.sql`
- Read: `supabase/migrations/20260419000000_view_dedup_prefer_general.sql` (직전 VIEW 본문 통째 복사)

- [ ] **Step 2-1: 직전 VIEW 마이그 read + 본문 복사 준비**

Run:
```bash
# 직전 VIEW 마이그 본문 read (전체)
cat supabase/migrations/20260419000000_view_dedup_prefer_general.sql

# 117개 alias 자동 추출 (Task 2-2 의 SELECT 본문 + 나중 컬럼 검증 9-B 의 expected 리스트 준비용)
grep -E "AS\s+\"" supabase/migrations/20260419000000_view_dedup_prefer_general.sql | grep -oE '"[a-zA-Z_]+"' | sort -u > /tmp/expected_aliases.txt
wc -l /tmp/expected_aliases.txt
```

Expected: `117 /tmp/expected_aliases.txt`. 다르면 스펙 가정 깨진 것 — 즉시 사용자에게 보고.

복사 범위 (Task 2-2 신규 SQL 작성 시): 직전 마이그 파일의 `DROP VIEW IF EXISTS apartments_flat;` 부터 마지막 `;` 까지를 신규 마이그 파일에 그대로 붙여넣고, 끝의 마지막 `LEFT JOIN trade_stats ts ON ...` 다음(세미콜론 제거)에 신규 LEFT JOIN ae 와 SELECT 끝의 신규 2컬럼만 추가.

- [ ] **Step 2-2: forward VIEW 마이그 SQL 작성**

Create `supabase/migrations/20260502100000_view_add_applyhome_events.sql`:

```sql
-- BEGIN/COMMIT 사용 안 함 (기존 VIEW 마이그 패턴).
-- NOTIFY pgrst 호출 안 함 (기존 VIEW 마이그 패턴 — PostgREST 자동 감지).

DROP VIEW IF EXISTS apartments_flat;

CREATE OR REPLACE VIEW apartments_flat AS
WITH dedup_ranked AS (
  -- ↓ 직전 마이그(20260419000000) CTE 통째 복사 시작 ↓
  ... (20260419000000 의 dedup_ranked CTE 그대로)
),
deduped AS (
  ... (20260419000000 의 deduped CTE 그대로)
),
latest_prices AS (
  ... (그대로)
),
latest_regions AS (
  ... (그대로)
)
SELECT
  -- ↓ 117개 컬럼 통째 복사 ↓
  a.id, a.name, a.dong, ... a.competition_applicants AS "competitionApplicants",
  ... -- (모든 컬럼 + dataReliability 공식 그대로)
  -- ↑ 통째 복사 끝 ↑
  -- ── 신규 2컬럼 SELECT 끝에 추가 ──
  COALESCE(ae.event_count, 0) AS "unsoldEventCount",
  ae.last_event_at              AS "lastUnsoldEventAt"
FROM deduped a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id
-- ── 신규 LEFT JOIN 끝에 추가 ──
LEFT JOIN (
  SELECT apartment_id,
         COUNT(*)         AS event_count,
         MAX(recorded_at) AS last_event_at
    FROM applyhome_events
   GROUP BY apartment_id
) ae ON ae.apartment_id = a.id;
```

⚠️ 직전 VIEW 의 SELECT 117줄 + LEFT JOIN 7개 모두 빠짐없이 복사할 것. Step 7-3 의 컬럼명 비교 진단으로 누락 자동 감지됨.

- [ ] **Step 2-3: 롤백 VIEW 마이그 SQL 작성 (직전 VIEW 본문 통째 박제)**

Create `supabase/migrations/_rollbacks/20260502100001_rollback_view_add_applyhome_events.sql`:

```sql
-- 롤백용 마이그레이션 — apartments_flat VIEW 에서 신규 2컬럼 제거.
-- ⚠️ 미적용. 비상용. 직전 VIEW 마이그(20260419000000) 상태로 복원.
-- 사용법: Supabase SQL Editor 에서 이 파일 전체 실행. forward 마이그 로그 수동 삭제.
--
-- ⚠️ 실행 순서: 이 파일을 먼저 실행한 뒤 테이블 롤백
--    (`20260502000001_rollback_create_applyhome_events.sql`) 실행. 반대 순서로 실행하면
--    apartments_flat 의 ae LEFT JOIN 이 깨진 상태로 남음.

DROP VIEW IF EXISTS apartments_flat;

-- ↓↓↓ 20260419000000_view_dedup_prefer_general.sql 의 CREATE OR REPLACE VIEW
--     부터 마지막 세미콜론까지 전체(약 230줄) 통째로 복사 ↓↓↓
CREATE OR REPLACE VIEW apartments_flat AS
WITH dedup_ranked AS (...),       -- 20260419000000 그대로
     deduped AS (...),
     latest_prices AS (...),
     latest_regions AS (...)
SELECT
  -- 117개 컬럼 전부
  a.id, ...
FROM deduped a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id;
-- ↑↑↑ 통째 복사 끝 (신규 LEFT JOIN ae 는 제외 — 신규 2컬럼이 사라지는 것이 본 롤백 목적) ↑↑↑
```

- [ ] **Step 2-4: 커밋**

Run:
```bash
git add supabase/migrations/20260502100000_view_add_applyhome_events.sql supabase/migrations/_rollbacks/20260502100001_rollback_view_add_applyhome_events.sql
git commit -m "feat(db): extend apartments_flat with unsoldEventCount/lastUnsoldEventAt"
```

- [ ] **Step 2-5: PR #1 push (DB 묶음)**

Run:
```bash
git push -u origin <branch-name>
gh pr create --title "feat(db): applyhome_events 테이블 + apartments_flat VIEW 확장" --body "$(cat <<'EOF'
## Summary
- 신규 시계열 테이블 `applyhome_events` (UNIQUE: apartment_id + house_manage_no)
- `apartments_flat` VIEW 에 `unsoldEventCount` / `lastUnsoldEventAt` 컬럼 추가

## Test plan
- [ ] Supabase Studio SQL Editor 에서 두 마이그 순서대로 실행 (테이블 → VIEW)
- [ ] `SELECT COUNT(*) FROM applyhome_events;` → 0 (빈 테이블)
- [ ] `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='apartments_flat';` → 119

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

⚠️ **PR #1 머지 후 즉시 마이그 적용**: Supabase Studio SQL Editor 에서 두 SQL 파일 순서대로 (테이블 먼저 → VIEW 나중) 붙여넣기 실행. apply-migration.yml 은 SQL 출력만, 실제 실행은 수동.

---

## PR #2 — 코드 (Task 3·4)

### Task 3: 수집기 `collect-applyhome.mjs` 수정

**Files:**
- Modify: `scripts/collectors/collect-applyhome.mjs`

- [ ] **Step 3-1: 순수 함수 `buildEventsFromAggregated` export 추가**

`scripts/collectors/collect-applyhome.mjs` 의 기존 `aggregateByApartment` (L54-86) 다음에 추가:

```js
// 매칭된 단지만 events 배열로 변환 (순수 함수, DB 호출 없음 — 단위 테스트용)
export function buildEventsFromAggregated(aggregated, apartments, recordedAt) {
  const aptSet = new Set(apartments.map(a => a.id));
  const events = [];
  for (const [no, agg] of Object.entries(aggregated)) {
    const aptId = `ah-${no}`;
    if (!aptSet.has(aptId)) continue;
    events.push({
      apartment_id: aptId,
      house_manage_no: no,
      supply: agg.supply,
      applicants: agg.applicants,
      rate: agg.rate,
      recorded_at: recordedAt,
    });
  }
  return events;
}
```

- [ ] **Step 3-2: import 라인에 `upsertBatch` 추가**

Modify `scripts/collectors/collect-applyhome.mjs` L15:

```js
// Before:
import { loadEnv, getSupabase, log, logError, createReporter, selectAll } from "./_shared.mjs";

// After:
import { loadEnv, getSupabase, log, logError, createReporter, selectAll, upsertBatch } from "./_shared.mjs";
```

- [ ] **Step 3-3: 5% 경고 + exit(1) — `aggregateByApartment` 직후, update 루프 진입 전**

`main()` 안의 `const aggregated = aggregateByApartment(rows);` (L107) 다음, `const apartments = await selectAll(...)` (L112) 진입 전에 삽입:

```js
// 5% 경고: 청약홈 API 필드명 변경 조기 감지
// ⚠️ 위치 = aggregate 직후 + update 루프 진입 전. 이 시점에는 DB 쓰기 0 → exit(1) 안전.
const totalAggregated = Object.keys(aggregated).length;
const zeroSupplyCount = Object.values(aggregated)
  .filter(a => a.supply === 0).length;
const zeroRatio = totalAggregated > 0 ? zeroSupplyCount / totalAggregated : 0;
if (zeroRatio > 0.05) {
  logError(PHASE, `⚠️ supply=0 비율 ${(zeroRatio * 100).toFixed(1)}% (${zeroSupplyCount}/${totalAggregated}) — 청약홈 API 필드명 변경 가능성. odcloud 응답 1건 샘플 확인 필요.`);
  process.exit(1);
}
```

- [ ] **Step 3-4: events 누적 + upsertBatch 적재 추가**

`main()` 의 update 루프 (L120-143) 안에 events 누적 추가, 루프 종료 후 upsertBatch 호출 추가.

루프 변경 (L120-143):
```js
const events = [];     // ← 추가
for (const [no, agg] of Object.entries(aggregated)) {
  const aptId = `ah-${no}`;
  if (!aptSet.has(aptId)) continue;
  matched++;

  if (dryRun) {
    const rateStr = agg.rate != null
      ? (agg.rate < 0 ? `미달(${(Math.abs(agg.rate) * 100).toFixed(0)}%)` : `${agg.rate}:1`)
      : "null";
    log(PHASE, `  [DRY-RUN] ${aptId}: ${rateStr} (공급:${agg.supply} 신청:${agg.applicants})`);
    rpt.success(1);
    continue;
  }

  const { error: updErr } = await sb.from("apartments").update({
    competition_rate: agg.rate,
    competition_supply: agg.supply,
    competition_applicants: agg.applicants,
    updated_at: new Date().toISOString(),
  }).eq("id", aptId);

  if (updErr) { logError(PHASE, `  ${aptId} UPDATE 실패: ${updErr.message}`); rpt.fail(1); continue; }
  rpt.success(1);

  // ── 신규: events 객체 누적 (apartments.update 성공 시에만) ──
  events.push({
    apartment_id: aptId,
    house_manage_no: no,
    supply: agg.supply,
    applicants: agg.applicants,
    rate: agg.rate,
    recorded_at: new Date().toISOString().slice(0, 10),
  });
}

// 루프 종료 후 일괄 upsert (dry-run 모드 아닐 때만)
if (!dryRun && events.length > 0) {
  const inserted = await upsertBatch(
    "applyhome_events",
    events,
    "apartment_id,house_manage_no",
    500,
    sb,
  );
  const failed = events.length - inserted;
  if (failed > 0) rpt.fail(failed);
  // 추가 PHASE 로그 불필요: upsertBatch 내부가 이미
  // "applyhome_events: ${inserted}/${rows.length}건 upsert" 출력
}
```

- [ ] **Step 3-5: dry-run 검증**

Run: `node scripts/collectors/collect-applyhome.mjs --dry-run 2>&1 | tail -5`

Expected: `매칭: 1263/1314건` 동일 출력. 에러 0. dry-run 이라 events upsert 호출 안 됨.

- [ ] **Step 3-6: 커밋**

Run:
```bash
git add scripts/collectors/collect-applyhome.mjs
git commit -m "feat(collector): persist applyhome events as time-series + 5% guard"
```

---

### Task 4: API sanitize 화이트리스트 보강

**Files:**
- Modify: `api/supabase/apartments.js` (sanitizeRegion 함수 +2 필드)
- Modify: `api/supabase/apartments.test.js` (expectedKeys 배열 +2)
- Modify: `src/constants/fieldMeta.js` (필드 정의 +2 + section fields 배열 +2)

- [ ] **Step 4-1: `apartments.js sanitizeRegion()` 에 신규 2필드 추가**

Modify `api/supabase/apartments.js` L266-270 (`sanitizeRegion` 함수의 청약 경쟁률 그룹 다음):

```js
// Before (L266-270):
    // 청약 경쟁률
    competitionRate: row.competitionRate ?? null,
    competitionSupply: row.competitionSupply ?? null,
    competitionApplicants: row.competitionApplicants ?? null,
  };
}

// After:
    // 청약 경쟁률
    competitionRate: row.competitionRate ?? null,
    competitionSupply: row.competitionSupply ?? null,
    competitionApplicants: row.competitionApplicants ?? null,
    // 무순위 공고 이벤트 (apartments_flat LEFT JOIN ae)
    unsoldEventCount: row.unsoldEventCount ?? 0,
    lastUnsoldEventAt: row.lastUnsoldEventAt ?? null,
  };
}
```

- [ ] **Step 4-2: `apartments.test.js expectedKeys` 배열에 신규 2필드 추가**

Modify `api/supabase/apartments.test.js` L380-381 (청약 경쟁률 그룹 다음):

```js
// Before:
      // 청약 경쟁률
      'competitionRate', 'competitionSupply', 'competitionApplicants',

// After:
      // 청약 경쟁률
      'competitionRate', 'competitionSupply', 'competitionApplicants',
      // 무순위 이벤트
      'unsoldEventCount', 'lastUnsoldEventAt',
```

- [ ] **Step 4-3: `fieldMeta.js` 신규 2필드 정의 추가**

Modify `src/constants/fieldMeta.js`. L54 (`competitionRate` 정의) 다음에 추가:

```js
// L54 부근, competitionRate 그룹 다음에 추가:
  unsoldEventCount: { label: "무순위 공고 횟수", section: "안전", fmt: v => (v ?? 0) > 0 ? `${v}회` : "—" },
  lastUnsoldEventAt: { label: "최근 무순위 공고일", section: "안전", fmt: v => v ? new Date(v).toLocaleDateString("ko-KR") : "—" },
```

- [ ] **Step 4-4: `fieldMeta.js` "안전" 섹션 fields 배열에 신규 2필드 추가**

Modify `src/constants/fieldMeta.js` L174:

```js
// Before:
{ key: "안전", label: "안전도/리스크", fields: ["unsoldRate","competitionRate","competitionSupply","competitionApplicants","crimeSafetyGrade","recentTrades6m","cancelRatio6m","supplyRatio","builderCreditGrade","builderDebtRatio","hugGuarantee","isRegulated","dsr40pass","popGrowth","newSupply","initialSaleRate"] },

// After (competitionApplicants 다음에 unsoldEventCount/lastUnsoldEventAt 삽입):
{ key: "안전", label: "안전도/리스크", fields: ["unsoldRate","competitionRate","competitionSupply","competitionApplicants","unsoldEventCount","lastUnsoldEventAt","crimeSafetyGrade","recentTrades6m","cancelRatio6m","supplyRatio","builderCreditGrade","builderDebtRatio","hugGuarantee","isRegulated","dsr40pass","popGrowth","newSupply","initialSaleRate"] },
```

- [ ] **Step 4-5: 테스트 실행 (회귀 확인)**

Run: `npm run test -- apartments`

Expected: 모든 테스트 통과. 특히 `'sanitize()는 전체 필드를 반환한다'` 테스트가 신규 2필드 포함해 통과.

- [ ] **Step 4-6: 커밋**

Run:
```bash
git add api/supabase/apartments.js api/supabase/apartments.test.js src/constants/fieldMeta.js
git commit -m "feat(api): expose unsoldEventCount/lastUnsoldEventAt via sanitize whitelist"
```

- [ ] **Step 4-7: PR #2 push (코드+BFF 묶음)**

Run:
```bash
git push
gh pr create --title "feat: applyhome events 수집기 + BFF sanitize 보강" --body "$(cat <<'EOF'
## Summary
- 수집기 `collect-applyhome.mjs` 가 events 시계열 적재 (`upsertBatch` + 5% 경고)
- `apartments.js sanitize()` 신규 2필드 화이트리스트 추가
- `fieldMeta.js` "안전" 섹션에 신규 2필드 등록

## Test plan
- [ ] dry-run: `node scripts/collectors/collect-applyhome.mjs --dry-run` → 매칭률 동일
- [ ] `npm run test -- apartments` → 통과
- [ ] PR #1 머지 + 마이그 적용 후 실제 적재: `node scripts/collectors/collect-applyhome.mjs` → 1263 적재
- [ ] DB 확인: `SELECT COUNT(*) FROM applyhome_events;` → 1263

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

⚠️ **PR #2 머지 후 즉시 수동 적재 1회 필수**: `node scripts/collectors/collect-applyhome.mjs` 실행. 건너뛰면 다음 월요일 11:30 KST cron 까지 events 0행 → 모든 단지 unsoldEventCount=0 → "추가 모집" 배지 0건 (최대 7일).

---

## PR #3 — UI + 테스트 (Task 5·6)

### Task 5: AptCard "추가 모집" 배지 추가

**Files:**
- Modify: `src/components/AptCard.jsx`
- Modify: `src/__tests__/factories.js`

- [ ] **Step 5-1: AptCard alertRow 표시 조건에 OR 추가**

Modify `src/components/AptCard.jsx` L121:

```jsx
// Before:
{(apt.completion || (apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD || noxCount > 0 || apt.presaleStage || (apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade)) || (apt.crimeSafetyGrade != null && apt.crimeSafetyGrade >= 4)) && (

// After (OR 끝에 추가):
{(apt.completion || (apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD || noxCount > 0 || apt.presaleStage || (apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade)) || (apt.crimeSafetyGrade != null && apt.crimeSafetyGrade >= 4) || (apt.unsoldEventCount > 0 && apt.id?.startsWith("ah-"))) && (
```

- [ ] **Step 5-2: AptCard alertRow 안에 "추가 모집" 배지 JSX 추가**

`src/components/AptCard.jsx` 의 crimeSafetyGrade 배지 (L142-143) 다음에 추가:

```jsx
{apt.crimeSafetyGrade != null && apt.crimeSafetyGrade >= 4 && (
  <span style={{ ...S.alertTag, background: apt.crimeSafetyGrade >= 5 ? C.redLight : C.amberLight, color: apt.crimeSafetyGrade >= 5 ? C.red : C.amber }}>{apt.crimeSafetyGrade >= 5 ? "치안위험" : "치안주의"}</span>
)}

{/* 신규: 추가 모집 배지 (ah- 단지만, naver- 단지의 0은 정보 없음) */}
{apt.unsoldEventCount > 0 && apt.id?.startsWith("ah-") && (
  <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>
    추가 모집
  </span>
)}
```

⚠️ React.memo comparator (L158-167) 는 손대지 않음 — 기존 alertRow 5개 필드와 일관 (의도된 누락 패턴, 별도 트랙 BACKLOG).

- [ ] **Step 5-3: factories.js makeApt 기본값 추가**

Modify `src/__tests__/factories.js` `makeApt()` 의 기본값 객체에 추가 (예: presaleStage 다음 줄):

```js
// 기본값 객체 안 어디든:
unsoldEventCount: 0,
```

- [ ] **Step 5-4: 빌드·기존 테스트 회귀 확인**

Run:
```bash
npm run test -- AptCard
npm run build
```

Expected: AptCard 기존 테스트 통과 + 빌드 성공.

- [ ] **Step 5-5: 커밋**

Run:
```bash
git add src/components/AptCard.jsx src/__tests__/factories.js
git commit -m "feat(ui): show '추가 모집' badge on apartment cards"
```

---

### Task 6: 테스트 추가 (수집기 3건 + AptCard 3건)

**Files:**
- Modify: `scripts/collectors/collect-applyhome.test.mjs`
- Modify: `src/components/AptCard.test.jsx`

- [ ] **Step 6-1: 수집기 mock 에 selectAll/upsertBatch 추가**

Modify `scripts/collectors/collect-applyhome.test.mjs` L6-19:

```js
// Before:
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});

// After (selectAll, upsertBatch 추가):
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    selectAll: vi.fn(),
    upsertBatch: vi.fn(async (_t, rows) => rows.length),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});
```

- [ ] **Step 6-2: import 추가**

`scripts/collectors/collect-applyhome.test.mjs` L21 (existing `aggregateByApartment` import 다음):

```js
// Before:
const { aggregateByApartment } = await import("./collect-applyhome.mjs");

// After:
const { aggregateByApartment, buildEventsFromAggregated } = await import("./collect-applyhome.mjs");
```

- [ ] **Step 6-3: 수집기 테스트 3건 추가**

`scripts/collectors/collect-applyhome.test.mjs` 파일 끝에 추가:

```js
describe("buildEventsFromAggregated — events 객체 빌드", () => {
  it("매칭된 단지만 events 반환 (apartment_id 형식 ah-{no})", () => {
    const aggregated = {
      "2024A": { rate: 5, supply: 100, applicants: 500 },
      "2024B": { rate: 3, supply: 50, applicants: 150 },
      "2024X": { rate: 1, supply: 30, applicants: 30 }, // 매칭 안 됨
    };
    const apartments = [{ id: "ah-2024A" }, { id: "ah-2024B" }];
    const result = buildEventsFromAggregated(aggregated, apartments, "2026-05-02");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      apartment_id: "ah-2024A",
      house_manage_no: "2024A",
      supply: 100,
      applicants: 500,
      rate: 5,
      recorded_at: "2026-05-02",
    });
    expect(result[1].apartment_id).toBe("ah-2024B");
  });

  it("빈 입력 처리", () => {
    expect(buildEventsFromAggregated({}, [], "2026-05-02")).toEqual([]);
    expect(buildEventsFromAggregated({}, [{ id: "ah-X" }], "2026-05-02")).toEqual([]);
    expect(buildEventsFromAggregated({ "X": { supply: 1, applicants: 1, rate: 1 } }, [], "2026-05-02")).toEqual([]);
  });

  it("필드 매핑 정확성 (supply/applicants/rate/recorded_at 모두 정확히 들어감)", () => {
    const aggregated = { "Y": { supply: 7, applicants: 13, rate: 1.857 } };
    const apartments = [{ id: "ah-Y" }];
    const result = buildEventsFromAggregated(aggregated, apartments, "2026-12-31");

    expect(result).toEqual([{
      apartment_id: "ah-Y",
      house_manage_no: "Y",
      supply: 7,
      applicants: 13,
      rate: 1.857,
      recorded_at: "2026-12-31",
    }]);
  });
});
```

- [ ] **Step 6-4: 수집기 테스트 실행**

Run: `npm run test -- collect-applyhome`

Expected: 기존 8건 + 신규 3건 = 11건 통과.

- [ ] **Step 6-5: AptCard 테스트 3건 추가**

Modify `src/components/AptCard.test.jsx` 파일 끝(또는 적절한 describe 블록)에 추가:

```jsx
describe("AptCard — '추가 모집' 배지", () => {
  it("unsoldEventCount > 0 + ah- 단지면 '추가 모집' 배지 표시", () => {
    const apt = makeApt({ id: "ah-100", unsoldEventCount: 5 });
    render(<AptCard {...makeAptCardProps({ apt })} />);
    expect(screen.getByText("추가 모집")).toBeInTheDocument();
  });

  it("unsoldEventCount = 0 이면 배지 미표시", () => {
    const apt = makeApt({ id: "ah-100", unsoldEventCount: 0 });
    render(<AptCard {...makeAptCardProps({ apt })} />);
    expect(screen.queryByText("추가 모집")).toBeNull();
  });

  it("naver- 단지 (id prefix 가드) 면 배지 미표시 (정보 없음)", () => {
    const apt = makeApt({ id: "naver-9999", unsoldEventCount: 5 });
    render(<AptCard {...makeAptCardProps({ apt })} />);
    expect(screen.queryByText("추가 모집")).toBeNull();
  });
});
```

⚠️ `makeAptCardProps` 가 기존 AptCard.test.jsx 에 있는 helper 가정. 없으면 기존 테스트 케이스의 props 구조를 그대로 따라 명시.

- [ ] **Step 6-6: AptCard 테스트 실행**

Run: `npm run test -- AptCard`

Expected: 기존 + 신규 3건 모두 통과.

- [ ] **Step 6-7: 전체 테스트 회귀 확인**

Run: `npm run test`

Expected: 전체 테스트 통과.

- [ ] **Step 6-8: 커밋**

Run:
```bash
git add scripts/collectors/collect-applyhome.test.mjs src/components/AptCard.test.jsx
git commit -m "test: cover buildEventsFromAggregated and AptCard '추가 모집' badge"
```

- [ ] **Step 6-9: PR #3 push (UI+테스트 묶음)**

Run:
```bash
git push
gh pr create --title "feat(ui): '추가 모집' 배지 + 단위 테스트 7건" --body "$(cat <<'EOF'
## Summary
- AptCard alertRow 에 "추가 모집" red 배지 1개 (unsoldEventCount > 0 && ah- 단지)
- 단위 테스트 7건 (수집기 3 + AptCard 3 + 기존 회귀 1)
- factories.js makeApt 에 unsoldEventCount: 0 기본값

## Test plan
- [ ] `npm run test` → 전체 통과
- [ ] `npm run dev` 후 브라우저에서 확인:
  - 무순위 공고 있는 ah- 단지 → "추가 모집" red 배지 보임
  - 무순위 0 ah- 단지 → 배지 미표시
  - naver- 단지 → 배지 미표시

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 통합 검증 (PR #1·#2·#3 모두 머지 + 마이그·적재 완료 후)

- [ ] **Step V-1: 마이그 적용 확인 (이미 PR #1·#2 머지 시점에 완료 가정)**

Supabase Studio SQL:
```sql
-- (a) 테이블 존재
SELECT COUNT(*) FROM applyhome_events;
-- → 1263 (PR #2 적재 후)

-- (b) VIEW 컬럼 수
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'apartments_flat';
-- → 119

-- (c) 컬럼명 누락 진단 (어느 컬럼이 빠졌는지 정확히 잡음)
WITH expected AS (
  SELECT col FROM (VALUES
    -- 직전 VIEW 마이그 (20260419000000) 의 117개 alias 전체 + 신규 2개
    -- 마이그 작성 시 grep -oE 'AS\s+"[a-zA-Z_]+"' 로 자동 추출
    ('id'), ('name'), ('dong'), ('gu'), ('region'), ('lat'), ('lng'),
    -- ... (여기 117개 박제 — Task 2-2 작성 시 함께 박제)
    ('unsoldEventCount'), ('lastUnsoldEventAt')
  ) AS t(col)
),
actual AS (
  SELECT column_name AS col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'apartments_flat'
)
SELECT 'MISSING' AS kind, col FROM expected WHERE col NOT IN (SELECT col FROM actual)
UNION ALL
SELECT 'EXTRA' AS kind, col FROM actual WHERE col NOT IN (SELECT col FROM expected);
-- → 결과 0행이 정상

-- (d) 멱등성 (한 번 더 적재해도 동일 1263)
-- → 수동: node scripts/collectors/collect-applyhome.mjs 한 번 더 실행
SELECT COUNT(*) FROM applyhome_events;
-- → 여전히 1263

-- (e) 중복 행 0
SELECT apartment_id, COUNT(*)
  FROM applyhome_events
 GROUP BY apartment_id
 HAVING COUNT(*) > 1;
-- → 첫 적재 시 0행

-- (f) 네이버 단지 0 의 의미 확인
SELECT COUNT(*) AS naver_with_zero
  FROM apartments_flat
 WHERE id LIKE 'naver-%' AND "unsoldEventCount" = 0;
-- → 네이버 단지 전부 0 (실제 무순위 0회 아니라 "정보 없음")
```

- [ ] **Step V-2: UI 스모크 (브라우저 3 케이스)**

Run: `npm run dev`

브라우저에서 확인:
- (a) 무순위 공고 있는 ah- 단지(예: ah-2026910015) → "추가 모집" red 배지 보임
- (b) 무순위 공고 없는 ah- 단지(unsoldEventCount=0) → 배지 미표시
- (c) 네이버 단지(naver-XXXXX) → unsoldEventCount=0 이지만 prefix 가드로 배지 미표시
- (d) 모바일 (375px) → alertRow flexWrap 자동 줄바꿈 정상

- [ ] **Step V-3: 배치 적재 부분 실패 확인**

수집기 실행 로그에서 grep:
- `applyhome_events: N/M건 upsert` (upsertBatch 내부 자동 출력) — N == M 이면 ✅
- `개별 재시도: X/Y 성공` (배치 실패 시에만)

N < M 이면 실패 단지는 다음 cron 재시도 (UNIQUE 멱등성으로 안전).

---

## 후속 작업 (BACKLOG.md 등재)

세션 종료 직전 `.claude/BACKLOG.md` 에 추가:

```markdown
- 🟡 무순위 이벤트 로그 화면 노출 — applyhome_events 누적 1~2개월 후
  - DetailModal 무순위 차수·이력 섹션
  - AptCard 무순위 배지 (count >= 2일 때만 — 차수 시그널)
  - 시계열 차트 (MarketStatsCharts 패턴 재사용)
  - 트리거: 같은 apartment_id 2회+ 행 발생 (월 1회 쿼리로 모니터)

- 🟢 React.memo comparator 일괄 점검 — alertRow 신호 6개 필드 + 다른 컴포넌트 memo
  - AptCard L158-167: 누락 5개 필드(completion / unsoldRate / presaleStage / crimeSafetyGrade / builderCreditGrade) + 신규 unsoldEventCount = 6개 일괄 추가
  - 동일 패턴 점검 대상: CompareSheet / DetailModal / MapView / SelectedAptCard memo comparator
  - 단위 테스트: 각 필드 변경 시 리렌더 트리거 확인 (현재 AptCard memo 단위 테스트 0건)
  - 트리거: AptCard / 다른 카드 컴포넌트의 memo 회귀 사고 발생 시 또는 분기 점검 작업
  - 발견 경위: 청약홈 무순위 이벤트 로그 작업(2026-05-02 세션 159) 9차 GATE 검증에서 comparator 일관 누락 패턴 식별
```
