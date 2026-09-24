SET lock_timeout='2s';
SET statement_timeout='30s';

-- 청약홈(applyhome) 출처 미분양 값의 만료 기준 C6 (세션569, 사장님 결정 2026-09-24 🟡8).
-- 세션568 이 applyhome 값을 "항상 존중"으로 두었는데, 그 값은 공고 한 시점의 스냅숏이라
-- 영구 존중할 근거가 없다(공고~계약 종료 중앙값 14일). 그래서 두 칸을 더한다:
--   unsold_as_of         = 그 applyhome 값을 만든 공고의 공고일. 공고일 + 6개월이 지나면
--                          collect-unsold-kosis.mjs 가 KOSIS 추정으로 덮는다.
--   competition_shortfall = 최신 경쟁률 회차의 평형별 미달 합(평형마다 max(0, 공급 − 신청) 의 합).
--                          0 이면 collect-applyhome.mjs 가 applyhome 값을 0 으로 쓴다(완판 신호).
-- 기존 행 값은 바꾸지 않는다(backfill 은 별도 계획 파일). apartments_flat VIEW 는 노출하지
-- 않는다(점수 미사용). ROLLBACK: _rollbacks/20260924000501_rollback_apartments_unsold_as_of_shortfall.sql

ALTER TABLE public.apartments ADD COLUMN IF NOT EXISTS unsold_as_of date;
ALTER TABLE public.apartments ADD COLUMN IF NOT EXISTS competition_shortfall integer;

ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_competition_shortfall_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_competition_shortfall_check
  CHECK (competition_shortfall IS NULL OR competition_shortfall >= 0);

COMMENT ON COLUMN public.apartments.unsold_as_of IS
  'applyhome 출처 unsold 값을 만든 청약홈 공고의 공고일 — 공고일 + 6개월이 지나면 collect-unsold-kosis 가 KOSIS 추정으로 덮는다(C6). kosis·NULL 출처 행에서는 의미 없음';
COMMENT ON COLUMN public.apartments.competition_shortfall IS
  '최신 청약홈 잔여세대 경쟁률 회차의 평형별 미달 합(평형마다 max(0, 공급-신청)). 0 = 그 회차 완판 신호. NULL = 경쟁률 없음 또는 공급 0';

-- 자체검사 — 칸이 실제로 있고 타입이 맞는지, 제약이 있는지 확인한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'apartments'
      AND column_name = 'unsold_as_of' AND data_type = 'date'
  ) THEN
    RAISE EXCEPTION 'apartments_unsold_as_of_shortfall: unsold_as_of date column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'apartments'
      AND column_name = 'competition_shortfall' AND data_type = 'integer'
  ) THEN
    RAISE EXCEPTION 'apartments_unsold_as_of_shortfall: competition_shortfall integer column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apartments_competition_shortfall_check'
      AND conrelid = 'public.apartments'::regclass
  ) THEN
    RAISE EXCEPTION 'apartments_unsold_as_of_shortfall: check constraint missing';
  END IF;
END $$;
