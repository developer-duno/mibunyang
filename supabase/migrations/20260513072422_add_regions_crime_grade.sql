-- regions.crime_grade SMALLINT 신규 컬럼 추가 (세션 243 W6-E)
-- data.go.kr 15069240 (행안부 지역안전지수) CSV → 시군구별 범죄 안전등급(1~5) → regions.crime_grade
-- 기존 apartments.crime_safety_grade (단지 단위) 와 별도. regions 단위 (시도+시군구) 분석용.
-- ROLLBACK: _rollbacks/20260513072422_rollback_add_regions_crime_grade.sql

ALTER TABLE regions ADD COLUMN IF NOT EXISTS crime_grade SMALLINT DEFAULT NULL;

COMMENT ON COLUMN regions.crime_grade IS '행안부 15069240 지역안전지수 범죄 등급 (1=최안전~5=최위험, null=미수집). 시군구 단위.';
