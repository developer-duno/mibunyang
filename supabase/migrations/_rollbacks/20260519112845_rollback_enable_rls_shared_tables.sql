-- 세션 274 공유 테이블 RLS 활성화 롤백 (20260519112845_enable_rls_shared_tables.sql 역방향).

ALTER TABLE complexes DISABLE ROW LEVEL SECURITY;
ALTER TABLE articles DISABLE ROW LEVEL SECURITY;
ALTER TABLE complex_price_history DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_complexes ON complexes;
DROP POLICY IF EXISTS anon_read_articles ON articles;
DROP POLICY IF EXISTS anon_read_complex_price_history ON complex_price_history;

NOTIFY pgrst, 'reload schema';
