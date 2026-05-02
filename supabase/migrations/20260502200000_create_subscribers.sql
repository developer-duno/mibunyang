-- 분양 시작 알림 구독자 (분양예정 페이지 잠재고객 적재)
-- 휴대폰 + 관심지역 → 카카오 알림톡 발송 시나리오 (Phase 2)
-- BEGIN/COMMIT 사용 안 함: 기존 신규 테이블 마이그 패턴과 일치

CREATE TABLE IF NOT EXISTS subscribers (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,                            -- E.164 정규화 ("+821012345678")
  region TEXT,                                    -- "서울특별시" or NULL (전국)
  gu TEXT,                                        -- "강동구" or NULL
  apartment_id TEXT REFERENCES apartments(id) ON DELETE CASCADE,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_source TEXT NOT NULL DEFAULT 'upcoming-page',
  opt_out_at TIMESTAMPTZ,                         -- 철회 시각 (NULL = active)
  last_notified_at TIMESTAMPTZ,                   -- 마지막 알림 발송 시각
  notify_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(phone, region, gu, apartment_id)
);

CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(region, gu) WHERE opt_out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscribers_apt ON subscribers(apartment_id) WHERE opt_out_at IS NULL;

COMMENT ON TABLE subscribers IS '분양 시작 알림 구독자. 휴대폰 + 관심지역 적재 → Phase 2 카카오 알림톡 발송';
COMMENT ON COLUMN subscribers.phone IS 'E.164 정규화 (+82 prefix). 동의/철회 이력 보존 (개인정보보호법)';
COMMENT ON COLUMN subscribers.opt_out_at IS '수신 거부 시각. NULL = active. 행 삭제 X (철회 이력 보존)';

-- RLS (잠재고객 휴대폰 보호: anon-only INSERT + service_role-only SELECT/UPDATE)
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon insert" ON subscribers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Service read" ON subscribers FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Service update" ON subscribers FOR UPDATE USING (auth.role() = 'service_role');
