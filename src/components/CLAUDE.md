# 컴포넌트 규칙

> UI 컴포넌트 수정 시 반드시 이 규칙을 따를 것.

## memo() 35개 컴포넌트 + icons.jsx (SVG 아이콘 10개)

소비자 10개: Bar, ScoreBadge, Radar, **LineChart**, CatPanel, AptCard, CompareSheet, ShareSheet, ConsultForm, DetailModal
섹션 8개 (App.jsx에서 분리): HeaderSection, SearchFilterBar, AptListSection, ExpertLoginForm, InfoPage, BottomNav, MapView, InfraOverlay
상세 6개 (DetailModal에서 분리): PriceTable, **PriceChart**, **UnsoldChart**, SchoolInfo, LoanAnalysis, DataSections
전문가 9개: ExpertFieldTable, ExpertScoreBreakdown, ExpertScoreSummary, ExpertUnitPlaceholder, ExpertDataCompleteness, ExpertSidebar, ExpertAptHeader, ExpertDashboard, ExpertHelpGuide
관리자 2개: AdminDashboard, AdminHelpGuide

- 반드시 `memo(function Name(...) { ... })` 패턴 유지
- memo 효과를 위해 `onToggle` 등 콜백은 `useCallback`으로 안정화 필수

## 접근성 규칙

- ARIA 속성 제거 금지 (role, aria-pressed, aria-selected, aria-current, aria-live 등)
- 터치 타겟: 필터/정렬 버튼 minHeight: 36px+, 네비 버튼 minHeight: 44px+
- 폰트 크기: 최소 10px (8px 사용 금지)
- 색상 대비: C.muted = `#6B7280` (WCAG AA 4.6:1) — 더 밝은 색으로 변경 금지
- 키보드 접근: 카드 `tabIndex={0}`, `role="button"`, `onKeyDown` 유지

## 크로스브라우저 규칙

- `100dvh` 사용 (`100vh` 금지 — iOS Safari 주소창 문제)
- `inset: 0` 금지 → `top:0; right:0; bottom:0; left:0` (Safari <14.1)
- SVG 텍스트: `dy="0.35em"` 사용 (`dominantBaseline` 금지 — Firefox <128)
- iOS Safe Area: 하단 네비 + Toast에 `env(safe-area-inset-bottom)` 필수

## 반응형 레이아웃 규칙 (Phase1+Phase2)

- `isDesktop` (1024px+): 1200px 컨테이너, 3컬럼 카드(gap 20px), 고정 상단 바(60px), BottomNav 숨김
- `isPC` (768px+): 960px 컨테이너, 2컬럼 카드(gap 16px), 하단 BottomNav
- 모바일 (<768px): 520px 컨테이너, 1컬럼, 하단 BottomNav
- isDesktop prop 전달: App → HeaderSection, BottomNav, SearchFilterBar, AptListSection → AptCard, DetailModal, CompareSheet, MapView
- 모든 데스크톱 변경은 `isDesktop` 조건 분기로 격리 (모바일 불변)
- Pretendard Variable 폰트: CDN 로드 (index.html), fallback Noto Sans KR → 시스템 폰트
- SVG 아이콘: `@/components/icons.jsx` (IconClose, IconHelp 등 10개, memo 래핑)

## 전문가 페이지 규칙

- PC 버전 우선 (maxWidth: 1200px+, 2컬럼 그리드)
- 소비자 모드 = 데스크톱 1200px / 태블릿 960px / 모바일 520px
- 모든 95개 필드 개별 표시 필수
- 스코어링 중간 계산 과정 투명하게 표시
- 동/호수 섹션 포함 (현재 플레이스홀더, 향후 관리자 페이지에서 입력)
- catKeys는 `Object.keys(res.cats)` 동적 추출 (하드코딩 금지)

## 컴포넌트 구조

### App.jsx (~510줄) — Hook + useMemo + 콜백 + 탭 라우팅 + SORTERS 모듈 상수 + dedup useEffect + isDesktop prop 스레딩 + 사업자 푸터
분리된 섹션 컴포넌트 (`src/components/sections/`):
| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| HeaderSection | 166 | 데스크톱: 고정 상단 바 60px(프로필탭+네비+IconHelp) / 모바일: 블루 그라디언트 + HelpModal 공용 |
| SearchFilterBar | 322 | 검색/필터/정렬/프리셋/카운트 배지 (SVG 아이콘: IconClose, IconHeart, IconChevronDown) |
| AptListSection | 53 | 카드 그리드 (isDesktop 3컬럼 gap20 / isPC 2컬럼 gap16) + isDesktop→AptCard 전달 |
| ExpertLoginForm | 167 | 전문가 로그인/회원가입 |
| InfoPage | 267 | 스코어링 엔진 설명 (10섹션 + FAQ 10건) |
| BottomNav | 36 | 하단 네비게이션 (isDesktop → return null) |
| MapView | 216 | Kakao Map 지도 뷰 (마커+클러스터+현위치+인프라, isDesktop 높이 최적화) |
| InfraOverlay | 112 | 인프라 카테고리 토글 (지하철/병원/마트/학교) |

### DetailModal.jsx (127줄) — 모달 컨테이너 + isDesktop(760px/큰Radar/IconClose/ARIA) + 재공고 뱃지 + 상담 CTA
분리된 상세 컴포넌트 (`src/components/detail/`):
| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| PriceTable | 86 | 인근 매매/전세 시세 |
| **PriceChart** | 43 | 분양가 추이 SVG 라인 차트 (usePriceHistory + siblingIds) |
| **UnsoldChart** | 45 | 미분양 추이 SVG 라인 차트 (useUnsoldHistory + siblingIds) |
| SchoolInfo | 63 | 학군 정보 |
| LoanAnalysis | 91 | LTV/DSR/갭투자 분석 |
| DataSections | 168 | 공공데이터 5개 섹션 |

### primitives.jsx — 재사용 SVG 프리미티브 (memo)
| 컴포넌트 | 역할 |
|---------|------|
| Bar | 수평 프로그레스 바 (gradient, borderRadius) |
| ScoreBadge | 원형 점수 인디케이터 (SVG circle) |
| **LineChart** | 시계열 SVG 라인 차트 (다중 라인, 그리드, 터치 툴팁) |
| Radar | 6점 레이더 차트 (polygon) |

#### LineChart 터치 인터랙션 (세션20)
- `TOOLTIP_DISMISS_MS = 3000` — 모듈 레벨 상수
- `HIT_AREA_RADIUS = 16` — 투명 circle hit area (36px+ 터치 타겟)
- `activeDot: useState(null)` — 선택된 데이터 포인트 인덱스
- `handleDotTap: useCallback` — `data-index` 속성 기반, `onClick`만 사용 (`onTouchStart` 미사용 — 스크롤 방해 방지)
- 3초 auto-dismiss (useEffect + setTimeout + cleanup)
- 범위 가드: `activeDot != null && activeDot < data.length`

### icons.jsx (37줄) — 인라인 SVG 아이콘 10개 (memo 래핑, size/color props)
| 아이콘 | 사용 위치 |
|--------|----------|
| IconClose | DetailModal, SearchFilterBar(×4), MapView, ConsultForm |
| IconHelp | HeaderSection (데스크톱 도움말) |
| IconHeart / IconHeartFilled | SearchFilterBar (관심매물 토글) |
| IconChevronDown | SearchFilterBar (필터 접기/펼치기, CSS rotate 180deg) |
| IconSearch | (미사용 — 향후 확장용) |
| IconLocation | (미사용 — 향후 확장용) |
| IconCompare | (미사용 — 향후 확장용) |
| IconShare | (미사용 — 향후 확장용) |

### AptCard (136줄)
- `isDesktop` prop: 데스크톱 시 shadowMd, borderRadius 16, fontSize 16, padding 확대, grid gap 확대
- `isFav` prop으로 관심매물 하이라이트 (border 색상)
- `moveInDone` (준공 + 미분양 0%) → opacity 0.55 흐릿 표시
- `dynStyles.body`, `dynStyles.nameText` — isDesktop 조건 분기 (useMemo 내부)

### CompareSheet.jsx (123줄) — isDesktop(확대 패딩/폰트/프로그레스바, sticky thead)

### ConsultForm.jsx (129줄) — 상담 신청 폼 + IconClose(관심단지 제거)
