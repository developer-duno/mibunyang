-- 우리 단지 ↔ 실거래 열쇠 연결 표 + trade_stats 새 칸 12개 — "시세 비교 범위 좁히기" 나) (세션590)
--
-- 왜 필요한가:
-- 지금 시세 비교(trade_stats.nearby_median·jeonse_rate·psr)는 **구 전체** 거래로 한다. 가) 에서 거래 원문을
-- `trade_deals` 에 단지 일련번호(apt_seq)·지번까지 저장하기 시작했으니, 이제 "이 단지 거래" 와 "같은 동·같은 평수
-- 또래 거래" 로 좁혀 비교할 수 있다(설계서 docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md §4-2·§4-3·§5).
--   1) `apartment_trade_links` — 우리 단지(apartments.id) 하나에 거래 열쇠 여러 개(대단지 여러 지번 · 매매/전세 apt_seq ·
--      분양권 열쇠). scripts/collectors/assign-trade-links.mjs 가 월 2회(collect-trade-stats.yml 안, trade-stats 바로 앞)
--      지번·이름·차수 검사로 채운다. 애매한 짝은 hold 로 두고 사람 판정 파일(docs/audits/trade-link-decisions.json)로 정한다.
--   2) `trade_stats` 새 칸 — 범위(complex/dong_peer/none)·적정가·건수·기간·면적 방식·같은 단지 전세가율·면적별 표·동네 사실.
--      옛 칸은 손대지 않는다(2u 가 읽는다 — supabase/CLAUDE.md). 새 칸은 다) 점수 PR 전까지 **아무도 읽지 않는다**.
--
-- VIEW(apartments_flat)는 이 마이그에서 건드리지 않는다 — 매일 굽기(collect-data.mjs --from-supabase-only)가 VIEW 를
-- select("*") 로 통째로 읽어 공개 JSON 에 쓰므로, 칸을 붙이면 화면이 쓰지도 않는 값이 그날 밤 공개 자료에 실린다.
-- VIEW 새 칸은 점수가 그 칸을 읽기 시작하는 다) 에서 붙인다(계획서 B1).
--
-- 공개 읽기 정책 없음 — 연결 표는 미분양 내부 재료다(서비스 역할만).
--
-- 선행: 20261003000000_trade_deals.sql (없으면 멈춘다)
-- ROLLBACK: _rollbacks/20261004000001_rollback_trade_links_and_scope_stats.sql

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.trade_deals') IS NULL THEN
    RAISE EXCEPTION 'trade_links migration: 선행 마이그 20261003000000_trade_deals.sql 가 적용되지 않았습니다(public.trade_deals 없음)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS apartment_trade_links (
  id BIGSERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('apt_seq', 'presale')),
  link_key TEXT NOT NULL,                 -- apt_seq 값 또는 분양권 열쇠 'sgg_cd|umd_nm|jibun|정리이름'
  method TEXT NOT NULL CHECK (method IN ('jibun+name', 'name', 'manual')),
  similarity NUMERIC(4,3),                -- 정리한 이름 유사도(판정 근거)
  build_year_gap SMALLINT,                -- |우리 완공연도 − 거래 최빈 건축년도| (둘 다 있을 때)
  trade_apt_name TEXT,                    -- 눈 검수용 — 거래 쪽 최빈 단지명
  trade_jibun TEXT,                       -- 눈 검수용 — 거래 쪽 지번(여럿이면 쉼표)
  status TEXT NOT NULL CHECK (status IN ('active', 'hold', 'rejected')),
  hold_reason TEXT CHECK (hold_reason IS NULL OR hold_reason IN ('sibling', 'phase')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,                -- 사람 판정 시각(판정 파일)
  verified_by TEXT,                       -- 사람 판정자(판정 파일)
  CONSTRAINT apartment_trade_links_uniq UNIQUE (apartment_id, link_kind, link_key)
);

COMMENT ON TABLE apartment_trade_links IS
  '우리 단지(apartments.id) ↔ 실거래 열쇠(trade_deals.apt_seq 또는 분양권 열쇠). 미분양 소유 · scripts/collectors/assign-trade-links.mjs 가 월 2회 채운다(미리보기 기본 · 차단기 · 승인 계획 대조). trade-stats 는 status = active 만 읽는다.';
COMMENT ON COLUMN apartment_trade_links.link_key IS
  'link_kind = apt_seq 이면 국토부 aptSeq, presale 이면 sgg_cd|umd_nm|jibun|정리이름(분양권 원문엔 aptSeq 가 없다)';
COMMENT ON COLUMN apartment_trade_links.method IS
  'jibun+name = 법정동 10자리 + 지번 일치 후 이름·차수·연도 검사 / name = 같은 법정동 안 이름(유사도 0.85 또는 부분문자열) / manual = 사람 판정 파일';
COMMENT ON COLUMN apartment_trade_links.status IS
  'active = 통계에 씀 / hold = 사람 판정 대기(다른 묶음과 공유 sibling · 차수 다른 후보 phase) / rejected = 사람이 거절(다시 제안하지 않는다)';

CREATE INDEX IF NOT EXISTS idx_trade_links_key ON apartment_trade_links(link_kind, link_key);
CREATE INDEX IF NOT EXISTS idx_trade_links_status ON apartment_trade_links(status);

ALTER TABLE apartment_trade_links ENABLE ROW LEVEL SECURITY;
-- "Public read" 정책은 만들지 않는다(위 머리 주석).
CREATE POLICY "Service write" ON apartment_trade_links FOR ALL USING (auth.role() = 'service_role');

-- Supabase 는 public 새 표에 anon·authenticated·service_role 모두에게 모든 권한을 기본으로 준다 →
-- 네 역할 전부 회수한 뒤 service_role 에 SELECT·INSERT·UPDATE·DELETE 만 다시 준다(trade_deals 20261003000000 과 같은 꼴).
REVOKE ALL ON public.apartment_trade_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apartment_trade_links TO service_role;

-- bigserial 시퀀스도 기본 권한을 회수하고 service_role 에만 USAGE·SELECT(INSERT 의 DEFAULT nextval 용).
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
    pg_catalog.pg_get_serial_sequence('public.apartment_trade_links', 'id')
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE, SELECT ON SEQUENCE %s TO service_role',
    pg_catalog.pg_get_serial_sequence('public.apartment_trade_links', 'id')
  );
END $$;

-- trade_stats 새 칸 12개(설계서 §4-3). 옛 칸은 무변경 — 2u 는 칸을 명시해 읽으므로 추가는 무해.
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS cmp_scope TEXT CHECK (cmp_scope IN ('complex', 'dong_peer', 'none'));
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS cmp_fair_price INTEGER;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS cmp_n SMALLINT;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS cmp_months SMALLINT;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS cmp_area_mode TEXT CHECK (cmp_area_mode IN ('same_area', 'per_m2'));
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS cmp_src TEXT CHECK (cmp_src IN ('sale', 'presale'));
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS complex_jeonse_rate NUMERIC(5,1);
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS complex_jeonse_n SMALLINT;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS complex_sale_n SMALLINT;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS complex_table JSONB;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS complex_jeonse_table JSONB;
ALTER TABLE trade_stats ADD COLUMN IF NOT EXISTS dong_fact JSONB;

COMMENT ON COLUMN trade_stats.cmp_scope IS
  '적정가(판정)의 범위 — complex = 이 단지 거래(연결 표 active) / dong_peer = 같은 법정동·같은 평수(전용 차 10㎡ 미만)·또래(준공 차 10년 이하) 매매 / none = 둘 다 3건 미만(적정가 없음). 다) 전까지 미사용';
COMMENT ON COLUMN trade_stats.cmp_fair_price IS
  '적정가(만원) — 범위 안 거래 중앙값(계수 없음). per_m2 면 ㎡당 중앙값 × 우리 면적. none 이면 NULL';
COMMENT ON COLUMN trade_stats.cmp_n IS '적정가에 쓴 거래 건수(문턱 3). none 이면 0';
COMMENT ON COLUMN trade_stats.cmp_months IS '비교 기간(개월) — 12';
COMMENT ON COLUMN trade_stats.cmp_area_mode IS
  'same_area = 전용면적 차 10㎡ 미만 거래 중앙값 / per_m2 = 같은 단지 면적 차 20㎡ 이하 거래의 ㎡당 중앙값 × 우리 면적';
COMMENT ON COLUMN trade_stats.cmp_src IS '판정에 쓴 거래 종류 — sale(매매, 입주 후) / presale(분양권, 입주 전)';
COMMENT ON COLUMN trade_stats.complex_jeonse_rate IS
  '같은 단지 전세가율(%) = 같은 평수 전세(갱신 제외) 중앙값 ÷ 같은 평수 매매 중앙값. 전세·매매 둘 다 3건 이상일 때만, 아니면 NULL';
COMMENT ON COLUMN trade_stats.complex_jeonse_n IS '같은 단지 전세가율의 전세 건수(값이 NULL 이어도 건수는 적는다)';
COMMENT ON COLUMN trade_stats.complex_sale_n IS '같은 단지 전세가율의 매매 건수(값이 NULL 이어도 건수는 적는다)';
COMMENT ON COLUMN trade_stats.complex_table IS
  '같은 단지 면적별 표 [{area, n, min, median, max, last_month}] — 매매 또는 분양권(cmp_src 종류), 면적 오름차순. 연결 없으면 []';
COMMENT ON COLUMN trade_stats.complex_jeonse_table IS '같은 단지 면적별 전세 표(갱신 제외) — complex_table 과 같은 꼴';
COMMENT ON COLUMN trade_stats.dong_fact IS
  '같은 법정동·같은 평수 매매 사실(나이 제한 없음) {n, min, median, max, build_year_min, build_year_max, age_gap_years, peer_n, peer_median}. age_gap_years 양수 = 그 집들이 이 단지보다 오래됨. 1건도 없으면 NULL';

-- 자체검사 — 하나라도 어긋나면 전부 취소(psql --single-transaction 으로 적용할 때)
DO $$
DECLARE
  t   text := 'public.apartment_trade_links';
  seq text;
  r   text;
  pv  text;
  n   int;
BEGIN
  -- ① anon·authenticated 는 표 권한·칸 SELECT 권한 0
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(r, t, pv) THEN
        RAISE EXCEPTION 'apartment_trade_links self-check: % has % on %', r, pv, t;
      END IF;
    END LOOP;
    IF pg_catalog.has_any_column_privilege(r, t, 'SELECT') THEN
      RAISE EXCEPTION 'apartment_trade_links self-check: % has column SELECT on %', r, t;
    END IF;
  END LOOP;
  -- ② service_role 은 SELECT·INSERT·UPDATE·DELETE 만(TRUNCATE 없음)
  FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', t, pv) THEN
      RAISE EXCEPTION 'apartment_trade_links self-check: service_role lacks % on %', pv, t;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', t, 'TRUNCATE') THEN
    RAISE EXCEPTION 'apartment_trade_links self-check: service_role has TRUNCATE on %', t;
  END IF;
  -- ③ RLS 켬 + 정책은 "Service write" 하나뿐("Public read" 없음)
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'apartment_trade_links self-check: RLS off on %', t;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy po
             WHERE po.polrelid = t::pg_catalog.regclass AND po.polname <> 'Service write') THEN
    RAISE EXCEPTION 'apartment_trade_links self-check: unexpected policy on %', t;
  END IF;
  -- ④ 시퀀스: anon·authenticated 권한 0, service_role 은 USAGE 있음
  seq := pg_catalog.pg_get_serial_sequence('public.apartment_trade_links', 'id');
  IF seq IS NULL THEN
    RAISE EXCEPTION 'apartment_trade_links self-check: serial sequence not found';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF pg_catalog.has_sequence_privilege(r, seq, pv) THEN
        RAISE EXCEPTION 'apartment_trade_links self-check: % has % on sequence %', r, pv, seq;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT pg_catalog.has_sequence_privilege('service_role', seq, 'USAGE') THEN
    RAISE EXCEPTION 'apartment_trade_links self-check: service_role lacks USAGE on sequence %', seq;
  END IF;
  -- ⑤ trade_stats 새 칸 12개가 다 있다
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'trade_stats'
     AND column_name IN ('cmp_scope', 'cmp_fair_price', 'cmp_n', 'cmp_months', 'cmp_area_mode', 'cmp_src',
                         'complex_jeonse_rate', 'complex_jeonse_n', 'complex_sale_n',
                         'complex_table', 'complex_jeonse_table', 'dong_fact');
  IF n <> 12 THEN
    RAISE EXCEPTION 'trade_stats self-check: new columns % / 12', n;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
