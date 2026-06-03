-- 수집기 감시 알림 dedup 상태 (monitor-collectors.mjs).
-- workflow_run 트리거(수집기 ~40개 완료마다) + 매일 cron 으로 monitor 가 발화하는데,
-- dedup 이 없어 같은 stale 이슈(예: housing-permits 5/26 0건)를 매번 재알림하던 텔레그램 스팸 차단.
-- alert_key = `${kind}|${collector}|${at}` 안정 키 → 한 번 보낸 이슈는 재발송 skip.
-- 같은 stale 행(at 불변)은 1회만 알림, 새 행(at 변경)이 다시 0건이면 새 키라 재알림.
-- BEGIN/COMMIT 사용 안 함 (기존 신규 테이블 마이그 패턴, Supabase 자동 적용).

CREATE TABLE monitor_alert_state (
  alert_key TEXT PRIMARY KEY,           -- `${kind}|${collector}|${at}` (예: "empty|housing-permits|2026-05-26T18:46:08Z")
  kind TEXT NOT NULL,                   -- fail | empty | stale | nulls | outage
  collector TEXT NOT NULL,              -- 수집기/워크플로명
  sent_at TIMESTAMPTZ DEFAULT NOW()     -- 최초 알림 발송 시각
);

-- 내부 운영 테이블 — collector_runs 동일 RLS 패턴 (Public read + Service write).
ALTER TABLE monitor_alert_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON monitor_alert_state FOR SELECT USING (true);
CREATE POLICY "Service write" ON monitor_alert_state FOR ALL USING (auth.role() = 'service_role');
