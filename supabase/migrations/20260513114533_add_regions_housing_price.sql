-- regions.housing_price SMALLINT 신규 컬럼 추가 (세션 245 W6-C)
-- data.go.kr 15045153 (MOLIT 공동주택공시가격) → 시군구별 평균 공시가격 (만원/㎡) → regions.housing_price
-- 정부 산정 공식 가치평가. 미분양 단지 "정상가" 판정 보조 지표. PSR sub-score 입력 영향 0 (단순 데이터 채움 단계).
-- ROLLBACK: _rollbacks/20260513114533_rollback_add_regions_housing_price.sql

ALTER TABLE regions ADD COLUMN IF NOT EXISTS housing_price SMALLINT DEFAULT NULL;

COMMENT ON COLUMN regions.housing_price IS 'MOLIT 15045153 공동주택공시가격 시군구 평균 (만원/㎡, null=미수집). 정부 산정 공식 가치평가.';
