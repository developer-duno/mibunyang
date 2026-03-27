# 컴포넌트 규칙

> UI 컴포넌트 수정 시 반드시 이 규칙을 따를 것.

## memo() 35개 컴포넌트

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

## 전문가 페이지 규칙

- PC 버전 우선 (maxWidth: 1200px+, 2컬럼 그리드)
- 소비자 모드 = 모바일 우선 (maxWidth: 520px)
- 모든 95개 필드 개별 표시 필수
- 스코어링 중간 계산 과정 투명하게 표시
- 동/호수 섹션 포함 (현재 플레이스홀더, 향후 관리자 페이지에서 입력)
- catKeys는 `Object.keys(res.cats)` 동적 추출 (하드코딩 금지)

## 컴포넌트 구조

### App.jsx (~490줄) — Hook + useMemo + 콜백 + 탭 라우팅 + SORTERS 모듈 상수
분리된 섹션 컴포넌트 (`src/components/sections/`):
| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| HeaderSection | 35 | 프로필 선택 + 헤더 |
| SearchFilterBar | 327 | 검색/필터/정렬/프리셋/카운트 배지 |
| AptListSection | 69 | 카드 그리드 + 비교 |
| ExpertLoginForm | 157 | 전문가 로그인/회원가입 |
| InfoPage | 58 | 스코어링 엔진 설명 |
| BottomNav | 35 | 하단 네비게이션 |
| MapView | 216 | Kakao Map 지도 뷰 (마커+클러스터+현위치+인프라) |
| InfraOverlay | 112 | 인프라 카테고리 토글 (지하철/병원/마트/학교) |

### DetailModal.jsx (~140줄) — 모달 컨테이너 + 메모/태그 UI
분리된 상세 컴포넌트 (`src/components/detail/`):
| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| PriceTable | 88 | 인근 매매/전세 시세 |
| **PriceChart** | 45 | 분양가 추이 SVG 라인 차트 (usePriceHistory) |
| **UnsoldChart** | 45 | 미분양 추이 SVG 라인 차트 (useUnsoldHistory) |
| SchoolInfo | 36 | 학군 정보 |
| LoanAnalysis | 93 | LTV/DSR/갭투자 분석 |
| DataSections | 168 | 공공데이터 5개 섹션 |

### primitives.jsx — 재사용 SVG 프리미티브 (memo)
| 컴포넌트 | 역할 |
|---------|------|
| Bar | 수평 프로그레스 바 (gradient, borderRadius) |
| ScoreBadge | 원형 점수 인디케이터 (SVG circle) |
| **LineChart** | 시계열 SVG 라인 차트 (다중 라인, 그리드, 툴팁) |
| Radar | 6점 레이더 차트 (polygon) |
