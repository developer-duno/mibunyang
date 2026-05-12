-- W3 역마이그: apartments 관리비 5 항목 컬럼 + apartments_flat VIEW 5 컬럼 제거
-- 적용 시 = 직전 VIEW (20260502100000_view_add_applyhome_events.sql) 본문 그대로 복원 의무.
-- 본 down 은 컬럼 DROP 만 수행 (CASCADE 로 VIEW 자동 무효화 후 사용자 직접 직전 VIEW 마이그 재실행).
--
-- BEGIN/COMMIT 사용 안 함 (기존 VIEW 마이그 패턴).

DROP VIEW IF EXISTS apartments_flat;

ALTER TABLE apartments
  DROP COLUMN IF EXISTS maint_heat,
  DROP COLUMN IF EXISTS maint_hotwater,
  DROP COLUMN IF EXISTS maint_gas,
  DROP COLUMN IF EXISTS maint_elec,
  DROP COLUMN IF EXISTS maint_water;

-- VIEW 재생성 = 직전 마이그 20260502100000_view_add_applyhome_events.sql 본문 통째 재실행 의무.
