-- 네이버 부동산 개발계획(new.land.naver.com/api/developmentplan/{road|rail|station|jigu}/list) 신규 테이블
--
-- 배경: apartments.transit_dev/city_dev/industry_dev(개발 호재 3필드)는 2026-03-14 이후
--   5개월간 갱신 0회인 손수 적은 시드 JSON 106건이 전부다. 이 마이그는 그 3컬럼을
--   **건드리지 않는다** — scoreFuture.ts 가 즉시 읽어 226곳의 점수가 움직이고(159곳 하락)
--   때문에, 점수 반영은 경계 재설계 후 별건으로 한다("경계 먼저, 데이터 나중").
--
-- 4종(도로/철도/역/지구)을 한 테이블에 kind 컬럼으로 구분해 담는다. 원본 식별자
-- (railId/stationId/roadId/jiguId, 없으면 gid 폴백)로 UNIQUE(kind, source_id) —
-- 타일이 겹쳐 같은 개발계획이 여러 타일에서 잡혀도 최신 값으로 upsert된다.
--
-- raw JSONB 에 원본 응답 객체 전체를 보존 — 화면 배선 전에 필드가 더 필요해지면
-- 재수집 없이 raw 에서 뽑아 쓸 수 있다.
--
-- ⚠️ 이 마이그레이션은 **적용하지 않은 상태**로 커밋한다(사장님 지시). 적용은 이 레포의
--   원칙대로 Supabase Dashboard SQL Editor 수동 실행(supabase/CLAUDE.md §마이그레이션 적용).
--
-- 롤백: 20260811100001_rollback_create_dev_plans.sql

CREATE TABLE IF NOT EXISTS dev_plans (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('road', 'rail', 'station', 'jigu')),
  source_id TEXT NOT NULL,       -- roadId/railId/stationId/jiguId, 없으면 gid 폴백
  gid TEXT,                      -- 원본 API gid (진단용, source_id 와 다를 수 있음)
  name TEXT,                     -- roadName/railName/stationName/jiguName
  lat DOUBLE PRECISION,          -- yPos
  lng DOUBLE PRECISION,          -- xPos
  progression_step TEXT,         -- progressionStep(road/rail) 또는 jiguStep(jigu). station 은 NULL(원본에 없음)
  eta TEXT,                      -- constructionPeriod(road/rail) 또는 openDate(station). jigu 는 NULL
  raw JSONB NOT NULL,            -- 원본 응답 객체 전체 (developmentPlan* 중첩 포함)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_plans_kind ON dev_plans(kind);
CREATE INDEX IF NOT EXISTS idx_dev_plans_location ON dev_plans(lat, lng);

COMMENT ON TABLE dev_plans IS
  '네이버 부동산 개발계획(도로/철도/역/지구) 원본 보존. apartments.transit_dev 등 점수 컬럼과 무관 — 배선 전 별도 테이블.';
COMMENT ON COLUMN dev_plans.source_id IS
  '원본 API 식별자(roadId/railId/stationId/jiguId). 없으면 gid 로 폴백. kind 와 묶어 UNIQUE.';
COMMENT ON COLUMN dev_plans.raw IS
  '원본 API 응답 객체(해당 kind 의 developmentPlan* 중첩 포함) 전체 보존 — 화면 배선 전 필드 재수집 방지.';

-- RLS (공식/시계열 테이블 표준: Public read + Service write — applyhome_cancel_respl 패턴)
ALTER TABLE dev_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"   ON dev_plans FOR SELECT USING (true);
CREATE POLICY "Service write" ON dev_plans FOR ALL    USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
