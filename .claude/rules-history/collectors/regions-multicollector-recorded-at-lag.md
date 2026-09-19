# regions 멀티 collector 새-recorded_at-행 lag + VIEW latest CTE 최신행 함정 — 이력 (자동 로드 안 됨)

규칙 본문은 `.claude/rules/collectors/regions-multicollector-recorded-at-lag.md`. 이 파일은 그 규칙이 생긴 사건·수치·답습 자산 기록이며 세션에 자동으로 실리지 않는다.

## 사고 박제 (세션 391)

`data-audit.mjs --json` 전수 재측정(2026-06-09)서 **apartments_flat VIEW `netMigration` 0% (17 시도 NULL)** 발견.
5/31 측정 100%였던 **silent 데이터 회귀**. regions **원본**엔 net_migration 700행 채워짐.

라이브 실측 진앙:
- regions 시도행: `2026-04-01`(VIEW 최신) pg=17 **nm=0**; `2026-03-20`(migration 마지막 채움) nm=17.
- `population.mjs` L264-300: `pop_growth/population/households`만 UPDATE, 행 없으면 그 3컬럼만 INSERT
  (net_migration **빠짐**). recorded_at = 데이터기준월 "YYYY-MM-01". cron **매월 5일**.
- `migration.mjs` L259-275: net_migration을 recorded_at **무관** region+gu 전체 UPDATE (INSERT 안 함). cron **매월 15일**.
- VIEW `latest_regions` CTE = `DISTINCT ON (region) ... ORDER BY recorded_at DESC` = region별 **최신 행 1개**에서 9컬럼.

타임라인: 5/24 migration이 3-20행 채움(5/31 측정 100%) → 6/5 population이 새 04-01 행을 nm 없이 생성 →
migration은 6/15에야 실행 → **매월 5~15일 10일간 VIEW netMigration 0%**.

영향: `scoreFuture.ts` L69-70 `netMigration>0 → popSc+10` 보정 17개 시도 전부 미발동 → 인구 유입 지역
808단지(56.7%) 미래가치 silent -10점 + 화면 "순이동 미수집" 거짓 표시.

## 답습 자산

- 세션 391 본 사고 박제 + B안 마이그(20260609000000) + A안 cron + monitor ⑥ + 본 룰
- `collect-market-stats.mjs` L172-175/L242-244 = 새 행 전수 UPDATE 정답 패턴
- `scripts/monitor-collectors.mjs` `checkViewRegionStale` + `monitor-collectors.test.mjs` 6 케이스
- 세션 379/386 "VIEW 는 별도 테이블 JOIN camelCase 노출" 의 시계열(recorded_at) 버전

## 차단 검증 (본 룰 적용 후 사고 시뮬레이션)

| 사고 시나리오 | 본 룰 적용 시 |
|---|---|
| 새 multi-collector regions 컬럼이 VIEW 노출 + 후행 cron 늦음 | §"신규 컬럼 추가 시" 4 grep 의무 → DISTINCT ON 1행 lag 발견 |
| population 새 행이 net_migration NULL → VIEW 0% | B안 array_agg FILTER 컬럼별 최신 non-null → 옛 값 가져옴 |
| VIEW 원본 채움 but NULL 노출 silent fail | monitor ⑥ checkViewRegionStale 텔레그램 알림 |
| VIEW DROP+CREATE 시 security_invoker 누락 | §재발방지 1 ⚠️ + 본 룰 안티패턴 → CREATE WITH (security_invoker=on) |
