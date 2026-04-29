-- 시장통계 시계열 (KOSIS HUG, 5개 지표)
-- regions 테이블 5개 컬럼은 "최신값" 만 보존 (extractLatestByRegion + UPDATE)
-- → market_stats_history 는 동일 5지표를 시계열로 누적 (parseAllPeriodsByRegion + upsertBatch)
-- 세션134 unsold_history 패턴 미러링 (apartments_flat VIEW 미수정, 추가 자료)
CREATE TABLE IF NOT EXISTS market_stats_history (
  id SERIAL PRIMARY KEY,
  region TEXT NOT NULL,
  gu TEXT,                                -- NULL = 시도 레벨
  base_month TEXT NOT NULL,               -- 월간 "202603" / 분기 "20261" (KOSIS prdSe=Q 응답 5자리)
  price_index REAL,
  avg_price_sqm REAL,
  new_supply INTEGER,
  initial_sale_rate REAL,
  land_cost_ratio REAL,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(region, COALESCE(gu, ''), base_month)
);

CREATE INDEX IF NOT EXISTS idx_market_stats_history_region ON market_stats_history(region);
CREATE INDEX IF NOT EXISTS idx_market_stats_history_month ON market_stats_history(base_month);

ALTER TABLE market_stats_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON market_stats_history FOR SELECT USING (true);
CREATE POLICY "Service write" ON market_stats_history FOR ALL USING (auth.role() = 'service_role');

-- ROLLBACK 절차 (Dashboard SQL Editor 수동 실행)
-- DROP POLICY IF EXISTS "Service write" ON market_stats_history;
-- DROP POLICY IF EXISTS "Public read" ON market_stats_history;
-- DROP INDEX IF EXISTS idx_market_stats_history_month;
-- DROP INDEX IF EXISTS idx_market_stats_history_region;
-- DROP TABLE IF EXISTS market_stats_history;
