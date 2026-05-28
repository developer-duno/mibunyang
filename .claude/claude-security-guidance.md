# mibunyang 보안 가이드 (security-guidance 플러그인용)

> 본 파일 = `security-guidance@claude-plugins-official` 플러그인 모델 리뷰 단계에서 자동 로드.
> 추가 규칙이며 강제 차단 아님. 강제 차단 필요 시 hook 작성 의무.
>
> 답습 시점: 2026-05-28 세션 340 / 공식 문서: https://code.claude.com/docs/en/security-guidance

## 인증 / 권한 (api/_lib/handler.ts 답습)

- 모든 `/api/admin/**` 라우트 = `withHandler({ ...handlers, allowedMethods, admin: true })` 또는 `requireAdmin(req)` 호출 의무. 누락 시 권한 우회 사고.
- 카카오 OAuth 콜백 (`/api/auth/kakao/**`) = HMAC-SHA256 JWT 검증 의무. `jsonwebtoken` 라이브러리 직접 박힘 금지 (`api/_lib/jwt.ts` 답습).
- 세션 토큰 = Upstash Redis 저장. SHA-256 + salt 박힘 의무 (`api/_lib/auth.ts`). plain text 저장 금지.
- 전문가 / 관리자 role 박힘 시 = `users.role` 컬럼 답습 후만 단정. localStorage 답습 단정 금지.

## SQL / DB (Supabase PostgreSQL)

- 사용자 입력값 = parameterized query 의무. `sb.from(X).select(...).filter('col', 'eq', userInput)` = 안전. raw SQL template literal 박힘 시 review 의무.
- `apartments` / `users` / `consults` / `subscribers` 4 테이블 = RLS 박힘 (마이그 `20260519111101`). 신규 테이블 박힘 시 RLS 박힘 의무.
- 공유 테이블 (mibunyang ↔ naver-estate-web) 컬럼 변경 시 = 양 프로젝트 grep 의무 (`feedback_cross_repo_schema_audit.md`).
- Supabase MCP = read-only 모드 우선. write 박힘 시 사용자 명시 의무.

## 비밀 / 환경변수

- `process.env.*` = `.env.local` 또는 GitHub Secrets. 코드 박힘 금지.
- `SUPABASE_SERVICE_ROLE_KEY` = 서버만 (Vercel 서버리스 + scripts/collectors). 클라이언트 노출 절대 금지.
- `KAKAO_REST_API_KEY` / `NEIS_KEY` / `MOLIT_KEY` / `KOSIS_KEY` = 클라이언트 노출 금지. `import.meta.env.VITE_*` 만 클라이언트 박힘 가능.
- 외부 API 키 추가 시 = `audit-env-keys.mjs` 3-way 동기화 의무 (코드 + yml + data-fill orchestrator — `secret-naming-audit.md`).
- `.env` / `.env.*` = `Read` 도구 deny (settings.json 박힘).

## XSS / DOM / 한국어 인코딩

- `dangerouslySetInnerHTML` 박힘 시 = `dompurify` 통과 의무 (이미 적용 = `App.tsx` / `InfoPage.tsx` 답습).
- 한국어 텍스트 = UTF-8 의무. raw bytes 답습 금지.
- `eval(` / `new Function(` / `document.write(` = 차단. 사용자 동의 의무.

## API Rate Limit / 외부 호출

- `withHandler({ rateLimit: { limit, window } })` 박힘 = 공개 라우트 의무 (`api/_lib/rateLimit.ts`).
- 네이버 / 카카오 / 국토부 / KOSIS / NEIS API 호출 = `fetchWithRetry` 의무 (`scripts/collectors/_shared.mjs`). 직접 `fetch()` 금지.
- 외부 API 응답 = null 가드 의무 (`null-safety-checker` 자율 발동). optional chain + 기본값 + 숫자 포맷.

## GitHub Actions / CI/CD

- `.github/workflows/*.yml` = `secrets.X` = `${{ secrets.X }}` 형태 의무. `${{ env.X }}` 박힘 시 = 시크릿 노출 가능.
- `pull_request_target` 트리거 = 외부 코드 권한 위험. `pull_request` 우선.
- 자동 머지 / 자동 푸시 = 사용자 명시 의무.

## 도메인 특수 (미분양 부동산)

- 단지 좌표 (lat/lng) = 한국 범위 의무 (33 ≤ lat ≤ 39 + 124 ≤ lng ≤ 132). 범위 이탈 = silent 사고 위험.
- 사용자 PII (이메일 / 전화번호 / 카카오 ID) = 로그 박힘 금지. `consults` / `subscribers` 테이블에만 박힘.
- 가격 / 점수 = 클램핑 의무 (`scoring-validator` 자율 발동). 음수 / NaN / Infinity 금지.
