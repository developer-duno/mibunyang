-- 역방향: regions.fertility_rate 컬럼 제거
-- 주의: cross-repo (naver-estate-web) 자매 ORM/UI 사전 정정 의무

ALTER TABLE regions
  DROP COLUMN IF EXISTS fertility_rate;
