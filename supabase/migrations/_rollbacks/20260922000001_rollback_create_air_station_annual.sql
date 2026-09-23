-- ROLLBACK: 20260922000000_create_air_station_annual.sql
--
-- 되돌리는 순서가 중요하다 — 정책 → 인덱스 → 테이블.
-- (테이블을 먼저 지우면 정책·인덱스가 함께 사라지므로 아래 DROP 이 "없는 것을 지우기"가 되지만,
--  IF EXISTS 를 붙여 두어 어느 순서로 돌려도 에러가 나지 않게 했다.)
--
-- 이 테이블은 "추가 자료"라 apartments_flat VIEW 를 건드리지 않았다.
-- 따라서 되돌려도 화면·API 에 영향이 없다 — 3년 평균을 쓰는 스코어링 코드가
-- 이미 머지된 상태라면 그 코드가 폴백(AIR_QUALITY_DEFAULT)으로 떨어질 뿐이다.
DROP POLICY IF EXISTS "Service write" ON air_station_annual;
DROP POLICY IF EXISTS "Public read" ON air_station_annual;
DROP INDEX IF EXISTS idx_air_station_annual_pm25;
DROP TABLE IF EXISTS air_station_annual;
