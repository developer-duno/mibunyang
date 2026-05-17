# dry-run collector_runs 오염 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 executing-plans. 체크박스(`- [ ]`) 추적.

**Goal:** dry-run 모드 수집기 실행이 `collector_runs` 테이블에 `ok=0` 행을 남겨 monitor ②번 NULL 점검이 오탐 알림을 보내는 버그를 `_shared.mjs` 함수 1곳 수정으로 해결한다.

**Architecture:** `recordCollectorRun` 함수가 `process.argv`에 `--dry-run`이 있으면 DB INSERT를 skip. 단 `sbOverride`(테스트용 클라이언트 주입)가 있으면 argv 무관하게 항상 기록 — 테스트 안전성 보존. 9개 collector 호출부는 무변경.

**Tech Stack:** Node.js ESM `.mjs`, `// @ts-check` JSDoc, Vitest.

---

## 배경 — 진단 (실측 증거)

### 사고
2026-05-17 텔레그램 알림: `migration`·`kosis-housing-supply-ratio` 가 "success 인데 처리 0건".

### 진단 (전부 실측)
- `collector_runs` 테이블: 두 collector 모두 `2026-05-16T23:37 UTC` 에 `ok=0` 행 1건.
- `gh run list`: `migration` 워크플로 최근 실행 = `2026-05-15 22:43` (5/16 23:37 실행 **없음**).
  `housing-supply-ratio` 워크플로 = 실행 이력 **0건** (빈 배열).
- 5/16 23:13·23:17 에 `Monitor Collectors` 가 `workflow_dispatch` 2회 실행 (세션 263 텔레그램 테스트).
- 근본 원인: `migration.mjs:207` · `collect-housing-supply-ratio.mjs:154` 등 **9개 collector**가
  `recordCollectorRun` 을 `if (!dryRun)` 가드 **밖**에서 호출. `recordApiQuota` 는 가드 안.
  → dry-run 실행 시 `updated=0` 이므로 `ok=0` 행이 `collector_runs` 에 박힘 → monitor ②번 오탐.

### 가드 밖 호출 9개 collector (실측)
`migration` / `collect-housing-supply-ratio` / `collect-fertility-rate` /
`collect-medical-access` / `collect-unsold-kosis` / `housing-permits` /
`collect-housing-price` / `population` / `population-sex-age` / `collect-avg-income`
(housing-permits 는 `recordApiQuota` 도 가드 밖 — 본 plan 범위 밖, BACKLOG 기록.)

### ⚠️ 긴급도 (맹점 재검토에서 확정 — 실측)
`monitor-collectors.mjs` 의 `checkEmptyRuns` 는 `fetchLatestCollectorRuns` 가 주는
**collector별 최신 행 1건**(`latest`)을 입력받음(L553·554). `migration` 의 `collector_runs`
최신 행이 `ok=0` dry-run 행인 한 — **monitor daily cron(매일 KST 09:00)이 돌 때마다 이
알림이 재발**. `migration` 다음 정상 실행 = 6/16, `housing-supply-ratio` = 6/1 →
**지금부터 6월까지 매일 오탐 알림**. 따라서 Task 3 의 오염 행 정리는 "청소"가 아니라
**매일 오는 알림을 멈추는 조치** — 본 plan 에서 Task 1 로 올림 (아래 Task 순서 정정됨).

### 세션 263 메모 정정
세션 263 메모는 "dry-run 잔재, 다음 cron 자동 해소"라 했으나 — cron 이 정상 행을 덮는 건
맞지만 다음 cron 이 6월이라 **그 전까지 매일 재발**. 근본 원인(dry-run 이 collector_runs
오염)도 미해결 — monitor dry 실행마다 재발.

### finished_at 컬럼 (실측 확인)
`recordCollectorRun` INSERT 객체(`_shared.mjs:578~586`)는 `finished_at` 을 안 넣음 —
DB 컬럼 default(`now()`)가 채움. `collector_runs` 스키마 실측: `id, collector, status,
ok_count, fail_count, skip_count, elapsed_sec, error_message, started_at, finished_at`.
Task 3 의 `finished_at` 범위 DELETE 는 이 default 값 기준이라 정상 동작.

## 수정 방향 (사용자 결정: `_shared` 함수 1곳)

`recordCollectorRun` 함수 자체에 dry-run 인지를 추가 → 9개 collector + 미래 신규 collector
전부 1곳으로 해결. collector 호출부 9곳 무변경.

설계: `process.argv.includes("--dry-run")` 체크. 단 `sbOverride`(테스트 클라이언트
주입)가 있으면 argv 무관하게 항상 INSERT — 테스트 격리 보존(`_shared.test.mjs` 의
기존 4개 테스트는 전부 `sb` 주입이라 영향 0).

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `scripts/collectors/_shared.mjs` | `recordCollectorRun` dry-run skip | 수정 ~6줄 |
| `scripts/collectors/_shared.test.mjs` | dry-run skip 회귀 테스트 | 수정 +2 케이스 |

---

## Task 0: 긴급 — 오염 행 정리 (매일 오는 알림 즉시 차단)

**Files:** 없음 (운영 DB DELETE 1회). 커밋 없음.

> 이 Task 를 맨 앞에 두는 이유: `migration`/`housing-supply-ratio` 의 `collector_runs`
> 최신 행이 `ok=0` dry-run 행이라 monitor daily cron 이 **매일 오탐 알림 발송 중**.
> 다음 정상 cron(6/1·6/16) 전까지 매일 재발 → 즉시 차단 필요. Task 1·2(재발 방지)는
> 그 다음.

- [ ] **Step 1: 삭제 대상 사전 확인 (DELETE 전 필수)**

Run:
```bash
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {data}=await sb.from('collector_runs').select('id,collector,status,ok_count,fail_count,skip_count,finished_at').in('collector',['migration','kosis-housing-supply-ratio']).gte('finished_at','2026-05-16T23:00:00Z').lt('finished_at','2026-05-17T00:00:00Z');console.log(JSON.stringify(data,null,2));"
```
Expected: `migration`·`kosis-housing-supply-ratio` 각 1행, 전부 `ok_count: 0`. (status 는 success.)
> 결과가 위와 다르면 — 예컨대 `ok_count > 0` 행이 섞였거나 행이 3개+면 — **DELETE 중단하고
> 사용자에게 실제 조회 결과 보고**. dry-run 잔재가 아닌 정상 행을 지우면 안 됨.

- [ ] **Step 2: 오염 행 삭제**

Step 1 조회가 "`ok_count=0` 2행"으로 확인된 경우에만 실행:
```bash
node --input-type=module -e "
import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';
loadEnv();const sb=getSupabase();
for(const c of ['migration','kosis-housing-supply-ratio']){
  const {data,error}=await sb.from('collector_runs').delete()
    .eq('collector',c).eq('ok_count',0)
    .gte('finished_at','2026-05-16T23:00:00Z').lt('finished_at','2026-05-17T00:00:00Z')
    .select('collector,finished_at');
  console.log(c, error ? 'ERR '+error.message : '삭제 '+(data?.length??0)+'행');
}
"
```
Expected: 각 collector `삭제 1행`.

- [ ] **Step 3: 알림 차단 확인**

삭제 후 두 collector 의 `collector_runs` 행이 0건이 됨 → `checkEmptyRuns` 가 점검 대상에서
제외(행 없으면 collector 인지 못 함) → 다음 정상 cron(6/1·6/16)까지 알림 안 옴.

Run:
```bash
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();for(const c of ['migration','kosis-housing-supply-ratio']){const {count}=await sb.from('collector_runs').select('id',{count:'exact',head:true}).eq('collector',c);console.log(c+':',count,'행');}"
```
Expected: 두 collector 모두 `0 행`.
> 참고: 행 0건 = 그 collector 가 monitor 사각지대가 되지만, 다음 cron 이 6월이라 그 전까지
> 어차피 새 데이터 없음 → 실질 모니터링 손실 0. cron 이 정상 행을 쌓으면 자동 복구.

---

## Task 1: dry-run skip 테스트 작성 (TDD — 실패 먼저)

**Files:**
- Modify: `scripts/collectors/_shared.test.mjs` (`describe("recordCollectorRun ...")` 블록 안)

- [ ] **Step 1: 테스트 2건 추가**

`scripts/collectors/_shared.test.mjs` 의 `describe("recordCollectorRun (수집기 모니터링 에픽 1단계)", () => {` 블록 안, 마지막 `it(...)` 다음에 아래 2개 `it` 추가. (블록 위치는 L269 부근. 기존 테스트는 전부 `sb` 4번째 인자 주입.)

```javascript
  it("--dry-run argv 있으면 sbOverride 없을 때 INSERT skip", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    let inserted = false;
    // getSupabase 를 타지만 insert 도달 전 argv 체크로 skip 되어야 함
    try {
      await recordCollectorRun("dry-test", { ok: 0 });
      // sbOverride 없음 + --dry-run → INSERT 시도 자체가 없어야 함 (예외 없이 통과)
      inserted = false;
    } finally {
      process.argv = orig;
    }
    expect(inserted).toBe(false);
  });

  it("--dry-run argv 있어도 sbOverride 주입 시 INSERT 수행 (테스트 격리)", async () => {
    const orig = process.argv;
    process.argv = [...orig, "--dry-run"];
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    /** @type {any} */
    const sb = { from: () => ({ insert: (/** @type {Record<string, unknown>} */ r) => { rows.push(r); return { error: null }; } }) };
    try {
      await recordCollectorRun("dry-test", { ok: 5 }, sb);
    } finally {
      process.argv = orig;
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].collector).toBe("dry-test");
  });
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run scripts/collectors/_shared.test.mjs --no-cache`
Expected: 첫 번째 신규 테스트 FAIL — 현재 `recordCollectorRun`은 argv 무관하게 `getSupabase()`를 호출하므로 `--dry-run` 환경에서 실제 Supabase INSERT를 시도(또는 getSupabase 예외). 두 번째는 PASS 할 수도 있음(sbOverride 경로). 첫 번째 FAIL 이 이 Task 의 목적.
> `Cannot read properties of undefined (reading 'config')` → `--no-cache` 누락, 재실행.

- [ ] **Step 3: 커밋**

```bash
git add scripts/collectors/_shared.test.mjs
git commit -m "test(shared): recordCollectorRun dry-run skip 회귀 테스트 2건"
```

---

## Task 2: recordCollectorRun dry-run skip 구현

**Files:**
- Modify: `scripts/collectors/_shared.mjs` (`recordCollectorRun` 함수, L572 부근)

- [ ] **Step 1: 함수 본문에 dry-run 가드 추가**

`scripts/collectors/_shared.mjs` 의 `recordCollectorRun` 함수. 현재:

```javascript
export async function recordCollectorRun(collector, result, sbOverride = null) {
  try {
    const sb = sbOverride ?? getSupabase();
```

이것을 다음으로 변경 (try 진입 직후 dry-run 가드 삽입):

```javascript
export async function recordCollectorRun(collector, result, sbOverride = null) {
  // dry-run 실행은 collector_runs 오염 방지를 위해 기록 skip.
  // sbOverride(테스트 클라이언트 주입) 가 있으면 argv 무관하게 항상 기록 — 테스트 격리.
  if (!sbOverride && process.argv.includes("--dry-run")) {
    log("runs", `${collector}: dry-run — collector_runs 기록 skip`);
    return;
  }
  try {
    const sb = sbOverride ?? getSupabase();
```

JSDoc 주석에도 한 줄 추가 — `@param result` 설명 아래, `@returns` 위에:

```javascript
 *        createReporter().summary() 반환값 + status/errorMessage/startedAt
 * @param {import("@supabase/supabase-js").SupabaseClient | null} [sbOverride]
 *        테스트용 Supabase 클라이언트 주입 (selectAll/upsertBatch 패턴 답습).
 *        주입 시 --dry-run argv 무시하고 항상 기록.
 * @returns {Promise<void>}
```

(위 JSDoc 의 `sbOverride` 줄은 기존에 이미 있음 — "주입 시 --dry-run argv 무시하고 항상 기록." 한 문장만 그 줄 설명 끝에 덧붙임.)

- [ ] **Step 2: 테스트 실행 — 통과 확인**

Run: `npx vitest run scripts/collectors/_shared.test.mjs --no-cache`
Expected: PASS — 신규 2건 포함 `recordCollectorRun` describe 블록 전체 통과. 기존 4개 테스트(`molit-units`/`collect-trades`/`schools-neis`/`population`)는 전부 `sb` 주입이라 무영향.

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck:scripts 2>&1 | grep -E "_shared|Found"`
Expected: `_shared` 관련 에러 0건.

- [ ] **Step 4: dry-run 실측 검증**

`migration` collector 를 dry-run 으로 돌려 `collector_runs` 기록 skip 확인:

Run: `node scripts/collectors/migration.mjs --dry-run 2>&1 | grep -E "dry-run|collector_runs|runs\]"`
Expected: 로그에 `migration: dry-run — collector_runs 기록 skip` 출력. (실제 DB INSERT 안 함.)

- [ ] **Step 5: 커밋**

```bash
git add scripts/collectors/_shared.mjs
git commit -m "fix(shared): recordCollectorRun dry-run 시 collector_runs 기록 skip

dry-run 실행이 ok=0 행을 남겨 monitor ②번 NULL 점검 오탐 발생.
9개 collector 가 recordCollectorRun 을 dryRun 가드 밖에서 호출 →
함수 자체에서 argv 체크로 일괄 해결. sbOverride 주입 시는 항상 기록."
```

---

## Task 3: 전체 회귀 + push

> 오염 행 정리는 Task 0 에서 완료됨 — 이 Task 는 재발 방지 코드(Task 1·2)의 회귀
> 검증 + push 만.

- [ ] **Step 1: 전체 회귀 가드**

Run:
```bash
npx vitest run scripts/collectors/_shared.test.mjs scripts/monitor-collectors.test.mjs --no-cache
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

임의 collector 를 dry-run 으로 돌린 뒤 `collector_runs` 에 행이 안 생기는지 확인.
Task 0 에서 `kosis-housing-supply-ratio` 행을 이미 0건으로 만들었으므로 — dry-run 후에도
계속 0건이면 수정이 동작한 것:

Run:
```bash
node scripts/collectors/collect-housing-supply-ratio.mjs --dry-run > /dev/null 2>&1
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {count}=await sb.from('collector_runs').select('id',{count:'exact',head:true}).eq('collector','kosis-housing-supply-ratio');console.log('kosis-housing-supply-ratio 행:',count);"
```
Expected: `kosis-housing-supply-ratio 행: 0` (dry-run 이 행을 안 남겨 Task 0 이후 그대로 0건).
> 수정 전이었다면 dry-run 이 `ok=0` 행 1개를 추가해 `1` 이 나옴 — 0 이면 수정 검증 완료.

---

## 검증 요약

| Task | 검증 | 통과 기준 |
|---|---|---|
| 0 | 오염 행 정리 | 사전 select 로 ok=0 2행 확인 → 삭제 → 두 collector 0행 |
| 1 | 테스트 실패 확인 | dry-run skip 테스트 FAIL (구현 전) |
| 2 | 테스트 통과 + dry-run 실측 | vitest PASS + `migration --dry-run` 로그에 skip 출력 |
| 3 | 회귀 + CI + 시뮬 | vitest/typecheck PASS + CI success + dry-run 후 행 미생성 |

## 명시적 비-작업 (YAGNI)

- `housing-permits.mjs` 의 `recordApiQuota` 가드 밖 문제 — 별개 사안, BACKLOG 기록.
- 9개 collector 호출부 수정 — 함수 1곳 수정으로 해결되므로 불필요.
- monitor ②번 점검 로직 변경 — 점검은 정상 동작(오염된 데이터를 정확히 탐지). 데이터 소스만 정화.

## 한계 / 후속

- `process.argv` 의존: collector 가 `--dry-run` 외 다른 방식(환경변수 등)으로 dry-run 하면
  미감지. 현재 9개 collector 전부 `process.argv.includes("--dry-run")` 패턴이라 일치 — 안전.
- 세션 263 메모(`session_2026-05-17_session263_null_monitor_push.md`)의 "다음 cron 자동
  해소" 서술은 부분 정정 대상 — 이 plan 으로 근본 해결됨을 메모에 반영 권장.
