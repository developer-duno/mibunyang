-- ROLLBACK: 20261018000000_trade_stats_complex_area.sql
--
-- trade_stats.complex_area 칸을 지운다.
-- ⚠️ 순서: **코드를 먼저 되돌린다** — scripts/collectors/trade-stats.mjs SCOPE_COLS 에서 "complex_area" 를 빼고
--   (_trade-scope.mjs computeScopeStats 의 cols.complex_area 도 함께) 그 코드가 합쳐진 뒤에 이 파일을 실행한다.
--   칸을 먼저 지우면 다음 trade-stats 회차의 upsert 전체가 실패한다(PGRST204 — 없는 칸).
--   2u 가 이 칸을 읽고 있으면 2u 쪽 조회(전세율 라벨 평수)에서도 먼저 빼 달라고 알린다.
-- 칸을 지워도 원본은 잃지 않는다(다음 trade-stats 회차가 대표 면적에서 다시 계산한다).

SET lock_timeout = '5s';

ALTER TABLE trade_stats DROP COLUMN IF EXISTS complex_area;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
