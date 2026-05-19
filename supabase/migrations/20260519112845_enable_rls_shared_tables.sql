-- 세션 274: 공유 테이블 3개(complexes/articles/complex_price_history) RLS 활성화.
-- 배경: Supabase Advisor "RLS Disabled in Public" — mibunyang 소유 3개는
-- 20260519111101 에서 해결, 본 마이그는 공유 테이블 3개.
--
-- ⚠️ complexes/articles 의 정책 이름·조건은 naver-estate-web 의
-- backend/db/migrations/V007__shared_columns.sql 정의를 그대로 답습 — 그 마이그가
-- live DB 에 적용되면 정책 이름이 동일해 CREATE 충돌. 그래서 본 마이그는 적용
-- 시점에 정책 부재를 precheck 로 확인 후 단발 적용. (V007 이 먼저 적용됐으면
-- 본 마이그는 skip — DROP POLICY IF EXISTS 로 재생성 금지, naver 의도 보존.)
--
-- articles: naver-estate-web 이 USING(is_active = true) 로 비활성 매물을 anon 에게
-- 숨기는 의도 — 그대로 답습. USING(true) 금지.
-- complex_price_history: naver V001 이 RLS 정책 미정의 → 가장 보수적으로 Public read
-- (anon 직접 읽기 0건, naver 백엔드는 service 연결이라 무영향).

-- complexes — V007 의 anon_read_complexes 답습
ALTER TABLE complexes ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_complexes ON complexes FOR SELECT USING (true);

-- articles — V007 의 anon_read_articles 답습 (is_active=true 숨김 의도 보존)
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_articles ON articles FOR SELECT USING (is_active = true);

-- complex_price_history — naver 미정의, 보수적 Public read
ALTER TABLE complex_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_complex_price_history ON complex_price_history FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';
