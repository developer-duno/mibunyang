SET lock_timeout='2s';
SET statement_timeout='30s';

-- ROLLBACK for 20260924000500_apartments_unsold_as_of_shortfall.sql
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_competition_shortfall_check;
ALTER TABLE public.apartments DROP COLUMN IF EXISTS competition_shortfall;
ALTER TABLE public.apartments DROP COLUMN IF EXISTS unsold_as_of;
