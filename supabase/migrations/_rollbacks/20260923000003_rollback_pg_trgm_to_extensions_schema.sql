-- ROLLBACK: 20260923000002_pg_trgm_to_extensions_schema.sql (세션566)
--
-- 되돌리면 보안 고문 경고 0014(Extension in Public)가 재발한다. 색인은 어느 쪽이든 동작한다.
--
-- ⚠️ 적용 방법: Supabase Dashboard SQL Editor 수동 실행.

ALTER EXTENSION pg_trgm SET SCHEMA public;
