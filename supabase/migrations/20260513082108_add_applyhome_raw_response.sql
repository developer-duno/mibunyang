-- applyhome_events.raw_response JSONB 보존 (세션 241 W5)
-- 청약홈 API 응답 7 필드 중 4 필드 (HOUSE_TY/PBLANC_NO/REMNDR_HSHLD_PBLANC_TYCD/CMPET_RATE) 미저장 자리 정정.
-- HOUSE_TY = 평형 (한 HOUSE_MANAGE_NO 에 다중 65%). 미래 평형별 분석 가능.
-- 기존 집계 의미 (HOUSE_MANAGE_NO 단위 가중평균) 보존.
-- ROLLBACK: _rollbacks/20260513082108_rollback_add_applyhome_raw_response.sql

ALTER TABLE applyhome_events ADD COLUMN IF NOT EXISTS raw_response JSONB;

COMMENT ON COLUMN applyhome_events.raw_response IS '청약홈 API 응답 row 배열 (HOUSE_TY/PBLANC_NO/REMNDR_HSHLD_PBLANC_TYCD/CMPET_RATE 원본 + 평형별 supply/applicants — 동일 HOUSE_MANAGE_NO 다중 HOUSE_TY 보존)';
