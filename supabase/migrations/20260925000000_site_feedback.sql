-- 손님 "의견 보내기" 저장 표 (세션574).
--
-- 무엇: 사이트 오른쪽 아래 "의견" 버튼으로 로그인 손님이 보낸 건의·버그 제보·정보 오류 신고를 담는다.
--   쓰기는 POST /api/feedback(service key)만, 읽기·처리·삭제는 관리자 API 만 한다.
-- 보안: 이 DB 의 anon key 는 자매 사이트(2u.pe.kr) 번들에 공개돼 있다(supabase/CLAUDE.md "anon key 공개").
--   그래서 RLS 를 켜고 정책을 0개로 두며, anon·authenticated 권한을 전부 회수한다 — 공개 열쇠로는 한 줄도 못 읽고 못 쓴다.
--   service_role 은 BYPASSRLS 라 정책 없이 읽고 쓴다(권한 지문 마이그 20260924000400 :34-47 과 같은 모양).
-- 보존: 1년 뒤 자동 삭제(scripts/purge-old-consults.mjs purgeOldFeedback, created_at 기준 365일).
-- 적용: 사장님 승인 뒤 psql --single-transaction + lock_timeout 래퍼로(파일 안에 BEGIN/COMMIT 없음).
--   끝의 자체검사가 하나라도 어긋나면 RAISE EXCEPTION → 전부 취소된다.
--   적용하면 권한 지문(감시 ⑩)이 바뀐다 → scripts/perm-baseline.mjs 로 기준선 재승인.
-- ROLLBACK: _rollbacks/20260925000001_rollback_site_feedback.sql

CREATE TABLE IF NOT EXISTS public.site_feedback (
  id              bigserial   PRIMARY KEY,
  user_email      text        NOT NULL,
  user_name       text,
  kind            text        NOT NULL CHECK (kind IN ('bug', 'data', 'suggest', 'other')),
  message         text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  page            text,
  apartment_id    text,
  apartment_name  text,
  user_agent      text,
  status          text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  consent_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  handled_at      timestamptz
);

COMMENT ON TABLE public.site_feedback IS '손님 의견 보내기(세션574) — service_role 전용, RLS 켬·정책 0, 1년 보존';

CREATE INDEX IF NOT EXISTS site_feedback_created_at_idx ON public.site_feedback (created_at DESC);

-- RLS 켬 + 정책 0 → anon/authenticated 는 0행. service_role 은 BYPASSRLS 라 읽고 쓴다.
ALTER TABLE public.site_feedback ENABLE ROW LEVEL SECURITY;

-- Supabase 는 public 새 표에 anon·authenticated·service_role 모두에게 모든 권한을 기본으로 준다 →
-- 네 역할 전부 회수한 뒤 service_role 에 SELECT·INSERT·UPDATE(처리 표시)·DELETE(관리자 삭제·1년 파기)만 다시 준다.
REVOKE ALL ON public.site_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_feedback TO service_role;

-- bigserial 시퀀스도 기본 권한을 회수한다. IDENTITY 와 달리 serial 의 DEFAULT nextval() 은
-- 넣는 역할에 시퀀스 USAGE 가 있어야 하므로 service_role 에만 USAGE·SELECT 를 다시 준다.
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
    pg_catalog.pg_get_serial_sequence('public.site_feedback', 'id')
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE, SELECT ON SEQUENCE %s TO service_role',
    pg_catalog.pg_get_serial_sequence('public.site_feedback', 'id')
  );
END $$;

-- 자체검사 — 하나라도 어긋나면 전부 취소
DO $$
DECLARE
  t   text := 'public.site_feedback';
  seq text;
  r   text;
  pv  text;
BEGIN
  -- ① anon·authenticated 는 표 권한·칸 SELECT 권한 0
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(r, t, pv) THEN
        RAISE EXCEPTION 'site_feedback self-check: % has % on %', r, pv, t;
      END IF;
    END LOOP;
    IF pg_catalog.has_any_column_privilege(r, t, 'SELECT') THEN
      RAISE EXCEPTION 'site_feedback self-check: % has column SELECT on %', r, t;
    END IF;
  END LOOP;
  -- ② service_role 은 SELECT·INSERT·UPDATE·DELETE 만(TRUNCATE 없음)
  FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', t, pv) THEN
      RAISE EXCEPTION 'site_feedback self-check: service_role lacks % on %', pv, t;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', t, 'TRUNCATE') THEN
    RAISE EXCEPTION 'site_feedback self-check: service_role has TRUNCATE on %', t;
  END IF;
  -- ③ RLS 켬 + 정책 0
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'site_feedback self-check: RLS off on %', t;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy po WHERE po.polrelid = t::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'site_feedback self-check: policy exists on %', t;
  END IF;
  -- ④ 시퀀스: anon·authenticated 권한 0, service_role 은 USAGE 있음(없으면 INSERT 가 실패한다)
  seq := pg_catalog.pg_get_serial_sequence('public.site_feedback', 'id');
  IF seq IS NULL THEN
    RAISE EXCEPTION 'site_feedback self-check: serial sequence not found';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF pg_catalog.has_sequence_privilege(r, seq, pv) THEN
        RAISE EXCEPTION 'site_feedback self-check: % has % on sequence %', r, pv, seq;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT pg_catalog.has_sequence_privilege('service_role', seq, 'USAGE') THEN
    RAISE EXCEPTION 'site_feedback self-check: service_role lacks USAGE on sequence %', seq;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
