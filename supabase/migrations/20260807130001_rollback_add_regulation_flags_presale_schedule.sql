-- 롤백: 20260807130000_add_regulation_flags_presale_schedule.sql 되돌리기 (세션 496).
--
-- ⚠️ DROP COLUMN 은 수집된 규제 지정 값(조정대상지역·분양가상한제 등 7종)을 전부 지운다.
--    collect-applyhome-detail 이 매주 월 12:30 KST 에 청약홈 Detail 전량을 재수집(upsert)하므로
--    재적재는 가능하다 — 다만 되돌리기 전에 채워진 행 수를 확인할 것:
--      SELECT count(*) FILTER (WHERE price_cap_applied IS NOT NULL) AS filled,
--             count(*) AS total FROM presale_schedule_official;
--
-- 일정 컬럼(recruit_date 등 기존 18필드)과 apartments base 는 건드리지 않는다.
-- apartments_flat VIEW 는 이 테이블에서 MAX(recruit_date) 만 뽑으므로 VIEW 재정의 불필요.
-- BEGIN/COMMIT 사용 안 함 (기존 컬럼 추가/롤백 마이그 패턴).

ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS adjustment_target_area;
ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS price_cap_applied;
ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS speculation_overheated;
ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS redevelopment_biz;
ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS public_housing_district;
ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS large_scale_district;
ALTER TABLE presale_schedule_official DROP COLUMN IF EXISTS metro_private_public_housing;

NOTIFY pgrst, 'reload schema';
