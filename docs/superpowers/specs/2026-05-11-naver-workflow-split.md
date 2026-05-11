# Naver Post-Processing 워크플로 분리 (Core + Incremental) 설계

> 작성: 2026-05-11 (세션 227). 메타 spec `2026-05-11-naver-postprocess-bottleneck-design.md` (165줄) §C "옵션 D-2" 의 본문 박제. yml 실제 분리 작업은 별도 세션 (사용자 결정).

## §1. Context 및 답습 자료

### 진입 trigger

`.github/workflows/collect-naver-listings.yml` 가 **5/8~5/11 4회 연속 cancelled @ timeout 한계 도달**:
- 5/8 cron: cancelled @ 60m (세션 224 fix 직전)
- 5/9 cron: cancelled @ 60m (세션 224 fix 60→90 적용)
- 5/10 cron: cancelled @ 90m 19s (run `25638230275`, 세션 225 escalate 1회차)
- 5/11 cron: cancelled @ 90m 19s (post-process job `25638230275` 동일 패턴, 세션 227 escalate 2회차)

세션 227 결정 = **D-1 즉시 적용** (timeout 90→120m, 5/12 cron 응급 마진 35분 확보, 커밋 `7f69a84`) **+ D-2 spec 박제** (본 문서).

### 답습 자료

| 자료 | 위치 | 역할 |
|---|---|---|
| 메타 spec | `docs/superpowers/specs/2026-05-11-naver-postprocess-bottleneck-design.md` (165줄) | run 25638230275 step-별 실측 + 옵션 D-1/D-2/E 트레이드오프 |
| 기존 yml | `.github/workflows/collect-naver-listings.yml` (90줄) | 본 분리 대상 |
| 세션 224 | `150044d` | timeout 60→90 fix 답습 |
| 세션 225 | `d1bd747` | 5/10 escalate 박제 답습 |
| 세션 226 | `d70cbd6` | 메타 spec 박제 답습 |
| 세션 227 | `7f69a84` | D-1 timeout 90→120 응급 fix (본 spec 작성 직전) |

### 본 spec 의 범위

- ✅ Core/Incremental 분리 경계선 박제
- ✅ Incremental yml 본문 (steps + concurrency + cron) 박제
- ✅ Core yml 변경 자리 박제
- ✅ KAKAO_KEY / TAGO_KEY 충돌 검증 (본인 grep 실측 답습)
- ❌ yml 실제 파일 작성/삭제 (별도 세션)
- ❌ apartments race condition 정밀 검증 (yml 적용 후 회귀 자리)
- ❌ 옵션 E (sync 최적화) — 별도 plan

## §2. 분리 경계선 (실측 박제)

run `25638230275` step-별 timestamp 실측 (메타 spec §A 답습):

| 분류 | Step | 소요 | continue-on-error |
|---|---|---|---|
| setup | checkout + setup-node + npm ci + Validate secrets | 13초 | ❌ |
| **core 병목** | **Sync naver complex data** | **47분 52초** | ❌ |
| core | Geocode missing coordinates | <1초 | ❌ |
| core | Reverse geocode addresses | 1초 | ❌ |
| core | Calculate exclusive ratio | 3초 | ❌ |
| **incremental** | **Collect transport (tago)** | **27분 31초** | ✅ |
| **incremental** | **Collect infra (kakao)** | **9분 26초** | ✅ |
| **incremental** | **Collect schools (neis)** | 4분 59초 @ 300/1000 cancelled | ✅ |
| **총 실측** | — | **90분 19초** (timeout) | — |

**분리 경계선**:
- **Core** = setup (L19~38) + sync~calc (L40~64) = **48분 (47:52 + 시작 13초 + 5초)**
- **Incremental** = transport+infra+schools (L66~89) = **41분 56초 + 미완 schools**

**분리 후 예상**:
- Core: UTC 19:00 시작 → UTC 19:48 완료 (48분, 90m 한도 내 마진 42분)
- Incremental: UTC 20:30 시작 → UTC 21:12 완료 (42분, 60m 한도 내 마진 18분)

## §3. Core workflow yml (기존 파일 정정)

### 파일 경로

`.github/workflows/collect-naver-listings.yml` (기존 파일명 유지, 신규 파일 0)

### 변경 자리

1. **name**: `Naver Post-Processing` → `Naver Post-Processing (Core)`
2. **timeout-minutes**: 120 (D-1 적용값) → **90** (incremental 분리 후 core 단독 48분만 → 90m 충분)
3. **concurrency.group**: `naver-postprocess` (기존 유지) — incremental 가 별도 group 신규
4. **steps L66~89 삭제**: transport/infra/schools 3 step 모두 incremental yml 로 이전

### 본문 (예상 64줄)

```yml
name: Naver Post-Processing (Core)

on:
  schedule:
    - cron: '0 19 * * *' # UTC 19:00 = KST 04:00
  workflow_dispatch:

concurrency:
  group: naver-postprocess
  cancel-in-progress: false

jobs:
  post-process:
    runs-on: ubuntu-latest
    # 세션118 30→60, 세션224 60→90, 세션227 90→120 응급, 세션N (D-2 적용) 120→90
    # incremental 분리 후 core 단독 48분 (47:52 + 5초) → 90m 마진 42분
    timeout-minutes: 90

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
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
            echo "::error::Required secrets missing"
            exit 1
          fi

      - name: Sync naver complex data to apartments
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: node scripts/collectors/sync-naver-complex.mjs

      - name: Geocode missing coordinates
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KAKAO_KEY: ${{ secrets.KAKAO_KEY }}
        run: node scripts/collectors/geocode-missing.mjs

      - name: Reverse geocode addresses
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KAKAO_KEY: ${{ secrets.KAKAO_KEY }}
        run: node scripts/collectors/reverse-geocode.mjs

      - name: Calculate exclusive ratio
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: node scripts/collectors/calc-exclusive-ratio.mjs
```

## §4. Incremental workflow yml (신규 파일)

### 파일 경로

`.github/workflows/collect-naver-listings-incremental.yml` (신규, `collect-*.yml` 패턴 답습)

### 본문 (예상 60줄)

```yml
name: Naver Post-Processing (Incremental)

on:
  schedule:
    - cron: '30 20 * * *' # UTC 20:30 = KST 05:30 (core UTC 19:00 완료 + 42분 마진)
  workflow_dispatch:

concurrency:
  group: naver-postprocess-incremental
  cancel-in-progress: false

jobs:
  post-process-incremental:
    runs-on: ubuntu-latest
    # 실측 transport 27:31 + infra 9:26 + schools 4:59 = 41:56 + 마진 18분 = 60m
    timeout-minutes: 60

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
          KAKAO_KEY: ${{ secrets.KAKAO_KEY }}
          TAGO_KEY: ${{ secrets.TAGO_KEY }}
        run: |
          if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ] || [ -z "$KAKAO_KEY" ] || [ -z "$TAGO_KEY" ]; then
            echo "::error::Required secrets missing"
            exit 1
          fi

      - name: Collect transport (incremental)
        continue-on-error: true
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KAKAO_KEY: ${{ secrets.KAKAO_KEY }}
          TAGO_KEY: ${{ secrets.TAGO_KEY }}
        run: node scripts/collectors/transport-tago.mjs

      - name: Collect infra (incremental)
        continue-on-error: true
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KAKAO_KEY: ${{ secrets.KAKAO_KEY }}
        run: node scripts/collectors/infra-kakao.mjs

      - name: Collect schools (incremental)
        continue-on-error: true
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          KAKAO_KEY: ${{ secrets.KAKAO_KEY }}
        run: node scripts/collectors/schools-neis.mjs
```

## §5. Trigger 분리 채택 = schedule UTC 20:30 단독

### 3 옵션 트레이드오프

| 옵션 | 장점 | 단점 |
|---|---|---|
| **schedule UTC 20:30 단독** ✅ | core cancelled 무관 독립 실행, 충돌 0, 단순 | sync 미완 시에도 incremental 도 (race condition 검토) |
| workflow_run trigger | core success 보장 후 자동 | core cancelled 4회 연속 답습 → incremental 안 돎 |
| 양쪽 (schedule + workflow_run) | core 빠를 시 즉시, 지연 시 fallback | 검증 복잡도 ↑, 중복 실행 가능 |

### 채택 = **schedule UTC 20:30 단독** (사용자 결정 세션 227)

근거:
- **core cancelled 4회 연속 답습 위험** → workflow_run trigger 채택 시 incremental 안 돎
- **schedule UTC 20:30** = core (UTC 19:00) + core 90m 한도 → 마진 1시간 30분 (충돌 0)
- **race condition** = `cancel-in-progress: false` 답습 + sync 완료 후 apartments 갱신 안전:
  - incremental 의 transport-tago: 새 테이블 `naver_complex_transport` (sync 의존 0)
  - incremental 의 infra-kakao: apartments UPDATE `naver_complex_*` 필드 (sync 완료된 행 읽기)
  - incremental 의 schools-neis: apartments UPDATE 다른 필드 (sync 충돌 0)

## §6. KAKAO_KEY / TAGO_KEY 충돌 검증 (본인 grep 실측)

### KAKAO_KEY 공유 워크플로 12개

본인 `grep -l KAKAO_KEY .github/workflows/*.yml` 실측 결과:

| Workflow | Cron (UTC) | KST | 빈도 |
|---|---|---|---|
| **collect-naver-listings.yml** (본 core) | `0 19 * * *` | 04:00 매일 | daily |
| collect-police.yml | `0 16 1 * *` | 01:00 매월 1일 | monthly |
| collect-environment.yml | `0 17 1 * *` | 02:00 매월 1일 | monthly |
| collect-infra.yml | `0 18 1 * *` | 03:00 매월 1일 | monthly |
| collect-noxious.yml | `0 18 1 * *` | 03:00 매월 1일 | monthly |
| collect-transport.yml | `0 19 1 * *` | 04:00 매월 1일 | monthly |
| collect-childcare.yml | `0 20 1 * *` | 05:00 매월 1일 | monthly |
| collect-schools.yml | `0 22 2 * *` | 07:00 매월 2일 | monthly |
| collect-noise.yml | `0 4 1 * *` | 13:00 매월 1일 | monthly |
| fill-missing-data.yml | `0 21 * * 0` | 월 06:00 일요일 | weekly |
| geocode-missing.yml | (cron 0, workflow_dispatch only) | — | manual |
| reverse-geocode.yml | (cron 0, workflow_dispatch only) | — | manual |

### UTC 20:00 동시 사용 4개 (KAKAO/MOLIT/KOSIS 공유)

본인 `grep -B1 "cron:" .github/workflows/*.yml | grep "0 20"` 실측:

- collect-childcare.yml (KAKAO_KEY, 매월 1일 UTC 20:00)
- collect-unsold-kosis.yml (KOSIS_KEY, 매월 1일 UTC 20:00)
- collect-market-stats.yml (KOSIS_KEY, 매월 5일 UTC 20:00)
- collect-population.yml (MOIS_POP_KEY, 매월 5일 UTC 20:00)

→ 매월 1일 / 5일 UTC 20:00 = 동시 호출 자리. **UTC 20:30 incremental = 30분 마진 정합** (KAKAO API rate limit 10000/일 충분 분산).

### TAGO_KEY 충돌 0

`grep -l TAGO_KEY .github/workflows/*.yml` 실측:
- `collect-transport.yml` (매월 1일 UTC 19:00) 단독
- `collect-naver-listings.yml` (transport-tago step 포함, daily UTC 19:00) — 분리 후 incremental UTC 20:30

→ incremental UTC 20:30 = collect-transport UTC 19:00 와 1시간 30분 마진 (충돌 0).

### 전체 workflow 수 = 37개

본인 `ls .github/workflows/*.yml | wc -l` 실측 = **37개**. 기존 `.github/workflows/CLAUDE.md` L7~77 박제값 35개 → 37개 stale 정정 자리 박제 (별도 plan, 본 spec 범위 밖). 본 spec 적용 시 38개 (incremental 신규 +1).

## §7. 검증 의무 (yml 적용 세션)

### Phase 1: yml 작성 직후

- [ ] `git diff` core yml = 4 step 삭제 (L66~89) + name + timeout 변경 확인
- [ ] 신규 incremental yml = 60줄 정합 + KAKAO_KEY/TAGO_KEY env 정확
- [ ] `actionlint` 또는 GitHub 자동 검증 (push 시점)

### Phase 2: 7일 누적 측정

- [ ] core workflow 90m 한계 + 실측 < 60m 목표 (sync 47.9m + setup 13s + calc 5s)
- [ ] incremental workflow 60m 한계 + 실측 < 45m 목표 (transport 27.5m + infra 9.5m + schools 5m)
- [ ] 7일 누적 성공률 ≥ 5/7 (core + incremental 각각)
- [ ] concurrency race condition 0 (apartments UPDATE 충돌 0 → Supabase row-level check)

### Phase 3: KAKAO_KEY 동시 호출 검증

- [ ] 매월 1일 KST 05:00 (UTC 20:00 collect-childcare) + 매월 1일 KST 05:30 (UTC 20:30 incremental) → KAKAO API rate limit 분산 (10000/일 한도 80% 이하)
- [ ] 매월 1일 KST 04:00 (collect-naver-listings core UTC 19:00) + 매월 1일 KST 04:00 (collect-transport monthly UTC 19:00) → KAKAO + TAGO 동시 = `gh run list` 시각 확인

## §8. 롤백 자리

### D-2 적용 후 롤백 = 2 커밋 revert

1. `git revert <incremental yml 신규 커밋>` → `.github/workflows/collect-naver-listings-incremental.yml` 자동 삭제
2. `git revert <core yml 정정 커밋>` → core yml = D-1 적용 상태 (timeout 120m, transport/infra/schools 포함) 복구

### D-1 (timeout 120m) 과 독립

- 본 D-2 분리 작업은 D-1 적용 상태 위에서 진행 (D-1 = `7f69a84` 커밋 답습)
- D-2 적용 시 D-1 revert 의무 0 (D-2 core yml 정정에 timeout 120→90 포함)
- 양쪽 동시 revert 시 = 기존 yml (timeout 90m, 전체 step 포함) 복구

## §9. 비-작업 (명시적 제외)

본 spec 적용 별도 세션에서도 명시 제외:

- ❌ `sync-naver-complex.mjs` 652줄 chunk 분할 (옵션 E, 별도 plan)
- ❌ `schools-neis` cancelled 진단 (300/1000 답습, 별도)
- ❌ `regions.avg_price` drop 마이그레이션 (cross-repo, 별도)
- ❌ `post-naver-collect.sh` 로컬 파이프라인 변경 (집 서버 사용자 PC 영향)
- ❌ `naver-units.yml` 재활성화 (세션 89 IP 차단 답습)
- ❌ `.github/workflows/CLAUDE.md` workflow 수 35→37 정정 (별도 plan)

## §10. 답습 자산

- 메타 spec `docs/superpowers/specs/2026-05-11-naver-postprocess-bottleneck-design.md` (165줄, §A run 실측 + §C 옵션 D-2 + §E concurrency)
- 세션 227 `7f69a84` (D-1 timeout 90→120 응급 fix)
- 세션 226 `d70cbd6` (메타 spec 박제)
- 세션 225 `d1bd747` (escalate trigger 1회차 박제)
- 세션 224 `150044d` (timeout 60→90 fix)
- `~/.claude/projects/f--mibunyang/memory/feedback_cross_repo_schema_audit.md` (yml 적용 세션 답습 자리)
- `~/.claude/projects/f--mibunyang/memory/feedback_subagent_report_trust.md` (서브에이전트 모순 시 본인 직접 실측 1회 의무)
- `~/.claude/projects/f--mibunyang/memory/feedback_audit_hypothesis_partial_hallucination.md` (gh CLI run log 직접 timestamp 추출 의무)

## §11. 다음 세션 진입 조건 (yml 적용 trigger)

- 5/12 cron 결과 확정 (KST 5/12 04:54 시점 `gh run list --workflow=collect-naver-listings.yml --limit 1`)
- 시나리오:
  - **A**: success ≤ 100m → D-2 yml 적용 보류 (D-1 단독 안정화 모니터링 7일)
  - **B**: cancelled @ 120m → D-2 yml 적용 즉시 진입 (본 spec 답습)
  - **C**: cancelled + step 실패 → 옵션 E (sync 최적화) 우선순위 ↑ + D-2 보류

사용자 explicit trigger 의무 (자동 진입 0, decision-log/0053 §2 답습).
