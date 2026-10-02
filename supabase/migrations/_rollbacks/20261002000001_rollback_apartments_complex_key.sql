-- ROLLBACK: 20261002000000_apartments_complex_key.sql
--
-- apartments.complex_key 칸을 지운다. 이 칸을 읽는 VIEW(다) 단계)가 이미 적용돼 있으면 **먼저 그 VIEW 를
-- 직전 판으로 되돌린 뒤** 이 파일을 실행한다 — VIEW 가 칸을 쥐고 있으면 DROP COLUMN 이 실패한다(2BP01).
-- 칸을 지워도 원본 값은 잃지 않는다(열쇠는 scripts/collectors/assign-complex-keys.mjs 가 언제든 다시 계산한다).
-- 되돌린 뒤에는 daily-deploy.yml 의 "Assign complex keys" 단계도 같이 뺀다(칸이 없으면 그 단계가 매일 실패 기록을 남긴다).
-- 그 단계를 빼면 scripts/audit-orphan-collectors.mjs 가 assign-complex-keys 를 고아 수집기로 잡아 CI 가 빨강이 된다 — ALLOWLIST 에 한 줄을 넣는다.
-- apartments_flat 을 이 칸 추가 뒤에 (다른 이유로라도) 다시 만들었다면 안쪽 SELECT * 가 이 칸을 품는다 — 그때도 VIEW 를 먼저 다시 만든다(세션589 검사관 C #7).

SET lock_timeout = '5s';

ALTER TABLE apartments DROP COLUMN IF EXISTS complex_key;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
