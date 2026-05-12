-- 롤백용 마이그 — 20260513082108_add_applyhome_raw_response.sql 되돌리기
-- 영향 = applyhome_events.raw_response 컬럼 1건 + COMMENT 1건 제거.
-- apartments_flat VIEW 변경 0 (raw_response 노출 0) → VIEW 재마이그 의무 0.

ALTER TABLE applyhome_events DROP COLUMN IF EXISTS raw_response;
