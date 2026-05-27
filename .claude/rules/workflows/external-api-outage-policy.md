# 외부 API 장기 중단 정책 — 탐지·대기·재시도·알림 패턴

## 사고 박제 (세션 318~328)

housing-permits 수집기가 MOLIT 500 응답 4월 10일 이후 5월 내내 장애. collector_runs 행은 정상 (graceful 적용 후 partial) 이나 데이터 갱신 0건. 1개월+ 누적 후 발견.

raw API 진단:
- `apis.data.go.kr/1613000/HousingLicenseService` 응답 = HTTP 500 (API 서버 자체 장애)
- 본인 책임 0 (외부 API 자체 사고)
- 그러나 모니터링 = "collector 정상 실행 + 데이터 0건" 사고 답습 0 → 운영 데드존

## 근본 원인 = 외부 API 자체 장기 중단 대응 패턴 부재

collector 가 다음 3 시나리오 답습 0:

| 시나리오 | 답습 | 정책 부재 |
|---|---|---|
| 1회 429/500 (일시적) | fetchWithRetry 3회 재시도 | ✅ 박힘 |
| 1~2일 장애 | timeout cron 자연 회복 대기 | ✅ 박힘 |
| **1주+ 장기 중단** | "정상 실행 + 데이터 0건" 사고 답습 0 | ❌ 부재 |

장기 중단 = collector_runs 정상 + apartments 데이터 stale → silent fail. 사람 답습 1개월+ 후 발견.

## 정책 (3중)

### 1. 외부 API 의존 collector = "데이터 갱신 0건 연속 N회" 모니터 의무

월간/주간 collector 다음 패턴 답습 의무:

```bash
# 진단 grep — 최근 5회 collector_runs 모두 ok > 0 but apartments 데이터 stale
node --input-type=module -e "
import { loadEnv, getSupabase } from './scripts/collectors/_shared.mjs';
loadEnv();
const sb = getSupabase();
const { data: runs } = await sb
  .from('collector_runs')
  .select('phase, started_at, ok_count, fail_count')
  .eq('phase', 'housing-permits')
  .order('started_at', { ascending: false })
  .limit(5);
console.log('Last 5 runs:', runs);

// apartments.<key_field> stale 검증
const { data: stale } = await sb
  .from('apartments')
  .select('id, updated_at')
  .order('updated_at', { ascending: false })
  .limit(5);
console.log('Latest updated:', stale[0]?.updated_at);
"
```

마지막 갱신 시간이 **2주+** = 외부 API 장기 중단 의심 확정.

### 2. monitor-collectors.mjs 에 "외부 API 장기 중단" 카테고리 추가

`scripts/collectors/monitor-collectors.mjs` 5번째 점검 추가:

```js
// 점검 ⑤: 외부 API 의존 collector 의 "정상 실행 + 데이터 0건" 탐지
const EXTERNAL_API_COLLECTORS = [
  { phase: 'housing-permits', stale_days: 14, owner: 'MOLIT' },
  { phase: 'transport-tago', stale_days: 14, owner: 'TAGO' },
  { phase: 'schools-neis', stale_days: 30, owner: 'NEIS' },
  // 추가 collector 박힘
];

for (const { phase, stale_days, owner } of EXTERNAL_API_COLLECTORS) {
  const { data: runs } = await sb.from('collector_runs')
    .select('ok_count, fail_count, started_at')
    .eq('phase', phase)
    .order('started_at', { ascending: false })
    .limit(3);

  const allOk = runs.every(r => r.ok_count > 0);
  const lastRun = new Date(runs[0]?.started_at);
  const daysSince = (Date.now() - lastRun.getTime()) / 86400_000;

  if (allOk && daysSince > stale_days) {
    issues.push({
      type: 'external_api_outage',
      phase,
      owner,
      message: `${phase} ${stale_days}일+ 데이터 갱신 0건 + collector 정상 실행 = ${owner} API 장기 중단 의심`,
    });
  }
}
```

### 3. 외부 API 장기 중단 발견 시 답습 의무

장기 중단 의심 시 다음 4 단계 의무:

1. **raw API 호출 1회** — `curl <endpoint>` 직접 답습. 500/503/타임아웃 확인
2. **공식 공지 확인** — data.go.kr / KOSIS / NEIS 공지사항 grep ("점검", "장애" 키워드)
3. **장기 중단 박힘** — 의심 확정 시 BACKLOG.md 에 "🟡 외부 API 사고 — <owner> <시작일>" 1줄 박힘
4. **회복 트리거 박힘** — 다음 monitor 실행 시 ok_count > 0 + 갱신 시간 < 7일 = 자연 회복 박힘

## 안티 패턴 (사고 답습)

- ❌ "collector_runs 정상 = collector 정상" 단정 — 외부 API 500 응답 = ok_count 박힘 가능 (fetchWithRetry 종결 후 빈 응답 OK 처리)
- ❌ "1개월+ 침묵 = 자연 회복" 단정 — 외부 API 영구 폐기 가능 (예: KOSIS 통계표 ID 변경, 세션 222 박힘)
- ❌ "외부 API 사고 = 본인 책임 0" 단정 — 모니터 박힘 의무. silent fail 발견 1개월+ = 운영 사고
- ❌ "monitor-collectors.mjs 4개 카테고리로 충분" 단정 — 외부 API 장기 중단 = 5번째 카테고리 의무

## 답습 자산

- 세션 264 `category-null-monitor` 4 카테고리 박힘 답습 (apartments 19 + 시도 17 + 51 필드 + NULL 추세)
- 세션 265 월간 schedule 데드존 monitor 답습 (`secret-naming-audit.md` 운영 모니터링 절)
- 세션 295 collector timeout 4-way 답습 (`collector-timeout-rootcause-analysis.md`)
- 본 룰 신규 = 5번째 카테고리 (외부 API 장기 중단)
- 세션 318~328 housing-permits 사고 (1개월+ 데이터 갱신 0건)

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 외부 API collector 추가 후 1개월 silent fail | §1 EXTERNAL_API_COLLECTORS 배열 박힘 의무 → 월간 monitor 발화 |
| collector_runs 정상 + 데이터 stale 답습 0 | §2 점검 ⑤ 발동 → silent fail 7일 이내 발견 |
| 외부 API 영구 폐기 (KOSIS 통계표 ID 변경) | §3 raw API 호출 + 공식 공지 답습 → BACKLOG 박힘 |
| "외부 API 책임이라 본인 무관" 단정 | §안티 패턴 grep → 모니터 박힘 의무 답습 |

## 적용 트리거

신규 외부 API 의존 collector 추가 시 의무:
1. `EXTERNAL_API_COLLECTORS` 배열에 entry 1줄 박힘 (phase / stale_days / owner)
2. monitor-collectors.mjs 점검 ⑤ 발화 확인
3. 첫 monitor 발화 1회 dry-run 답습

기존 collector = 다음 운영 monitor (월 1일 cron) 자연 적용.
