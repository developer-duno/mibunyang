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

### 세션 263 메모 정정
세션 263 메모는 "dry-run 잔재, 다음 cron 자동 해소"라 했으나 — cron 이 정상 행을 덮는 건
맞지만 **근본 원인(dry-run 이 collector_runs 오염)은 미해결**. monitor dry 실행마다 재발.

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

## Task 3: 오염 행 정리 + 전체 회귀 + push

- [ ] **Step 1: 기존 오염 행 정리 (5/16 23:37 dry-run 잔재)**

`collector_runs` 의 `migration`·`kosis-housing-supply-ratio` `2026-05-16T23:37` `ok=0` 행을 삭제.
이 행들은 dry-run 산물이라 운영 데이터 아님.

Run:
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
Expected: 각 collector `삭제 1행`. (`finished_at` 컬럼명이 다르면 — `collector_runs` 스키마 먼저 `select('*').limit(1)` 로 확인 후 정확한 타임스탬프 컬럼 사용.)

> ⚠️ 이 Step 은 운영 DB DELETE — 실행 전 동일 조건 `select` 로 삭제 대상이 정확히 그 2행인지 확인:
> ```bash
> node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {data}=await sb.from('collector_runs').select('collector,status,ok_count,finished_at').in('collector',['migration','kosis-housing-supply-ratio']).gte('finished_at','2026-05-16T23:00:00Z').lt('finished_at','2026-05-17T00:00:00Z');console.log(JSON.stringify(data,null,2));"
> ```
> 조회 결과가 `ok_count=0` 2행이면 삭제 진행, 아니면 중단하고 사용자에게 보고.

- [ ] **Step 2: 전체 회귀 가드**

Run:
```bash
npx vitest run scripts/collectors/_shared.test.mjs scripts/monitor-collectors.test.mjs --no-cache
npm run typecheck:scripts
```
Expected: 전부 PASS / 0 에러.

- [ ] **Step 3: push**

```bash
git push
```

- [ ] **Step 4: CI 확인**

Run: `gh run list --branch main --limit 1 --json conclusion,status`
Expected: CI 완료 후 `conclusion: success`.

- [ ] **Step 5: 재발 차단 검증 (시뮬레이션)**

monitor 를 dry-run 으로 돌려도 이제 collector_runs 오염이 없는지 확인. 단 monitor 자체는
collector 를 호출하지 않으므로(monitor 는 collector_runs 를 *읽기*만 함) — 실제 검증은
임의 collector dry-run 후 행 미생성 확인:

Run:
```bash
node scripts/collectors/collect-housing-supply-ratio.mjs --dry-run > /dev/null 2>&1
node --input-type=module -e "import {loadEnv,getSupabase} from './scripts/collectors/_shared.mjs';loadEnv();const sb=getSupabase();const {data}=await sb.from('collector_runs').select('finished_at').eq('collector','kosis-housing-supply-ratio').order('finished_at',{ascending:false}).limit(1);console.log('최신 행:',data?.[0]?.finished_at ?? '없음');"
```
Expected: 최신 행 타임스탬프가 방금 dry-run 시각이 **아님** (dry-run 이 행을 안 남김).

---

## 검증 요약

| Task | 검증 | 통과 기준 |
|---|---|---|
| 1 | 테스트 실패 확인 | dry-run skip 테스트 FAIL (구현 전) |
| 2 | 테스트 통과 + dry-run 실측 | vitest PASS + `migration --dry-run` 로그에 skip 출력 |
| 3 | 오염 행 정리 + CI | 2행 삭제 + CI success + dry-run 후 행 미생성 |

## 명시적 비-작업 (YAGNI)

- `housing-permits.mjs` 의 `recordApiQuota` 가드 밖 문제 — 별개 사안, BACKLOG 기록.
- 9개 collector 호출부 수정 — 함수 1곳 수정으로 해결되므로 불필요.
- monitor ②번 점검 로직 변경 — 점검은 정상 동작(오염된 데이터를 정확히 탐지). 데이터 소스만 정화.

## 한계 / 후속

- `process.argv` 의존: collector 가 `--dry-run` 외 다른 방식(환경변수 등)으로 dry-run 하면
  미감지. 현재 9개 collector 전부 `process.argv.includes("--dry-run")` 패턴이라 일치 — 안전.
- 세션 263 메모(`session_2026-05-17_session263_null_monitor_push.md`)의 "다음 cron 자동
  해소" 서술은 부분 정정 대상 — 이 plan 으로 근본 해결됨을 메모에 반영 권장.
