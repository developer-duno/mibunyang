-- 측정소별 대기질 3년 평균 (에어코리아 최종확정 측정자료)
--
-- 왜 필요한가 (세션559):
-- `apartments.air_quality` 는 "오늘 하루" 실시간 값이라 날마다 몇 배씩 바뀐다.
-- 그 값으로 점수를 매기면 같은 단지가 내일 재면 점수가 달라진다 — "이 아파트가 좋다" 가
-- 아니라 "오늘 날씨가 어땠다" 를 점수에 넣는 셈이다.
-- 실측: 오늘값은 3,068단지를 "보통"/"좋음" 두 갈래로만 갈랐고(서로 다른 값 29종),
-- 3년 평균은 5.6~27.1 에 고르게 퍼진다(130종). 지역 순위도 뒤집힌다
-- (오늘값 1위 강원 → 3년평균 1위 제주 / 꼴찌 전북 → 인천).
--
-- 출처: 한국환경공단_에어코리아_최종확정 측정자료 (data.go.kr 15122830)
--   - 국립환경과학원 검수 완료(확정치), XLSX 파일, 신청 불필요·무료
--   - 2022·2023·2024 3개년 × 월별 시트 12개 × 약 40~50만 행(시간 단위)
--   - 갱신: 연 1회, 그것도 약 6개월 늦게(2024년분이 2025-06 등록)
--
-- 왜 측정소 단위인가:
-- 단지 3,068곳이 쓰는 측정소는 392종뿐이다(여러 단지가 한 측정소를 공유 — 예: 동대문구 51곳).
-- 단지마다 값을 복사하면 같은 값이 3,068번 중복 저장되고 갱신 때 전체를 다시 써야 한다.
-- 측정소별 663행으로 두면 조인 한 번으로 끝나고, 자료가 갱신되면 이 표만 바꾸면 된다.
--
-- 왜 apartments_flat VIEW 를 안 건드리는가:
-- 세션134 unsold_history · 세션(market_stats_history) 선례와 같은 "추가 자료" 성격이다.
-- 단지↔측정소 조인은 스코어링 단계에서 하고, VIEW 는 손대지 않는다(회귀 위험 최소화).
--
-- 연결 실측(세션559): `apartments.air_quality->>'station'` 과 station_name 이 같은 표기라
-- 추가 매핑이 필요 없다. 392종 중 382종(97.4%) 연결, 단지 3,010/3,068(98.1%) 커버.
-- 미연결 10종(용계동·옥포항·감일 등)은 2024년 이후 신설 측정소 = 58단지(1.9%).
--
-- ROLLBACK: 20260922000001_rollback_create_air_station_annual.sql
CREATE TABLE IF NOT EXISTS air_station_annual (
  station_name TEXT PRIMARY KEY,          -- 측정소명 — apartments.air_quality->>'station' 과 같은 표기
  station_code TEXT,                      -- 에어코리아 측정소코드(예: 111121). 이름이 바뀌어도 추적 가능
  pm25 REAL,                              -- 초미세먼지 3년 평균 (㎍/㎥). 국가 대기환경기준 연평균 15 이하
  pm10 REAL,                              -- 미세먼지 3년 평균 (㎍/㎥). 기준 연평균 50 이하
  o3 REAL,                                -- 오존 3년 평균 (ppm)
  years TEXT NOT NULL,                    -- 집계에 쓴 연도 (예: "2022,2023,2024") — 재현·검증용
  sample_hours INTEGER,                   -- 집계에 쓴 시간(행) 수. 결측 많은 측정소 판별용
  address TEXT,                           -- 측정소 주소 (좌표 검증·화면 표시용)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE air_station_annual IS
  '에어코리아 최종확정 측정자료(data.go.kr 15122830) 기반 측정소별 3년 평균. 연 1회 수동 갱신 — scripts/collectors/air-annual-aggregate.mjs';
COMMENT ON COLUMN air_station_annual.station_name IS
  '측정소명. apartments.air_quality->>''station'' 과 같은 표기라 그대로 조인한다(세션559 실측 97.4% 일치)';
COMMENT ON COLUMN air_station_annual.sample_hours IS
  '집계 표본 수. 점검·통신장애로 결측(빈 칸)이 많은 측정소를 걸러낼 때 쓴다. 3년치 정상이면 약 26,000시간';

CREATE INDEX IF NOT EXISTS idx_air_station_annual_pm25 ON air_station_annual(pm25);

ALTER TABLE air_station_annual ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON air_station_annual FOR SELECT USING (true);
CREATE POLICY "Service write" ON air_station_annual FOR ALL USING (auth.role() = 'service_role');

-- ROLLBACK 절차 (Dashboard SQL Editor 수동 실행)
-- DROP POLICY IF EXISTS "Service write" ON air_station_annual;
-- DROP POLICY IF EXISTS "Public read" ON air_station_annual;
-- DROP INDEX IF EXISTS idx_air_station_annual_pm25;
-- DROP TABLE IF EXISTS air_station_annual;
