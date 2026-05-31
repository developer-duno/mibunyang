-- 청약홈 평형별 공급정보 (한국부동산원 getAPTLttotPblancMdl)
-- 단지당 평형 행 2~8개 (1:N). model_no 로 평형 식별.
-- special_by_type JSONB: 특공유형별 세대수 (유형이 7+종이라 컬럼 대신 JSONB — 유형 확장 대응).
-- BEGIN/COMMIT 사용 안 함 (기존 신규 테이블 마이그 패턴, Supabase 자동 적용).

CREATE TABLE applyhome_unit_supply (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,           -- 청약홈 HOUSE_MANAGE_NO (공고관리번호)
  model_no TEXT NOT NULL,                  -- MODEL_NO (평형 순번 "01" 등)
  house_ty TEXT,                           -- HOUSE_TY (주택형 "051.0000A")
  supply_area REAL,                        -- SUPLY_AR (공급면적 ㎡)
  general_supply INTEGER,                  -- SUPLY_HSHLDCO (일반공급 세대수)
  special_supply INTEGER,                  -- SPSPLY_HSHLDCO (특별공급 합계 세대수)
  special_by_type JSONB,                   -- 특공유형별: 다자녀(MNYCH)/신혼(NWBB)/생애최초(LFE_FRST)/
                                           --   노부모(OLD_PARNTS)/청년(YGMN)/신생아(NWWDS)/기관추천(INSTT_RECOMEND)/기타(ETC)
  top_amount INTEGER,                      -- LTTOT_TOP_AMOUNT (분양최고금액, 만원)
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(apartment_id, house_manage_no, model_no)
);

CREATE INDEX idx_applyhome_unit_apt ON applyhome_unit_supply(apartment_id);

COMMENT ON TABLE applyhome_unit_supply IS '청약홈 평형별 공급정보 (getAPTLttotPblancMdl). 단지당 평형 1:N.';
COMMENT ON COLUMN applyhome_unit_supply.special_by_type IS '특공유형별 세대수 JSONB. 키: dazanyeo/sinhon/saengae_choecho/nobumo/cheongnyeon/sinsaenga/gigwan/etc';
COMMENT ON COLUMN applyhome_unit_supply.top_amount IS 'LTTOT_TOP_AMOUNT 분양최고금액 (만원 단위)';

-- RLS (공식 테이블 표준: Public read + Service write — applyhome_events 패턴)
ALTER TABLE applyhome_unit_supply ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON applyhome_unit_supply FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_unit_supply FOR ALL USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
