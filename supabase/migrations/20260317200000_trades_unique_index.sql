-- trades 테이블 upsert용 unique constraint
-- 동일 거래(지역+월+면적+가격+층+유형) 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_unique
ON trades(region, gu, deal_month, area, price, floor, trade_type);
