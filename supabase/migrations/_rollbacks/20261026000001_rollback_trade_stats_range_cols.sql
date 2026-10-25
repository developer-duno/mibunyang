-- ROLLBACK: 20261026000000_trade_stats_range_cols.sql
--
-- trade_stats 실거래 범위 4칸(cmp_min · cmp_max · complex_jeonse_min · complex_jeonse_max)을 지운다.
-- ⚠️ 순서(설계서 §7 — 역순, 하나라도 어긋나면 다음 trade-stats 회차 upsert 가 통째로 실패한다):
--   1) 화면 코드 되돌림 → 2) 값 NULL(선택) → 3) VIEW 되돌림(_rollbacks/20261026000003 — VIEW 가 이 칸을 읽는 동안은
--   DROP COLUMN 이 의존 때문에 실패한다) → 4) **수집기 코드 되돌림**(scripts/collectors/trade-stats.mjs SCOPE_COLS 18 → 14,
--   _trade-scope.mjs computeScopeStats 의 cmp_min/max·complex_jeonse_min/max 도 함께)이 합쳐진 뒤 → 5) 이 파일.
--   칸을 먼저 지우면 다음 trade-stats 회차의 upsert 전체가 실패한다(PGRST204 — 없는 칸).
--   2u 가 이 칸을 읽고 있으면 2u 쪽 조회에서도 먼저 빼 달라고 알린다.
-- 칸을 지워도 원본은 잃지 않는다(다시 칸을 만들면 다음 trade-stats 회차가 trade_deals 에서 다시 계산한다).

SET lock_timeout = '5s';

ALTER TABLE trade_stats
  DROP COLUMN IF EXISTS cmp_min,
  DROP COLUMN IF EXISTS cmp_max,
  DROP COLUMN IF EXISTS complex_jeonse_min,
  DROP COLUMN IF EXISTS complex_jeonse_max;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
