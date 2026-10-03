-- ROLLBACK: 20261004000000_trade_links_and_scope_stats.sql
--
-- 되돌리는 순서 — 정책 → 인덱스 → 표 → trade_stats 새 칸(IF EXISTS 라 어느 순서로 돌려도 에러가 나지 않는다).
--
-- 새 표와 새 칸은 다) 점수 PR 전까지 아무도 읽지 않는다(VIEW 무변경) — 되돌려도 화면·2u 영향 0.
-- 다만 이미 머지된 assign-trade-links.mjs 는 표 없음으로 쓰기 실행이 실패(LINK_NO_TABLE)하고,
-- trade-stats.mjs 는 연결 표 조회 실패로 새 칸만 건너뛴다(WARN_STEPS: scope_skipped) — 새 칸을 지운 뒤에도
-- trade-stats 가 새 칸을 넣으려 하면 upsert 가 실패하므로 **수집기 배선을 되돌리는 PR 과 함께** 적용할 것.
DROP POLICY IF EXISTS "Service write" ON apartment_trade_links;
DROP INDEX IF EXISTS idx_trade_links_key;
DROP INDEX IF EXISTS idx_trade_links_status;
DROP TABLE IF EXISTS apartment_trade_links;

ALTER TABLE trade_stats DROP COLUMN IF EXISTS cmp_scope;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS cmp_fair_price;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS cmp_n;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS cmp_months;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS cmp_area_mode;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS cmp_src;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS complex_jeonse_rate;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS complex_jeonse_n;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS complex_sale_n;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS complex_table;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS complex_jeonse_table;
ALTER TABLE trade_stats DROP COLUMN IF EXISTS dong_fact;

NOTIFY pgrst, 'reload schema';
