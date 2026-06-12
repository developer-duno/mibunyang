# API 규칙

> Vercel Serverless Functions 수정 시 반드시 이 규칙을 따를 것.

## JavaScript null 비교 함정

```js
null <= 5   // true (null → 0 강제 변환)
null < 50   // true
```

API에서 null 반환 시 **위험 단지가 안전하게 표시됨**. `sanitize()` 필수:
- 위험 필드 null → 비관적 기본값 (unsoldRate:50, pir:10, psr:1.5)
- 혜택 필드 null → 0
- 문자열 키 null → 최저 등급
- presale 19필드: `?? null` (정보성, 스코어링 미사용)

## 한글 텍스트 주의

- UTF-8 BOM (`\uFEFF`) → BRAND_TIER/REGIONS 조회 실패 가능
- NFC/NFD 정규화 → macOS 한글 비교 실패 가능
- 빌더명 변형 → `_shared.mjs`의 BUILDER_ALIASES 별칭 해소

---

## Supabase 연동

- 읽기: `SUPABASE_ANON_KEY` — `api/_lib/supabase.js`
- 쓰기: `SUPABASE_SERVICE_KEY` — `scripts/collectors/_shared.mjs`
- `apartments_flat` VIEW: 7개 테이블 JOIN 평탄화
- RLS: anon = 읽기, service_role = 읽기+쓰기
- 응답 형식: `{ ok: true, data: [...], count: N, fetchedAt: "..." }`

## withHandler 래퍼

```js
export default withHandler({
  method: "POST",           // "GET", "POST", ["GET","POST"]
  cors: {},                 // 생략 = CORS 미적용
  rateLimit: "login",       // rateLimit.js LIMITS 키, 생략 = 미적용
  admin: true,              // verifyAdminToken, 생략 = 미적용
  handler: async (req, res) => { /* ... */ },
});
```

**미들웨어 순서**: CORS → Method(405) → RateLimit(429) → Admin(401) → Dispatch

| 패턴 | 설정 | 사용처 |
|------|------|--------|
| C (method only) | `{ method: "GET", handler }` | supabase/*, kakao, neis, dart, kosis, applyhome |
| B (admin) | `{ method: "GET", admin: true, handler }` | admin/users, admin/review |
| A (CORS+RL) | `{ method: "POST", cors: {}, rateLimit: "login", handler }` | auth/login, auth/verify, auth/kakao |
| Mixed | `{ method: ["GET","POST"], handler: { POST, GET } }` | consults |

---

## 시계열 API

| 엔드포인트 | 테이블 | 캐싱 |
|-----------|--------|------|
| `GET /api/supabase/prices` | prices | s-maxage=3600 |
| `GET /api/supabase/unsold-history` | unsold_history | s-maxage=3600 |

- 파라미터: `apartment_id` (단일) 또는 `apartment_ids` (쉼표 구분, 최대 20개)
- ID 검증: `api/_lib/apartmentValidation.js` — `parseApartmentIds()` + `/^ah-\d+$/` 패턴
- 에러 응답: `{ ok: false, error: "메시지" }` (400/500)
- RLS: "Public read" 정책 (인증 불필요)

## 인증 시스템 (세션 405 — 관리자+손님 2축)

- PBKDF2 해싱 (`api/_lib/auth.ts`, 레거시 SHA-256 자동 마이그레이션)
- HMAC-SHA256 JWT
- **비밀번호 로그인 = 관리자 전용** — `isAdminEmail()` (ADMIN_EMAIL env, timingSafeEqual 단일 출처. login/verify refresh/kakao 공유). 비admin = generic 401
- 가입(signup) 폐지 — 관리자 계정 생성/재설정은 `scripts/create-admin-user.mjs` (수동 1회성)
- 관리자 API 가드: `api/_lib/adminAuth.ts` — verifyAdminToken
- 상담 열람(GET /api/consults) = role admin 단독

---

## 네이버 부동산 API 연동

참조: `scripts/collectors/naver-collect.py` (Python), `naver-listings.mjs` (Node.js)

### 엔드포인트

| URL | 용도 | 인증 |
|-----|------|------|
| `new.land.naver.com/api/search?query=` | 키워드 검색 | 없음 |
| `/api/complexes/{id}` | 단지 상세 | JWT + Referer |
| `/api/articles/complex/{id}` | 단지별 매물 | JWT + Referer |
| `/api/articles/{no}` | 매물 상세 | JWT + Referer |
| `/api/complexes/{id}/prices` | 시세 이력 | JWT + Referer |

### JWT 토큰
- 추출: 단지 페이지 HTML 정규식 `/"token":"(eyJ[A-Za-z0-9._-]+)"/`
- 유효기간: 3000초 (50분), 캐시 후 만료 전 갱신
- 401/403 시 자동 재발급
- **Referer 헤더 필수** — 없으면 403

### Rate Limiting
- 요청 간 1.0초 간격 (throttle)
- 페이지네이션 간 1.5초
- 재시도: 최대 3회, 지수 백오프 [3, 5, 10초]
- 429: 세션 리셋 + 백오프

### 핵심 규칙
- 면적 변환: `M2_TO_PYEONG = 3.3058`
- 분양권 판별: `realEstateTypeCode` in ["ABYG", "PRE"]
- 소프트 삭제: `is_active=FALSE` (DELETE 금지)
- 페이지네이션: `isMoreData=false`까지 반복 (페이지 수 가정 금지)

---

## 인증/세션

- admin 토큰 TTL 1h. 프론트 verify 폴링 15분 주기
- 토큰 블랙리스트: KV `bl:{hash}`, fail-open (만료가 2차 방어선)
- 로그아웃: 서버 토큰 무효화 + 프론트 sessionStorage 삭제
- 카카오 신규 사용자: role:"user", status:"approved" (승인 불필요)
- 카카오 KV: `user:{email}` + `kakao:{kakaoId}→email` 역참조 (TTL 90일)
- 카카오 탭 라우팅: role="admin"→admin, 그 외 전부 일반 손님(home/list — 레거시 expert record 도 user 정규화, 세션 405)

## 비로그인 블라인드 정책

- AptCard: 점수 블러("??") + 상세/지도 LoginPromptModal
- CompareSheet: 점수 "??" 텍스트 치환 (CSS blur 아닌 DOM 미노출), export/공유 숨김
- LoginPromptModal Analytics: trigger prop (detail/map), 4개 이벤트
