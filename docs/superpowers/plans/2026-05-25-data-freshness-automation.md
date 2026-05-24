# Data Freshness Automation + 텔레그램 알림 정확성 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 1회 자동 데이터 push 흐름 구축 (외부 API 호출 0회) + 텔레그램 알림 conclusion 3종 한글 라벨 + 분기된 조치 가이드.

**Architecture:** `apartments_flat` VIEW SELECT 1회로 collect-data 의 모든 출력 필드 (camelCase 매핑 + psr/pir/dataReliability + naver) 추출 → daily-deploy.yml `refresh-data` job 신규 추가 → git push → Vercel git auto-deploy. `trigger-deploy` job + VERCEL_DEPLOY_HOOK 폐기. 텔레그램 알림은 conclusion 별 라벨/타이틀/조치 가이드 분기.

**Tech Stack:** Node.js 24, vitest, `@supabase/supabase-js`, GitHub Actions, Vercel git integration.

**Spec:** [docs/superpowers/specs/2026-05-25-data-freshness-automation-design.md](../specs/2026-05-25-data-freshness-automation-design.md)

---

## File Structure

| 파일 | 역할 | Phase |
|---|---|---|
| `scripts/notify-telegram.mjs` | 수정 — `CONCLUSION_LABEL` 상수 + `formatIssue` title/조치 가이드 conclusion 분기 | 1 |
| `scripts/monitor-collectors.mjs` | 수정 — `checkFailedRuns` 의 Issue 객체에 `conclusion` 필드 + Issue typedef + test sample 3 conclusion | 1 |
| `scripts/notify-telegram.test.mjs` | 보강 — 3 conclusion 별 message + 조치 가이드 sanity | 1 |
| `scripts/monitor-collectors.test.mjs` | 갱신 — issue 객체 conclusion 필드 강제 | 1 |
| `.github/workflows/ci.yml` | 수정 — `paths-ignore` 추가 (`public/data/**`, `docs/**`, `.claude/**`, `*.md`) | 2 |
| `scripts/collect-data.mjs` | 수정 — `--from-supabase-only` 모드 신규 + `writeOutputs` helper 추출 | 3 |
| `scripts/collect-data.test.mjs` | 보강 — Supabase-only 모드 + writeOutputs sanity | 3 |
| `.github/workflows/daily-deploy.yml` | 수정 — `permissions: contents: write` + `refresh-data` job + `trigger-deploy` 삭제 | 4 |

---

## Phase 1 — 텔레그램 알림 개선 (저위험, 독립)

### Task 1.1: notify-telegram.mjs — CONCLUSION_LABEL 상수 + ACTION_GUIDE.fail 분기

**Files:**
- Modify: `scripts/notify-telegram.mjs:81-87, 101-117`

- [ ] **Step 1.1.1: Write the failing tests in notify-telegram.test.mjs**

`scripts/notify-telegram.test.mjs` 의 `describe("formatIssue", ...)` 블록 안 마지막 it 뒤에 다음 추가:

```js
  it("conclusion=failure → '🔴 수집기 실패' + Re-run 가이드", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Collect Trades",
      conclusion: "failure",
      detail: "워크플로 실행이 실패 상태로 끝났습니다.",
      url: "https://github.com/x/y/actions/runs/123",
    });
    expect(msg).toContain("🔴 <b>수집기 실패</b>");
    expect(msg).toContain("실패 상태로 끝났습니다");
    expect(msg).toMatch(/Re-run/);
  });

  it("conclusion=cancelled → '🔴 수집기 취소' + concurrency 가이드", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Fill Missing Data",
      conclusion: "cancelled",
      detail: "워크플로 실행이 취소 상태로 끝났습니다.",
      url: "https://github.com/x/y/actions/runs/456",
    });
    expect(msg).toContain("🔴 <b>수집기 취소</b>");
    expect(msg).toContain("취소 상태로 끝났습니다");
    expect(msg).toMatch(/concurrency 큐|billing 한도/);
    expect(msg).not.toMatch(/Re-run/);
  });

  it("conclusion=timed_out → '🔴 수집기 시간 초과' + timeout 가이드", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Building Info Collection",
      conclusion: "timed_out",
      detail: "워크플로 실행이 시간 초과 상태로 끝났습니다.",
      url: "https://github.com/x/y/actions/runs/789",
    });
    expect(msg).toContain("🔴 <b>수집기 시간 초과</b>");
    expect(msg).toContain("시간 초과 상태로 끝났습니다");
    expect(msg).toMatch(/timeout-minutes|단지 당 처리 시간/);
    expect(msg).not.toMatch(/Re-run/);
  });

  it("conclusion 없는 fail 은 '수집기 이상' fallback + Re-run 가이드 사용", () => {
    const msg = formatIssue({
      kind: "fail",
      collector: "Unknown Workflow",
      detail: "어떤 이상",
    });
    expect(msg).toContain("🔴 <b>수집기 이상</b>");
    expect(msg).toMatch(/Re-run/);
  });
```

기존 L106-112 의 "조치 가이드를 kind 에 맞게 본문에 넣는다" 테스트도 다음과 같이 갱신 — `fail` 케이스에 `conclusion: "failure"` 명시 추가:

```js
  it("조치 가이드를 kind 에 맞게 본문에 넣는다", () => {
    const fail = formatIssue({ kind: "fail", collector: "x", conclusion: "failure", detail: "d" });
    expect(fail).toContain("[조치]");
    expect(fail).toMatch(/Re-run/);
    const nulls = formatIssue({ kind: "nulls", collector: "x", detail: "d" });
    expect(nulls).toMatch(/스키마 변경/);
  });
```

- [ ] **Step 1.1.2: Run failing tests**

```bash
npx vitest run scripts/notify-telegram.test.mjs
```

Expected: 4 new tests FAIL (수집기 실패/취소/시간 초과/이상 fallback). 기존 "조치 가이드" test 는 통과 유지.

- [ ] **Step 1.1.3: Implement notify-telegram.mjs changes**

`scripts/notify-telegram.mjs` L81-87 의 `ACTION_GUIDE` 를 다음으로 교체:

```js
/** conclusion 영문 → 한글 라벨 (GitHub Actions UI 영문 1:1 매핑). */
export const CONCLUSION_LABEL = {
  failure: "실패",
  cancelled: "취소",
  timed_out: "시간 초과",
};

/** 이슈 종류별 조치 가이드 — fail 은 conclusion 별 분기, 나머지는 단일 문자열. */
const ACTION_GUIDE = {
  fail: {
    failure: "[조치] run 로그에서 실패한 단계 확인 후 다시 실행(Re-run)하세요.",
    cancelled: "[조치] concurrency 큐 또는 GitHub Actions billing 한도를 확인하세요. 자동 재시도가 도착하는 경우도 많으니 1시간 후 재평가하세요.",
    timed_out: "[조치] run 로그의 단지 당 처리 시간을 확인 후 timeout-minutes 조정 또는 데이터 분할을 검토하세요.",
  },
  empty: "[조치] 수집기 소스(API·크롤링) 응답을 점검하세요 — 원본이 0건인지, 파이프라인이 끊겼는지 확인.",
  stale: "[조치] 워크플로 cron 트리거와 Actions 활성화 상태를 점검하고, 필요하면 수동으로 1회 실행하세요.",
  nulls: "[조치] 해당 수집기의 최근 run 로그와 소스 API 변경 여부를 확인하세요 (필드 누락·스키마 변경 의심).",
};
```

`formatIssue` 함수 (L101~117) 의 title 결정 + 조치 가이드 접근 정정:

```js
export function formatIssue(issue) {
  const emoji = { fail: "🔴", empty: "⚠️", stale: "🕒", nulls: "📉" }[issue.kind];
  const title = issue.kind === "fail"
    ? `수집기 ${CONCLUSION_LABEL[issue.conclusion] ?? "이상"}`
    : { empty: "데이터 0건 수집", stale: "수집기 미발화", nulls: "NULL 급증" }[issue.kind];
  const out = [`${emoji} <b>${title}</b>`, escapeHtml(issue.collector), escapeHtml(issue.detail)];
  // 상세 줄 — 점검 함수가 미리 만든 사람 말 문장들
  for (const line of issue.lines ?? []) out.push(escapeHtml(line));
  const kst = toKst(issue.at);
  if (kst) out.push(`시각: ${kst}`);
  if (issue.url) out.push(`→ ${issue.url}`);

  // 조치 가이드: fail 만 conclusion 별 분기, 나머지 kind 는 단일 문자열.
  const guide = issue.kind === "fail"
    ? (ACTION_GUIDE.fail[issue.conclusion] ?? ACTION_GUIDE.fail.failure)
    : ACTION_GUIDE[issue.kind];
  out.push(guide);

  return out.join("\n");
}
```

또한 `formatIssue` 의 JSDoc typedef (L91~99 영역) 에 `conclusion` 속성 추가:

```js
/**
 * 수집기 이상 1건을 텔레그램 메시지 텍스트로 만든다.
 * @param {{
 *   kind: "fail" | "empty" | "stale" | "nulls",
 *   collector: string,
 *   detail: string,
 *   conclusion?: "failure" | "cancelled" | "timed_out",
 *   url?: string,
 *   lines?: string[],
 *   at?: string,
 * }} issue
 * @returns {string}
 */
```

- [ ] **Step 1.1.4: Run tests to verify they pass**

```bash
npx vitest run scripts/notify-telegram.test.mjs
```

Expected: ALL tests PASS (기존 + 새 4건).

- [ ] **Step 1.1.5: Run full typecheck**

```bash
npm run typecheck:scripts
```

Expected: 0 errors.

- [ ] **Step 1.1.6: Commit**

```bash
git add scripts/notify-telegram.mjs scripts/notify-telegram.test.mjs
git commit -m "feat(notify): conclusion 3종 한글 라벨 + 조치 가이드 분기 — failure/cancelled/timed_out

세션 305 P0 사고 검증에서 사용자 텔레그램 알림이 cancelled/timed_out 도
모두 '수집기 실패' 로 표시되는 결함 발견. CONCLUSION_LABEL 상수 신규 +
formatIssue 의 title/조치 가이드 분기로 정확성 회복.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: monitor-collectors.mjs — Issue typedef + checkFailedRuns + test sample 갱신

**Files:**
- Modify: `scripts/monitor-collectors.mjs:155-162, 175-188, 562-572`
- Modify: `scripts/monitor-collectors.test.mjs:22-35`

- [ ] **Step 1.2.1: Write the failing tests in monitor-collectors.test.mjs**

`scripts/monitor-collectors.test.mjs` 의 기존 "conclusion 이 failure/cancelled/timed_out 이면 이상" 테스트 (L23-35) 를 다음으로 교체:

```js
  it("conclusion 이 failure/cancelled/timed_out 이면 이상 + 각각 conclusion 필드 박힘", () => {
    const issues = checkFailedRuns([
      { name: "A", status: "completed", conclusion: "failure", html_url: "u1" },
      { name: "B", status: "completed", conclusion: "cancelled", html_url: "u2" },
      { name: "C", status: "completed", conclusion: "timed_out", html_url: "u3" },
    ]);
    expect(issues).toHaveLength(3);
    for (const issue of issues) {
      expect(issue.kind).toBe("fail");
    }
    expect(issues[0].conclusion).toBe("failure");
    expect(issues[1].conclusion).toBe("cancelled");
    expect(issues[2].conclusion).toBe("timed_out");
    expect(issues[0].detail).toContain("실패 상태로");
    expect(issues[1].detail).toContain("취소 상태로");
    expect(issues[2].detail).toContain("시간 초과 상태로");
  });
```

- [ ] **Step 1.2.2: Run failing test**

```bash
npx vitest run scripts/monitor-collectors.test.mjs
```

Expected: 해당 test FAIL (conclusion 필드 부재 + detail 영문 그대로).

- [ ] **Step 1.2.3: Implement monitor-collectors.mjs changes**

`scripts/monitor-collectors.mjs` L155-162 의 Issue typedef 에 `conclusion` 속성 추가:

```js
/**
 * @typedef {object} Issue
 * @property {"fail"|"empty"|"stale"|"nulls"} kind
 * @property {string} collector
 * @property {string} detail 한 줄 요약 (콘솔 로그·하위호환용)
 * @property {"failure"|"cancelled"|"timed_out"} [conclusion] fail 일 때만 — 워크플로 conclusion
 * @property {string} [url]
 * @property {string[]} [lines] 본문에 펼칠 상세 줄 (점검 함수가 만든 사람 말 문장)
 * @property {string} [at] 이슈 발생 ISO 시각 (formatIssue 가 KST 로 변환)
 */
```

import 절 L23 정정 — `CONCLUSION_LABEL` 추가:

```js
import { sendTelegram, formatIssue, buildMessages, toKst, CONCLUSION_LABEL } from "./notify-telegram.mjs";
```

`checkFailedRuns` 함수 (L175-188) 의 push 부분 정정:

```js
    issues.push({
      kind: "fail",
      collector: run.name ?? "(이름 없음)",
      conclusion: /** @type {"failure"|"cancelled"|"timed_out"} */ (run.conclusion),
      detail: `워크플로 실행이 ${CONCLUSION_LABEL[run.conclusion] ?? run.conclusion} 상태로 끝났습니다.`,
      url: run.html_url,
      at: run.created_at,
    });
```

L562-572 의 test mode sample 의 fail sample 1개를 3 conclusion sample 3개로 확장:

```js
    /** @type {Issue[]} */
    const samples = [
      {
        kind: "fail",
        collector: "School District Collection",
        conclusion: "failure",
        detail: "워크플로 실행이 실패 상태로 끝났습니다.",
        url: "https://github.com/developer-duno/mibunyang/actions",
        at: nowIso,
      },
      {
        kind: "fail",
        collector: "Fill Missing Data",
        conclusion: "cancelled",
        detail: "워크플로 실행이 취소 상태로 끝났습니다.",
        url: "https://github.com/developer-duno/mibunyang/actions",
        at: nowIso,
      },
      {
        kind: "fail",
        collector: "Building Info Collection (MOLIT)",
        conclusion: "timed_out",
        detail: "워크플로 실행이 시간 초과 상태로 끝났습니다.",
        url: "https://github.com/developer-duno/mibunyang/actions",
        at: nowIso,
      },
      // 기존 empty/nulls sample 유지 (코드 변경 0)
```

- [ ] **Step 1.2.4: Run tests to verify they pass**

```bash
npx vitest run scripts/monitor-collectors.test.mjs scripts/notify-telegram.test.mjs
```

Expected: ALL tests PASS.

- [ ] **Step 1.2.5: Run typecheck + audit**

```bash
npm run typecheck:scripts
node scripts/audit-monitor-coverage.mjs
```

Expected: 0 errors.

- [ ] **Step 1.2.6: Commit**

```bash
git add scripts/monitor-collectors.mjs scripts/monitor-collectors.test.mjs
git commit -m "feat(monitor): Issue.conclusion 필드 + checkFailedRuns 한글 detail

notify-telegram 의 CONCLUSION_LABEL 답습 → checkFailedRuns 가 push 하는
Issue 객체에 conclusion 필드 + detail 한글 라벨 박제. test sample 도
3 conclusion 별로 확장 (--mode=test 발화 시 모두 시각화).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Phase 1 통합 검증 (workflow_dispatch test 모드)

- [ ] **Step 1.3.1: Push Phase 1 commits + wait CI**

```bash
git push origin main
```

CI run 추적:

```bash
gh run watch
```

Expected: CI success (lint + typecheck + test 모두 통과).

- [ ] **Step 1.3.2: monitor-collectors --mode=test 발화 + 텔레그램 메시지 확인**

```bash
gh workflow run monitor-collectors.yml --ref main -f mode=test
```

3분 대기 후 텔레그램 메시지 도착 확인:
- 🔴 수집기 실패 (School District Collection) + Re-run 가이드
- 🔴 수집기 취소 (Fill Missing Data) + concurrency 가이드
- 🔴 수집기 시간 초과 (Building Info Collection) + timeout 가이드
- ⚠️ 데이터 0건 수집 + 원본 점검 가이드
- 📉 NULL 급증 + 스키마 변경 가이드

확인 후 사용자에게 "Phase 1 텔레그램 검증 통과" 보고.

---

## Phase 2 — ci.yml paths-ignore (저위험, 독립)

### Task 2.1: ci.yml + e2e.yml 에 paths-ignore 추가

**Files:**
- Modify: `.github/workflows/ci.yml:1-7`
- Modify: `.github/workflows/e2e.yml:1-7` (있으면 동일 적용)

- [ ] **Step 2.1.1: Check current ci.yml + e2e.yml trigger**

```bash
sed -n '1,10p' .github/workflows/ci.yml
sed -n '1,10p' .github/workflows/e2e.yml
```

현재 trigger 박힌 줄 정확히 박제 후 정정.

- [ ] **Step 2.1.2: Modify ci.yml paths-ignore**

`.github/workflows/ci.yml` 의 `on:` 블록을 다음으로 교체:

```yaml
name: CI
on:
  push:
    branches: [main]
    paths-ignore:
      - 'public/data/**'
      - 'docs/**'
      - '.claude/**'
      - '*.md'
  pull_request:
    branches: [main]
```

- [ ] **Step 2.1.3: Modify e2e.yml (있을 시)**

`.github/workflows/e2e.yml` 의 `on:` 블록에 동일한 `paths-ignore` 추가 (push trigger 자리만).

- [ ] **Step 2.1.4: Validate workflow yaml**

```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); ['ci', 'e2e'].forEach(name => { const path = '.github/workflows/' + name + '.yml'; if (fs.existsSync(path)) { const doc = yaml.load(fs.readFileSync(path, 'utf8')); console.log(name, 'on:', JSON.stringify(doc.on)); } });"
```

Expected: `paths-ignore` array 박힘 확인 (둘 다).

- [ ] **Step 2.1.5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/e2e.yml
git commit -m "ci(workflows): paths-ignore — 데이터/docs 전용 push 시 CI 스킵

세션 305 P0 spec v3 — daily-deploy.yml refresh-data 가 public/data/**
push 시 CI ~9분 발화 비용 회피. docs/, .claude/, *.md 도 같이 제외.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: Phase 2 검증 — paths-ignore 동작 실측

- [ ] **Step 2.2.1: Push + sanity test**

```bash
git push origin main
sleep 30
gh run list --branch main --limit 3 --json conclusion,name,event,createdAt --jq '.[] | "\(.createdAt) \(.event) \(.name) \(.conclusion)"'
```

방금 Phase 2 commit 자체는 `.github/workflows/` 변경이라 CI 발화 정상 (paths-ignore 영향 안 받음).

- [ ] **Step 2.2.2: paths-ignore 실측 — 더미 docs commit**

```bash
echo "" >> docs/superpowers/specs/2026-05-25-data-freshness-automation-design.md
git add docs/superpowers/specs/2026-05-25-data-freshness-automation-design.md
git commit -m "docs(spec): trailing newline (Phase 2 paths-ignore 검증용)"
git push origin main
sleep 30
gh run list --branch main --limit 3 --json conclusion,name,event,createdAt --jq '.[] | "\(.createdAt) \(.event) \(.name) \(.conclusion)"'
```

Expected: 방금 push 에 대한 CI run 0건 (paths-ignore 동작). Phase 1 의 마지막 CI run 그대로.

확인 후 사용자에게 "Phase 2 paths-ignore 검증 통과" 보고.

---

## Phase 3 — collect-data --from-supabase-only 모드 추가 (핵심)

### Task 3.1: writeOutputs helper 추출

**Files:**
- Modify: `scripts/collect-data.mjs:1066-1093` (JSON write 블록 → helper 추출)

- [ ] **Step 3.1.1: Check current JSON write block**

```bash
sed -n '1066,1095p' scripts/collect-data.mjs
```

L1066-1093 의 JSON write 블록 정확히 박제.

- [ ] **Step 3.1.2: Extract writeOutputs helper**

`scripts/collect-data.mjs` L1066 직전 (예: L40 영역, main 함수 밖) 에 다음 helper 신규 추가:

```js
/**
 * 4 JSON 출력 (apartments + list + prices + meta).
 * collect-data 본 흐름과 --from-supabase-only 모드 둘 다 호출.
 * @param {object[]} apartments — 출력할 단지 배열 (이미 내부 필드 제거된 상태)
 * @param {string} fetchedAt — ISO 시각 (apartments + list + prices 의 fetchedAt/dataUpdatedAt 박힘)
 */
function writeOutputs(apartments, fetchedAt) {
  const outDir = resolve(ROOT, "public/data");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // list 1.66MB (가격배열 4개 제외) + prices 11.35MB (id + 4 배열) 분리 출력 + 원본 13MB 유지 (롤백 안전)
  const listData = apartments.map(({ priceByArea, rentByArea, jeonseByArea, priceByFloor, ...rest }) => rest);
  const pricesData = apartments.map(a => ({
    id: a.id,
    priceByArea: a.priceByArea ?? null,
    rentByArea: a.rentByArea ?? null,
    jeonseByArea: a.jeonseByArea ?? null,
    priceByFloor: a.priceByFloor ?? null,
  }));

  // 양쪽 키 동시 박힘 (세션 292) — staticDataApi.ts L48-50 fallback 의존 제거 + Supabase 분기 응답과 키 정합.
  const output = { ok: true, data: apartments, count: apartments.length, fetchedAt, dataUpdatedAt: fetchedAt };
  writeFileSync(resolve(outDir, "apartments.json"), JSON.stringify(output));
  writeFileSync(resolve(outDir, "apartments-list.json"), JSON.stringify({ ok: true, data: listData, count: listData.length, fetchedAt, dataUpdatedAt: fetchedAt }));
  writeFileSync(resolve(outDir, "apartments-prices.json"), JSON.stringify({ ok: true, data: pricesData, count: pricesData.length, fetchedAt, dataUpdatedAt: fetchedAt }));
  writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(meta, null, 2));
}
```

main 함수 L1066-1093 의 JSON write 블록을 다음으로 교체 (`fetchedAt` 박제 + `apartments` 내부 필드 제거 + helper 호출):

```js
  // JSON 출력
  const fetchedAt = new Date().toISOString();
  meta.fetchedAt = fetchedAt;
  meta.count = apartments.length;

  // 내부 필드 제거
  apartments = apartments.map(({ _regionalUnsold, _avgIncome, _kosisEstimated, ...rest }) => rest);

  writeOutputs(apartments, fetchedAt);
```

- [ ] **Step 3.1.3: Run existing collect-data tests**

```bash
npx vitest run scripts/collect-data.test.mjs
```

Expected: 기존 494줄 test 모두 PASS (helper 추출이라 동작 변경 없음).

- [ ] **Step 3.1.4: Run typecheck**

```bash
npm run typecheck:scripts
```

Expected: 0 errors.

- [ ] **Step 3.1.5: Commit**

```bash
git add scripts/collect-data.mjs
git commit -m "refactor(collect-data): writeOutputs helper 추출 — DRY 준비 (Phase 3 사전 작업)

L1066-1093 의 JSON write 블록을 writeOutputs() helper 로 추출. 다음 commit
의 --from-supabase-only 모드 에서 동일 helper 재사용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: --from-supabase-only 모드 + 회귀 가드 + 테스트

**Files:**
- Modify: `scripts/collect-data.mjs:7-25` (import), 함수 추가 + main 분기
- Modify: `scripts/collect-data.test.mjs` (마지막에 describe 블록 추가)

- [ ] **Step 3.2.1: Write the failing tests in collect-data.test.mjs**

`scripts/collect-data.test.mjs` 마지막 describe 블록 뒤에 다음 추가:

```js
import { vi } from "vitest";

describe("supabaseOnlyMode", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    vi.restoreAllMocks();
  });

  it("SUPABASE_URL/ANON_KEY 없으면 process.exit(1)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit called");
    });
    // supabaseOnlyMode 는 collect-data.mjs 에서 export
    const { supabaseOnlyMode } = await import("./collect-data.mjs");
    await expect(supabaseOnlyMode()).rejects.toThrow("exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("apartments_flat SELECT 결과로 4 JSON 파일 출력 + 외부 fetch 0회", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon";

    // global fetch mock — 호출되면 fail
    const fetchSpy = vi.fn(() => Promise.reject(new Error("fetch must not be called")));
    vi.stubGlobal("fetch", fetchSpy);

    // supabase client mock — apartments_flat 100 rows
    const mockRows = Array.from({ length: 100 }, (_, i) => ({
      id: `ah-${i}`,
      name: `테스트단지${i}`,
      region: "서울",
      count: 100,
      psr: 1.0,
      pir: 5.0,
      dataReliability: 80,
      priceByArea: { 84: 50000 },
      rentByArea: null,
      jeonseByArea: null,
      priceByFloor: null,
    }));

    // selectAll 이 호출하는 queryFn(client).range() 가 데이터 반환
    const rangeMock = vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }).mockResolvedValue({ data: [], error: null });
    const selectMock = vi.fn(() => ({ range: rangeMock }));
    const fromMock = vi.fn(() => ({ select: selectMock }));
    const supabaseMock = { from: fromMock };

    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => supabaseMock }));
    vi.resetModules();

    const { supabaseOnlyMode } = await import("./collect-data.mjs");
    await supabaseOnlyMode();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("apartments_flat");

    // 출력 파일 4개 존재 확인
    const fs = await import("node:fs");
    expect(fs.existsSync("public/data/apartments.json")).toBe(true);
    expect(fs.existsSync("public/data/apartments-list.json")).toBe(true);
    expect(fs.existsSync("public/data/apartments-prices.json")).toBe(true);
    expect(fs.existsSync("public/data/meta.json")).toBe(true);

    // meta.json 의 count 검증
    const meta = JSON.parse(fs.readFileSync("public/data/meta.json", "utf8"));
    expect(meta.count).toBe(100);
    expect(meta.phases.supabaseOnly).toEqual({ ok: true, count: 100 });
  });

  it("count < 1000 이면 회귀 가드 fail (process.exit(1))", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon";

    const mockRows = Array.from({ length: 500 }, (_, i) => ({ id: `ah-${i}` }));
    const rangeMock = vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }).mockResolvedValue({ data: [], error: null });
    const fromMock = vi.fn(() => ({ select: () => ({ range: rangeMock }) }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ from: fromMock }) }));
    vi.resetModules();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit called");
    });

    const { supabaseOnlyMode } = await import("./collect-data.mjs");
    await expect(supabaseOnlyMode()).rejects.toThrow("exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 3.2.2: Run failing test**

```bash
npx vitest run scripts/collect-data.test.mjs
```

Expected: 3 new tests FAIL (`supabaseOnlyMode` export 안 됨).

- [ ] **Step 3.2.3: Implement --from-supabase-only mode**

`scripts/collect-data.mjs` 의 import 절 (L7-25) 에 `selectAll` 추가:

```js
import { REGION_MAP, VALID_REGIONS, BUILDER_ALIASES, resolveBuilder, REGION_LAWD_PREFIX, GU_LAWD_MAP, getLawdCd, normalizeGu, loadEnv, fetchWithRetry, selectAll } from "./collectors/_shared.mjs";
```

`writeOutputs` 함수 정의 뒤에 (또는 main 함수 위에) `supabaseOnlyMode` 함수 신규 추가:

```js
/**
 * --from-supabase-only 모드 — apartments_flat VIEW 1회 SELECT 로 외부 API 호출 0회.
 * Phase 1~9 흐름 우회. 매일 cron 자동화 안전.
 * @returns {Promise<void>}
 */
export async function supabaseOnlyMode() {
  log("=== Supabase-Only 모드 (외부 API 호출 0회) ===");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logError("supabase-only", "SUPABASE_URL / SUPABASE_ANON_KEY 환경변수 필수");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // apartments_flat VIEW — camelCase + psr/pir/dataReliability + naver 모두 박힘
  log("apartments_flat SELECT...");
  const apartments = await selectAll(
    (s) => s.from("apartments_flat").select("*"),
    supabase,
  );
  log(`  ${apartments.length}건 로드`);

  // 회귀 가드 — count 절대값 + 전일 대비 임계값
  const MIN_COUNT = 1000;
  if (apartments.length < MIN_COUNT) {
    logError("supabase-only", `count ${apartments.length} < ${MIN_COUNT} — 회귀 가드 발동`);
    process.exit(1);
  }

  // 전일 대비 -200 이상 감소 검출 (기존 apartments.json 박힘 시)
  const cachedPath = resolve(ROOT, "public/data/apartments.json");
  if (existsSync(cachedPath)) {
    try {
      const prev = JSON.parse(readFileSync(cachedPath, "utf8"));
      const prevCount = prev.count ?? 0;
      const diff = apartments.length - prevCount;
      if (diff <= -200) {
        logError("supabase-only", `count 전일 대비 ${diff} 감소 (이전 ${prevCount} → 신규 ${apartments.length}) — 회귀 가드 발동`);
        process.exit(1);
      }
      log(`  전일 대비 count 변동: ${diff >= 0 ? "+" : ""}${diff} (${prevCount} → ${apartments.length})`);
    } catch (err) {
      log(`  cached apartments.json 파싱 실패 (회귀 가드 비교 스킵): ${err.message}`);
    }
  }

  // JSON 출력
  const fetchedAt = new Date().toISOString();
  meta.fetchedAt = fetchedAt;
  meta.count = apartments.length;
  meta.phases.supabaseOnly = { ok: true, count: apartments.length };

  writeOutputs(apartments, fetchedAt);
  log(`완료! ${apartments.length}건 출력`);
}
```

main 함수 시작부 (예: L1003 영역 main async function 의 첫 줄) 에 분기 추가:

```js
async function main() {
  if (process.argv.includes("--from-supabase-only")) {
    await supabaseOnlyMode();
    return;
  }

  // 기존 Phase 1~9 흐름 유지 (사용자 로컬 수동 호출)
  const startTime = Date.now();
  // ... 기존 본문
}
```

- [ ] **Step 3.2.4: Run tests to verify they pass**

```bash
npx vitest run scripts/collect-data.test.mjs
```

Expected: ALL tests PASS (기존 + 새 3건).

- [ ] **Step 3.2.5: Run typecheck**

```bash
npm run typecheck:scripts
```

Expected: 0 errors.

- [ ] **Step 3.2.6: 로컬 통합 dry-run (실제 Supabase 접속)**

`.env.local` 또는 `.env` 에 `SUPABASE_URL` + `SUPABASE_ANON_KEY` 박힘 가정. 다음 실행:

```bash
node --env-file=.env.local scripts/collect-data.mjs --from-supabase-only
```

Expected output 의 핵심 줄:
- `=== Supabase-Only 모드 (외부 API 호출 0회) ===`
- `apartments_flat SELECT...`
- `  1565건 로드` (실제 단지 수)
- `  전일 대비 count 변동: +N (1500~1700 범위)`
- `완료! 1565건 출력`

`public/data/*.json` 4개 파일 갱신 + `meta.json` 의 `phases.supabaseOnly: { ok: true, count: 1565 }` 박힘 확인.

```bash
node -e "const m = require('./public/data/meta.json'); console.log(m.fetchedAt, m.count, m.phases.supabaseOnly);"
```

- [ ] **Step 3.2.7: Commit**

```bash
git add scripts/collect-data.mjs scripts/collect-data.test.mjs
git commit -m "feat(collect-data): --from-supabase-only 모드 + 회귀 가드 — 외부 API 0회

세션 305 P0 spec v3 핵심 변경. apartments_flat VIEW 1회 SELECT 로
collect-data 의 모든 출력 필드 (camelCase + psr/pir/dataReliability +
naver) 추출. Phase 1~9 우회 → 매일 cron 자동화 안전.

회귀 가드 = count < 1000 또는 전일 대비 -200 이상 감소 시 process.exit(1).
워크플로 빨강 → 텔레그램 알림 → 사용자 점검.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3.2.8: Push + CI 통과 확인**

```bash
git push origin main
gh run watch
```

Expected: CI success.

---

## Phase 4 — daily-deploy.yml refresh-data job 추가

### Task 4.1: daily-deploy.yml 수정 + workflow_dispatch 검증

**Files:**
- Modify: `.github/workflows/daily-deploy.yml` (전체 재작성)

- [ ] **Step 4.1.1: Check current daily-deploy.yml**

```bash
cat .github/workflows/daily-deploy.yml
```

기존 박제 줄 정확히 파악.

- [ ] **Step 4.1.2: Modify daily-deploy.yml**

`.github/workflows/daily-deploy.yml` 전체를 다음으로 교체:

```yaml
name: Daily Data Refresh
on:
  schedule:
    - cron: '0 18 * * *' # UTC 18:00 = KST 03:00
  workflow_dispatch: # 수동 트리거

# 세션 305 P0 spec v3: git push 권한 필요 (Vercel git auto-deploy 가 hook 대체).
permissions:
  contents: write

concurrency:
  group: daily-scoring-deploy
  cancel-in-progress: false

jobs:
  compute-scores:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci --legacy-peer-deps
      - name: Compute apartment scores (cats_cache)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs

  refresh-data:
    needs: compute-scores
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: true
          fetch-depth: 1
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci --legacy-peer-deps

      - name: collect-data --from-supabase-only
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: node scripts/collect-data.mjs --from-supabase-only

      - name: Commit + push (변경 있을 때만)
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data/
          if git diff --cached --quiet; then
            echo "변경 없음 — push skip"
            exit 0
          fi
          DATE=$(date -u +%F)
          git commit -m "data: daily refresh $DATE (auto)"
          git push origin main
```

핵심 차이 (기존 vs 신규):
- `trigger-deploy` job **삭제** (Vercel git auto-deploy 가 대체)
- `permissions: contents: write` **신규 추가**
- `refresh-data` job **신규 추가** (compute-scores 의존)
- `SUPABASE_ANON_KEY` env **신규 추가** (compute-scores 의 SERVICE_KEY 와 별개)

- [ ] **Step 4.1.3: Validate yaml**

```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const doc = yaml.load(fs.readFileSync('.github/workflows/daily-deploy.yml', 'utf8')); console.log('jobs:', Object.keys(doc.jobs)); console.log('permissions:', doc.permissions); console.log('refresh-data needs:', doc.jobs['refresh-data'].needs);"
```

Expected:
- jobs: `[ 'compute-scores', 'refresh-data' ]`
- permissions: `{ contents: 'write' }`
- refresh-data needs: `compute-scores`

- [ ] **Step 4.1.4: Commit + push**

```bash
git add .github/workflows/daily-deploy.yml
git commit -m "feat(workflow): daily-deploy.yml refresh-data job — 매일 자동 데이터 push

세션 305 P0 spec v3 마무리. compute-scores 후 refresh-data job 추가
(collect-data --from-supabase-only → public/data/*.json 갱신 →
github-actions[bot] 명의 commit + push). Vercel git auto-deploy 가
production deploy 자동 trigger.

trigger-deploy job 삭제 (Deploy Hook 호출 제거 — git push 시 이중
deploy 위험 회피, Vercel 공식 문서 답습).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
gh run watch
```

Expected: CI success.

---

### Task 4.2: workflow_dispatch 통합 검증

- [ ] **Step 4.2.1: workflow_dispatch 1회 발화**

```bash
gh workflow run daily-deploy.yml --ref main
sleep 10
gh run list --workflow=daily-deploy.yml --limit 1 --json status,conclusion,databaseId
```

run id 박제 후 monitor:

```bash
gh run watch <run_id>
```

Expected: 두 job 모두 success (compute-scores ~45s + refresh-data ~30s).

- [ ] **Step 4.2.2: 신규 commit 박힘 확인**

```bash
git fetch origin main
git log origin/main --oneline -3
```

Expected: 최상위 commit = `"data: daily refresh YYYY-MM-DD (auto)"` (github-actions[bot] 명의).

- [ ] **Step 4.2.3: Vercel deploy 자동 발화 확인 (1회만)**

```bash
sleep 60
vercel ls mibunyang --environment=production 2>&1 | head -5
```

Expected: 새 deployment 1건 (~1분 전), 이중 발화 0건.

- [ ] **Step 4.2.4: prod meta.json fetchedAt 갱신 확인**

```bash
sleep 30
curl -s "https://mibunyang-peach.vercel.app/data/meta.json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('fetchedAt:', d.fetchedAt); console.log('count:', d.count); console.log('phases.supabaseOnly:', d.phases.supabaseOnly);"
```

Expected: `fetchedAt` = 최근 5분 이내 ISO. `phases.supabaseOnly: { ok: true, count: ... }` 박힘.

- [ ] **Step 4.2.5: CI 미발화 확인 (paths-ignore 동작)**

```bash
gh run list --branch main --limit 5 --json conclusion,name,event,createdAt --jq '.[] | "\(.createdAt) \(.event) \(.name)"'
```

Expected: refresh-data 가 한 push 에 대해 CI run 0건 (paths-ignore 가 public/data/** 스킵).

- [ ] **Step 4.2.6: 텔레그램 알림 — 정상 push 시 무알림 확인**

monitor-collectors 가 workflow_run trigger 로 Daily Data Refresh 도 감시. success 면 알림 없어야 함.

```bash
gh run list --workflow=monitor-collectors.yml --limit 1 --json conclusion,createdAt
```

마지막 monitor-collectors run 이 success 인지 + 텔레그램에 새 알림 0건 인지 사용자 확인.

확인 후 사용자에게 "Phase 4 daily-deploy 통합 검증 통과 — prod 자동 갱신 작동" 보고.

---

## Phase 5 — 1주일 운영 검증 + VERCEL_DEPLOY_HOOK 폐기

### Task 5.1: 1주 운영 monitor

**스케줄:** Phase 4 commit 후 7일 (즉 다음 7회 KST 03:00 cron)

- [ ] **Step 5.1.1: 매일 morning sanity (사용자 수동, 자동화 0)**

매일 KST 09:00 사용자가 다음 명령 1회:

```bash
gh run list --workflow=daily-deploy.yml --limit 3 --json conclusion,createdAt,databaseId --jq '.[] | "\(.createdAt) \(.conclusion) id=\(.databaseId)"'
curl -s "https://mibunyang-peach.vercel.app/data/meta.json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('fetchedAt:', d.fetchedAt, 'count:', d.count);"
```

Expected:
- daily-deploy 마지막 run = success + 6시간 이내
- prod meta.json fetchedAt = 6시간 이내

실패 시 텔레그램 알림 도착 확인. 텔레그램 새 알림 0건 + run 0건 = monitor 자체 문제 (별도 spec 영역).

- [ ] **Step 5.1.2: 1주 후 종합 평가**

7일 후 다음 데이터 정리:

```bash
gh run list --workflow=daily-deploy.yml --limit 8 --json conclusion,createdAt --jq '[.[] | {date: .createdAt[:10], conclusion}] | .[]'
```

Expected: 7개 run 모두 success. failure 0건 또는 ≤ 1건 (transient Supabase 장애 등).

stale 사고 0건 확인 후 spec 종결.

---

### Task 5.2: VERCEL_DEPLOY_HOOK secret 폐기 (선택)

**전제:** Task 5.1 1주 운영 검증 통과 후 별도 PR.

- [ ] **Step 5.2.1: VERCEL_DEPLOY_HOOK 사용처 재검증**

```bash
grep -rn "VERCEL_DEPLOY_HOOK" .github/ scripts/ docs/ 2>&1
```

Expected: docs/ 에만 박힘 (실제 사용처 0건, daily-deploy 에서 삭제됨).

- [ ] **Step 5.2.2: GitHub secret 삭제**

```bash
gh secret delete VERCEL_DEPLOY_HOOK
```

또는 사용자가 GitHub UI 에서 직접 삭제. 두 방식 동등.

- [ ] **Step 5.2.3: Vercel Deploy Hook URL 회수 (사용자 직접)**

Vercel Dashboard → Project Settings → Git → Deploy Hooks → 해당 Hook 삭제.

확인 후 사용자에게 "Phase 5 종합 검증 + secret 폐기 완료. Spec 종결." 보고.

---

## Self-Review Checklist

다음 항목 모두 ✅ 후 plan 종결:

- [ ] Spec coverage — 모든 spec Section (Architecture / Components 1~7 / Error Handling / Testing) 이 plan task 에 매핑됨
- [ ] Placeholder scan — `TBD`, `TODO`, `implement later`, `appropriate error handling` 0건
- [ ] Type consistency — `Issue.conclusion` 타입이 typedef + push + test + formatIssue 4 자리 모두 `"failure"|"cancelled"|"timed_out"` 일관
- [ ] Function signature — `supabaseOnlyMode()` 시그니처가 test + main 분기 + export 3 자리 모두 `Promise<void>` 일관
- [ ] Helper naming — `writeOutputs(apartments, fetchedAt)` 시그니처가 main + supabaseOnlyMode 2 자리 모두 일관
- [ ] Test commands — `npx vitest run <path>` + `npm run typecheck:scripts` 일관
- [ ] Commit message — `feat()` / `refactor()` / `ci()` / `data()` prefix 박힘 일관 (기존 git log 패턴 답습)

---

## Rollback Plan

각 Phase 별 rollback (이상 발견 시):

| Phase | Rollback |
|---|---|
| Phase 1 | `git revert <commit_sha>` 2건 (notify-telegram + monitor-collectors). 이전 영문 detail 복원. |
| Phase 2 | `git revert <commit_sha>` 1건 (ci.yml paths-ignore). CI 가 모든 push 에 다시 발화. |
| Phase 3 | `git revert <commit_sha>` 2건 (writeOutputs helper + supabaseOnlyMode). 기존 Phase 1~9 흐름 복원. |
| Phase 4 | `git revert <commit_sha>` 1건 (daily-deploy.yml). `VERCEL_DEPLOY_HOOK` secret 재등록 (Phase 5.2 미실행이면 그대로). trigger-deploy job 복원. |
| Phase 5 | n/a (운영 검증 + secret 폐기만, 코드 변경 0) |

전체 rollback = `git revert <Phase 4 commit>..<Phase 1 commit>` 역순. Vercel git auto-deploy 가 다음 push 에 발화.
