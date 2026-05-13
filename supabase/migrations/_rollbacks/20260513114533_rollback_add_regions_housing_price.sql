-- ROLLBACK: 20260513114533_add_regions_housing_price.sql
-- regions.housing_price SMALLINT 컬럼 제거.

ALTER TABLE regions DROP COLUMN IF EXISTS housing_price;
