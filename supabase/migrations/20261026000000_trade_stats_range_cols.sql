-- trade_stats 실거래 범위 4칸 — cmp_min · cmp_max · complex_jeonse_min · complex_jeonse_max (세션661)
--
-- 배경: 손님 화면이 실거래를 "중앙값 하나"로 보여 주던 두 자리(시세 탭 비교 상자 · 목록 카드 칩)를
--   "최저~최고 범위 + 가운데 값 작게"로 바꾼다(사장님 결정 10/25 ①②③ · 설계서
--   .omc/artifacts/session661/trade-range/design.md v2). 같은 단지 같은 면적은 complex_table 에 min/max 가 있지만
--   상세 꾸러미 전용이라 카드가 못 쓰고, ㎡당 환산·같은 동 또래는 어디에도 없다 → 수집기가 저장한다.
--   값 = scripts/collectors/_trade-scope.mjs computeScopeStats 가 **적정가(cmp_fair_price)·전세가율(complex_jeonse_rate)과
--   같은 거래 집합**에서 낸 최저·최고(만원, 정수):
--     cmp_min/max          — same_area: 같은 면적 거래 · per_m2: ㎡당 값의 최저·최고 × 대표 면적(반올림) ·
--                            dong_peer: 같은 동 또래(±10년) 거래 · 범위 none 이면 NULL
--     complex_jeonse_min/max — 같은 단지 같은 면적 전세(갱신 제외, complex_jeonse_n 과 같은 집합) 1건 이상이면 저장
--                            (전세가율은 3건 문턱이라 범위만 있고 전세가율은 없을 수 있다 — 정상)
--   점수 계산·점수 문장은 이 칸을 읽지 않는다(사장님 결정 ④ — 점수는 그대로 가운데 값).
--
-- 채우는 주체: scripts/collectors/trade-stats.mjs (SCOPE_COLS 18개 중 넷 — 옛 칸 행·새 칸만 행 두 줄기 모두 실린다).
--
-- ⚠️ 공유 DB: trade_stats 는 이 프로젝트 소유 표, 2u 가 칸을 하나씩 적어 읽는다(supabase/ownership.json).
--   칸 추가는 그쪽 조회를 깨지 않는다. 기존 칸·타입·순서를 바꾸지 않는다.
--   VIEW apartments_flat 은 trade_stats 칸을 이름으로 골라 읽으므로(ts.* 없음) 이 마이그만으로는 VIEW·공개 JSON 에
--   끼어들지 않는다 — VIEW 노출은 20261026000002_view_add_range_cols.sql 이 따로 한다.
--   권한: 기존 표에 칸 추가 → 표 권한을 그대로 따른다(GRANT 불필요 · 권한 기준선 영향 0).
--
-- ⚠️ 순서(설계서 §6): 이 마이그를 **먼저** 운영에 적용한 뒤 코드(SCOPE_COLS 18칸)를 합친다.
--   칸 없이 코드가 먼저 돌면 trade-stats upsert 전체가 실패한다(PGRST204).
--   그다음 VIEW 마이그(20261026000002) → 전이표 승인 → 손 실행 1회(collect-trade-stats.yml workflow_dispatch).
--   적용은 메인 세션이 supabase CLI `supabase db query --linked --file <이 파일>` 단발로(db push 금지) —
--   리허설은 BEGIN…ROLLBACK 로 감싼 사본 파일을 같은 명령으로 1회 돌려 확인한 뒤 본 적용.
--   적용 시각은 KST 03:00~06:30(굽기·증분 수집·로컬 러너)과 월·목 08~14시(네이버 러너)를 피한다.
--   ADD COLUMN(기본값 없음, NULL 허용)은 표를 다시 쓰지 않지만 잠금은 잠깐 필요하다 → lock_timeout 을 건다.
--
-- 적용 확인 쿼리(기대: 4행 · 전부 integer YES):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'trade_stats'
--      AND column_name IN ('cmp_min', 'cmp_max', 'complex_jeonse_min', 'complex_jeonse_max') ORDER BY column_name;
--
-- ROLLBACK: _rollbacks/20261026000001_rollback_trade_stats_range_cols.sql

SET lock_timeout = '5s';

ALTER TABLE trade_stats
  ADD COLUMN IF NOT EXISTS cmp_min INTEGER,
  ADD COLUMN IF NOT EXISTS cmp_max INTEGER,
  ADD COLUMN IF NOT EXISTS complex_jeonse_min INTEGER,
  ADD COLUMN IF NOT EXISTS complex_jeonse_max INTEGER;

COMMENT ON COLUMN trade_stats.cmp_min IS
  '적정가(cmp_fair_price)와 같은 거래 집합의 최저 실거래가(만원). same_area = 같은 면적 거래 · per_m2 = ㎡당 최저 × 대표 면적(반올림) · dong_peer = 같은 동 또래 거래 · 범위 none 이면 NULL. scripts/collectors/_trade-scope.mjs computeScopeStats (세션661)';
COMMENT ON COLUMN trade_stats.cmp_max IS
  '적정가(cmp_fair_price)와 같은 거래 집합의 최고 실거래가(만원). same_area = 같은 면적 거래 · per_m2 = ㎡당 최고 × 대표 면적(반올림) · dong_peer = 같은 동 또래 거래 · 범위 none 이면 NULL. scripts/collectors/_trade-scope.mjs computeScopeStats (세션661)';
COMMENT ON COLUMN trade_stats.complex_jeonse_min IS
  '같은 단지 같은 면적 전세(갱신 제외 — complex_jeonse_n 과 같은 집합)의 최저 보증금(만원). 1건 이상이면 저장(전세가율은 3건 문턱이라 범위만 있을 수 있다). 없으면 NULL. scripts/collectors/_trade-scope.mjs computeScopeStats (세션661)';
COMMENT ON COLUMN trade_stats.complex_jeonse_max IS
  '같은 단지 같은 면적 전세(갱신 제외 — complex_jeonse_n 과 같은 집합)의 최고 보증금(만원). 1건 이상이면 저장(전세가율은 3건 문턱이라 범위만 있을 수 있다). 없으면 NULL. scripts/collectors/_trade-scope.mjs computeScopeStats (세션661)';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
