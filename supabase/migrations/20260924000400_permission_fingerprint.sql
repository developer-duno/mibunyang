-- 감시 ⑩ 범위 보강 — 권한 정의 지문 + 승인 기준선(세션569).
--
-- 무엇: 권한과 관련된 DB 정의(표·뷰·정책·칸 권한·함수·기본 권한·확장·역할·저장소 버킷)를
--   항목 단위로 정규화해 해시(지문)로 뜨고, 사람이 승인한 기준선(아래 두 표)과 대조한다.
--   기존 점검(R1~R8)은 "위험한 모양인가"를, 지문은 "승인 뒤 바뀌었나"를 본다 — 둘 다 돈다.
-- 원칙: 값(기준선 내용)은 DB 에만, 코드는 공개 저장소에. 설계 문서는 비공개(.omc/, 깃 미추적).
-- 적용: 사장님 승인 뒤 psql --single-transaction + lock_timeout 래퍼로(파일 안에 BEGIN/COMMIT 없음).
--   끝의 자체검사가 하나라도 어긋나면 RAISE EXCEPTION → 전부 취소된다.
-- ⚠️ search_path = '' 함수 안에서 COALESCE·NULLIF·CASE·GREATEST·LEAST 는 문법 요소라 스키마를 붙이지 않는다.
-- ⚠️ aclexplode 에 빈(0차원) 배열을 넣으면 오류 → CASE WHEN cardinality(x) > 0 THEN x END 로 NULL(0행) 처리.
-- ROLLBACK: _rollbacks/20260924000401_rollback_permission_fingerprint.sql

-- ── 1. 기준선 표 2개 (서비스 전용, 추가만 되는 기록) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.permission_baseline (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accepted_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  note                text        NOT NULL,
  total_hash          text        NOT NULL,
  item_count          integer     NOT NULL,
  server_version_num  integer     NOT NULL,
  scope_version       integer     NOT NULL
);

CREATE TABLE IF NOT EXISTS public.permission_baseline_item (
  baseline_id  bigint NOT NULL REFERENCES public.permission_baseline(id) ON DELETE CASCADE,
  kind         text   NOT NULL,
  name         text   NOT NULL,
  def          jsonb  NOT NULL,
  hash         text   NOT NULL,
  PRIMARY KEY (baseline_id, kind, name)
);

-- RLS 켬 + 정책 0 → anon/authenticated 는 0행. service_role 은 BYPASSRLS 라 읽고 쓴다.
ALTER TABLE public.permission_baseline      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_baseline_item ENABLE ROW LEVEL SECURITY;

-- Supabase 는 public 새 표에 anon·authenticated·service_role 모두에게 모든 권한을 기본으로 준다 →
-- 네 역할 전부 회수한 뒤 service_role 에 SELECT·INSERT 만 다시 준다(UPDATE·DELETE·TRUNCATE 없음 = 추가만).
REVOKE ALL ON public.permission_baseline, public.permission_baseline_item FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.permission_baseline, public.permission_baseline_item TO service_role;

-- IDENTITY 시퀀스에도 기본 권한이 붙을 수 있으므로 회수한다(이름은 동적으로 찾는다).
-- IDENTITY 열 INSERT 는 시퀀스 권한 없이 되는 것으로 보지만 S2 되돌림 시험 T3 에서 service_role 로 확정한다.
-- 안 되면 이 뒤에 GRANT USAGE ON SEQUENCE … TO service_role 한 줄을 추가한다(추측으로 미리 주지 않는다).
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
    pg_catalog.pg_get_serial_sequence('public.permission_baseline', 'id')
  );
END $$;

-- ── 2. 지문 함수 ───────────────────────────────────────────────────────────────
-- 범위(scope_version = 1 — 범위 규칙을 바꾸면 +1, 기준선과 다르면 감시가 재승인을 요구한다):
--   relation    public 전부(r·p·v·m·f) + storage.objects·storage.buckets 2개만
--   policy      pg_policies 의 public·storage
--   bucket      storage.buckets 모든 행
--   function    public 만, 확장 소속 제외
--   schema      public 1개
--   default_acl public 또는 전역(defaclnamespace = 0)
--   extension   전부
--   role        anon·authenticated·authenticator
-- 정렬은 전부 COLLATE "C"(세션 정렬 규칙에 흔들리지 않게). OID 는 키·정의 어디에도 안 쓴다.
CREATE OR REPLACE FUNCTION public.permission_fingerprint()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
SET timezone = 'UTC'
SET datestyle = 'ISO, YMD'
SET extra_float_digits = 1
AS $$
  WITH rl AS (
    SELECT v.r FROM (VALUES ('anon'::text), ('authenticated'::text), ('public'::text)) AS v(r)
  ),
  privs AS (
    SELECT v.p FROM (VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text),
                            ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text)) AS v(p)
  ),
  rel_target AS (
    SELECT c.oid, n.nspname::text AS nspname, c.relname::text AS relname, c.relkind::text AS relkind,
           c.relowner, c.relrowsecurity, c.relforcerowsecurity,
           (SELECT (o.option_value)::boolean
              FROM pg_catalog.pg_options_to_table(c.reloptions) o
             WHERE o.option_name = 'security_invoker') AS opt_invoker,
           (SELECT (o.option_value)::boolean
              FROM pg_catalog.pg_options_to_table(c.reloptions) o
             WHERE o.option_name = 'security_barrier') AS opt_barrier
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
       OR (n.nspname = 'storage' AND c.relname IN ('objects', 'buckets') AND c.relkind = 'r')
  ),
  rel AS (
    SELECT 'relation'::text AS k,
           t.nspname || '.' || t.relname AS n,
           pg_catalog.jsonb_build_object(
             'kind', t.relkind,
             'owner', pg_catalog.pg_get_userbyid(t.relowner)::text,
             'rls', t.relrowsecurity,
             'rls_forced', t.relforcerowsecurity,
             'security_invoker', CASE WHEN t.relkind = 'v' THEN COALESCE(t.opt_invoker, false) END,
             'security_barrier', CASE WHEN t.relkind = 'v' THEN COALESCE(t.opt_barrier, false) END,
             'grants', (
               SELECT pg_catalog.jsonb_object_agg(rr.r, (
                 SELECT COALESCE(pg_catalog.jsonb_agg(pp.p ORDER BY pp.p COLLATE pg_catalog."C"), '[]'::jsonb)
                   FROM privs pp
                  WHERE pg_catalog.has_table_privilege(rr.r, t.oid, pp.p)
               ))
               FROM rl rr
             ),
             'column_grants', (
               SELECT COALESCE(pg_catalog.jsonb_agg(s.g ORDER BY s.g COLLATE pg_catalog."C"), '[]'::jsonb)
               FROM (
                 SELECT DISTINCT
                   (CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                         ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                   || ':' || acl.privilege_type || ':' || a.attname::text AS g
                 FROM pg_catalog.pg_attribute a
                 CROSS JOIN LATERAL pg_catalog.aclexplode(
                   CASE WHEN pg_catalog.cardinality(a.attacl) > 0 THEN a.attacl END
                 ) AS acl
                 WHERE a.attrelid = t.oid
                   AND a.attnum > 0
                   AND NOT a.attisdropped
                   AND (acl.grantee = 0
                        OR pg_catalog.pg_get_userbyid(acl.grantee)::text IN ('anon', 'authenticated'))
               ) s
             ),
             -- 정의자 뷰일 때만 본문 해시(invoker 뷰는 밑 표 권한이 그대로 적용돼 본문이 보안을 못 바꾼다)
             'body_md5', CASE WHEN t.relkind = 'v' AND NOT COALESCE(t.opt_invoker, false)
                              THEN pg_catalog.md5(pg_catalog.pg_get_viewdef(t.oid)) END
           ) AS d
    FROM rel_target t
  ),
  pol AS (
    SELECT 'policy'::text AS k,
           p.schemaname::text || '.' || p.tablename::text || '/' || p.policyname::text AS n,
           pg_catalog.jsonb_build_object(
             'cmd', p.cmd,
             'permissive', p.permissive,
             'roles', (
               SELECT COALESCE(pg_catalog.jsonb_agg(x.v ORDER BY x.v COLLATE pg_catalog."C"), '[]'::jsonb)
               FROM pg_catalog.unnest(p.roles::text[]) AS x(v)
             ),
             'qual', p.qual,
             'with_check', p.with_check
           ) AS d
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname IN ('public', 'storage')
  ),
  bkt AS (
    -- ⚠️ service_role 이 storage.buckets 를 SELECT 할 수 있어야 한다(S0 에서 확인 — 불가면 좁은 정의자 도우미로 분기)
    SELECT 'bucket'::text AS k,
           b.id::text AS n,
           pg_catalog.jsonb_build_object(
             'public', b.public,
             'file_size_limit', b.file_size_limit,
             'allowed_mime_types', CASE WHEN b.allowed_mime_types IS NULL THEN NULL ELSE (
               SELECT COALESCE(pg_catalog.jsonb_agg(x.v ORDER BY x.v COLLATE pg_catalog."C"), '[]'::jsonb)
               FROM pg_catalog.unnest(b.allowed_mime_types::text[]) AS x(v)
             ) END
           ) AS d
    FROM storage.buckets b
  ),
  fn AS (
    SELECT 'function'::text AS k,
           n.nspname::text || '.' || p.proname::text
             || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS n,
           pg_catalog.jsonb_build_object(
             'kind', p.prokind::text,
             'owner', pg_catalog.pg_get_userbyid(p.proowner)::text,
             'security_definer', p.prosecdef,
             'config', (
               SELECT COALESCE(pg_catalog.jsonb_agg(x.v ORDER BY x.v COLLATE pg_catalog."C"), '[]'::jsonb)
               FROM pg_catalog.unnest(p.proconfig) AS x(v)
             ),
             'execute', (
               SELECT pg_catalog.jsonb_object_agg(rr.r, pg_catalog.has_function_privilege(rr.r, p.oid, 'EXECUTE'))
               FROM rl rr
             ),
             'body_md5', CASE WHEN p.prosecdef
                               AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                              THEN pg_catalog.md5(p.prosrc) END
           ) AS d
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend dp
         WHERE dp.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
           AND dp.objid = p.oid
           AND dp.deptype = 'e'
      )
  ),
  sch AS (
    SELECT 'schema'::text AS k,
           n.nspname::text AS n,
           pg_catalog.jsonb_build_object(
             'owner', pg_catalog.pg_get_userbyid(n.nspowner)::text,
             'usage', (SELECT pg_catalog.jsonb_object_agg(rr.r, pg_catalog.has_schema_privilege(rr.r, n.oid, 'USAGE')) FROM rl rr),
             'create', (SELECT pg_catalog.jsonb_object_agg(rr.r, pg_catalog.has_schema_privilege(rr.r, n.oid, 'CREATE')) FROM rl rr)
           ) AS d
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname = 'public'
  ),
  dacl AS (
    SELECT 'default_acl'::text AS k,
           pg_catalog.pg_get_userbyid(d.defaclrole)::text || '/' || COALESCE(n.nspname::text, '*')
             || '/' || d.defaclobjtype::text AS n,
           pg_catalog.jsonb_build_object(
             'grants', (
               SELECT COALESCE(pg_catalog.jsonb_agg(s.g ORDER BY s.g COLLATE pg_catalog."C"), '[]'::jsonb)
               FROM (
                 SELECT DISTINCT
                   (CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                         ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END)
                   || ':' || acl.privilege_type AS g
                 FROM pg_catalog.aclexplode(
                   CASE WHEN pg_catalog.cardinality(d.defaclacl) > 0 THEN d.defaclacl END
                 ) AS acl
                 WHERE acl.grantee = 0
                    OR pg_catalog.pg_get_userbyid(acl.grantee)::text IN ('anon', 'authenticated')
               ) s
             )
           ) AS d
    FROM pg_catalog.pg_default_acl d
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    WHERE d.defaclnamespace = 0 OR n.nspname = 'public'
  ),
  ext AS (
    SELECT 'extension'::text AS k,
           e.extname::text AS n,
           pg_catalog.jsonb_build_object('schema', n.nspname::text) AS d
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  ),
  rol AS (
    SELECT 'role'::text AS k,
           r.rolname::text AS n,
           pg_catalog.jsonb_build_object(
             'bypassrls', r.rolbypassrls,
             'superuser', r.rolsuper,
             -- PG16+ 는 부여자별로 여러 행 → 하위 질의에서 중복 제거 뒤 정렬
             'member_of', (
               SELECT COALESCE(pg_catalog.jsonb_agg(s.g ORDER BY s.g COLLATE pg_catalog."C"), '[]'::jsonb)
               FROM (
                 SELECT DISTINCT pg_catalog.pg_get_userbyid(m.roleid)::text AS g
                 FROM pg_catalog.pg_auth_members m
                 WHERE m.member = r.oid
               ) s
             )
           ) AS d
    FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('anon', 'authenticated', 'authenticator')
  ),
  allitems AS (
    SELECT * FROM rel
    UNION ALL SELECT * FROM pol
    UNION ALL SELECT * FROM bkt
    UNION ALL SELECT * FROM fn
    UNION ALL SELECT * FROM sch
    UNION ALL SELECT * FROM dacl
    UNION ALL SELECT * FROM ext
    UNION ALL SELECT * FROM rol
  ),
  u AS (
    SELECT a.k, a.n, a.d, pg_catalog.md5(a.d::text) AS h FROM allitems a
  )
  SELECT pg_catalog.jsonb_build_object(
    'server_version_num', (pg_catalog.current_setting('server_version_num'))::integer,
    'scope_version', 1,
    'item_count', (SELECT pg_catalog.count(*) FROM u),
    'total_hash', (
      SELECT pg_catalog.md5(pg_catalog.string_agg(u.k || '|' || u.n || '|' || u.h, E'\n'
                            ORDER BY u.k COLLATE pg_catalog."C", u.n COLLATE pg_catalog."C"))
      FROM u
    ),
    'items', (
      SELECT COALESCE(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('k', u.k, 'n', u.n, 'd', u.d, 'h', u.h)
               ORDER BY u.k COLLATE pg_catalog."C", u.n COLLATE pg_catalog."C"), '[]'::jsonb)
      FROM u
    )
  );
$$;

-- ── 3. 현재 지문 + 현재 기준선을 한 시점에 함께 ──────────────────────────────
-- 감시(JS)는 기준선 표를 직접 읽지 않는다 — RPC 한 번이 같은 시점의 둘을 준다(1,000행 페이징 없음).
CREATE OR REPLACE FUNCTION public.permission_drift_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
SET timezone = 'UTC'
SET datestyle = 'ISO, YMD'
SET extra_float_digits = 1
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'current', public.permission_fingerprint(),
    'baseline', (
      SELECT pg_catalog.jsonb_build_object(
        'id', b.id,
        'accepted_at', b.accepted_at,
        'note', b.note,
        'total_hash', b.total_hash,
        'server_version_num', b.server_version_num,
        'scope_version', b.scope_version,
        'item_count', b.item_count,
        'items', (
          SELECT COALESCE(pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object('k', i.kind, 'n', i.name, 'd', i.def, 'h', i.hash)
                   ORDER BY i.kind COLLATE pg_catalog."C", i.name COLLATE pg_catalog."C"), '[]'::jsonb)
          FROM public.permission_baseline_item i
          WHERE i.baseline_id = b.id
        )
      )
      FROM public.permission_baseline b
      ORDER BY b.id DESC
      LIMIT 1
    )
  );
$$;

-- ── 4. 기준선 승인 — 미리보기 해시와 지금 해시가 같을 때만 저장 ─────────────
-- 오류 메시지의 'hash mismatch' 글자는 되돌림 시험(T2)과 scripts/perm-baseline.mjs 가 판정에 쓴다 — 바꾸지 말 것.
CREATE OR REPLACE FUNCTION public.accept_permission_baseline(p_expected_hash text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
SET timezone = 'UTC'
SET datestyle = 'ISO, YMD'
SET extra_float_digits = 1
AS $$
DECLARE
  fp   jsonb;
  v_id bigint;
BEGIN
  IF p_note IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_note)) < 5 THEN
    RAISE EXCEPTION 'accept_permission_baseline: note too short (min 5 chars)';
  END IF;

  fp := public.permission_fingerprint();

  IF p_expected_hash IS NULL OR (fp ->> 'total_hash') IS DISTINCT FROM p_expected_hash THEN
    RAISE EXCEPTION 'accept_permission_baseline: hash mismatch (expected %, actual %)',
      COALESCE(p_expected_hash, '(null)'), fp ->> 'total_hash';
  END IF;

  INSERT INTO public.permission_baseline (note, total_hash, item_count, server_version_num, scope_version)
  VALUES (
    p_note,
    fp ->> 'total_hash',
    (fp ->> 'item_count')::integer,
    (fp ->> 'server_version_num')::integer,
    (fp ->> 'scope_version')::integer
  )
  RETURNING id INTO v_id;

  INSERT INTO public.permission_baseline_item (baseline_id, kind, name, def, hash)
  SELECT v_id, e ->> 'k', e ->> 'n', e -> 'd', e ->> 'h'
  FROM pg_catalog.jsonb_array_elements(fp -> 'items') AS e;

  RETURN pg_catalog.jsonb_build_object(
    'baseline_id', v_id,
    'item_count', (fp ->> 'item_count')::integer,
    'total_hash', fp ->> 'total_hash'
  );
END;
$$;

-- ── 5. 기존 점검 함수 교체(구멍 ③·⑥) ─────────────────────────────────────────
--   ③ definer_views: option_value 를 글자 'true' 로 비교하던 것을 boolean 해석(on/yes/true/1 모두 참)으로
--   ⑥ relations 에 anon_select_any·authenticated_select_any(표 권한 또는 칸 SELECT 권한) 추가,
--      column_write_grants 에 받는이 PUBLIC 포함(pg_roles JOIN 이 grantee 0 을 버리던 것 제거)
--   relkind 는 r/p 유지(뷰·구체화 뷰는 지문 + R8 이 맡는다).
CREATE OR REPLACE FUNCTION public.audit_db_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'checked_at', pg_catalog.now(),

    'relations', (
      SELECT COALESCE(pg_catalog.jsonb_agg(row), '[]'::jsonb)
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
          -- 표 권한 또는 칸 하나라도 SELECT 권한이 있으면 참(PG 문서 functions-info has_any_column_privilege)
          'anon_select_any', pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT'),
          'authenticated_select_any', pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT'),
          -- 칸 단위 쓰기 GRANT — 받는이 anon·authenticated·PUBLIC(grantee 0).
          'column_write_grants', (
            SELECT COALESCE(pg_catalog.jsonb_agg(DISTINCT pg_catalog.jsonb_build_object(
              'column', a.attname,
              'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                              ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END,
              'privilege', acl.privilege_type
            )), '[]'::jsonb)
            FROM pg_catalog.pg_attribute a
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              CASE WHEN pg_catalog.cardinality(a.attacl) > 0 THEN a.attacl END
            ) AS acl
            WHERE a.attrelid = c.oid
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND (acl.grantee = 0
                   OR pg_catalog.pg_get_userbyid(acl.grantee)::text IN ('anon', 'authenticated'))
              AND acl.privilege_type IN ('INSERT', 'UPDATE')
          )
        ) AS row
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
      ) t
    ),

    'policies', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
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

    'definer_functions', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
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

    'public_extensions', (
      SELECT COALESCE(pg_catalog.jsonb_agg(e.extname), '[]'::jsonb)
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname = 'public'
    ),

    -- security_invoker 가 참이 아닌 public 뷰 — 옵션 값은 boolean 으로 해석한다
    -- (ALTER VIEW … SET (security_invoker = on) 은 reloptions 에 'on' 으로 남는다).
    'definer_views', (
      SELECT COALESCE(pg_catalog.jsonb_agg(c.relname), '[]'::jsonb)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND COALESCE(
          (SELECT (o.option_value)::boolean
           FROM pg_catalog.pg_options_to_table(c.reloptions) o
           WHERE o.option_name = 'security_invoker'),
          false
        ) = false
    )
  );
$$;

-- ── 6. 실행 권한 — service_role 전용 ─────────────────────────────────────────
REVOKE ALL ON FUNCTION public.permission_fingerprint() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.permission_drift_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_permission_baseline(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_db_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.permission_fingerprint() TO service_role;
GRANT EXECUTE ON FUNCTION public.permission_drift_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_permission_baseline(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_db_permissions() TO service_role;

-- ── 7. 자체검사 — 하나라도 어긋나면 전부 취소 ────────────────────────────────
DO $$
DECLARE
  fnames text[] := ARRAY[
    'public.permission_fingerprint()',
    'public.permission_drift_snapshot()',
    'public.accept_permission_baseline(text, text)',
    'public.audit_db_permissions()'
  ];
  tnames text[] := ARRAY['public.permission_baseline', 'public.permission_baseline_item'];
  f   text;
  t   text;
  r   text;
  pv  text;
  seq text;
BEGIN
  -- ① 함수 4개: anon·authenticated 실행 불가, service_role 실행 가능
  FOREACH f IN ARRAY fnames LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION 'permission_fingerprint self-check: % can execute %', r, f;
      END IF;
    END LOOP;
    IF NOT pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'permission_fingerprint self-check: service_role cannot execute %', f;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY tnames LOOP
    -- ② anon·authenticated 는 표 권한·칸 SELECT 권한 0
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF pg_catalog.has_table_privilege(r, t, pv) THEN
          RAISE EXCEPTION 'permission_fingerprint self-check: % has % on %', r, pv, t;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(r, t, 'SELECT') THEN
        RAISE EXCEPTION 'permission_fingerprint self-check: % has column SELECT on %', r, t;
      END IF;
    END LOOP;
    -- ③ service_role 은 SELECT·INSERT 만(추가만 되는 기록)
    FOREACH pv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF pg_catalog.has_table_privilege('service_role', t, pv) THEN
        RAISE EXCEPTION 'permission_fingerprint self-check: service_role has % on %', pv, t;
      END IF;
    END LOOP;
    FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', t, pv) THEN
        RAISE EXCEPTION 'permission_fingerprint self-check: service_role lacks % on %', pv, t;
      END IF;
    END LOOP;
    -- ④ RLS 켬 + 정책 0
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t::pg_catalog.regclass) THEN
      RAISE EXCEPTION 'permission_fingerprint self-check: RLS off on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy po WHERE po.polrelid = t::pg_catalog.regclass) THEN
      RAISE EXCEPTION 'permission_fingerprint self-check: policy exists on %', t;
    END IF;
  END LOOP;

  -- ⑤ IDENTITY 시퀀스: anon·authenticated 권한 0
  seq := pg_catalog.pg_get_serial_sequence('public.permission_baseline', 'id');
  IF seq IS NULL THEN
    RAISE EXCEPTION 'permission_fingerprint self-check: identity sequence not found';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF pg_catalog.has_sequence_privilege(r, seq, pv) THEN
        RAISE EXCEPTION 'permission_fingerprint self-check: % has % on sequence %', r, pv, seq;
      END IF;
    END LOOP;
  END LOOP;
END $$;
