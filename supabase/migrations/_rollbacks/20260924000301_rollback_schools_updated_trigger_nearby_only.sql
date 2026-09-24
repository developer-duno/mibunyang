-- ROLLBACK of 20260924000300_schools_updated_trigger_nearby_only.sql
-- schools.updated_at 트리거를 원래대로(모든 UPDATE 에서 발화)로 되돌린다.

SET lock_timeout = '2s';
SET statement_timeout = '30s';

DROP TRIGGER IF EXISTS trg_schools_updated ON public.schools;

CREATE TRIGGER trg_schools_updated
  BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
