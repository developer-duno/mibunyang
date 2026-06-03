-- rollback: monitor_alert_state 테이블 제거.
-- 적용 = 20260603120000_create_monitor_alert_state.sql 역방향.
DROP TABLE IF EXISTS monitor_alert_state;
