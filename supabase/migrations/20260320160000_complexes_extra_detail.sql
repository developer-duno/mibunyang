-- complexes 테이블에 추가 단지 상세 칼럼 (네이버 complexDetail 파싱)
ALTER TABLE complexes ADD COLUMN IF NOT EXISTS heat_fuel TEXT;
ALTER TABLE complexes ADD COLUMN IF NOT EXISTS corridor_type TEXT;
ALTER TABLE complexes ADD COLUMN IF NOT EXISTS building_coverage_ratio NUMERIC;

COMMENT ON COLUMN complexes.heat_fuel IS '난방연료 (도시가스/지역난방 등) — heatFuelTypeName';
COMMENT ON COLUMN complexes.corridor_type IS '복도유형 (계단식/복도식 등) — corridorTypeName';
COMMENT ON COLUMN complexes.building_coverage_ratio IS '건폐율 (%) — buildingCoverageRatio';
