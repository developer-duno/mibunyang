-- 롤백: 20260704000000_create_monitor_daily_snapshot.sql
-- 브리핑 일별 스냅샷 이력이 사라진다 (어제 대비 계산 불가) — 실행 전 백업 확인.

DROP TABLE IF EXISTS monitor_daily_snapshot;
