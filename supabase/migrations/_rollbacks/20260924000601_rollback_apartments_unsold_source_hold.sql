SET lock_timeout='2s';
SET statement_timeout='30s';

-- ROLLBACK for 20260924000600_apartments_unsold_source_hold.sql
-- ⚠️ 이 롤백을 돌리면 hold 행이 출처 NULL 로 돌아가 다음 KOSIS 회차가 0 으로 채운다(10/09 되돌림 위험 복귀).

-- ① hold 행을 출처 없음으로 (값은 hold 제약상 이미 NULL)
UPDATE public.apartments
SET unsold_source = NULL, unsold_as_of = NULL
WHERE unsold_source = 'hold';

-- ② hold 값-NULL 제약 제거
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_hold_null_check;

-- ③ 허용값 원복
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_source_check
  CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome'));

-- ④ COMMENT 원복 (000200·000500 의 문구 그대로)
COMMENT ON COLUMN public.apartments.unsold_source IS
  '이 값(unsold/unsold_rate)을 누가 썼나 — kosis=KOSIS 시군구 비례배분 추정(다음 회차가 새 값으로 덮음) / applyhome=청약홈 단지별 실측(공식 통계로 안 덮음) / NULL=출처 모름(세션568 이전 값)';
COMMENT ON COLUMN public.apartments.unsold_as_of IS
  'applyhome 출처 unsold 값을 만든 청약홈 공고의 공고일 — 공고일 + 6개월이 지나면 collect-unsold-kosis 가 KOSIS 추정으로 덮는다(C6). kosis·NULL 출처 행에서는 의미 없음';

-- ⑤ 자체검사
DO $$
DECLARE
  def text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.apartments WHERE unsold_source = 'hold') THEN
    RAISE EXCEPTION 'rollback_apartments_unsold_source_hold: hold rows remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apartments_unsold_hold_null_check'
      AND conrelid = 'public.apartments'::regclass
  ) THEN
    RAISE EXCEPTION 'rollback_apartments_unsold_source_hold: hold null check still present';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conname = 'apartments_unsold_source_check'
    AND conrelid = 'public.apartments'::regclass;
  IF def IS NULL OR position('hold' in def) > 0 THEN
    RAISE EXCEPTION 'rollback_apartments_unsold_source_hold: source check not restored: %', def;
  END IF;
END $$;
