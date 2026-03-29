# API 규칙

> Vercel Serverless Functions 및 데이터 연동 수정 시 반드시 이 규칙을 따를 것.

## JavaScript null 비교 함정

```js
null <= 5   // true (null → 0으로 강제 변환)
null < 50   // true
null <= 3   // true
```

API에서 null 반환 시 **위험 단지가 안전하게 표시됨**. `sanitize()` 레이어 필수:
- 위험 필드 null → 비관적 기본값 (unsoldRate:50, pir:10, psr:1.5)
- 혜택 필드 null → 0
- 문자열 키 null → 최저 등급
- **presale 19필드**: 전부 `?? null` (정보성 필드, 스코어링 미사용 → null 허용)
  - presaleMinPrice~presaleFetchedAt: 네이버 분양정보 (pre.land.naver.com)
  - presaleSchedule: JSONB → PostgREST 자동 파싱, 프론트에서 fmtPresaleSchedule() 처리

## 한글 텍스트 주의

- UTF-8 BOM (`\uFEFF`) → BRAND_TIER/REGIONS 조회 실패 가능
- NFC/NFD 정규화 → macOS에서 한글 비교 실패 가능
- 빌더명 변형 ("GS건설"↔"지에스건설") → 별칭 해소 테이블 필요 (`scripts/collectors/_shared.mjs`의 BUILDER_ALIASES)

## Supabase 연동 규칙

- 읽기: `SUPABASE_ANON_KEY` (Vercel 환경변수) — `api/_lib/supabase.js`
- 쓰기: `SUPABASE_SERVICE_KEY` (GitHub Secrets만) — `scripts/collectors/_shared.mjs`
- `apartments_flat` VIEW를 통해 7개 테이블 JOIN → 평탄 형태 반환 (apartments + prices + trades + schools + transport + infra + trade_stats)
- RLS 활성: anon = 읽기만, service_role = 읽기+쓰기
- API 응답 형식: `{ ok: true, data: [...], count: N, fetchedAt: "..." }` (기존 JSON과 동일)

## API 핸들러 래퍼 (withHandler)

모든 API 핸들러는 `api/_lib/handler.js`의 `withHandler(config)`로 래핑:

```js
import { withHandler } from "../_lib/handler.js";

export default withHandler({
  method: "POST",           // "GET", "POST", ["GET","POST"]
  cors: {},                 // {} = 기본 CORS, { maxAge: 86400 } = 커스텀, 생략 = CORS 미적용
  rateLimit: "login",       // 엔드포인트 키 (rateLimit.js LIMITS), 생략 = 미적용
  admin: true,              // true = verifyAdminToken 필수, 생략 = 미적용
  handler: async (req, res) => { /* 비즈니스 로직 */ },
  // 또는 듀얼 메서드: handler: { GET: handleGet, POST: handlePost }
});
```

**미들웨어 실행 순서**: CORS → Method(405) → RateLimit(429) → Admin(401) → Dispatch
**패턴별 사용**:
- Pattern C (method only): `{ method: "GET", handler }` — supabase/*, kakao, neis, dart, kosis, applyhome
- Pattern B (admin): `{ method: "GET", admin: true, handler }` — admin/users, admin/review
- Pattern A (CORS+RL): `{ method: "POST", cors: {}, rateLimit: "login", handler }` — auth/login, auth/signup, auth/verify
- Mixed (듀얼): `{ method: ["GET","POST"], cors: {}, handler: { POST, GET } }` — consults

## 시계열 API 엔드포인트 (세션19 추가)

| 엔드포인트 | 테이블 | 파라미터 | 캐싱 |
|-----------|--------|---------|------|
| `GET /api/supabase/prices` | prices | `apartment_id` 또는 `apartment_ids` | s-maxage=3600 |
| `GET /api/supabase/unsold-history` | unsold_history | `apartment_id` 또는 `apartment_ids` | s-maxage=3600 |

- `apartment_ids`: 쉼표 구분 복수 ID (최대 20개, siblingIds 통합 조회용)
- ID 형식 검증: `/^ah-\d+$/` 패턴 필수 (인젝션 방어)
- 복수 조회 시 `.in()` 사용, `apartment_id` 컬럼도 SELECT에 포함
- 입력 검증: `apartment_id` 또는 `apartment_ids` 필수, trim() 적용
- 에러 응답: `{ ok: false, error: "메시지" }` (400/500)
- 정렬: prices → `recorded_at ASC`, unsold_history → `base_month ASC`
- RLS: 두 테이블 모두 "Public read" 정책 (인증 불필요)

## 인증 시스템

- SHA-256 + salt 해싱 (`api/_lib/auth.js`)
- HMAC-SHA256 JWT 토큰
- 전문가: status 기반 접근제어 (pending → approved)
- 관리자: `api/_lib/adminAuth.js` — verifyAdminToken

---

## 네이버 부동산 API 연동 규칙

참조 구현: `scripts/collectors/naver-collect.py` (Python, curl_cffi)`
Node.js 포트: `scripts/collectors/naver-listings.mjs`

### API 엔드포인트

| 엔드포인트 | 용도 | 인증 |
|-----------|------|------|
| `new.land.naver.com/api/search?query=` | 키워드 검색 | 없음 |
| `/api/complexes/{id}` | 단지 상세 | JWT + Referer |
| `/api/articles/complex/{id}` | 단지별 매물 | JWT + Referer |
| `/api/articles/{no}` | 매물 상세 | JWT + Referer |
| `/api/complexes/{id}/prices` | 시세 이력 | JWT + Referer |

### JWT 토큰

- 추출: 단지 페이지 HTML에서 정규식 `/"token":"(eyJ[A-Za-z0-9._-]+)"/`
- 유효기간: 3000초 (50분), 캐시 후 만료 전 갱신
- 401/403 응답 시 자동 재발급
- **Referer 헤더 필수** — 없으면 403 (e.g., `https://new.land.naver.com/complexes/{id}`)

### Rate Limiting

- 요청 간 최소 1.0초 간격 (throttle)
- 페이지네이션 간 1.5초 대기
- 재시도: 최대 3회, 지수 백오프 [3초, 5초, 10초]
- 429 (Rate Limit): 세션 리셋 + 백오프 후 재시도
- 캐시 TTL: 600초 (10분) — 동일 요청 중복 방지

### 가격 파싱

```js
// "2억 5,000" → 25000 (만원)
// "50" → 50 (이미 만원 단위)
// "2억" → 20000 (만원)
function parseNaverPrice(str) {
  if (!str) return 0;
  const s = str.replace(/[,\s만원]/g, "");
  const parts = s.split("억");
  if (parts.length === 2) {
    return (parseInt(parts[0]) || 0) * 10000 + (parseInt(parts[1]) || 0);
  }
  return parseInt(s) || 0;
}
```

### 핵심 규칙

- 면적 변환: `M2_TO_PYEONG = 3.3058` (평당가 계산 시)
- 분양권 판별: `realEstateTypeCode` in ["ABYG", "PRE"] 또는 `realEstateTypeName`에 "분양권"
- 소프트 삭제: 사라진 매물은 `is_active=FALSE` (절대 DELETE 금지)
- 페이지네이션: `isMoreData=false`까지 반복 (페이지 수 가정 금지)
- 관리비: `maintenanceCost.costsByDate[0].commonPrice` (원→만원 변환)
- `null` 필드: 상세 API 미호출 시 rooms/bathroom/maintenance 등 null
