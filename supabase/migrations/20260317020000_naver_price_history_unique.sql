-- naver_price_history에 upsert를 위한 unique constraint 추가
ALTER TABLE naver_price_history
  ADD CONSTRAINT naver_price_history_uq
  UNIQUE (complex_no, trade_type, area_no, base_month);
