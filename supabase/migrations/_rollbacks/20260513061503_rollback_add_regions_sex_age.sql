-- 역마이그: regions.sex_age 컬럼 제거 (세션 242 W6-A 롤백)

ALTER TABLE regions DROP COLUMN IF EXISTS sex_age;
