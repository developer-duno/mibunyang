-- 세션676 PR-C 리허설 VIEW 지우기 — 리허설한 같은 날(감시 ⑩ 권한 지문 전). 실행 = 메인 세션.
--   확인: SELECT to_regclass('public.apartments_flat_card_rehearsal');   (기대: NULL)
SET lock_timeout = '5s';
DROP VIEW IF EXISTS apartments_flat_card_rehearsal;
NOTIFY pgrst, 'reload schema';
