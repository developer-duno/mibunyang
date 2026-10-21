-- 리허설 VIEW 지우기 — 대조가 끝난 날 바로(월요일 권한 지문 감시 ⑩ 전에). 운영 VIEW(apartments_flat)는 무관.
DROP VIEW IF EXISTS apartments_flat_rehearsal;
NOTIFY pgrst, 'reload schema';
