-- 지자체 단지별 미분양 명단을 새 출처로 — PR-1 DB(표·칸·CHECK) (세션687 · 설계서 docs/superpowers/plans/2026-11-01-govlist-unsold-source.md v2.1 §3-1·§3-2)
--
-- 무엇:
--   ① 새 표 unsold_gov_list — 지자체가 달마다 올리는 단지별 미분양 명단의 **원문 한 줄 = 한 행**
--      (대구·충남 = 게시판 xlsx · 경기 = OpenAPI, 경기는 면적대 1줄 = 1행). 머리줄 글자 → 셀 값 전부를 raw JSONB 에
--      넣고(버리는 칸 없음 — 원문 보존 규칙 supabase/CLAUDE.md), 매칭·판정에 쓰는 칸만 따로 뽑아 둔다.
--      같은 달 재게시는 새 batch 를 넣고 행 수 = batch_rows 로 완성을 확인한 뒤 옛 batch 를 지운다(trade_deals 꼴) —
--      그래서 열쇠에 batch_id 가 들어간다. 읽는 쪽은 그 달의 가장 새 완성 batch 만.
--   ② apartments.unsold_source CHECK 허용값에 'govlist' 추가(나머지 그대로).
--   ③ apartments 새 칸 2:
--      unsold_listed_as_of DATE  = 명단 등재 확인 기준월(공개·비공개 모두)
--      unsold_listed_total INT   = 명단 총분양 Σ(그 단지 명단 행 전부의 총분양 합 — govlist 행에만, 👤 Q9 「명단 총분양」)
--      VIEW 는 이 칸으로 「청약홈 값이 명단 비공개를 이기는가」(공급 ≥ 명단 총분양 50%)를 판정한다
--      (👤 재확인 2026-11-02 01:37 안 A — 운영 DB 의 applyhome 값 11행이 전부 무순위·재공급 공고라 설계서의
--      unsold_notice_kind(apt/remndr) 칸은 늘 remndr 이 되어 뜻이 없다 → 만들지 않는다).
--
-- 쓰는 곳: 앞으로 scripts/collectors/collect-unsold-govlist.mjs(PR-2) 만. 이 마이그 시점에는 쓰는 코드가 없다 —
--   표는 빈 채로, 새 칸은 전부 NULL 로 시작한다. 수집기·KOSIS 규칙(PR-4)이 들어오기 전에는 'govlist' 행이 생기지 않는다.
-- 보안: 이 DB 의 anon key 는 공개돼 있다(supabase/CLAUDE.md) → RLS 켬·정책 0, anon·authenticated 권한 전부 회수,
--   service_role 에 SELECT·INSERT·UPDATE·DELETE + 시퀀스 USAGE·SELECT 만 다시 준다(site_feedback·trade_deals 꼴).
--   ⚠️ 2026-10-30 부터 Supabase 는 새 public 표에 기본 권한을 주지 않는다 — 그래서 GRANT 를 빠뜨리면 service_role 도 못 쓴다.
-- 공유 DB: apartments 는 2u 가 읽는 표(ownership.json tables.apartments readers 2u) — 칸 **추가**와 CHECK 허용값 **추가**만
--   (기존 칸·값 의미 불변). 2u 코드에서 unsold_source 를 읽는 곳 0건(2026-11-02 메인 실측). 정본 PR 로 notify-sister 통보.
-- 적용 순서: 이 파일 → 20261102000002_view_unsold_govlist.sql(VIEW 가 새 칸을 읽는다 — 거꾸로 하면 42703).
--   적용 시각은 KST 03:00~06:30(굽기·증분 수집)·월·목 08~14시(네이버 러너)를 피한다.
--   적용: psql --single-transaction(파일 안에 BEGIN/COMMIT 없음) 또는 Dashboard SQL Editor — 끝의 자체검사가 어긋나면 전부 취소.
--   적용 뒤: supabase-js(service_role)로 select("unsold_listed_as_of, unsold_listed_total").limit(1) 1회 ·
--   unsold_gov_list select("*").limit(1) 1회(PGRST205 아님) · node scripts/perm-baseline.mjs 미리보기 → 사장님 승인 → 기준선 재승인.
--
-- 적용 확인:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='apartments_unsold_source_check';   (기대: … 'govlist' …)
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='apartments'
--     AND column_name IN ('unsold_listed_as_of','unsold_listed_total');                                     (기대: date · integer)
--   SELECT relrowsecurity FROM pg_class WHERE relname='unsold_gov_list';                                     (기대: t)
--
-- ROLLBACK: _rollbacks/20261102000001_rollback_unsold_gov_list.sql
--   ⚠️ VIEW 마이그(20261102000002)까지 적용했으면 그 파일이 아니라 _rollbacks/20261102000003 하나로 되돌린다
--   (새 VIEW 안쪽 SELECT * 가 새 칸을 쥐어 DROP COLUMN 이 2BP01 로 막힌다 — 000003 이 VIEW 를 내린 채 함께 지운다).

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ── ① 새 표 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unsold_gov_list (
  id            bigserial   PRIMARY KEY,
  source        text        NOT NULL CHECK (source IN ('daegu', 'chungnam', 'gyeonggi')),
  as_of         date        NOT NULL,          -- 기준월 말일 — 파일 본문·제목에서 읽는다(게시 순서로 정하지 않음)
  batch_id      text        NOT NULL,          -- 수집 회차(같은 달 재게시 교체의 열쇠)
  row_no        integer     NOT NULL,          -- 그 batch 안 원문 줄 번호
  batch_rows    integer     NOT NULL CHECK (batch_rows > 0),   -- 그 batch 가 넣으려던 행 수 — 실제 행 수가 같아야 완성
  raw           jsonb       NOT NULL,          -- 머리줄 글자 → 셀 값 전부(버리는 칸 없음)
  sgg           text,                          -- 시군구(매칭용 발췌 — 비공개 행은 NULL)
  emd           text,                          -- 읍면동
  raw_name      text,                          -- 원문 단지명(소재지 괄호 안 이름 등)
  address       text,                          -- 원문 소재지
  builder       text,                          -- 시공사(경기 비공개 행은 "00건설" → NULL)
  developer     text,                          -- 시행사
  is_public     boolean,                       -- 공공(true)·민간(false)
  is_rental     boolean,                       -- 임대(true)·분양(false)
  area_band     text,                          -- 면적대(경기 행 단위)
  total_units   integer     CHECK (total_units IS NULL OR total_units >= 0),     -- 총분양
  unsold_units  integer     CHECK (unsold_units IS NULL OR unsold_units >= 0),   -- 미분양(비공개 = NULL)
  hidden        boolean     NOT NULL,          -- 원문이 미분양 수를 비공개로 적었나
  apartment_id  text        REFERENCES public.apartments(id) ON DELETE SET NULL,   -- 맞춘 우리 단지(묶음 대표) — 단지가 지워져도 원문 행은 남긴다
  match_method  text,                          -- 매칭 방법
  match_score   numeric,                       -- 매칭 점수
  match_state   text        NOT NULL DEFAULT 'none'
                            CHECK (match_state IN ('strong', 'weak', 'none', 'decided', 'rejected')),
  file_url      text,                          -- 원문 주소
  fetched_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),   -- 받은 시각
  CONSTRAINT unsold_gov_list_hidden_null_check CHECK (NOT hidden OR unsold_units IS NULL),   -- 비공개 행에 숫자가 있으면 모순
  CONSTRAINT unsold_gov_list_batch_row_key UNIQUE (source, as_of, batch_id, row_no)
);

COMMENT ON TABLE public.unsold_gov_list IS
  '지자체 단지별 미분양 명단 원문(세션687) — 원문 한 줄 = 한 행(경기는 면적대 1줄). 미분양 소유 · service_role 전용(RLS 켬·정책 0) · 2u 읽기 없음 · (source, as_of, batch_id) 별 batch 교체(행 수 = batch_rows 인 batch 만 완성) · 쓰는 곳 scripts/collectors/collect-unsold-govlist.mjs';
COMMENT ON COLUMN public.unsold_gov_list.raw IS '머리줄 글자 → 셀 값 전부(분양청약일자·전월 미분양·계약마감일·지구명·택지종류·준공여부… 버리는 칸 없음)';
COMMENT ON COLUMN public.unsold_gov_list.hidden IS '원문이 미분양 수를 비공개로 적었나(대구 「건설사 요청으로 비공개」 등) — true 면 unsold_units 는 NULL';
COMMENT ON COLUMN public.unsold_gov_list.match_state IS 'strong/weak/none/decided(사람 판정 반영)/rejected(사람 판정 거부) — weak·none 이 남은 시군구는 미등재→0 판정을 하지 않는다(설계서 §5-③(d))';

CREATE INDEX IF NOT EXISTS unsold_gov_list_source_as_of_idx ON public.unsold_gov_list (source, as_of DESC);
CREATE INDEX IF NOT EXISTS unsold_gov_list_apartment_idx ON public.unsold_gov_list (apartment_id);   -- FK 지우기 검사·단지별 조회

-- RLS 켬 + 정책 0 → anon/authenticated 는 0행. service_role 은 BYPASSRLS 라 정책 없이 읽고 쓴다.
ALTER TABLE public.unsold_gov_list ENABLE ROW LEVEL SECURITY;

-- 네 역할 전부 회수한 뒤 service_role 에 SELECT·INSERT·UPDATE(매칭 결과)·DELETE(옛 batch 교체)만 다시 준다.
REVOKE ALL ON public.unsold_gov_list FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unsold_gov_list TO service_role;

-- bigserial 시퀀스도 회수 — DEFAULT nextval() 은 넣는 역할에 USAGE 가 있어야 하므로 service_role 에만 다시 준다.
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
    pg_catalog.pg_get_serial_sequence('public.unsold_gov_list', 'id')
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE, SELECT ON SEQUENCE %s TO service_role',
    pg_catalog.pg_get_serial_sequence('public.unsold_gov_list', 'id')
  );
END $$;

-- ── ② unsold_source CHECK — 'govlist' 추가(나머지 그대로: NULL·kosis·applyhome·hold) ──────────────
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_source_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_source_check
  CHECK (unsold_source IS NULL OR unsold_source IN ('kosis', 'applyhome', 'hold', 'govlist'));
-- apartments_unsold_hold_null_check 는 그대로(hold 만)

-- ── ③ apartments 새 칸 2(기본값 없음 · NULL 허용 → 표를 다시 쓰지 않는다) ──────────────────────────
ALTER TABLE public.apartments ADD COLUMN IF NOT EXISTS unsold_listed_as_of date;
ALTER TABLE public.apartments ADD COLUMN IF NOT EXISTS unsold_listed_total integer;
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_listed_total_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_listed_total_check
  CHECK (unsold_listed_total IS NULL OR unsold_listed_total > 0);   -- 0 이면 「공급 ≥ 50%」가 늘 참이 되어 거짓 0 이 명단 비공개를 이긴다
-- govlist 행 꼴(hold 제약과 같은 꼴 — PR-1 적대 검사관 🟡3): ① 기준월 두 칸이 반드시 있다(없으면 VIEW 가 만료를 못 재어 순위 0 에서 빠지고
--   감시도 못 본다) ② 비공개(값 NULL) 행에 미분양률만 남으면 화면 률과 「비공개」가 모순 — 률도 비운다. 지금 govlist 행 0 이라 통과한다.
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_govlist_asof_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_govlist_asof_check
  CHECK (unsold_source IS DISTINCT FROM 'govlist' OR (unsold_as_of IS NOT NULL AND unsold_listed_as_of IS NOT NULL));
ALTER TABLE public.apartments DROP CONSTRAINT IF EXISTS apartments_unsold_govlist_hidden_rate_check;
ALTER TABLE public.apartments ADD CONSTRAINT apartments_unsold_govlist_hidden_rate_check
  CHECK (NOT (unsold_source = 'govlist' AND unsold IS NULL AND unsold_rate IS NOT NULL));

COMMENT ON COLUMN public.apartments.unsold_source IS
  '이 값(unsold/unsold_rate)을 누가 썼나 — kosis=KOSIS 시군구 비례배분 추정(다음 회차가 새 값으로 덮음) / applyhome=청약홈 단지별 실측(공고일+6개월 전까지 존중, C6) / hold=사람 보류(자료 없음 확정 — KOSIS·청약홈이 덮지 않음, 해제는 backfill-unsold-source 계획으로) / govlist=지자체 단지별 미분양 명단(기준월+6개월 전까지 존중 — 숫자 또는 비공개 등재면 unsold NULL, 세션687) / NULL=출처 모름(세션568 이전 값)';
COMMENT ON COLUMN public.apartments.unsold_as_of IS
  '출처별 기준일 — applyhome=그 값을 만든 청약홈 공고의 공고일(공고일 + 6개월이 지나면 collect-unsold-kosis 가 KOSIS 추정으로 덮는다, C6) · hold=보류 결정일(6개월 지나면 감시 ⑫ 가 재검토 알림, 자동 해제 없음) · govlist=명단 기준월(as_of, + 6개월 = 만료). kosis·NULL 출처 행에서는 의미 없음';
COMMENT ON COLUMN public.apartments.unsold_listed_as_of IS
  '지자체 명단 등재 확인 기준월(공개·비공개 모두, 세션687) — 비공개 등재 행 = unsold NULL · unsold_rate NULL · unsold_source govlist · unsold_as_of = unsold_listed_as_of';
COMMENT ON COLUMN public.apartments.unsold_listed_total IS
  '지자체 명단 총분양 Σ(그 단지 명단 행 전부 — govlist 행에만, 세션687 👤 Q9). VIEW apartments_flat 이 「청약홈 공급 ≥ 이 값의 50%」일 때만 청약홈 값이 명단 비공개를 이기게 판정한다(NULL 이면 못 이김)';

-- ── 자체검사 — 하나라도 어긋나면 전부 취소 ─────────────────────────────────
DO $$
DECLARE
  t   text := 'public.unsold_gov_list';
  seq text;
  r   text;
  pv  text;
  def text;
BEGIN
  -- ① anon·authenticated 는 표 권한·칸 SELECT 권한 0
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(r, t, pv) THEN
        RAISE EXCEPTION 'unsold_gov_list self-check: % has % on %', r, pv, t;
      END IF;
    END LOOP;
    IF pg_catalog.has_any_column_privilege(r, t, 'SELECT') THEN
      RAISE EXCEPTION 'unsold_gov_list self-check: % has column SELECT on %', r, t;
    END IF;
  END LOOP;
  -- ② service_role 은 SELECT·INSERT·UPDATE·DELETE 만(TRUNCATE 없음)
  FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', t, pv) THEN
      RAISE EXCEPTION 'unsold_gov_list self-check: service_role lacks % on %', pv, t;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', t, 'TRUNCATE') THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: service_role has TRUNCATE on %', t;
  END IF;
  -- ③ RLS 켬 + 정책 0
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: RLS off on %', t;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy po WHERE po.polrelid = t::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: unexpected policy on %', t;
  END IF;
  -- ④ 시퀀스: anon·authenticated 권한 0, service_role 은 USAGE 있음(없으면 INSERT 가 실패한다)
  seq := pg_catalog.pg_get_serial_sequence('public.unsold_gov_list', 'id');
  IF seq IS NULL THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: serial sequence not found';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF pg_catalog.has_sequence_privilege(r, seq, pv) THEN
        RAISE EXCEPTION 'unsold_gov_list self-check: % has % on sequence %', r, pv, seq;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT pg_catalog.has_sequence_privilege('service_role', seq, 'USAGE') THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: service_role lacks USAGE on sequence %', seq;
  END IF;
  -- ⑤ unsold_source CHECK 에 govlist 가 들어갔고 옛 값 셋도 그대로
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO def FROM pg_catalog.pg_constraint
   WHERE conname = 'apartments_unsold_source_check' AND conrelid = 'public.apartments'::pg_catalog.regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: apartments_unsold_source_check missing';
  END IF;
  IF position('govlist' in def) = 0 OR position('kosis' in def) = 0 OR position('applyhome' in def) = 0 OR position('hold' in def) = 0 THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: unsold_source check malformed: %', def;
  END IF;
  -- ⑥ hold 제약은 그대로 살아 있다
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'apartments_unsold_hold_null_check' AND conrelid = 'public.apartments'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: apartments_unsold_hold_null_check missing';
  END IF;
  -- ⑦ 새 칸 2 — 형식까지
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'apartments'
         AND ((column_name = 'unsold_listed_as_of' AND data_type = 'date')
           OR (column_name = 'unsold_listed_total' AND data_type = 'integer'))) <> 2 THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: apartments new columns missing or wrong type';
  END IF;
  -- ⑧ govlist 행 꼴 제약 2개 + 총분양 > 0 제약이 실제로 있다
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.apartments'::pg_catalog.regclass
         AND conname IN ('apartments_unsold_govlist_asof_check', 'apartments_unsold_govlist_hidden_rate_check',
                         'apartments_unsold_listed_total_check')) <> 3 THEN
    RAISE EXCEPTION 'unsold_gov_list self-check: govlist row-shape constraints missing';
  END IF;
END $$;

RESET statement_timeout;
RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
