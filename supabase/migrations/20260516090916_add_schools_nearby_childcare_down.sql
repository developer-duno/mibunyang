-- 세션 257 W6-D2 역마이그: schools.nearby_childcare 컬럼 + apartments_flat VIEW 1 컬럼 제거
-- 본 down 은 컬럼 DROP 만 수행 (CASCADE 로 VIEW 자동 무효화 후
--   사용자 직접 직전 VIEW 마이그 20260513053711_split_maintenance_by_category.sql 재실행).
--
-- BEGIN/COMMIT 사용 안 함 (기존 VIEW 마이그 패턴).

DROP VIEW IF EXISTS apartments_flat;

ALTER TABLE schools
  DROP COLUMN IF EXISTS nearby_childcare;

-- VIEW 재생성 = 직전 마이그 20260513053711_split_maintenance_by_category.sql 본문 통째 재실행 의무.
