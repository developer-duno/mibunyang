-- regions 테이블에 시도 경제·교육 지표 4컬럼 추가
-- 출처: KOSIS INH_1C96_02(1인당 GRDP)/DT_1PE105(사교육비)/DT_1PE107(사교육참여율)/DT_1DA7104S(실업률), orgId=101
-- 단위: grdp_per_capita 천원 / education_cost 만원 / education_participation % / unemployment_rate %
-- collect-regional-economy.mjs 가 매월 11일 KST 05:30 UPDATE
-- 적재 단위: gu IS NULL 시도 행 (KOSIS C1 2자리 코드 → KOSIS_SIDO 매칭, 전국 C1='00' 제외)

ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS grdp_per_capita REAL,
  ADD COLUMN IF NOT EXISTS education_cost REAL,
  ADD COLUMN IF NOT EXISTS education_participation REAL,
  ADD COLUMN IF NOT EXISTS unemployment_rate REAL;

COMMENT ON COLUMN regions.grdp_per_capita IS
  'KOSIS INH_1C96_02 1인당 지역내총생산(천원). 시도 행 UPDATE.';
COMMENT ON COLUMN regions.education_cost IS
  'KOSIS DT_1PE105 1인당 월평균 사교육비(만원, ITM_ID=T00). 시도 행 UPDATE.';
COMMENT ON COLUMN regions.education_participation IS
  'KOSIS DT_1PE107 사교육 참여율(%, ITM_ID=T00). 시도 행 UPDATE.';
COMMENT ON COLUMN regions.unemployment_rate IS
  'KOSIS DT_1DA7104S 실업률(%, prdSe=Y, C2=0 성별 계). 시도 행 UPDATE.';
