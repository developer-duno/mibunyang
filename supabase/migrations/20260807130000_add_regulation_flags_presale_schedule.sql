-- 청약홈 Detail(getAPTLttotPblancDetail) 규제 지정 7종 저장
-- 기존엔 API 응답에 있어도 buildScheduleRow 가 안 읽어 전부 폐기되던 값.
-- 값 형태: raw API 1000행 표본 실측 결과 7필드 전부 문자열 "Y" 또는 "N" 두 가지뿐
-- (다른 코드값·null 없음) → BOOLEAN 이 손실 없는 최소 타입. 미응답 대비 NOT NULL 은 안 검.
-- 적용은 Dashboard SQL Editor 수동 실행이 표준 (supabase/CLAUDE.md "마이그레이션 적용").
-- BEGIN/COMMIT 사용 안 함 (기존 컬럼 추가 마이그 패턴, Supabase 자동 적용).

ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS adjustment_target_area BOOLEAN;
ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS price_cap_applied BOOLEAN;
ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS speculation_overheated BOOLEAN;
ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS redevelopment_biz BOOLEAN;
ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS public_housing_district BOOLEAN;
ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS large_scale_district BOOLEAN;
ALTER TABLE presale_schedule_official ADD COLUMN IF NOT EXISTS metro_private_public_housing BOOLEAN;

COMMENT ON COLUMN presale_schedule_official.adjustment_target_area IS 'MDAT_TRGET_AREA_SECD 조정대상지역 (Y/N → boolean). 표본 1000행 Y 4.3%';
COMMENT ON COLUMN presale_schedule_official.price_cap_applied IS 'PARCPRC_ULS_AT 분양가상한제 적용 (Y/N → boolean). 표본 1000행 Y 26.5%';
COMMENT ON COLUMN presale_schedule_official.speculation_overheated IS 'SPECLT_RDN_EARTH_AT 투기과열지구 (Y/N → boolean). 표본 1000행 Y 4.3%';
COMMENT ON COLUMN presale_schedule_official.redevelopment_biz IS 'IMPRMN_BSNS_AT 정비사업 (Y/N → boolean). 표본 1000행 Y 16.1%';
COMMENT ON COLUMN presale_schedule_official.public_housing_district IS 'PUBLIC_HOUSE_EARTH_AT 공공주택지구 (Y/N → boolean). 표본 1000행 Y 10.7%';
COMMENT ON COLUMN presale_schedule_official.large_scale_district IS 'LRSCL_BLDLND_AT 대규모 택지개발지구 (Y/N → boolean). 표본 1000행 Y 15.9%';
COMMENT ON COLUMN presale_schedule_official.metro_private_public_housing IS 'NPLN_PRVOPR_PUBLIC_HOUSE_AT 수도권 민영 공공택지 (Y/N → boolean). 표본 1000행 Y 2.3%';

NOTIFY pgrst, 'reload schema';
