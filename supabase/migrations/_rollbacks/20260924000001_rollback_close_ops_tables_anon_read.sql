-- ROLLBACK for 20260924000000_close_ops_tables_anon_read.sql
-- 되돌리면 운영 표 4개가 다시 공개 읽기로 열린다 — 관리자 API 도 함께 anon 으로 되돌려야
-- 앞뒤가 맞는다(그럴 계획이면 api/admin/collector-status.ts 도 같이 되돌릴 것).

GRANT SELECT ON collector_runs TO anon, authenticated;
GRANT SELECT ON api_quota_log TO anon, authenticated;
GRANT SELECT ON monitor_alert_state TO anon, authenticated;
GRANT SELECT ON monitor_daily_snapshot TO anon, authenticated;

CREATE POLICY "Public read" ON collector_runs FOR SELECT USING (true);
CREATE POLICY "Public read" ON api_quota_log FOR SELECT USING (true);
CREATE POLICY "Public read" ON monitor_alert_state FOR SELECT USING (true);
CREATE POLICY "Public read" ON monitor_daily_snapshot FOR SELECT USING (true);
