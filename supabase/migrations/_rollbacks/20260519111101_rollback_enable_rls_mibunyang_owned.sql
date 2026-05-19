-- 세션 274 RLS 활성화 롤백 (20260519111101_enable_rls_mibunyang_owned.sql 역방향).
-- collector_runs 는 RLS 를 끄지 않음 — 원래 RLS on(20260517020124) 상태였고 본 작업은
-- 정책만 추가했음. 롤백 시 정책만 제거.

ALTER TABLE api_quota_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE air_quality_stations DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON api_quota_log;
DROP POLICY IF EXISTS "Service write" ON api_quota_log;
DROP POLICY IF EXISTS "Service write" ON air_quality_stations;
DROP POLICY IF EXISTS "Public read" ON collector_runs;
DROP POLICY IF EXISTS "Service write" ON collector_runs;

NOTIFY pgrst, 'reload schema';
