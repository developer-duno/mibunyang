-- infra.childcare_detail JSONB 신규 컬럼 추가 (세션 253 W6-D2 옵션 δ)
-- 보육정보공개 API cpmsapi030 (어린이집별 기본정보 조회) 70 필드 단지별 5건 박제.
-- endpoint: http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request?key=<KEY>&arcode=<5자>&stcode=<11자>
-- 응답 필드 70 (실 API 1회 호출 박제, 2026-05-16):
--   위치 6: la / lo / sidoname / sigunname / zipcode / craddr
--   기본 8: stcode / crname / crtypename / crstatusname / crtelno / crfaxno / crhome / crrepname
--   시설 6: nrtrroomcnt(보육실수) / nrtrroomsize(면적) / plgrdco(놀이터) / cctvinstlcnt(CCTV) / chcrtescnt / crcargbname
--   정원/현원 2: crcapat / crchcnt
--   일자 6: crcnfmdt(인가) / crpausebegindt / crpauseenddt / crabldt / datastdrdt / crspec
--   CLASS_CNT 11: 00~05 + M2/M3/M5/SP/TOT (연령대별 반수)
--   CHILD_CNT 11: 00~05 + M2/M3/M5/SP/TOT (연령대별 아동수)
--   EM_CNT 15:    0Y/1Y/2Y/4Y/6Y/A1~A10/TOT (자격별 교직원수)
--   EW_CNT 8:     00~05 + M6/TOT (연령대별 입소대기)
-- 보존 정책 (사용자 확정 2026-05-16): 옵션 B-γ = 70 필드 raw 전체 × 5건 = 350 필드 JSONB 박제 (데이터 최대한 활용)
-- 의미 단위: 단지별 도보권 1km 어린이집 5건 상세 (옵션 C-γ' Kakao 재호출 매칭).
-- 응답 사고: 응답 값 01~70 = 운영 모드 정상 응답 (사용자 확정, sample placeholder 환각 폐기).
-- 시군구 집계 regions.childcare (cpmsapi021, 세션 252) 와 의미 단위 다름.
-- ROLLBACK: _rollbacks/20260517000000_rollback_add_infra_childcare_detail.sql

ALTER TABLE infra ADD COLUMN IF NOT EXISTS childcare_detail JSONB DEFAULT NULL;

COMMENT ON COLUMN infra.childcare_detail IS '보육정보공개 cpmsapi030 단지별 도보권 1km 어린이집 5건 상세 (facilities[5] × 70 raw 필드 + fetched_at). 위치/기본/시설/정원/현원/일자 + CLASS_CNT 11 (연령별 반수) + CHILD_CNT 11 (연령별 아동수) + EM_CNT 15 (자격별 교직원수) + EW_CNT 8 (연령별 입소대기) raw 보존. regions.childcare (cpmsapi021 시군구 집계 7필드) 와 의미 단위 다름.';
