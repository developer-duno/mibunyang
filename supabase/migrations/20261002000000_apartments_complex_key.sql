-- apartments.complex_key — 같은 단지 묶음 열쇠 (세션588 · "한 단지 = 한 장" 가) 단계)
--
-- 배경: 같은 단지가 청약홈 행(ah-)과 네이버 분양 행(ap-), 회차 공고들로 여러 행에 나뉘어 있고
--   화면(VIEW apartments_flat)의 묶음 열쇠가 "이름 완전 일치"라 두 장·세 장으로 보인다
--   (설계서 docs/superpowers/specs/2026-10-01-one-complex-one-card.md §1·§2).
--   새 열쇠는 묶음 맥락(같은 뼈대 이름 안에 서로 다른 블록 표기가 둘 이상일 때만 블록을 열쇠에 넣는다)을
--   봐야 해서 SQL 식으로 계산할 수 없다 → 배치가 전 행을 보고 채우는 **칸**으로 둔다(설계서 §4-7 (6)).
--
-- 채우는 주체: scripts/collectors/assign-complex-keys.mjs (규칙은 scripts/collectors/_same-complex.mjs 한 곳).
--   매일 굽기(daily-deploy) 앞 단계에서 바뀐 행만 고친다. NULL = 아직 안 채운 새 행.
--
-- 이 파일만으로는 화면이 **바뀌지 않는다** — VIEW 가 이 칸을 읽는 것은 다) 단계의 별도 마이그레이션이다.
--
-- ⚠️ 공유 DB: `apartments` 는 이 프로젝트 소유 표. 자매 레포(naver-estate-web)는 이 표를 **읽는다**
--   (backend/db/mb_models.py 가 칸을 하나씩 적어 매핑 — 칸 추가는 그쪽 조회를 깨지 않는다).
--   기존 칸·타입·순서를 바꾸지 않는다. VIEW apartments_flat 은 만들 때 칸 목록이 펼쳐져 저장되므로
--   (`SELECT *` 가 그 시점 칸으로 고정) 이 칸이 VIEW 출력에 끼어들지 않는다.
--
-- ⚠️ 적용: 메인 세션이 psql 로(운영 DB 에서 BEGIN → 적용 → 확인 → ROLLBACK 리허설 1회 뒤 본 적용).
--   적용 시각은 KST 03:00~06:30(굽기·증분 수집·로컬 러너)과 월·목 08~14시(네이버 러너)를 피한다.
--   ADD COLUMN(기본값 없음, NULL 허용)은 표를 다시 쓰지 않아 즉시 끝나지만 잠금은 잠깐 필요하다 →
--   오래 도는 쿼리 뒤에 줄 서서 표 전체를 막지 않게 lock_timeout 을 건다.
--
-- 적용 확인 쿼리(기대: 1행 · data_type = text · is_nullable = YES):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'apartments' AND column_name = 'complex_key';
--
-- ROLLBACK: _rollbacks/20261002000001_rollback_apartments_complex_key.sql

SET lock_timeout = '5s';

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS complex_key TEXT;

COMMENT ON COLUMN apartments.complex_key IS
  '같은 단지 묶음 열쇠(뼈대 이름#블록 토큰#임대 낱말#임대 표시#시도#구 첫 낱말). scripts/collectors/assign-complex-keys.mjs 가 매일 전 행을 다시 계산해 채운다(규칙 = scripts/collectors/_same-complex.mjs). NULL = 아직 안 채운 새 행 — 읽는 쪽은 COALESCE(complex_key, id) 로 묶는다';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
