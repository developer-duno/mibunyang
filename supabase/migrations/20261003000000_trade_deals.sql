-- 실거래 원문 한 건 = 한 행 (국토부 매매·전월세·분양권) — "시세 비교 범위 좁히기" 가) (세션589)
--
-- 왜 필요한가:
-- 지금 시세 비교는 `trades` 의 **구 전체** 거래로 한다(같은 구 아무 단지와 비교). 손님이 궁금한 것은
-- "이 단지(또는 같은 동·같은 평수)는 얼마에 팔렸나" 인데, `trades` 는 그 질문에 답할 재료를 버린다:
--   1) 단지 일련번호(`aptSeq`)·지번(`jibun`·`bonbun`·`bubun`)·법정동코드(`umdCd`)·거래일(`dealDay`)·동(`aptDong`)·
--      계약 구분(`contractType`)을 저장하지 않는다 — 원문에는 다 있다(조사 2차 원문 칸 실측 2026-10-02).
--   2) 고유 색인 `idx_trades_unique(region, gu, deal_month, area, price, floor, trade_type)` 가
--      같은 달·같은 면적·같은 값·같은 층의 **서로 다른 거래를 한 행으로 접는다**(단지가 달라도).
--   3) 2026 화성 4구 개편 뒤 옛 코드 41590 은 0건 — `trades` 는 41591(만세구)만 받아 왔다.
--
-- 왜 `trades` 를 고치지 않고 새 표인가:
-- `trades` 는 2u 가 읽는다(`/api/mb/trades` · 신선도 max(recorded_at)). 열쇠·내용을 바꾸면 남의 서비스가 흔들린다.
-- 그래서 `trades` 쓰기 경로는 글자 하나 바꾸지 않고, 같은 회차·같은 응답으로 이 표를 **함께** 채운다.
--
-- 교체 방식 (열쇠 = sgg_cd · deal_month · trade_type):
--   행마다 batch_rows(그 열쇠에 이번 회차가 넣으려던 행 수)를 함께 넣는다 — **행 수 = batch_rows 인 batch 만 완성**.
--   ① 지난 회차 흔적 정리: 가장 새 **완성** batch 하나만 남기고 나머지(미완성·더 옛 완성)를 지운다
--   ② 새 행이 남긴 완성본의 절반 미만이면 교체하지 않는다(급감 차단기 — 옛 것 유지)
--   ③ 이번 회차 batch_id 로 전부 insert
--   ④ 그 열쇠에서 **이번 회차 시작보다 먼저 들어간** 다른 batch 를 지운다(동시에 도는 회차의 새 행은 안 지운다)
--   읽는 쪽은 열쇠마다 **가장 새 완성 batch 만** 읽는다 — insert 도중에 죽어도(PC 재시작 등) 반쪽 batch 는
--   완성 표시가 안 맞아 읽히지 않는다. 응답이 0건이면 **지우지 않는다**(옛 코드·장애가 0건으로 온다 —
--   admin-district-code-reform.md §4).
--
-- 저장하지 않는 것: 분양권 `ownershipGbn = "입"`(입주권) · 월세가 있는 전월세 · 금액·면적 0.
-- 공개 읽기 정책 없음 — 거래 원문은 손님에게 직접 나가지 않는다(2u V031 이 `trades` 의 anon SELECT 도 회수했다).
--
-- ROLLBACK: _rollbacks/20261003000001_rollback_trade_deals.sql
CREATE TABLE IF NOT EXISTS trade_deals (
  id BIGSERIAL PRIMARY KEY,
  trade_type TEXT NOT NULL,               -- 'sale' | 'jeonse' | 'presale' (trades 와 같은 표기)
  region TEXT NOT NULL,                   -- 수집 대상 시도 약칭
  gu TEXT,                                -- apartments.gu 표기(화성 = "화성시", 세종 = "세종시")
  sgg_cd CHAR(5) NOT NULL,                -- 호출한 LAWD_CD — 화성 4코드(41591·41593·41595·41597)가 여기서 갈린다
  umd_cd CHAR(5),                         -- 매매 umdCd. 전월세·분양권 원문에 없음 → NULL
  umd_nm TEXT,                            -- 법정동 이름(umdNm) — trades.dong 과 같은 값
  jibun TEXT,                             -- 원문 지번 그대로("A4BL" 같은 블록 표기 포함)
  jibun_main TEXT,                        -- 지번 본번(앞 0 뗌) — 매매는 landCd = '1'(대지)일 때만 bonbun, 그 밖은 jibun 을 '-' 로 가른 앞.
                                          --   산·블록·"가-" 처럼 숫자 지번이 아니면 NULL(세 종류가 같은 원문에 같은 답)
  jibun_sub TEXT,                         -- 지번 부번 — 같은 규칙(부번 없으면 '0', 숫자 지번이 아니면 NULL)
  road_nm TEXT,                           -- 도로명(매매 roadNm · 전월세 roadnm — 끝 건물번호는 뗀다). 분양권 원문엔 없음 → NULL
  road_bonbun TEXT,                       -- 건물 본번(매매 roadNmBonbun · 전월세 roadnmbonbun, 앞 0 뗌 · 0 이면 NULL)
  road_bubun TEXT,                        -- 건물 부번(매매 roadNmBubun · 전월세 roadnmbubun, 앞 0 뗌 · 0 이면 NULL)
  apt_seq TEXT,                           -- 단지 일련번호 aptSeq(매매·전월세). 분양권·옛 매매 창구 폴백은 NULL
  apt_name TEXT,                          -- aptNm
  apt_dong TEXT,                          -- 매매 aptDong(동·棟) — 중복 판별 보조
  deal_month CHAR(6) NOT NULL,            -- "202608"
  deal_day SMALLINT,                      -- dealDay
  area NUMERIC(7,2) NOT NULL,             -- 전용면적 excluUseAr(소수 둘째 반올림 — trades 와 같은 규칙)
  floor SMALLINT,
  build_year SMALLINT,
  price INTEGER NOT NULL,                 -- 만원. 매매·분양권 dealAmount / 전세 deposit(월세 0 만)
  contract_type TEXT,                     -- 전월세 contractType(신규/갱신/빈칸)
  dealing_type TEXT,                      -- 매매·분양권 dealingGbn(중개/직거래)
  cancel_date TEXT,                       -- 매매·분양권 cdealDay(해제일 — 분양권도 해제 거래가 있다, 사본 1,174행 중 71행)
  batch_id UUID NOT NULL,                 -- 수집 회차 — 교체 방식의 열쇠
  batch_rows INTEGER NOT NULL,            -- 그 열쇠에 이번 회차가 넣으려던 행 수 — 행 수가 이것과 같아야 "완성" batch
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- 수집기가 insert 배치마다 채운다(회차 시작 시각과 맞대 옛 batch 를 고른다)
);

COMMENT ON TABLE trade_deals IS
  '국토부 실거래 원문 한 건 = 한 행(매매·전세·분양권). 미분양 소유 · scripts/collectors/collect-trades.mjs 가 trades 와 같은 회차에 (sgg_cd, deal_month, trade_type) 열쇠별 교체로 채운다. 읽을 때는 열쇠마다 가장 새 완성 batch(행 수 = batch_rows)만. trades(2u 가 읽음)는 그대로 둔다.';
COMMENT ON COLUMN trade_deals.sgg_cd IS
  '호출 LAWD_CD. 2026 화성 4구 개편으로 화성시는 41591·41593·41595·41597 네 코드(옛 41590 = 0건, 조사 2차 실측)';
COMMENT ON COLUMN trade_deals.apt_seq IS
  '국토부 단지 일련번호(aptSeq) — 매매·전월세 원문에만 있다. 분양권 원문엔 없고, 매매 상세 창구 미등록으로 옛 창구 폴백을 쓴 회차도 NULL(사실대로)';
COMMENT ON COLUMN trade_deals.batch_id IS
  '수집 회차 id. 같은 열쇠에 둘 이상이면 지난 회차가 중간에 죽었거나 두 회차가 겹친 흔적 — 감시 ⑯ 가 명단으로 알린다';
COMMENT ON COLUMN trade_deals.batch_rows IS
  '그 열쇠에 그 회차가 넣으려던 행 수. 실제 행 수가 이것과 같은 batch 만 완성 — insert 도중 죽은 반쪽 batch 를 읽는 쪽·다음 회차가 걸러낸다';

CREATE INDEX IF NOT EXISTS idx_trade_deals_aptseq ON trade_deals(apt_seq, trade_type, deal_month);
CREATE INDEX IF NOT EXISTS idx_trade_deals_jibun ON trade_deals(sgg_cd, umd_nm, jibun);
-- deal_month 가 맨 앞 — 감시 ⑯ 가 달마다 훑고(`.eq("deal_month")`), 교체 저장의 열쇠 조회(3칸 일치)도 그대로 탄다
CREATE INDEX IF NOT EXISTS idx_trade_deals_key ON trade_deals(deal_month, sgg_cd, trade_type, batch_id);
CREATE INDEX IF NOT EXISTS idx_trade_deals_dong ON trade_deals(region, gu, umd_nm, deal_month);

ALTER TABLE trade_deals ENABLE ROW LEVEL SECURITY;
-- "Public read" 정책은 만들지 않는다(위 머리 주석).
CREATE POLICY "Service write" ON trade_deals FOR ALL USING (auth.role() = 'service_role');

-- Supabase 는 public 새 표에 anon·authenticated·service_role 모두에게 모든 권한을 기본으로 준다 →
-- 네 역할 전부 회수한 뒤 service_role 에 SELECT·INSERT·UPDATE·DELETE 만 다시 준다(site_feedback 20260925000000 과 같은 꼴).
-- 수집기는 insert·delete(교체 방식)만, 감시 ⑯ 는 select 만 쓴다.
REVOKE ALL ON public.trade_deals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_deals TO service_role;

-- bigserial 시퀀스도 기본 권한을 회수한다. serial 의 DEFAULT nextval() 은 넣는 역할에 시퀀스 USAGE 가
-- 있어야 하므로 service_role 에만 USAGE·SELECT 를 다시 준다.
DO $$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
    pg_catalog.pg_get_serial_sequence('public.trade_deals', 'id')
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE, SELECT ON SEQUENCE %s TO service_role',
    pg_catalog.pg_get_serial_sequence('public.trade_deals', 'id')
  );
END $$;

-- 자체검사 — 하나라도 어긋나면 전부 취소(psql --single-transaction 으로 적용할 때)
DO $$
DECLARE
  t   text := 'public.trade_deals';
  seq text;
  r   text;
  pv  text;
BEGIN
  -- ① anon·authenticated 는 표 권한·칸 SELECT 권한 0
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(r, t, pv) THEN
        RAISE EXCEPTION 'trade_deals self-check: % has % on %', r, pv, t;
      END IF;
    END LOOP;
    IF pg_catalog.has_any_column_privilege(r, t, 'SELECT') THEN
      RAISE EXCEPTION 'trade_deals self-check: % has column SELECT on %', r, t;
    END IF;
  END LOOP;
  -- ② service_role 은 SELECT·INSERT·UPDATE·DELETE 만(TRUNCATE 없음)
  FOREACH pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', t, pv) THEN
      RAISE EXCEPTION 'trade_deals self-check: service_role lacks % on %', pv, t;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', t, 'TRUNCATE') THEN
    RAISE EXCEPTION 'trade_deals self-check: service_role has TRUNCATE on %', t;
  END IF;
  -- ③ RLS 켬 + 정책은 "Service write" 하나뿐("Public read" 없음)
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'trade_deals self-check: RLS off on %', t;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy po
             WHERE po.polrelid = t::pg_catalog.regclass AND po.polname <> 'Service write') THEN
    RAISE EXCEPTION 'trade_deals self-check: unexpected policy on %', t;
  END IF;
  -- ④ 시퀀스: anon·authenticated 권한 0, service_role 은 USAGE 있음(없으면 INSERT 가 실패한다)
  seq := pg_catalog.pg_get_serial_sequence('public.trade_deals', 'id');
  IF seq IS NULL THEN
    RAISE EXCEPTION 'trade_deals self-check: serial sequence not found';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH pv IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF pg_catalog.has_sequence_privilege(r, seq, pv) THEN
        RAISE EXCEPTION 'trade_deals self-check: % has % on sequence %', r, pv, seq;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT pg_catalog.has_sequence_privilege('service_role', seq, 'USAGE') THEN
    RAISE EXCEPTION 'trade_deals self-check: service_role lacks USAGE on sequence %', seq;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
