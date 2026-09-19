# 외부 API 장기 중단 정책 — 탐지·대기·재시도·알림 패턴

> 사건·이력 (세션318~328 — housing-permits 수집기가 MOLIT 500 응답으로 5월 내내 장애였으나 collector_runs 는 정상(graceful partial)이라 1개월+ 누적 후 발견) → [rules-history/workflows/external-api-outage-policy.md](../../rules-history/workflows/external-api-outage-policy.md)

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
  .select('collector, finished_at, status, ok_count, fail_count')
  .eq('collector', 'housing-permits')
  .order('finished_at', { ascending: false })
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

### 2. monitor-collectors.mjs 에 "외부 API 장기 중단" 카테고리 추가 (세션 334 적용 박힘)

`scripts/monitor-collectors.mjs` 5번째 점검 박힘 (실측 경로). 컬럼 진실의 원천 = `collector_runs.collector` (NOT phase). PHASE 상수 = recordCollectorRun 입력값 실측 답습.

```js
// 점검 ⑤: 외부 API 의존 collector 의 "정상 실행 + 데이터 갱신 0건 연속 N회" 탐지
export const EXTERNAL_API_COLLECTORS = [
  { collector: "housing-permits", stale_days: 14, owner: "MOLIT 주택건설실적" },
  { collector: "building-hub",    stale_days: 14, owner: "MOLIT 건축물대장 허브" },
  { collector: "transport",       stale_days: 14, owner: "TAGO 대중교통" },
  { collector: "schools",         stale_days: 14, owner: "NEIS 학교정보" },
];

const OUTAGE_MIN_CONSECUTIVE = 3;

export function checkExternalApiStale(targets, runsByCollector, now = new Date()) {
  const issues = [];
  for (const { collector, stale_days, owner } of targets) {
    const rows = runsByCollector[collector] ?? [];
    if (rows.length < OUTAGE_MIN_CONSECUTIVE) continue; // 신규 collector 오탐 차단
    const recent = rows.slice(0, OUTAGE_MIN_CONSECUTIVE);
    // success 인데 ok=0 만 점검 — failure 는 ①, 단발 0건은 ②가 잡음 (중복 회피)
    const allEmptySuccess = recent.every(
      (r) => r.status === "success" && (r.ok_count ?? 0) === 0,
    );
    if (!allEmptySuccess) continue;
    const oldest = recent[recent.length - 1];
    if (!oldest.finished_at) continue;
    const daysSince = (now.getTime() - new Date(oldest.finished_at).getTime()) / 86400000;
    if (daysSince <= stale_days) continue;
    issues.push({
      kind: "outage",
      collector,
      detail: `${owner} API ${Math.floor(daysSince)}일+ 정상실행+0건 (${OUTAGE_MIN_CONSECUTIVE}회 연속) — 외부 API 장기 중단 의심`,
      // lines 박힘 (조치 가이드 3건)
      at: oldest.finished_at,
    });
  }
  return issues;
}
```

> 사건·이력 (환각 정정 v1→v2, 세션334 — phase→collector 등 6건 정정) → [rules-history/workflows/external-api-outage-policy.md](../../rules-history/workflows/external-api-outage-policy.md)

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

> 답습 자산·차단 검증 이력 → [rules-history/workflows/external-api-outage-policy.md](../../rules-history/workflows/external-api-outage-policy.md)

## 적용 트리거

신규 외부 API 의존 collector 추가 시 의무:
1. `EXTERNAL_API_COLLECTORS` 배열에 entry 1줄 박힘 (phase / stale_days / owner)
2. monitor-collectors.mjs 점검 ⑤ 발화 확인
3. 첫 monitor 발화 1회 dry-run 답습

기존 collector = 다음 운영 monitor (월 1일 cron) 자연 적용.

## stale_days 정정 답습 (세션 339)

> 사건·이력 (세션339~496 — schools=35 를 "NEIS 분기 발화" 환각으로 박았다가 세션338 3주 사고가 35일 한계 안에 묻혀 alert 0회. 세션463 은 "일일=14" 주석이 월간 collector 2종에 잔존해 거짓 stale 경보 + 진짜 outage 를 가림. 세션496 은 기준표에 주간이 빠져 있어 다음 세션이 오설정할 여지를 봉합) → [rules-history/workflows/external-api-outage-policy.md](../../rules-history/workflows/external-api-outage-policy.md)

**최종 기준 = 일일=14 / 주간=14 / 월간=38 / 분기=100** (전부 "발화주기 + 여유 1주기" 꼴, cron yml grep 후 박힘). 진실의 원천 = `scripts/monitor-collectors.mjs:176` 의 `EXTERNAL_API_COLLECTORS` 배열 — drift 시 코드 우선.

> 차단 검증(보강) 이력 → [rules-history/workflows/external-api-outage-policy.md](../../rules-history/workflows/external-api-outage-policy.md)
