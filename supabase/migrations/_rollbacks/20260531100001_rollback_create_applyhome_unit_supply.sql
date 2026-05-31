-- 롤백용 마이그레이션 — applyhome_unit_supply 테이블 제거.
-- ⚠️ 미적용. 비상용. 사용법: Supabase SQL Editor 에서 이 파일 전체 실행 후 forward 마이그 로그 수동 삭제.
-- CASCADE: RLS 정책·인덱스·FK 동반 삭제.

DROP TABLE IF EXISTS applyhome_unit_supply CASCADE;

NOTIFY pgrst, 'reload schema';
