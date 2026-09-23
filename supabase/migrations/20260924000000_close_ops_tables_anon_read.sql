-- 운영 표 4개(collector_runs·api_quota_log·monitor_alert_state·monitor_daily_snapshot)의
-- 공개(anon/authenticated) 읽기를 막는다. 이 DB 의 anon key 는 자매 사이트(2u.pe.kr) 번들에
-- 공개돼 있어, 이 표의 "Public read" 정책이 사실상 인터넷 전체에 열린 읽기다(세션567 보안 점검).
-- 관리자 화면(api/admin/collector-status.ts)은 이 마이그와 같은 PR 에서 서비스 키
-- (getMibuyangSupabase)로 먼저 옮겼으므로, anon 읽기를 막아도 그 화면은 계속 동작한다.
-- 민감값(키·토큰) 자체는 이 4표에 없다 — 실측 0건. 막는 이유는 "운영 내부 지표(수집기 실행
-- 이력·API 호출량·알림 상태·일별 스냅샷)를 굳이 공개로 둘 이유가 없다"는 최소권한 원칙.
-- ROLLBACK: _rollbacks/20260924000001_rollback_close_ops_tables_anon_read.sql

DROP POLICY IF EXISTS "Public read" ON collector_runs;
DROP POLICY IF EXISTS "Public read" ON api_quota_log;
DROP POLICY IF EXISTS "Public read" ON monitor_alert_state;
DROP POLICY IF EXISTS "Public read" ON monitor_daily_snapshot;

REVOKE SELECT ON collector_runs FROM anon, authenticated;
REVOKE SELECT ON api_quota_log FROM anon, authenticated;
REVOKE SELECT ON monitor_alert_state FROM anon, authenticated;
REVOKE SELECT ON monitor_daily_snapshot FROM anon, authenticated;

-- 자체검사 — anon/authenticated 가 이 4표를 더 이상 못 읽고, 이 4표에 그 역할을 향한
-- SELECT 정책(anon/authenticated/public)이 하나도 남지 않았는지 확인한다.
DO $$
DECLARE
  t TEXT;
  leftover_policy TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['collector_runs', 'api_quota_log', 'monitor_alert_state', 'monitor_daily_snapshot']
  LOOP
    IF has_table_privilege('anon', t, 'SELECT') THEN
      RAISE EXCEPTION 'close_ops_tables_anon_read: anon still has SELECT on %', t;
    END IF;
    IF has_table_privilege('authenticated', t, 'SELECT') THEN
      RAISE EXCEPTION 'close_ops_tables_anon_read: authenticated still has SELECT on %', t;
    END IF;
  END LOOP;

  SELECT p.tablename || '::' || p.policyname INTO leftover_policy
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN ('collector_runs', 'api_quota_log', 'monitor_alert_state', 'monitor_daily_snapshot')
    AND p.cmd IN ('SELECT', 'ALL')
    -- "Service write"(USING auth.role() = 'service_role')는 서비스 역할만 통과 — 공개 대상 아님(2026-09-24 운영 적용 시 이 검사가 그 정책까지 잡아 전부 취소됐다)
    -- 부분 일치(LIKE %service_role%)는 "service_role … OR true" 같은 위험한 정책까지 빼 버린다(세션567 검사관) — 실제 DB 의 서비스 전용 정책 43개와 **정확히 같은 문구**만 뺀다
    AND NOT (coalesce(p.qual, '') = '(auth.role() = ''service_role''::text)' AND p.with_check IS NULL)
    AND (
      'anon' = ANY(p.roles) OR 'authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)
    )
  LIMIT 1;

  IF leftover_policy IS NOT NULL THEN
    RAISE EXCEPTION 'close_ops_tables_anon_read: leftover public-facing policy %', leftover_policy;
  END IF;
END $$;
