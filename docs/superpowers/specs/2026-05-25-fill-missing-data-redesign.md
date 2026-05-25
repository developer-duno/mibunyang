# fill-missing-data 점진 4 단계 리뉴얼 (A 단독 backfill)

> 세션 307 spec. 매주 일요일 5건 연속 cancelled/failure 사고 차단 + 외부 cron 박힌 11 collector fill matrix 제외.

## Context (왜 하는가)

### 발견된 사고

- `fill-missing-data.yml` 최근 5 run = **5건 연속 빨강** (cancelled 3 + failure 2). 5/24, 5/23, 5/22, 5/17, 5/10
- `collect-trade-stats.yml` 자체 cron = **3회 연속 cancelled** (5/24, 5/17, 5/10). 별도 진단 의무
- 매주 일요일 KST 11:00 cron 발화 시 monitor-collectors 텔레그램 알림 정기 발화
- **5/31 (일) KST 11:00 = 다음 발화** — 본 spec 미구현 시 6번째 누적 cancelled 예정

### 진앙

fill matrix 안 14 일꾼 중 **11 일꾼이 외부 cron 을 가진 collector**. 자체 cron 발화와 충돌 = sub-step cancelled 누적.

| 일꾼 | 외부 cron |
|---|---|
| `transport-tago` | `collect-transport.yml` 매월 4일 UTC 19:00 |
| `infra-kakao` | `collect-infra.yml` 매월 1일 UTC 18:00 |
| `noise-estimate` | `collect-noise.yml` 매월 1일 UTC 04:00 |
| `environment` | `collect-environment.yml` 매월 1일 UTC 17:00 |
| `noxious` | `collect-noxious.yml` 매월 3일 UTC 18:00 |
| `dart-builders` | `collect-dart-builders.yml` 분기별 1·4·7·10월 15일 |
| `molit-building-info` | `collect-building-info.yml` 매월 10일 UTC 16:00 |
| `population` | `collect-population.yml` 매월 5일 UTC 20:00 |
| `migration` | `collect-migration.yml` 매월 15일 UTC 22:00 |
| `collect-trades` | `collect-trades.yml` 매월 6일 UTC 20:00 (KST 7일 05:00) |
| `trade-stats` | `collect-trade-stats.yml` 매주 일 UTC 16:00 (KST 월 01:00) |

NEXT_SESSION 박힌 "위반 6건" vs 실측 11건. 환각 5건 (transport / infra / noise / molit-building / trade-stats) 추가 발견.

### 의도된 결과

1. **5/31 발화 이전 구현 머지** = 새 yml 실증 1회 + 6번째 누적 빨강 차단
2. **매주 일요일 빨강 사고 0건** = 외부 cron 가진 11 일꾼 모두 fill matrix 제외
3. **Phase 2 외부 API 호출 0회** (Phase 1 = Kakao API ~수백 호출 별도)
4. **신입 단지 backfill 평균 1주 (최악 2주)** = 새 단지 INSERT → 다음 일요일 fill 좌표 + 점수 자동 채움
5. **신규 collector 추가 시 안티 패턴 자동 차단** = `audit-fill-matrix.mjs` 신규 가드 (audit-env-keys 답습 73% 감소)
6. **trade-stats 자체 cron 사고 진단** = 본 spec 머지 직후 즉시 plan 진입 (P0 BACKLOG)

## 진앙 검증 (실측 근거)

| 가설 | 실측 |
|---|---|
| fill 최근 5 run 빨강 | ✅ `gh run list --workflow=fill-missing-data.yml --limit 5` = cancelled 3 + failure 2 |
| fill matrix 14 일꾼 | ✅ Phase 2/3/4/5 합 = 3+5+4+2 |
| 외부 cron 가진 collector 가 fill matrix 안에 있음 | ✅ 11 일꾼 (raw grep) |
| `sync-naver-complex` 자체 cron 0회 | ✅ collect-*.yml 어디에도 sync- 자체 yml 없음 (호출만 3 파일) |
| Phase 4 자체 cron 4건 success | ✅ dart / molit-building / population / migration 모두 최근 success |
| **trade-stats 자체 cron 사고** | ❌ 3회 연속 cancelled (별도 plan 진단 의무) |
| `monitor-collectors.yml` L49 "Fill Missing Data" | ✅ 이름 유지 시 영향 0 |
| `monitor-collectors.mjs` phase 이름 하드코딩 0회 | ✅ L575 워크플로 단위만 |
| `data-fill.mjs` ↔ fill-missing-data.yml 독립 | ✅ yml 안 호출 0회 (별도 orchestrator) |
| `extractMatrixJobs()` export 박힘 | ✅ `audit-env-keys.mjs` L81 `export async function` |
| Phase 1 reverse-geocode 자체 yml + cron 0회 | ✅ fill matrix 직렬 단계만 |
| 신규 단지 INSERT 자리 | ✅ `collect-applyhome.mjs` L191 `.from("apartments").update()` |
| 점진 정정 패턴 자산 | ✅ 세션 273 / 291 / 306 누적 3건 |

## 설계

### Architecture

```text
fill-missing-data.yml v3 (이름 유지, 개명은 Phase 3 별도)
  cron: 매주 일요일 KST 11:00 (유지)
  concurrency: data-collection (유지)

  Phase 1 — 좌표 backfill (변경 0, Kakao API 호출 박힘)
    timeout: 30분
    ├─ geocode-missing (Kakao 좌표 NULL → UPDATE, 자체 yml + cron 0회, 직렬 1단계)
    └─ reverse-geocode (Kakao 역지오 NULL → UPDATE, 자체 yml + cron 0회, 직렬 2단계)

  Phase 2 — 신입 단지 backfill (병렬, 외부 API 호출 0)
    timeout: 30분
    matrix:
      ├─ sync-naver-complex (Supabase select 만)
      ├─ calc-floors (순수 계산)
      └─ regulation-seed (순수 계산)

  Phase 3 — ❌ 폐기 (transport-tago / infra-kakao / environment / noise-estimate / noxious)
  Phase 4 — ❌ 폐기 (dart-builders / molit-building-info / population / migration)
  Phase 5 — ❌ 폐기 (collect-trades / trade-stats)
       ↑ trade-stats 폐기 = trade_stats 갱신 흐름 0건. 본 spec 머지 직후 즉시 진단 plan 진입 의무
```

결과:

- 매니저 권한 일꾼 14 → 5
- Phase 2 외부 API 호출 ~20,000 → 0 (Phase 1 Kakao 별도)
- 실행 시간 1~5시간 → 30분 이내
- 매주 일요일 빨강 사고 5건 연속 → 0건 (예상)
- 신입 단지 backfill 평균 1주 (최악 2주)

### Components (수정 파일)

#### 1. `.github/workflows/fill-missing-data.yml` (핵심, ~95줄, -103줄)

- Phase 3/4/5 job 본문 전체 삭제
- Phase 2 matrix 3 일꾼 유지
- needs 체인 단순화: `phase1-coords → phase2-backfill`
- env block 정리: `MOLIT_KEY` / `MOIS_POP_KEY` / `DART_KEY` / `KOSIS_MIGRATION_KEY` / `TAGO_KEY` 제거

#### 2. `scripts/audit-fill-matrix.mjs` (신규, ~30줄, audit-env-keys 답습 73% 감소)

- `audit-env-keys.mjs` L81 `extractMatrixJobs()` import 답습 (export 박힘 확정)
- collect-*.yml cron 보유 여부 추출
- 교집합 검출 + exit 1
- **신규 라인 80 → 30 (62% 감소)**

#### 3. `scripts/audit-fill-matrix.test.mjs` (신규, ~8줄, vitest skeleton 답습 86% 감소)

- `audit-env-keys.test.mjs` `.tmp-audit-test` fixture 패턴 답습
- fixture 2개 (safe + violation)
- **신규 라인 60 → 8 (86% 감소)**

#### 4. `.github/workflows/ci.yml` (1 step 추가, +2줄)

```yaml
- name: Validate fill matrix (외부 cron 가진 collector 제외)
  run: node scripts/audit-fill-matrix.mjs
```

기존 audit step 3건 (`audit-env-keys` / `audit-monitor-coverage` / `audit-collector-patterns`) 직후 추가.

#### 5. `.github/workflows/CLAUDE.md` (메모 정정, ~10줄)

- "유틸리티 (4개)" 절 `fill-missing-data.yml` 항목 정정:
  - "5 phase 직렬 + 매트릭스 병렬" → "Phase 1+2 만 잔존, 11 일꾼 제외 (세션 307)"

#### 6. `.claude/rules/workflows/timeout-rootcause-policy.md` (사고 추가, ~30줄)

- "세션 307 안티 패턴 11 일꾼 정정" 절 신규
- NEXT_SESSION 환각 6건 vs 실측 11건 답습
- trade-stats 자체 cron 사고 별도 plan 즉시 진입 권장

#### 7. `.claude/SESSION_LOG.md` + `.claude/BACKLOG.md` + `.claude/NEXT_SESSION.md` (메모 정정)

- SESSION_LOG: 세션 307 절 신규 (spec + plan + 검증 일정 + trade-stats 별도)
- BACKLOG:
  - 🔴 fill 리뉴얼 → ✅ 완료 (세션 307)
  - 🔴 **신규 P0**: trade-stats 자체 cron 3회 연속 cancelled 진단 (본 spec 머지 직후 즉시 plan 진입)
  - 🟢 후순위 개명 PR (Phase 3)
- NEXT_SESSION: 5/26~5/30 구현 + 5/31 발화 검증 + trade-stats 진단

### Data Flow

```text
매주 일요일 KST 11:00 cron 발화
   ↓
Phase 1 — 좌표 backfill (timeout 30분, Kakao API 호출 ~수백 회)
   ├─ geocode-missing: lat/lng NULL 단지 → Kakao 좌표 → UPDATE
   └─ reverse-geocode: address NULL → Kakao 역지오 → UPDATE
   ↓
Phase 2 — 신입 단지 backfill (matrix 병렬, timeout 30분, 외부 API 0)
   ├─ sync-naver-complex: complexes → apartments sync
   ├─ calc-floors: low_floor 비율 계산
   └─ regulation-seed: 규제지역 코드
   ↓
종결 ~20~30분 이내
```

**신입 단지 진입로** (별도 흐름, 검증 PASS):

- 새 단지 = `collect-applyhome.mjs` L191 `.from("apartments").update()` 또는 `collect-trades.mjs` apartments select / update
- 자체 cron 발화 시 apartments INSERT
- 다음 일요일 fill 의 Phase 1+2 가 좌표 + 점수 자동 채움
- 평균 1주, 최악 2주 (collect-* 발화 직후 fill cron 지나가면 다음 주 대기)

### Error Handling

| 사고 | 처리 |
|---|---|
| Phase 1 일꾼 실패 | `continue-on-error: true` 유지 → Phase 2 진행 |
| Phase 2 matrix 일꾼 실패 | `fail-fast: false` 유지 → 다른 일꾼 진행 |
| 전체 timeout 도달 | monitor-collectors 알림 발화 |
| 신규 collector 추가 시 안티 패턴 재발 | `audit-fill-matrix.mjs` CI 가드 exit 1 |
| **5/31 발화 cancelled (구현 후)** | `timeout-rootcause-policy.md` §1 raw log 답습 의무 |
| **trade-stats stale (본 spec 직접 유발)** | 본 spec 머지 직후 즉시 진단 plan 진입 (P0) |

### Testing

#### 단위 테스트

- `scripts/audit-fill-matrix.test.mjs` 신규 2 fixture (audit-env-keys.test 답습 86%)

#### 시뮬 검증 (Phase 1 PR 머지 전 의무)

- Phase 1 PR 머지 전 `gh workflow run fill-missing-data.yml` workflow_dispatch 1회 발화
- dry_run input 활성화 → 실제 DB 영향 0 + 새 yml 동작 검증
- success 확인 후 main 머지

#### 통합 테스트

- **5/31 (일) KST 11:00 cron 자동 발화** = 1차 실증 (구현 후)
  - 기대: Phase 1 + Phase 2 success, ~30분 이내
  - 검증: `gh run view --log` → 5 일꾼 success + Kakao 호출 ~수백 + 외부 API 0 확인
- **6/7 (일) KST 11:00 cron 자동 발화** = 2차 실증
- 2회 연속 success = spec 종결

#### End-to-end 검증

- monitor-collectors 알림 매주 발화 0건 = 사고 차단 확인
- 6/7 (일) `collect-trades.yml` 자체 cron success = trade 단독 동작 확인 (세션 305 답습)
- MOLIT / Kakao / DART / KOSIS 일일 한도 안전 확인
- trade-stats 진단 plan 진입 (별도 BACKLOG P0)

## Rollout Plan (점진 4 단계, Phase 1 자체는 한 PR 일괄 정정)

> 점진 답습 (세션 273/291/306) = "외부 cron 검증 1건씩 추가" 패턴. 본 Phase 1 = 11 일꾼 일괄 제거 + audit 가드 = 회귀 가드 1회 신규. 한 PR 정당화 = 11 일꾼 모두 같은 진앙 (외부 cron 충돌) + audit 가드 = 추가 PR 분리 시 사이클 6 주 누적 = 5/31~7/12 매주 빨강.

### Phase 0 — 본 세션 (오늘 5/25, 2 시간)

1. spec 작성: 본 파일
2. git commit + push (별도 PR 없이 spec 만)
3. 사용자 검토

### Phase 1 — 다음 세션 (5/26~5/30 중, 5/31 발화 3 시간 전 머지 목표, 4.5 시간)

1. writing-plans skill 답습 → 구현 plan 작성
2. PR #11 신규:
   - `.github/workflows/fill-missing-data.yml` 본문 정리 (~95줄)
   - `scripts/audit-fill-matrix.mjs` 신규 (~30줄)
   - `scripts/audit-fill-matrix.test.mjs` 신규 (~8줄)
   - `.github/workflows/ci.yml` Validate step 추가 (+2줄)
   - 메모 4 파일 정정
3. workflow_dispatch dry-run 1회 실증 → success 확인
4. CI 통과 후 머지

### Phase 1.5 — 5/31 발화 실증 (자동, 10분)

- 새 yml 1차 실증 (success 기대)
- `gh run view --log` 답습 후 5 일꾼 success + Kakao 호출 ~수백 + 외부 API 0 확인

### Phase 2 — 6/7 발화 실증 (자동, 10분)

- 2 회 연속 success = spec 검증 완료

### Phase 3 — 1 주 후 (6/14 발화 후, 30분)

- 별도 PR (개명):
  - `git mv fill-missing-data.yml backfill-new-apartments.yml`
  - `monitor-collectors.yml` `workflow_run.workflows` 동기화

### Phase 4 — trade-stats 진단 (별도 plan, P0, 본 spec 머지 직후 즉시 진입)

1. 3회 연속 cancelled 원인 진단 (`gh run view --log` 답습)
2. timeout 부족 / 큐 충돌 / API 사고 분류
3. 정정 spec 별도 작성 + PR

## Risks + Mitigations

| 위험 | 영향 | 정정 |
|---|---|---|
| 5/31 이전 Phase 1 구현 머지 실패 | 6번째 누적 cancelled + monitor 알림 발화 | Phase 0+1 동시 진입 (5 일 여유), workflow_dispatch dry-run 의무 |
| Phase 3/4/5 폐기 후 빈 칸 backfill 지연 | 외부 cron 일꾼 출근일까지 빈 칸 잔존 | Phase 4 자체 cron 4건 success 실측 (검증 PASS). 1 개월 이내 자동 채움 |
| sync-naver-complex 자체 cron 추가 시 충돌 재발 | 다시 빨강 사고 | `audit-fill-matrix.mjs` CI 가드 = exit 1 |
| 신입 단지 backfill 최악 2주 | 사용자 UI 표시 1~2 주 지연 | 평균 1주 명시, 최악 2주 단축 = 별도 spec |
| **trade-stats stale (본 spec 직접 유발)** | trade_stats 테이블 갱신 흐름 0건 → 사용자 UI 거래량 stale | **본 spec 머지 직후 즉시 trade-stats 진단 plan 진입 (P0 BACKLOG)** |
| Phase 1 dry-run 실증 0회 + 직접 PR 머지 | 새 yml 동작 미검증 → 5/31 사고 | dry-run workflow_dispatch 의무 |

## Out of Scope (별도 spec)

- **fill-missing-data.yml 개명** (`backfill-new-apartments.yml`) = Phase 3
- **monitor-collectors workflow_run 목록 동기화** = Phase 3 동시
- **점진 정정 답습 메타 정리** = 별도 spec
- 최악 2주 신입 단지 backfill 단축 (예: 매일 cron) = 별도 spec

## 답습 자산

- `.claude/rules/workflows/timeout-rootcause-policy.md` (세션 306)
- `.claude/rules/workflows/secret-naming-audit.md` §"matrix orchestrator"
- `.claude/rules/workflows/workflow-name-hallucination.md`
- `scripts/audit-env-keys.mjs` L24~26 (`MATRIX_ORCHESTRATORS` 상수, fill 박힘)
- `scripts/audit-env-keys.mjs` L81 `extractMatrixJobs()` (export 확정)
- `scripts/audit-env-keys.test.mjs` (`.tmp-audit-test` fixture 패턴)
- `scripts/audit-monitor-coverage.mjs` + test (순수 함수 + fixture)
- `.github/workflows/ci.yml` L39~46 (audit step 패턴)
- `scripts/collectors/collect-applyhome.mjs` L191 (apartments update)
- `scripts/collectors/collect-trades.mjs` L220 / L309 (apartments select + trades upsert)
- 세션 273 calc-collection 그룹 분리 (커밋 68c5051)
- 세션 291 phase2-calc 매트릭스 6→3 (외부 cron 가진 calc 제외)
- 세션 306 PR #10 schools-neis 제거 (7988127)
- spec v3 `daily-deploy.yml` 운영 답습 (P0 5일 stale 완전 종결)

## 검증 (본 plan 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 plan 적용 시 |
|---|---|
| 5/31 이전 Phase 1 구현 머지 실패 | dry-run 실증 의무 + 5 일 여유 = 머지 가능. 머지 실패 시 5/31 = 6 번째 cancelled (예상 risk) |
| 새 collector 자체 cron 보유 + fill matrix 동시 등록 | `audit-fill-matrix.mjs` CI exit 1 → push 차단 |
| 5/31 발화 timeout 부족 cancelled | `timeout-rootcause-policy.md` §1 raw log 답습 의무 |
| sync-naver-complex 자체 cron 신규 추가 | CI 가드 발동 → fill matrix 제외 정정 |
| NEXT_SESSION 박힌 6건 단정 후 plan 진입 | `next-session-grep-mandate.md` §1 grep 의무 |
| trade-stats stale (본 spec 직접 유발) | Phase 4 trade-stats 진단 plan 즉시 진입 (P0) |

## 자가 점검 결과 (서브에이전트 6 개 병렬, 2 사이클)

### 1차 검증 (Agent A/B/C 병렬) — 12 발견

- 할루시네이션: 4건 (trade-stats 요일 / data-fill.mjs 좀비 / monitor 검증 / sync 자체 cron)
- 맹점: 5건 (data-fill 정정 / 신입 진입로 / monitor / audit 자산 / MATRIX_ORCHESTRATORS)
- 자산 재활용: 4건 (extractMatrixJobs / test fixture / vitest skeleton / ci step)
- 중복 차감 1 = **12 net**

→ 정정 결과: 신규 코드 140줄 → 38줄 (73% 감소) 확정. data-fill / monitor 정정 의무 0건 확정.

### 2차 검증 (Agent A2/B2/C2 병렬) — 자가 모순 8건

- P0 자가 모순: 3건 (Phase 0/1 일정 / trade-stats Out of Scope / 외부 API 0회 vs Phase 1 Kakao)
- P1 자가 모순: 2건 (점진 vs 일괄 / 시뮬 dry-run 무)
- 부분 모순: 3건 (A+B 정의 / 신입 1주 / 전면 vs 4 단계)

→ 정정 결과: Phase 0+1 동시 진입 + trade-stats P0 BACKLOG + Kakao 호출 명확화 + 한 PR 정당화 + dry-run 의무.

## v3 자가 모순 정정 누적 (P0 3 + P1 2 + 부분 3 = 8)

| ID | 자가 모순 | 정정 |
|---|---|---|
| #1 | Phase 0/1 일정 = 5/31 발화 전 미배포 | Phase 0+1 동시 진입 (5/26~5/30 머지) |
| #2 | trade-stats Out of Scope vs 직접 유발 | P0 BACKLOG 신규 (본 spec 머지 직후 즉시 plan) |
| #3 | 외부 API 호출 0회 vs Phase 1 Kakao | "Phase 2 외부 API 0, Phase 1 Kakao 별도" 명확화 |
| #4 | 점진 답습 vs 한 PR 일괄 | 한 PR 정당화 명시 (11 일꾼 같은 진앙 + 매주 빨강 6 주 누적 risk) |
| #5 | 시뮬 dry-run 0회 | Phase 1 PR 머지 전 workflow_dispatch dry-run 의무 |
| #6 | A+B 하이브리드 vs A 단독 | "A 단독 (신입 단지) + 외부 cron 자체 (빈 칸)" 명확화 |
| #7 | 신입 단지 1주 보장 vs 최악 2주 | "평균 1주, 최악 2주" 정정 |
| #8 | 전면 리뉴얼 vs 4 단계 | "점진 4 단계 리뉴얼, Phase 1 한 PR 일괄 정정" 정정 |
