-- trade_stats.complex_area — 같은 단지 전세가율·적정가를 계산한 대표 전용면적(㎡) 칸 (세션650)
--
-- 배경: 2u(naver-estate-web) 미분양 상세가 같은 단지 전세가율(complex_jeonse_rate)을 "전세율(이 단지 84㎡)" 처럼
--   어느 평수 기준인지 함께 보여 주려 한다(2u 부탁 10/18). 2u 가 면적을 따로 구하면 우리가 계산에 쓴 면적과
--   어긋날 수 있다 → 계산 때 그 면적을 같은 행에 같이 저장한다(사장님 결정 "칸 추가").
--   값 = scripts/collectors/_trade-scope.mjs computeScopeStats 의 대표 면적 A(apartments 대표 가격 면적,
--   trade-stats.mjs buildLatestPriceMap)를 소수 넷째 자리 반올림(84.9967 은 그대로 — "84㎡/85㎡" 같은 화면 표기는
--   읽는 쪽이 내림·반올림을 골라 정한다). 모르면 NULL. NUMERIC(8,4) 상한(9999.9999)을 넘는 A 는 코드가 NULL 로 둔다.
--
-- 채우는 주체: scripts/collectors/trade-stats.mjs (SCOPE_COLS 14개 중 하나 — 옛 칸 행·새 칸만 행 두 줄기 모두 실린다).
--
-- ⚠️ 공유 DB: trade_stats 는 이 프로젝트 소유 표, 2u 가 칸을 하나씩 적어 읽는다(supabase/ownership.json).
--   칸 추가는 그쪽 조회를 깨지 않는다. 기존 칸·타입·순서를 바꾸지 않는다.
--   VIEW apartments_flat(20261007000000_view_add_trade_scope.sql)은 trade_stats 칸을 이름으로 골라 읽으므로(ts.* 없음)
--   이 칸이 VIEW·공개 JSON 에 끼어들지 않는다.
--   권한: 기존 표에 칸 추가 → 표 권한을 그대로 따른다(GRANT 불필요 · 권한 기준선 영향 0).
--
-- ⚠️ 순서: 이 마이그를 **먼저** 운영에 적용한 뒤 코드(SCOPE_COLS 에 complex_area)를 합친다.
--   칸 없이 코드가 먼저 돌면 trade-stats upsert 전체가 실패한다(PGRST204).
--   적용은 메인 세션이 supabase CLI `supabase db query --file <이 파일>` 단발로(db push 금지) —
--   리허설은 BEGIN…ROLLBACK 로 감싼 사본 파일을 같은 명령으로 1회 돌려 확인한 뒤 본 적용.
--   적용 시각은 KST 03:00~06:30(굽기·증분 수집·로컬 러너)과 월·목 08~14시(네이버 러너)를 피한다.
--   ADD COLUMN(기본값 없음, NULL 허용)은 표를 다시 쓰지 않지만 잠금은 잠깐 필요하다 → lock_timeout 을 건다.
--
-- 적용 확인 쿼리(기대: 1행 · complex_area numeric 8 4 YES):
--   SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'trade_stats' AND column_name = 'complex_area';
--
-- ROLLBACK: _rollbacks/20261018000001_rollback_trade_stats_complex_area.sql

SET lock_timeout = '5s';

ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS complex_area NUMERIC(8,4);

COMMENT ON COLUMN trade_stats.complex_area IS
  '같은 단지 전세가율(complex_jeonse_rate)·적정가(cmp_fair_price)를 계산한 대표 전용면적(㎡, 소수 넷째 반올림 — 화면 표기(84/85·전용)는 읽는 쪽이 정함). 모르면 NULL. scripts/collectors/_trade-scope.mjs computeScopeStats 의 A · 2u 가 읽음(전세율 라벨의 평수)';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
