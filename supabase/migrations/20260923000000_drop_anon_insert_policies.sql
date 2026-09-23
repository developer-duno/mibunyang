-- 세션566: Supabase 보안 고문(Security Advisor) 경고 0024 "RLS Policy Always True" 2건 해소
--
-- 왜: 이 DB 의 공개 열쇠(anon key)는 자매 사이트 2u.pe.kr 로그인 화면 JS 에 실려 있다
--     (2026-09-23 실측: 번들 18개 중 1개에 JWT role=anon ref=rwdtljipvmqpazrimyns).
--     아래 두 정책이 있으면 누구나 REST API 로 구독자(전화번호)·상담 표에 가짜 행을 직접 넣을 수
--     있었다 — 우리 API 의 검증·레이트리밋·동의 절차를 건너뛴다. 읽기는 원래 막혀 있었다(anon 조회 0행).
--     구독자 표는 알림 문자 발송(scripts/notify-subscribers.mjs)의 수신 명단이라, 발송 기능을 켜는
--     순간 가짜 번호로 실제 문자가 나가게 된다(2026-09-23 현재 SMS_ADAPTER_READY=false 라 미발송).
--
-- 영향: 우리 API 는 두 표 모두 service key 로 넣는다(service_role 은 RLS 를 우회한다).
--   - api/subscribers.ts — 원래부터 getMibuyangSupabase()
--   - api/consults.ts    — 이번 PR 에서 getSupabase()(anon) → getMibuyangSupabase()
--   service_role 정책(consults_service · "Service read" · "Service update")은 그대로 둔다
--   (공식 검사 SQL 0024 는 anon·authenticated·public 대상 정책만 본다).
--
-- ⚠️ 순서: api/consults.ts 변경이 **운영에 배포된 뒤** 적용한다. 먼저 적용하면 상담 접수가 500 이 된다.
-- 적용 방법: Supabase Dashboard SQL Editor 또는 psql 단발 실행.
-- 되돌리기: 20260923000001_rollback_drop_anon_insert_policies.sql

DROP POLICY IF EXISTS consults_anon_insert ON consults;
DROP POLICY IF EXISTS "Anon insert" ON subscribers;
