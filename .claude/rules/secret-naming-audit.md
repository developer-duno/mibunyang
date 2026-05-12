---
title: ETL 환경변수 이름 동기화 감사
incident_dates: ["2026-04-15", "2026-05-12", "2026-05-13"]
related_collectors: ["migration.mjs", "data-fill.mjs", "collect-migration.yml"]
---

# Secret 이름 3-way 동기화 감사 — Code ↔ Workflow ↔ Orchestrator

## 사고 박제 (세션 232)

`collect-migration.yml` 이 **`MOIS_POP_KEY`** 만 주입하는데 `migration.mjs` 는 **`KOSIS_MIGRATION_KEY`** 만 사용. **2026-04-15 schedule failure 부터 1개월 방치** (월 1회 발화 = 4/15 + 5/15 누적 2회 fail).

`data-fill.mjs` L43 `envKeys: ["MOIS_POP_KEY"]` 도 동일 불일치 (제3 사고). orchestration 사전 validate 무력화.

raw log (gh run view 24481813793 --log-failed):

```
[migration] ERROR: KOSIS_MIGRATION_KEY 환경변수 필요
```

## 근본 원인 = 3-way 비동기

3개 위치에 같은 환경변수 이름이 박혀야 하는데 동기화 강제 메커니즘 0:

| 위치 | 역할 | 박제 형식 |
|---|---|---|
| `scripts/collectors/<name>.mjs` | 코드가 실제 읽음 | `process.env.X` |
| `.github/workflows/<name>.yml` | GitHub Actions 가 주입 | `X: ${{ secrets.X }}` (env block) + validate step |
| `scripts/collectors/data-fill.mjs` (orchestrator) | 사전 사용성 검사 | `envKeys: ["X"]` |

3 군데가 손으로 동기화되어야 함 → 1 군데만 박아도 sub schedule run 1회 통과 → 4xx fail 만 발생 → 사람 못 봄.

## 재발 방지 (3중)

### 1. 정적 audit 스크립트 (`scripts/audit-env-keys.mjs`)

매 ETL collector 마다 3-way 일치 자동 검출:

```js
// 의사 코드 (스크립트 본문은 별도 파일)
// 1. scripts/collectors/*.mjs 파싱 → process.env.X 추출
// 2. .github/workflows/collect-<name>.yml 파싱 → env block + validate 추출
// 3. data-fill.mjs 파싱 → envKeys 추출 (해당 scripts: 가 collector 포함 시)
// 4. mismatch 발견 시 exit 1 + 어느 위치 빠졌는지 표시
```

### 2. CI 단계 추가 (`.github/workflows/ci.yml`)

```yaml
- name: ETL env-key 3-way audit
  run: node scripts/audit-env-keys.mjs
```

push 시 자동 검출, fail 시 머지 차단.

### 3. validate secrets step 의무화 (yml 답습)

각 ETL workflow 의 첫 step 으로 `Validate secrets` 추가 — secret 빈 값일 때 즉시 exit. 다른 ETL workflow grep:

```bash
grep -L "Validate secrets" .github/workflows/collect-*.yml
```

→ 누락 yml 일괄 보강.

## 절차 (다음 ETL 추가 시)

1. 코드 작성 `process.env.X` (`scripts/collectors/<name>.mjs`)
2. yml 작성 `X: ${{ secrets.X }}` (env block) + Validate secrets step
3. data-fill.mjs 에 collector 추가 시 `envKeys: ["X"]` 동시 박제
4. GitHub Secret X 등록 (`gh secret set X --body $VAL`)
5. `node scripts/audit-env-keys.mjs` 로컬 통과 확인 후 commit
6. push → CI audit step 통과 확정

## 안티 패턴 (사고 답습)

- ❌ "이 collector 는 X 키만 쓰면 되니까 yml validate 는 다른 키만" — orchestration 분리 시 사라짐
- ❌ "X 가 Y 와 호환되니 secrets.Y 재활용" — KOSIS_MIGRATION_KEY vs KOSIS_KEY 처럼 별도 발급된 별도 인증키일 가능성 (세션 102 박제). 호환 단정 금지, 실제 API 호출 1회 검증
- ❌ "schedule fail 1회 = 일회성 spike" — schedule 1회 fail 후 다음 발화까지 1주~1개월 공백 (월간 cron). 사람이 못 봄

## 보조 — 운영 모니터링 (월간 schedule)

- 사고 패턴: **월간 schedule** (cron `* * 15 * *` 등) 은 1회 fail 시 다음 발화까지 1개월 = **운영 측 사고 알람 데드 존**
- 대안: `monitor-db-size.yml` 같은 매월 1일 monitor 가 핵심 컬럼 (`regions.net_migration`, `regions.avg_income` 등) NULL 비율 체크 → 임계값 (예 30%+) 초과 시 alert
- 트리거 박제: `.claude/BACKLOG.md` 🟢 후순위 monitor 추가

## 답습 자산

- 세션 222 (KOSIS DT_1YL202001E → DT_MLTM_2082): 통계표 ID 변경 사고 답습
- 세션 224 audit hypothesis: BACKLOG 박제값 단정 근거 사용 금지, raw log 의무
- 세션 232 본 사고: 3-way 환경변수 동기화 검증 자동화 의무

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

본 룰 적용 시 사고 시뮬레이션:

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| collector 에 `process.env.NEW_KEY` 추가, yml 미반영 | CI audit step fail → 머지 차단 |
| yml 에 `NEW_KEY` 주입 추가, secret 미등록 | Validate secrets step fail → schedule run 즉시 exit (월간 데드존 회피) |
| 비호환 키 (KOSIS_KEY vs KOSIS_MIGRATION_KEY) 단정 fallback | 본 룰 §안티 패턴 grep 의무, plan v1 작성 시 막힘 |
