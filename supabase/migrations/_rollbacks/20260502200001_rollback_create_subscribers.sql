-- Rollback: 20260502200000_create_subscribers.sql
-- 휴대폰 적재 데이터 모두 삭제됨. 운영 데이터 보존 시 백업 후 실행

DROP POLICY IF EXISTS "Service update" ON subscribers;
DROP POLICY IF EXISTS "Service read" ON subscribers;
DROP POLICY IF EXISTS "Anon insert" ON subscribers;
DROP INDEX IF EXISTS idx_subscribers_apt;
DROP INDEX IF EXISTS idx_subscribers_active;
DROP TABLE IF EXISTS subscribers;
