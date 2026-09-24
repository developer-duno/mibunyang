SET lock_timeout='2s';
SET statement_timeout='30s';

-- apartments.unsold 를 누가 썼는지 기록하는 출처 칸 (세션568).
-- `collect-unsold-kosis.mjs` 의 shouldSkipKosisFill 은 값의 **출처를 모르고** "값 있음·세대수
-- 이하·naver_sell_count 와 다름"이면 청약홈 실측으로 보고 보존한다 — 그래서 2026-09-24 에
-- KOSIS 가 쓴 862곳이 다음 회차(10/09)부터 skip_preserved 로 조용히 동결된다(수집기는 success
-- 라 감시도 못 잡는다). 사장님 결정(2026-09-24) = 출처 칸 신설. ROLLBACK:
-- _rollbacks/20260924000201_rollback_apartments_unsold_source.sql

ALTER TABLE public.apartments ADD COLUMN IF NOT EXISTS unsold_source text;

ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_source_check
  CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome'));

COMMENT ON COLUMN public.apartments.unsold_source IS
  '이 값(unsold/unsold_rate)을 누가 썼나 — kosis=KOSIS 시군구 비례배분 추정(다음 회차가 새 값으로 덮음) / applyhome=청약홈 단지별 실측(공식 통계로 안 덮음) / NULL=출처 모름(세션568 이전 값)';

-- 자체검사 — 칸과 제약이 실제로 존재하는지 확인한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'apartments' AND column_name = 'unsold_source'
  ) THEN
    RAISE EXCEPTION 'apartments_unsold_source: unsold_source column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apartments_unsold_source_check'
      AND conrelid = 'public.apartments'::regclass
  ) THEN
    RAISE EXCEPTION 'apartments_unsold_source: check constraint missing';
  END IF;
END $$;
