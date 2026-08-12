-- 롤백: 20260811100000_create_dev_plans.sql
--
-- ⚠️ DROP TABLE 은 수집된 개발계획 원본을 전부 지운다. 수집기가 매 실행 전량 upsert(kind,
--    source_id UNIQUE)이므로 재수집으로 복구되지만, 실행 전 행 수를 확인할 것.
-- apartments.transit_dev 등 기존 컬럼은 이 마이그가 애초에 건드리지 않았으므로 영향 없음.

DROP TABLE IF EXISTS dev_plans;

NOTIFY pgrst, 'reload schema';
