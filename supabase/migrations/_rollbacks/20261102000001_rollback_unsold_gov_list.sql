-- ROLLBACK: 20261102000000_unsold_gov_list.sql (세션687 PR-1 — 표·칸·CHECK)
--
-- ⚠️ 이 파일은 **VIEW 마이그(20261102000002)를 적용하지 않았을 때만** 쓴다. VIEW 까지 적용했으면 이 파일 말고
--    _rollbacks/20261102000003_rollback_view_unsold_govlist.sql 하나로 되돌린다 — 새 VIEW 의 안쪽 SELECT * 가
--    새 칸 2개를 쥐고 있어 여기의 DROP COLUMN 이 2BP01(다른 객체가 의존)로 막힌다. 000003 이 VIEW 를 내린 채 칸·표·CHECK 를 함께 되돌린다.
--    (지금 VIEW 20261031000000 은 이 칸들이 생기기 전에 만들어져 안쪽 SELECT * 가 새 칸을 품지 않는다 — 그래서 이 파일만으로 된다.)
-- ⚠️ 'govlist' 출처 행이 하나라도 있으면 멈춘다 — 옛 CHECK 가 그 행을 거부한다. 먼저 govlist 수집기의 역계획
--    (.omc/artifacts/govlist/<as_of>/ — backfill-unsold-source.mjs --plan= 꼴)으로 그 행들을 되돌린 뒤 실행한다.
-- ⚠️ unsold_gov_list 에 행이 하나라도 있으면 멈춘다 — 명단 원문을 지우기 전에 사본을 뜬다(그 뒤 표를 비우고 다시 실행).
-- ⚠️ govlist 아닌 행에 남은 unsold_listed_as_of·unsold_listed_total 값은 DROP COLUMN 으로 사라진다 — 되돌리기 전 그 칸 사본
--    (select id, unsold_source, unsold_listed_as_of, unsold_listed_total … where 둘 중 하나라도 not null)을 파일로 뜬다.
-- 수집기(collect-unsold-govlist.mjs)가 이미 합쳐져 있으면 표가 없어 첫 쓰기에서 실패한다(PGRST205) — 수집기를 되돌리는 PR 과 함께.
-- 적용: psql --single-transaction 또는 Dashboard SQL Editor(아래 BEGIN … COMMIT 이 한 덩어리).
-- 되돌린 뒤 권한 지문이 바뀐다 → node scripts/perm-baseline.mjs 미리보기 → 사장님 승인 → 기준선 재승인.

SET lock_timeout = '5s';
SET statement_timeout = '30s';
BEGIN;

DO $$
DECLARE
  has_rows boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.apartments WHERE unsold_source = 'govlist') THEN
    RAISE EXCEPTION 'rollback unsold_gov_list: govlist rows remain in apartments — restore them first (역계획)';
  END IF;
  -- 표가 이미 없으면(두 번째 실행) 건너뛴다 — 정적 SELECT 는 표가 없으면 계획 단계에서 실패하므로 EXECUTE 로
  IF pg_catalog.to_regclass('public.unsold_gov_list') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.unsold_gov_list)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'rollback unsold_gov_list: unsold_gov_list has rows — copy them out first (명단 원문 사본)';
    END IF;
  END IF;
END $$;

ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_source_check
  CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold'));

ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_govlist_asof_check;
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_govlist_hidden_rate_check;
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_listed_total_check;
ALTER TABLE public.apartments DROP COLUMN IF EXISTS unsold_listed_total;
ALTER TABLE public.apartments DROP COLUMN IF EXISTS unsold_listed_as_of;

DROP TABLE IF EXISTS public.unsold_gov_list;   -- 색인·시퀀스·FK 는 표와 함께 지워진다

COMMENT ON COLUMN public.apartments.unsold_source IS
  '이 값(unsold/unsold_rate)을 누가 썼나 — kosis=KOSIS 시군구 비례배분 추정(다음 회차가 새 값으로 덮음) / applyhome=청약홈 단지별 실측(공고일+6개월 전까지 존중, C6) / hold=사람 보류(자료 없음 확정 — KOSIS·청약홈이 덮지 않음, 해제는 backfill-unsold-source 계획으로) / NULL=출처 모름(세션568 이전 값)';
COMMENT ON COLUMN public.apartments.unsold_as_of IS
  '출처별 기준일 — applyhome=그 값을 만든 청약홈 공고의 공고일(공고일 + 6개월이 지나면 collect-unsold-kosis 가 KOSIS 추정으로 덮는다, C6) · hold=보류 결정일(6개월 지나면 감시 ⑫ 가 재검토 알림, 자동 해제 없음). kosis·NULL 출처 행에서는 의미 없음';

COMMIT;
RESET statement_timeout;
RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
