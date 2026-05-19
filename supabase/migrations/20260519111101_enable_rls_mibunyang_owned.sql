-- 세션 274: mibunyang 소유 3개 테이블 RLS 활성화.
-- 배경: Supabase Advisor "RLS Disabled in Public" 16개 경고 중 mibunyang 소유 3개 해소.
-- live DB 실측(supabase db query): api_quota_log·air_quality_stations RLS off,
-- collector_runs RLS on·정책0 (20260517020124 마이그가 ENABLE 까지만 부분 적용).
-- 공유 테이블 complexes/articles/complex_price_history 는 naver-estate-web V007/V001
-- 소유 — 본 마이그 제외 (그 레포가 mibunyang anon 읽기용 정책을 의도적으로 설계).
-- ROLLBACK: _rollbacks/20260519111101_rollback_enable_rls_mibunyang_owned.sql

-- api_quota_log: 수집기 write(service) + 관리자 페이지 read(anon)
ALTER TABLE api_quota_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON api_quota_log FOR SELECT USING (true);
CREATE POLICY "Service write" ON api_quota_log FOR ALL USING (auth.role() = 'service_role');

-- air_quality_stations: 수집기 write 전용 (양 프로젝트 anon read 0건 — grep 확정)
ALTER TABLE air_quality_stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service write" ON air_quality_stations FOR ALL USING (auth.role() = 'service_role');

-- collector_runs: 이미 RLS on(20260517020124). 정책만 누락 → anon SELECT 0행.
-- 관리자 페이지(collector-status.js anon read) 복구용 정책 추가.
CREATE POLICY "Public read" ON collector_runs FOR SELECT USING (true);
CREATE POLICY "Service write" ON collector_runs FOR ALL USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
