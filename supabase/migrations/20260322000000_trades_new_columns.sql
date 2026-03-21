-- trades 테이블에 AptTradeDev + SilvTrade 필드 추가
-- 기존 282K 데이터는 NULL로 유지 (호환성 보장)

ALTER TABLE trades ADD COLUMN IF NOT EXISTS apt_name TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS cancel_date TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS dealing_type TEXT;

-- 해제거래 필터링용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_trades_cancel ON trades(cancel_date) WHERE cancel_date IS NOT NULL;
