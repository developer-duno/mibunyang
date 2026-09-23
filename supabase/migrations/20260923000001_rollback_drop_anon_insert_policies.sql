-- ROLLBACK: 20260923000000_drop_anon_insert_policies.sql (세션566)
--
-- 되돌리면 공개 열쇠(anon)로 두 표에 직접 넣기가 다시 열린다 — 보안 고문 경고 2건이 재발한다.
-- api/consults.ts 는 service key 로 넣으므로 되돌리지 않아도 상담 접수는 동작한다.
--
-- ⚠️ 적용 방법: Supabase Dashboard SQL Editor 수동 실행.

CREATE POLICY consults_anon_insert ON consults FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon insert" ON subscribers FOR INSERT TO anon WITH CHECK (true);
