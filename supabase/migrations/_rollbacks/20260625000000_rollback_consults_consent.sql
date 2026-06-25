-- 롤백: consults.consent_at 컬럼 제거 (20260625000000_consults_consent.sql 되돌림)
ALTER TABLE consults DROP COLUMN IF EXISTS consent_at;

NOTIFY pgrst, 'reload schema';
