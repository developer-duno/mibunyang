# 미분양 비교 엔진 v3.0 — 아키텍처 가이드

> 주니어 개발자가 코드를 빠르게 이해하기 위한 실행 흐름 + 핵심 로직 문서.
> AI 규칙은 CLAUDE.md 및 서브디렉토리 CLAUDE.md 참조.

---

## 1. 한눈에 보는 구조

```
src/
├── constants/              데이터 레이어 (상수)
│   ├── brands.js           BRAND_TIER(16), AGE_PREMIUM(7), LAYOUT_SCORE
│   ├── profiles.js         PROFILES(5개 사용자 프로필)
│   ├── regions.js          CITY_TIER(5등급), REGIONS(17개 시도)
│   └── fieldMeta.js        FIELD_META(128필드), FIELD_SECTIONS(10섹션, presale 19필드 포함)
├── scoring/
│   └── engine.js           score{6개}, calcAll — 규칙: scoring/CLAUDE.md
├── theme/
│   └── index.js            C(팔레트+shadowSm/Md), catCol, catBg, gr(등급함수)
├── components/             규칙: components/CLAUDE.md
│   ├── primitives.jsx      Bar, ScoreBadge, LineChart, Radar (memo)
│   ├── icons.jsx            인라인 SVG 아이콘 10개 (IconClose, IconHelp 등, memo)
│   ├── AptCard.jsx / CatPanel.jsx / CompareSheet.jsx (PNG/PDF 내보내기)
│   ├── DetailModal.jsx / ConsultForm.jsx / ShareSheet.jsx
│   ├── sections/
│   │   ├── MapView.jsx     Kakao Map 지도 뷰 (동적 SDK 로드, 가격 라벨 마커, 현위치)
│   │   └── InfraOverlay.jsx 인프라 카테고리 토글 (지하철/병원/마트/학교)
│   ├── expert/             전문가 UI (PC 우선, 1200px)
│   └── admin/              관리자 UI
├── hooks/
│   ├── useApartmentData.js ★ 데이터 로딩 진입점 (dedupApartments 적용)
│   ├── useResponsive.js    isPC(768+) + isDesktop(1024+) + 150ms 디바운스
│   ├── useFilterSort.js / useComparison.js / useFavorites.js (객체 기반)
│   ├── usePriceHistory.js / useUnsoldHistory.js  (시계열 API 페칭)
│   └── useExpertMode.js / useAdminMode.js / useToast.js
├── lib/
│   ├── analytics.js        Vercel Analytics trackEvent 래퍼 (벤더 격리)
│   ├── classify.js         입주 상태/시공사 등급 분류 (MOVEIN_STATUS, TIER_LABELS)
│   ├── filterEngine.js     공통 base 필터 (applyBaseFilters, MANWON_PER_EUK)
│   ├── exportPdf.js        비교 결과 PNG/PDF 내보내기 (dynamic import)
│   ├── chosung.js          초성 검색 (matchSearch)
│   ├── dedup.js            아파트 중복 제거 + siblingIds 생성 (dedupApartments)
│   └── format.js           가격/날짜 포맷 (fmtPrice, fmtCompletion, fmtPriceRange, fmtPresaleSchedule, fmtRecruitDate)
├── services/
│   ├── staticDataApi.js    ★ Supabase API 또는 JSON 폴백
│   ├── applyhomeApi.js / kakaoApi.js / neisApi.js / kosisApi.js / dartApi.js
└── App.jsx                 오케스트레이터 (훅 조합 + 렌더 + SORTERS 모듈 상수 + isDesktop prop 스레딩 + trackEvent 이벤트 계측)

api/                        Vercel Serverless — 규칙: api/CLAUDE.md
├── _lib/                   auth.js, adminAuth.js, supabase.js
├── supabase/apartments.js  ★ 9개 테이블 JOIN → 평탄 형태 반환
├── supabase/prices.js      분양가 시계열 API (apartment_id 필수)
├── supabase/unsold-history.js  미분양 추이 시계열 API
├── auth/ + admin/          전문가/관리자 인증
└── applyhome/ kakao/ neis/ kosis/ dart/

scripts/
├── collect-data.mjs        빌드 시 데이터 수집 (1,065줄, 8 Phase)
├── migrate-to-supabase.mjs apartments.json → Supabase 마이그레이션
├── naver-units.py          네이버 세대수 보정
└── collectors/
    ├── _shared.mjs         공유 유틸 (loadEnv, upsertBatch, fetchWithRetry)
    ├── naver-collect.py  ★ 네이버 인근 매물 수집
    └── naver-presale.mjs ★ 네이버 분양정보 수집 (pre.land.naver.com, 19필드)

supabase/
└── schema.sql              14개 테이블 + VIEW + presale 19컬럼 + RLS + 트리거

.github/workflows/
├── daily-deploy.yml        매일 빌드+배포
├── naver-units.yml         매일 KST 02:00 세대수 보정
└── collect-naver-listings.yml  매일 KST 04:00 네이버 매물 수집
```

### 의존성 방향 (단방향, 순환 참조 없음)

```
constants → scoring → theme → components → hooks → App
     ↓                   ↓          ↓
     └───────────────────┘──────────┘  (상수/테마는 어디서든 import 가능)
```

---

## 2. 데이터 흐름 (핵심!)

### 데이터 소스 아키텍처

```
GitHub Actions (일/주/월 스케줄)
  ├── collect-data.mjs ─── 청약홈/카카오/KOSIS/NEIS/DART/국토부
  │                         ↓
  │                    public/data/apartments.json (787KB, 1,481건)
  │                         ↓
  ├── migrate-to-supabase.mjs ──→ Supabase PostgreSQL (14개 테이블)
  │                                    ↓
  ├── naver-collect.py ──────────→ complexes + articles + complex_price_history
  │                                    ↓
  └── naver-units.py ────────────→ 세대수 보정 JSON

로컬 PC (Windows 스케줄러, 매주 월/목 06:00, 한국 IP 필수)
  └── run-naver-local.sh ──────→ 6단계 파이프라인:
      1. naver-collect.py → complexes/articles
      2. sync-naver-complex.mjs → apartments 22필드
      3. naver-presale.mjs → apartments presale_* 19필드 (⚠️ JWT 인증 실패 중, 브라우저 기반 전환 필요)
      4. naver-units.mjs → 세대수 보정
      5. calc-exclusive-ratio.mjs → 전용률
      6. compute-scores.mjs → cats_cache 갱신

프론트엔드 로딩:
  VITE_USE_SUPABASE=true  → /api/supabase/apartments (Supabase VIEW)
  VITE_USE_SUPABASE=false → /data/apartments.json (정적 JSON 폴백)

⚠️ 공유 인프라:
  Supabase DB (rwdtljipvmqpazrimyns) ← mibunyang + naver-estate-web 공유
  data.go.kr API Key (MOLIT_KEY)     ← 일일 한도 10,000건 공유
  Vercel Team (developer-dunos-projects) ← 프로젝트는 별도
```

### React 상태 흐름

```
사용자 조작                    React 상태              useMemo 연쇄              UI 렌더
──────────                    ──────────              ──────────              ──────────

프로필 버튼 클릭 ──→ profile ──→ scored ─────────────→ AptCard 1,481개 재채점
                                   │
지역 버튼 클릭 ──→ filterRegion ──→ │ ──→ guOptions ──→ 구 버튼 목록 갱신
                  filterGu ───────→ │
정렬 버튼 클릭 ──→ sortKey ────────→ filtered ────────→ AptCard 순서 변경
                                                         │
비교 추가 클릭 ──→ compIds ────────→ compItems ──────→ CompareSheet 테이블
                                                         │
비교 보기 클릭 ──→ showCompOpen ──→ showComp(파생) ──→ CompareSheet 표시/숨김
```

### 핵심 useMemo 체인 (App.jsx)

```js
// 1단계: 전체 아파트 카테고리 채점 (apartments 변경 시 재계산, 지역 중위값 컨텍스트 포함)
const catsCache = useMemo(() => {
  const regionMedians = computeRegionalMedians(apartments);
  return apartments.map(a => ({ apt: a, cats: calcCats(a, { regionMedians }) }));
}, [apartments]);

// 2단계: 프로필 가중치 적용 → 총점 계산
const scored = useMemo(() =>
  catsCache.map(({ apt, cats }) => {
    const total = Math.round(Math.min(Object.keys(cats).reduce(
      (s, k) => s + cats[k].total * (w[k] ?? 0) / 100, 0), 100));
    return { apt, res: { total, cats, weights: w } };
  }),
  [catsCache, profile, customWeights]
);

// 2.5단계: base 필터 인자 메모이제이션 (leave-one-out 패턴용)
const baseFilterArgs = useMemo(() => ({
  showFavOnly, favoriteIds, budgetMin, budgetMax, areaMin, areaMax,
  unitsMin, unitsMax, minScore, benefitOnly, searchText: debouncedSearchText,
  ...catMinScores,  // 카테고리별 최소 점수 6개 (min_price, min_location 등)
}), [12개 의존성]);

// 3단계: base 필터 → 드롭다운 필터 → SORTERS 정렬
const filtered = useMemo(() => {
  let list = applyBaseFilters(scored, baseFilterArgs);  // filterEngine.js
  // region, gu, moveIn, builderTier 드롭다운 필터 적용
  return [...list].sort(SORTERS[sortKey] || SORTERS.total);  // 모듈 레벨 상수
}, [scored, baseFilterArgs, filterRegion, filterGu, sortKey, moveInFilter, builderTier]);

// 3.5단계: 드롭다운별 leave-one-out 카운트 (필터 옵션 비활성화용)
const filterOptionCounts = useMemo(() => {
  const base = applyBaseFilters(scored, baseFilterArgs);
  // 각 드롭다운만 제외하고 카운트 → {regionCounts, guCounts, moveInCounts, tierCounts}
}, [scored, baseFilterArgs, filterRegion, filterGu, moveInFilter, builderTier]);

// 4단계: 비교 대상 추출 (O(1) Map 조회)
const scoredMap = useMemo(() => new Map(scored.map(x => [x.apt.id, x])), [scored]);
const compItems = useMemo(() =>
  compIds.map(id => scoredMap.get(id)).filter(Boolean),
  [compIds, scoredMap]
);
```

---

## 3. 스코어링 파이프라인

파일: `src/scoring/engine.js`

### calcAll(apt, profile) → 6개 함수 호출 → 가중치 합산

```
calcAll(apt, "live")
│
├── scorePrice(apt)      가격 매력도
│   ├── 적정가 괴리도 (30%) = (fairPrice - 분양가) / fairPrice * 100
│   ├── 전세가율 (20%)
│   ├── PIR 소득비 (15%)
│   ├── PSR 매매비 (25%)    ← Math.min(psrSc, 100) 클램핑 필수!
│   └── 데이터 신뢰도 (10%)
│
├── scoreLocation(apt)   입지/생활권
│   ├── 교통 (30%)         ← CITY_TIER별 지하철/버스/IC/KTX 가중치 자동 보정
│   ├── 학군 (25%)         ← apt.schoolScore ?? 50 (nullish coalescing)
│   ├── 생활인프라 (20%)    ← 8개 항목 (병원/마트/편의점/공원/카페/문화/은행/약국)
│   ├── 자연환경 (10%)
│   └── 혐오시설 (15%)
│
├── scoreProduct(apt)    상품성
│   └── 9개 항목 합산 / maxPossible(100) * 100
│       (브랜드20 + 세대수15 + 주차15 + 용적률10 + 에너지10 + 전용률10 + 평면10 + 내진5 + 구조5)
│
├── scoreBenefit(apt)    혜택
│   └── totalWon(만원) = 할인액 + 중도금이자절감 + 옵션무상 + 발코니 + 캐시백 + 관리비절감
│       → rate = totalWon / price * 100
│       → 점수 = min(rate / 25 * 100, 100)
│
├── scoreRisk(apt)       안전도
│   └── 7개 위험요소 가중 합산 → safety = 100 - 총리스크
│       (미분양률20% + 거래량15% + 대출15% + 시공사신용20% + 규제10% + 공급량10% + 시장환경10%)
│
└── scoreFuture(apt)     미래가치
    ├── 교통개발 (40%)    ← "기존"=100, "계획/착공/공사중/추진/확정"=거리비례
    ├── 도시개발 (25%)    ← 80점(신도시/재건축/혁신 등) / 50점(관광/산단/공항 등) / 30점(기타)
    ├── 인구 (25%)        ← 7단계 popGrowth + netMigration 보너스
    └── 산업개발 (20%)    ← 국가산단 80점, 산업단지 55점, 기타 35점

최종 = sum(카테고리점수 * PROFILES[profile].w[카테고리] / 100)
     = price*20 + location*40 + product*20 + benefit*5 + risk*10 + future*5  (live 기준)
```

### 적정가(fairPrice) 계산 공식

```
fairPrice = 주변중위가(nearbyMedian) * 연식계수(ageCoeff) * 면적보정(areaAdj) * 브랜드보정(brandAdj)

- ageCoeff: 신축=1.03, 1년=1.05, 5년=1.10, ... 25년+=1.55 (미래 완공=1.0)
- areaAdj: 60㎡미만=1.08, 60~84=1.0, 85~114=0.97, 115+=0.94
- brandAdj: 1군Super=1.05, 1군=1.02, 2군=0.99, 기타=0.98
```

---

## 4. 상태 관리 맵

### App.jsx 직접 관리 상태 (4개 + useTransition)

```
State            타입      초기값        변경 트리거
─────            ────      ──────        ──────────
profile          string    "live"        프로필 버튼 클릭
customWeights    object    {}            사용자 가중치 커스텀
visibleCount     number    30            무한스크롤 / 필터 변경 시 리셋
tab              string    "list"        탭 버튼 / 하단 네비
isPending        boolean   (transition)  useTransition — 프로필 전환 시
```

### 커스텀 훅별 상태

| 훅 | 상태 | 파생값 |
|----|------|--------|
| useToast | toast | — |
| useFilterSort | filterRegion, filterGu, sortKey | — |
| useComparison | compIds, showCompOpen | showComp (파생), MAX_COMPARE=4 export, 복원 토스트 |
| useFavorites | favoritesObj (객체) | favoriteIds (파생 배열), setFavoriteIds, toggleFavorite |
| useDetailModal | detailAptId | — |
| useConsult | consultForm, consultSubmitted, submitting, submittedConsults | fetchConsults(token) |
| useExpertMode | expertPw, expertLoggedIn, expertExpandedApt | — |

### 교차 관심사 해결

```js
// App.jsx에서 훅 간 연결
const { handleRegionChange, handleGuChange } = useFilterSort({
  onFilterChange: () => detail.setDetailAptId(null)  // 필터 변경 → 상세 닫기
});

const handleExpertLogin = () => {
  if (expert.handleExpertLogin()) setTab("expert");   // 로그인 성공 → 탭 전환
};

const handleExpertLogout = () => {
  expert.handleExpertLogout(() => {                    // 로그아웃 → 탭+비교 리셋
    setTab("list"); setShowCompOpen(false);
  });
};
```

---

## 5. 컴포넌트 트리

### 소비자 모드 (반응형: 모바일 520px / 태블릿 960px / 데스크톱 1200px)

```
App (Pretendard Variable 폰트, paddingTop: isDesktop ? 64 : 0)
├── HeaderSection (memo)
│   ├── [isDesktop] 고정 상단 바 60px (로고18px + 프로필탭 + 네비13px + IconHelp)
│   └── [mobile] 블루 그라디언트 헤더 + 프로필 버튼 5개
│
├── [소비자 모드]
│   ├── [tab === "list"]
│   │   ├── SearchFilterBar (memo) ← 검색/필터/정렬/프리셋 (SVG 아이콘: IconClose, IconHeart, IconChevronDown)
│   │   ├── 비교 토글 버튼 (compIds >= 2일 때)
│   │   ├── CompareSheet (memo, isDesktop) ← showComp일 때 (데스크톱: 확대패딩, sticky thead)
│   │   ├── 빈 상태 안내 (filtered.length === 0일 때)
│   │   └── AptListSection (memo) → AptCard (memo) * filtered.length
│   │       ├── [isDesktop] 3컬럼 grid gap 20px
│   │       ├── [isPC] 2컬럼 grid gap 16px
│   │       ├── [mobile] 1컬럼
│   │       └── AptCard: ScoreBadge + Bar*3 + 3버튼 (데스크톱: borderRadius16, shadowMd)
│   │
│   ├── [tab === "map"]
│   │   └── MapView (memo, lazy, isDesktop) ← Kakao Map 지도 뷰
│   │       ├── InfraOverlay (memo) ← 인프라 토글 (지하철/병원/마트/학교)
│   │       ├── 현위치 버튼 (📍 이모지)
│   │       ├── 가격 라벨 마커 (buildMarkerSvg, 점수+가격 배지)
│   │       ├── 선택 아파트 정보 카드 (IconClose 닫기)
│   │       └── [isDesktop] 높이 calc(100dvh - 120px)
│   │
│   ├── [tab === "consult"]
│   │   └── ConsultForm (memo) ← 상담 신청 폼 (IconClose 관심단지 제거)
│   │
│   ├── [tab === "info"]
│   │   └── InfoPage (10섹션 + FAQ 10건) + 전문가 로그인 링크
│   │
│   └── DetailModal (memo, isDesktop) ← 모달 (z-index:300, ARIA dialog)
│       ├── [isDesktop] 760px, 패딩24px, 폰트18px, Radar 180px, IconClose
│       ├── [mobile] 바텀시트 520px, 드래그핸들
│       ├── ScoreBadge (80px) + Radar + 핵심지표
│       ├── 상담 CTA 버튼 ("이 매물 상담하기")
│       ├── CatPanel (memo) * 6
│       ├── PriceChart (memo) ← 분양가 추이 LineChart
│       ├── UnsoldChart (memo) ← 미분양 추이 LineChart
│       ├── PriceTable / SchoolInfo / PresaleInfo / LoanAnalysis / DataSections
│       └── 관심매물/비교추가/공유 버튼 (데스크톱: 14px, 패딩12px)
│
├── BottomNav (memo) ← [isDesktop] return null / [mobile] 하단 고정
├── Toast (role="status", z-index:400) ← [isDesktop] bottom:24px / [mobile] bottom:76px
├── 사업자 정보 푸터
│
├── [전문가 모드] (PC 우선, maxWidth: 1200px)
│   ├── [tab === "expert"]
│   │   └── ExpertDashboard (memo)
│   │       ├── ExpertSidebar (검색/필터/정렬 + 단지 목록, 280px)
│   │       └── 메인 콘텐츠 영역
│   │           ├── ExpertAptHeader (단지명/위치/점수/Radar)
│   │           ├── ExpertFieldTable (memo) * 10섹션 (2컬럼 CSS Grid)
│   │           │   └── FIELD_META 기반 128개 필드 렌더 (presale 19필드 포함)
│   │           ├── ExpertUnitPlaceholder (동/호수 안내)
│   │           ├── ExpertScoreBreakdown (6카테고리 산출 내역)
│   │           │   └── 적정가 계산 과정 인라인 표시
│   │           ├── ExpertScoreSummary (가중치 합계 표)
│   │           └── ExpertDataCompleteness (완성도 % 바)
│   │
│   └── [tab === "expertConsults"]
│       └── 상담 요청 목록
│
│
├── Analytics (main.jsx) ← Vercel Analytics 페이지뷰 + 커스텀 이벤트 (8개)
├── SpeedInsights (main.jsx) ← Web Vitals (LCP, CLS, INP, TTFB)
└── ErrorBoundary (main.jsx) ← 전체 앱 래핑, 오류 시 새로고침 안내
```

### memo() 컴포넌트 Props

| 컴포넌트 | 파일 | Props |
|----------|------|-------|
| Bar | primitives.jsx | value, color, h |
| ScoreBadge | primitives.jsx | score, size |
| Radar | primitives.jsx | data, size |
| CatPanel | CatPanel.jsx | cat, k |
| AptCard | AptCard.jsx | apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights, onExpertView, isDesktop |
| CompareSheet | CompareSheet.jsx | items, onShare, onClose, profile, isDesktop (+ PNG/PDF 내보내기 내장) |
| MapView | sections/MapView.jsx | filtered, onDetail, isPC, isDesktop |
| InfraOverlay | sections/InfraOverlay.jsx | mapInstance, ready |
| ConsultForm | ConsultForm.jsx | scored, favoriteIds, setFavoriteIds, form, setForm, onSubmit, submitted, showToast |
| DetailModal | DetailModal.jsx | item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult |
| LineChart | primitives.jsx | data, color, height, secondaryData, secondaryColor, yLabel, xLabel (+ 내부 activeDot 터치 인터랙션) |
| ExpertFieldTable | expert/ | apt, fields, title, color, exclude |
| ExpertScoreBreakdown | expert/ | apt, res, profile |
| ExpertScoreSummary | expert/ | res, profile |
| ExpertUnitPlaceholder | expert/ | apt |
| ExpertDataCompleteness | expert/ | apt |
| ExpertSidebar | expert/ | scored, selectedId, onSelect, search, setSearch, regionFilter, setRegionFilter, sort, setSort, isMobile, onClose |
| ExpertAptHeader | expert/ | apt, res |
| ExpertDashboard | expert/ | scored, profile, setProfile, expandedApt, setExpandedApt, onSwitchToAdmin |

---

## 6. 등급 시스템

파일: `src/theme/index.js` — `gr()` 함수

| 점수 | 등급 | 색상 | 의미 |
|------|------|------|------|
| 90~100 | S | 파랑 (#2563EB) | 최우수 |
| 80~89 | A | 초록 (#16A34A) | 우수 |
| 70~79 | B+ | 틸그린 (#059669) | 양호 |
| 60~69 | B | 주황 (#D97706) | 보통 |
| 50~59 | C | 오렌지 (#EA580C) | 미흡 |
| ~49 | D | 빨강 (#DC2626) | 부적합 |

### 카테고리별 색상

파일: `src/theme/index.js` — `catCol`, `catBg`

| 카테고리 | 키 | 색상 | 이모지 |
|----------|-----|------|--------|
| 가격 매력도 | price | green | 💰 |
| 입지/생활권 | location | blue | 📍 |
| 상품성 | product | purple | 🏗 |
| 혜택 | benefit | amber | 🎁 |
| 안전도 | risk | red | 🛡 |
| 미래가치 | future | cyan | 🚀 |

---

## 7. 주요 상수 참조

### BRAND_TIER (constants/brands.js)

| 등급 | 건설사 | 점수 | 보정계수 |
|------|--------|------|---------|
| 1군Super | 현대건설, 삼성물산, GS건설 | 20 | 1.05 |
| 1군 | 롯데, 대우, HDC, 포스코, DL | 15 | 1.02 |
| 2군 | 호반, 태영, KCC, 금호 | 10 | 0.99 |
| 기타 | 미등록 빌더 | 5 | 0.98 |

### CITY_TIER (constants/regions.js)

| 등급 | 도시 | 지하철 | 버스 | IC | KTX |
|------|------|--------|------|-----|------|
| S | 서울 | 1.0 | 0.6 | 0.3 | 0.3 |
| A | 부산/대구/광주/대전 | 0.9 | 0.7 | 0.4 | 0.4 |
| B | 경기/세종 | 0.7 | 0.8 | 0.6 | 0.5 |
| C | 충남/경남 등 | 0.3 | 0.9 | 0.8 | 0.7 |
| D | 군 | 0.1 | 1.0 | 1.0 | 0.9 |

### PROFILES 가중치 (constants/profiles.js)

| 프로필 | 가격 | 입지 | 상품 | 혜택 | 안전 | 미래 |
|--------|------|------|------|------|------|------|
| 실거주 | 20 | 40 | 20 | 5 | 10 | 5 |
| 투자 | 30 | 15 | 10 | 10 | 25 | 10 |
| 신혼부부 | 30 | 30 | 15 | 10 | 10 | 5 |
| 자녀교육 | 15 | 45 | 20 | 5 | 10 | 5 |
| 은퇴 | 20 | 35 | 25 | 5 | 15 | 0 |

---

## 8. 전문가 페이지 아키텍처

### PC-First 레이아웃 (1200px+)

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER (인디고 그라데이션) + 프로필 선택 + 인쇄 버튼           │
├──────────────┬─────────────────────────────────────────────────┤
│  SIDEBAR     │  MAIN CONTENT (스크롤)                          │
│  280px       │                                                 │
│  ┌────────┐  │  ┌── ExpertAptHeader ──────────────────────┐    │
│  │ 검색   │  │  │ 단지명 | 지역 | 면적 | 가격 | 시공사    │    │
│  │ 지역 ▾ │  │  │ ScoreBadge(80) + Radar(140)             │    │
│  │ 정렬 ▾ │  │  └────────────────────────────────────────┘    │
│  ├────────┤  │                                                 │
│  │ 단지1  │  │  ┌── 2컬럼 CSS Grid (FIELD_SECTIONS) ────────┐ │
│  │ 단지2  │  │  │ [개요 15필드]     [가격/시장 14필드]       │ │
│  │ 단지3  │  │  │ [입지/교통 19필드] [상품성 7필드]          │ │
│  │ ...    │  │  │ [혜택/할인 10필드] [미래가치 4필드]        │ │
│  └────────┘  │  └────────────────────────────────────────────┘ │
│              │                                                 │
│              │  ExpertUnitPlaceholder (동/호수)                 │
│              │  ExpertScoreBreakdown (6카테고리 산출 내역)      │
│              │  ExpertScoreSummary (가중치 합계)                │
│              │  ExpertDataCompleteness (완성도)                 │
├──────────────┴─────────────────────────────────────────────────┤
│  하단 네비 (전문가 모드)                                        │
└────────────────────────────────────────────────────────────────┘
```

### FIELD_META 시스템 (constants/fieldMeta.js)

모든 128개 필드의 메타데이터를 정의하는 상수:

```js
FIELD_META = {
  필드키: {
    label: "표시 라벨",           // 한국어 이름
    fmt: (v, apt) => "포맷팅",    // 값 → 표시 문자열 변환
    isDefault: v => boolean       // 센티널/기본값 감지 (데이터 완성도 계산)
  }
}
```

FIELD_SECTIONS는 10개 섹션으로 필드키를 그룹화:
1. 단지 개요 (21필드) — id, name, region, area, price, pp, avgMaintenanceCost, primaryDirection, ...
2. 가격/시장 지표 (11필드) — nearbyMedian, jeonseRate, pir, psr, dataReliability, priceIndex, ...
3. 안전도/리스크 (15필드) — unsoldRate, recentTrades6m, supplyRatio, builderCreditGrade, cancelRatio6m, ...
4. 입지/교통/교육/환경 (24필드) — subwayDist, busRoutes, schoolScore, hospital, view, ...
5. 상품성/건축 (10필드) — parkingRatio, floorAreaRatio, energyGrade, heatFuel, corridorType, ...
6. 혜택/할인 (10필드) — discountPct, loanFree, optionFree, ...
7. 미래가치 (4필드) — transitDev, devDist, cityDev, industryDev
8. 건축HUB 에너지 (3필드) — elecUsageKwh, gasUsageMj, energyCollectedAt
9. 네이버 교차검증 (11필드) — naverNearbyMedian, naverJeonseRate, naverSellCount, ...
10. 네이버 분양정보 (19필드) — presaleMinPrice, presaleMaxPrice, presalePp, presaleStage, presaleSchedule, ...

### ExpertScoreBreakdown 적정가 인라인 계산

`calcAll()` 수정 없이, 기존 `res.cats[k].subs[]`에서 서브점수를 읽고,
적정가 중간값만 인라인으로 재계산:

```js
const ageCoeff = getAgeCoeff(apt.completion);
const areaAdj = getAreaAdj(apt.area);
const brand = BRAND_TIER[apt.builder] || { adj: 1.0 };
const fairPrice = apt.nearbyMedian * ageCoeff * areaAdj * brand.adj;
const dev = apt.nearbyMedian > 0 ? (fairPrice - apt.price) / fairPrice * 100 : 0;
```

catKeys는 `Object.keys(res.cats)`로 동적 추출 (OCP 원칙).

---

## 9. 수정 시 체크리스트

코드를 수정한 후 확인 (상세 규칙은 각 디렉토리 CLAUDE.md 참조):

- [ ] 가중치 합계 100%? → `src/scoring/CLAUDE.md`
- [ ] 클램핑 Math.min(..., 100)? → `src/scoring/CLAUDE.md`
- [ ] Hook 순서 유지? → `CLAUDE.md` (Critical Rule #2)
- [ ] useMemo 의존성 누락 없음? → `CLAUDE.md` (Critical Rule #3)
- [ ] memo() + useCallback 유지? → `src/components/CLAUDE.md`
- [ ] null 가드에 `??` 사용? → `src/scoring/CLAUDE.md`
- [ ] 접근성 (ARIA, 폰트, 터치)? → `src/components/CLAUDE.md`
- [ ] API null → sanitize 처리? → `api/CLAUDE.md`

---

## 10. DB 아키텍처 (Supabase PostgreSQL)

### 테이블 관계도

```
┌──────────────────────────────────────────────────────────────┐
│                    미분양 아파트 데이터                        │
│                                                              │
│  apartments (1,500행) ─────────────────────────────────────  │
│       │ id (PK)                                              │
│       ├──→ prices (시계열, 분양가)                             │
│       ├──→ unsold_history (시계열, 미분양 추이)                │
│       ├──→ infra (주간, 카카오 인프라)                        │
│       ├──→ schools (주간, NEIS 학군)                          │
│       ├──→ transport (주간, 교통)                             │
│       ├──→ trade_stats (실거래 통계 캐시)                     │
│       └──→ builders (월간, 건설사 재무) ← builder name FK     │
│                                                              │
│  regions (시계열, 지역 통계)                                  │
│  trades (시계열, 실거래가 원본)                                │
│                                                              │
│  apartments_flat (VIEW) ← 7개 테이블 JOIN → 평탄 128+필드 (presale 19 포함) │
├──────────────────────────────────────────────────────────────┤
│                    네이버 인근 시세 데이터                     │
│                                                              │
│  complexes ──→ articles (매물, 소프트 삭제)       │
│                  └──→ complex_price_history (시세 이력)         │
│                                                              │
│  nearby_apartment_ids (JSONB) ← apartments.id 참조           │
├──────────────────────────────────────────────────────────────┤
│                    상담 신청 데이터                            │
│                                                              │
│  consults (상담 신청, RLS: anon INSERT+SELECT)               │
└──────────────────────────────────────────────────────────────┘
```

### 데이터 갱신 스케줄

| 테이블 | 갱신 주기 | 소스 | 스크립트 |
|--------|----------|------|---------|
| apartments, prices | 매일 | 청약홈 API | collect-data.mjs Phase 1 |
| infra | 주 1회 | 카카오 API | collect-data.mjs Phase 3 |
| schools | 주 1회 | NEIS API | collect-data.mjs Phase 4 |
| transport | 주 1회 | 카카오 API | collect-data.mjs Phase 6 |
| builders | 월 1회 | DART API | collect-data.mjs Phase 5 |
| regions | 월 1회 | KOSIS API | collect-data.mjs Phase 2 |
| trades | 매월 1/15일 | 국토부 API | collect-trades.mjs |
| trade_stats | 매주 일요일 | trades 기반 | trade-stats.mjs |
| apartments (경쟁률) | 주 1회 | 청약홈 API | collect-applyhome.mjs |
| apartments (에너지) | 월 1회 | 건축HUB API | collect-building-hub.mjs |
| cats_cache | 수집 후 | 스코어링 엔진 | compute-scores.mjs |
| complexes | 로컬 수집 | 네이버 부동산 | naver-collect.py |
| articles | 로컬 수집 | 네이버 부동산 | naver-collect.py |
| complex_price_history | 로컬 수집 | 네이버 부동산 | naver-collect.py |

### 네이버 데이터 활용

네이버 매물 데이터는 미분양 아파트 분석을 강화:

| 지표 | 기존 소스 | 네이버 추가 후 |
|------|----------|--------------|
| nearbyMedian | 국토부 실거래가 (월 1회) | + 네이버 호가 중위값 (매일) |
| jeonseRate | 국토부 전세 데이터 | + 네이버 전세/매매 비율 (매일) |
| psr | 주변시세 대비 분양가 | 네이버 호가 기반 실시간 PSR |
| 매물 수 | 없음 | 인근 활성 매물 건수 (수요/공급) |
| 평당가 추이 | 없음 | 네이버 호가 변동 추적 |
