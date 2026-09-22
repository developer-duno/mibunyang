-- ROLLBACK: 20260922000002_apartments_coord_shared.sql (세션560)
--
-- 되돌리면 `coord_shared` 값이 **사라진다**(재생성은 `flag-shared-coords.mjs --apply` 로 몇 초).
-- 화면 경고는 값이 없으면 자동으로 안 뜨므로, 이 롤백만으로 표시가 깨끗이 사라진다.
--
-- ⚠️ 적용 방법: Supabase Dashboard SQL Editor 수동 실행.

DROP INDEX IF EXISTS idx_apartments_coord_shared;
ALTER TABLE apartments DROP COLUMN IF EXISTS coord_shared;
