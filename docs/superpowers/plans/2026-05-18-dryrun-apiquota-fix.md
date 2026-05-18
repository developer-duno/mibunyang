# dry-run api_quota_log 오염 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 executing-plans. 체크박스(`- [ ]`) 추적.

**Goal:** dry-run 모드 수집기 실행이 `api_quota_log` 테이블에 가짜 API 호출 기록을 남겨 일일 쿼터(`api_quota_daily`) 집계를 부풀리는 버그를, `recordCollectorRun` 과 동일 패턴으로 `recordApiQuota` 함수 1곳을 고쳐 해결한다.

**Architecture:** `recordApiQuota`(`_shared.mjs`)에 (1) `process.argv` dry-run 가드 (2) `sbOverride` 인자 — `recordCollectorRun` 과 구조 동일화. 24개 호출처는 4번째 인자 기본값 `null` 이라 무변경.

**Tech Stack:** Node.js ESM `.mjs`, `// @ts-check` JSDoc, Vitest.

---

## 배경 — 진단 (실측 증거)

### 사고 출처

2026-05-18 직전 작업(`recordCollectorRun` dry-run 수정, 커밋 `5d1c7b5`~`89cbbba`)의
**맹점 재검토**에서 발견. 그 plan 은 `recordApiQuota` 의 동일 버그를 "별개 사안,
housing-permits 1개"로 잘못 분리했음 — 실측 결과 정정.

### 실측 — `recordApiQuota` dry-run 가드 밖 호출 4개

`recordApiQuota` 호출처 24곳 중 20곳은 `if (!dryRun)` 가드 안. **4곳이 가드 밖**:

- `scripts/collectors/collect-air-quality.mjs:159`
- `scripts/collectors/collect-emergency.mjs:137`
- `scripts/collectors/collect-trades.mjs:312`
- `scripts/collectors/housing-permits.mjs:212`

이 4개를 `--dry-run` 으로 실행하면 — dry-run 도 실제 API 를 호출하므로 `apiCalls > 0`
→ `recordApiQuota` 가 `api_quota_log` 에 가짜 행 INSERT.

### `recordCollectorRun` 버그와의 관계 — 같은 종류, 다른 심각도

- **같은 점**: 둘 다 `_shared.mjs` 함수, dry-run 실행이 DB 테이블 오염. 같은 수정 패턴.
- **다른 점**: `recordCollectorRun` 오염 → monitor ②번이 오탐 알림(🔴). `recordApiQuota`
  오염 → monitor 는 `api_quota_log` 를 점검 안 함(`grep` 0건) → 알림 없음. 대신
  `api_quota_daily` 쿼터 집계가 부풀려져 "일일 10,000회 한도"(scripts/CLAUDE.md) 판단이
  흐려짐 → 🟡 데이터 정확도 문제.

### `recordApiQuota` 현재 구조 (실측)

```javascript
export async function recordApiQuota(collector, apiName, callCount) {
  if (!callCount || callCount <= 0) return;
  try {
    const sb = getSupabase();
    const { error } = await sb.from("api_quota_log").insert({ ... });
    ...
```

- `recordCollectorRun` 과 달리 `sbOverride` 인자 **없음** → 단위 테스트 0건
  (BACKLOG 세션 261 메모 `recordApiQuota 테스트 불가 — sb 인자 미지원` 에 박제됨).
- 호출처 24곳 전부 `recordApiQuota(collector, apiName, callCount)` 3인자 형태.

## 수정 방향 (사용자 결정)

`recordApiQuota` 에 argv 가드 + `sbOverride` 인자 + 테스트 — `recordCollectorRun` 과
구조 동일화. 24개 호출처는 4번째 인자 기본값 `null` 이라 무변경. BACKLOG 세션 261
"테스트 불가" 항목도 함께 해소.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `scripts/collectors/_shared.mjs` | `recordApiQuota` argv 가드 + sbOverride | 수정 ~8줄 |
| `scripts/collectors/_shared.test.mjs` | recordApiQuota dry-run skip + INSERT 테스트 | 수정 +1 describe |

---

## Task 1: recordApiQuota 테스트 작성 (TDD — 실패 먼저)

**Files:**

- Modify: `scripts/collectors/_shared.test.mjs` (`describe("recordCollectorRun ...")` 블록 **다음**에 새 describe)

- [ ] **Step 1: 새 describe 블록 추가**

**먼저** — `scripts/collectors/_shared.test.mjs` 상단 import 구문에 `recordApiQuota` 를
**반드시 추가**. 실측 확인됨(L8): 현재 import 에 `recordCollectorRun` 은 있고
`recordApiQuota` 는 **없음**. `recordCollectorRun` 이 든 같은 import 구문에
`recordApiQuota` 를 추가하지 않으면 신규 테스트가 `ReferenceError` 로 실패.

그 다음, `describe("recordCollectorRun (수집기 모니터링 에픽 1단계)", ...)` 블록이
끝나는 `});` **다음 줄**에 아래 describe 추가 (파일 끝부분).

```javascript
describe("recordApiQuota (dry-run 가드)", () => {
  it("sbOverride 주입 시 api_quota_log 에 INSERT", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    await recordApiQuota("quota-test", "TEST_KEY", 5, sb);
    expect(rows).toHaveLength(1);
    expect(rows[0].collector).toBe("quota-test");
    expect(rows[0].call_count).toBe(5);
  });

  it("callCount 0 이면 INSERT 안 함 (기존 가드 유지)", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    await recordApiQuota("quota-test", "TEST_KEY", 0, sb);
    expect(rows).toHaveLength(0);
  });

  it("--dry-run argv 있으면 sbOverride 없이 getSupabase 호출 안 함 (console spy)", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await recordApiQuota("quota-test", "TEST_KEY", 5);
    } finally {
      process.argv = orig;
    }
    const logMsgs = logSpy.mock.calls.map((c) => c.join(" "));
    const errMsgs = errSpy.mock.calls.map((c) => c.join(" "));
    logSpy.mockRestore();
    errSpy.mockRestore();
    // dry-run 이면 skip 로그가 찍히고, getSupabase 미도달이라 SUPABASE 에러 없음
    expect(logMsgs.some((m) => m.includes("dry-run"))).toBe(true);
    expect(errMsgs.some((m) => m.includes("SUPABASE"))).toBe(false);
  });
});
```

> 세 번째 테스트의 console spy 검증 방식은 직전 `recordCollectorRun` 작업(커밋 `89cbbba`)에서
> ESM named import 가 `vi.spyOn` 으로 가로채지지 않아 채택한 검증법 답습. `log()`→`console.log`,
> `logError()`→`console.error` 는 전역 객체라 spy 가 확실히 동작.

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run scripts/collectors/_shared.test.mjs --no-cache`
Expected: 신규 3건 중 최소 1·3번 FAIL.

- 1번(`sbOverride 주입`) — 현재 `recordApiQuota` 는 `sbOverride` 인자가 없어 `getSupabase()`를
  호출 → fake `sb` 무시 → `rows` 0건 → FAIL.
- 3번(`--dry-run skip`) — 현재 dry-run 가드 없어 `getSupabase()` 호출 → skip 로그 없음 → FAIL.
- 2번(`callCount 0`)은 PASS 할 수 있음 — 기존 `if (!callCount || callCount <= 0) return` 가드가
  `getSupabase` 전이라. 그래도 무방.

> `Cannot read properties of undefined (reading 'config')` → `--no-cache` 누락, 재실행.

- [ ] **Step 3: 커밋**

```bash
git add scripts/collectors/_shared.test.mjs
git commit -m "test(shared): recordApiQuota dry-run 가드 + sbOverride 테스트 3건"
```

---

## Task 2: recordApiQuota argv 가드 + sbOverride 구현

**Files:**

- Modify: `scripts/collectors/_shared.mjs` (`recordApiQuota` 함수)

- [ ] **Step 1: 함수 시그니처 + 본문 수정**

`scripts/collectors/_shared.mjs` 의 `recordApiQuota` 함수. 현재:

```javascript
export async function recordApiQuota(collector, apiName, callCount) {
  if (!callCount || callCount <= 0) return;
  try {
    const sb = getSupabase();
```

이것을 다음으로 변경 (시그니처에 `sbOverride` 추가 + dry-run 가드 삽입 + `sb` 라인 변경):

```javascript
export async function recordApiQuota(collector, apiName, callCount, sbOverride = null) {
  if (!callCount || callCount <= 0) return;
  // dry-run 실행은 api_quota_log 오염 방지를 위해 기록 skip.
  // sbOverride(테스트 클라이언트 주입) 가 있으면 argv 무관하게 항상 기록 — 테스트 격리.
  if (!sbOverride && process.argv.includes("--dry-run")) {
    log("quota", `${collector}: dry-run — api_quota_log 기록 skip`);
    return;
  }
  try {
    const sb = sbOverride ?? getSupabase();
```

JSDoc 도 수정. `recordApiQuota` 함수 위 JSDoc 에 `@param` 이 3개(collector/apiName/callCount)
있으면 4번째 추가 — 없으면(JSDoc 자체가 없으면) `recordCollectorRun` JSDoc 형식을 참고해
`@param {import("@supabase/supabase-js").SupabaseClient | null} [sbOverride] 테스트용 Supabase
클라이언트 주입. 주입 시 --dry-run argv 무시하고 항상 기록.` 한 줄 추가. 기존 JSDoc 구조를
깨지 말 것. (현재 JSDoc 유무는 함수 위를 Read 해서 확인.)

- [ ] **Step 2: 테스트 실행 — 통과 확인**

Run: `npx vitest run scripts/collectors/_shared.test.mjs --no-cache`
Expected: PASS — Task 1 신규 3건 + 기존 `recordCollectorRun` 6건 + 나머지 전부 통과.
FAIL 시 → 실패 테스트명·메시지 보고 후 BLOCKED.

- [ ] **Step 3: 회귀 가드 검증 (테스트가 진짜 가드인지)**

Task 1 의 3번 테스트가 실제 회귀 가드인지 입증:

1. `_shared.mjs` 의 `recordApiQuota` dry-run 가드(`if (!sbOverride && process.argv.includes("--dry-run")) { ... return; }`)를 임시 주석 처리
2. `npx vitest run scripts/collectors/_shared.test.mjs --no-cache` → 3번 테스트가 **FAIL 해야 함**
3. 가드 주석 복원
4. 다시 테스트 → 전체 PASS
이 4단계 확인 후 진행. FAIL→PASS 전환 안 되면 테스트 재설계.

- [ ] **Step 4: 타입체크**

Run: `npm run typecheck:scripts 2>&1 | grep -E "_shared|Found"`
Expected: `_shared` 관련 에러 0건.
`_shared` 관련 타입 에러 발생 시 → 메시지 보고 후 BLOCKED.

- [ ] **Step 5: dry-run 실측 검증**

`recordApiQuota` 가드 밖이던 collector 하나를 dry-run 으로 실행:

Run: `node scripts/collectors/collect-trades.mjs --dry-run 2>&1 | grep -E "dry-run|기록 skip|quota\]"`
Expected: 로그에 `collect-trades: dry-run — api_quota_log 기록 skip` 출력.
※ collect-trades 는 MOLIT API 를 호출하므로 시간이 걸림. API 에러가 나도 무방 — `recordApiQuota`
호출 시점의 skip 로그만 확인. 로그가 안 보이면 grep 없이 출력 끝부분 확인.

- [ ] **Step 6: 커밋**

```bash
git add scripts/collectors/_shared.mjs
git commit -m "fix(shared): recordApiQuota dry-run 시 api_quota_log 기록 skip

dry-run 실행이 4개 collector(air-quality/emergency/trades/housing-permits)
에서 api_quota_log 에 가짜 호출 기록 → api_quota_daily 쿼터 집계 오염.
recordCollectorRun(89cbbba) 과 동일 패턴 — 함수에 argv 가드 + sbOverride.
호출처 24곳은 4번째 인자 기본값 null 이라 무변경."
```

---

## Task 3: 전체 회귀 + push

- [ ] **Step 1: 전체 회귀 가드**

Run:

```bash
npx vitest run scripts/collectors/_shared.test.mjs --no-cache
npm run typecheck:scripts
```

Expected: 전부 PASS / 0 에러.

- [ ] **Step 2: push**

```bash
git push
```

- [ ] **Step 3: CI 확인**

Run: `gh run list --branch main --limit 1 --json conclusion,status`
Expected: CI 완료 후 `conclusion: success`.

- [ ] **Step 4: 재발 차단 검증 (시뮬레이션)**

가드 밖이던 collector 를 dry-run 으로 돌린 뒤 `api_quota_log` 에 오늘자 행이 안 생기는지 확인:

Run:

```bash
node scripts/collectors/collect-emergency.mjs --dry-run > /dev/null 2>&1
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const today=new Date().toISOString().slice(0,10);const {count}=await sb.from('api_quota_log').select('id',{count:'exact',head:true}).eq('collector','collect-emergency').eq('log_date',today);console.log('collect-emergency 오늘자 행:',count);"
```

Expected: `collect-emergency 오늘자 행: 0` (dry-run 이 행을 안 남김).
> ⚠️ 이 검증 전에 오늘 `collect-emergency` 가 실제(non-dry) 실행된 적 없어야 정확. 만약 0 이
> 아니면 — 오늘 cron 실행이 있었는지 `gh run list --workflow=collect-air-quality.yml` 등으로
> 확인. 실제 실행 행이면 정상이므로 다른 가드밖 collector(`collect-trades`)로 재검증.

---

## 검증 요약

| Task | 검증 | 통과 기준 |
|---|---|---|
| 1 | 테스트 실패 확인 | sbOverride·dry-run 테스트 FAIL (구현 전) |
| 2 | 테스트 통과 + 회귀 가드 입증 + dry-run 실측 | vitest PASS + 가드 주석 시 FAIL 재현 + skip 로그 |
| 3 | 회귀 + CI + 시뮬 | vitest/typecheck PASS + CI success + dry-run 후 행 미생성 |

## 명시적 비-작업 (YAGNI)

- 가드 안(`if (!dryRun)`)인 20개 collector 호출부 — `recordApiQuota` 가 자체 가드를
  가져도 collector 측 `if (!dryRun)` 는 정상 동작(이중 가드, 무해). 제거 불필요.
- monitor 에 `api_quota_log` 점검 추가 — 별개 기능 제안, 본 plan 범위 밖.
- 4개 collector 호출부의 `if (!dryRun)` 추가 — 함수 가드로 해결되므로 불필요.

## 한계 / 후속

- `api_quota_log` 과거 행 조사 — **정리 불필요 (2026-05-18 후속 검토)**:
  - 실효 가드밖 collector 는 air-quality·emergency 2개뿐. trades·housing-permits
    는 dry-run 시 `recordApiQuota` 호출 전 early return(`collect-trades.mjs:282`
    / `housing-permits.mjs:185`) — 본 plan 의 "가드밖 4개" 진단을 정정.
  - air-quality 10행·emergency 3행 실측 결과 dry-run 오염으로 **확정된 행 0개**.
    air-quality 4/02 5행이 2분 간격 연속 실행으로 비정상 패턴이나, dry-run 증거가
    `api_quota_log`·`collector_runs`(4월 데이터 부재)·`apartments.air_quality`
    (덮어쓰기) 어디에도 없음. 일반 디버깅 실행이었다면 실제 호출 기록이므로 삭제
    시 데이터 은폐 — 보존 결정.
  - 신규 오염은 본 plan 의 `recordApiQuota` 가드로 차단됨. VIEW `api_quota_daily`
    집계는 시간이 지나며 자연 정확화.
- BACKLOG 세션 261 `recordApiQuota 테스트 불가 — sb 인자 미지원` 항목 — 본 plan Task 2
  완료로 해소됨. BACKLOG 갱신 완료 (`.claude/BACKLOG.md:48` ✅).
