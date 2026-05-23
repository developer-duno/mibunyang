# Jeju Childcare Collector Design (data.go.kr 15101201)

> 작성: 2026-05-24 (세션 296). brainstorming skill 답습 산출.
> 거시 목적: 제주시·서귀포시 단지 사용자의 어린이집 정보 공백 자리 (regions.childcare NULL) 해결.

## Context

### 문제 자리

- 현재 `regions.childcare` JSONB 채움 자리 = 254/256 시군구 (99.2%).
- 미수집 2건 = 제주시 (`50110`) + 서귀포시 (`50130`).
- 원인: 기존 `childcare-info.mjs` 가 호출하는 cpmsapi021 API (data.go.kr 15101155, 한국사회보장정보원_전국 어린이집 정보 조회)가 제주 어린이집 자리를 **API 자체가 미보유** (`<errcode>INFO-200</errcode>` 응답, 세션 276 운영키 raw 검증 박제).
- 영향: 제주시·서귀포시 단지 거주 사용자 = 어린이집 정보 자리 0건. UI 표시 자리 공백 + scoring 자리 childcare 점수 0/NULL.

### 해결책 자리

별도 API `한국사회보장정보원_제주도 어린이집 정보조회` (data.go.kr 15101201) collector 신설.

- 답습 자산: `scripts/collectors/childcare-info.mjs` (260줄, cpmsapi021 → regions.childcare JSONB 4 키 적재 패턴).
- 격리 자리: 기존 collector 영향 0 (별 파일 + 별 워크플로 + 별 환경변수).
- 호환 자리: 응답 구조 (시군구 단위 facilities[] aggregate) 동일 박제 → UI + scoring 답습 자산 100% 재활용.

### 의도된 결과

- `regions.childcare` 256/256 자리 도달 (NULL 0건).
- 제주 단지 UI 자리 어린이집 정보 동등 표시.
- scoring 자리 제주 단지 childcare 점수 정당 계산.

## Architecture

```
GitHub Actions (월간 cron)
  → collect-childcare-info-jeju.yml
    → node scripts/collectors/childcare-info-jeju.mjs
      → 15101201 API (data.go.kr) ← JEJU_CHILDCARE_KEY
        → 응답 파싱 (XML 또는 JSON)
          → regions.childcare JSONB UPDATE (제주시 50110 / 서귀포시 50130)
            → collector_runs 기록

data-fill.mjs orchestrator
  → COLLECTORS 배열 등재 (envKeys = ["JEJU_CHILDCARE_KEY"])
  → daily dry-run + 월간 fill 자리

monitor-collectors.mjs
  → workflows 배열에 collect-childcare-info-jeju 추가 (월간 cron 데드존 감지)
```

## Components

| 컴포넌트 | 책임 | 의존 |
|---|---|---|
| `scripts/collectors/childcare-info-jeju.mjs` | 15101201 API 호출 + 응답 파싱 + regions.childcare UPDATE | `_shared.mjs` (loadEnv / getSupabase / fetchWithRetry / createReporter / recordCollectorRun / recordApiQuota / GU_LAWD_MAP / sleep) |
| `parseJejuChildcareResponse(body)` | 응답 → `ChildcareItem[]` 변환 (XML or JSON, 명세 답습 후 확정) | 없음 (순수 함수) |
| `aggregateByGu(items, gu)` | `ChildcareItem[]` → `ChildcareAggregate` (count / total_capacity / facilities / fetched_at) | 없음 |
| `upsertRegions(sb, rows)` | regions.childcare UPDATE (없으면 INSERT) | Supabase |
| `listJejuSgg()` | `GU_LAWD_MAP['제주']` → `[{region, gu, arcode}]` 2건 | `_shared.mjs` |
| `scripts/collectors/childcare-info-jeju.test.mjs` | 단위 테스트 (parse + aggregate + upsert mock) | vitest |
| `.github/workflows/collect-childcare-info-jeju.yml` | 월간 schedule + Validate secrets + 실행 + collector_runs | GitHub Secrets |

### 단일 책임 검증

- 각 함수 자리 = 한 가지 일만. parse 는 변환만, aggregate 는 묶음만, upsert 는 DB 만.
- 내부 변경 자리 시 소비자 영향 0 (parseJejuChildcareResponse 가 XML→JSON 바뀌어도 시그니처 동일).

## Data Flow

1. `loadEnv()` → `JEJU_CHILDCARE_KEY` 검증 (부재 시 `logError("init", ...)` + `process.exit(1)`).
2. `JEJU_SGG = listJejuSgg()` → `[{region: '제주', gu: '제주시', arcode: '50110'}, {region: '제주', gu: '서귀포시', arcode: '50130'}]`.
3. `for (const sgg of JEJU_SGG)`:
   a. URL 구성 (endpoint + key + arcode 파라미터, 명세 답습 후 확정).
   b. `fetchWithRetry(url)` (retry 3회 답습 자산).
   c. `parseJejuChildcareResponse(body)` → `ChildcareItem[]`.
   d. `aggregateByGu(items, sgg.gu)` → `ChildcareAggregate`.
   e. `await sleep(500)` (rate limit 답습).
4. `upsertRegions(sb, rows)` → 2건 자리 UPDATE.
5. `await recordApiQuota('childcare-info-jeju', 'JEJU_CHILDCARE_KEY', apiCalls)`.
6. `await recordCollectorRun('childcare-info-jeju', result)`.

### 데이터 스키마 (답습 자산 호환)

```typescript
type ChildcareItem = {
  stcode: string;   // 어린이집 코드 (11자)
  crname: string;   // 어린이집명
  crtel: string;    // 전화
  crfax: string;    // 팩스
  craddr: string;   // 주소
  crhome: string;   // 홈페이지 URL
  crcapat: number;  // 정원
};

type ChildcareAggregate = {
  count: number;              // 어린이집 개수
  total_capacity: number;     // 정원 합계
  facilities: ChildcareItem[]; // raw 리스트
  fetched_at: string;         // YYYY-MM-DD
};
```

> 7 필드 자리 = cpmsapi021 답습 추정 자리. 응답 필드명·구조 자리 확정은 명세 답습 자리 (plan v1 직전 의무).

## Error Handling

| 자리 | 처리 |
|---|---|
| `JEJU_CHILDCARE_KEY` 부재 | `logError("init", "JEJU_CHILDCARE_KEY 환경변수 필요")` + `process.exit(1)`. 월간 cron 데드존 차단 (`Validate secrets` step 답습) |
| 검색결과 없음 (INFO-200 동등) | skip + `log("info", ...)`. 단, 제주 어린이집 자리 0건은 비정상 자리 → `logError` + `reporter.fail++` 자리 (cpmsapi021 답습 자리와 의미 분리) |
| 인증키 무효 (INFO-100) | throw + retry 0회. 즉시 exit (월간 cron 데드존) |
| Supabase UPDATE 실패 | retry 2회 (`childcare-info.mjs` L218 답습) → 1% 임계값 (`shouldExitFail`) |
| HTTP 4xx/5xx | `fetchWithRetry` retry 3회 (답습 자산) |
| 응답 파싱 빨강 (XML malformed / JSON parse error) | catch + `logError` + `reporter.fail++` |
| Supabase row 없음 | INSERT fallback (`childcare-info.mjs` L235 답습) |

### 1% 임계값 답습

`shouldExitFail(ok, fail)` = fail/ok > 0.01 시 exit 1. 제주 2 시군구 자리 = fail 1건이면 50% → exit 1 자리. 일시적 timeout 자리 = retry 3회 후 fail 자리.

## Testing

### 단위 테스트 (`childcare-info-jeju.test.mjs`)

| 테스트 | 자리 |
|---|---|
| `parseJejuChildcareResponse(xml/json)` 정상 자리 | 7 필드 추출 + items.length > 0 |
| `parseJejuChildcareResponse` 빈 응답 자리 | `[]` 반환 |
| `parseJejuChildcareResponse` 필수 필드 누락 자리 | 해당 item skip + 나머지 추출 |
| `aggregateByGu(items, gu)` 자리 | count/total_capacity 정확 + facilities 길이 동일 + fetched_at 오늘 |
| `shouldExitFail(2, 0)` | false (정상) |
| `shouldExitFail(1, 1)` | true (50% > 1%) |
| `listJejuSgg()` | 2건 (제주시 50110 / 서귀포시 50130) |
| Mock fetchWithRetry — INFO-200 자리 | log warning + skip |
| Mock fetchWithRetry — INFO-100 자리 | throw |
| Mock Supabase upsert 자리 | UPDATE 성공 / UPDATE 빨강 retry / INSERT fallback |

### 통합 검증 (수동 / dry-run)

- `node scripts/collectors/childcare-info-jeju.mjs --dry-run` → sample 출력 + Supabase write 0.
- 운영 실행 후 검증: `SELECT region, gu, childcare->>'count', childcare->>'total_capacity' FROM regions WHERE region='제주';`
- 기대: 제주시 + 서귀포시 2행, count > 0, total_capacity > 0.

## Workflow (`collect-childcare-info-jeju.yml`)

```yaml
name: Collect Jeju Childcare Info
on:
  schedule:
    - cron: '0 18 5 * *'  # 매월 6일 03:00 KST (cpmsapi021 자리 = 매월 1일, 4일 간격으로 큐 경합 차단)
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: collect-childcare-info-jeju
  cancel-in-progress: false

jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 15  # 2 시군구 × ~5초 = ~10초, 여유 자리 15분
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci

      - name: Validate secrets
        run: |
          if [ -z "$JEJU_CHILDCARE_KEY" ]; then echo "::error::JEJU_CHILDCARE_KEY 부재"; exit 1; fi
          if [ -z "$SUPABASE_URL" ]; then echo "::error::SUPABASE_URL 부재"; exit 1; fi
          if [ -z "$SUPABASE_SERVICE_KEY" ]; then echo "::error::SUPABASE_SERVICE_KEY 부재"; exit 1; fi
        env:
          JEJU_CHILDCARE_KEY: ${{ secrets.JEJU_CHILDCARE_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

      - name: Run
        env:
          JEJU_CHILDCARE_KEY: ${{ secrets.JEJU_CHILDCARE_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: node scripts/collectors/childcare-info-jeju.mjs
```

## Monitor + Audit 답습

- `scripts/collectors/monitor-collectors.mjs` workflows 배열에 `collect-childcare-info-jeju` 추가 (룰 §"운영 모니터링 (월간 schedule)" 답습 — 월간 cron 데드존 자동 검출).
- `scripts/audit-env-keys.mjs` 자동 검출 자리 (룰 §"Secret 이름 3-way 동기화 감사" 답습) — `JEJU_CHILDCARE_KEY` 가 code/workflow/orchestrator 3 군데 일치.
- `scripts/collectors/data-fill.mjs` COLLECTORS 배열 등재 (`envKeys: ["JEJU_CHILDCARE_KEY"]`).
- `.claude/API_REGISTRY.md` 자리 추가 (§3 info.childcare.go.kr 자리 또는 §1 data.go.kr 자리 — 명세 답습 후 확정).

## 명세 답습 의무 자리 (plan v1 직전)

룰 §"수집기 외부 API = 공식 문서 분석·검증 의무" 답습 의무. plan v1 작성 자리 전 다음 자리 답습 의무:

| 자리 | 확정 박제값 |
|---|---|
| 1. endpoint URL | `https://api.data.go.kr/...` 또는 `http://api.childcare.go.kr/...` (cpmsapi 시리즈 vs data.go.kr 1741 시리즈 자리) |
| 2. 요청 파라미터 | `key` + `arcode` (50110/50130) 또는 `sido` (제주 50) 자리. 페이징 (`numOfRows` + `pageNo`) 지원 자리 |
| 3. 응답 형식 | XML 또는 JSON. cpmsapi021 = XML 자리, 1741 시리즈 = XML+JSON 양형 자리 |
| 4. 응답 필드 | cpmsapi021 7 필드 (stcode/crname/crtel/crfax/craddr/crhome/crcapat) 동일 자리 가능성 ✅ (WebSearch 결과 추정) |
| 5. 일일 요청 한도 | data.go.kr 보통 10,000건 자리 / info.childcare.go.kr 자리 별도 |
| 6. 인증키 | `JEJU_CHILDCARE_KEY` 새 발급 자리 vs `CHILDCARE_API_KEY` 재사용 자리 (data.go.kr 1키 / info.childcare.go.kr 별도 박제) |

### 답습 자리 (3 후보)

- **A** (Recommended): 사용자 콘솔 스크린샷 — `https://www.data.go.kr/data/15101201/openapi.do` 의 "상세기능정보" 탭.
- **B**: WebFetch 재시도 (현재 자리 = 2회 실패). 사이트 일시 막힘 자리 가능.
- **C**: cpmsapi 시리즈 답습 가설 (응답 동일 자리 추정). 박제값 단정 자리 = 환각 위험 (룰 §"NEXT_SESSION 박제값 단정 금지" 답습).

## Success Criteria

- `regions.childcare` 채움 자리 = 256/256 (NULL 0건). 검증: `SELECT COUNT(*) FROM regions WHERE childcare IS NULL;` = 0.
- 제주시 + 서귀포시 2행 자리 모두 `count > 0`, `total_capacity > 0`.
- `collector_runs` 자리 마지막 `childcare-info-jeju` 실행 자리 = `status='success'`, `ok=2, fail=0`.
- audit-env-keys 자동 검출 자리 통과 (3-way 일치).
- monitor-collectors 자리 `collect-childcare-info-jeju` stale 감지 자리 박제 (월간 cron 데드존 차단).
- 제주 단지 UI 자리 = 어린이집 정보 표시 정상 (기존 UI 답습, regions.childcare 자동 표시).
- scoring 자리 제주 단지 childcare 점수 != 0 (기존 scoring 답습, regions.childcare.count 자동 계산).

## Open Questions

1. 인증키 자리 — `CHILDCARE_API_KEY` 재사용 자리 vs `JEJU_CHILDCARE_KEY` 별 발급 자리? (명세 답습 후 확정)
2. 응답 형식 자리 — XML vs JSON? (명세 답습 후 확정)
3. data.go.kr 1741 시리즈 자리 vs info.childcare.go.kr cpmsapi 시리즈 자리? (명세 답습 후 확정)

## 답습 자산 (재활용 자리)

- `scripts/collectors/childcare-info.mjs` (260줄) — XML 파싱 + GU_LAWD_MAP 순회 + regions JSONB 4 키 적재 + INFO-200 skip + 1% 임계값.
- `scripts/collectors/_shared.mjs` — loadEnv / getSupabase / fetchWithRetry / createReporter / recordCollectorRun / recordApiQuota / GU_LAWD_MAP / sleep / today.
- `.claude/rules/secret-naming-audit.md` — 3-way 동기화 의무.
- `.claude/rules/collector-timeout-rootcause-analysis.md` — timeout 진단 4-way.
- `.claude/rules/typescript-patterns.md` — // @ts-check + JSDoc cast 답습.
- `.claude/rules/workflow-name-hallucination.md` — yml 본문 grep 의무.
- `.claude/rules/kosis-dimension-mismatch-guard.md` — raw API sample 박제 의무.
- `.claude/rules/next-session-grep-mandate.md` — 박제값 단정 금지.

## Out of Scope

- cpmsapi030 (어린이집 상세 70필드) → schools.nearby_childcare 자리. 별 collector (`childcare-detail.mjs`) 답습 자산. 본 spec 범위 0.
- Kakao Places 기반 단지 도보권 어린이집 자리 → infra.childcare/childcare_dist 자리. 별 collector (`collect-childcare.mjs`) 답습 자산. 본 spec 범위 0.
- UI/scoring 변경 자리. regions.childcare 채워지면 기존 UI + scoring 답습 자산 자동 답습 자리. 본 spec 범위 0.

## References

- [BACKLOG L95~113](../../../.claude/BACKLOG.md) — 제주 미수집 사고 박제 (세션 275 발견, 세션 276 진단 정정).
- [SESSION_LOG 세션 276](../../../.claude/SESSION_LOG.md) — cpmsapi021 제주 미보유 운영키 raw 진단.
- [childcare-info.mjs](../../../scripts/collectors/childcare-info.mjs) — 답습 자산 원천.
- [.claude/API_REGISTRY.md L50~58](../../../.claude/API_REGISTRY.md) — info.childcare.go.kr 자리 박제.
- [data.go.kr 15101201](https://www.data.go.kr/data/15101201/openapi.do) — 공식 명세 페이지.
