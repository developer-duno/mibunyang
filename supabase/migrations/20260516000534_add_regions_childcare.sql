-- regions.childcare JSONB 신규 컬럼 추가 (세션 252 W6-D 옵션 ε)
-- 보육정보공개 API cpmsapi021 (한국사회보장정보원_전국 어린이집 정보 조회) 7필드 시군구 집계.
-- endpoint: http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request
-- 응답 필드 7: stcode(어린이집코드) / crname(어린이집명) / crtel(전화) / crfax(팩스) / craddr(주소) / crhome(URL) / crcapat(정원)
-- 환각 정정: 기술문서 spec = crtelno/crfaxno BUT 실제 API 응답 = crtel/crfax (no `no` suffix, 2026-05-16 실증 박제)
-- 의미 단위: 시군구 집계 (count + total_capacity + facilities raw 리스트).
-- 단지별 도보권 인프라는 infra.childcare/childcare_dist (Kakao POI) 보존 - 의미 다름.
-- W6-D2 옵션 δ (cpmsapi030 60+ 필드 단지 매칭, BACKLOG 박제) = 별 세션 분할.
-- ROLLBACK: _rollbacks/20260516000534_rollback_add_regions_childcare.sql

ALTER TABLE regions ADD COLUMN IF NOT EXISTS childcare JSONB DEFAULT NULL;

COMMENT ON COLUMN regions.childcare IS '보육정보공개 cpmsapi021 어린이집 정보 시군구 집계 (count/total_capacity/facilities[7필드]). 정부 공식 허가 시설. infra.childcare (Kakao POI) 와 의미 단위 다름.';
