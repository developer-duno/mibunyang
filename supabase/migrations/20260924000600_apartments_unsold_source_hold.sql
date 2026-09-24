SET lock_timeout='2s';
SET statement_timeout='30s';

-- 미분양 출처 칸에 'hold'(사람 보류) 추가 (세션570, 사장님 결정 2026-09-24).
-- 세션569 가 "자료 없음"으로 비운 11곳(unsold·unsold_rate·unsold_source 전부 NULL)을
-- collect-unsold-kosis.mjs 는 "출처 모름 = 내가 채울 자리"로 보고 10/09 회차에 반올림 0(완판)으로
-- 되돌린다. hold = "사람이 자료 없음을 확정했다, 수집기는 건드리지 마라". 값은 반드시 NULL 이다
-- (apartments_unsold_hold_null_check). 해제는 backfill-unsold-source.mjs 계획 파일
-- (op release_hold_to_null / release_hold_to_applyhome)로만 한다.
--
-- ⚠️ 배포 순서(이 순서를 어기면 10/09 에 되돌림이 그대로 일어난다):
--   ① 이 마이그 적용 → ② PR 합침 → ③ 본 폴더(F:\mibunyang) git pull(로컬 러너가 새 코드를 돌게)
--   → ④ hold backfill 11행(mark_hold 계획 파일) → ⑤ 10/09 회차 전 재시뮬(11곳 skip_hold 확인).
--   옛 코드는 hold 를 '값 없음'으로 본다 — pull 전에 backfill 하면 10/09 에 0 으로 덮고
--   출처까지 kosis 로 바꾼다.
-- 롤백하면 10/09 되돌림 위험이 돌아온다(롤백은 hold 행을 출처 NULL 로 되돌린다).
-- ROLLBACK: _rollbacks/20260924000601_rollback_apartments_unsold_source_hold.sql

ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_source_check
  CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold'));

ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_hold_null_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_hold_null_check
  CHECK (unsold_source IS DISTINCT FROM 'hold' OR (unsold IS NULL AND unsold_rate IS NULL));

COMMENT ON COLUMN public.apartments.unsold_source IS
  '이 값(unsold/unsold_rate)을 누가 썼나 — kosis=KOSIS 시군구 비례배분 추정(다음 회차가 새 값으로 덮음) / applyhome=청약홈 단지별 실측(공식 통계로 안 덮음) / hold=사람 보류(자료 없음 확정 — KOSIS·청약홈이 덮지 않음, 해제는 backfill-unsold-source 계획으로) / NULL=출처 모름(세션568 이전 값)';
COMMENT ON COLUMN public.apartments.unsold_as_of IS
  '출처별 기준일 — applyhome=그 값을 만든 청약홈 공고의 공고일(공고일 + 6개월이 지나면 collect-unsold-kosis 가 KOSIS 추정으로 덮는다, C6) · hold=보류 결정일(6개월 지나면 감시 ⑫ 가 재검토 알림, 자동 해제 없음). kosis·NULL 출처 행에서는 의미 없음';

-- 자체검사 — 제약 2개가 실제로 있고 허용값에 'hold' 가 들어갔는지 확인한다.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conname = 'apartments_unsold_source_check'
    AND conrelid = 'public.apartments'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'apartments_unsold_source_hold: apartments_unsold_source_check missing';
  END IF;
  IF position('hold' in def) = 0 THEN
    RAISE EXCEPTION 'apartments_unsold_source_hold: check does not allow hold: %', def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conname = 'apartments_unsold_hold_null_check'
    AND conrelid = 'public.apartments'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'apartments_unsold_source_hold: apartments_unsold_hold_null_check missing';
  END IF;
  IF position('hold' in def) = 0 THEN
    RAISE EXCEPTION 'apartments_unsold_source_hold: hold null check malformed: %', def;
  END IF;
END $$;
