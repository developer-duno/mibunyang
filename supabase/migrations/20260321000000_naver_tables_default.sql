-- 네이버 테이블 NOT NULL 컬럼에 DEFAULT 추가 (naver-collect.py upsert 호환)

-- complexes
ALTER TABLE complexes ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE complexes ALTER COLUMN updated_at SET DEFAULT NOW();

-- articles
ALTER TABLE articles ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE articles ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE articles ALTER COLUMN is_verified SET DEFAULT false;
ALTER TABLE articles ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE articles ALTER COLUMN is_presale SET DEFAULT false;
ALTER TABLE articles ALTER COLUMN detail_crawled SET DEFAULT false;
ALTER TABLE articles ALTER COLUMN first_seen_at SET DEFAULT NOW();
ALTER TABLE articles ALTER COLUMN last_seen_at SET DEFAULT NOW();

-- complex_price_history: upsert용 unique constraint
ALTER TABLE complex_price_history ALTER COLUMN recorded_at SET DEFAULT NOW();
ALTER TABLE complex_price_history
  ADD CONSTRAINT IF NOT EXISTS complex_price_history_upsert_key
  UNIQUE (complex_no, trade_type, area_no, base_month);
