-- regions 테이블에 fertility_rate REAL 신규 컬럼 추가
-- 출처: KOSIS DT_1B81A17 (orgId=101) "시군구/합계출산율 모의 연령별 출산율", itmId=T1, prdSe=A (연간)
-- 단위: 명/여성1명 (예: 0.721 = 전국 2023, 0.406 = 종로구 2023)
-- collect-fertility-rate.mjs 가 매월 9일 KST 05:30 UPDATE
-- 적재 단위: gu 있는 694행 시군구 단위 (KOSIS C1 5자리 시군구코드 매칭, 2자리 집계행 제외)

ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS fertility_rate REAL;

COMMENT ON COLUMN regions.fertility_rate IS
  'KOSIS DT_1B81A17 합계출산율 (명/여성1명, itmId=T1). 시군구 694행 UPDATE.';
