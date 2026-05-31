-- 청약홈 공식 분양 일정 (한국부동산원 getAPTLttotPblancDetail)
-- 단지별 청약 일정 12종을 ISO 날짜로 보존. 네이버 presale_recruit_date(YYYY-MM 저정밀)와
-- 별도 테이블로 격리 → apartments base 컬럼 비파괴(미분양 stage 보존).
-- UNIQUE(apartment_id, house_manage_no): 한 단지가 차수별 여러 공고 가능 → 복합키 (applyhome_events 패턴).
-- BEGIN/COMMIT 사용 안 함 (기존 신규 테이블 마이그 패턴, Supabase 자동 적용).

CREATE TABLE presale_schedule_official (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,           -- 청약홈 HOUSE_MANAGE_NO (공고관리번호, 차수 식별)
  pblanc_no TEXT,                          -- PBLANC_NO (공고번호)
  recruit_date DATE,                       -- RCRIT_PBLANC_DE (모집공고일)
  special_receipt_bgnde DATE,              -- SPSPLY_RCEPT_BGNDE (특별공급 접수 시작)
  special_receipt_endde DATE,              -- SPSPLY_RCEPT_ENDDE (특별공급 접수 종료)
  general_rank1_bgnde DATE,                -- GNRL_RNK1_CRSPAREA_RCPTDE (1순위 해당지역 접수)
  general_rank1_endde DATE,                -- GNRL_RNK1_CRSPAREA_ENDDE
  general_rank2_bgnde DATE,                -- GNRL_RNK2_CRSPAREA_RCPTDE (2순위 해당지역 접수)
  general_rank2_endde DATE,                -- GNRL_RNK2_CRSPAREA_ENDDE
  winner_announce_date DATE,               -- PRZWNER_PRESNATN_DE (당첨자 발표)
  contract_bgnde DATE,                     -- CNTRCT_CNCLS_BGNDE (계약 시작)
  contract_endde DATE,                     -- CNTRCT_CNCLS_ENDDE (계약 종료)
  move_in_ym TEXT,                          -- MVN_PREARNGE_YM (입주예정월 YYYYMM)
  tot_supply INTEGER,                      -- TOT_SUPLY_HSHLDCO (총 공급세대수)
  pblanc_url TEXT,                         -- PBLANC_URL (공고 상세 URL)
  biz_entity TEXT,                         -- BSNS_MBY_NM (사업주체/시행)
  constructor TEXT,                        -- CNSTRCT_ENTRPS_NM (시공사)
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(apartment_id, house_manage_no)
);

CREATE INDEX idx_presale_schedule_apt ON presale_schedule_official(apartment_id, recruit_date DESC);

COMMENT ON TABLE presale_schedule_official IS '청약홈 공식 분양 일정 12종 (getAPTLttotPblancDetail). apartments base 컬럼과 격리.';
COMMENT ON COLUMN presale_schedule_official.house_manage_no IS '청약홈 HOUSE_MANAGE_NO. 공고 1건당 1번호 → 차수 식별 (apartment_id와 복합 UNIQUE)';
COMMENT ON COLUMN presale_schedule_official.recruit_date IS 'RCRIT_PBLANC_DE 모집공고일 (ISO). 네이버 YYYY-MM 저정밀 대체용 정밀값';

-- RLS (시계열/공식 테이블 표준: Public read + Service write — applyhome_events 패턴)
ALTER TABLE presale_schedule_official ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON presale_schedule_official FOR SELECT USING (true);
CREATE POLICY "Service write" ON presale_schedule_official FOR ALL USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
