-- complexes 테이블에 단지 상세 칼럼 추가 (네이버 상세 API 파싱용)
ALTER TABLE complexes ADD COLUMN IF NOT EXISTS earthquake_design BOOLEAN;
ALTER TABLE complexes ADD COLUMN IF NOT EXISTS entrance_type TEXT;
ALTER TABLE complexes ADD COLUMN IF NOT EXISTS heat_method TEXT;
