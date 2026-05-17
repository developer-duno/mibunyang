-- 역방향: regions 의료 2컬럼 제거
-- 주의: cross-repo (naver-estate-web) 자매 ORM/UI 사전 정정 의무

ALTER TABLE regions
  DROP COLUMN IF EXISTS doctors_per_1k,
  DROP COLUMN IF EXISTS hospital_beds_per_1k;
