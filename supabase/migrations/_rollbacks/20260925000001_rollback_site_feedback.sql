-- ROLLBACK for 20260925000000_site_feedback.sql
-- 손님 의견 표를 통째로 지운다(시퀀스·색인 함께).
-- ⚠️ 표를 지우면 받은 의견도 함께 사라진다(되살릴 수 없다) — 되돌리기 전에 필요하면 덤프해 둘 것.
-- ⚠️ SQL 만 되돌리고 api/feedback.ts 를 그대로 두면 의견 보내기가 500 을 낸다 — 코드 커밋도 함께 되돌릴 것.
-- ⚠️ 권한 지문(감시 ⑩)이 다시 바뀐다 → scripts/perm-baseline.mjs 로 기준선 재승인.

DROP TABLE IF EXISTS public.site_feedback;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.site_feedback') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback_site_feedback: 표가 남아 있다';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
