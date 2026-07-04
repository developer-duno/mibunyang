-- 수집기 감시 매일 아침 브리핑용 일별 스냅샷 (monitor-collectors.mjs --mode=daily, 세션 478).
-- 브리핑의 "전체 채움률 어제 대비 ▲▼" 를 계산하려면 어제 값을 저장해야 하는데 기존 저장 테이블이
-- 없어 신설. daily 스윕(KST 09:00 = UTC 00:00)이 하루 1행 upsert → 다음날 어제 행을 조회해 증감 표시.
--
-- ⚠️ 시간축 = UTC 통일 (timezone-consistency 룰). collector_runs.finished_at 이 TIMESTAMPTZ
--    DEFAULT NOW() = UTC 이고 monitor 도 UTC 러너에서 도므로, "지난 24h"·snapshot_date 전부 UTC 기준.
--    snapshot_date = new Date().toISOString().slice(0,10) (UTC 날짜). today()(KST) 는 쓰지 않음
--    (KST 달력일 PK 와 UTC 롤링 24h 가 09:00 경계에서 어긋날 수 있음). 화면 표시만 toKst.
-- BEGIN/COMMIT 사용 안 함 (기존 신규 테이블 마이그 패턴, Supabase 자동 적용).

CREATE TABLE monitor_daily_snapshot (
  snapshot_date DATE PRIMARY KEY,        -- UTC 날짜 (하루 1행, 여러 발화여도 upsert 로 1행 유지)
  fill_rate REAL,                        -- computeAudit avgReliability (%) — 전체 채움률
  collected_24h INTEGER,                 -- 지난 UTC 24h 정상 수집 건수 합 (collector_runs.ok_count)
  created_at TIMESTAMPTZ DEFAULT NOW()   -- 이 행이 기록된 시각
);

-- 내부 운영 테이블 — collector_runs/monitor_alert_state 동일 RLS 패턴 (Public read + Service write).
ALTER TABLE monitor_daily_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON monitor_daily_snapshot FOR SELECT USING (true);
CREATE POLICY "Service write" ON monitor_daily_snapshot FOR ALL USING (auth.role() = 'service_role');
