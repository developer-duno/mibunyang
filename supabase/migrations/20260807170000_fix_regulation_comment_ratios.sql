-- 규제 7종 컬럼 주석의 Y 비율 정정 (20260807130000 이 박은 값이 편향 표본이었음).
--
-- 사고: 앞선 마이그의 "표본 1000행 Y N%" 는 청약홈 API 의 **첫 페이지 1,000행만** 센 값이었다.
--   첫 페이지가 특정 시기 공고에 몰려 있어 조정대상지역·투기과열지구가 크게 과소 표기됐다
--   (조정대상지역 4.3% → 실제 25.9%, 약 6배). 설계문서 부록 B 의 비율도 같은 표본이라 동일 편향.
--   "네 곳 중 한 곳"을 "스물다섯 곳 중 한 곳"으로 읽으면 화면 노출 여부 판단이 뒤집힌다.
--
-- 정정: 2026-08-07 getAPTLttotPblancDetail **전량 2,837건**(3페이지 전부) 실측값으로 교체.
--   같은 실측에서 7필드 전부 값이 "Y"/"N" 두 가지뿐임도 전량 기준으로 재확인(다른 코드값·null 0건)
--   → BOOLEAN 선택 근거가 첫 페이지가 아니라 모집단에서 성립함.
--
-- 스키마 변경 0 (COMMENT 만 교체). 데이터·컬럼·타입 전부 그대로라 롤백 파일은 두지 않는다
--   — 되돌린다는 건 틀린 숫자를 복원한다는 뜻이라 안전 가치가 없다(누락 아님).
-- 적용은 Dashboard SQL Editor 수동 실행이 표준 (supabase/CLAUDE.md "마이그레이션 적용").

COMMENT ON COLUMN presale_schedule_official.adjustment_target_area IS 'MDAT_TRGET_AREA_SECD 조정대상지역 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 735건 = 25.9%';
COMMENT ON COLUMN presale_schedule_official.price_cap_applied IS 'PARCPRC_ULS_AT 분양가상한제 적용 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 732건 = 25.8%';
COMMENT ON COLUMN presale_schedule_official.speculation_overheated IS 'SPECLT_RDN_EARTH_AT 투기과열지구 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 306건 = 10.8%';
COMMENT ON COLUMN presale_schedule_official.redevelopment_biz IS 'IMPRMN_BSNS_AT 정비사업 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 393건 = 13.9%';
COMMENT ON COLUMN presale_schedule_official.public_housing_district IS 'PUBLIC_HOUSE_EARTH_AT 공공주택지구 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 267건 = 9.4%';
COMMENT ON COLUMN presale_schedule_official.large_scale_district IS 'LRSCL_BLDLND_AT 대규모 택지개발지구 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 435건 = 15.3%';
COMMENT ON COLUMN presale_schedule_official.metro_private_public_housing IS 'NPLN_PRVOPR_PUBLIC_HOUSE_AT 수도권 민영 공공택지 (Y/N → boolean). 2026-08-07 전량 2,837건 중 Y 50건 = 1.8%';

NOTIFY pgrst, 'reload schema';
