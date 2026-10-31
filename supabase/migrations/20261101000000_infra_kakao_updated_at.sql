-- infra.kakao_updated_at — 카카오 입지 8종+지하철 전용 시계 칸 (세션681 · BACKLOG A-27 · 정본 C3 해소)
--
-- 왜: infra.updated_at 은 공유 시계다 — 트리거 trg_infra_updated(BEFORE UPDATE ON infra, 열 지정 없음 ·
--   init 20260313024159_init_mibunyang.sql:366-367)가 **모든 UPDATE** 에 now() 를 찍는다. 같은 행을
--   police·childcare·emergency·air-quality(미분양)와 2u 환경 배치가 UPDATE 하므로, infra-kakao.mjs 의
--   「30일 지나면 다시 잼」 판정(buildFreshIds)이 남이 찍은 시각으로 「최신」이 되어 사실상 꺼져 있었다.
--   2026-10-31 실측: 3,440행 중 3,255행이 2026-10-18T13:59:24Z 같은 초(남의 일괄 UPDATE).
--   2u 는 같은 문제를 같은 방법으로 풀었다(2u V053 childcare_updated_at · V054 emergency_updated_at).
--   설계서 = docs/superpowers/specs/2026-10-31-infra-kakao-updated-at-design.md
--
-- 채우는 주체: scripts/collectors/infra-kakao.mjs 만(성공한 upsert 행에만 자기 손으로 · 트리거 없음).
--   NULL = 카카오로 잰 적 없음(기존 3,440행 전부 NULL 로 시작 → 수집기가 한 회차 800곳씩 오래된 순으로 채움).
--   기본값 없음 · 가짜 날짜로 채우지 않는다. 좌표 정정 도구(fix-placeholder-addresses·fix-sosa-coordinates)는
--   INFRA_KAKAO_COLUMNS 로 카카오 칸을 비울 때 이 칸도 NULL 로 비운다.
--
-- ⚠️ 공유 DB: infra 는 미분양 ↔ 2u 공유 표(정본 supabase/ownership.json tables.infra). 이 칸은 미분양 소유.
--   2u 영향 0 — 2u ORM(mb_models.Infra)은 칸을 하나씩 매핑해 모르는 칸은 SELECT 에 안 들어가고, 원시
--   `SELECT * … infra` 0건. VIEW apartments_flat 은 칸 목록이 펼쳐져 저장돼 이 칸이 끼어들지 않는다.
--   기존 칸·타입·트리거·updated_at 의미는 바꾸지 않는다(칸 추가만).
--
-- ⚠️ 적용 순서 = **DB 먼저, 코드(PR) 합치기는 같은 날 그 뒤**(2u V053 교훈). 코드가 먼저 나가면 select 가
--   없는 칸으로 실패해 고칠 때까지 매 회차 실패한다(main().catch 가 collector_runs 에 failure 1행 → 감시 ⑬).
--   적용 시각은 KST 03:00~06:30(굽기·증분 수집)과 월·목 08~14시(네이버 러너)를 피하고, 월요일 09:00 KST
--   (감시 ⑲ 소유권 정본 대조) 전에 코드 합치기까지 끝낸다.
--   ADD COLUMN(기본값 없음, NULL 허용)은 표를 다시 쓰지 않지만 잠금은 잠깐 필요하다 → lock_timeout 을 건다.
--   적용 뒤: supabase-js(service_role)로 select("kakao_updated_at").limit(1) 1회 · node scripts/perm-baseline.mjs 미리보기.
--
-- 적용 확인 쿼리(기대 1행 · timestamp with time zone · YES):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='infra' AND column_name='kakao_updated_at';
--
-- ROLLBACK: _rollbacks/20261101000001_rollback_infra_kakao_updated_at.sql
--   = ALTER TABLE infra DROP COLUMN IF EXISTS kakao_updated_at; NOTIFY pgrst, 'reload schema';
--   (되돌릴 때는 코드 먼저 되돌리고 DB)

SET lock_timeout = '5s';

ALTER TABLE infra ADD COLUMN IF NOT EXISTS kakao_updated_at TIMESTAMPTZ;   -- 기본값 없음 · NULL = 카카오로 잰 적 없음

COMMENT ON COLUMN infra.kakao_updated_at IS
  'infra-kakao.mjs(미분양) 가 카카오 8종+지하철을 잰 시각 — 30일 재확인 시계. 공유 시계 updated_at(트리거) 과 별개. NULL = 잰 적 없음. 세션681';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
