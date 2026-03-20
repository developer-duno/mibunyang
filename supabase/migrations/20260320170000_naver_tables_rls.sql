-- 네이버 수집 테이블 RLS 설정
-- 20260317100000에서 naver_complexes DROP 후 complexes 재생성 시 RLS 누락 수정

-- complexes
ALTER TABLE complexes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON complexes;
CREATE POLICY "Public read" ON complexes FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service write" ON complexes;
CREATE POLICY "Service write" ON complexes FOR ALL USING (auth.role() = 'service_role');

-- articles
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON articles;
CREATE POLICY "Public read" ON articles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service write" ON articles;
CREATE POLICY "Service write" ON articles FOR ALL USING (auth.role() = 'service_role');

-- complex_price_history
ALTER TABLE complex_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON complex_price_history;
CREATE POLICY "Public read" ON complex_price_history FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service write" ON complex_price_history;
CREATE POLICY "Service write" ON complex_price_history FOR ALL USING (auth.role() = 'service_role');
