-- Harden subscriber uniqueness across nullable scope columns.
-- Generated keys preserve the nullable public contract while making NULL scopes
-- participate in a single uniqueness domain for upsert/onConflict.

ALTER TABLE subscribers
  DROP CONSTRAINT IF EXISTS subscribers_phone_region_gu_apartment_id_key;

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS region_key TEXT
    GENERATED ALWAYS AS (COALESCE(region, '')) STORED,
  ADD COLUMN IF NOT EXISTS gu_key TEXT
    GENERATED ALWAYS AS (COALESCE(gu, '')) STORED,
  ADD COLUMN IF NOT EXISTS apartment_key TEXT
    GENERATED ALWAYS AS (COALESCE(apartment_id, '')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_unique_scope
  ON subscribers(phone, region_key, gu_key, apartment_key);

COMMENT ON COLUMN subscribers.region_key IS 'Generated uniqueness key for nullable region.';
COMMENT ON COLUMN subscribers.gu_key IS 'Generated uniqueness key for nullable gu.';
COMMENT ON COLUMN subscribers.apartment_key IS 'Generated uniqueness key for nullable apartment_id.';
