-- schools.updated_at 자동 갱신 트리거를 "nearby_schools 컬럼이 SET 될 때만" 발화하도록 좁힌다.
-- 배경(세션568) — 지금 트리거(trg_schools_updated, BEFORE UPDATE ON schools)는 어떤 칼럼을
-- 고쳐도 updated_at 을 갱신한다. 그런데 schools-neis.mjs 는 updated_at 30일 경과로
-- 재수집 대상을 거르는데(STALE_DAYS_FOR_SKIP), 다음 두 경로가 nearby_schools 를 안 건드리고도
-- 시계를 앞당겨 재수집이 밀렸다:
--   ① rescaleOnly()(schools-neis.mjs) — school_score/school_grade 만 다시 계산해 update
--   ② collect-nearby-childcare.mjs — schools.nearby_childcare 만 update
-- 실측(2026-09-23 KST): schools 3,068행 중 2,654행이 같은 날 만료(그중 2,545행이 05~07시
-- 대에 몰림) → 매일 도는 collect-naver-listings-incremental.yml(학교가 마지막 단계)이
-- 한 번에 몰려 timeout 위험. UPDATE OF 절로 좁히면 ①②가 더는 시계를 앞당기지 않는다.
--
-- 근거(PostgreSQL 공식 문서, CREATE TRIGGER — Notes 절, 2026-09-24 확인):
-- "A column-specific trigger (one defined using the UPDATE OF column_name syntax) will fire
--  when any of its columns are listed as targets in the UPDATE command's SET list" — 즉 값이
-- 실제로 바뀌었는지는 무관하게 **SET 목록에 그 칼럼명이 있는지**로만 발화가 정해진다.
-- INSERT ... ON CONFLICT DO UPDATE 로 그 칼럼이 갱신될 때도 같은 기준으로 발화한다
-- ("an INSERT with an ON CONFLICT DO UPDATE clause may cause both insert and update
--  operations, so it will fire both kinds of triggers as needed"). schools-neis.mjs 의 본
-- 수집 upsert(:703, onConflict: apartment_id)는 매번 nearby_schools 를 SET 하므로 그대로
-- 발화한다 — 의도한 대로 "진짜 재수집했을 때만" 시계가 갱신된다.
--
-- ROLLBACK: _rollbacks/20260924000301_rollback_schools_updated_trigger_nearby_only.sql

SET lock_timeout = '2s';
SET statement_timeout = '30s';

DROP TRIGGER IF EXISTS trg_schools_updated ON public.schools;

CREATE TRIGGER trg_schools_updated
  BEFORE UPDATE OF nearby_schools ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 자체검사 — 트리거가 존재하고, 컬럼 지정(tgattr)이 nearby_schools 열 번호 하나만인지 확인한다.
DO $$
DECLARE
  trig_oid OID;
  col_count INT;
  target_attnum SMALLINT;
BEGIN
  SELECT oid INTO trig_oid
  FROM pg_trigger
  WHERE tgname = 'trg_schools_updated'
    AND tgrelid = 'public.schools'::regclass
    AND NOT tgisinternal;

  IF trig_oid IS NULL THEN
    RAISE EXCEPTION 'schools_updated_trigger_nearby_only: trg_schools_updated 트리거가 없다';
  END IF;

  SELECT attnum INTO target_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.schools'::regclass AND attname = 'nearby_schools';

  IF target_attnum IS NULL THEN
    RAISE EXCEPTION 'schools_updated_trigger_nearby_only: schools.nearby_schools 컬럼이 없다';
  END IF;

  SELECT array_length(tgattr, 1) INTO col_count FROM pg_trigger WHERE oid = trig_oid;

  IF col_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'schools_updated_trigger_nearby_only: tgattr 열 개수가 1이 아니다 (%)', col_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE oid = trig_oid AND target_attnum = ANY(tgattr)
  ) THEN
    RAISE EXCEPTION 'schools_updated_trigger_nearby_only: tgattr 에 nearby_schools 열 번호(%)가 없다', target_attnum;
  END IF;
END $$;
