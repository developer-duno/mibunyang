# 설계서 — 2u 의견함 → 미분양 이식 (세션653 · 2026-10-21 · v2 · 문서만)

> **v2(같은 날)**: 검사관 2인(맹점 🔴1·🟠2·🟡11 · 할루 틀림 3·확인 불가 2) 반영. 무엇을 어디서 고쳤는지 = 11절 표. 새 기능은 더하지 않았고, 갈리는 선택은 7절 D12~D18 로 여쭌다.

> 사장님 결정(세션611 10/07 22:2x): **전부 옮김**(공개 "고쳤습니다" 페이지까지) · 돈 **0원 — Gmail SMTP** · 2u 표 `site_opinions` 와 **합치지 않고** 미분양 `site_feedback` 을 그대로 쓴다 · 트랙 = 이 설계서 → 검사관 → 사장님 승인 → PR.
> 근거 원문: 인계 `~/.claude/projects/F--mibunyang/memory/handoff_from_2u_2026-10-06_opinion_box.md` · 2u 부품 설명서 `~/.claude/projects/d--naver-estate-web/memory/opinion-box-kit-2026-10-06.md` · 2u 설계 정본 `D:/naver-estate-web/.omc/plans/opinion-box-2026-10-06.md`(v2 · 검사관 17건) · 2u 구현(읽기만) `backend/routers/opinions.py`·`backend/routers/admin/opinions.py`·`backend/services/opinion_alert.py`·`backend/services/email.py`·`backend/crawler/vacuum_maintenance.py`·`backend/db/migrations/V069·V070`·`backend/tests/test_opinions_router.py`·`test_opinion_alert.py`·`frontend/src/lib/opinion-labels.ts`.
> 이 레포 지금 것(읽음): `api/feedback.ts` · `api/_lib/rateLimit.ts`·`telegram.ts` · `src/hooks/useFeedback.ts` · `src/components/FeedbackForm.tsx`·`FeedbackFab.tsx`·`admin/AdminFeedback.tsx` · `src/constants/feedbackKinds.ts` · `supabase/migrations/20260925000000_site_feedback.sql` · `scripts/purge-old-consults.mjs` · `public/privacy.html` · `scripts/postbuild-prerender.mjs` · `supabase/ownership.json`(`site_feedback` = `{"owner":"mibunyang"}`, readers 없음 · `site_opinions` = 2u 소유 별개 표).
> **화면이 바뀌는 작업** → 만들기 전 전/후 그림 승인 + 합치기 전 캡처 승인(전역 규칙 `show-screen-changes-first`) — 5절 끝 「그림 승인 단계」.

---

## 1. 목표·범위

**목표**: 손님이 로그인 없이도 의견을 보내고, 관리자가 답하면 로그인 손님에게 답장 메일이 **한 번만** 가고, 관리자가 고른 것만 공개 "고쳤습니다" 목록에 손님 원문 없이 실린다.

| 구분 | 항목 | 이 설계에서 |
|---|---|---|
| **옮김(없음 6개)** | ① 봇 숨김 칸 | 보내기 창에 숨김 칸 · 값 있으면 201 주고 저장·알림 0 · 걸린 건수 로그 한 줄(내용·IP 없이) |
| | ② 알림 폭주 상한 | 텔레그램 새 의견 알림 시간당 20통(D14), 21번째에 "잠시 멈춤" 1통 — **Redis 카운터**(2u 는 프로세스 메모리) |
| | ③ 관리자 답장 + 메일 1회 | 답이 **처음 들어온 저장**에서만 가입 이메일로 자동 메일 1회(조건부 UPDATE 로 차지) · 실패·결과 모름은 화면 표시 + 수동 "다시 보내기" |
| | ④ 공개 목록 "고쳤습니다" | 관리자가 공개 제목·공개 답을 따로 써서 공개 표시한 것만 · 원문·이메일·보던 화면은 응답에 **키조차 없음** |
| | ⑤ 꼬리표 4상태 | `new`/`replied`/`fixed`/`closed` — 공개 꼬리표 "살펴보는 중/답했어요/고쳤어요/확인했어요" |
| | ⑥ 비로그인 보내기 | 의견 탭 로그인 벽 제거 · 비로그인은 이메일 없이 저장(답장 불가 안내) · 하루 한도 |
| **그대로 둠(있음 7개)** | 보내기 창(문의하기 모달 의견 탭) · 로그인 손님 확인 순서(서명→블랙리스트→KV 사용자→접근 거부) · 5분 5회 한도(`feedback: 5`) · 텔레그램 알림(이름·이메일 안 실음 · HTML 이스케이프 · await) · 관리자 처리 표시(→ 4상태로 넓힘) · 관리자 삭제 · 1년 삭제(→ 공개 행 처리만 바꿈) | 동작·문구를 바꾸지 않는다 — 넓히는 것만 |
| **하지 않는 것** | 2u 표와 합치기 · 2u 표·코드 수정 · 업체 문의 탭(`consults`) 변경 · "어떤 소식이 궁금하세요" 설문(7절 D6) · 화면 오류 자동 기록(2u V070, 7절 D7) · 답장 메일 외 다른 메일(소식 발송 등) · 유료 메일 서비스 · 점수·수집기 | 결정이 나면 별도 트랙 |

---

## 2. 데이터 — `site_feedback` 칸 추가 (마이그 `supabase/migrations/2026102X000000_site_feedback_reply_public.sql`)

### 2-1. 지금 표(20260925000000) 대비 바뀌는 것

| 칸 | 지금 | 바꾼 뒤 | 이유 |
|---|---|---|---|
| `user_email` | `text NOT NULL` | `text` (NULL 허용) | ⑥ 비로그인 보내기 |
| `message` | `NOT NULL` + CHECK 1~1000 | NULL 허용 + CHECK 그대로(NULL 은 CHECK 통과) | 1년 뒤 공개 행의 원문만 지움(6절) |
| `status` | CHECK `new`,`done` | **PR-1**: CHECK 5개 값 `new`,`done`,`replied`,`fixed`,`closed`(넓히기만) → **PR-1b**(PR-3 배포 뒤): `done→closed` 전이 + CHECK 4개 값 `new`,`replied`,`fixed`,`closed` | ⑤ — 옛 코드가 `done` 을 보내도 안 깨지게 두 번에 나눔(8절 중간 상태 표) · 전이는 2-3 |
| 새 `reply` | — | `text` CHECK `char_length(reply) BETWEEN 1 AND 2000` | 관리자 답(손님에게만 가는 글) |
| 새 `replied_at` | — | `timestamptz` | 처음 답을 쓴 시각 |
| 새 `reply_mail_claimed_at` | — | `timestamptz` | 메일 보내기 **차지** 표시 — 두 번 눌러도 메일 1통(3-3) |
| 새 `reply_mail_sent_at` | — | `timestamptz` | 메일이 실제로 나간 시각(NULL = 아직) |
| 새 `reply_mail_error` | — | `text` CHECK ≤ 300자 | 마지막 실패 사유(화면 표시용, 비밀값·주소 없이) |
| 새 `is_public` | — | `boolean NOT NULL DEFAULT false` | ④ |
| 새 `public_title` | — | `text` CHECK 1~100자 | 공개 제목(관리자가 씀) |
| 새 `public_answer` | — | `text` CHECK 1~2000자 | 공개 답(관리자가 씀) |
| 새 `published_at` | — | `timestamptz` | 공개 시각(목록 정렬·sitemap 날짜) |
| 새 `updated_at` | — | `timestamptz NOT NULL DEFAULT now()` | 관리자 고침 시각 |
| (표 CHECK) | — | `site_feedback_public_needs_text CHECK (NOT is_public OR (public_title IS NOT NULL AND public_answer IS NOT NULL AND published_at IS NOT NULL))` | **2u 는 API 만 막았다** — DB 에도 박아 API 버그가 나도 빈 공개가 못 생김 |
| 봇 숨김 칸 | — | **저장 안 함**(칸 없음) | 원칙 4 |
| IP | — | **DB 에는 저장 안 함** | 원칙 4 — 다만 하루 한도 Redis 키(Upstash 외부 서버)에 IP 묶음이 **하루** 남는다 → 원문 대신 비밀값 HMAC 앞 16자를 키로(D17 추천) · 처리방침에도 한 줄(5-4) |
| 색인 | `created_at DESC` | + `(status, created_at DESC)` · 부분 `(published_at DESC, id DESC) WHERE is_public` | 관리자 필터 · 공개 목록 |

### 2-2. 마이그 초안 — 두 개로 나눈다(적용은 사장님 승인 뒤 · `psql --single-transaction` + `lock_timeout` 래퍼, 파일 안 BEGIN/COMMIT 없음 — 20260925000000 과 같은 꼴)

**왜 둘인가**: 지금 CHECK 는 `new`·`done` 만 허용한다(`20260925000000_site_feedback.sql:24`). 한 번에 4개 값으로 바꾸면, PR-3 배포 전까지 떠 있는 지금 코드(`api/feedback.ts:29,231` · `AdminFeedback.tsx:109`)가 보내는 `done` 이 CHECK 에 막혀 500 이 나고, `closed` 가 된 옛 행은 지금 관리자 화면에 "새 의견"으로 보인다(:207·252). 그래서 **PR-1 은 넓히기만**(`done` 포함 5개 값), **PR-1b 는 PR-3 배포 뒤 좁히기**(`done→closed` + 4개 값). 단계별 모습 = 8절 「중간 상태 표」.

**규칙(🔴 반영)**: 값을 새 CHECK 밖으로 옮기는 UPDATE 는 언제나 **옛 CHECK 지우기 → UPDATE → 새 CHECK 넣기** 순서. CHECK 가 남은 채 UPDATE 하면 제약 위반으로 트랜잭션 전체가 취소된다.

**PR-1 마이그** `supabase/migrations/2026102X000000_site_feedback_reply_public.sql`(UPDATE 없음):

```sql
SET lock_timeout = '2s';  -- 래퍼가 주면 생략
-- ① NOT NULL 풀기
ALTER TABLE public.site_feedback ALTER COLUMN user_email DROP NOT NULL;
ALTER TABLE public.site_feedback ALTER COLUMN message    DROP NOT NULL;
-- ② status CHECK 넓히기: 옛 CHECK 지우기 → 5개 값 CHECK 넣기(값은 안 바꾼다 — done 그대로 허용)
--    이름을 박지 않고 status 한 칸짜리 CHECK 를 찾아 지운다(2u V070 :36-52 꼴)
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT co.conname FROM pg_catalog.pg_constraint co
           JOIN pg_catalog.pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
           WHERE co.conrelid = 'public.site_feedback'::pg_catalog.regclass AND co.contype = 'c'
             AND pg_catalog.array_length(co.conkey, 1) = 1 AND a.attname = 'status'
  LOOP EXECUTE pg_catalog.format('ALTER TABLE public.site_feedback DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_status_check
  CHECK (status IN ('new', 'done', 'replied', 'fixed', 'closed'));
-- ③ 새 칸
ALTER TABLE public.site_feedback
  ADD COLUMN IF NOT EXISTS reply                 text CHECK (char_length(reply) BETWEEN 1 AND 2000),
  ADD COLUMN IF NOT EXISTS replied_at            timestamptz,
  ADD COLUMN IF NOT EXISTS reply_mail_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_mail_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reply_mail_error      text CHECK (char_length(reply_mail_error) <= 300),
  ADD COLUMN IF NOT EXISTS is_public             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_title          text CHECK (char_length(public_title) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS public_answer         text CHECK (char_length(public_answer) BETWEEN 1 AND 2000),
  ADD COLUMN IF NOT EXISTS published_at          timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT pg_catalog.now();
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_public_needs_text
  CHECK (NOT is_public OR (public_title IS NOT NULL AND public_answer IS NOT NULL AND published_at IS NOT NULL));
CREATE INDEX IF NOT EXISTS site_feedback_status_created_idx ON public.site_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS site_feedback_public_idx ON public.site_feedback (published_at DESC, id DESC) WHERE is_public;
-- ④ 권한: 표 단위 REVOKE/GRANT 는 새 칸에도 그대로 묶인다 — 다시 회수·부여하지 않고 자체검사로 다시 본다
--   (20260925000000 :57-106 의 ①~④ 블록을 그대로 복사 + 아래 추가 검사)
DO $$ DECLARE n int; BEGIN
  IF EXISTS (SELECT 1 FROM public.site_feedback WHERE status NOT IN ('new','done','replied','fixed','closed')) THEN
    RAISE EXCEPTION 'site_feedback self-check: unknown status rows'; END IF;
  SELECT pg_catalog.count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='site_feedback'
     AND column_name IN ('reply','replied_at','reply_mail_claimed_at','reply_mail_sent_at','reply_mail_error',
                         'is_public','public_title','public_answer','published_at','updated_at');
  IF n <> 10 THEN RAISE EXCEPTION 'site_feedback self-check: expected 10 new columns, found %', n; END IF;
  IF pg_catalog.has_any_column_privilege('anon', 'public.site_feedback', 'SELECT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.site_feedback', 'SELECT') THEN
    RAISE EXCEPTION 'site_feedback self-check: anon/authenticated column SELECT'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
```

**PR-1b 마이그** `supabase/migrations/2026102Y000000_site_feedback_status_narrow.sql`(PR-3 배포 확인 뒤 · 전이표 승인 뒤 — 2-3):

```sql
SET lock_timeout = '2s';
-- ① 옛(5개 값) CHECK 지우기 → ② 값 옮기기 → ③ 새(4개 값) CHECK 넣기  ← 이 순서 고정
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_status_check;
UPDATE public.site_feedback SET status = 'closed' WHERE status = 'done';   -- D8
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_status_check
  CHECK (status IN ('new', 'replied', 'fixed', 'closed'));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.site_feedback WHERE status = 'done') THEN
    RAISE EXCEPTION 'site_feedback self-check: done rows remain'; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.site_feedback'::pg_catalog.regclass AND contype = 'c'
         AND conname = 'site_feedback_status_check') <> 1 THEN
    RAISE EXCEPTION 'site_feedback self-check: status check missing'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
```
- PR-1b 는 마이그와 함께 API 허용값에서 `done` 을 빼는 코드 한 줄을 싣는다 — **코드 배포 확인 → 마이그 적용** 순서(새 화면은 `done` 을 보내지 않으므로 그 사이 깨지는 곳 없음 · 옛 탭을 열어 둔 관리자만 400 → 새로고침 안내).

- **권한 원칙**: service_role S/I/U/D 만 그대로(TRUNCATE 없음) · anon·authenticated 0 · RLS 켬·정책 0. 공개 목록도 **anon 키로 읽지 않고** 공개 API(service key)가 정해진 5칸만 골라 낸다(anon key 는 2u 번들에 공개 — `supabase/CLAUDE.md` 「anon key 는 공개돼 있다」).
- **합치기 전 되돌림 시험 1회 — CHECK 순서를 실제로 거치게**(`supabase/CLAUDE.md` 「SQL 적용·시험」): 한 트랜잭션 안에서
  `BEGIN;` → 시험 행 1개 INSERT(`status='done'` · 20260925000000 의 NOT NULL 칸을 다 채워서) → `\i PR-1 마이그` → `\i PR-1b 마이그`(시험 행이 `closed` 가 됐는지 SELECT) → `\i PR-1b 되돌리기`(2-4a) → `\i PR-1 되돌리기`(2-4b — 시험 행이 `done` 으로 돌아오고 CHECK 정의가 `new`,`done` 인지 `pg_get_constraintdef` 로 확인) → 새 칸 0 확인 → `ROLLBACK;`. 어느 한 단계라도 CHECK 위반이 나면 순서가 틀린 것. 사장님 PC 접속 문자열이 없으면 이 묶음을 Dashboard SQL Editor 용으로 드린다.
- **권한 지문 기준선**: 지문(`20260924000400` :95-128)은 표 단위 grants·RLS·소유자·**칸 ACL(attacl 이 비어 있지 않을 때만)** 을 본다 — 칸 추가·CHECK 교체만이면 **기대 차이 0**(PR-1·PR-1b 둘 다 — 각 적용 직후 미리보기 1회씩). 적용 직후 `node scripts/perm-baseline.mjs` 미리보기 1회로 확인 → 차이 0 이면 재승인 없음 · 0 이 아니면 그 차이만 `--make-expect` → 사장님 승인 → `--accept --expect-file`(재승인 1건). 기대 차이 명단을 PR 본문에 미리 적는다.
- **2u 영향**: `site_feedback` 은 readers 없음(정본) → 2u 영향 0. 정본 `ownership.json` 의 `site_feedback` 에 `note`("세션653 칸 추가: reply·공개 칸") 한 줄 — CI 감사 ④(DROP/RENAME 금지)에 걸리는 문장 없음.

### 2-3. 옛 `done` 행 전이(운영 데이터를 바꾸는 실행 — 규칙 `data-changing-run-approval`)

- 전이는 **PR-1b 에서만** 일어난다(PR-1 은 값을 안 바꾼다). PR-1b 적용 직전 `select status, count(*) from site_feedback group by status` 를 재서 **전이표**(id 명단 · `done → closed` 몇 행)를 만들고 사장님 승인 뒤 PR-1b 마이그 한 트랜잭션에서 반영. 숫자는 지금 재지 않았다(DB 호출 0 — 지시서 4절). PR-1~PR-1b 사이에 관리자가 새로 `done` 을 누른 행도 그때 명단에 들어간다.
- 무엇으로 옮길지는 7절 D8(추천 `closed` = "확인했어요").

### 2-4. 되돌리기 SQL — 두 개(마이그와 짝)

**2-4a PR-1b 되돌리기** (`_rollbacks/2026102Y000001_rollback_site_feedback_status_narrow.sql`) — 4개 값 CHECK 를 5개 값으로 다시 넓힌다. `closed` 는 5개 값에도 있으므로 **값은 옮기지 않는다**(관리자가 직접 고른 `closed` 와 옛 `done` 에서 온 `closed` 를 섞지 않기 위해):
```sql
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_status_check;
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_status_check
  CHECK (status IN ('new', 'done', 'replied', 'fixed', 'closed'));
NOTIFY pgrst, 'reload schema';
```

**2-4b PR-1 되돌리기** (`_rollbacks/2026102X000001_rollback_site_feedback_reply_public.sql`) — 순서: 코드 되돌림·배포 확인 → (PR-1b 가 적용돼 있으면 2-4a 먼저) → 아래(새 코드가 떠 있는 채 칸을 지우면 의견함이 500). CHECK 는 **새 CHECK 지우기 → `replied`·`fixed`·`closed` → `done` UPDATE → 옛 CHECK(`new`,`done`) 복원** 순서:
```sql
-- 비로그인 행(user_email NULL)·원문 지운 공개 행(message NULL)이 있으면 NOT NULL 복원 전에 처리 방침을 사장님께 여쭌다
--   (지우기 = 손님 의견 유실 → 기본은 "NOT NULL 은 복원하지 않고 칸만 지움")
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_public_needs_text;
DROP INDEX IF EXISTS public.site_feedback_public_idx;
DROP INDEX IF EXISTS public.site_feedback_status_created_idx;
ALTER TABLE public.site_feedback
  DROP COLUMN IF EXISTS reply, DROP COLUMN IF EXISTS replied_at, DROP COLUMN IF EXISTS reply_mail_claimed_at,
  DROP COLUMN IF EXISTS reply_mail_sent_at, DROP COLUMN IF EXISTS reply_mail_error, DROP COLUMN IF EXISTS is_public,
  DROP COLUMN IF EXISTS public_title, DROP COLUMN IF EXISTS public_answer, DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_status_check;          -- ① 새 CHECK 지우기
UPDATE public.site_feedback SET status = 'done' WHERE status IN ('replied','fixed','closed');     -- ② 값 옮기기
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_status_check CHECK (status IN ('new','done'));  -- ③ 옛 CHECK 복원
NOTIFY pgrst, 'reload schema';
```
⚠ 되돌리기는 관리자 답·공개 답을 영구히 지운다 — 실행 전 해당 칸 사본(JSON)을 남긴다.

---

## 3. API (Vercel 서버리스 TS · `withHandler` · `checkRateLimit` · `requireAdminGate` 재사용)

### 3-1. 손님 보내기 — `POST /api/feedback`(기존 파일 고침)

| 단계 | 지금 | 바꾼 뒤 |
|---|---|---|
| 1 | `checkRateLimit(req,"feedback")` 5회/5분 | 그대로 |
| 2 | Bearer 없으면 401 | **선택 로그인**: Bearer 가 있으면 지금 순서 그대로 검증(서명→refresh 거부→블랙리스트→KV 사용자→접근 거부 403). 토큰이 **아예 없으면** 비로그인. 토큰이 있는데 무효·만료면 **401 그대로**(화면이 "다시 로그인" 안내 — 2u 는 만료 토큰을 조용히 비로그인 처리해 손님이 답장 못 받는 줄 모른다, 9절) |
| 3 | — | **숨김 칸** `fb_extra`(문자열, trim 후 비어 있지 않으면) → `201 {ok:true}` · 저장·알림·한도 차감 0 · `console.info("feedback honeypot 1")`(내용·IP 없이). 이름은 브라우저 자동완성·비밀번호 관리 프로그램이 채우는 이름(website·url·email·phone·name·address 류)을 피한다 — v1 의 `website` 는 이 원칙과 어긋나 바꿈 |
| 3' | 숨김 칸의 한계(받아들이는 것) | 숨김 칸은 **화면 폼을 채우는 봇만** 걸린다. API 를 직접 부르는 봇은 IP 3건 + 비로그인 전체 200건이 막는다. 봇이 전체 200건을 다 쓰면 **그날 비로그인 손님 전원이 막힌다**(로그인 손님은 통과 — 막힌 화면은 "로그인하시면 보낼 수 있어요" 안내). 전체 상한에 닿는 순간 `console.warn("feedback anon daily cap reached")` 한 줄 — 감시·알림 추가는 이 설계 밖 |
| 4 | — | **하루 한도(Redis, 한국 날짜 키)**: 로그인 = `fbday:<KST날짜>:u:<sha256(email) 앞 16>` 10건 · 비로그인 = `fbday:<날짜>:ip:<HMAC-SHA256(IP 묶음, 비밀값) 앞 16>` 3건(D17 추천 — 키에 IP 원문 없음) + `fbday:<날짜>:anon` 전체 200건. IP 묶음 = IPv6 앞 64비트 · IPv4-mapped 는 IPv4 · IPv4 그대로(2u `ip_bucket` 꼴). **`INCR` 과 `EXPIREAT`(다음 한국 자정)을 한 묶음(pipeline)으로** 보낸다 — 지금 `rateLimit.ts:28-31` 과 같은 꼴(따로 보내면 INCR 뒤 끊겼을 때 만료 없는 키가 남아 그 IP 가 영영 막힌다). 넘으면 429 `{error:"오늘은 더 보낼 수 없어요. 내일 다시 보내 주세요"}`(전체 상한은 "오늘은 의견이 많이 와서 더 받을 수 없어요. 로그인하시면 보낼 수 있어요"). **개인 한도에 막힌 요청은 전체 칸을 먹지 않게** 개인 키 먼저 보고 통과할 때만 전체 키 INCR. 저장 실패면 두 키 `DECR`(손님이 저장 안 된 글로 한도를 잃지 않게 — 2u `test_anon_slot_refunded_when_save_fails`) |
| 4' | Redis 장애 | 로그인 = fail-open(지금 결정 유지) · **비로그인 = fail-close**(인증 없는 공개 쓰기 — `subscribers` 와 같은 결, `rateLimit.ts:8-14`). 막을 때는 **429 한도 문구가 아니라 503** `{error:"지금은 의견을 받을 수 없어요. 잠시 뒤 다시 보내 주세요"}` — 우리 장애를 손님 한도 탓("오늘은 더 보낼 수 없어요")으로 돌리지 않는다(전역 규칙 `our-defect-is-not-customer-warning`). HMAC 비밀값이 없을 때도 같은 503(설정 실수를 원문 IP 저장으로 메우지 않음) |
| 5 | kind 4종·1~1000자·consent·page·apartmentId | 그대로(최소 1자 유지 — 2u 는 10자, D13) + **NUL(`\u0000`) 400** · 폭 0 문자(U+200B·U+200C·U+FEFF) 지운 뒤 길이 · ZWJ 는 남기되 최소 길이 셀 때만 뺌 · 짝 없는 서로게이트 400(2u `_message_length`·`_scrub_lone_surrogates` — JS 는 `/[\uD800-\uDFFF]/` 를 `isWellFormed()` 로) |
| 6 | insert(user_email 필수) | 비로그인이면 `user_email`·`user_name` NULL |
| 7 | 텔레그램 await | 그대로 + **시간당 상한**(3-5) · 보낸 분 줄: 로그인/로그인 안 함만(이메일은 지금처럼 안 실음) |
| 8 | 201 `{ok,id}` | 201 `{ok, id, canReply: 로그인 이메일 있음}` |

### 3-2. 관리자 목록·상태 — `GET`·`PATCH`·`DELETE /api/feedback`(기존)

- **옮겨 가는 동안의 `done`**: PR-2 API 는 PR-1b 전까지 `status` 로 `done` 도 받아 **그대로 저장**한다(지금 관리자 화면이 보내는 값 — `closed` 로 바꿔 저장하면 지금 화면이 그 행을 "새 의견"으로 그린다, `AdminFeedback.tsx:207·252`). 허용값 = `new·done·replied·fixed·closed` · PR-1b 가 `done` 을 뺀다(2-2).
- `GET`: `?status=`(허용값 중 하나, 아니면 400) 필터 · 응답에 새 칸 전부 + `newCount`(status=new 전체 수) + `oldestDays`(원문·이메일이 남은 행 중 가장 오래된 것의 한국 날짜 차 — 1년 삭제가 멈추면 366 을 넘어 커진다, 2u `_oldest_days`). 정렬·페이징 그대로(`created_at desc, id desc` + range).
- `PATCH { id, status?, reply?, isPublic?, publicTitle?, publicAnswer?, resendMail? }`:
  1. 바꾼 뒤 모습을 **먼저 계산**해 검사 — 공개면 제목·답 필수(422 "공개하려면 공개 제목과 공개 답을 모두 써 주세요") · 길이 초과 400 · **공개 제목·공개 답에 이메일 꼴(`[^\s@]+@[^\s@]+\.[^\s@]+`)이나 전화번호 꼴(`0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}`)이 있으면 422** "공개 글에 이메일이나 전화번호로 보이는 것이 있어요. 지우고 공개해 주세요"(운영자가 손님 글을 옮겨 적다 연락처가 섞이는 것을 막는 서버 쪽 잠금 · 화면 경고는 5-2). 검사 통과 전엔 DB 를 건드리지 않는다.
  2. 답을 처음 쓰고 상태를 안 보냈으면 `new → replied`(2u `test_reply_only_moves_new_to_replied`) · 상태를 같이 보내면 그 값(`fixed` 행에 답 써도 `fixed` 유지).
  3. 공개로 바뀌는 순간 `published_at = now()`, 비공개로 바뀌면 NULL · `updated_at = now()`.
  4. 저장 뒤 메일은 3-3(자동 = 이번 요청에서 답이 처음 들어왔을 때만 · `resendMail:true` = 수동 다시 보내기). 응답 `{ ok, item, mail: "sent" | "skipped" | "failed" | "already" | "unknown" }`.
- `DELETE`: 그대로(손님 삭제 요청 처리). 감사 기록 표는 이 레포에 없다 → `console.info("feedback delete id=N")` 한 줄(이메일 없이). 감사 표 신설은 하지 않는 것.

### 3-3. 답장 메일 1회 — 멱등 방식(2u 보다 단단하게)

2u 는 "저장 → 메일 → `reply_mail_sent=true`" 순서라 관리자가 **두 탭에서 동시에** 저장하면 두 요청이 둘 다 false 를 보고 메일 2통이 나갈 수 있다(화면 잠금만이 방어). 이 레포는 **DB 조건부 UPDATE 로 차지**한다.

**보장의 뜻(v2 에서 좁혀 정확히)**: 자동 발송은 **답 하나에 많아야 1회 시도**한다. 메일을 보낸 뒤 시각을 적기 전에 함수가 끊기면 "갔는지 모름"이 남는데, 이것은 **자동으로 다시 보내지 않고** 관리자가 보고 정한다. v1 의 "차지 10분 지나면 아무 저장에서나 자동 재발송"은 실제로는 "10분 안 1회"였다 — 버렸다.

**(가) 자동 발송** — PATCH 가 **이번 요청에서 답을 처음 넣었을 때만**(저장 전 행의 `reply` 가 NULL 이고 이번에 채움). 상태만 바꾸기·공개 누르기·답 고치기에서는 메일 시도 0.
```
UPDATE site_feedback SET reply_mail_claimed_at = now()
 WHERE id = $1 AND user_email IS NOT NULL AND reply IS NOT NULL
   AND reply_mail_sent_at IS NULL AND reply_mail_claimed_at IS NULL
 RETURNING id, user_email, message, reply
```
(supabase-js: `.update({...}).eq("id",id).not("user_email","is",null).not("reply","is",null).is("reply_mail_sent_at",null).is("reply_mail_claimed_at",null).select(...)`) — 만료 조건 없음.

**(나) 수동 다시 보내기** — `PATCH { id, resendMail: true }`(관리자 확인 `requireAdminGate` 그대로). POST 는 **손님 전용**으로 남겨 관리자가 손님 한도(5분 5회, `feedback.ts:54`)를 먼저 타지 않게 한다(v1 의 `POST ?action=resend-mail` 은 버림).
```
UPDATE site_feedback SET reply_mail_claimed_at = now()
 WHERE id = $1 AND user_email IS NOT NULL AND reply IS NOT NULL
   AND (reply_mail_claimed_at IS NULL OR reply_mail_claimed_at < now() - interval '10 minutes')
 RETURNING id, user_email, message, reply
```
`reply_mail_sent_at` 은 보지 않는다 → 성공 뒤 오타를 고쳐 다시 보낼 수 있다. 10분 조건은 "지금 다른 탭이 보내는 중"인 행을 겹쳐 보내지 않게 하는 것뿐.

**차지 뒤 처리(가·나 공통)**:
- 0행 → 메일 안 보냄(`already` · 이메일·답 없으면 `skipped`).
- 1행 → 그 요청만 보냄 → **성공**: `reply_mail_sent_at=now(), reply_mail_claimed_at=null, reply_mail_error=null`(차지를 비워 다시 보내기가 바로 되게) · **실패**: `reply_mail_claimed_at=null, reply_mail_error=<사유 300자>` → 화면 빨간 줄 + "다시 보내기". 실패한 행은 그 뒤 저장에서 자동 재시도하지 않는다(답이 "처음"이 아니므로) — 수동만.
- **결과 모름**: `reply_mail_claimed_at` 이 남았고 `reply_mail_sent_at` 이 NULL 인 행 → 10분 안이면 화면 "보내는 중", 10분 지나면 `unknown` "메일이 갔는지 확인하지 못했어요 — 이미 갔을 수 있어요" + "다시 보내기"(누르면 확인 창 한 번 더).
- 서버리스 30초 안에서 SMTP 타임아웃 10초.
- 메일 실패를 삼키지 않는다: 응답 `mail:"failed"` + `reply_mail_error` 저장 + `console.warn`. 텔레그램처럼 "조용히 skip" 하지 않는다(비밀값 없음도 `failed` "메일 설정 없음" 으로 화면에 보인다).

### 3-4. 공개 목록 — `GET /api/feedback-updates?page=N`(새 파일 · 로그인 불필요)

- 별도 파일로 둔다: 관리자 `GET /api/feedback` 과 한 핸들러에서 쿼리로 가르면 분기 실수 하나로 원문·이메일이 공개된다. 이 파일은 **select 칸을 손으로 5개만** 적는다: `id, public_title, public_answer, status, published_at` (`select("*")` 금지 — 정적 가드 시험으로 잠근다).
- `.eq("is_public", true).order("published_at",{ascending:false}).order("id",{ascending:false}).range(...)` · 20개씩 · `count: "exact"`.
- `withHandler({ method:"GET", rateLimit:"proxy" })` · `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
- **공개를 내려도 최대 15분 남는다**: CDN 이 5분 사본을 주고, 만료 뒤에도 옛 사본을 10분 더 줄 수 있다(5분 + 10분). 이 시간을 관리자 화면 공개 체크 옆에 적는다(5-2). 급히 내려야 할 때(연락처가 섞인 공개 등) CDN 캐시를 지우는 방법은 **PR-2 에서 Vercel 공식 문서로 확인해** `api/CLAUDE.md` 에 적는다 — 이번 v2 는 외부 호출 0 이라 확인하지 않았다(10절). 확인한 방법이 없으면 숫자를 줄이는 쪽(`s-maxage=60, stale-while-revalidate=60` = 최대 2분)을 PR-2 에서 여쭌다.
- 실패는 500 `{ok:false}` — 화면이 빈 목록으로 삼키지 않는다(원칙 6, 5-3).
- 응답 예: `{ ok:true, data:[{id, title, answer, status, publishedAt}], count, page }`.

### 3-5. 알림 폭주 상한(텔레그램)

- `api/_lib/telegram.ts` 에 `sendTelegramCapped(text, { counter:"feedback", limit:20 })`(20 = D14): Redis `tgcap:feedback:<KST YYYYMMDDHH>` `INCR` + `EXPIRE 3600*2` 한 묶음(pipeline) → `≤20` 이면 보냄 · `=21` 이면 "이번 시간엔 의견이 20건을 넘어 알림을 잠시 멈춰요(관리자 화면에서 보세요)" 1통 · `>21` 이면 0통. Redis 장애면 **보냄**(알림 유실보다 폭주가 덜 나쁨 — 상한은 편의 장치). 업체 문의 알림(`formatConsultAlert`)에는 걸지 않는다(범위 밖).
- 2u 는 프로세스 메모리 카운터(재시작하면 0). 서버리스는 호출마다 프로세스가 달라 메모리 카운터가 **아예 안 센다** → Redis 가 필수(9절).
- 알림은 지금처럼 응답 전에 await(서버리스는 응답 뒤 실행이 멈출 수 있다 — `api/feedback.ts:139` 주석). 2u 의 BackgroundTasks 는 옮기지 않는다.

---

## 4. 메일 — Gmail SMTP (0원)

| 항목 | 설계 |
|---|---|
| 라이브러리 | `nodemailer`(+ `@types/nodemailer` devDependency) — 지금 `package.json` 에 메일 라이브러리 없음(grep 0). 새 import 이므로 `scripts/audit-declared-deps.mjs` 대상은 아니지만(api/) 버전은 정확히 고정 |
| 모듈 | `api/_lib/mail.ts` `sendMail({to, subject, html, text}) → {sent:true} \| {sent:false, reason}` — throw 안 함, 사유는 비밀값·주소를 빼고 300자 · `buildFeedbackReplyMail({ original, reply })` — 원문 200자(코드 포인트 단위 자름) + 답 **둘 다 HTML 이스케이프**(`escapeHtml` 재사용) · 받는 주소는 헤더 주입 방지로 `\r\n` 든 주소 거부(2u `send_email` 주소 검증 꼴) |
| **환경 가드**(🟠 반영) | `sendMail` 첫 줄: 운영 배포가 아니면(`process.env.VERCEL_ENV !== "production"` — 이 변수 이름·값은 PR-2 에서 Vercel 공식 문서로 확인) 받는 주소가 `MAIL_TEST_TO`(쉼표로 이은 시험 주소 목록) 안에 있을 때만 보내고, 아니면 `createTransport` 를 부르지도 않고 `{sent:false, reason:"운영 밖 — 시험 주소만"}`. 로컬·CI·미리보기·의존성 갱신 PR 미리보기 어디서든 손님 주소로는 못 나간다. Preview 에 값을 넣든 안 넣든(D12) 가드는 넣는다 — 설정 실수 대비 |
| 시험 | 메일을 거치는 시험 파일은 전부 `vi.mock("nodemailer")` — **정적 가드 시험**으로 강제(`api/**/*.test.ts` 중 `mail`·`feedback` 을 import 하는 파일에 그 문자열이 없으면 빨강) · 가드 시험: `VERCEL_ENV=preview` + 목록 밖 주소 → `sent:false` · `createTransport` 호출 0 |
| 비밀값 **이름**(값은 다루지 않음) | `GMAIL_SMTP_USER`(보내는 Gmail 주소) · `GMAIL_SMTP_APP_PASSWORD`(구글 앱 비밀번호) · 선택 `MAIL_FROM_NAME`(기본 "미분양아파트") · `MAIL_TEST_TO`(운영 밖에서 받을 수 있는 시험 주소) — 기본은 **Vercel production 환경변수만**(답장은 관리자 API 에서만 나간다 · GitHub Secrets 불필요). Preview 범위에 넣을지는 **D12**(넣으면 의존성 갱신 PR 을 포함한 모든 미리보기가 메일 권한을 갖는다 — 가드가 시험 주소로만 묶는다). 미리보기가 운영 DB 를 보는지는 재지 않았다(10절). 등록은 사장님이 대시보드에서(값이 채팅에 오지 않게) · 등록 확인은 이름만(`vercel env ls 2>&1 \| awk '{print $1}'`) |
| 접속 | `smtp.gmail.com` 465(SSL) — 2u `services/email.py:26-27` 기본값과 같다(구글 공식 문서로는 이번에 대조하지 않음 · D12 로 정한 곳에서 사장님 주소로 1통 실측) · 연결·인사·전체 타임아웃 10초 |
| 발신 주소 | `GMAIL_SMTP_USER` 그 주소(Gmail SMTP 는 로그인 계정 주소로 나간다) · 보이는 이름 `MAIL_FROM_NAME` · 답장 받을 주소(Reply-To)는 두지 않음(손님이 답장하면 그 Gmail 로 간다 — D4 에서 여쭘) |
| 일 한도(구글 공식) | 개인 Gmail = **하루 500통**(원문 "more than 500 emails sent in a day") · 한 메일 받는 사람 500명 · 넘으면 "1 to 24 hours" 뒤 다시 보낼 수 있음 — https://support.google.com/mail/answer/22839 (2026-10-21 WebFetch). 앱 비밀번호·SMTP 별도 한도는 그 페이지에 없음 |
| 우리 상한 | Redis `mailday:<KST날짜>` 하루 **100통**(D11 — 2u 와 같은 계정을 쓰면 몫이 겹치므로 500 보다 훨씬 낮게) · 넘으면 `failed` "오늘 메일 한도" → 다음 날 "다시 보내기" · `INCR`+`EXPIREAT`(다음 한국 자정) 한 묶음 · **보내기 실패면 `DECR`**(실패한 시도가 몫을 먹지 않게) · **Redis 장애면 통과**(fail-open) — 이 경로는 관리자가 누를 때만 열리고(자동 발송도 답 1개당 1회), 구글 하루 500통이 뒤에서 받쳐 준다 · 장애로 통과한 발송은 `console.warn` 한 줄 |
| 실패 처리 | 3-3 대로 화면·칸·로그 셋 다 · 오류 삼킴 0 |
| 제목·본문(안) | 제목 "[미분양아파트] 보내 주신 의견에 답장이 왔어요" · 본문: 인사 → "보내 주신 의견"(원문 200자) → "답변"(답) → "이 메일은 보내기만 하는 주소에서 나갑니다. 더 하실 말씀은 사이트의 문의하기로 보내 주세요." → 처리방침 링크 · 텍스트판 함께(HTML 못 보는 메일 앱) — 최종 문구는 D4 |

---

## 5. 화면

### 5-1. 보내기 창(`FeedbackForm` 의견 탭 · `useFeedback`)

| 자리 | 지금 | 바꾼 뒤 |
|---|---|---|
| 비로그인 | 폼 대신 "의견은 카카오 로그인 후 보낼 수 있어요" + 로그인 버튼 | **폼 그대로 보임** + 폼 위 안내 한 줄 "답장을 받으려면 카카오 로그인해 주세요(답장은 카카오 계정 이메일로 가요)" + 작은 "카카오 로그인" 버튼 |
| 동의 문구 | `FEEDBACK_CONSENT_TEXT` 하나 | 로그인용(지금 문구 그대로 + D16 이면 끝에 한 문장) · 비로그인용 "서비스 개선을 위해 의견 내용, 보던 화면과 접속 환경(브라우저 정보)을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)" + D16 이면 "보내 주신 글은 그대로 공개하지 않지만, 관리자가 내용을 요약한 답을 '고쳤습니다' 목록에 실을 수 있어요" |
| 숨김 칸 | — | `fb_extra` 입력(화면 밖 · `tabIndex=-1` · `autoComplete="off"` · `aria-hidden`) — 비밀번호 관리 프로그램·자동완성이 채우는 이름(website·email·phone 류)을 피함(v1 `website` 에서 바꿈), 걸린 건수는 서버 로그로 본다(2u 함정 🟡) · 한계는 3-1 의 3' |
| Redis 장애(비로그인) | — | 서버 503 문구 그대로 "지금은 의견을 받을 수 없어요. 잠시 뒤 다시 보내 주세요"(한도 문구와 다름 — 3-1 의 4') |
| 쓰던 글 | 모달을 닫아도 남음(메모리) | 카카오 로그인으로 **페이지를 떠났다 오면** sessionStorage(`fb-draft`: kind·message) 에서 복원 · 보내기 성공 시 지움 · try/catch(사생활 창) |
| 하루 한도 429 | 고정 토스트 "요청이 많아요…" | **서버 문구 그대로**(`j.error`) — 5분 한도와 하루 한도가 다른 말을 하게(2u 함정 "공용 래퍼가 429 문구를 바꿔 버림") |
| 성공 | "의견을 보냈어요. 고맙습니다!" | 로그인 = 그대로 + "답장은 카카오 계정 이메일로 가요" · 비로그인 = "의견을 보냈어요. 고맙습니다!" |
| 401(토큰 만료) | 로그인 안내로 | 그대로 — 쓰던 글은 sessionStorage 에 남김 |
| 떠 있는 버튼(`FeedbackFab`) | "문의" · z 310 | 바꾸지 않음(오른쪽 아래 붐빔 조사는 세션575 에 끝났다 — 2u 함정 1은 이미 해소) |

### 5-2. 관리자 화면(`AdminFeedback` · 관리자 대시보드)

- 위 띠: "손님 의견 · 새 의견 N" · 상태 필터 칩(전체·새 의견·답했어요·고쳤어요·닫음) · `oldestDays > 366` 이면 빨간 줄 "1년 지난 의견이 남아 있어요 — 자동 삭제가 멈췄을 수 있어요".
- 행: 지금 내용 + 펼침 → 답장 칸(남은 글자) · 상태 고르기 · "저장"(답이 처음이면 버튼 글자 "저장하고 메일 보내기", 비로그인 의견이면 "저장(메일 없음 — 비로그인 의견)") · 메일 결과 줄(보냄 시각 + "다시 보내기"(고친 답) / 보내는 중 / 실패 사유 + "다시 보내기" / **결과 모름**(차지 10분 지남) "이미 갔을 수 있어요" + "다시 보내기"(확인 창) — 3-3) · 공개 체크 + 공개 제목·공개 답 칸(원문을 자동으로 옮기지 않는다 — 빈칸으로 시작) · 공개 칸에 이메일·전화번호 꼴이 보이면 칸 아래 노란 경고 "공개 글에 연락처로 보이는 것이 있어요"(서버도 422 — 3-2) · 공개 체크 옆 작은 글 "공개를 내려도 최대 15분 동안 목록에 남을 수 있어요"(3-4) · 삭제.
- **옮겨 가는 동안**: PR-1b 전까지 남은 옛 `done` 행은 새 화면에서 "확인했어요"(`closed` 와 같은 꼬리표)로 보이고, 상태 고르기에는 4상태만 나온다(새 화면은 `done` 을 보내지 않는다).
- **저장 중엔 그 행 버튼 전부 잠금**(서버 차지가 있어도 화면에서 한 번 더 — 2u `OpinionEditor`).
- 보던 화면·단지는 글자로만(링크 금지 — 2u 원칙).
- 목록 조회 실패는 빨간 오류 칸(지금도 그렇다 — 빈 목록으로 삼키지 않음 유지).

### 5-3. 공개 "고쳤습니다" 페이지

- 경로 `/updates`(D2) · SPA 탭 `updates`(`useUrlSync` 의 `/upcoming` 꼴로 경로 동기화) + **빌드 때 정적 골격**(`postbuild-prerender.mjs` 가 `/upcoming` 처럼 `dist/updates/index.html` 생성 — 제목·설명·빈 상태 문장) + sitemap 한 줄. 목록 자체는 화면이 `/api/feedback-updates` 로 실시간 읽는다(검색봇용 목록 굽기는 매일 굽기가 서비스 키로 공개 5칸만 JSON 에 쓰는 안 — 2단계 선택, D2 와 함께 여쭘).
- 카드: 꼬리표(고쳤어요 초록 / 답했어요 파랑 / 살펴보는 중·확인했어요 회색) · 공개 제목 · 공개 답 · 공개 날짜("2026.10.21"). 손님 원문·이메일·화면 주소 없음.
- 빈 상태 "아직 공개한 답이 없어요. 의견을 보내 주시면 고친 것을 여기에 알려 드려요" + "의견 보내기" 버튼(문의 모달 열기).
- 실패 "지금은 목록을 불러올 수 없어요. 잠시 뒤 다시 열어 주세요"(빈 목록인 척 안 함).
- 입구(D3): 도움말(?) 패널(`InfoPage`) 안 "고쳤습니다" 줄 + 문의 모달 의견 탭 아래 "손님 의견으로 고친 것 보기" 링크.
- **문구 안(사장님 고름 — D2)**: ① 제목 "고쳤습니다" · 설명 "보내 주신 의견으로 고치거나 답한 것을 모아 둡니다" ② 제목 "손님 의견으로 바뀐 것" · 설명 "의견을 보내 주시면 고친 내용을 여기에 알려 드려요" ③ 제목 "개선 소식" · 설명 "사이트가 어떻게 나아졌는지 알려 드려요".

### 5-4. 처리방침(`public/privacy.html`) — 같은 PR 에서(`api/CLAUDE.md` "알림에 개인정보를 싣기로 한 결정은 동의 문구와 privacy 를 같은 PR")

- 1·2절 표: "의견 보내기: (로그인한 경우) 카카오 계정 이메일·이름, 의견 내용, 보던 화면, 접속 환경 · (로그인 안 한 경우) 의견 내용, 보던 화면, 접속 환경" — 목적 "답장(로그인한 경우) 및 서비스 개선".
- **3절 보관**(v1 의 "4절"은 틀림 — 4절은 제3자 제공): 3절에는 의견 보내기 1년 보관이 **이미 있다**(`privacy.html:71`) → 한 줄만 더한다 "공개한 답은 제목·답만 남기고 보낸 분 정보와 원문을 지움".
- **비로그인 의견의 파기 요청**(D15): 3절의 "파기 요청 시 지체 없이 삭제"(`privacy.html:71`)를 비로그인 의견에도 지킬 방법이 지금 없다(누가 보냈는지 모름). 추천 문장 "로그인하지 않고 보낸 의견은 보낸 분을 확인할 수 없어, 보낸 날짜와 내용 일부를 8항 연락처로 알려 주시면 찾아서 지웁니다. 찾지 못하면 1년 뒤 자동으로 지워집니다".
- **요약 공개**(D16): 1·2절 목적에 "관리자가 원문 없이 요약한 답을 공개 목록에 실을 수 있음" — 동의 문구(5-1)와 같은 PR.
- **한도용 IP**(D17): 1절 접속 환경 줄에 "부정 이용 방지를 위해 접속 IP 를 되돌릴 수 없게 변환한 값을 하루 동안 보관(Upstash, 국외)" — D17 을 해시 안으로 정하면 이 문장, 원문 안으로 정하면 "접속 IP 를 하루 동안 보관"(이 경우 5절 국외 이전에도 Upstash 한 줄).
- 5절 국외 이전: ⚠ **지금도 빈 곳이 있다** — `privacy.html:78` 은 텔레그램 전달을 업체 문의만 적고 "그 밖의 국외 이전은 하지 않습니다" 라고 하는데, `api/feedback.ts:139-154` 는 의견 내용·보던 화면·단지를 이미 텔레그램으로 보낸다. 이번 PR 에서 "의견 접수 알림 = 텔레그램(의견 내용 200자·보던 화면·단지)" + "답장 메일 = 구글 Gmail(Google LLC, 국외 — 받는 분 이메일·의견 원문 200자·답)" 을 더한다. 원문 최종은 PR-3 에서 사장님 확인.

### 5-5. 그림 승인 단계(규칙 `show-screen-changes-first` — 예외 0)

1. **만들기 전**: 전/후 목업 그림 페이지 1장(아티팩트, 가짜 데이터 표기) — 보내기 창(로그인/비로그인) · 관리자 행 펼침(메일 결과 줄 5가지·연락처 경고·15분 안내) · 공개 페이지 문구 안 3개 · 빈/실패 상태 · **답장 메일 미리보기**(HTML판·텍스트판 — 손님 메일함에 보이는 모습) · **서버 문구**(하루 한도 429 · 비로그인 전체 상한 429 · Redis 장애 503 · 공개 연락처 422). 휴대폰 390px + 데스크톱. 사장님 "진행" 전에는 PR-3·PR-4 착수 금지.
2. **합치기 전**: PR 마다 playwright(chromium·webkit) 전/후 캡처 — 바뀐 자리를 글로 적는다. 데이터가 없으면 로컬 가짜 의견을 만들어 "가짜 데이터" 라 적는다. 캡처 승인 뒤에만 합치기.

---

## 6. 1년 삭제(`scripts/purge-old-consults.mjs` `purgeOldFeedback`)

- **지금**: `created_at < 365일 전` 행을 **전부 DELETE**(`purgeExpired` :41-74) → 그대로 두면 1년 지난 공개 답이 "고쳤습니다" 에서 사라진다.
- **바꾼 뒤**(`purgeOldFeedback` 만 고침 · 상담 쪽 무변경):
  1. 비공개 행 → 지금처럼 DELETE(`.eq("is_public", false)`).
  2. 공개 행 → DELETE 대신 **개인 칸 NULL**: `user_email, user_name, message, page, apartment_id, apartment_name, user_agent, reply, reply_mail_error` — 남는 것 = `id·kind·status·consent_at·created_at·handled_at·replied_at·reply_mail_*_at·is_public·public_title·public_answer·published_at·updated_at`. `reply`(손님에게만 간 글)도 지운다 — 2u 는 남긴다(9절).
  3. 두 단계 각각 count → 실행 → 로그, 결과 `deleted + anonymized` 를 같은 PHASE(`purge-consults`) 한 행에 합산(감시 ② 멱등 집합 그대로, yml 변경 0).
  4. 이미 지운 행을 다시 세지 않게 공개 단계 조건에 `.or("message.not.is.null,user_email.not.is.null,user_agent.not.is.null,reply.not.is.null")`.
- 답장 메일 **보낸 기록**은 시각 칸뿐(`reply_mail_sent_at`)이라 개인정보가 아니다 — 남긴다. 메일 사본은 보낸 Gmail 계정의 "보낸편지함"에 남는다 → 처리방침 3절에 "답장 메일 사본은 보낸 메일함에서 1년 안에 지움" 을 넣을지 D5 와 함께 여쭘(Gmail 은 자동 삭제가 없다 — 사장님 손 작업 또는 Gmail 필터).
- 공개 목록에 남는 것 = 공개 제목·공개 답·꼬리표·공개 날짜(원래도 이것만 보였다 — 화면 변화 0).
- 시험: 1년 지난 비공개 삭제 · 공개 행은 제목·답 유지 + 개인 칸 NULL · 1년 안 행 무변경 · 두 번 돌려도 같은 결과 · 한 단계 실패해도 다른 단계·상담 파기 계속(2u `test_vacuum_job_survives_opinion_purge_failure` 꼴).

---

## 7. 사장님 결정 필요 (질문마다 선택지 + 추천)

| # | 질문 | 선택지 | 추천·이유 |
|---|---|---|---|
| D1 | 하루 한도 | (가) 비로그인 IP 3 · 로그인 10 · 비로그인 전체 200(2u 값) (나) 비로그인 5 · 로그인 20 (다) 비로그인 1 · 로그인 10 | **(가)** — 2u 가 운영 중인 값, 통신사 공유 IP 로 엉뚱한 손님이 막히는 것은 3건이면 드묾 |
| D2 | 공개 페이지 이름·주소·문구 | 5-3 의 ①"고쳤습니다" `/updates` ②"손님 의견으로 바뀐 것" `/updates` ③"개선 소식" `/news` + 봇용 목록 굽기 지금/나중 | **① + 굽기는 나중** — 2u 와 같은 이름이라 두 사이트가 같은 말을 함 · 굽기는 공개 항목이 생긴 뒤 |
| D3 | 공개 페이지 입구 | (가) 도움말(?) 패널 + 문의 모달 링크 (나) 하단·상단 메뉴에 탭 추가 (다) 도움말 패널만 | **(가)** — 지금 손님 메뉴는 4개(늘리지 않음 · v1 의 "세션577 에 줄였다"는 근거를 못 찾아 뺌) |
| D4 | 답장 메일 제목·보이는 이름·손님이 메일에 답장하면 | 제목 4절 안 / 이름 "미분양아파트" vs "미분양아파트.com" / 답장 받기: 받음(그 Gmail 로) vs "보내기만 하는 주소" 안내 | **"미분양아파트" + 보내기만 하는 주소 안내** — 메일로 오는 답장은 관리자 화면에 안 쌓여 놓친다 |
| D5 | 보낼 Gmail 계정 | (가) 미분양 전용 새 Gmail(사장님 손 1회: 계정·2단계 인증·앱 비밀번호 → Vercel 등록) (나) 2u 가 쓰는 Gmail 공유 | **(가)** — 하루 500통 한도를 2u(중개사 인증·결제 실패 메일)와 나눠 쓰지 않고, 사고가 나도 한쪽만 막힘 · 0원 |
| D6 | "어떤 소식이 궁금하세요?" 설문(2u 에 있음) | 옮김 / 안 옮김 | **안 옮김** — 10/07 비교표 6개에 없었고 소식 발송을 안 하므로 모으는 이유가 약함(개인정보 최소) |
| D7 | 손님 화면 오류 자동 기록(2u V070, 10/07 뒤에 생김) | 이번에 같이 / 별도 트랙 / 안 함 | **별도 트랙** — 새 창구·지문·한도가 따로 필요해 이 설계 크기의 절반이 더 붙음 |
| D8 | 옛 `done` 행을 무엇으로 | `closed`(확인했어요) / `fixed`(고쳤어요) | **`closed`** — 고쳤는지 기록이 없는데 "고쳤어요" 로 바꾸면 거짓 |
| D9 | 공개 꼬리표 문구 | 2u 그대로(고쳤어요·답했어요·살펴보는 중·확인했어요) / 고쳐서 | **2u 그대로** — 자매 사이트와 같은 말 |
| D10 | 비로그인 의견 버튼·탭 글자 | 지금 그대로("문의"·"의견 보내기") / 바꿈 | **그대로** — 바뀌는 건 로그인 벽만 |
| D11 | 우리 쪽 하루 메일 상한 | 50 / 100 / 상한 없음(구글 500) | **100** — (가) 전용 계정이어도 손님 답장이 하루 100통 넘을 일이 없고, 고장 난 반복 발송을 막음 |
| D12 | 메일 실측 1통을 어디서 | (가) **production** — 합친 뒤 운영 관리자 화면에서 사장님이 로그인해 보낸 의견에 답해 사장님 메일함으로 1통 (나) **Preview** 범위에도 비밀값을 넣고 미리보기에서 1통(가드가 `MAIL_TEST_TO` 로만 묶음) | **(가)** — Preview 에 넣으면 의존성 갱신 PR 을 포함한 모든 미리보기가 메일 권한을 갖는다. 미리보기가 운영 DB 를 보는지도 재지 않았다. 단점 = 465 가 막히면 합친 뒤에야 안다(그때 587 로 다시 — 10절) |
| D13 | 의견 최소 글자 | (가) 1자(지금 값 유지) (나) 10자(2u 값) | **(가)** — "좋아요"·"오류" 같은 짧은 의견도 받는 지금 동작을 바꾸지 않음(봇 방어는 숨김 칸·한도가 맡음). 단점 = 한 글자 장난 글이 들어올 수 있음 |
| D14 | 텔레그램 새 의견 알림 상한 | (가) 시간당 20통(2u 값) (나) 시간당 10통 (다) 상한 없음 | **(가)** — 자매 사이트와 같은 값 · 넘어도 관리자 화면에는 다 쌓이고 알림만 멈춘다 |
| D15 | 비로그인 의견의 파기 요청 | (가) "보낸 날짜·내용 일부를 8항 연락처로 알려 주시면 찾아 지움 · 못 찾으면 1년 뒤 자동 삭제" 를 처리방침에 (나) 1년 자동 삭제만 적음 | **(가)** — 지금 처리방침의 "파기 요청 시 지체 없이 삭제"(`privacy.html:71`)를 비로그인에도 지키는 유일한 방법. 단점 = 찾기는 사람 손 |
| D16 | 동의 문구·처리방침에 "원문 없이 요약을 공개할 수 있음" | 넣음 / 안 넣음 | **넣음** — 공개 목록이 손님 의견에서 나오는 것을 미리 알림 · 원문·보낸 분은 안 나간다는 것도 같이 |
| D17 | 한도용 IP 를 Redis 키에 | (가) 비밀값 HMAC 앞 16자(새 비밀값 이름 `RATE_KEY_SECRET` · production·preview · 사장님 등록) + 처리방침 "변환한 값 하루 보관" (나) 원문 그대로 + 처리방침 "IP 하루 보관"·국외(Upstash) 한 줄 | **(가)** — 외부 서버에 IP 원문이 남지 않음 · 단점 = 비밀값 1개 늘고, 없으면 비로그인 503(3-1 4'). 지금 5분 한도 키의 IP 원문 5분(`rateLimit.ts:27`)은 이 설계 밖(10절) |
| D18 | 합친 뒤 운영 공개 시험 | (가) 사장님 로그인 의견 1건 → 답 → 메일 → 공개 → `/updates` 확인 → **전이표 승인 뒤 그 1건 삭제**까지 (나) 공개는 시험하지 않음(메일까지만) | **(가)** — 공개 경로를 운영에서 한 번은 봐야 함 · 운영 데이터 1행을 만들고 지우는 일이라 전이표(행 id·전/후)를 먼저 승인받음(규칙 `data-changing-run-approval`) |

---

## 8. 검증 계획·PR 분할

| PR | 내용 | 파일(예상) | 운영 반영 |
|---|---|---|---|
| **PR-1 마이그(넓히기)** | 2-2 PR-1 마이그(칸 추가 + CHECK 5개 값 · UPDATE 없음) + 2-4b 되돌리기 + 정본 note | `supabase/migrations/2026102X000000_*.sql` · `_rollbacks/2026102X000001_*.sql` · `supabase/ownership.json` · `supabase/CLAUDE.md` 표 한 줄 | 되돌림 시험(2-2 의 PR-1→1b→되돌리기 2개 묶음) → 사장님 승인 → 적용 → `perm-baseline` 미리보기 → (차이 있으면) 재승인. **코드보다 먼저**(새 코드가 새 칸을 읽는다 — 2u V070 :24-26 교훈) |
| **PR-2 API** | 3-1~3-5 · `api/_lib/mail.ts`(환경 가드) · `api/feedback-updates.ts` · `rateLimit`/`telegram` 확장 · 6절 purge · 처리방침 5-4 문구 초안 · `status` 허용값에 `done` 유지 | `api/feedback.ts`·`api/feedback-updates.ts`·`api/_lib/{mail,telegram,dailyQuota}.ts`·`scripts/purge-old-consults.mjs`·각 `.test.ts` · `package.json`(nodemailer) · `api/CLAUDE.md`(캐시 지우는 법 포함) | D12 로 정한 곳에서 사장님 주소로 메일 1통 실측(값은 사장님이 Vercel 에 넣음) |
| **PR-3 화면(보내기·관리자)** | 5-1·5-2·5-4 | `useFeedback.ts`·`FeedbackForm.tsx`·`AdminFeedback.tsx`·`feedbackKinds.ts`(꼬리표 문구 한 곳 `feedbackStatus.ts`)·`public/privacy.html` | 5-5 그림 승인 → 캡처 승인 → 합치기 |
| **PR-1b 마이그(좁히기)** | 2-2 PR-1b 마이그(`done→closed` + CHECK 4개 값) + 2-4a 되돌리기 + API 허용값에서 `done` 빼기 한 줄 | `supabase/migrations/2026102Y000000_*.sql` · `_rollbacks/2026102Y000001_*.sql` · `api/feedback.ts` | **PR-3 배포 확인 뒤** · 전이표(2-3) 승인 → 코드 배포 확인 → 마이그 적용 → `perm-baseline` 미리보기 |
| **PR-4 공개 페이지** | 5-3 · sitemap · 입구 링크 | `src/components/sections/UpdatesPage.tsx`·`useUrlSync.ts`·`App.tsx`(탭 한 줄)·`postbuild-prerender.mjs`·`InfoPage` | 캡처 승인 → 합치기 → 라이브 확인 = **사장님 로그인 의견 1건**(비로그인은 메일을 못 받으므로 성립 안 함) → 텔레그램 → 관리자 답 → 메일 도착 → (D18) 공개 → `/updates` 노출 → 전이표 승인 뒤 그 1건 삭제 · 한도 문구는 미리보기에서 |

PR 은 v1 의 4개에 작은 PR-1b 하나가 붙어 5개다(🟠 중간 상태를 닫으려고 마이그를 둘로 나눈 것 — 새 기능 아님). PR-4 는 PR-2 뒤 언제든(PR-1b 와 무관).

**중간 상태 표**(🟠 반영 — 어느 단계에서 멈춰도 관리자 화면이 깨지지 않는지):

| 지금 운영에 있는 것 | 저장되는 status 값 | 관리자 화면 | 깨지는 곳 |
|---|---|---|---|
| PR-1 마이그만(옛 코드) | 옛 코드가 `new`·`done` 만 씀 → 5개 값 CHECK 통과 | 옛 화면 그대로(`closed` 행이 아직 0 — 전이를 안 했으므로) | 없음 · 비로그인 행도 아직 안 생김(옛 API 가 로그인 필수) |
| + PR-2 API(옛 화면) | 옛 화면이 `done` 을 보냄 → API 가 받아 그대로 저장 · `replied` 등은 답 칸이 있는 새 화면이 없어 아직 안 생김 | 옛 화면 그대로 · 비로그인 의견은 이메일 칸이 빈 채 보임 | 없음(옛 화면은 새 칸을 안 읽음 — 이메일 빈칸 표시만 PR-2 시험에서 확인) |
| + PR-3 화면 | 새 화면은 4상태만 보냄 · 옛 `done` 행 남음 | 옛 `done` 은 "확인했어요"로 보임 | 없음 |
| + PR-1b | `done` 0행 · CHECK 4개 값 · API 도 `done` 거부 | 그대로 | 옛 탭을 열어 둔 관리자의 `done` 저장만 400 → 새로고침 |

**시험 항목**(★ = 2u 시험 목록에서 가져옴 · 이름은 2u `test_opinions_router.py`/`test_opinion_alert.py`):
- POST: ★비로그인 3건 OK·4번째 429 문구(`test_anonymous_three_ok_fourth_429`) · ★로그인 10건·11번째 429(`test_logged_in_ten_ok_eleventh_429`) · ★한국 자정에 풀림(`test_anon_limit_resets_at_korean_midnight` — 시각을 밖에서 넣음, 규칙 self-check ⑤) · ★IPv6 같은 /64 함께 셈 · IPv4 따로(`test_ipv6_same_64_counted_together`·`test_ipv4_addresses_counted_separately`) · ★전체 200 상한(`test_anon_total_daily_cap`) · ★숨김 칸 → 201·저장 0·알림 0(`test_honeypot_returns_ok_but_saves_nothing`) · ★숨김 칸 로그에 내용·IP 없음 · ★저장 실패면 한도 되돌림(`test_anon_slot_refunded_when_save_fails`) · ★NUL·짝 없는 서로게이트 400 · 폭 0 문자 제거·ZWJ 이모지 보존·ZWJ 만은 거부 · ★kind 틀림·1001자 400 · 비로그인 → user_email NULL·`canReply:false` · 무효 토큰은 401(비로그인으로 안 바꿈 — 2u 와 다름) · Redis 장애: 비로그인 **503 "잠시 뒤" 문구**(429 한도 문구 아님) / 로그인 통과 · HMAC 비밀값 없음 → 비로그인 503 · 하루 한도 Redis 키에 IP 원문 문자열 0(키를 찍어 대조) · INCR 과 EXPIREAT 가 한 pipeline · 숨김 칸 이름 `fb_extra`.
- 알림: ★시간당 21번째에 "잠시 멈춤" 1통·22번째 0통(`test_hourly_limit_pause_notice_once`) · ★새 시간엔 다시(`test_new_hour_starts_fresh`) · ★한국 시각 기준 시간 키(`test_hour_key_uses_korean_hour`) · `<b>` 든 글이 이스케이프돼 나감(**이 레포 신규** — 2u 알림은 `parse_mode=None` 평문이라 시험이 `test_html_kept_as_plain_text_and_newlines_folded` 로 다르다) · ★보내기 실패해도 201(`test_send_failure_does_not_raise`) · 알림에 이메일·이름 없음(지금 시험 유지).
- 관리자: ★비관리자 401/403(`test_admin_routes_need_admin`) · ★목록 필터·newCount(`test_admin_list_all_fields_new_count_and_filter`) · ★답 → 메일 1회, 다시 PATCH 는 0회(`test_reply_sends_mail_once_and_edit_does_not_resend`) · **동시 PATCH 2개 → 메일 1통**(차지 UPDATE — 2u 에 없음) · **차지가 남은 행(결과 모름)은 10분이 지나도 자동 재발송 0** · 그 행은 `resendMail` 로만 보내짐(10분 안이면 0행) · 상태만 바꾼 PATCH·공개만 누른 PATCH·답을 고친 PATCH → 메일 0 · 실패 뒤 다른 저장 → 메일 0(수동만) · 성공 뒤 `resendMail` → 바로 1통(차지 비움 확인) · `resendMail` 은 PATCH 로만(관리자 확인) · 손님 POST 는 관리자 분기 없음 · PR-1b 전 `status:"done"` 저장 200 / PR-1b 뒤 400 · 공개 제목·답에 이메일·전화 꼴 → 422 · ★답만 쓰면 new→replied · 상태 같이 보내면 그 값 · fixed 유지(`test_reply_only_moves_new_to_replied`·`…explicit_status_keeps_it`·`…fixed_row_keeps_fixed`) · ★메일 실패 → 미발송 남고 다시 보내기 1회(`test_mail_failure_stays_false_then_resend`) · ★이메일·답 없으면 메일 0(`test_no_mail_without_email_or_reply`) · ★공개는 제목·답 필수 422(`test_publish_needs_title_and_answer`) · ★삭제 404 · ★메일 본문 원문·답 이스케이프(`test_reply_email_escapes_original_and_reply`) · 받는 주소 줄바꿈 거부 · 메일 하루 상한 · 보내기 실패면 하루 카운터 `DECR` · 카운터 Redis 장애면 통과 + 경고 로그 · **환경 가드**: `VERCEL_ENV` 가 production 이 아니고 주소가 `MAIL_TEST_TO` 밖이면 `sent:false`·`createTransport` 0 · 정적 가드: 메일을 거치는 시험 파일에 `vi.mock("nodemailer")` 없으면 빨강.
- 공개: ★공개 행만·원문·이메일 **키** 0(`test_public_list_only_public_and_no_private_keys`) · ★원문 지운 공개 행·페이징(`test_public_list_handles_purged_message_and_paging`) · 정적 가드: `api/feedback-updates.ts` 에 `select("*")`·`message`·`user_email` 문자열 0 · 실패는 500.
- 1년 삭제: ★공개 행 제목 유지·원문 NULL(`test_vacuum_job_purges_year_old_opinions`) · ★한 단계 실패해도 계속(`test_vacuum_job_survives_opinion_purge_failure`) · 두 번 실행 멱등.
- 화면: 비로그인 폼 보임·안내 줄 · sessionStorage 복원(로그인 왕복) · 하루 한도 서버 문구 그대로 · 저장 중 버튼 잠금 · 관리자 메일 결과 줄 · 공개 빈/있음/실패 · e2e 보내기(route mock).
- **새 가드는 고장 내서 빨강 확인**(규칙 `guards-must-be-mutation-tested`) — 차지 UPDATE 조건 하나 지우기 · 자동 발송 차지에 10분 만료 조건 되살리기 · 공개 select 에 `message` 넣기 · 숨김 칸 검사 지우기 · 한도 키를 UTC 날짜로 바꾸기 · 메일 환경 가드 지우기 · 시험 파일 하나에서 `vi.mock("nodemailer")` 지우기 · 공개 연락처 검사 지우기 → 각각 빨강.
- **마이그 순서 시험**: 2-2 의 되돌림 시험 묶음(`done` 시험 행 → PR-1 → PR-1b → 2-4a → 2-4b → ROLLBACK)이 CHECK 위반 없이 끝까지 가는 것 · 일부러 PR-1b 의 UPDATE 를 DROP CONSTRAINT 앞으로 옮기면 실패하는 것 1회.

**검사관**(이 설계서 검토 = 2인): 할루 감사 `halu-auditor`(Sonnet — 이 문서의 파일:줄·이름·수치 대조) + 맹점 비판 `blindspot-critic`(Opus — 빠진 영역·잘못 세운 전제). 구현 PR 은 인증·메일·DB 가 걸려 PR-1·PR-2 = 적대검증 general-purpose Opus, PR-3·PR-4 = `ui-adversary`(Sonnet), 마무리 3인.

---

## 9. 2u 와 다른 점 (2u 에 돌려줄 것 = 인계 파일 5번)

**더 낫게 한 것(2u 에 알릴 후보)**
1. **답장 메일 1회를 DB 조건부 UPDATE 로 차지** — 2u 는 "저장 → 메일 → 표시" 라 두 탭 동시 저장 때 메일 2통 가능(`routers/admin/opinions.py:188-194`), 화면 잠금만 방어. 우리는 자동 발송을 "답이 처음 들어온 저장"으로만 열고, 끊겨 결과를 모르는 행은 자동으로 다시 보내지 않는다(3-3).
2. **공개 조건을 DB CHECK 로도** — 2u 는 API 422 만(`admin/opinions.py:165-166`).
3. **1년 뒤 공개 행의 관리자 답(`reply`)도 지움** — 2u 는 원문·이메일 등만 NULL, 손님에게만 간 답은 남김(`vacuum_maintenance.py:175-193`).
4. **무효·만료 토큰은 401** — 2u 는 비로그인으로 조용히 받아 손님이 답장 못 받는 줄 모를 수 있음(`can_reply` 안내로 보완은 함).
5. 메일 하루 상한(우리 쪽 100) — 2u 에는 없음.

**서버리스라 바꾼 것(낫다/못하다가 아니라 환경 차이)**: 비로그인 하루 한도·시간당 알림 카운터를 프로세스 메모리 → Redis(2u 는 재시작하면 0 부터 · 2u 의 **로그인** 하루 한도 10건은 원래 DB 카운터 — 우리는 이것도 Redis) · BackgroundTasks → await · Python `send_email` → `nodemailer` · 감사 기록 표(`log_action`) → 콘솔 한 줄(이 레포에 감사 표 없음).

**일부러 안 옮긴 것**: 소식 설문(D6) · 화면 오류 자동 기록·텔레그램 통로 매일 점검(V070·세션439, D7) · 관리자 메뉴 배지(이 레포는 관리자 대시보드 한 화면이라 띠 안 "새 의견 N" 으로 대신) · 시각 회귀 기준 사진(이 레포에 없음).

**2u 에 돌려줄 결과 한 줄**(합친 뒤): `- 미분양 의견함: 전부 옮김(<날짜>) — 메일 1회 차지 UPDATE·공개 CHECK·1년 뒤 reply 도 NULL·만료 토큰 401 은 2u 보다 단단한 점` → 2u `MEMORY.md` 맨 위 + 인계 파일 맨 아래.

---

## 10. 열린 점(설계서 검토 때 함께)

- `done` 행 수·비로그인 허용 뒤 하루 의견량 — DB 를 재지 않았다(지시서 4절). PR-1 전이표에서 잰다.
- Vercel 서버리스에서 Gmail SMTP 465 바깥 연결 — 막힌다는 근거는 못 찾았으나 실측 전이다. D12 로 정한 곳의 1통이 판정(막히면 587 STARTTLS 로 다시 재고, 그래도 막히면 사장님께 — 유료 서비스는 0원 결정과 어긋남).
- v2 에서 외부 호출 0 이라 확인하지 못한 것(PR-2 에서 공식 문서로): Vercel `VERCEL_ENV` 변수 이름·값 · Vercel CDN 캐시를 지우는 방법(3-4) · 미리보기 배포가 운영 DB 를 보는지(Vercel 비밀값 목록은 이름만 조회 가능 — 값 조회 금지 규칙).
- 지금 5분 한도 키 `rl:<IP>:<endpoint>` 도 IP 원문을 Upstash 에 5분 담는다(`rateLimit.ts:27`) — 의견함만의 일이 아니라 이 설계 밖. D17 결정과 같은 방향으로 고칠지는 별도 트랙 후보.
- 숨김 칸으로 못 막는 API 직접 호출 봇이 비로그인 전체 200건을 다 쓰는 날(3-1 3') — 감시·알림을 붙일지는 운영 뒤 실제 건수를 보고.
- 공개 페이지 봇용 목록 굽기(5-3) — 매일 굽기(GitHub Actions, 서비스 키 있음)가 공개 5칸만 JSON 에 쓰는 안. 공개 항목이 생긴 뒤 별도 PR.

---

## 11. v2 반영 표 (검사관 지적 → 고친 곳)

원문: 맹점 `.omc/artifacts/session653/review-blind-opinion-spec.md` · 할루 `.omc/artifacts/session653/review-halu-opinion-spec.md`.

| 등급 | 지적 | 고친 절 | 어떻게 |
|---|---|---|---|
| 🔴 | CHECK 가 남은 채 UPDATE(마이그·되돌리기 둘 다 실패) | 2-2 · 2-4 · 8 시험 | 순서 규칙 "옛 CHECK 지우기 → UPDATE → 새 CHECK" 를 PR-1b 마이그·2-4b 되돌리기에 박음 · 되돌림 시험이 `done` 시험 행으로 그 순서를 실제로 거침 |
| 🟠 | PR-1~PR-3 사이 중간 상태(옛 코드 `done` 500 · `closed` 가 "새 의견") | 2-1 · 2-2 · 2-3 · 2-4a · 3-2 · 5-2 · 8 | 마이그를 PR-1(5개 값 넓히기)·PR-1b(PR-3 뒤 좁히기)로 · API 는 그 사이 `done` 그대로 저장 · 8절 중간 상태 표 |
| 🟠 | 메일 비밀값 production 만 vs 미리보기 1통 | 4 · 8 · 7 D12 | 메일 모듈 환경 가드(`MAIL_TEST_TO` 만) · `vi.mock` 정적 가드 · 실측 장소는 D12 |
| 🟡 | 차지 만료 뒤 자동 재발송("10분 안 1회") | 3-3 | 자동 차지에 만료 조건 없음 · 결과 모름은 수동만 |
| 🟡 | 실패 뒤 아무 저장에서나 자동 발송 · 성공 뒤 다시 보내기 막힘 | 3-3 · 3-2 | 자동 = 답이 처음 들어온 요청만 · 성공 뒤 차지 비움 |
| 🟡 | 다시 보내기가 손님 POST 안(손님 한도를 먼저 탐) | 3-2 · 3-3 · 8 | `PATCH {resendMail:true}` · POST 는 손님 전용 |
| 🟡 | 하루 메일 카운터 Redis 장애·실패 되돌림 없음 | 4 | 장애면 통과(이유 적음) · 실패면 `DECR` · 한 묶음 |
| 🟡 | 하루 한도 키에 IP 원문 하루 | 2-1 · 3-1 · 5-4 · 7 D17 · 10 | HMAC 키(추천) 또는 처리방침 — D17 |
| 🟡 | 비로그인 파기 요청 방법 · 요약 공개 동의 없음 | 5-1 · 5-4 · 7 D15·D16 | 처리방침 3절·1·2절 문장 + 동의 문구 |
| 🟡 | 공개 글에 연락처 섞임 | 3-2 · 5-2 · 8 | 서버 422 + 화면 노란 경고 |
| 🟡 | 공개를 내려도 CDN 에 최대 15분 | 3-4 · 5-2 · 10 | 15분을 적고 화면에 안내 · 캐시 지우는 법은 PR-2 공식 문서 확인(못 하면 숫자 줄이기 여쭘) |
| 🟡 | Redis 장애를 손님 한도 문구로 | 3-1 4' · 5-1 · 8 | 503 "잠시 뒤 다시" 따로 |
| 🟡 | 숨김 칸 한계 · 이름 `website` · INCR/EXPIRE 따로 | 3-1 3·3'·4 · 5-1 · 3-5 · 4 | 한계 명시 · 이름 `fb_extra` · 모든 카운터 pipeline 한 묶음 |
| 🟡 | 그림 승인에 메일 본문·429 문구 없음 · 라이브 확인이 비로그인 메일(성립 안 함) · 운영 공개 시험 = 데이터 변경 | 5-5 · 8 PR-4 · 7 D18 | 메일 미리보기·서버 문구를 그림에 · 라이브 = 사장님 로그인 1건 · 공개 시험은 전이표 승인 뒤 삭제까지 |
| 할루 | 5-4 "4절 보관" | 5-4 · 6 | 3절로 · 3절에 1년 보관이 이미 있다고 적음 |
| 할루 | 8절 ★ `<b>` 이스케이프(2u 에 없음) | 8 | ★ 빼고 "이 레포 신규(2u 는 평문)" |
| 할루 | 9절 "메모리 → Redis" 반만 맞음 | 9 | "비로그인 한도·알림 카운터(로그인 한도는 2u 가 DB)" |
| 할루 사소 | V070 :34-51 | 2-2 | :36-52 |
| 할루 확인 불가 | "세션577 에 메뉴를 4개로 줄였다" | 7 D3 | "지금 손님 메뉴 4개"로만 |
| 할루 참고 | 최소 글자 2u 10 vs 우리 1 | 3-1 5 · 7 D13 | 결정 한 줄 |
| 결정 추가 | 메일 실측 장소·알림 상한·파기 요청·요약 공개·IP 해시·운영 공개 시험 | 7 D12·D14~D18 | 선택지 + 추천 |

**못 닫은 것**: 할루 "확인 불가" 중 세션575 붐빔 조사(5-1 `FeedbackFab` 줄)는 v1 문장을 그대로 두었다 — 근거 파일을 이번에 다시 찾지 않았다(문구가 결정에 영향 없음). Vercel 쪽 사실 3가지는 외부 호출 0 이라 10절에 미확인으로 남김.
