-- 세션 276: Supabase Advisor 잔여 보안 경고 4건 해소.
-- 배경: 세션 274 가 "RLS Disabled in Public" 16개 중 mibunyang+공유 6개 해소.
-- 잔여 mibunyang 항목 = security_definer_view(WARN) × 2 + function_search_path_mutable(ERROR) × 2.
--
-- VIEW 2개 (apartments_flat·api_quota_daily): security_invoker=on 으로 전환.
--   ALTER VIEW ... SET 사용 — DROP/재정의 안 함 (DROP VIEW 는 GRANT 동반 삭제).
--   live 검증: apartments_flat JOIN 9테이블(apartments·prices·infra·schools·transport·
--   builders·regions·trade_stats·applyhome_events) + api_quota_log 전부
--   "Public read" SELECT USING(true) 정책 + anon SELECT GRANT 보유 → anon 조회 무영향.
--
-- 함수 2개 (update_updated_at·update_scores_computed_at): SET search_path='' 추가.
--   본문은 NOW()(pg_catalog 내장 — search_path 무관) + NEW/OLD 트리거 변수만 사용 →
--   본문 무수정. CREATE OR REPLACE FUNCTION 은 트리거 7개 바인딩 유지 → 트리거 재생성 불필요.
--
-- ROLLBACK: _rollbacks/20260519130000_rollback_fix_security_definer.sql

-- VIEW: security_invoker 활성화 (옵션만 변경, 본문/GRANT 보존)
ALTER VIEW apartments_flat SET (security_invoker = on);
ALTER VIEW api_quota_daily SET (security_invoker = on);

-- 함수: search_path 고정 (Supabase 권장값 = 빈 문자열)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_scores_computed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.cats_cache IS DISTINCT FROM OLD.cats_cache THEN
    NEW.scores_computed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
