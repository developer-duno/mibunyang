-- 청약홈 무순위/잔여세대 공고 이벤트 로그 (시계열)
-- 같은 단지 2회+ 출현 = 미분양 시그널
-- BEGIN/COMMIT 사용 안 함: 기존 신규 테이블 마이그(consults / api_quota_log /
-- market_stats_history / add_competition_rate) 모두 평면 SQL. Supabase가 자동 적용.

CREATE TABLE applyhome_events (
  id SERIAL PRIMARY KEY,
  apartment_id TEXT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  house_manage_no TEXT NOT NULL,         -- 청약홈 공고관리번호 (HOUSE_MANAGE_NO)
  supply INTEGER NOT NULL,                -- 가중평균 분자
  applicants INTEGER NOT NULL,            -- 가중평균 분모
  rate REAL,                              -- 경쟁률 (>1 경쟁, <1 미달, NULL 미수집)
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(apartment_id, house_manage_no)
);

CREATE INDEX idx_applyhome_events_apt ON applyhome_events(apartment_id, recorded_at DESC);
CREATE INDEX idx_applyhome_events_recorded ON applyhome_events(recorded_at DESC);

COMMENT ON TABLE applyhome_events IS '청약홈 무순위/잔여세대 공고 이벤트 로그. 같은 단지 2회+ 출현 = 미분양 시그널';
COMMENT ON COLUMN applyhome_events.house_manage_no IS '청약홈 HOUSE_MANAGE_NO. 공고 1건당 1번호 → 차수 식별';
COMMENT ON COLUMN applyhome_events.recorded_at IS '수집기 실행일 (공고일 아님 — API에 공고일 필드 없음)';

-- RLS (시계열 테이블 표준: Public read + Service write — market_stats_history 패턴)
ALTER TABLE applyhome_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON applyhome_events FOR SELECT USING (true);
CREATE POLICY "Service write" ON applyhome_events FOR ALL USING (auth.role() = 'service_role');
