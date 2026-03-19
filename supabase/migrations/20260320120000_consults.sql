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

-- RLS: anon = INSERT만 (상담 접수), service_role = 전체 (조회·관리)
ALTER TABLE consults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consults_anon_insert ON consults;
CREATE POLICY consults_anon_insert ON consults FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS consults_anon_select ON consults;
-- anon SELECT 제거: PII(이름, 전화번호) 보호. 조회는 service_role 전용.
DROP POLICY IF EXISTS consults_service ON consults;
CREATE POLICY consults_service ON consults FOR ALL TO service_role USING (true);
