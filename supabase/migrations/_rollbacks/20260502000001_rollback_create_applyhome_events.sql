-- 롤백용 마이그레이션 — 20260502000000_create_applyhome_events.sql 되돌리기
-- ⚠️ 미적용. 비상용. CASCADE로 모든 적재 데이터 손실됨.
-- 사용법: Supabase SQL Editor 에서 이 파일 전체 실행 → forward 마이그 로그 수동 삭제
--
-- ⚠️ 실행 순서: 이 파일을 실행하기 전 반드시 VIEW 롤백
--    (`20260502100001_rollback_view_add_applyhome_events.sql`) 부터 먼저 실행할 것.
--    이유: apartments_flat VIEW가 applyhome_events 를 LEFT JOIN 으로 참조 → 테이블만
--    먼저 DROP 하면 VIEW가 깨진 상태로 남음(쿼리 실패).

DROP TABLE IF EXISTS applyhome_events CASCADE;
