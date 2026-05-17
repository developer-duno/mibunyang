-- regions 테이블에 의료 인프라 2컬럼 추가
-- 출처: KOSIS DT_1YL20981 (의사수) + DT_1YL20971 (병상수), orgId=101, itmId=T10, prdSe=A
-- 단위: 명/개 per 인구 1000명 (예: 3.2 = 전국 의사, 13.8 = 전국 병상)
-- collect-medical-access.mjs 가 매월 13일 KST 05:30 UPDATE
-- 적재 단위: gu 있는 시군구 행 (KOSIS C1 5자리 시군구코드 매칭, 2자리 집계행 제외)

ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS doctors_per_1k REAL,
  ADD COLUMN IF NOT EXISTS hospital_beds_per_1k REAL;

COMMENT ON COLUMN regions.doctors_per_1k IS
  'KOSIS DT_1YL20981 인구 천명당 의료기관 종사 의사수 (itmId=T10). 시군구 UPDATE.';
COMMENT ON COLUMN regions.hospital_beds_per_1k IS
  'KOSIS DT_1YL20971 인구 천명당 의료기관 병상수 (itmId=T10). 시군구 UPDATE.';
