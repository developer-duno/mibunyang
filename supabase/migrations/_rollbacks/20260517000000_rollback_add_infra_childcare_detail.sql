-- ROLLBACK: infra.childcare_detail JSONB 컬럼 제거 (세션 253 W6-D2)
ALTER TABLE infra DROP COLUMN IF EXISTS childcare_detail;
