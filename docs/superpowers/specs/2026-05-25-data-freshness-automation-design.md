# Data Freshness Automation + 텔레그램 알림 정확성 개선

> 세션 305 P0 사고 (운영 사이트 5일 stale) 의 재발 차단 설계 + 알림 시스템 부수 결함 3건 동시 해소.

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
3. **조치 가이드 일률 "Re-run 하세요"** = cancelled 는 Re-run 정답 아님 (concurrency 큐 / billing 한도 확인이 정답)

### 목표 산출물

1. 매일 1회 자동 데이터 push 흐름 (Hard fail 정책)
2. 텔레그램 알림 3 conclusion 한글 라벨 + 분기된 조치 가이드
3. CI 가 데이터-only push 시 doesn't fire (paths-ignore)
4. 회귀 가드 — 데이터 count 임계값 + 알림 형식 sanity test

## 진앙 검증 (실측 근거)

세션 305 검증 결과:

| 가설 | 실측 결과 |
|---|---|
| daily-deploy.yml 안에서 push 해도 ci.yml 재발화 없다 | ❌ `ci.yml` L2-6 `push: branches: [main]` → 매 데이터 push 마다 CI 9분 발화 위험 |
| daily-deploy 의 GITHUB_TOKEN 이 main push 가능 | ❌ `permissions` 블록 없음 = default `contents: read` → push 거부 |
| Deploy Hook 호출 + git push 동시 시 dedup | ❌ Vercel 공식 문서 ([docs/deploy-hooks](https://vercel.com/docs/deploy-hooks)) "Other Optimizations" 절은 **같은 Deploy Hook** 중복 호출만 dedup 명시. git push 와의 dedup 없음. 실측: 14h 사이 production deploy 12회 = 이중 발화 증거 |
| concurrency `daily-scoring-deploy` 그룹 단독 | ✅ daily-deploy.yml 단독 사용. 충돌 0건 |

## 설계

### Architecture

```text
daily-deploy.yml v2 (cron: 0 18 * * *  UTC = KST 매일 03:00)
├── permissions: { contents: write }  ← push 권한 (신규)
│
├── Job: compute-scores  (기존 그대로)
│   └─ scripts/compute-scores.mjs → Supabase apartments.cats_cache UPDATE
│
└── Job: refresh-data  (신규)  needs: compute-scores
    ├── actions/checkout@v4 (persist-credentials: true)
    ├── actions/setup-node@v4 (node 24)
    ├── npm ci --legacy-peer-deps
    ├── node scripts/collect-data.mjs  → public/data/*.json 출력
    ├── git diff --quiet public/data/  → 변경 0 이면 exit 0 (skip)
    ├── 회귀 가드: count 임계값 체크 (전일 대비 -5% 미만이면 fail)
    ├── git config user.{name,email} = github-actions[bot]
    ├── git add public/data/
    ├── git commit -m "data: daily refresh YYYY-MM-DD (auto)"
    └── git push origin main
        ↓
   Vercel git auto-deploy 가 자동 트리거 (별도 hook 호출 0회)

trigger-deploy job  →  삭제
VERCEL_DEPLOY_HOOK secret  →  폐기 후보
```

### Components

**1. `.github/workflows/daily-deploy.yml` (수정)**

- `permissions: { contents: write }` 추가
- `trigger-deploy` job 삭제
- `refresh-data` job 신규 추가 (위 architecture 참조)
- 시간 추정 = 기존 1분 → 3~5분 (collect-data 2~4분 + push 5s)

**2. `.github/workflows/ci.yml` (수정)**

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
- 효과 = 데이터-only push 시 CI 9분 스킵. 비용 절감 + Vercel deploy 와의 race 회피.

**3. `scripts/notify-telegram.mjs` (수정)**

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

**4. `scripts/monitor-collectors.mjs` (수정)**

- L183 이슈 push 시 `conclusion` 필드 추가:
  ```js
  issues.push({
    kind: "fail",
    collector: run.name,
    conclusion: run.conclusion,  // ← 신규
    detail: `워크플로 실행이 ${CONCLUSION_LABEL[run.conclusion] ?? run.conclusion} 상태로 끝났습니다.`,
    url: run.html_url,
    at: run.created_at,
  });
  ```
- L566 test sample 도 `conclusion: "failure"` 박제 (3 conclusion 별 sample 3개로 확장)

**5. `scripts/notify-telegram.test.mjs` (신규 또는 보강)**

- `formatIssue` 3 conclusion 별 메시지 sanity:
  ```js
  it("conclusion=failure → '🔴 수집기 실패' + Re-run 가이드", () => {...});
  it("conclusion=cancelled → '🔴 수집기 취소' + concurrency 가이드", () => {...});
  it("conclusion=timed_out → '🔴 수집기 시간 초과' + timeout 가이드", () => {...});
  ```
- `monitor-collectors.test.mjs` 기존 회귀 가드 갱신 (issue 객체에 conclusion 필드 강제)

### Data Flow

1. `0 18 * * *` UTC cron 발화 (KST 03:00)
2. `compute-scores` job → Supabase `apartments.cats_cache` UPDATE (~55s)
3. `refresh-data` job → `collect-data.mjs` Supabase 읽기 → `public/data/*.json` 출력 (~2~4분)
4. `git diff --quiet public/data/` → 변경 0 이면 exit 0 (drift 없으면 push 0)
5. count 회귀 가드 → 임계값 위반 시 fail (텔레그램 알림 → 사용자 점검)
6. `git push origin main`
7. Vercel git integration → main HEAD 감지 → production deploy 자동 발화 (~20s build)
8. `mibunyang-peach.vercel.app` 에서 fresh `dataUpdatedAt` 표시

### Error Handling (Hard fail 정책)

| 단계 | 실패 시 동작 |
|---|---|
| compute-scores 실패 | refresh-data job 안 돔 (needs 의존성) → 워크플로 빨강 → 텔레그램 알림 |
| collect-data 실패 (Supabase 일시 불능 등) | refresh-data job 빨강 → 워크플로 빨강 → 텔레그램 알림 → 그날 prod 데이터 어제 상태 유지 |
| count 회귀 가드 위반 (예: 전일 대비 -5% 이상 감소) | refresh-data job fail → push 0 → 텔레그램 알림 → 사용자 점검 |
| git push 실패 (예: token 만료) | refresh-data job 빨강 → 텔레그램 알림 |
| Vercel build 실패 | Vercel 자체 알림 (이미 운영 중) |

monitor-collectors.yml 의 `workflow_run` trigger 가 "Daily Data Refresh" 도 감시하므로 모든 실패 케이스에 텔레그램 알림 자동 발화.

### Testing

#### 단위 테스트 (회귀 가드)

- `scripts/notify-telegram.test.mjs` 3 conclusion 별 formatIssue 메시지 sanity (신규)
- `scripts/monitor-collectors.test.mjs` issue 객체 conclusion 필드 강제

#### 통합 테스트 (수동)

1. **로컬 dry-run**: `node scripts/collect-data.mjs` 실행 후 `public/data/*.json` 출력 검증
2. **회귀 가드 시뮬**: 임의로 count 0 박제 후 워크플로 발화 → fail 확인
3. **workflow_dispatch 1회**: `gh workflow run daily-deploy.yml --ref main` 1회 발화 후 다음 모두 확인:
   - refresh-data job success
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
2. `scripts/monitor-collectors.mjs` L183 + L566 sample 정정
3. `monitor-collectors.test.mjs` 갱신
4. CI typecheck + test 통과 후 1커밋 push
5. monitor-collectors `--mode=test` workflow_dispatch 1회 → 텔레그램 알림 sanity 검증

### Phase 2 — ci.yml paths-ignore (저위험, 독립)

1. `.github/workflows/ci.yml` 본문에 `paths-ignore` 추가
2. test commit (예: README 1줄 수정) push → CI 미발화 확인

### Phase 3 — daily-deploy.yml refresh-data job 추가 (핵심)

1. `.github/workflows/daily-deploy.yml` 수정:
   - `permissions: { contents: write }` 추가
   - `trigger-deploy` job 삭제
   - `refresh-data` job 신규 추가
2. workflow_dispatch 1회 발화 → 통합 테스트 #3 통과 확인
3. `VERCEL_DEPLOY_HOOK` secret 폐기 (1주 운영 후) — 세션 305 grep 결과 사용처는 daily-deploy.yml 1군데만이라 본 PR 에서 동시 제거 가능. 다만 rollback 여유 두기 위해 1주 운영 검증 후 별도 PR 권장.

### Phase 4 — End-to-end 운영 검증 (1주)

- 매일 KST 03:00 cron 발화 monitor (텔레그램 알림 자동)
- 1주일 후 stale 사고 0건 + 사용자 UI "오늘 업데이트" 확인 → spec 종결

## Risks + Mitigations

| 위험 | 영향 | Mitigation |
|---|---|---|
| collect-data 가 빌드 환경에서 `npm ci --legacy-peer-deps` 누락 | refresh-data job 빨강 | Phase 3 PR 에 npm ci step 의무 포함 + CI 통과 후만 머지 |
| GITHUB_TOKEN push 가 branch protection 에 막힘 | push 거부 | branch protection 설정 확인 후 필요 시 GITHUB_TOKEN 우회 또는 Personal Access Token 사용 |
| count 회귀 가드 false positive (정상 변동인데 -5% 감소) | 사용자 점검 노이즈 | 임계값 -5% 는 보수적. 1개월 운영 후 false positive 발생 시 임계값 -10% 또는 절대값 (예: -50개 미만) 으로 조정 |
| Vercel 이 git push 마다 deploy 하지만 build 실패 시 prod 미반영 | prod stale 유지 | Vercel 자체 알림 (이미 운영) + 텔레그램 알림 별도 (Daily Data Refresh 자체는 success) |
| 다음 ETL 변경 시 collect-data.mjs 출력 schema 변동 | UI break | UI 가 사용하는 필드 (`dataUpdatedAt` 등) 만 schema 안정성 보장 필요. 별도 PR 시 grep 의무 |

## Out of Scope (별도 spec)

- **GitHub Actions 비용 절감** — Fill Missing Data + Naver Post-Processing timeout 최적화 등. 본 P0 와 독립.
- **billing 차단 외부 감지** — monitor-collectors 자체가 billing 차단 시 알림 0건 위험. 별도 외부 모니터 (예: UptimeRobot mibunyang-peach.vercel.app 체크) 검토. 본 spec 의 범위 외.
- **수동 운영 시 git push 자동화** — 본 spec 은 매일 1회 cron 자동화만. 수동 ETL 후 git push 는 사용자 의지대로.

## 답습 자산

- 세션 305 SESSION_LOG (P0 5일 stale + billing 사고 + molit-units root fix 종결)
- `scripts/CLAUDE.md` § Exit Code 정책 (Hard fail 5개 수동 카운터 패턴 답습)
- `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` (4-way 답습 의무 — 본 spec 의 회귀 가드 임계값 결정에도 답습)
- 글로벌 메모 `feedback_npm_build_runs_etl.md` (Vercel 빌드 시 collect-data 스킵 박제)
- Vercel 공식 문서 [/docs/deploy-hooks](https://vercel.com/docs/deploy-hooks) + [/docs/git](https://vercel.com/docs/git) (git auto-deploy + Deploy Hook dedup 명시 검증)
