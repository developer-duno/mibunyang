-- 청약홈 단계1 — 잔여세대 평형(#8) + 취소후재공급 경쟁률(#7)
-- 설계: docs/superpowers/specs/2026-08-07-applyhome-competition-8ch-design.md §5-A
--
-- 공용 테이블(complexes/articles/complex_price_history/trades) 무관 —
-- applyhome_unit_supply 는 mibunyang 소유(20260531100001), applyhome_cancel_respl 는 신규.
-- naver-estate-web 영향 0.
--
-- BEGIN/COMMIT 사용 안 함 (기존 신규 테이블 마이그 패턴, Supabase 자동 적용).

-- ── ① applyhome_unit_supply 에 출처 태그 (컬럼 추가만 — 기존 컬럼 불변) ──
-- 기존 7,231행은 전부 APT 계열(getAPTLttotPblancMdl)이므로 DEFAULT 'apt' 로 소급 태깅된다.
--
-- ⚠️ UNIQUE 제약은 건드리지 않는다. 초안은 UNIQUE(..., source) 로 바꾸려 했으나
--    2026-08-07 실측에서 잔여세대 4,626행 ∩ 기존 7,231행의 (house_manage_no, model_no)
--    충돌이 0건이었다. 공고관리번호 번호대가 계열별로 갈리기 때문
--    (잔여세대·취소후재공급 = 2026 9xxxxx / APT = 2026 0xxxxx).
--    → DROP CONSTRAINT 불필요. 수집기가 매 run 첫머리에 이 불변식을 재검증하고
--      충돌이 1건이라도 나오면 DB 쓰기 전에 exit(1) 한다 (collect-applyhome-remndr.mjs).
ALTER TABLE applyhome_unit_supply
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'apt';

COMMENT ON COLUMN applyhome_unit_supply.source IS
  '평형 데이터 출처: apt(getAPTLttotPblancMdl) | remndr(getRemndrLttotPblancMdl) | opt(getOPTLttotPblancMdl, 단계3)';

-- ── ② 취소후재공급 경쟁률 (getCancResplLttotPblancCmpet) ──
-- Detail/Mdl 은 이 API 에 존재하지 않는다 (2026-08-07 404 실측) → 경쟁률 단독 테이블.
CREATE TABLE IF NOT EXISTS applyhome_cancel_respl (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,        -- HOUSE_MANAGE_NO (공고관리번호)
  pblanc_no TEXT,                       -- PBLANC_NO (공고번호)
  model_no TEXT NOT NULL,               -- MODEL_NO (평형 순번 "01")
  house_ty TEXT,                        -- HOUSE_TY (주택형 — 원문 트레일링 스페이스 trim 후 저장)
  total_supply INTEGER,                 -- SUPLY_HSHLDCO (해당 주택형 총 공급세대수)
  -- 유형별 6종(일반/기관추천/다자녀/생애최초/신생아/노부모)의 rate·supply·req.
  -- 컬럼 18개 대신 JSONB — 청약홈이 특공 유형을 계속 추가해 왔다(청년·신생아는 최근 신설).
  -- applyhome_unit_supply.special_by_type 관습 답습.
  by_type JSONB,
  -- 유형 전체 최고 경쟁률 (파생값 — 목록 정렬·화면 대표값용).
  -- 미달"(△N)"·"-"·null 은 경쟁률이 아니므로 max 계산에서 제외된다.
  max_rate REAL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (apartment_id, house_manage_no, model_no)
);

CREATE INDEX IF NOT EXISTS idx_cancel_respl_apt ON applyhome_cancel_respl(apartment_id);

COMMENT ON TABLE applyhome_cancel_respl IS
  '청약홈 취소후재공급 경쟁률 (getCancResplLttotPblancCmpet). 유형별 6종을 by_type JSONB 로 보존.';
COMMENT ON COLUMN applyhome_cancel_respl.by_type IS
  '유형별 { rate, supply, req }. 키: normal/instt/mnych/lfe_frst/nwwds/old_parnts. rate 는 미달·미접수 시 null 이고 그 경우 shortfall 키가 붙는다.';
COMMENT ON COLUMN applyhome_cancel_respl.max_rate IS
  '유형 전체 최고 경쟁률. 전 유형이 미달/미접수면 NULL — "경쟁률 0" 과 "미수집" 을 구분하기 위해 0 으로 채우지 않는다.';

-- RLS (공식/시계열 테이블 표준: Public read + Service write — applyhome_events 패턴)
ALTER TABLE applyhome_cancel_respl ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"   ON applyhome_cancel_respl FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_cancel_respl FOR ALL    USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
