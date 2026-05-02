-- Rollback: 20260502210000_harden_subscribers_uniqueness.sql
-- Restores the original nullable UNIQUE constraint shape.

DROP INDEX IF EXISTS idx_subscribers_unique_scope;

ALTER TABLE subscribers
  DROP COLUMN IF EXISTS apartment_key,
  DROP COLUMN IF EXISTS gu_key,
  DROP COLUMN IF EXISTS region_key;

ALTER TABLE subscribers
  ADD CONSTRAINT subscribers_phone_region_gu_apartment_id_key
  UNIQUE (phone, region, gu, apartment_id);
