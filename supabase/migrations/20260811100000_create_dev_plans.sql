-- 개발계획/개발축 원본 보존 테이블 — 네이버 부동산(도로/철도/역/지구) + V-WORLD(산업단지/LH사업지구)
--
-- 배경: apartments.transit_dev/city_dev/industry_dev(개발 호재 3필드)는 2026-03-14 이후
--   5개월간 갱신 0회인 손수 적은 시드 JSON 106건이 전부다. 이 마이그는 그 3컬럼을
--   **건드리지 않는다** — scoreFuture.ts 가 즉시 읽어 226곳의 점수가 움직이고(159곳 하락)
--   때문에, 점수 반영은 경계 재설계 후 별건으로 한다("경계 먼저, 데이터 나중").
--
-- 세션511: 네이버 하나로는 커버가 안 된다(산업단지·LH사업지구 경계는 V-WORLD 가 정본) →
--   같은 표에 source 컬럼(naver/vworld)을 추가해 함께 담는다. kind 만으로는 네이버 jigu 와
--   V-WORLD lh_zone 이 섞이므로 UNIQUE 를 (source, kind, source_id) 로 확장.
--
-- kind 종류:
--   naver:  road(도로) · rail(철도) · station(역) · jigu(지구)
--   vworld: industrial_complex(산업단지, LT_C_DAMDAN) · lh_zone(LH사업지구, LT_C_LHZONE)
--
-- raw JSONB 에 원본 응답 객체 전체를 보존 — 화면 배선 전에 필드가 더 필요해지면
-- 재수집 없이 raw 에서 뽑아 쓸 수 있다(V-WORLD 는 폴리곤 자체도 raw 에 보존, lat/lng 는
-- 대표점(경계 좌표 평균)만 별도 컬럼에 저장 — naver-devplan.mjs geojsonCentroid 참조).
--
-- ⚠️ 이 마이그레이션은 **적용하지 않은 상태**로 커밋한다(사장님 지시). 적용은 이 레포의
--   원칙대로 Supabase Dashboard SQL Editor 수동 실행(supabase/CLAUDE.md §마이그레이션 적용).
--
-- 롤백: 20260811100001_rollback_create_dev_plans.sql

CREATE TABLE IF NOT EXISTS dev_plans (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'naver' CHECK (source IN ('naver', 'vworld')),
  kind TEXT NOT NULL CHECK (kind IN ('road', 'rail', 'station', 'jigu', 'industrial_complex', 'lh_zone')),
  source_id TEXT NOT NULL,       -- naver: roadId/railId/stationId/jiguId(없으면 gid 폴백)
                                  -- vworld: dan_id(industrial_complex) 또는 GeoJSON feature.id(lh_zone, 속성에 id 필드가 없음)
  gid TEXT,                      -- 원본 API gid/feature.id (진단용, source_id 와 다를 수 있음)
  name TEXT,                     -- roadName/railName/stationName/jiguName 또는 dan_name/zonename
  lat DOUBLE PRECISION,          -- naver: yPos 그대로. vworld: 폴리곤 경계 좌표 평균(대표점, 진짜 중심 아님)
  lng DOUBLE PRECISION,          -- naver: xPos 그대로. vworld: 폴리곤 경계 좌표 평균(대표점, 진짜 중심 아님)
  progression_step TEXT,         -- naver 전용: progressionStep(road/rail) 또는 jiguStep(jigu). station/vworld 는 NULL
  eta TEXT,                      -- naver 전용: constructionPeriod(road/rail) 또는 openDate(station). jigu/vworld 는 NULL
  raw JSONB NOT NULL,            -- 원본 응답 객체 전체 (naver: developmentPlan* 중첩 / vworld: GeoJSON feature 전체, 폴리곤 포함)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_plans_kind ON dev_plans(kind);
CREATE INDEX IF NOT EXISTS idx_dev_plans_location ON dev_plans(lat, lng);
CREATE INDEX IF NOT EXISTS idx_dev_plans_source ON dev_plans(source);

COMMENT ON TABLE dev_plans IS
  '개발계획/개발축 원본 보존 — 네이버 부동산(도로/철도/역/지구) + V-WORLD(산업단지/LH사업지구). apartments.transit_dev 등 점수 컬럼과 무관 — 배선 전 별도 테이블.';
COMMENT ON COLUMN dev_plans.source IS
  '데이터 출처. naver=new.land.naver.com developmentplan API, vworld=api.vworld.kr Data API(GetFeature).';
COMMENT ON COLUMN dev_plans.source_id IS
  '원본 API 식별자. naver=roadId/railId/stationId/jiguId(없으면 gid 폴백), vworld=dan_id 또는 GeoJSON feature.id. (source, kind) 와 묶어 UNIQUE.';
COMMENT ON COLUMN dev_plans.lat IS
  'vworld 는 폴리곤 경계 좌표들의 단순 평균(대표점) — 기하학적으로 정확한 중심(centroid)이 아님. 거리 비교용 근사치.';
COMMENT ON COLUMN dev_plans.raw IS
  '원본 응답 객체 전체 보존(naver: developmentPlan* 중첩, vworld: GeoJSON feature 전체 — 폴리곤 좌표 포함) — 화면 배선 전 필드 재수집 방지.';

-- RLS (공식/시계열 테이블 표준: Public read + Service write — applyhome_cancel_respl 패턴)
ALTER TABLE dev_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"   ON dev_plans FOR SELECT USING (true);
CREATE POLICY "Service write" ON dev_plans FOR ALL    USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
