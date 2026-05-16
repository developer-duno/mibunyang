-- collector_runs 테이블 신규 (수집기 모니터링 에픽 1단계)
-- 수집기가 끝날 때 성공/실패/처리건수를 1행으로 적재. recordCollectorRun() 이 INSERT.
-- 조회: 수집기별 최근 N회 → (collector, finished_at DESC) 인덱스.
-- api_quota_log 와 별개 — quota 는 API 호출수, runs 는 수집 성공/실패.
-- ROLLBACK: _rollbacks/20260517020124_rollback_add_collector_runs.sql

CREATE TABLE IF NOT EXISTS collector_runs (
  id            SERIAL PRIMARY KEY,
  collector     TEXT NOT NULL,
  status        TEXT NOT NULL,           -- success / failure / partial
  ok_count      INTEGER,
  fail_count    INTEGER,
  skip_count    INTEGER,
  elapsed_sec   REAL,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collector_runs_recent
  ON collector_runs (collector, finished_at DESC);

COMMENT ON TABLE collector_runs IS '수집기 1회 실행 결과 (recordCollectorRun 적재). 관리자 모니터링 화면용.';
