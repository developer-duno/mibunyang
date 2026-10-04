# 외부 API 장기 중단 정책 — 탐지·대기·재시도·알림 패턴

## 한 줄

1회 429/500 은 `fetchWithRetry` 3회, 1~2일 장애는 다음 cron 이 자연 회복한다. 그러나 **1주+ 장기 중단 = `collector_runs` 정상 + 데이터 stale = silent fail** — 사람은 1개월+ 뒤에 발견한다. 그래서 모니터가 잡는다.

## 정책 (3중)

1. **외부 API 의존 collector 는 "데이터 갱신 0건 연속 N회" 모니터 의무** — 최근 `collector_runs`(collector 기준) 와 `apartments` 의 해당 필드 갱신 시각을 본다. 마지막 갱신 **2주+** = 장기 중단 의심 확정.
2. **`scripts/monitor-collectors.mjs` 점검 ⑤ `checkExternalApiStale`**(적용됨) — 대상 = `EXTERNAL_API_COLLECTORS`(`{ collector, stale_days, owner }`). 컬럼 진실의 원천은 `collector_runs.collector`(NOT phase, 값은 recordCollectorRun 의 PHASE 상수). 최근 `OUTAGE_MIN_CONSECUTIVE`=3회가 **모두 success + ok_count 0** 이고 가장 오래된 그 회차가 `stale_days` 를 넘으면 경보. failure 는 ①, 단발 0건은 ② 가 잡는다(중복 회피). 회차가 3 미만인 신규 collector 는 건너뜀.
3. **장기 중단 의심 시 4단계 의무**: ① raw API 호출 1회(`curl <endpoint>` — 500/503/타임아웃 확인) ② 공식 공지(data.go.kr / KOSIS / NEIS 의 "점검"·"장애") ③ 의심 확정 시 BACKLOG.md 에 "🟡 외부 API 사고 — <owner> <시작일>" 1줄 ④ 회복 판정 = 다음 monitor 에서 ok_count > 0 + 갱신 시간 < 7일.

## 적용 트리거

신규 외부 API 의존 collector 추가 시 의무:
1. `EXTERNAL_API_COLLECTORS` 배열에 entry 1줄 박힘 (phase / stale_days / owner)
2. monitor-collectors.mjs 점검 ⑤ 발화 확인
3. 첫 monitor 발화 1회 dry-run 답습

**stale_days 최종 기준 = 일일=14 / 주간=14 / 월간=38 / 분기=100**(전부 "발화주기 + 여유 1주기", cron yml grep 후 정한다). 진실의 원천 = `scripts/monitor-collectors.mjs` 의 `EXTERNAL_API_COLLECTORS` 배열 — drift 시 코드 우선.

## 안티 패턴 (사고 답습)

- ❌ "collector_runs 정상 = collector 정상" 단정 — 외부 API 500 응답 = ok_count 박힘 가능 (fetchWithRetry 종결 후 빈 응답 OK 처리)
- ❌ "1개월+ 침묵 = 자연 회복" 단정 — 외부 API 영구 폐기 가능 (예: KOSIS 통계표 ID 변경, 세션 222 박힘)
- ❌ "외부 API 사고 = 본인 책임 0" 단정 — 모니터 박힘 의무. silent fail 발견 1개월+ = 운영 사고
- ❌ "monitor-collectors.mjs 4개 카테고리로 충분" 단정 — 외부 API 장기 중단 = 5번째 카테고리 의무

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/workflows/external-api-outage-policy.md](../../rules-detail/workflows/external-api-outage-policy.md)
