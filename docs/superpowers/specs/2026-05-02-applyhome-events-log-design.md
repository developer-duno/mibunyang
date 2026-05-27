# 청약홈 무순위 공고 이벤트 로그 설계

> 2026-05-02 세션 159 · 미분양 신호 우회 수집 트랙 B
> BACKLOG.md 방향 B 재오픈 트리거 (2) 발동

---

## 한눈 요약 (TL;DR)

**한 줄로 뭐 하는 작업인가:** 청약홈 무순위 공고를 시계열로 적재해서 "이 단지는 추가 모집했다"는 신호를 단지 카드에 빨간 배지로 표시.

**왜 필요한가:** 단지별 미분양량을 직접 주는 공식 API 가 없음 (전부 시군구 단위). 무순위 공고 누적이 단지 단위 미분양 신호를 제공하는 첫 실용적 우회로.

**즉시 사용자 가치:** 첫 적재로 1,263개 단지에 "추가 모집" 빨간 배지 노출. 1~2개월 누적 후 차수·시계열 가공 추가.

**스펙 검증 상태:** 9 GATE × 9 라운드 누적 검증 통과. 모든 차단급(🔴) 해소, 잔여 🟡 항목은 별 트랙으로 BACKLOG 박제.

### 작업 6단계 — DB → 수집기 → BFF → UI → 테스트 흐름

```
[§ 1] 신규 테이블 마이그        → applyhome_events (시계열, UNIQUE 제약)
        ↓
[§ 2] apartments_flat VIEW 확장 → unsoldEventCount / lastUnsoldEventAt 컬럼 노출
        ↓
[§ 3] 수집기 collect-applyhome  → events 시계열 적재 (upsertBatch + 5% 경고)
        ↓
[§ 4] API sanitize 화이트리스트  → apartments.js + apartments.test.js + fieldMeta.js
        ↓
[§ 5] AptCard "추가 모집" 배지   → alertRow 안에 redLight 배지 1개
        ↓
[§ 6] 테스트 7건 추가             → 단위 테스트 (수집기 3 + UI 3 + BFF 1)
```

### 핵심 의사결정 (9차 합의)

| 결정 | 선택 | 거부한 옵션·이유 |
|------|------|---------------|
| 이벤트 단위 | 공고관리번호별 1행 | 월별 합산: 차수 식별 손실 |
| 미매칭 단지 | matched만 적재 (96.1%) | 전부 적재 + apartment_id NULL: 백필 트리거 불명 |
| 화면 노출 | AptCard 배지 1개 즉시 | DetailModal 시계열 차트: 차수 누적 1~2개월 후 의미 |
| 색상 | redLight/red (위험) | amberLight/amber: 이미 5가지 의미 산재 |
| 텍스트 | "추가 모집" (가시 라벨) | "무순위 공고": 일반인 이해도↓ |
| 적재 방식 | `upsertBatch` 배치 + 멱등성 | 개별 upsert: 부분 적용 위험 |
| 5% 경고 | aggregate 직후 + `exit(1)` | Slack 알림: 본 작업 외 인프라 |
| 마이그 트랜잭션 | BEGIN/COMMIT 없음 (평면) | 트랜잭션 래핑: 기존 6개 신규 테이블 일관성 위반 |

### 운영 의미 (반드시 박제)

| # | 항목 | 핵심 |
|---|------|------|
| 1 | 단일 vs 시계열 | `apartments.competition_rate`(스냅샷) ≠ `applyhome_events`(시계열). 합치려 하지 말 것 |
| 2 | update 실패 비대칭 | apartments.update 실패한 단지는 events 도 미누적 (의도된 단순화) |
| 3 | 네이버 단지 0의 의미 | naver-{N} 단지의 `unsoldEventCount=0` 은 "정보 없음" (실제 0회 아님). 화면 가드 필수 |
| 4 | 동시 실행 안전 | concurrency group + UNIQUE 멱등성 = 이중 보호 |

### 주요 위험 박제

- **🔴 5% 경고 위치**: `aggregateByApartment` 직후 + `apartments.update` 루프 진입 전 (§ 3)
- **🔴 sanitize() 누락**: VIEW만 바꾸면 화면 안 보임. 11개 helper 패턴 화이트리스트라 명시 추가 필수 (§ 4)
- **🔴 롤백 SELECT 본문 박제**: 가이드만 두면 비상 시 syntax error. 직전 VIEW SQL 통째로 박제 (§ 2)

### 용어 정의

| 표현 | 위치 | 의미 |
|------|------|------|
| **"무순위 공고"** | 본문/SQL/운영 보고 | 청약홈 공식 데이터 명칭 |
| **"추가 모집"** | AptCard 배지 (가시 라벨) | 사용자 이해 쉬운 표현 (네이버 부동산 표준) |
| **`unsoldEventCount`** | DB·코드 식별자 | 무순위 공고 누적 횟수. naver- 단지는 항상 0 (정보 없음) |
| **`HOUSE_MANAGE_NO`** | 청약홈 API 필드 | 공고 1건당 1번호. 차수 식별 키 |

### 검증 체크리스트 (12단계)

마이그 적용 → dry-run → 단위 테스트 → 실제 적재 → DB 확인 → VIEW 확장 확인 → 멱등성 → 부분 실패 로그 → 컬럼 수 카운트 → 컬럼명 누락 진단 → UI 스모크 → AptCard 회귀 테스트.

---

## Context

미분양 데이터의 가장 큰 한계는 **단지 단위 미분양량을 직접 주는 공식 API가 없다는 것**(세션 158 자료조사 확정). 모든 공식 통계가 시군구 단위 합계여서, 우리는 KOSIS 합계를 단지별로 비례배분(`calcProportionalUnsold`)할 수밖에 없었다.

이 갭을 우회 보강하는 첫 신호가 **청약홈 무순위 공고 누적**이다. 같은 단지가 1차/2차/3차 무순위를 반복해서 띄운다는 것은 그때마다 미계약 잔량이 발생했다는 뜻이고, 시간순으로 적재하면 단지별 "미분양 이벤트 로그"로 가공 가능하다.

기존 `collect-applyhome.mjs`는 매 호출마다 `apartments` 테이블의 `competition_rate/supply/applicants` 3컬럼을 **덮어쓴다** — 이력이 사라진다. 같은 단지가 두 번째 무순위를 띄우면 첫 번째 신호가 영영 손실된다. 이걸 시계열 적재로 바꾸는 게 본 작업의 핵심이다.

**측정 결과 (2026-05-02 dry-run):** 청약홈 API 1,314건 공고 중 **1,263건(96.1%)이 우리 `apartments` 테이블과 매칭**. 매칭률이 충분히 높아 "matched만 적재" (A안)로 안전하게 갈 수 있다.

**기대 효과:**
- 즉시: 단지별 무순위 차수 카운트 = 미분양 강도 1차 신호
- 1~3개월: 같은 단지 2차+ 무순위 발생 시 시계열 분석 가능
- 6개월+: 지역별 무순위 빈도 패턴 → KOSIS 비례배분의 검증 데이터로 활용 가능

## 결정 (브레인스토밍 합의)

| Q | 결정 | 이유 |
|---|------|------|
| Q1. 이벤트 단위 | **A. 공고관리번호별 1행** | API 자연 단위, 차수 정보 보존, 가공 손실 0 |
| Q2. 미매칭 처리 | **A. matched만 적재** | dry-run 매칭률 96.1%로 충분, NULL 행 누적 회피 |

## 용어 정의 (스펙 내 일관성)

본 스펙에 두 표현이 의도적으로 공존. 독자 혼동 방지용으로 정확한 구분:

| 용어 | 위치 | 의미 |
|------|------|------|
| **"무순위 공고"** | 스펙 본문 / 데이터 모델 / 검증 쿼리 | 청약홈 API 가 부르는 공식 데이터 명칭. `unsoldEventCount` 가 표현하는 것 |
| **"추가 모집"** | AptCard 배지 텍스트 (사용자 가시 라벨) | 일반 사용자가 이해하기 쉬운 표현. 네이버 부동산 표준 |

따라서 `unsoldEventCount > 0` 이면 화면에는 "추가 모집" 배지가 보이지만, 운영 보고/문서/SQL 에서는 "무순위 공고" 표현 그대로 사용. 두 표현이 같은 데이터를 가리킴.

## 아키텍처

```
청약홈 API (getRemndrLttotPblancCmpet)
  ↓ collect-applyhome.mjs (수정: aggregate 결과를 시계열 테이블에도 적재)
  ↓
applyhome_events (신규 테이블, 시계열)
  └─ UNIQUE(apartment_id, house_manage_no)
  ↓
apartments_flat VIEW (확장: 무순위 차수·최신 공고일 노출)
  ↓
DetailModal · AptCard (세션 159 작업 범위 외, BACKLOG로 이월)
```

**기존 동작 유지 (불변):**
- `collect-applyhome.mjs`가 `apartments.competition_rate/supply/applicants` 덮어쓰는 동작 → 그대로 유지 (최신 스냅샷 캐시 역할). 기존 컴포넌트·VIEW가 의존 중.

**추가 동작:**
- 같은 함수 종료 직전, `aggregateByApartment` 결과를 `applyhome_events` 테이블에도 upsert. UNIQUE 제약으로 같은 공고 재실행 시 update, 새 공고면 insert.

## 컴포넌트 (이번 세션 작업 범위)

### 1. 신규 마이그레이션
**파일:** `supabase/migrations/20260502000000_create_applyhome_events.sql`

```sql
-- BEGIN/COMMIT 사용 안 함: 기존 신규 테이블 마이그(consults / api_quota_log /
-- market_stats_history / add_competition_rate) 모두 평면 SQL. Supabase가 자동 적용.

CREATE TABLE applyhome_events (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,         -- 청약홈 공고관리번호 (HOUSE_MANAGE_NO)
  supply INTEGER NOT NULL,                -- 가중평균 분자
  applicants INTEGER NOT NULL,            -- 가중평균 분모
  rate REAL,                              -- 경쟁률 (>1 경쟁, <1 미달, NULL 미수집)
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(apartment_id, house_manage_no)
);

CREATE INDEX idx_applyhome_events_apt ON applyhome_events(apartment_id, recorded_at DESC);
CREATE INDEX idx_applyhome_events_recorded ON applyhome_events(recorded_at DESC);

COMMENT ON TABLE applyhome_events IS '청약홈 무순위/잔여세대 공고 이벤트 로그. 같은 단지 2회+ 출현 = 미분양 시그널';
COMMENT ON COLUMN applyhome_events.house_manage_no IS '청약홈 HOUSE_MANAGE_NO. 공고 1건당 1번호 → 차수 식별';
COMMENT ON COLUMN applyhome_events.recorded_at IS '수집기 실행일 (공고일 아님 — API에 공고일 필드 없음)';

-- RLS (시계열 테이블 표준: Public read + Service write — market_stats_history 패턴)
ALTER TABLE applyhome_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON applyhome_events FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_events FOR ALL USING (auth.role() = 'service_role');

-- NOTIFY pgrst: 신규 테이블 마이그(consults/api_quota_log/market_stats_history)는
-- 모두 NOTIFY 호출 안 함. PostgREST 가 자동 감지. 일관성 위해 생략.
```

**SERIAL 결정:** 기존 시계열 6개(prices, unsold_history, trades, regions, complex_price_history, consults) 모두 SERIAL. 일관성 우선. 월 +1~2k 행 → SERIAL 한도(21억) 천년 이상.

**`supabase/schema.sql` 미동기 정책:** 본 프로젝트는 schema.sql 에 **apartments_flat VIEW 만 동기**, 신규 테이블 정의는 마이그 파일에만 보관. supabase/CLAUDE.md L7 명시: "schema.sql snapshot 미동기, 운영에는 영향 없음" — 직전 신규 테이블 4개(`market_stats_history`, `api_quota_log`, `consults`, `articles` 등) 모두 schema.sql 미반영. 본 작업 `applyhome_events` 도 동일 정책 따름. **schema.sql 에 추가 안 함**. apartments_flat VIEW 변경은 § 2 마이그에서 처리되므로 별도 schema.sql 갱신 불필요.

**롤백:** `supabase/migrations/_rollbacks/20260502000001_rollback_create_applyhome_events.sql`

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

### 2. `apartments_flat` VIEW 확장
**파일:** `supabase/migrations/20260502100000_view_add_applyhome_events.sql`

신규 컬럼 2개 (camelCase alias):
- `unsoldEventCount INTEGER` — 단지별 누적 무순위 공고 수 (`COUNT(*) FROM applyhome_events`)
- `lastUnsoldEventAt DATE` — 가장 최근 공고 수집일 (`MAX(recorded_at)`)

기존 컬럼·dataReliability 공식 변경 없음. NOTIFY pgrst 는 호출 안 함 — 기존 VIEW 마이그 3개(`20260415044846` / `20260416000000` / `20260419000000`) 모두 미호출이고 PostgREST가 자동 감지함.

**구현 패턴 (기존 `20260419000000_view_dedup_prefer_general.sql` 따름):**

기존 VIEW 마이그 3개(`20260415044846` / `20260416000000` / `20260419000000`) 모두 **BEGIN/COMMIT 없음, NOTIFY pgrst 없음**. 동일하게 가야 일관성 유지.

```sql
-- BEGIN/COMMIT 사용 안 함 (기존 VIEW 마이그 패턴).
-- NOTIFY pgrst 호출 안 함 (기존 VIEW 마이그 패턴 — PostgREST 자동 감지).

DROP VIEW IF EXISTS apartments_flat;

CREATE OR REPLACE VIEW apartments_flat AS
WITH dedup_ranked AS (...),       -- 직전 마이그(20260419000000) CTE 전체 그대로 복사
     latest_prices AS (...),
     latest_regions AS (...)
SELECT
  -- ── 기존 컬럼 117개 전부 그대로 (직전 마이그 SELECT 블록 통째로 복사) ──
  a.id, a.name, ... a.competition_applicants AS "competitionApplicants",
  ... -- dataReliability 공식 포함, 변경 없음
  -- ── 신규 2컬럼 SELECT 끝에 추가 ──
  COALESCE(ae.event_count, 0) AS "unsoldEventCount",
  ae.last_event_at              AS "lastUnsoldEventAt"
FROM deduped a
LEFT JOIN latest_prices p ON ...   -- 직전 마이그 LEFT JOIN 전부 그대로
LEFT JOIN infra i ON ...
LEFT JOIN schools sc ON ...
LEFT JOIN transport t ON ...
LEFT JOIN builders b ON ...
LEFT JOIN latest_regions r ON ...
LEFT JOIN trade_stats ts ON ...
-- ── 신규 LEFT JOIN 끝에 추가 ──
LEFT JOIN (
  SELECT apartment_id,
         COUNT(*)         AS event_count,
         MAX(recorded_at) AS last_event_at
    FROM applyhome_events
   GROUP BY apartment_id
) ae ON ae.apartment_id = a.id;
```

**⚠️ 작성 시 주의:** 기존 VIEW 컬럼 117개를 한 줄도 빠짐없이 복사해야 함. 누락 1개라도 → `apartments_flat.select("*")` 의존하는 화면·스코어링·sanitize 깨짐. 검증 단계 9 (`information_schema.columns` 카운트) 로 자동 감지 필수.

**왜 GROUP BY 서브쿼리:** `apartments_flat`는 행 단위가 `a.id` 1개라 GROUP BY 결과를 LEFT JOIN으로 붙이면 1:1 안전. 기존 `latest_prices`/`latest_regions` CTE도 동일 1:1 패턴. LATERAL은 불필요.

**롤백:** `supabase/migrations/_rollbacks/20260502100001_rollback_view_add_applyhome_events.sql`

기존 `_rollbacks/` 2개 파일(`20260416000001`, `20260419000001`) 모두 SELECT 본문 229~230줄 **완전 박제** 패턴. 우리도 동일하게 박제 — 가이드 주석만 두면 비상 시 syntax error 로 실행 불가.

```sql
-- 롤백용 마이그레이션 — apartments_flat VIEW 에서 신규 2컬럼 제거.
-- ⚠️ 미적용. 비상용. 직전 VIEW 마이그(20260419000000_view_dedup_prefer_general.sql) 상태로 복원.
-- 사용법: Supabase SQL Editor 에서 이 파일 전체 실행. forward 마이그 로그 수동 삭제.
--
-- ⚠️ 실행 순서: 이 파일을 먼저 실행한 뒤 테이블 롤백
--    (`20260502000001_rollback_create_applyhome_events.sql`) 실행. 반대 순서로 실행하면
--    apartments_flat 의 ae LEFT JOIN 이 깨진 상태로 남음.

DROP VIEW IF EXISTS apartments_flat;

-- ↓↓↓ 마이그 작성 시 20260419000000_view_dedup_prefer_general.sql 의
--     CREATE OR REPLACE VIEW 부터 마지막 세미콜론까지 전체(약 230줄) 통째로 복사 ↓↓↓
CREATE OR REPLACE VIEW apartments_flat AS
WITH dedup_ranked AS (...),       -- 20260419000000 CTE 전체 복사
     deduped AS (...),
     latest_prices AS (...),
     latest_regions AS (...)
SELECT
  -- 117개 컬럼 전부 (20260419000000 SELECT 블록 통째로 복사)
  a.id, ...
FROM deduped a
LEFT JOIN latest_prices p ON p.apartment_id = a.id
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id;
-- ↑↑↑ 통째로 복사 끝 (신규 LEFT JOIN ae 는 제외 — 신규 2컬럼이 사라지는 것이 본 롤백 목적) ↑↑↑
```

**왜 가이드만 두면 안 되나:** 운영자가 비상 시 이 파일을 그대로 실행하면 `CREATE VIEW … AS` 다음에 SELECT 본문이 없어서 syntax error. 마이그 작성 단계에서 직전 VIEW SQL을 통째로 복사해 박제해야 비상 시 즉시 실행 가능.

### 3. 수집기 수정
**파일:** `scripts/collectors/collect-applyhome.mjs`

**적재 방식: `_shared.mjs:upsertBatch` 재사용** (개별 upsert 아님). 기존 `apartments.update` 루프는 그대로 유지하고, 루프 내에서 events 객체를 누적한 뒤 루프 종료 후 1회 일괄 upsert.

```js
import { ..., upsertBatch } from "./_shared.mjs";   // 기존 import에 추가

// main() 루프 내 — events 누적 (dry-run에서는 누적 안 함)
const events = [];
for (const [no, agg] of Object.entries(aggregated)) {
  const aptId = `ah-${no}`;
  if (!aptSet.has(aptId)) continue;
  matched++;

  if (dryRun) {
    /* 기존 dry-run 로그 그대로 */
    rpt.success(1);
    continue;     // ← dry-run은 events.push 안 함
  }

  // ── 기존 apartments.update 그대로 유지 ──
  const { error: updErr } = await sb.from("apartments").update({ ... }).eq("id", aptId);
  if (updErr) { logError(...); rpt.fail(1); continue; }
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

// 루프 종료 후 일괄 upsert
if (!dryRun && events.length > 0) {
  const inserted = await upsertBatch(
    "applyhome_events",                     // table
    events,                                 // rows
    "apartment_id,house_manage_no",         // conflictCol (3번째 positional)
    500,                                    // batchSize
    sb,                                     // sb (5번째 positional)
  );
  const failed = events.length - inserted;
  if (failed > 0) rpt.fail(failed);
  // 추가 PHASE 로그 불필요: upsertBatch 내부 L124 가 이미
  // "applyhome_events: ${inserted}/${rows.length}건 upsert" 출력
}
```

**시그니처 주의 (`_shared.mjs:80`):** `upsertBatch(table, rows, conflictCol, batchSize, sb, options)` — **positional 인자**, 옵션 객체 아님. 반환값은 `inserted` 숫자 1개. `failed` 는 호출자에서 `rows.length - inserted` 로 계산. 다른 수집기 4곳(`collect-trades:251`, `collect-unsold-kosis:279`, `naver-listings:466`, `naver-presale:695/701`) 동일 호출 패턴.

**왜 `upsertBatch`:**
- 기존 `_shared.mjs:upsertBatch` 가 (1) 100ms 배치 간격 (2) 429 재시도 3회 (3) 배치 실패 시 개별 재시도까지 자동 처리 — GATE 7 부분 적용 위험 해소
- 1,263건 / batchSize 500 → 3 round-trip (~1초). 개별 upsert는 ~30초
- 다른 수집기들 4곳이 이미 동일 시그니처로 사용 → 패턴 일관성

**왜 기존 `apartments.update` 루프는 유지:** `apartments.update`는 단지마다 다른 컬럼 값을 update하는 거라 batch upsert로 묶을 수 없음(각 row가 다른 update payload, 동일 컬럼 set이 아님). events는 동일 컬럼 구조 → batch 가능.

**dry-run 동작:** dry-run 모드에서는 events 누적·upsert 모두 스킵 (현재 update 스킵과 동일 패턴).

**API 응답 형식 변경 조기 감지 (5% 임계 + exit(1) 알림):**

청약홈 odcloud API 가 `SUPLY_HSHLDCO`/`REQ_CNT`/`HOUSE_MANAGE_NO` 필드명을 바꾸면 `Number() || 0` 가드로 모든 supply/applicants 가 0으로 들어감. UNIQUE 멱등성 덕분에 중복 행은 안 생기지만, 모든 events 의 신호값이 무의미해짐. **본 프로젝트는 35개 워크플로우 어디에도 Slack/Discord 알림 채널이 없음** (실측: `grep -r "SLACK\|webhook" .github/workflows` = 0건). 별도 인프라 구축은 본 작업 범위 외 → 차선책으로 **`process.exit(1)` 으로 GitHub Actions 자체를 실패 처리**:

GitHub UI 워크플로우 결과 화면이 ❌ 빨간색으로 표시되고, GitHub 계정 설정 기본값으로 이메일 알림 발송 (Settings → Notifications → Actions). 이미 `Validate secrets` 단계가 동일한 `exit 1` 패턴 사용 중 (`.github/workflows/collect-applyhome.yml:36`).

**⚠️ 호출 위치 — `aggregateByApartment` 직후, `apartments.update` 루프 진입 전 (필수):**

순서 박제 — 잘못된 위치 두면 부분 적용 사고:

```js
// main() 안, aggregateByApartment 호출 직후 ✅
const aggregated = aggregateByApartment(rows);
log(PHASE, `API 총 ${rows.length}건`);
log(PHASE, `고유 아파트: ${Object.keys(aggregated).length}건`);

// ⚠️ 여기 = 5% 검증 위치. apartments.update 루프 진입 전.
//    이 시점에는 어떤 DB 쓰기도 발생 안 함 → exit(1) 시 데이터 무결.
const totalAggregated = Object.keys(aggregated).length;
const zeroSupplyCount = Object.values(aggregated)
  .filter(a => a.supply === 0).length;
const zeroRatio = totalAggregated > 0 ? zeroSupplyCount / totalAggregated : 0;
if (zeroRatio > 0.05) {
  logError(PHASE, `⚠️ supply=0 비율 ${(zeroRatio * 100).toFixed(1)}% (${zeroSupplyCount}/${totalAggregated}) — 청약홈 API 필드명 변경 가능성. odcloud 응답 1건 샘플 확인 필요.`);
  // 워크플로우 실패 처리 → GitHub 기본 이메일 알림 트리거
  process.exit(1);
}

// 이 줄 다음부터 apartments.update 루프 진입
const apartments = await selectAll((s) => s.from("apartments").select("id"), sb);
const aptSet = new Set(apartments.map(a => a.id));
// ... for (const [no, agg] of Object.entries(aggregated)) { ... }
```

**왜 이 위치인가 — 부분 적용 사고 시나리오 차단:**

만약 5% 검증을 update 루프 **다음**에 두면:
1. 청약홈 API 가 필드명 바꿈 → 모든 supply=0
2. update 루프가 1,263 단지 apartments.competition_rate=null 로 덮어쓰기 완료
3. 그 다음 5% 검증 → exit(1)
4. **결과: 다음 cron(7일)까지 모든 단지의 경쟁률이 잘못된 null 로 화면에 노출**

검증을 update 진입 전에 두면 (1)에서 즉시 exit → DB 변화 0 → 안전.

**왜 5%:** dry-run 측정상 정상 운영 중 `supply=0` 케이스(공급세대 0인 공고)는 거의 없음. 5% 초과는 거의 확실하게 외부 API 변경 신호.

**왜 `exit(1)`:**
- 본 프로젝트 인프라 한계상 알림은 GitHub Actions 실패만 가능 (Slack 없음)
- 다른 35개 워크플로우와 동일 한계 — 본 작업 외 인프라 작업으로는 BACKLOG `🟢 여유` 등재 (전 워크플로우 일괄 알림 도입)
- exit 시점이 update 루프 진입 전이라 **DB 변화 0**. 멱등성 안전

### 4. API 응답 화이트리스트 보강 — `apartments.js sanitize()`

**파일:** `api/supabase/apartments.js` (수정) + `api/supabase/apartments.test.js` (수정)

**왜 이 단계가 필수:** `apartments.js` L344-363 의 `sanitize()` 는 11개 helper 로 **명시적 화이트리스트 추출** 방식 (spread 아님). VIEW 에 컬럼 추가하고 `select("*")` 해도 `sanitize()` 통과 못 하면 **API 응답에 절대 안 나옴**. 마이그·VIEW만 손대면 화면 배지(§ 5)는 평생 안 보임.

**변경 1 — `apartments.js sanitizeRegion()` (L266 부근):**

기존 `competition_*` 3개 바로 아래 청약홈 출처 그룹에 추가 (의미 일관):

```js
// 청약 경쟁률
competitionRate: row.competitionRate ?? null,
competitionSupply: row.competitionSupply ?? null,
competitionApplicants: row.competitionApplicants ?? null,
// 무순위 공고 이벤트 (apartments_flat LEFT JOIN ae)
unsoldEventCount: row.unsoldEventCount ?? 0,        // 신규
lastUnsoldEventAt: row.lastUnsoldEventAt ?? null,   // 신규
```

**왜 `?? 0` vs `?? null`:**
- `unsoldEventCount`: VIEW 에서 `COALESCE(..., 0)` 적용. 그래도 sanitize 도 동일 처리 (방어적 일관성)
- `lastUnsoldEventAt`: 무순위 이력 없는 단지는 NULL 정상

**변경 2 — `apartments.test.js` `expectedKeys` 배열 (L380 청약 경쟁률 그룹 다음):**

```js
// 청약 경쟁률
'competitionRate', 'competitionSupply', 'competitionApplicants',
// 무순위 이벤트 (신규)
'unsoldEventCount', 'lastUnsoldEventAt',
```

**변경 3 — `src/constants/fieldMeta.js` 신규 2건 등록 (L54 `competitionRate` 그룹 + L174 "안전" 섹션 fields 배열):**

기존 `competitionRate` 등 alertRow 신호 4종(`presaleStage`/`completion`/`unsoldRate`/`crimeSafetyGrade`) 모두 fieldMeta 등록되어있어 ExpertFieldTable 노출. 일관성 위해 신규 2건도 등록:

```js
// L54 부근, competitionRate 그룹 다음에 추가
unsoldEventCount: { label: "무순위 공고 횟수", section: "안전", fmt: v => (v ?? 0) > 0 ? `${v}회` : "—" },
lastUnsoldEventAt: { label: "최근 무순위 공고일", section: "안전", fmt: v => v ? new Date(v).toLocaleDateString("ko-KR") : "—" },

// L174 "안전" 섹션 fields 배열에 추가 (competitionApplicants 다음)
{ key: "안전", label: "안전도/리스크", fields: [..., "competitionApplicants", "unsoldEventCount", "lastUnsoldEventAt", "crimeSafetyGrade", ...] },
```

**왜 이 보강이 차단급 (🔴):**
- 테스트 `'sanitize()는 전체 필드를 반환한다 (리팩토링 회귀 방어)'` (L338) 가 신규 필드 미등재 시 **`npm test` 즉시 실패**
- sanitize 빠지면 § 5 배지가 영영 안 보임 (apt.unsoldEventCount = undefined → 가드 false)
- fieldMeta 미등록 시 ExpertFieldTable·관리자 통계에서 신규 필드 누락 (운영 가시성↓)

### 5. 화면 노출 — AptCard "추가 모집" 배지 (즉시 가치)

**파일:** `src/components/AptCard.jsx`

**근거:** 첫 적재 1,263건 = 1,263개 단지가 "무순위 공고 발생" 신호 보유. 차수 누적은 1~2개월 기다려야 하지만, **"무순위 공고가 있다 = 미달 신호"** 는 이미 1건만으로 의미 있음. "데이터 적재 시작" 의 사용자 가치를 즉시 회수.

**구현 (AptCard:121-145 `alertRow` 패턴 그대로 따름):**

기존 `presaleStage` / `completion` / `unsoldRate` 등 신호 배지가 같은 줄에 모이는 `alertRow` 안에 1줄만 추가. `crimeSafetyGrade` 배지(L142-143) 다음 위치.

`alertRow` 표시 조건(L121)의 OR 체인에도 신규 조건 추가 필수 — 다른 신호 없는 단지에서 alertRow 자체가 안 뜸.

```jsx
// L121 alertRow 조건에 OR 추가:
//   apt.completion
//   || (apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD
//   || noxCount > 0
//   || apt.presaleStage
//   || (apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade))
//   || (apt.crimeSafetyGrade != null && apt.crimeSafetyGrade >= 4)
//   || (apt.unsoldEventCount > 0 && apt.id?.startsWith("ah-"))   ← 추가

// L143 crimeSafetyGrade 다음에 신규 배지:
{apt.unsoldEventCount > 0 && apt.id?.startsWith("ah-") && (
  <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>
    추가 모집
  </span>
)}
```

**가드:**
- `unsoldEventCount > 0` — `apartments_flat` 의 `COALESCE(..., 0)` 로 모든 단지에 0이 깔려있음. > 0 만 표시
- `id?.startsWith("ah-")` — § 운영 의미 3번 박제대로, 네이버 단지(`naver-{N}`)는 0 의 의미가 "정보 없음" 이라 표시 자체 차단 (현재 `apartments_flat` 의 LEFT JOIN 결과로 네이버 단지에도 0 이 깔리는데, 의미가 다름)

**색상 — `redLight/red` (위험 카테고리 일관성):**
- AptCard 의 기존 위험 배지 3종이 모두 `C.redLight/C.red` 사용:
  - `미분양 N%` (L133)
  - `시공사 N` (L136)
  - `혐오시설 N건` (L139)
- "추가 모집" = 미달 신호 → 같은 위험 카테고리 → 같은 색이 일관
- ❌ `amber` 회피: AptCard 안에서 amber 는 이미 4가지 의미(혜택 이득/B등급/미입주/치안 주의)에 산재 → 사용자 혼동
- ❌ 신규 색 도입 회피: 팔레트 변경은 큰 작업, 본 세션 외

**텍스트 — `"추가 모집"` (네이버 부동산 표준):**
- "무순위 공고" 는 부동산 공식 용어지만 일반인 이해도 낮음 (프로젝트 내 사용 0건)
- "추가 모집" = "이미 분양된 단지가 남은 물량을 추가로 모집한다" 의미가 자연스럽게 전달
- 네이버 부동산 / 청약홈도 무순위/잔여 모집 분양을 통상 "추가 모집" 으로 표기

**스코어링·필터링 영향 0:**
- 본 배지는 **표시만**. `scoreRisk.js` 등 스코어링 함수는 이 컬럼 미사용
- 검색·필터·정렬 미반영 (이번 세션 외 BACKLOG 이월)
- `competition_rate` 단일 컬럼 기반 기존 점수 그대로 유지

**`React.memo` comparator — 본 작업에서 손대지 않음 (의도된 일관성):**

AptCard L158-167 의 기존 comparator 는 `apt.id`/`res.total`/`isComp`/`isFav`/`isDesktop`/`isLoggedIn`/`profileWeights` 만 비교. 즉 alertRow 의 다른 필드(`completion`/`unsoldRate`/`presaleStage`/`crimeSafetyGrade`/`builderCreditGrade`) **5개 모두 비교 누락 상태**. 이는 **기존 패턴**으로, 본 작업이 만든 위험 아님.

본 작업에서 `unsoldEventCount` 만 comparator 에 추가하면 **alertRow 5개 필드와 비일관 (우리만 정확)** → 일관성 위반. 따라서 본 작업도 같은 누락 패턴을 따름. 데이터 거의 변화 없는 필드(주 1회 cron)라 사용자 영향 거의 0.

→ alertRow 6개 필드 일괄 점검은 별도 트랙으로 BACKLOG 박제 (§ 후속 작업 참조).

**테스트 factory 보강 (`src/__tests__/factories.js`):**

`makeApt()` 기본값에 `unsoldEventCount: 0` 추가. 기존 8건 테스트는 undefined > 0 = false 라 자동 통과되지만, 명시적 선언이 다른 alertRow 필드(`unsoldRate`, `crimeSafetyGrade` 등) 패턴과 일관.

**왜 DetailModal·시계열 차트는 이번 세션 외:**
- DetailModal "무순위 차수 N회 / 이력 시계열" = **차수 누적 1~2개월 후 의미 있음** (현재 모두 1)
- 시계열 차트 = 기간 데이터 없음. MarketStatsCharts 패턴 재사용은 데이터 충분 후

### 6. 테스트 추가
**파일:** `scripts/collectors/collect-applyhome.test.mjs` + `scripts/collectors/collect-applyhome.mjs` (순수 함수 추출 필요)

**중요 — 순수 함수 추출이 선결 조건:**

기존 `main()` 함수는 (1) DB 조회 (2) events 빌드 (3) Supabase update (4) `process.argv` dry-run 판정이 한 덩어리로 묶여있어 **단위 테스트 불가**. 다른 수집기들 (`collect-unsold-kosis`, `collect-maintenance` 등) 패턴을 따라 **순수 함수만 export 해서 테스트**.

`collect-applyhome.mjs` 에 추가 export:

```js
// 1) 매칭 + events 빌드 (순수 함수, DB 호출 없음)
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

`main()` 은 이 함수를 호출. dry-run 분기·apartments.update 루프는 main() 안에 그대로 (테스트 대상 아님 — e2e 검증 단계로).

**Mock 패턴 (기존 `collect-applyhome.test.mjs:6-19` 확장):**

기존 mock 은 `loadEnv / getSupabase / log / logError / createReporter` 5개만 처리. `selectAll` 도 main() 에서 사용 중이라 누락. 본 작업의 신규 함수는 `upsertBatch` 도 사용. 둘 다 mock 추가:

```js
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    selectAll: vi.fn(),                                 // ← 추가 (main()이 이미 사용 중)
    upsertBatch: vi.fn(async (_t, rows) => rows.length), // ← 추가 (본 작업 신규)
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});
```

**추가 테스트 (수집기 3건 + AptCard 3건 + apartments.test.js 1건 = 7건):**

수집기 (`scripts/collectors/collect-applyhome.test.mjs`):

| # | 테스트 | 검증 대상 |
|---|--------|----------|
| 1 | `buildEventsFromAggregated` 매칭된 단지만 events 반환 | aggregated 5개 × apartments 3개 → events 3개. apartment_id 형식 `ah-{no}` |
| 2 | `buildEventsFromAggregated` 빈 입력 처리 | aggregated `{}` → `[]`, apartments `[]` → `[]` |
| 3 | `buildEventsFromAggregated` 필드 매핑 정확성 | supply/applicants/rate/recorded_at 모두 정확히 들어감 |

AptCard (`src/components/AptCard.test.jsx`):

| # | 테스트 | 검증 대상 |
|---|--------|----------|
| 4 | "추가 모집" 배지 — `unsoldEventCount > 0` + `id="ah-..."` → 배지 보임 | `getByText("추가 모집")` 존재 |
| 5 | "추가 모집" 배지 미표시 — `unsoldEventCount=0` → 배지 없음 | `queryByText("추가 모집")` null |
| 6 | "추가 모집" 배지 가드 — `unsoldEventCount > 0` + `id="naver-..."` → 배지 없음 | `queryByText("추가 모집")` null (네이버 단지 0의 의미 분리) |

apartments BFF (`api/supabase/apartments.test.js`):

| # | 테스트 | 검증 대상 |
|---|--------|----------|
| 7 | `expectedKeys` 회귀 (기존 테스트 유지) | `unsoldEventCount`, `lastUnsoldEventAt` 응답 포함 (자동 — 위 § 4 의 expectedKeys 보강 후) |

총 8 + 7 = **15건**. memo comparator 변경은 본 작업에서 안 함(§ 5 "의도된 일관성") → 관련 단위 테스트도 없음.

dry-run 분기·`upsertBatch` 호출 인자 검증은 e2e 단계 (검증 § 8) 의 로그 확인으로 대체 — 단위 테스트로 main() e2e 를 잡는 패턴은 다른 수집기 0건이라 우리도 도입 안 함.

## 명시적 비-작업 (이번 세션 범위 외)

본 세션은 데이터 적재 + AptCard 1배지(§ 5)까지. **차수·시계열 가공·검색 반영**은 데이터 누적·재사용 패턴 확립 후 별도 세션.

| 항목 | 사유 | 처리 |
|------|------|------|
| DetailModal "N차 무순위 / 이력 시계열" 섹션 | 차수 누적 1~2개월 후 의미. 현재 거의 모든 단지가 1건만 | BACKLOG `🟡 곧` 등재 |
| 시계열 차트 (MarketStatsCharts 패턴) | 누적 데이터 부족. 1~2개월 후 검토 | NEXT_SESSION 외부 이벤트 일정에 박제 |
| 검색·필터·정렬에 `unsoldEventCount` 반영 | 화면 1배지 후 사용자 반응 본 뒤 결정. 필터 추가는 fieldMeta·sort 옵션 동시 변경 필요(다른 세션) | BACKLOG `🟡 곧` 등재 |
| 공고일(`RCRIT_PBLANC_DE`) 필드 추가 수집 | `getRemndrLttotPblancCmpet` 응답에 해당 필드 부재 확인 필요. 있으면 +1 컬럼 (선택) | 본 작업 e2e 단계에서 응답 샘플 확인 후 결정 |
| `apartments`의 기존 3컬럼 deprecated | 화면 의존이 있어 즉시 제거 불가. 시계열 적재 안정화 후 별도 세션 | 박제만 (BACKLOG `🟢 여유`) |
| `scoreRisk.js` 의 `competitionRate` 시계열 가중평균 도입 | 단일 스냅샷 → 시계열 평균 변경 시 점수 변동성 급증. 데이터 누적 충분 후 별도 세션 | 박제 (BACKLOG `🟢 여유`) |

## 운영 의미 (반드시 박제 — 코드만 보면 모호한 결정)

본 작업은 의도된 비대칭·모호 영역 4개가 있음. 화면 노출·운영 보고 시 혼동 방지용 박제.

1. **`apartments.competition_rate` 단일 스냅샷 vs `applyhome_events` 시계열은 별개 트랙.** 단일 스냅샷은 `scoreRisk.js` 가 사용하는 최신값 캐시. 시계열은 미분양 시그널 분석용. 어느 쪽이 "진실"이 아니라 **둘 다 별개 목적**. 운영 보고 시 둘을 비교·합치려 하지 말 것.

2. **`apartments.update` 실패 → 그 단지의 events 도 누적 안 됨 (의도된 비대칭).** 스펙 § 3 의 events.push 위치가 update 성공 분기 안. 즉 단지 일부가 업데이트 실패하면 events 도 빠짐. 다음 cron 실행 시 update 가 성공하면 events 도 들어가지만, "이전 사이클의 이벤트 시각" 은 영영 손실. update 실패는 매우 드물어 의도적 단순화. 수정하려면 events 누적 위치를 `if (!aptSet.has(aptId)) continue` 직후로 이동.

3. **네이버 단지(`naver-{N}`)의 `unsoldEventCount` 는 항상 0.** 네이버 단지는 청약홈 공고 대상이 아니라 events 가 들어갈 일 없음. `apartments_flat` VIEW 의 LEFT JOIN 결과로 모든 단지에 컬럼이 보이지만 naver 단지의 0은 "정보 없음" 이지 "실제 무순위 0회" 가 아님. 화면 노출 시 반드시 `id.startsWith('ah-')` 가드 필수. 검증 단계 10 으로 즉시 측정 가능.

4. **수집기 동시 실행은 안전.** GitHub Actions concurrency `data-collection` group 직렬화 + UNIQUE(apartment_id, house_manage_no) 멱등성 = 이중 보호. 같은 시간 cron + 수동 dispatch 시 직렬 대기, 중복 행 생성 0.

## 검증 (Verification)

순서대로 실행해 모두 ✅ 나오면 완료:

```bash
# 1. 마이그레이션 적용 (Supabase Studio SQL Editor 에 두 파일 순서대로 붙여넣기)
#    순서: ① 20260502000000_create_applyhome_events.sql (테이블·RLS·인덱스)
#          ② 20260502100000_view_add_applyhome_events.sql (VIEW 재생성)
#    apply-migration.yml 은 SQL 출력만, 실제 실행은 수동.
#    → applyhome_events 테이블 + apartments_flat VIEW 재생성 확인

# 2. 수집기 dry-run (DB 변경 없음, 로직만 검증)
node scripts/collectors/collect-applyhome.mjs --dry-run
#    → "매칭: 1263/1314건" 동일 출력 + 에러 0

# 3. 단위 테스트
npm run test -- collect-applyhome
#    → 기존 8건 + 신규 3건 = 11건 통과

# 4. 실제 적재 (⚠️ 마이그 적용 직후 즉시 1회 — 건너뛰지 말 것)
#    건너뛸 경우 다음 월요일 11:30 KST cron 까지 events 0행 → 모든 단지 unsoldEventCount=0
#    → 사용자에게 "추가 모집" 배지 0건 (최대 7일). 자동 복구되지만 7일간 사용자 가치 0.
node scripts/collectors/collect-applyhome.mjs
#    → 성공 1263 / 실패 0
#    → 5% 경고 + exit(1) 발생 시 (GitHub Actions 빨간 X + 이메일 알림): 청약홈 API 필드명 변경 점검

# 5. DB 확인 (Supabase Studio SQL)
SELECT COUNT(*) FROM applyhome_events;                    -- 1263 예상
SELECT apartment_id, COUNT(*)
FROM applyhome_events GROUP BY apartment_id
HAVING COUNT(*) > 1;                                       -- 첫 적재 시 0건 정상

# 6. VIEW 확장 확인
SELECT id, "unsoldEventCount", "lastUnsoldEventAt"
FROM apartments_flat WHERE "unsoldEventCount" > 0 LIMIT 5;
#    → 1263건이 1로 카운트됨

# 7. 멱등성 확인 (한 번 더 실행)
node scripts/collectors/collect-applyhome.mjs
SELECT COUNT(*) FROM applyhome_events;                     -- 여전히 1263 (UNIQUE 작동)

# 8. 배치 적재 부분 실패 시 로그 확인
#    실행 로그에서 다음 패턴 grep:
#      "applyhome_events: N/M건 upsert"  ← upsertBatch 내부 L124 자동 출력. N == M 이면 ✅
#      "  개별 재시도: X/Y 성공"           ← upsertBatch L120, 배치 실패 시에만 출력
#    N < M 이면 실패 단지는 다음 cron 에서 재시도 (UNIQUE 멱등성으로 안전)

# 9-A. apartments_flat 컬럼 수 카운트 (1차 빠른 검증)
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'apartments_flat';
#    → 119 예상 (직전 117 + 신규 unsoldEventCount/lastUnsoldEventAt 2)

# 9-B. apartments_flat 컬럼명 누락 감지 (⚠️ 정확한 진단)
#    COUNT 만으로는 117→118(누락 1 + 신규 1) 같은 케이스를 못 잡음. 컬럼명을 직접 비교.
#    Supabase Studio SQL Editor 에서 결과 직관성 위해 missing/extra 분리 출력 (배열 X, 행 단위 O).
WITH expected AS (
  -- 직전 VIEW 마이그 (20260419000000) SELECT 블록의 모든 alias 117개 + 신규 2개를
  -- 마이그 작성 단계에서 grep 으로 자동 추출해 VALUES 채워둘 것:
  --   grep -oE 'AS\s+"[a-zA-Z_]+"' supabase/migrations/20260419000000_view_dedup_prefer_general.sql
  SELECT col FROM (VALUES
    ('id'), ('name'), ('dong'), ('gu'), ('region'), ('lat'), ('lng'),
    -- ... (기존 117개 전체 — 마이그 작성 시 자동 생성)
    ('unsoldEventCount'), ('lastUnsoldEventAt')   -- 신규 2개
  ) AS t(col)
),
actual AS (
  SELECT column_name AS col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'apartments_flat'
)
-- 누락 컬럼 (직전 VIEW 에 있었는데 신규 마이그에서 빠진 것)
SELECT 'MISSING' AS kind, col FROM expected WHERE col NOT IN (SELECT col FROM actual)
UNION ALL
-- 예상 못 한 컬럼 (expected 에 안 적었는데 실제 VIEW 에는 있음)
SELECT 'EXTRA' AS kind, col FROM actual WHERE col NOT IN (SELECT col FROM expected);
#    → 결과 0행이 정상 (✅)
#    → MISSING 행 발견: 즉시 롤백 후 해당 컬럼 SELECT 블록에 추가
#    → EXTRA 행 발견: expected 리스트(이 쿼리 자체) 갱신 필요 — 실제 컬럼 스펙 변경 신호

# 10. 신규 컬럼 누락 단지 검증 (네이버 단지 = 0회 의미 확인)
SELECT COUNT(*) AS naver_with_zero
  FROM apartments_flat
 WHERE id LIKE 'naver-%' AND "unsoldEventCount" = 0;
#    → 네이버 단지 전부 0 으로 나와야 정상 (애초 무순위 공고 없음)
#    → 본 컬럼은 ah- 단지에서만 의미 있음. 화면 노출 시 반드시 ID prefix 가드.

# 11. UI 스모크 — AptCard "추가 모집" 배지 표시 (§ 5)
npm run dev
#    브라우저에서 다음 3가지 확인:
#    (a) 무순위 공고가 있는 ah- 단지(예: ah-2026910015) → "추가 모집" red 배지 보임
#    (b) 무순위 공고가 없는 ah- 단지(unsoldEventCount=0) → 배지 미표시
#    (c) 네이버 단지(naver-XXXXX) → unsoldEventCount=0 이지만 prefix 가드로 배지 미표시
#    + 모바일 (375px) 에서 alertRow flexWrap 으로 자동 줄바꿈 정상 확인

# 12. UI 스냅샷 회귀 테스트 (선택 — AptCard.test.jsx 보강)
npm run test -- AptCard
#    → unsoldEventCount > 0 + ah- prefix 케이스 1건, naver- prefix 차단 1건 추가
```

## 비용 영향

- **API 쿼터:** 변동 없음. 기존 `collect-applyhome.mjs` 호출량 그대로 (월요일 1회, ~2 페이지)
- **DB 용량:** 1,263 행 × ~50 bytes ≈ 63KB 초기. 월 +1,000~2,000행 예상 (장기 누적도 1MB 미만)
- **수집기 실행시간:** 현재 2.5초 → `upsertBatch` 3 round-trip (~1초) 추가로 총 ~3.5초 예상
- **Vercel 함수:** 신규 API 0개 (이번 세션은 수집·적재만)

## 후속 작업 (BACKLOG 박제 예정)

세션 종료 직전 BACKLOG.md에 추가:

```
- 🟡 무순위 이벤트 로그 화면 노출 — applyhome_events 누적 1~2개월 후
  - DetailModal 무순위 차수·이력 섹션
  - AptCard 무순위 배지 (count >= 2일 때만)
  - 시계열 차트 (MarketStatsCharts 패턴 재사용)
  - 트리거: 같은 apartment_id 2회+ 행 발생 (월 1회 쿼리로 모니터)

- 🟢 React.memo comparator 일괄 점검 — alertRow 신호 6개 필드 + 다른 컴포넌트 memo
  - AptCard L158-167: 누락 5개 필드(completion / unsoldRate / presaleStage / crimeSafetyGrade / builderCreditGrade) + 신규 unsoldEventCount = 6개 일괄 추가
  - 동일 패턴 점검 대상: CompareSheet / DetailModal / MapView / SelectedAptCard memo comparator
  - 단위 테스트: 각 필드 변경 시 리렌더 트리거 확인 (현재 AptCard memo 단위 테스트 0건)
  - 트리거: AptCard / 다른 카드 컴포넌트의 memo 회귀 사고 발생 시 또는 분기 점검 작업
  - 발견 경위: 청약홈 무순위 이벤트 로그 작업(2026-05-02 세션 159) 9차 GATE 검증에서 comparator 일관 누락 패턴 식별
```

## 진행 상태

✅ **완료** (2026-05-02 세션 159) — `supabase/migrations/20260502000000_*.sql` 마이그 3건 (테이블 + INDEX + VIEW) + `api/supabase/apartments.js` sanitize 화이트리스트 박힘. 1차 적재 1,263단지 완료.
