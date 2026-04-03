-- infra 테이블에 경찰서/파출소 밀도 컬럼 추가
-- 롤백: ALTER TABLE infra DROP COLUMN IF EXISTS police, DROP COLUMN IF EXISTS police_dist;

ALTER TABLE infra ADD COLUMN IF NOT EXISTS police INTEGER DEFAULT 0;
ALTER TABLE infra ADD COLUMN IF NOT EXISTS police_dist REAL;
