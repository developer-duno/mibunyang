# 미분양 아파트 비교 엔진 v3.0

> React 18 모듈형 SPA + Vercel Serverless Functions. 6개 카테고리 34+ 지표 AHP/헤도닉 스코어링 엔진.

## 기술 스택

- React 18 (useState, useMemo, useCallback, useRef, useEffect, memo)
- Vite + `@/` 경로 별칭 (vite.config.js)
- Vercel Serverless Functions (`api/` 디렉토리)
- Vercel KV (Upstash Redis) — `@vercel/kv`
- 인증: SHA-256 + salt 해싱, HMAC-SHA256 JWT 토큰

## 파일 구조

```
src/
├── main.jsx                          (엔트리포인트)
├── App.jsx                           (오케스트레이터 — 훅 조합 + 렌더)
├── constants/
│   ├── brands.js                     (BRAND_TIER, AGE_PREMIUM, LAYOUT_SCORE, NOXIOUS_PENALTY)
│   ├── regions.js                    (CITY_TIER, REGIONS)
│   ├── profiles.js                   (PROFILES)
│   ├── fieldMeta.js                  (FIELD_META, FIELD_SECTIONS)
│   └── unsold.js                     (UNSOLD[])
├── scoring/
│   └── engine.js                     (getAgeCoeff, getAreaAdj, score*, calcAll)
├── theme/
│   └── index.js                      (C, catCol, catBg, gr)
├── components/
│   ├── primitives.jsx                (Bar, ScoreBadge, Radar)
│   ├── CatPanel.jsx
│   ├── AptCard.jsx
│   ├── CompareSheet.jsx
│   ├── DetailModal.jsx
│   ├── ConsultForm.jsx
│   ├── expert/
│   │   ├── ExpertFieldTable.jsx
│   │   ├── ExpertScoreBreakdown.jsx
│   │   ├── ExpertScoreSummary.jsx
│   │   ├── ExpertUnitPlaceholder.jsx
│   │   ├── ExpertDataCompleteness.jsx
│   │   ├── ExpertSidebar.jsx
│   │   ├── ExpertAptHeader.jsx
│   │   └── ExpertDashboard.jsx
│   └── admin/
│       ├── AdminLogin.jsx
│       └── AdminDashboard.jsx
├── hooks/
│   ├── useToast.js
│   ├── useFilterSort.js
│   ├── useComparison.js
│   ├── useFavorites.js
│   ├── useDetailModal.js
│   ├── useConsult.js
│   ├── useExpertMode.js
│   └── useAdminMode.js
api/
├── _lib/
│   ├── auth.js                       (hashPassword, verifyPassword, createToken, verifyToken)
│   └── adminAuth.js                  (verifyAdminToken)
├── auth/
│   ├── signup.js                     (전문가 가입 — status:pending)
│   ├── login.js                      (로그인 — status 기반 접근제어)
│   └── verify.js                     (토큰 검증)
└── admin/
    ├── login.js                      (관리자 로그인 — ADMIN_SECRET)
    ├── users.js                      (사용자 목록 조회)
    └── review.js                     (승인/거부)
```

### 의존성 방향 (단방향, 순환 참조 없음)

```
constants → scoring → theme → components → hooks → App
```

---

## Critical Rules (절대 불변)

### 1. 가중치 합계 = 100% (또는 1.00)

수정 시 반드시 합계를 검증할 것. 한 곳이라도 틀리면 전체 점수가 왜곡됨.

| 위치 | 항목 | 합계 |
|------|------|------|
| profiles.js PROFILES.live | price(40)+location(20)+product(20)+benefit(10)+risk(5)+future(5) | **100** |
| profiles.js PROFILES.invest | 15+10+30+25+10+10 | **100** |
| profiles.js PROFILES.newlywed | 30+15+30+10+10+5 | **100** |
| profiles.js PROFILES.edu | 45+20+15+10+5+5 | **100** |
| profiles.js PROFILES.retire | 35+25+20+15+5+0 | **100** |
| engine.js scorePrice 내부 | 0.30+0.20+0.15+0.25+0.10 | **1.00** |
| engine.js scoreLocation 내부 | 0.30+0.25+0.20+0.10+0.15 | **1.00** |
| engine.js infra 서브가중치 | 0.20+0.10+0.05+0.15+0.15+0.15+0.05+0.15 | **1.00** |
| engine.js scoreRisk 내부 | 0.20+0.15+0.15+0.20+0.10+0.10+0.10 | **1.00** |
| engine.js scoreFuture 내부 | 0.40+0.30+0.30 | **1.00** |
| engine.js scoreProduct max | 20+15+15+10+10+10+10+5+5 | **100** |

### 2. 모든 점수 0~100 클램핑

모든 서브스코어와 카테고리 총점은 `Math.min(..., 100)` 또는 `Math.max(0, Math.min(100, ...))` 클램핑 필수.
특히 PSR 서브스코어는 psr < 0.7일 때 100 초과 가능 → Math.min 필수.

### 3. Hook 호출 순서

App.jsx 내부:
```
useState (2개: profile, tab) → 커스텀 훅 9개 → useMemo (5개) → useEffect (1개: 인쇄 CSS)
```

각 커스텀 훅 내부에서 자체적으로 useState → useRef → useCallback → useEffect 순서 보장.
총계: useState(25) → useRef(3) → useCallback(15) → useMemo(5) → useEffect(6)

React Rules of Hooks: 조건문 안에서 호출 금지, 순서 변경 금지.

### 4. useMemo 의존성 배열 (App.jsx)

| useMemo | 의존성 | 절대 누락 금지 |
|---------|--------|--------------|
| guOptions | [filterRegion] | UNSOLD는 상수라 제외 |
| scored | [profile] | UNSOLD는 상수라 제외 |
| filtered | [scored, filterRegion, filterGu, sortKey] | 4개 전부 필수 |
| compItems | [compIds, scored] | 2개 전부 필수 |
| regionOptions | [] | UNSOLD는 상수라 빈 배열 |

### 5. memo() 18개 컴포넌트

소비자 8개: Bar, ScoreBadge, Radar, CatPanel, AptCard, CompareSheet, ConsultForm, DetailModal
전문가 8개: ExpertFieldTable, ExpertScoreBreakdown, ExpertScoreSummary, ExpertUnitPlaceholder, ExpertDataCompleteness, ExpertSidebar, ExpertAptHeader, ExpertDashboard
관리자 2개: AdminLogin, AdminDashboard

반드시 `memo(function Name(...) { ... })` 패턴 유지.
memo 효과를 위해 `onToggle` 등 콜백은 `useCallback`으로 안정화 필수.

### 6. showComp는 파생 상태

```js
const showComp = showCompOpen && compIds.length >= 2;
```

별도 useState가 아닌 **파생 값**. useEffect로 동기화하지 말 것.
위치: `src/hooks/useComparison.js`

### 7. UNSOLD[] → API 전환 시

`src/constants/unsold.js`의 UNSOLD 배열을 API 호출로 교체.
참조 위치: `App.jsx`, `hooks/useFilterSort.js` (간접), `components/expert/ExpertSidebar.jsx` (내부 useMemo).
의존성 배열에 `apartments` 추가 필수.

---

## 교차 관심사 해결 패턴

| 훅 | 패턴 | 설명 |
|----|------|------|
| useExpertMode.handleExpertLogin() | `true`/`false` 반환 | App에서 `if (success) setTab("expert")` |
| useExpertMode.handleExpertLogout(onLogout) | 콜백 파라미터 | App에서 `() => { setTab("list"); setShowCompOpen(false); }` 전달 |
| useFilterSort({ onFilterChange }) | 콜백 옵션 | App에서 `() => setDetailAptId(null)` 전달 |

---

## 스코어링 엔진 수정 규칙

파일: `src/scoring/engine.js`

### 새 카테고리 추가 시

1. `engine.js`에 `scoreNewCategory(apt)` 함수 작성 (반환: `{ total, subs[] }`)
2. `calcAll()` 내 호출 추가
3. `src/constants/profiles.js` — **PROFILES 5개 전부** 가중치 재조정 (합계 100 유지)
4. `src/theme/index.js` — catCol, catBg에 새 색상 추가
5. CompareSheet, CatPanel, Radar에 키 추가

### scoreFuture 키워드 추가 시

| 그룹 | 점수 | 기존 키워드 |
|------|------|------------|
| 80점 | 대규모 개발 | 테크노, 주거타운, 신도시, 신도심, 복합도시, 재건축, 혁신 |
| 50점 | 중규모 개발 | 재생, 리모델링, 관광, 산업단지, 공항, 특구, 메디컬 |
| 30점 | 기본 | (위 키워드 미매칭 시) |

새 키워드는 적절한 점수 그룹에 배치. `includes()` 부분 매칭 주의 (예: "신도" → "신도시"+"신도심" 모두 매칭).

### null/undefined 처리

- `??` (nullish coalescing) 사용: `apt.schoolScore ?? 50` — falsy-zero(0)도 정상 처리
- `||` (logical OR) 금지: `apt.schoolScore || 50` — 0이 50으로 대체되는 함정
- 배열 가드: `(apt.noxious || []).length`
- 숫자 가드: `(apt.units ?? 0).toLocaleString()`

---

## 접근성 규칙

- ARIA 속성 제거 금지 (role, aria-pressed, aria-selected, aria-current, aria-live 등)
- 터치 타겟: 필터/정렬 버튼 minHeight: 36px+, 네비 버튼 minHeight: 44px+
- 폰트 크기: 최소 10px (8px 사용 금지)
- 색상 대비: C.muted = `#6B7280` (WCAG AA 4.6:1) — 더 밝은 색으로 변경 금지
- 키보드 접근: 카드 `tabIndex={0}`, `role="button"`, `onKeyDown` 유지

---

## 전문가 페이지 규칙

- PC 버전 우선 (maxWidth: 1200px+, 2컬럼 그리드)
- 소비자 모드 = 모바일 우선 (maxWidth: 520px)
- 모든 69개 필드 개별 표시 필수
- 스코어링 중간 계산 과정 투명하게 표시
- 동/호수 섹션 포함 (현재 플레이스홀더, 향후 관리자 페이지에서 입력)
- catKeys는 `Object.keys(res.cats)` 동적 추출 (하드코딩 금지)

---

## 크로스브라우저 규칙

- `100dvh` 사용 (`100vh` 금지 — iOS Safari 주소창 문제)
- `inset: 0` 금지 → `top:0; right:0; bottom:0; left:0` (Safari <14.1)
- SVG 텍스트: `dy="0.35em"` 사용 (`dominantBaseline` 금지 — Firefox <128)
- iOS Safe Area: 하단 네비 + Toast에 `env(safe-area-inset-bottom)` 필수

---

## API 연동 시 주의사항

### JavaScript null 비교 함정

```js
null <= 5   // true (null → 0으로 강제 변환)
null < 50   // true
null <= 3   // true
```

API에서 null 반환 시 **위험 단지가 안전하게 표시됨**. `sanitizeApartment()` 레이어 필수:
- 위험 필드 null → 비관적 기본값 (unsoldRate:50, pir:10)
- 혜택 필드 null → 0
- 문자열 키 null → 최저 등급

### 한글 텍스트 주의

- UTF-8 BOM (`\uFEFF`) → BRAND_TIER/REGIONS 조회 실패 가능
- NFC/NFD 정규화 → macOS에서 한글 비교 실패 가능
- 빌더명 변형 ("GS건설"↔"지에스건설") → 별칭 해소 테이블 필요
