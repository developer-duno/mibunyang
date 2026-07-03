-- 롤백: 20260703000000_create_notification_logs.sql
-- 발송 이력이 있는 상태에서 실행하면 감사 로그가 사라진다 — 실행 전 백업 확인.

DROP TABLE IF EXISTS notification_logs;
