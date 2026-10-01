-- ROLLBACK: 20261002000000_apartments_complex_key.sql
--
-- apartments.complex_key 칸을 지운다. 이 칸을 읽는 VIEW(다) 단계)가 이미 적용돼 있으면 **먼저 그 VIEW 를
-- 직전 판으로 되돌린 뒤** 이 파일을 실행한다 — VIEW 가 칸을 쥐고 있으면 DROP COLUMN 이 실패한다(2BP01).
-- 칸을 지워도 원본 값은 잃지 않는다(열쇠는 scripts/collectors/assign-complex-keys.mjs 가 언제든 다시 계산한다).
-- 되돌린 뒤에는 daily-deploy.yml 의 "Assign complex keys" 단계도 같이 뺀다(칸이 없으면 그 단계가 매일 실패 기록을 남긴다).

SET lock_timeout = '5s';

ALTER TABLE apartments DROP COLUMN IF EXISTS complex_key;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
