-- 롤백: 20260807000000_applyhome_stage1_remndr.sql
--
-- ⚠️ applyhome_cancel_respl DROP 은 그 테이블에 쌓인 취소후재공급 경쟁률을 전부 지운다.
--    수집기가 매주 전량 재수집(upsert)하므로 재적재는 가능하지만, 실행 전 행 수를 확인할 것.
--    source 컬럼 DROP 은 태그만 사라질 뿐 평형 데이터(applyhome_unit_supply 본문)는 보존된다.

DROP TABLE IF EXISTS applyhome_cancel_respl;

ALTER TABLE applyhome_unit_supply DROP COLUMN IF EXISTS source;

NOTIFY pgrst, 'reload schema';
