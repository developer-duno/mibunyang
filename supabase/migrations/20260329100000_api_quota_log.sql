-- api_quota_log: data.go.kr API 쿼터 사용량 추적
-- Phase 2: 10일-토요일 충돌 모니터링 + 일별 사용량 감사
CREATE TABLE IF NOT EXISTS api_quota_log (
  id          SERIAL PRIMARY KEY,
  log_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  collector   TEXT NOT NULL,          -- 수집기 이름 (예: molit-building-info, collect-trades)
  api_name    TEXT NOT NULL,          -- API 키 이름 (예: MOLIT_KEY, MOIS_POP_KEY)
  call_count  INTEGER NOT NULL,       -- 호출 횟수
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 일별+수집기별 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_quota_log_date ON api_quota_log (log_date);
CREATE INDEX IF NOT EXISTS idx_quota_log_collector ON api_quota_log (log_date, collector);

-- 일별 합계 뷰 (모니터링용)
CREATE OR REPLACE VIEW api_quota_daily AS
SELECT
  log_date,
  api_name,
  SUM(call_count) AS total_calls,
  COUNT(DISTINCT collector) AS collector_count,
  STRING_AGG(DISTINCT collector, ', ' ORDER BY collector) AS collectors
FROM api_quota_log
GROUP BY log_date, api_name
ORDER BY log_date DESC;
