-- W1 역방향: regions.housing_supply_level 컬럼 제거
-- 주의: cross-repo (naver-estate-web) 자매 ORM/UI 사전 정정 의무

ALTER TABLE regions
  DROP COLUMN IF EXISTS housing_supply_level;
