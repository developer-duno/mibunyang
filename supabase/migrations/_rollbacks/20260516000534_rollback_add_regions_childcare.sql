-- ROLLBACK: regions.childcare JSONB 컬럼 제거 (세션 252 W6-D)
ALTER TABLE regions DROP COLUMN IF EXISTS childcare;
