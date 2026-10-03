-- ROLLBACK: 20261003000000_trade_deals.sql
--
-- 되돌리는 순서 — 정책 → 인덱스 → 테이블(IF EXISTS 라 어느 순서로 돌려도 에러가 나지 않는다).
--
-- 이 표는 새 "추가 자료"라 trades·apartments_flat VIEW 를 건드리지 않았다. 되돌려도 화면·2u 영향 0 —
-- 다만 이미 머지된 collect-trades.mjs 는 첫 열쇠에서 표 없음(PGRST205)을 만나 그 회차의 trade_deals 쓰기를 멈추고
-- 실패 1건으로 센다(trade_deals 는 회차 도중에 쓰고 trades 는 회차 끝에 저장하므로, trades 는 그 뒤에 그대로 저장된다 —
-- 회차 결과는 실패). 수집기 배선을 되돌리는 PR 과 함께 적용할 것.
DROP POLICY IF EXISTS "Service write" ON trade_deals;
DROP INDEX IF EXISTS idx_trade_deals_aptseq;
DROP INDEX IF EXISTS idx_trade_deals_jibun;
DROP INDEX IF EXISTS idx_trade_deals_key;
DROP INDEX IF EXISTS idx_trade_deals_dong;
DROP TABLE IF EXISTS trade_deals;
