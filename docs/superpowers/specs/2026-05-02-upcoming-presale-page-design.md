# 분양예정 전용 페이지 (`/upcoming`) 설계

> 2026-05-02 세션 161 · 트랙 1 (분양예정 전용 페이지) — 트랙 2 (메인 UI 재설계) 와 분리
> 사용자 의도: A 캘린더 + B 카드 리스트 + C 잠재고객 알림 적재 통합

---

## Context (왜 이 작업을 하는가)

세션 161 brainstorming 중 사용자가 "메인 UI 전면 재설계 직전에 분양예정 내용을 먼저 다루고 싶다" 명시 → 작업을 두 트랙으로 분리.

**트랙 1 (이 spec)** = 신규 페이지 추가, 위험 낮음, 2~3 세션
**트랙 2 (별도 spec)** = 메인 UI 재설계, 위험 높음 (4중 안전망), 3~5 세션, 트랙 1 결과를 prototype 으로 활용

**해결하려는 사용자 문제:**
1. 현재 메인 카드 그리드에 분양계획 37 / 청약중 60 / 분양중 295 단지가 미분양 121 + 옛 단지 1273 과 섞여서 분양 임박 단지 발견 어려움
2. 청약 마감일을 사용자가 직접 추적해야 함 (사이트 내 캘린더 없음)
3. "곧 분양 시작" 알림을 받고 싶은 잠재고객이 사이트를 떠나면 다시 못 옴 (전환 누수)

**기대 결과:**
1. `/upcoming` 진입만으로 분양 임박 단지 392개 한눈에
2. 청약 캘린더로 "5월 N일 청약 시작" 시간축 시각화
3. subscribers 테이블에 휴대폰 + 관심 지역 적재 → 카카오 알림톡 발송 시나리오 확보 (실제 발송은 후속 작업)

---

## 한눈 요약 (TL;DR)

**한 줄로 뭐 하는 작업인가:** 분양계획·청약중·분양중 단지를 모은 `/upcoming` 페이지 신설 (캘린더 + 카드 리스트 + 알림 적재 3영역).

**왜 필요한가:** 메인은 미분양 분석에 최적화되어 분양 임박 단지가 시간축으로 안 보이고, 잠재고객을 사이트 안에 잡을 수단이 없음.

**즉시 사용자 가치:** 진입 시 392개 분양 임박 단지가 캘린더+카드로 정렬, 휴대폰 입력 한 번으로 알림 적재.

**작업 7단계 (9 GATE 0 분할 — 단계당 1관심사·1~4파일):**

```
[1] DB 마이그              → subscribers 테이블 + 롤백 SQL
       ↓
[2] 의존성 + 헬퍼 점검      → react-day-picker + date-fns 설치 / fmtPresaleSchedule 재사용 확인
       ↓
[3] /api/upcoming          → 읽기 API + 테스트
       ↓
[4] /api/subscribers       → 쓰기 API (POST/DELETE) + 테스트
       ↓
[5] UI 캘린더 + 카드        → UpcomingPage + UpcomingCalendar + UpcomingCardList + 테스트
       ↓
[6] UI 알림 폼              → SubscribeForm + 테스트
       ↓
[7] 라우팅 활성             → App.jsx pathname 매칭 + HeaderSection CTA + .env (Feature Flag ON)
```

각 단계 = 1 PR = 1 git revert 단위. Sonnet 안정 처리 검증 (9 GATE 0 통과).

### 핵심 의사결정 (사용자 4결정 박제)

| 결정 | 선택 | 거부한 옵션·이유 |
|------|------|---------------|
| 알림 채널 | 카카오 알림톡 (Phase 2) | 이메일 단독: 도달률 ↓ / Web Push: 미접속 시 누락 |
| 메인 라우팅 | 랜딩 헤더 CTA + `/upcoming` 둘 다 | 새 라우트만: 진입 경로 1개 / 메인 탭만: 메인 의존 |
| 캘린더 구현 | react-day-picker v9 | 자체 SVG: 구현 +400줄 / 리스트만: 시각 임팩트 ↓ |
| DB 테이블 | 신규 `subscribers` | consults 재사용: 식별 복잡 / Vercel KV: 장기 조회 곤란 |

---

## § 1. 신규 라우팅 + 랜딩 CTA

### 1-1. URL 구조

| 경로 | 용도 |
|------|------|
| `/` | 기존 메인 (변경 없음, 트랙 2에서 재설계) |
| `/upcoming` | 신규 분양예정 페이지 |
| `/upcoming?stage=plan` | 분양계획 37 만 |
| `/upcoming?stage=apply` | 청약중 60 만 |
| `/upcoming?stage=sale` | 분양중 295 만 |
| `/upcoming?date=2026-05-08` | 특정 날짜 청약 시작 단지만 |

### 1-2. App.jsx 진입점 — react-router 미사용 (실측 박제)

**[GATE 8 보강]** 현재 본 저장소는 **react-router 미설치** (`package.json` grep 0건). 라우팅 = `App.jsx` 의 `tab` state + 카카오 콜백만 `pathname.startsWith` 1곳 (`App.jsx:58`).

**결정**: 신규 라우터 도입 X. 기존 패턴 그대로 확장:

```jsx
// App.jsx L57-64 패턴 확장 — useState 초기화 시 pathname 검사
const [tab, setTab] = useState(() => {
  if (window.location.pathname.startsWith("/oauth/kakao/callback")) return "kakaoCallback";
  if (window.location.pathname.startsWith("/upcoming")) {           // ← 신규 1줄
    if (import.meta.env.VITE_FEATURE_UPCOMING !== "true") {
      window.history.replaceState(null, "", "/");
      return "list";  // Feature Flag OFF 시 메인으로 fallback
    }
    return "upcoming";
  }
  // ... 기존 로직
});

// 탭 변경 시 URL 동기화 (App.jsx L142-160 의 useEffect 패턴 확장)
useEffect(() => {
  if (tab === "upcoming" && !window.location.pathname.startsWith("/upcoming")) {
    window.history.pushState(null, "", "/upcoming");
  }
}, [tab]);
```

**비-사용 명시:** spec 이전 버전의 `<Navigate to="/" replace />` 표현은 react-router 의존이라 부정확 → 폐기. 위 `window.history.replaceState` + `setTab` 조합으로 대체.

**URL 6종 동작:**
- `/` → 기본 `tab="list"`
- `/upcoming` → `tab="upcoming"` (Flag OFF 시 `/` 로 redirect + `list`)
- `/upcoming?stage=plan|apply|sale` → URLSearchParams 파싱 (`App.jsx:144` 패턴 재사용)
- `/upcoming?date=YYYY-MM-DD` → 동일 패턴

### 1-3. 헤더 CTA (랜딩 + 모든 탭)

`HeaderSection.jsx` (PC L130-137, 모바일 L178-190) 에 신규 버튼:

```jsx
<button onClick={() => setTab("upcoming")}>
  📅 곧 분양 <span style={{...}}>{upcomingCount}</span>
</button>
```

`upcomingCount` = `/api/upcoming/count` 엔드포인트로 Header 마운트 시 1회 fetch (KV 5분 캐시).

---

## § 2. 신규 DB 테이블 — `subscribers`

### 2-1. 마이그레이션 SQL

`supabase/migrations/20260502_create_subscribers.sql`:

```sql
CREATE TABLE IF NOT EXISTS subscribers (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,                    -- E.164 정규화 ("+821012345678")
  region TEXT,                            -- "서울특별시" or NULL (전국)
  gu TEXT,                                -- "강동구" or NULL
  apartment_id TEXT REFERENCES apartments(id),  -- 특정 단지 알림 (선택)
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_source TEXT NOT NULL DEFAULT 'upcoming-page',
  opt_out_at TIMESTAMPTZ,                 -- 철회 시각 (NULL = active)
  last_notified_at TIMESTAMPTZ,           -- 마지막 알림 발송 시각
  notify_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(phone, region, gu, apartment_id)
);

CREATE INDEX idx_subscribers_active ON subscribers(region, gu) WHERE opt_out_at IS NULL;
CREATE INDEX idx_subscribers_apt ON subscribers(apartment_id) WHERE opt_out_at IS NULL;

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscribers_insert_anon ON subscribers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY subscribers_select_admin ON subscribers FOR SELECT TO service_role USING (true);
CREATE POLICY subscribers_update_admin ON subscribers FOR UPDATE TO service_role USING (true);
```

### 2-2. 롤백 SQL

`supabase/migrations/20260502_rollback_subscribers.sql`:

```sql
DROP POLICY IF EXISTS subscribers_update_admin ON subscribers;
DROP POLICY IF EXISTS subscribers_select_admin ON subscribers;
DROP POLICY IF EXISTS subscribers_insert_anon ON subscribers;
DROP INDEX IF EXISTS idx_subscribers_apt;
DROP INDEX IF EXISTS idx_subscribers_active;
DROP TABLE IF EXISTS subscribers;
```

### 2-3. 운영 의미

| # | 항목 | 핵심 |
|---|------|------|
| 1 | 동의 이력 | `consent_at` + `opt_out_at` 둘 다 보존 (개인정보보호법 준수) |
| 2 | 중복 가입 | UNIQUE 제약으로 같은 (phone, region, gu, apt) 조합 1회만 — 재가입 시 update |
| 3 | 익명 INSERT | `anon` 키로만 가입 가능, SELECT/UPDATE 는 service_role 만 (휴대폰 정보 보호) |
| 4 | 알림 발송 | `notify_count` 누적으로 발송 빈도 추적 (Phase 2 알림톡 작업에서 활용) |

---

## § 3. BFF API 신규 2개

### 3-1. `GET /api/upcoming` — 분양 임박 단지 목록

**파일:** `api/upcoming.js`

**응답 스키마:**

```json
{
  "stages": {
    "plan": [{ "id": "ah-...", "name": "...", "presaleStage": "분양계획", ... }],
    "apply": [...],
    "sale": [...]
  },
  "calendar": {
    "2026-05-08": [{ "id": "ah-...", "event": "apply_start" }],
    "2026-05-12": [{ "id": "ah-...", "event": "apply_end" }]
  },
  "totals": { "plan": 37, "apply": 60, "sale": 295 }
}
```

**구현 로직:**
1. `apartments_flat` VIEW 에서 `presaleStage IN ('분양계획', '청약중', '분양중')` 필터
2. `presaleSchedule` JSONB 파싱 → 캘린더 매핑 (스키마는 § 3-1-A 박제)
3. KV 캐시 5분 (cron 외에는 갱신 빈도 낮음)
4. `withHandler` HOF — `api/_lib/handler.js` (실측 위치) 사용. 기존 `api/consults.js` 등 호출 패턴 동일

#### § 3-1-A. presale_schedule JSONB 스키마 (실측 박제)

**[GATE 6 보강]** 실제 적재 스키마 — `scripts/collectors/naver-presale.mjs:301-305`:

```javascript
presale_schedule: listItem ? {
  scheduleName: listItem.scheduleName ?? null,  // 예: "1순위 청약일", "당첨자 발표"
  dateInfo: listItem.dateInfo ?? null,          // 예: "2026.05.08", "2026.05.15"
  schdl_info: complex?.schdl_info ?? null,      // 비정형 fallback (단지마다 다름)
} : (complex?.schdl_info ?? null)
```

**3가지 형태 (단지마다 다름):**
- (A) 객체: `{ scheduleName, dateInfo, schdl_info }` — listItem 정상 케이스
- (B) 문자열: `complex.schdl_info` 만 있는 경우 (비정형, "5월 청약 예정" 같은 자연어)
- (C) null: `naver-presale.mjs` 미수집 (`presaleStage` 도 null)

**캘린더 매핑 정책:**
- (A) 객체 + `dateInfo` 정규식 `^\d{4}\.\d{2}\.\d{2}$` 매치 → `new Date()` 변환 후 react-day-picker `modifiers` 에 매핑
- (B) 문자열 → 캘린더 매핑 X. 카드 본문에 `fmtPresaleSchedule()` 결과 표시 (이미 존재하는 헬퍼, `src/lib/format.js:43-59`)
- (C) null → 캘린더 매핑 X. 카드에 "분양시기 미정" 표시

#### § 3-1-B. presale_recruit_date TEXT 파싱 (실측 박제)

**[GATE 6 보강]** DB 컬럼 = `TEXT` (`supabase/migrations/20260329000000_add_presale_fields.sql:25`).

**기존 헬퍼 재사용:** `fmtRecruitDate(v)` (`src/lib/format.js:62-67`):

```javascript
export const fmtRecruitDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;  // 파싱 실패 시 원문 그대로
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};
```

**캘린더 매핑:**
- `new Date(presaleRecruitDate)` → `isNaN(d.getTime())` 검사
- 정상이면 `modifiers.applyStart` 에 추가, 실패면 카드 본문에만 원문 표시 (캘린더 매핑 skip)

**실패율 추정:** 현재 392건 단지 중 약 5~10% 가 비정형 추정 (구체 수치는 단계 [3] 구현 시 SELECT COUNT 실측). spec § 검증 5-3 에 측정 쿼리 추가.

### 3-2. `POST /api/subscribers` — 알림 신청

**파일:** `api/subscribers.js`

**요청:**

```json
{
  "phone": "010-1234-5678",
  "region": "서울특별시",
  "gu": "강동구",
  "apartment_id": null,
  "consent": true
}
```

**검증:**
- `phone` 정규식 `/^01[0-9]-?\d{3,4}-?\d{4}$/` (한국 휴대폰)
- `region` ENUM 검증 (PROFILES.regions)
- `consent === true` 필수 (동의 거부 시 400)
- Rate Limit: 동일 IP 1분 5회 (KV)

**E.164 정규화:** `010-1234-5678` → `+821012345678` 저장.

### 3-3. `DELETE /api/subscribers` — 알림 철회

**파일:** `api/subscribers.js` (같은 파일, method 분기)

**요청:** `{ phone, token }` (token = HMAC-SHA256(phone, SECRET))

**구현:** `UPDATE subscribers SET opt_out_at = NOW() WHERE phone = $1`

토큰은 알림톡 메시지 끝의 "수신 거부" 링크에 포함 (Phase 2 알림톡 작업에서 활용).

---

## § 4. UI 3영역 컴포넌트

### 4-1. 새 라우팅 `UpcomingPage.jsx`

**파일:** `src/components/UpcomingPage.jsx` (신규)

**레이아웃:**

```
┌─────────────────────────────────────────┐
│ 📅 곧 분양 시작 — 전국 392개 단지       │  ← 헤더
├──────────────┬──────────────────────────┤
│              │ [전체 392] [곧분양 37]   │  ← 필터 탭
│   캘린더     │ [청약중 60] [분양중 295] │
│   (좌)       ├──────────────────────────┤
│              │ ┌────────────────────┐   │
│  5월 6 8 12  │ │ [곧분양] ○○자이    │   │  ← 카드
│              │ │ 5/8 청약 시작      │   │
│              │ └────────────────────┘   │
├──────────────┴──────────────────────────┤
│ 🔔 분양 시작 알림 받기                  │  ← 알림 적재 폼
│ [휴대폰] [지역▼] [신청]                 │
└─────────────────────────────────────────┘
```

### 4-2. `UpcomingCalendar.jsx` (좌)

**라이브러리:** `react-day-picker@9` (npm install)

**핵심 props:**
- `modifiers`: `{ applyStart: [...dates], applyEnd: [...dates] }`
- `modifiersClassNames`: `{ applyStart: 'bg-green-100', applyEnd: 'bg-amber-100' }`
- `locale`: `import { ko } from 'date-fns/locale'`
- `onDayClick`: 클릭 시 URL `?date=YYYY-MM-DD` 갱신

**의존성 추가:**
- `react-day-picker@9.x` (~30KB gzip)
- `date-fns@3.x` (이미 의존성 있는지 확인 — 없으면 추가)

### 4-3. `UpcomingCardList.jsx` (우)

기존 `AptCard` 재사용 X — 분양예정 전용 미니 카드 신규 작성 (트랙 2 prototype 역할):

```jsx
function UpcomingCard({ apt }) {
  return (
    <div style={{ display:'flex', gap:10, padding:10, border:`1px solid ${C.border}` }}>
      <img src={apt.presaleImageUrl || PLACEHOLDER} style={{ width:60, height:60, borderRadius:6 }} />
      <div style={{ flex:1 }}>
        <StageBadge stage={apt.presaleStage} />
        <h3>{apt.name}</h3>
        <p>{apt.presaleRecruitDate} 청약 · {apt.region} {apt.gu} · {apt.presaleMinPrice ? fmtPrice(apt.presaleMinPrice) : '미공개'}</p>
        <p style={{ fontSize:11, color:C.green }}>★ 점수 {apt.catsCache?.total?.toFixed(1) ?? '-'}</p>
        {/* score 는 기존 catsCache (apartments_flat VIEW 별칭) 기반 fallback. 산식 변경 0 (§ 비-작업 3 박제) */}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <button onClick={() => subscribe(apt.id)}>🔔 알림</button>
        <button onClick={() => openDetail(apt.id)}>상세</button>
      </div>
    </div>
  );
}
```

**포인트:**
- 시각 요소 7개 (이미지 + 단계배지 + 단지명 + 한 줄 정보 + 점수 + 알림 + 상세)
- AptCard (24~32개) 의 1/4 수준 → 트랙 2 검증된 prototype
- `presaleMinPrice` null 가드 (분양계획 단계는 가격 미공개 일반적)

#### § 4-3-A. UI 상태 5가지 (GATE 3 보강)

**[GATE 3 보강]** UpcomingPage 의 5가지 상태 명세 — 누락 시 baseline UX 깨짐:

| 상태 | 트리거 | UI |
|------|--------|-----|
| **로딩** | API fetch 중 | `<Skeleton>` 컴포넌트 (`primitives.jsx` 의 Skeleton 3종 재사용) — 캘린더 1개 + 카드 6개 stub |
| **빈 데이터** | API 응답 `{ totals: { plan:0, apply:0, sale:0 } }` | "현재 분양 임박 단지가 없습니다. 5/5 KOSIS cron 후 재확인 부탁" + 메인 복귀 버튼 |
| **API 실패** | fetch reject 또는 5xx | `<ErrorBoundary>` 또는 `useState(error)` + 재시도 버튼 + 토스트 |
| **부분 실패** | calendar 매핑 0개지만 stages 정상 | 캘린더 영역 "일정 데이터 준비 중" 회색 배경 + 카드는 정상 노출 |
| **Feature Flag OFF** | `import.meta.env.VITE_FEATURE_UPCOMING !== "true"` | App.jsx pathname 검사에서 `/` redirect (§ 1-2 박제) |

#### § 4-3-B. 모바일 반응형 (GATE 3 보강)

**[GATE 3 보강]** `useResponsive()` (`src/hooks/useResponsive.js`) 의 `isPC` / `isDesktop` 활용 — 본 저장소 표준 패턴 (`src/components/CLAUDE.md` 박제):

| 브레이크포인트 | 레이아웃 |
|--------------|---------|
| **<768px (모바일)** | 1컬럼 stack: 캘린더 → 카드 리스트 → 알림 폼. 캘린더 가로 스크롤 X (react-day-picker `numberOfMonths={1}`) |
| **768~1023px (isPC)** | 1컬럼 + 카드 2열 그리드 |
| **1024px+ (isDesktop)** | spec § 4-1 의 2컬럼 레이아웃 (좌 캘린더 / 우 카드) |

#### § 4-3-C. 접근성 (GATE 3 보강)

**[GATE 3 보강]** `src/components/CLAUDE.md` § 접근성 규칙 준수:

- 카드: `tabIndex={0}` + `role="button"` + `onKeyDown` (Enter/Space → openDetail)
- 단계 배지: `aria-label="분양예정"` 등 명시
- 캘린더 날짜: react-day-picker 기본 ARIA 충분 (npm 검증)
- 폼: `<label>` 명시 연결 + `aria-required` + `aria-invalid` (검증 실패 시)
- 폰트 최소 10px (8px 금지) + WCAG AA 4.6:1 색상 대비 유지
- 터치 타겟: 알림 버튼 minHeight 44px+ (네비 기준 적용)

### 4-4. `SubscribeForm.jsx` (하)

```jsx
function SubscribeForm({ defaultRegion, defaultApt }) {
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState(defaultRegion || '');
  const [gu, setGu] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!consent) return showToast('개인정보 동의가 필요합니다');
    if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone)) return showToast('휴대폰 형식 확인');
    setSubmitting(true);
    try {
      await fetch('/api/subscribers', { method:'POST', body: JSON.stringify({ phone, region, gu, apartment_id: defaultApt, consent }) });
      showToast('알림 신청 완료');
      trackEvent('subscriber_signup', { region, hasApt: !!defaultApt });
    } catch (e) {
      showToast('신청 실패 — 잠시 후 다시 시도');
    } finally {
      setSubmitting(false);
    }
  }
  // ...
}
```

**개인정보 동의 문구 (체크박스 옆):**
> "휴대폰 번호로 분양 시작 알림(카카오 알림톡)을 받는 데 동의합니다. 개인정보보호 정책에 따라 보관·관리되며, 언제든지 알림을 거부할 수 있습니다."

---

## § 5. 테스트 + 안전장치

### 5-1. 단위 테스트 (신규 6건)

| 파일 | 테스트 |
|------|--------|
| `api/upcoming.test.js` | (a) presaleStage 필터링 정확, (b) calendar JSONB 파싱, (c) 빈 결과 처리 |
| `api/subscribers.test.js` | (a) E.164 정규화, (b) 동의 거부 400, (c) Rate Limit, (d) 중복 가입 update |
| `src/components/UpcomingCardList.test.jsx` | presaleMinPrice null 가드 |
| `src/components/SubscribeForm.test.jsx` | 휴대폰 정규식 + 동의 미체크 차단 |

### 5-2. Feature Flag

`.env.example` 에 추가:

```
# 분양예정 페이지 활성화 (기본 OFF — 베타 단계)
VITE_FEATURE_UPCOMING=false
```

`UpcomingPage.jsx` 진입 가드 — react-router 미사용 패턴 (§ 1-2 박제와 일치):

```jsx
// UpcomingPage.jsx 마운트 시 가드 — Navigate import 폐기 (react-router 미설치)
if (import.meta.env.VITE_FEATURE_UPCOMING !== 'true') {
  // App.jsx pathname 검사가 1차 차단하지만 직접 마운트 케이스 방어
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, "", "/");
  }
  return null;  // 부모 App.jsx 가 setTab("list") 후 메인 렌더
}
```

**배포 시나리오 — PR 7단계 분리 (GATE 0 통과)**

**[GATE 0 보강]** 한 단계 = 1관심사 = 1 PR = 1 git revert. Sonnet 안정 처리 검증.

| 단계 | PR 내용 | 신/수 파일 | 관심사 | 위험 |
|------|---------|----------|--------|------|
| **[1] DB 마이그** | `supabase/migrations/20260502_create_subscribers.sql` + 롤백 SQL | 신2/수0 | DB만 | 🟢 |
| **[2] 의존성** | `package.json` (react-day-picker@9 + date-fns@3) + `.env.example` (VITE_FEATURE_UPCOMING=false) | 신0/수2 | 의존성 | 🟢 |
| **[3] /api/upcoming** | `api/upcoming.js` + `.test.js` | 신2/수0 | 읽기 API | 🟢 |
| **[4] /api/subscribers** | `api/subscribers.js` + `.test.js` (POST/DELETE 같은 파일) | 신2/수0 | 쓰기 API | 🟢 |
| **[5] UI 캘린더 + 카드** | `UpcomingPage.jsx` + `UpcomingCalendar.jsx` + `UpcomingCardList.jsx` + 테스트 1건 | 신4/수0 | UI 읽기 | 🟡 |
| **[6] UI 알림 폼** | `SubscribeForm.jsx` + `.test.jsx` | 신2/수0 | UI 쓰기 | 🟢 |
| **[7] 라우팅 활성** | `App.jsx` (pathname 매칭 + setTab) + `HeaderSection.jsx` ([📅 곧 분양] 버튼) + Vercel Production env `VITE_FEATURE_UPCOMING=true` | 신0/수3 | 통합·활성 | 🟢 |

**단계별 검증 게이트:**
- [1] 후 — Supabase Management API 로 `SELECT * FROM subscribers LIMIT 0` 성공
- [2] 후 — `npm install` + `npm run build` 번들 +30KB 이내
- [3] 후 — Vercel Preview 에서 `curl /api/upcoming?stage=plan` 응답 확인
- [4] 후 — 같은 방법으로 POST/DELETE 검증
- [5] 후 — Vercel Preview 에서 `?ui=v2` 강제 활성 후 캘린더 로딩 확인
- [6] 후 — SubscribeForm 휴대폰 검증 + 동의 가드 동작
- [7] 후 — 본인+베타 5명 1주 모니터링 → BACKLOG 등재

**라이브 영향:**
- [1]~[6] 모두 라이브 영향 0 (App.jsx 미수정, Feature Flag OFF, /upcoming URL 진입 X)
- [7] 만 라이브 진입점 활성. 1주 안정 후 트랙 2 (메인 재설계) 진입

### 5-3. 롤백 경로

| 시나리오 | 명령 | 복귀 시간 |
|---------|------|-----------|
| 페이지 즉시 숨기기 | Vercel `VITE_FEATURE_UPCOMING=false` 재배포 | 60초 |
| API 비활성 | Vercel `api/upcoming.js` `api/subscribers.js` 함수 disable | 30초 |
| DB 테이블 제거 | `20260502_rollback_subscribers.sql` 실행 | 즉시 |
| 코드 전체 revert | `git revert <PR-7>` (단계 7만 revert 시 단계 1~6 보존, 라이브 진입점만 차단) | 10초 |
| 단계별 부분 revert | 단계 N revert (예: UI만 되돌리고 API/DB 보존) | 30초 |

---

## 주요 위험 박제

- **🔴 휴대폰 정보 평문 저장** — RLS + service_role-only SELECT 로 anon 노출 차단. 향후 컬럼 암호화(pgcrypto) 검토 BACKLOG
- **🔴 Rate Limit 우회** — IP 기반 1분 5회 + reCAPTCHA v3 invisible 스코어 < 0.5 차단 (선택 — Phase 2)
- **🟡 카카오 알림톡 발송 미구현** — Phase 2 별도 작업. 본 spec 은 적재까지만
- **🟡 react-day-picker 번들 +30KB** — `lazy import` + Suspense 로 `/upcoming` 진입 시에만 로드
- **🟡 presaleSchedule JSONB 스키마 다양성** — 네이버 응답이 단지마다 다른 형식. 파싱 실패 시 빈 캘린더 fallback
- **🟢 5/3 학교 cron 와 겹침** — 영향 0 (테이블 무관)

---

## 명시적 비-작업 (의도적 미포함)

1. **카카오 알림톡 실발송** — Phase 2 별도 작업 (`api/notify-subscribers.js` + 카카오 비즈니스 채널 + 발신번호 등록)
2. **메인 UI 재설계 영향 차단** — 트랙 2 spec 별도. 본 작업은 `/upcoming` 신규 페이지만, 메인 컴포넌트 (`AptCard`/`DetailModal`/`SearchFilterBar`/`HeaderSection`) 수정 0 (헤더 CTA 1개 버튼만 추가)
3. **분양예정 단지의 점수 산식 변경** — 현재 `presale_pp=0` 이라 가격 점수 0 처리 그대로. UpcomingCard 에는 점수 표시는 하되 비교 정렬은 분양시기 우선
4. **사용자 로그인 연동** — 휴대폰 적재만, 카카오 OAuth 와 연동 X (Phase 2 검토)
5. **외부 사이트 (미분양닷컴) 의 시행사 광고 모델** — 본 저장소 정체성(점수에 광고비 영향 0) 유지. UpcomingCard 노출 순서는 분양시기·점수만, 광고 노출 0

---

## 검증 (구현 후 end-to-end)

### 5-1. 코드 검증

```bash
# 1. lint + 빌드
npm run lint
npm run build  # 번들 +30KB 이내 확인

# 2. 단위 테스트
npm run test -- api/upcoming.test.js api/subscribers.test.js
npm run test -- src/components/UpcomingCardList.test.jsx src/components/SubscribeForm.test.jsx

# 3. DB 마이그
node scripts/run-supabase-migration.mjs supabase/migrations/20260502_create_subscribers.sql

# 4. Vercel Preview 배포
git push origin feat/upcoming-presale-page
# → Preview URL 에서 VITE_FEATURE_UPCOMING=true 환경변수 설정 후 검증
```

### 5-2. 사용자 시나리오 검증

| 시나리오 | 기대 |
|---------|------|
| `/upcoming` 진입 | 캘린더 + 카드 392개 + 알림 폼 노출 (LCP < 2초) |
| 캘린더 5/8 클릭 | 5/8 청약 시작 단지만 카드 필터링 (URL `?date=2026-05-08`) |
| `[곧분양 37]` 탭 | 37 단지만 노출 |
| 카드 [🔔 알림] 클릭 | SubscribeForm 에 해당 apartment_id pre-fill |
| 휴대폰 입력 + [신청] | DB INSERT 성공 + 토스트 "알림 신청 완료" |
| 동의 미체크 신청 | "개인정보 동의가 필요합니다" 토스트 |
| 같은 휴대폰 재신청 | UPDATE (UNIQUE 제약) — 중복 INSERT X |
| 헤더 [📅 곧 분양 392] 클릭 | `/upcoming` 진입 |

### 5-3. 운영 검증

```sql
-- 적재 1일 후
SELECT COUNT(*) FROM subscribers WHERE consent_at > NOW() - INTERVAL '1 day';
SELECT region, COUNT(*) FROM subscribers WHERE opt_out_at IS NULL GROUP BY region;
```

---

## § 6. 경쟁사 벤치마킹 보강 (2026-05-02 사용자 명시 요청)

별도 문서 `2026-05-02-competitor-benchmark-plan.md` 의 § 5 보강 사항 5건을 본 spec 에 적용:

### 6-1. UpcomingCalendar 색상 범례 (청약홈 빈자리 흡수)

청약홈 캘린더 = 색상 범례 0. 우리는 4색 점:
- 🟢 분양예정 (녹색 점) — `presaleStage='분양계획'` + 모집공고 예정일
- 🟡 청약 시작 (노랑 점) — `presaleStage='청약중'` 시작일
- 🟠 청약 마감 (주황 점) — 청약 종료일
- 🔵 당첨자 발표 (파랑 점) — 당첨 발표일

`react-day-picker` `modifiers` props 에 4종 매핑.

### 6-2. UpcomingCard "D-day" 강조 (청약홈 빈자리 흡수)

카드 좌측 상단에 큰 글씨:
- `D-7` (청약 1주 전) — 진한 회색
- `D-3` (3일 전) — 주황색
- `오늘 청약` (당일) — 빨강 강조
- `D+1` (마감 1일 후) — 회색 (지난 단지)

### 6-3. UpcomingCard 용어 풀이 툴팁 (청약홈 빈자리 흡수)

청약홈 표준 용어 hover/tap 툴팁:
- 민영 = 민간건설사, 가점제·추첨제 혼합
- 1순위 = 청약통장 가입 1년+, 무주택 또는 1주택
- 특별공급 = 신혼·다자녀·생애최초 우선

### 6-4. UpcomingCard "구글 캘린더 추가" 버튼 (청약홈 빈자리 흡수)

```html
<a href="https://www.google.com/calendar/render?action=TEMPLATE&text={단지명}&dates={청약기간}">
  📅 내 캘린더 추가
</a>
```

청약기간·발표일·계약일 3개 일정을 한 번에 등록.

### 6-5. 헤더 CTA + 메인 카피 (미분양닷컴 흡수)

- 헤더 CTA: `[📅 곧 분양 N개]` (한국어 자연스러움)
- 메인 카피 (트랙 2 랜딩 시점에 적용):
  ```
  지금은 랜드마크인 그 아파트도, 처음엔 미분양이었습니다.
  데이터로 검증하세요 — 41개 지표가 좋은 단지를 골라드립니다.
  ```

### 6-6. 상태 배지 4단계 색 매핑 확정 (직방 변형)

§ 4-3 의 `<StageBadge>` 컴포넌트:

| 단계 | 색 | DB 매핑 |
|------|-----|---------|
| 분양예정 | 🟢 녹색 (#dcfce7 / #166534) | `presaleStage='분양계획'` 37건 |
| 청약중 | 🟡 노랑 (#fef3c7 / #854d0e) | `presaleStage='청약중'` 60건 |
| 분양중 | 🔵 파랑 (#dbeafe / #1e40af) | `presaleStage='분양중'` 295건 |
| 추가모집 | 🔴 빨강 (#fee2e2 / #991b1b) | `unsoldEventCount > 0` (세션 160) |

---

## 트랙 2 spec 와의 관계

본 작업이 만든 다음 자산이 트랙 2 (메인 UI 재설계) 의 prototype 으로 활용됨:

| 자산 | 트랙 2 활용 |
|------|------------|
| `UpcomingCard.jsx` | AptCard.v2.jsx 의 시각 요소 7개 패턴 검증 |
| 색상 — `green/amber/blue` 단계 배지 | v2 카드 알림 배지 색상 결정 |
| Progressive Disclosure — 클릭 시 [상세] | v2 1차/2차 클릭 위계 검증 |
| SubscribeForm 의 짧은 폼 패턴 | 메인 ConsultForm.v2 단순화 prototype |

트랙 2 spec 작성 시 본 spec § 4 (UI 컴포넌트) 결과를 prerequisites 로 참조.

## 진행 상태

✅ **완료** (2026-05-02 세션 161) — `src/components/UpcomingPage.tsx` (214줄) + `UpcomingCalendar.tsx` (80줄) + `UpcomingCardList.tsx` (220줄) 신규 + `/upcoming` 라우트 박힘.
