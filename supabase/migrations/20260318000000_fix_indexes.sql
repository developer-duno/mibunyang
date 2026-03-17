-- 인덱스 버그 수정 + apartments_flat VIEW 최적화
-- 1) complexes: latitude,longitude -> lat,lng (컬럼명 오류)
-- 2) articles: trade_type_name -> trade_type (컬럼명 오류)
-- 3) SC-1: regions 부분 인덱스 (gu IS NULL 필터 최적화)

-- 1. complexes 인덱스 컬럼명 수정
DROP INDEX IF EXISTS idx_complexes_location;
CREATE INDEX idx_complexes_location ON complexes(lat, lng);

-- 2. articles 인덱스 컬럼명 수정
DROP INDEX IF EXISTS idx_articles_complex;
CREATE INDEX idx_articles_complex ON articles(complex_no, trade_type, is_active);

-- 3. regions 시도 단위 부분 인덱스 (apartments_flat VIEW의 WHERE gu IS NULL 최적화)
CREATE INDEX IF NOT EXISTS idx_regions_sido_latest
  ON regions(region, recorded_at DESC) WHERE gu IS NULL;
