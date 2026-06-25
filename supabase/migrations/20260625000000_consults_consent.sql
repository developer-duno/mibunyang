-- consults 개인정보 수집·이용 동의 시각 컬럼 추가 (PIPA §15 — 수집 시점 동의 기록)
--
-- 배경: 상담 신청 폼(ConsultForm)이 이름·전화·메시지(PII)를 수집하면서 동의 시각을
--   기록하지 않았다. SubscribeForm/subscribers 의 consent_at 패턴을 답습해 consults 에도
--   동의 시각을 박는다. POST /api/consults 핸들러가 consent===true 검증 후 NOW() 로 채운다.
--
-- ⚠️ NULL 허용 (DEFAULT 없음) 의무:
--   기존 상담 행에는 동의 기록이 없으므로 DEFAULT NOW() 로 추가하면 과거 신청자에게
--   "동의함" 으로 잘못 기록된다(부정확한 법적 기록). NULL 로 두어 "동의 미기록(구 데이터)"
--   과 "동의함(신규)" 을 구분한다. 신규 INSERT 는 핸들러가 항상 채운다.
--
-- consults 는 mibunyang 전용 테이블 (supabase/CLAUDE.md "테이블 소유권" — naver-estate-web
--   영향 0). apartments_flat VIEW 는 consults 를 JOIN 하지 않음(VIEW 영향 0).
--   ADD COLUMN 은 기존 RLS 정책(anon INSERT-only, service_role ALL)·인덱스에 영향 없음.
--
-- 롤백: 20260625000000_rollback_consults_consent.sql (ALTER TABLE consults DROP COLUMN consent_at;)

ALTER TABLE consults ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
