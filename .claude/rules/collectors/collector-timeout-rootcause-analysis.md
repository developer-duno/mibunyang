# Collector timeout 사고 root cause 분석 — 4-way 답습 의무

## 사고 박제 (세션 295)

세션 294 가 `collect-naver-listings-incremental.yml` 5/22 schedule run 26311529575 cancelled (transport-tago 2.1배 느림) 박제 시 **timeout 90→120 임시 완화 + BACKLOG "root cause 분석 별 세션 자리" 박제**. 세션 295 진입 자리 = "코드/API 결함 자리 정확 정정 의무".

세션 295 v1 환각: "apartments 단지 수 1000→2001 폭증 (네이버 신규 추가)". 자가 점검 1 발동 → `apartments.created_at` 실측 = 30일+ 이전 박제 자리 (마지막 2026-04-07) → 신규 추가 0 자리 확정. v1 환각 폐기.

v2 정정: `git log -- scripts/collectors/transport-tago.mjs` 답습 결과 커밋 `01d0dd4` (2026-05-22 07:42) `limit(10000) → range 페이지네이션` 박제. 메시지 인용:

> PostgREST max_rows=1000 제한 우회 — limit(10000) 환각 (실제 1000 행만 반환) 정정. transport-tago L194 자리 포함.

진앙 자리 확정 = **collector 본문 변경 (5/22 07:42)**. timeout 90→120 fix 는 회귀 자리 없는 정확한 정정 자리.

## 근본 원인 = 단일 신호 단정

collector timeout 사고 자리 답습 시 **timeout 수치 (90/120) + 직전 run 시간** 단일 신호만 보고 "코드 결함" / "API rate limit" / "단지 수 폭증" 등 단정 환각. 진앙은 4 신호 교차 답습으로만 확정 가능 자리.

| 단일 신호 환각 | 4-way 검증 결과 |
|---|---|
| "코드 결함" | collector_runs 답습 → 직전 success 시간 답습 후 단지 당 일정 시간 확인 |
| "API rate limit" | raw run log 답습 → 단지 당 시간 일정 (sleep 자체가 의도된 자리) 확인 |
| "단지 수 폭증 (신규 단지)" | `apartments.created_at` 답습 → 30일 이내 신규 0 확인 시 폐기 |
| "timeout 자리 부족" | git log 답습 → collector 본문 변경 시점 자리 확정 |

## 재발 방지 (4-way 답습 의무)

collector timeout 사고 자리 plan 작성 시 다음 4 grep/실측 의무. 단일 신호 단정 금지.

### 1. raw run log 답습 (gh run view --log)

```bash
gh run view <cancelled_run_id> --log 2>&1 | grep -E "<collector>|\[<phase>\]" | head -50
```

핵심 박제: **"전체 N건 → 미수집 M건"** + **"X초 | 성공 Y"**. 단지 당 시간 = X/Y 계산. 단지 수와 시간이 선형 비례면 API/코드 결함 0 자리.

### 2. 직전 success run 답습 (단지 당 시간 비교)

```bash
gh run view <prev_success_run_id> --log 2>&1 | grep -E "<collector>|\[<phase>\]" | head -50
```

직전 success 와 cancelled 의 단지 당 시간 (X/Y) 비교. **3% 이내 = 노이즈 / 일정** → 코드 결함 0. 단지 수 증가가 처리 시간 증가의 원인 자리 확정.

### 3. collector 본문 변경 시점 답습 (git log)

```bash
git log --oneline -10 -- scripts/collectors/<collector>.mjs
git show <suspicious_commit> --stat 2>&1 | head -25
```

cancelled run 시점 직전에 collector 본문 변경 있는지 답습. 변경 있으면 = 그 자리가 진앙 자리. 변경 없으면 = 다른 원인 (`apartments.created_at` 답습 진입).

### 4. apartments.created_at 답습 (신규 단지 폭증 검증)

```bash
node --input-type=module -e "
import { loadEnv, getSupabase } from './scripts/collectors/_shared.mjs';
loadEnv();
const sb = getSupabase();
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const { count } = await sb.from('apartments').select('*', { count: 'exact', head: true }).gte('created_at', since);
console.log('apartments created in last 30 days:', count);
"
```

30일 이내 신규 단지 0 = "단지 폭증 (신규 추가)" 가설 폐기. 신규 단지 0 인데 단지 수가 늘어났으면 = collector fetch 로직 변경 자리 (위 §3 답습).

## 안티 패턴 (사고 답습)

- ❌ "timeout 수치 60→90 → 120 단순 늘림 = 정답" — 진앙 자리 답습 0회 후 timeout 늘리기 단정 금지. 단지 당 시간 일정 + 단지 수 증가 자리면 늘리기 정답, 다른 자리면 코드 root fix 자리
- ❌ "단지 당 시간 = 4초 = 의도된 sleep × 4 + API 호출 = 정상" 단정 — sleep 자체가 너무 긴 자리도 가능 자리. 옛 collector_runs 값과 비교 의무
- ❌ "apartments 신규 추가 없으면 collector fetch 변경" 단정 — `git log` 답습 1회 의무 (다른 collector 의 PostgREST max_rows fix 자리 같은 cross-collector 영향 가능)
- ❌ "BACKLOG '별 세션 자리 root cause 분석' 박제값 답습 단정" — 실측 4-way 답습 의무, 박제값 환각 가능 자리

## 답습 자산

- 세션 294 timeout 90→120 fix 커밋 `b313b56` (`collect-naver-listings-incremental.yml`)
- 세션 295 본 룰 박제 시점 = R1 분석 종결 자리 확정
- 커밋 `01d0dd4` (2026-05-22) PostgREST max_rows=1000 fix 16건 일괄 정정 자리 — 답습 자산 (cross-collector 영향 자리)
- `.claude/rules/workflows/secret-naming-audit.md` §"운영 모니터링 (월간 schedule)" 절 답습 (월간 cron 데드 존 박제)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 collector timeout cancelled run 답습 시 timeout 단순 늘리기 단정 | §1+§2 raw log 4-way 답습 의무 발동 → 단지 당 시간 비교로 진앙 진단 |
| `apartments.created_at` 답습 0회 후 "단지 폭증" 환각 단정 | §4 30일 신규 단지 grep 의무 발동 → 박제값 정정 |
| collector 본문 변경 시점 답습 0회 후 "API rate limit" 단정 | §3 `git log -- <collector>` 의무 발동 → 진짜 진앙 자리 확정 |
| BACKLOG "별 세션 자리 root cause 분석" 박제값 답습 단정 | §1~§4 4-way 답습 의무 → 박제값 ≠ 실측, 진앙 자리 다를 가능성 답습 |
