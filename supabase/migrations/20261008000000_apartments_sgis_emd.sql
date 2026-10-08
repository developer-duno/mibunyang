-- apartments.sgis_emd_cd · sgis_mapped_at — SGIS 행정동 매핑 칸 (세션614 · SGIS 1단계)
--
-- 배경: SGIS(국가데이터처 통계지리정보서비스) 동네 통계(인구·가구·주택)는 SGIS 행정동 코드 8자리
--   (시도2+시군구3+읍면동3)로만 조회된다. 시도 코드가 SGIS 자체 체계(세종 29·전남 36)라 법정동 bjd_code 와
--   다르고, 좌표로 한 번 역지오코딩해야 얻는다 → 배치가 채우는 **칸**으로 둔다.
--   설계서 = .omc/artifacts/session614/plan-sgis-map-emd.md §1
--
-- 채우는 주체: scripts/collectors/sgis-map-emd.mjs (로컬 러너 매주 화요일 · 빈칸만 채움, 이미 채워진 행은 안 덮는다).
--   NULL = 아직 안 매핑 · 좌표 없음 · SGIS 결과 없음(-100) · 시도 불일치로 건너뜀.
--
-- ⚠️ 공유 DB: `apartments` 는 이 프로젝트 소유 표. 자매 레포(naver-estate-web)는 이 표를 **읽기만** 한다
--   (칸을 하나씩 적어 매핑 — 칸 추가는 그쪽 조회를 깨지 않는다). 기존 칸·타입·순서를 바꾸지 않는다.
--   VIEW apartments_flat 은 만들 때 칸 목록이 펼쳐져 저장되므로(`SELECT *` 가 그 시점 칸으로 고정)
--   이 칸들이 VIEW 출력에 끼어들지 않는다. 권한 기준선 영향 0(열 추가).
--
-- ⚠️ 적용: 메인 세션이 psql 로(운영 DB 에서 BEGIN → 적용 → 확인 → ROLLBACK 리허설 1회 뒤 본 적용).
--   적용 시각은 KST 03:00~06:30(굽기·증분 수집·로컬 러너)과 월·목 08~14시(네이버 러너)를 피한다.
--   ADD COLUMN(기본값 없음, NULL 허용)은 표를 다시 쓰지 않지만 CHECK 는 기존 행을 한 번 훑는다(전부 NULL 이라 즉시 통과).
--   잠금은 잠깐 필요하다 → 오래 도는 쿼리 뒤에 줄 서서 표 전체를 막지 않게 lock_timeout 을 건다.
--
-- 적용 확인 쿼리(기대: 2행 · sgis_emd_cd text YES · sgis_mapped_at timestamp with time zone YES):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'apartments' AND column_name IN ('sgis_emd_cd', 'sgis_mapped_at');
--
-- ROLLBACK: _rollbacks/20261008000001_rollback_apartments_sgis_emd.sql

SET lock_timeout = '5s';

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS sgis_emd_cd TEXT
  CHECK (sgis_emd_cd IS NULL OR sgis_emd_cd ~ '^[0-9]{8}$');

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS sgis_mapped_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS apartments_sgis_emd_idx ON apartments (sgis_emd_cd);

COMMENT ON COLUMN apartments.sgis_emd_cd IS
  'SGIS(국가데이터처) 행정동 코드 8자리 = 시도2+시군구3+읍면동3 (시도 코드는 SGIS 자체: 세종29·전남36). scripts/collectors/sgis-map-emd.mjs 가 좌표로 rgeocodewgs84 1회 매핑. NULL = 미매핑·좌표 없음·결과 없음(-100). 법정동 bjd_code 와 다른 체계';

COMMENT ON COLUMN apartments.sgis_mapped_at IS
  'sgis_emd_cd 를 쓴 시각';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
