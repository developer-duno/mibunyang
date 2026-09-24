-- ROLLBACK for 20260924000400_permission_fingerprint.sql
-- 새 물건(함수 3개·기준선 표 2개)을 지우고, 점검 함수를 20260924000100 판 원문 그대로 되돌린다.
-- ⚠️ 기준선 표를 지우면 승인 기록도 함께 사라진다(되살릴 수 없다) — 되돌리기 전에 필요하면 덤프해 둘 것.

DROP FUNCTION IF EXISTS public.accept_permission_baseline(text, text);
DROP FUNCTION IF EXISTS public.permission_drift_snapshot();
DROP FUNCTION IF EXISTS public.permission_fingerprint();
DROP TABLE IF EXISTS public.permission_baseline_item;
DROP TABLE IF EXISTS public.permission_baseline;

-- 옛 점검 함수(20260924000100_audit_db_permissions_fn.sql:8-124 원문)
CREATE OR REPLACE FUNCTION public.audit_db_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'checked_at', pg_catalog.now(),

    -- 관계별 권한 — anon/authenticated 의 SELECT/INSERT/UPDATE/DELETE/TRUNCATE + RLS 상태.
    'relations', (
      SELECT coalesce(pg_catalog.jsonb_agg(row), '[]'::jsonb)
      FROM (
        SELECT pg_catalog.jsonb_build_object(
          'schema', n.nspname,
          'name', c.relname,
          'kind', c.relkind,
          'rls_enabled', c.relrowsecurity,
          'rls_forced', c.relforcerowsecurity,
          'anon_select', pg_catalog.has_table_privilege('anon', c.oid, 'SELECT'),
          'anon_insert', pg_catalog.has_table_privilege('anon', c.oid, 'INSERT'),
          'anon_update', pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE'),
          'anon_delete', pg_catalog.has_table_privilege('anon', c.oid, 'DELETE'),
          'anon_truncate', pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE'),
          'authenticated_select', pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT'),
          'authenticated_insert', pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT'),
          'authenticated_update', pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE'),
          'authenticated_delete', pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE'),
          'authenticated_truncate', pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE'),
          -- 칸 단위 GRANT(anon/authenticated 가 INSERT/UPDATE 가능한 컬럼) — 표 권한이 없어도
          -- 컬럼 GRANT 가 단독으로 열려 있을 수 있으므로 attacl 을 직접 펼친다(2u user_profiles 형).
          'column_write_grants', (
            SELECT coalesce(pg_catalog.jsonb_agg(DISTINCT pg_catalog.jsonb_build_object(
              'column', a.attname,
              'grantee', r.rolname,
              'privilege', acl.privilege_type
            )), '[]'::jsonb)
            FROM pg_catalog.pg_attribute a
            CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl  -- 빈 배열(0차원)을 넣으면 "ACL arrays must be one-dimensional" 오류 — 칸 권한 있는 칸만(2026-09-24 운영 DB 실측)
            JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
            WHERE a.attrelid = c.oid
              AND a.attacl IS NOT NULL
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND r.rolname IN ('anon', 'authenticated')
              AND acl.privilege_type IN ('INSERT', 'UPDATE')
          )
        ) AS row
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
      ) t
    ),

    -- public 스키마의 RLS 정책 전체 (표·이름·명령·역할·조건).
    'policies', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'table', p.tablename,
        'name', p.policyname,
        'cmd', p.cmd,
        'roles', p.roles,
        'permissive', p.permissive,
        'qual', p.qual,
        'with_check', p.with_check
      )), '[]'::jsonb)
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
    ),

    -- anon/authenticated 가 실행 가능한 SECURITY DEFINER 함수.
    'definer_functions', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'schema', n.nspname,
        'name', p.proname,
        'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )), '[]'::jsonb)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
        AND (
          pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )
    ),

    -- public 스키마에 설치된 확장(원래 있으면 안 되는 확장 침투 감시).
    'public_extensions', (
      SELECT coalesce(pg_catalog.jsonb_agg(e.extname), '[]'::jsonb)
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname = 'public'
    ),

    -- security_invoker 가 아닌(=security_definer 성격의) public 뷰.
    'definer_views', (
      SELECT coalesce(pg_catalog.jsonb_agg(c.relname), '[]'::jsonb)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND coalesce(
          (SELECT (option_value = 'true')
           FROM pg_catalog.pg_options_to_table(c.reloptions) o
           WHERE o.option_name = 'security_invoker'),
          false
        ) = false
    )
  );
$$;

-- anon/authenticated/public 은 이 함수를 실행할 수 없다 — service_role 전용(주 1회 점검용).
REVOKE ALL ON FUNCTION public.audit_db_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_db_permissions() TO service_role;
