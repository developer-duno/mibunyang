-- regions.sex_age JSONB 신규 컬럼 추가 (세션 242 W6-A)
-- data.go.kr 15108074 (행정안전부_법정동별 성/연령별 주민등록 인구수) 응답 raw 보존.
-- endpoint: apis.data.go.kr/1741000/stdgSexdAgePpltn/selectStdgSexdAgePpltn
-- 응답 필드: 시도/시군구/법정동/리/행정기관코드/행정동/통/반/총인구/남/여 + 만0~9세~만100세이상 (남/여 각 11그룹).
-- 미래 차원 분석용 (성별/연령대별 인구 분포). 기존 population/pop_growth/households 컬럼 보존.
-- ROLLBACK: _rollbacks/20260513061503_rollback_add_regions_sex_age.sql

ALTER TABLE regions ADD COLUMN IF NOT EXISTS sex_age JSONB DEFAULT NULL;

COMMENT ON COLUMN regions.sex_age IS '행안부 15108074 성/연령별 주민등록 인구수 raw 보존 (남/여 × 만0~9세~만100세이상 11그룹). 미래 분석용.';
