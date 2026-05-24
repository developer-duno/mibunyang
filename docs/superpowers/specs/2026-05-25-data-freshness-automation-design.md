# Data Freshness Automation + 텔레그램 알림 정확성 개선 (v3)

> 세션 305 P0 사고 (운영 사이트 5일 stale) 의 재발 차단 설계 + 알림 시스템 부수 결함 3건 동시 해소.
>
> **v3 = v2 자가 검증 후 9건 결함 발견 + 빈도 재결정 결과**

## v3 변경 요약 (v2 와 차이)

| v2 가설 | v3 진실 (실측 근거) |
|---|---|
| 매일 cron 으로 `collect-data.mjs` 전체 ETL 자동화 | ❌ 사용자 실측 30일 사이 commit 3회 (9-10일 1회) + 외부 API ~20,000회/회 + MOLIT 일일 한도 10,000회 위협 |
| `SUPABASE_SERVICE_KEY` 만 박혀있으면 충분 | ❌ collect-data Phase 9 = `SUPABASE_ANON_KEY` 필요 |
| `git diff --quiet public/data/` skip 로직 | ❌ `fetchedAt` 매번 갱신 → diff 항상 발생 → skip 무용 |
| count -5% 회귀 가드 | ⚠️ 1565 × 5% = 78 단지. false positive 위험 |
| `branch protection Mitigation` | ❌ 불필요 (main 보호 0건 실측) |
| `daily-deploy 1분 → 3~5분` | ❌ 외부 API 호출 ~20,000 회 시 수십 분 가능 |

**v3 의 핵심 변경**: collect-data.mjs 에 `--from-supabase-only` 모드 신규 추가. `apartments_flat` VIEW 1회 SELECT 로 외부 API 호출 0회. 매일 cron 안전.

## Context (왜 하는가)

### P0 사고 — 운영 사이트 5일 stale

2026-05-19 ~ 05-24, `mibunyang-peach.vercel.app` 의 `/data/meta.json` `fetchedAt` = `2026-05-19T16:57:53Z` 5일 박힘. 사용자 UI "**2026-05-19 업데이트**" 표시 = 신뢰도 직격.

진앙 (세션 305 grep + 실측):

- `scripts/prebuild.mjs` L8-13: Vercel 환경에서 `collect-data.mjs` 스킵, `split-apartments-json.mjs` 만 실행. 즉 **Vercel 빌드 시 fresh fetch 0회**.
- `.github/workflows/` + `scripts/` 어디에도 `git add`/`git commit`/`git push` 0건. **ETL 결과 자동 push 흐름 부재**.
- 결과 = `public/data/*.json` 은 **사용자 수동 commit 의존**. 마지막 commit `4f410ae` (2026-05-20 02:14 KST) 이후 5일 동안 ETL 1회도 commit 안 됨.

세션 305 에서 `673a050` (수동 commit) 으로 즉시 해소했으나 **자동화 안 하면 같은 stale 사고 재발 100%**.

### 부수 결함 — 텔레그램 알림 정확성

monitor-collectors 의 텔레그램 알림이 conclusion 3종 (`failure` / `cancelled` / `timed_out`) 을 모두 같은 형식 "수집기 실패" 로 표시:

1. **영문 그대로** = 비전문 사용자 인지 어려움
2. **타이틀 일관 "수집기 실패"** = cancelled / timeout 도 모두 "실패" 로 잘못 표기
3. **조치 가이드 일률 "Re-run 하세요"** = cancelled 는 Re-run 정답 아님

### 목표 산출물

1. 매일 1회 자동 데이터 push 흐름 (Hard fail 정책, **외부 API 호출 0회**)
2. 텔레그램 알림 3 conclusion 한글 라벨 + 분기된 조치 가이드
3. CI 가 데이터-only push 시 발화 안 함 (paths-ignore)
4. 회귀 가드 — count 절대값 임계값 + 알림 형식 sanity test

## 진앙 검증 (실측 근거)

세션 305 + spec v3 검증 결과:

| 가설 | 실측 결과 |
|---|---|
| daily-deploy.yml 안에서 push 해도 ci.yml 재발화 없다 | ❌ `ci.yml` L2-6 `push: branches: [main]` → 매 데이터 push 마다 CI ~9분 발화 |
| daily-deploy 의 GITHUB_TOKEN 이 main push 가능 | ❌ `permissions` 블록 없음 = default `contents: read` → push 거부 |
| Deploy Hook 호출 + git push 동시 시 dedup | ❌ Vercel 공식 문서 ([docs/deploy-hooks](https://vercel.com/docs/deploy-hooks)) "Other Optimizations" 절은 **같은 Deploy Hook** 중복 호출만 dedup 명시. git push 와의 dedup 없음. 실측: 14h 사이 production deploy 12회 = 이중 발화 증거 |
| concurrency `daily-scoring-deploy` 그룹 단독 | ✅ daily-deploy.yml 단독 사용. 충돌 0건 |
| collect-data 가 SUPABASE_SERVICE_KEY 만 필요 | ❌ Phase 9 `SUPABASE_ANON_KEY` 필수 (L890) |
| `collect-data` 외부 API ~20,000회 호출 가능 | ✅ Phase 1~7 전부 외부 fetch. 매일 호출 시 MOLIT 일일 한도 10,000회 위협 + 다른 collector 쿼터 충돌 |
| `apartments_flat` VIEW 가 모든 필드 join 박혀있음 | ✅ supabase/migrations/20260315000000_add_price_arrays.sql L: `CREATE VIEW apartments_flat AS ...` (4 시세 배열 + naver + infra + schools 모두 join). `feedback_view_alias_source_of_truth.md` 답습 |
| `main` branch protection 활성 | ❌ `gh api repos/.../branches/main/protection` 404 (보호 0건). push 거부 우려 0 |

## 설계

### Architecture

```text
daily-deploy.yml v3 (cron: 0 18 * * *  UTC = KST 매일 03:00)
├── permissions: { contents: write }  ← push 권한 (신규)
│
├── Job: compute-scores  (기존 그대로)
│   └─ scripts/compute-scores.mjs → Supabase apartments.cats_cache UPDATE
│
└── Job: refresh-data  (신규)  needs: compute-scores
    ├── actions/checkout@v4 (persist-credentials: true)
    ├── actions/setup-node@v4 (node 24, cache: npm)
    ├── npm ci --legacy-peer-deps
    ├── env: SUPABASE_URL + SUPABASE_ANON_KEY (서비스 키 아님)
    ├── node scripts/collect-data.mjs --from-supabase-only  ← 신규 모드
    │   └ apartments_flat VIEW 1회 SELECT → public/data/*.json
    ├── 회귀 가드: count 절대값 체크 (≥ 1000 이고 전일 대비 -200 이상 감소 아니면 ok)
    ├── git config user.{name,email} = github-actions[bot]
    ├── git add public/data/
    ├── git diff --cached --stat — log 만 출력 (skip 로직 없음)
    ├── git commit -m "data: daily refresh YYYY-MM-DD (auto)"
    └── git push origin main
        ↓
   Vercel git auto-deploy 가 자동 트리거 (별도 hook 호출 0회)

trigger-deploy job  →  삭제
VERCEL_DEPLOY_HOOK secret  →  폐기 후보 (1주 운영 후 별도 PR)
```

### Components

**1. `scripts/collect-data.mjs` (수정 — 핵심)**

`--from-supabase-only` 모드 신규 추가. `apartments_flat` VIEW 가 이미 모든 필드 (camelCase 매핑 + psr/pir/dataReliability 포함) 박혀있으므로 코드 ~30~50줄 추가만 필요:

```js
const SUPABASE_ONLY = process.argv.includes("--from-supabase-only");

if (SUPABASE_ONLY) {
  log("=== Supabase-Only 모드 (외부 API 호출 0회) ===");
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logError("supabase-only", "SUPABASE_URL / SUPABASE_ANON_KEY 필수");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // apartments_flat VIEW = 모든 필드 박힘 (camelCase + psr/pir/dataReliability + naver)
  const apartments = await selectAll(
    (s) => s.from("apartments_flat").select("*"),
    supabase,
  );

  // 4 JSON 출력 (기존 main 흐름의 마지막 단계 재사용)
  const fetchedAt = new Date().toISOString();
  meta.fetchedAt = fetchedAt;
  meta.count = apartments.length;
  meta.phases.supabaseOnly = { ok: true, count: apartments.length };

  writeOutputs(apartments, fetchedAt);  // 기존 JSON 출력 로직 추출 helper
  process.exit(0);
}

// 기존 Phase 1~9 흐름 유지 (사용자 로컬 수동 호출 시)
```

핵심 자산:

- `apartments_flat` VIEW 의 camelCase 매핑이 이미 SQL `AS "camelCase"` 로 박힘 → JS 변환 코드 0줄
- `psr`, `pir`, `dataReliability` 모두 VIEW 가 SQL 로 계산해 박힘 → Phase 8 코드 재호출 0줄
- 네이버 필드 (`naverNearbyMedian` 등) 도 VIEW 가 박힘 → Phase 9 재호출 0줄
- `selectAll` (scripts/collectors/_shared.mjs) 가 PostgREST 1000행 페이지네이션 답습 → 그대로 활용

새 helper `writeOutputs(apartments, fetchedAt)` — 기존 main 함수의 L1067~1093 JSON write 부분을 helper 로 추출 (DRY).

**2. `.github/workflows/daily-deploy.yml` (수정)**

- `permissions: { contents: write }` 추가
- `trigger-deploy` job 삭제
- `refresh-data` job 신규 추가:
  - env: `SUPABASE_URL` + `SUPABASE_ANON_KEY`
  - `node scripts/collect-data.mjs --from-supabase-only`
  - 회귀 가드 + git push
  - timeout-minutes: 10 (Supabase 1회 query 충분)

**3. `.github/workflows/ci.yml` (수정)**

- `paths-ignore` 추가:

  ```yaml
  on:
    push:
      branches: [main]
      paths-ignore:
        - 'public/data/**'
        - 'docs/**'
        - '.claude/**'
        - '*.md'
  ```

- 효과 = 데이터-only push 시 CI ~9분 스킵. 비용 절감.

**4. `scripts/notify-telegram.mjs` (수정)**

- `CONCLUSION_LABEL` 상수 신규:

  ```js
  const CONCLUSION_LABEL = {
    failure: "실패",
    cancelled: "취소",
    timed_out: "시간 초과",
  };
  ```

- `formatIssue` 의 title 결정 로직 변경:

  ```js
  const title = issue.kind === "fail"
    ? `수집기 ${CONCLUSION_LABEL[issue.conclusion] ?? "이상"}`
    : { empty: "데이터 0건 수집", stale: "수집기 미발화", nulls: "NULL 급증" }[issue.kind];
  ```

- `ACTION_GUIDE.fail` 을 conclusion 별 객체로 변경:

  ```js
  fail: {
    failure: "[조치] run 로그에서 실패한 단계 확인 후 다시 실행(Re-run)하세요.",
    cancelled: "[조치] concurrency 큐 또는 GitHub Actions billing 한도를 확인하세요. 자동 재시도가 도착하는 경우도 많으니 1시간 후 재평가하세요.",
    timed_out: "[조치] run 로그의 단지 당 처리 시간을 확인 후 timeout-minutes 조정 또는 데이터 분할을 검토하세요.",
  },
  ```

- `formatIssue` 에서 `ACTION_GUIDE[issue.kind][issue.conclusion]` 접근 (fail 만), 다른 kind 는 기존처럼 단일 문자열.

**5. `scripts/monitor-collectors.mjs` (수정)**

- L183 이슈 push 시 `conclusion` 필드 추가:

  ```js
  issues.push({
    kind: "fail",
    collector: run.name ?? "(이름 없음)",
    conclusion: run.conclusion,  // ← 신규
    detail: `워크플로 실행이 ${CONCLUSION_LABEL[run.conclusion] ?? run.conclusion} 상태로 끝났습니다.`,
    url: run.html_url,
    at: run.created_at,
  });
  ```

- L566 test sample 도 `conclusion: "failure"` 박제 + cancelled/timed_out sample 2개 추가 (총 3 conclusion sample)

**6. `scripts/notify-telegram.test.mjs` (보강 — 기존 180줄 박힘)**

- 기존 `formatIssue` 테스트 4건 (수집기 실패/empty/stale/nulls) 갱신 — issue 객체에 `conclusion` 필드 강제
- 3 conclusion 별 메시지 sanity 추가:

  ```js
  it("conclusion=failure → '🔴 수집기 실패' + Re-run 가이드", () => {...});
  it("conclusion=cancelled → '🔴 수집기 취소' + concurrency 가이드", () => {...});
  it("conclusion=timed_out → '🔴 수집기 시간 초과' + timeout 가이드", () => {...});
  ```

- `monitor-collectors.test.mjs` 기존 회귀 가드 갱신 (issue 객체에 conclusion 필드 강제)

**7. `scripts/collect-data.test.mjs` (보강 — 기존 494줄 박힘, resolveBuilder/isValidGu 등 unit test)**

- `--from-supabase-only` 모드 sanity 추가:
  - Supabase mock 으로 apartments_flat 100 rows 반환
  - Phase 1~7 호출 0회 검증 (외부 fetch 모킹 없음 = 실제 호출 안 됨 확정)
  - meta.fetchedAt 갱신, apartments.json + apartments-list.json + apartments-prices.json + meta.json 4개 출력 검증
  - VIEW 가 박힌 psr/pir/dataReliability 가 출력 JSON 에 그대로 포함되는지 검증 (계산 코드 0)

### Data Flow

1. `0 18 * * *` UTC cron 발화 (KST 03:00)
2. `compute-scores` job → Supabase `apartments.cats_cache` UPDATE (~41s 실측)
3. `refresh-data` job → `collect-data.mjs --from-supabase-only`:
   - Supabase `apartments_flat` VIEW 페이지네이션 SELECT (~5s, 단지 1565개)
   - 4개 JSON 출력 (~1s, VIEW 가 이미 camelCase + psr/pir/dataReliability 박힘)
4. 회귀 가드 → count ≥ 1000 + 전일 대비 -200 이내 → ok
5. `git push origin main` (~5s)
6. Vercel git integration → main HEAD 감지 → production deploy 자동 발화 (~20s build)
7. `mibunyang-peach.vercel.app` 에서 fresh `dataUpdatedAt` 표시
8. **총 시간 추정**: compute-scores 41s + refresh-data ~10s + Vercel build 20s = **~1분 10초**

### Error Handling (Hard fail 정책)

| 단계 | 실패 시 동작 |
|---|---|
| compute-scores 실패 | refresh-data job 안 돔 (needs 의존성) → 워크플로 빨강 → 텔레그램 알림 |
| Supabase 일시 불능 (apartments_flat SELECT 실패) | refresh-data job 빨강 → 워크플로 빨강 → 텔레그램 알림 → 그날 prod 데이터 어제 상태 유지 |
| 회귀 가드 위반 (count < 1000 또는 전일 대비 -200 이상 감소) | refresh-data job fail → push 0 → 텔레그램 알림 → 사용자 점검 |
| git push 실패 (예: token 만료) | refresh-data job 빨강 → 텔레그램 알림 |
| Vercel build 실패 | Vercel 자체 알림 (이미 운영 중) |

monitor-collectors.yml 의 `workflow_run` trigger 가 "Daily Data Refresh" 도 감시하므로 모든 실패 케이스에 텔레그램 알림 자동 발화.

### Testing

#### 단위 테스트 (회귀 가드)

- `scripts/notify-telegram.test.mjs` 3 conclusion 별 formatIssue 메시지 sanity (신규)
- `scripts/monitor-collectors.test.mjs` issue 객체 conclusion 필드 강제
- `scripts/collect-data.test.mjs` `--from-supabase-only` 모드 외부 API 0 호출 검증 (신규)

#### 통합 테스트 (수동)

1. **로컬 dry-run**: `SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/collect-data.mjs --from-supabase-only` 실행 후 `public/data/*.json` 출력 + 외부 API 호출 0회 검증 (네트워크 로그 확인)
2. **회귀 가드 시뮬**: apartments_flat mock 으로 count 100 박제 → 회귀 가드 fail 확인
3. **workflow_dispatch 1회**: `gh workflow run daily-deploy.yml --ref main` 1회 발화 후 다음 모두 확인:
   - refresh-data job success (1~2분 내)
   - git log 에 새 commit "data: daily refresh YYYY-MM-DD (auto)" 박힘
   - Vercel deploy 1회만 발화 (이중 발화 X)
   - `/data/meta.json` fetchedAt 갱신
   - CI 워크플로 발화 0건 (paths-ignore 동작)
4. **텔레그램 알림 sanity**: monitor-collectors `--mode=test` 3 conclusion 별 메시지 화면 확인

#### End-to-end verification

- 다음 KST 03:00 cron 1회 발화 후 24시간 stale 0 확인
- 1주일 운영 후 stale 사고 0건 확인

## Rollout Plan

### Phase 1 — 텔레그램 알림 개선 (저위험, 독립)

1. `scripts/notify-telegram.mjs` 수정 + `notify-telegram.test.mjs` 신규
2. `scripts/monitor-collectors.mjs` L183 + L566 sample 정정 (3 conclusion sample 박제)
3. `monitor-collectors.test.mjs` 갱신
4. CI typecheck + test 통과 후 1커밋 push
5. monitor-collectors `--mode=test` workflow_dispatch 1회 → 텔레그램 알림 sanity 검증

### Phase 2 — ci.yml paths-ignore (저위험, 독립)

1. `.github/workflows/ci.yml` 본문에 `paths-ignore` 추가
2. test commit (예: README 1줄 수정) push → CI 미발화 확인

### Phase 3 — collect-data --from-supabase-only 모드 추가 (핵심)

1. `scripts/_shared.mjs` 에 `selectAllFromView` 헬퍼 신규 (또는 기존 `selectAll` 재사용)
2. `scripts/collect-data.mjs` 의 main 함수 시작부에 `--from-supabase-only` 분기 추가
3. apartments_flat → apartments 객체 변환 매핑 (snake_case → camelCase 필요 시)
4. `scripts/collect-data.test.mjs` 신규 (외부 API 0 호출 검증)
5. 로컬 통합 테스트 #1 통과 후 CI 통과 → 커밋 push

### Phase 4 — daily-deploy.yml refresh-data job 추가

1. `.github/workflows/daily-deploy.yml` 수정:
   - `permissions: { contents: write }` 추가
   - `trigger-deploy` job 삭제
   - `refresh-data` job 신규 추가 (env: SUPABASE_ANON_KEY, --from-supabase-only)
2. workflow_dispatch 1회 발화 → 통합 테스트 #3 통과 확인
3. `VERCEL_DEPLOY_HOOK` secret 폐기 (1주 운영 후, 별도 PR — rollback 여유)

### Phase 5 — End-to-end 운영 검증 (1주)

- 매일 KST 03:00 cron 발화 monitor (텔레그램 알림 자동)
- 1주일 후 stale 사고 0건 + 사용자 UI "오늘 업데이트" 확인 → spec 종결

## Risks + Mitigations

| 위험 | 영향 | Mitigation |
|---|---|---|
| `apartments_flat` VIEW 의 컬럼 매핑이 collect-data 출력 schema 와 불일치 (snake_case vs camelCase) | refresh-data job 빨강 또는 UI break | Phase 3 구현 시 매핑 함수 박제 + collect-data.test.mjs 로 출력 schema 회귀 가드 |
| Supabase REST API 일시 불능 (장애) | 그날 prod stale (어제 데이터 유지) | Hard fail 정책 → 텔레그램 알림 → 사용자 대응 또는 다음 날 cron 자동 복구 |
| 회귀 가드 false positive (정상 변동인데 -200 이상 감소) | 사용자 점검 노이즈 | 임계값 -200 은 보수적 (1565 × 12.8%). 1개월 운영 후 false positive 발생 시 조정 |
| Vercel 이 git push 마다 deploy 하지만 build 실패 | prod 미반영 | Vercel 자체 알림 (이미 운영) + 텔레그램 알림 별도 (Daily Data Refresh 자체는 success) |
| `apartments_flat` VIEW 스키마 변경 시 collect-data 출력 손상 | UI break | UI 가 사용하는 필드 (`dataUpdatedAt` 등) 만 schema 안정성 보장. supabase/CLAUDE.md "공용 테이블 ALTER 전 grep" 룰 답습 |
| 사용자 로컬 수동 ETL (full Phase 1~9) 흐름이 깨질 위험 | 사용자 작업 마찰 | `--from-supabase-only` 는 신규 모드 분기. 기존 main 함수는 그대로 유지. 로컬 사용자 명령 변경 0건 |

## Out of Scope (별도 spec)

- **GitHub Actions 비용 절감** — Fill Missing Data + Naver Post-Processing timeout 최적화 등. 본 P0 와 독립.
- **billing 차단 외부 감지** — monitor-collectors 자체가 billing 차단 시 알림 0건 위험. 별도 외부 모니터 (예: UptimeRobot `mibunyang-peach.vercel.app` 체크) 검토. 본 spec 의 범위 외.
- **사용자 로컬 full ETL 자동화** — 본 spec 은 매일 1회 Supabase-only cron 만. 외부 API 6개 호출하는 full ETL 은 사용자 로컬 수동 (기존 흐름 유지).
- **collect-data 의 Phase 1~7 자체 ETL 흐름 개선** — 35개 collector 가 이미 분산 호출 하는데 collect-data 가 중복 호출하는 자리. 별도 리팩토링.

## 답습 자산

- 세션 305 SESSION_LOG (P0 5일 stale + billing 사고 + molit-units root fix 종결)
- `scripts/CLAUDE.md` § Exit Code 정책 (Hard fail 5개 수동 카운터 패턴 답습)
- `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` (4-way 답습 의무)
- 글로벌 메모 `feedback_npm_build_runs_etl.md` (Vercel 빌드 시 collect-data 스킵 박제)
- 글로벌 메모 `feedback_view_alias_source_of_truth.md` (apartments_flat VIEW 별칭 진실의 원천 룰)
- Vercel 공식 문서 [/docs/deploy-hooks](https://vercel.com/docs/deploy-hooks) + [/docs/git](https://vercel.com/docs/git) (git auto-deploy + Deploy Hook dedup 검증)
- `supabase/migrations/20260315000000_add_price_arrays.sql` (`apartments_flat` VIEW 4 시세 배열 + naver + infra 모두 join 박힘)
- `scripts/collectors/_shared.mjs` `selectAll` 헬퍼 (PostgREST 1000 행 페이지네이션 답습 자산)
