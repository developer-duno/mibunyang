# regions 멀티 collector 새-recorded_at-행 lag + VIEW latest CTE 최신행 함정

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

## 근본 원인 = 멀티 collector 새-recorded_at-행 lag

regions 를 여러 collector 가 나눠 채우는데:
1. **행 생성자 (population)**: 매월 새 recorded_at 행을 자기 소유 컬럼만 채워 INSERT.
2. **후행 채움자 (migration)**: 자기 컬럼을 UPDATE만 함. 자기 마지막 실행 시점에 존재한 행만 채움.
3. **VIEW (latest_regions)**: `DISTINCT ON (region) ORDER BY recorded_at DESC` = **최신 행 1개**만 봄.

후행 채움자가 행 생성자보다 늦게 cron 돌면(15일 > 5일), 그 사이 VIEW 가 보는 최신 행의 후행 컬럼이 NULL.
**`collector_runs` 는 정상(migration success), 데이터도 원본엔 있음 → silent fail. 사람 못 봄.**

## 정답 패턴 (답습 자산)

`collect-market-stats.mjs` L172-175 + L242-244 = **회귀 없는 정답**:
```js
const { data: regions } = await sb.from("regions").select("id, region, gu").is("gu", null); // 모든 시도 행
for (const reg of regions) {
  await sb.from("regions").update({ [col]: value }).eq("id", reg.id); // 모든 recorded_at 행 전수 UPDATE
}
```
→ market-stats(priceIndex 등 5컬럼)는 새 행 포함 모든 시도 행을 채워 **항상 100% 유지**. migration 도 같은
전략(recorded_at 무관 전체 UPDATE)이나 cron 이 늦어 새 행을 못 본 게 유일한 차이.

## 재발 방지 (3중 — 세션 391 적용)

### 1. VIEW 근본 수정 (B안, 적용 완료)
`supabase/migrations/20260609000000_view_regions_latest_nonnull.sql`: `latest_regions` CTE 를
`DISTINCT ON (region) 1행` → `GROUP BY region` + 컬럼별 최신 non-null 로 변경.
```sql
(array_agg(net_migration ORDER BY recorded_at DESC) FILTER (WHERE net_migration IS NOT NULL))[1] AS net_migration
```
각 컬럼이 가장 최근 채워진 값을 독립적으로 가져옴 → 새 행에 일부 컬럼 빠져도 옛 값 가져와 NULL 0.
⚠️ DROP+CREATE 라 `WITH (security_invoker = on)` CREATE 에 직접 명시 (날아감 방지).

### 2. cron 정렬 (A안, 적용 완료)
`collect-migration.yml` cron `0 22 15 * *` → `0 22 6 * *` (population 5일 다음날). 공백 ~10일→~1일 축소.
B안이 근본 해소라 A안은 보조 안전망. KOSIS_MIGRATION_KEY = MOLIT_KEY 와 별 키라 6일 쿼터 충돌 0.
세션 289: `collect-migration.yml` 삭제 (kosis.kr 해외 IP 차단 → 로컬 러너 이전) — migration 은
`kosis-local-runner.mjs` day 7 (05:30 KST) 디스패치로 population (KST 6일 05:00 발화) 다음날 유지, 선후행 보존.

### 3. 회귀가드 monitor (적용 완료)
`monitor-collectors.mjs` ⑥ `checkViewRegionStale()` + `VIEW_REGION_STALE_TARGETS`: "regions 원본 ≥20% 채움인데
apartments_flat VIEW ≤5%" = 회귀 신호 텔레그램 알림. 추가 쿼리 0 (audit.fields + fetchRegionColumnStats 재사용).

## 신규 multi-collector regions 컬럼 추가 시 (의무)

regions 에 새 컬럼을 추가하고 VIEW 가 노출하면 다음 grep 의무:
1. **VIEW 가 그 컬럼 노출하나?** — `grep <col> supabase/migrations/<최신 view>.sql` (latest_regions SELECT)
2. **새 recorded_at 행을 채우는 collector 있나?** — population 이 그 행을 만들 때 새 컬럼이 INSERT 에 빠지면
   후행 collector 가 전수 UPDATE(`.is("gu",null)` 모든 행, market-stats 식)인지 확인. UPDATE-only 면 cron 순서 확인.
3. **VIEW latest_regions 가 컬럼별 최신 non-null 인가?** — `array_agg ... FILTER` 패턴이면 안전, `DISTINCT ON` 1행이면 lag 위험.
4. **monitor ⑥ 등재** — `VIEW_REGION_STALE_TARGETS` 에 1줄 + `REGION_KEY_COLUMNS` 에 regionColumn 추가.

## 안티 패턴 (사고 답습)

- ❌ "collector_runs 정상 = 데이터 정상" — VIEW 가 최신 행 NULL 노출하면 원본 채움도 silent fail
- ❌ "VIEW latest CTE 는 DISTINCT ON 1행이 자연스럽다" — 멀티 collector 가 행을 시점차로 채우면 최신 행 일부 NULL
- ❌ "cron 순서만 맞추면 재발 0" — 적대검증 정정: A안은 공백 축소(≤1일), 완전 0 은 B안(컬럼별 최신 non-null)만
- ❌ "data-audit 0% = 외부 API 사고" — 원본 vs VIEW 교차로 "원본 있음+VIEW 없음" 회귀 vs "원본 부재" 구분 의무
  (supply_ratio 0% = 원본 부재 MOLIT 사고 = 별개 / netMigration 0% = VIEW lag 회귀)
- ❌ "VIEW DROP+CREATE 하면 security_invoker 유지" — ALTER 로 켠 옵션은 DROP 시 날아감, CREATE 에 명시 의무

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
