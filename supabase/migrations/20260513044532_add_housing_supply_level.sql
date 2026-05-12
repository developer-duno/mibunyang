-- W1: regions 테이블에 housing_supply_level REAL 신규 컬럼 추가
-- 출처: KOSIS DT_MLTM_2100 (新)주택보급률, ITM_NM='보급률(다가구 구분거처 반영)', 시도 17행
-- 단위: % (예: 93.6% = 가구수 대비 주택수 비율, 다가구 구분거처 반영)
-- collect-housing-supply-ratio.mjs 가 매월 1일 KST 05:30 UPDATE
-- supply_ratio (housing-permits 의 연간 인허가 증가율, %) 와 의미 분리 — cross-repo 6 사용처 보존

ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS housing_supply_level REAL;

COMMENT ON COLUMN regions.housing_supply_level IS
  'KOSIS DT_MLTM_2100 주택보급률 (%, 다가구 구분거처 반영). gu IS NULL 17행만 UPDATE. supply_ratio (인허가 증가율) 와 의미 분리.';
