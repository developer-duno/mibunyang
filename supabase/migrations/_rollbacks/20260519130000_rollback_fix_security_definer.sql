-- ROLLBACK: 20260519130000_fix_security_definer.sql 원복.
-- VIEW security_invoker 를 기본값(off = definer)으로 되돌리고,
-- 함수 2개를 search_path 없는 원본 정의(init/add_cats_cache 마이그)로 복원.

ALTER VIEW apartments_flat SET (security_invoker = off);
ALTER VIEW api_quota_daily SET (security_invoker = off);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_scores_computed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cats_cache IS DISTINCT FROM OLD.cats_cache THEN
    NEW.scores_computed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
