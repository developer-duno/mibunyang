# API 규칙

> Vercel Serverless Functions 수정 시 반드시 이 규칙을 따를 것.

## JavaScript null 비교 함정

```js
null <= 5   // true (null → 0 강제 변환)
null < 50   // true
```

API에서 null 반환 시 **위험 단지가 안전하게 표시됨**. `sanitize()` 필수:
- 위험 필드 null → 비관적 기본값 (pir:10, psr:1.5 등)
- **단 `unsoldRate` 는 null 보존**(세션 445): `unsoldRate > 100 → null` 무력화(청약홈 회차 폭발값) + `?? 50` 폴백 제거. null = "미분양률 미확인" → 점수 엔진(scoreRisk)이 units≤1 과 동일하게 중립(UNSOLD_UNKNOWN_SCORE) 처리. 4 emit point(clampUnsoldRate·collect-data·api·VIEW) + fmtUnsoldRate 전부 `>100` 단일 경계.
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
- 관리자 API 가드: `api/_lib/adminAuth.ts` — `verifyAdminToken`(withHandler `admin:true` 미들웨어용, generic 401) / `requireAdminGate`(세션 447 — consults 처럼 **단계별 응답**(401 인증/토큰/로그아웃 + 403 Forbidden)을 노출해야 하는 핸들러용 discriminated 결과)
- 상담 열람(GET /api/consults) = role admin 단독(`requireAdminGate`로 게이트, 세션 447). **페이지네이션(세션 425)**: `offset`/`limit` 쿼리(기본 50/상한 100) — `api/_lib/validators.ts parsePagination(query,{defaultLimit,maxLimit})` 공용 헬퍼(세션 447, admin/users 와 공유). `.range(offset, offset+limit-1)` + `.order("submitted_at",desc).order("id",desc)` tiebreaker. 응답 `count`(전체)=`count ?? 0` 폴백(supabase count=number|null). 프론트 AdminConsults "더 보기"로 append + id dedup

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

> ⚠️ **블라인드 = UX 로그인 유도이지 서버측 데이터 보호가 아님 (세션 442 보안 감사 #4).**
> `GET /api/supabase/apartments` 는 인증 없이(`rateLimit:"proxy"` 만) `catsCache`(점수)와 전체
> 상세를 반환한다. 클라의 "??" 블러는 브라우저가 이미 받은 데이터 위 표시 처리일 뿐, `curl`·
> DevTools 로 우회 가능하다. 이는 의도된 제품 결정(점수는 공개, 로그인은 UX 유인) — 노출 데이터는
> 공개 부동산 분석값이라 비밀·PII 아님. **점수/상세를 진짜로 보호해야 하면** 이 엔드포인트에 JWT
> 게이트를 걸고 미인증 응답에서 `catsCache` 등 점수 필드를 strip 해야 한다(현재 미적용).

- AptCard: 점수 블러("??") + 상세/지도 LoginPromptModal
- CompareSheet: 점수 "??" 텍스트 치환 (CSS blur 아닌 DOM 미노출), export/공유 숨김
- LoginPromptModal Analytics: trigger prop (detail/map), 4개 이벤트
- **상세 진입 게이트 일괄 (세션 413)**: 모든 상세 진입 경로가 `handleDetailGated`(useLoginGate.ts) 수렴 = 비로그인 시 LoginPromptModal. App.tsx 3 구멍 차단(`?detail=` URL 딥링크·지도 탭 MapView·분양결과/곧분양 UpcomingPage) — 직진입도 일반 목록과 동일 게이트. 신규 상세 진입 경로 추가 시 `detail.handleOpenDetail` 직접 호출 금지, 반드시 `handleDetailGated` 경유
