-- apartments 테이블에 대기질 JSONB 컬럼 추가
-- 구조: {"pm10": 45, "pm25": 22, "grade": "보통", "station": "종로구", "collected_at": "2026-04-01"}
-- 롤백: ALTER TABLE apartments DROP COLUMN IF EXISTS air_quality;

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS air_quality JSONB;
