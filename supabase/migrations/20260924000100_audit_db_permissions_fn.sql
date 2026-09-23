-- 주 1회(월요일) DB 권한 실측 점검 함수 — monitor-collectors.mjs 가 서비스 키로 호출한다.
-- 이 DB 의 anon key 가 자매 사이트 번들에 공개돼 있으므로(세션567), "코드가 이렇게 짜여
-- 있으니 안전할 것"이 아니라 pg_catalog 를 직접 읽어 실제 권한 상태를 매주 재확인한다.
-- SECURITY INVOKER + search_path 고정 — 호출자(service_role) 권한으로만 동작하고,
-- 스키마 스푸핑을 막기 위해 모든 카탈로그 참조를 pg_catalog. 로 완전 수식한다.
-- ROLLBACK: _rollbacks/20260924000101_rollback_audit_db_permissions_fn.sql

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
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(row), '[]'::jsonb)
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
            SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(DISTINCT pg_catalog.jsonb_build_object(
              'column', a.attname,
              'grantee', r.rolname,
              'privilege', acl.privilege_type
            )), '[]'::jsonb)
            FROM pg_catalog.pg_attribute a
            CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.coalesce(a.attacl, ARRAY[]::aclitem[])) AS acl
            JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
            WHERE a.attrelid = c.oid
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
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
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
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
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
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(e.extname), '[]'::jsonb)
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname = 'public'
    ),

    -- security_invoker 가 아닌(=security_definer 성격의) public 뷰.
    'definer_views', (
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(c.relname), '[]'::jsonb)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND pg_catalog.coalesce(
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

-- 자체검사 — anon/authenticated 가 이 함수를 실행할 수 없는지 확인한다.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.audit_db_permissions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'audit_db_permissions_fn: anon can still execute audit_db_permissions()';
  END IF;
  IF has_function_privilege('authenticated', 'public.audit_db_permissions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'audit_db_permissions_fn: authenticated can still execute audit_db_permissions()';
  END IF;
END $$;
