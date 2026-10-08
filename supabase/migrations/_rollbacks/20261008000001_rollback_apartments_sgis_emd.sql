-- ROLLBACK: 20261008000000_apartments_sgis_emd.sql
--
-- apartments.sgis_emd_cd · sgis_mapped_at 칸과 색인을 지운다. 이 칸을 읽는 VIEW 가 이미 적용돼 있으면
-- **먼저 그 VIEW 를 직전 판으로 되돌린 뒤** 이 파일을 실행한다 — VIEW 가 칸을 쥐고 있으면 DROP COLUMN 이 실패한다(2BP01).
-- 칸을 지워도 원본은 잃지 않는다(좌표가 그대로라 scripts/collectors/sgis-map-emd.mjs 가 언제든 다시 매핑한다 — 외부 호출 ≈ 단지 수).
-- 되돌린 뒤에는 scripts/kosis-local-runner.mjs DAY_TABLE 의 sgis-map-emd 항목도 같이 뺀다(칸이 없으면 매주 실패 기록을 남긴다).
-- 그 항목을 빼면 scripts/audit-orphan-collectors.mjs 가 sgis-map-emd 를 고아 수집기로 잡아 CI 가 빨강이 된다 — ALLOWLIST 에 한 줄을 넣는다.
-- apartments_flat 을 이 칸 추가 뒤에 (다른 이유로라도) 다시 만들었다면 안쪽 SELECT * 가 이 칸을 품는다 — 그때도 VIEW 를 먼저 다시 만든다.

SET lock_timeout = '5s';

DROP INDEX IF EXISTS apartments_sgis_emd_idx;

ALTER TABLE apartments DROP COLUMN IF EXISTS sgis_mapped_at;

ALTER TABLE apartments DROP COLUMN IF EXISTS sgis_emd_cd;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
