-- 분양 알림 발송 로그 (세션 467 — 분양 알림 발송 기능 PR1)
-- 역할: (1) 멱등 dedup — UNIQUE 4열이 같은 구독자×같은 공고 재발송을 원천 차단
--       (2) 발송 감사 이력 (PIPA — phone 원문 저장 금지, subscriber_id FK 만)
-- 쓰기 주체: scripts/notify-subscribers.mjs (service_role, 주간 월 cron)
-- 읽기 주체: 발송 스크립트(dedup) + admin 조회 API (PR2)
-- ⚠️ 적용: Supabase Dashboard SQL Editor 수동 실행 (supabase/CLAUDE.md 원칙)

CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGSERIAL PRIMARY KEY,
  -- 구독자 삭제(완전 파기 요청) 시 발송 이력도 함께 파기 — PIPA 정합
  subscriber_id BIGINT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  -- FK 없음(의도): 단지 로스터 정리로 apartments 행이 삭제돼도 감사 로그는 보존
  apartment_id TEXT NOT NULL,
  -- 청약홈 공고 번호 — 같은 단지의 차수별 공고는 별개 이벤트로 재알림 허용
  house_manage_no TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'receipt_start',
  event_date DATE,                -- 접수 시작일 (표시·감사용, 판정은 스크립트가 수행)
  channel TEXT NOT NULL,          -- 'sms' | 'dry_run'
  status TEXT NOT NULL,           -- 'pending' | 'sent' | 'dry_run' | 'failed'
  fail_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscriber_id, apartment_id, house_manage_no, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_recent
  ON notification_logs (created_at DESC);

-- RLS: 정책 0개 = anon/authenticated 전면 차단 (subscribers 패턴 답습).
-- 시계열 테이블의 "Public read" 관행을 복붙하지 말 것 — 발송 이력은 개인 연결 데이터.
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE notification_logs IS
  '분양 알림 발송 로그. UNIQUE(subscriber_id, apartment_id, house_manage_no, event_type) 가 멱등 dedup 의 진실의 원천. phone 원문 저장 금지(PIPA).';
