-- 역마이그: regions.crime_grade 컬럼 제거 (세션 243 W6-E 롤백)

ALTER TABLE regions DROP COLUMN IF EXISTS crime_grade;
