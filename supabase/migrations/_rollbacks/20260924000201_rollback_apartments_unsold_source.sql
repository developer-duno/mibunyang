SET lock_timeout='2s';
SET statement_timeout='30s';

-- ROLLBACK for 20260924000200_apartments_unsold_source.sql
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;
ALTER TABLE public.apartments DROP COLUMN IF EXISTS unsold_source;
