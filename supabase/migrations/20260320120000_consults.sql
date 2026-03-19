-- 상담 신청 테이블
CREATE TABLE IF NOT EXISTS consults (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  interested_apts TEXT[] DEFAULT '{}',
  budget_min INTEGER,
  budget_max INTEGER,
  consult_type TEXT DEFAULT '방문상담',
  message TEXT,
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: anon = INSERT+SELECT (API 레벨에서 JWT 인증), service_role = 전체
ALTER TABLE consults ENABLE ROW LEVEL SECURITY;
CREATE POLICY consults_anon_insert ON consults FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY consults_anon_select ON consults FOR SELECT TO anon USING (true);
CREATE POLICY consults_service ON consults FOR ALL TO service_role USING (true);
