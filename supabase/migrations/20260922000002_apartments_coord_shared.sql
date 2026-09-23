-- apartments.coord_shared — 좌표를 남의 단지와 공유하는 행 표시 (세션560)
--
-- 배경: 지오코딩이 단지를 못 찾으면 구청·면사무소 같은 **대표 장소 좌표**로 떨어진다.
--   그러면 서로 다른 단지 여럿이 소수점까지 똑같은 좌표를 공유한다
--   (2026-09-22 실측: 29자리·152곳, 그중 손님 화면 노출 83곳 = 전체 2,457 중 3.4%).
--   좌표가 틀리면 그 좌표로 재는 것이 전부 틀린다 — 지하철·학교·병원·대기질 측정소까지.
--
-- 왜 고치지 않고 표시만 하나: 남은 것들은 **아직 준공 전이라 지도에 없어서** 정정 도구
--   (`fix-placeholder-addresses.mjs`)의 세 출처(카카오 POI·청약홈 주소·네이버 단지)가
--   전부 정답을 못 찾는다(같은 날 dry-run 1,860곳 분석 → 정정 대상 0곳).
--   추측으로 옮기면 멀쩡한 좌표를 망친다(형제 행 좌표를 쓰려다 `금강펜테리움 6차`↔`7차`,
--   `봉담자이 3차`↔`4차` 같은 별개 단지를 묶는 규칙이 나와 폐기했다).
--
-- 채우는 주체: `scripts/collectors/flag-shared-coords.mjs` (판정 규칙은 그 파일 주석 참조).
--   좌표가 나중에 고쳐지면 같은 수집기가 표시를 **내린다**(양방향).
--
-- ⚠️ 공유 DB 주의: `apartments` 는 이 프로젝트 소유 테이블이고, 자매 레포(naver-estate-web)는
--   이 표를 쓰지 않는다(세션557 나노조사 46개 표 실측). **컬럼 추가**는 기존 컬럼·타입·순서를
--   바꾸지 않으므로 읽는 쪽 계약도 깨지 않는다.
--
-- ⚠️ 적용 방법: **Supabase Dashboard SQL Editor 수동 실행**. 이 레포의 supabase CLI 는 다른
--   조직으로 로그인돼 있어 db query 가 이 프로젝트에 닿지 않는다(세션489 실측).
--
-- 적용 전에도 프론트는 안전하다: VIEW 에 컬럼이 없으면 `apt.coordShared` 가 undefined 라
--   경고가 그냥 안 뜬다(값이 깨지거나 화면이 죽지 않는다).
--
-- ROLLBACK: _rollbacks/20260922000003_rollback_apartments_coord_shared.sql

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS coord_shared BOOLEAN;

COMMENT ON COLUMN apartments.coord_shared IS
  '이 단지의 좌표를 다른 단지(핵심이름이 다른 행)와 공유한다 = 지오코딩 자리표시 의심. scripts/collectors/flag-shared-coords.mjs 가 채운다. true 면 좌표 파생값(교통·학군·인프라·대기질)을 그대로 믿을 수 없다';

-- 부분 인덱스 — true 인 행만 찾는 조회(감사·모니터)를 위한 것. 전체 3,068행 중 152행 규모라
-- 일반 인덱스는 낭비다.
CREATE INDEX IF NOT EXISTS idx_apartments_coord_shared
  ON apartments (coord_shared) WHERE coord_shared = TRUE;
