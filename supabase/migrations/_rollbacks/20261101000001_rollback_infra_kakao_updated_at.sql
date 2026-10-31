-- 되돌리기 — 20261101000000_infra_kakao_updated_at.sql (세션681)
--
-- ⚠️ 순서 = **코드 먼저 되돌리고(PR revert → 본 폴더 pull) 그 다음 DB**.
--   반대로 DB 를 먼저 지우면 새 코드(infra-kakao.mjs)의 select 가 없는 칸으로 실패해 고칠 때까지 매 회차 실패한다.
-- 이 칸은 미분양 소유 · 2u 가 읽거나 쓰지 않는다(정본 supabase/ownership.json tables.infra) → DROP 의 2u 영향 0.
--   단 공유 표의 DROP COLUMN 이라 CI 감사 ④ 가 새 마이그 폴더에선 막는다 — 이 파일은 _rollbacks/ 에 둔다.

SET lock_timeout = '5s';

ALTER TABLE infra DROP COLUMN IF EXISTS kakao_updated_at;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
