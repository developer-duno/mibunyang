-- infra 테이블에 어린이집/유치원 + 응급의료기관 컬럼 추가
-- 롤백: ALTER TABLE infra DROP COLUMN IF EXISTS childcare, DROP COLUMN IF EXISTS childcare_dist,
--       DROP COLUMN IF EXISTS emergency, DROP COLUMN IF EXISTS emergency_dist;

ALTER TABLE infra ADD COLUMN IF NOT EXISTS childcare INTEGER DEFAULT 0;
ALTER TABLE infra ADD COLUMN IF NOT EXISTS childcare_dist REAL;
ALTER TABLE infra ADD COLUMN IF NOT EXISTS emergency INTEGER DEFAULT 0;
ALTER TABLE infra ADD COLUMN IF NOT EXISTS emergency_dist REAL;
