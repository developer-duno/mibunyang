# 컴포넌트 규칙

> UI 컴포넌트 수정 시 반드시 이 규칙을 따를 것.

## memo() 컴포넌트 (45개, 2026-04-19 실측)

| 그룹 | 개수 | 위치 | 컴포넌트 |
|------|------|------|---------|
| 소비자 | 8 | `src/components/` | CatPanel, AptCard, CompareSheet, ShareSheet, ConsultForm, DetailModal, LoginPromptModal, primitives.jsx 내부 4개 |
| 섹션 | 8 | `sections/` | HeaderSection, SearchFilterBar, AptListSection(내부 2개), ExpertLoginForm, InfoPage, BottomNav, MapView, InfraOverlay |
| 상세 | 8 | `detail/` | PriceTable, PriceChart, UnsoldChart, SchoolInfo, PresaleInfo, LoanAnalysis, LoanRatesSection, DataSections |
| 필터 | 7 | `filters/` | FilterButton, FilterDropdown, RegionPanel, BudgetPanel, AreaPanel, SortPanel, DetailPanel |
| 전문가 | 9 | `expert/` | ExpertFieldTable, ExpertScoreBreakdown, ExpertScoreSummary, ExpertUnitPlaceholder, ExpertDataCompleteness, ExpertSidebar, ExpertAptHeader, ExpertDashboard, ExpertHelpGuide |
| 관리자 | 3 | `admin/` | AdminDashboard, AdminHelpGuide, WeightEditor (단, 세션138 이후 `admin/` 폴더에는 memo 아닌 StatsSection/UserCard/UserList 3개 추가 존재) |
| 아이콘 | 1 | `icons.jsx` | 내부 공용 memo 1개 (IconClose 등 9개 아이콘은 순수 SVG 함수, memo 래핑 안 함) |

- 반드시 `memo(function Name(...) { ... })` 패턴 유지
- memo 효과를 위해 콜백은 `useCallback`으로 안정화 필수

---

## 접근성 규칙

- ARIA 속성 제거 금지 (role, aria-pressed, aria-selected, aria-current, aria-live)
- 터치 타겟: 필터/정렬 버튼 minHeight 36px+, 네비 버튼 minHeight 44px+
- 폰트 크기: 최소 10px (8px 금지)
- 색상 대비: C.muted = `#6B7280` (WCAG AA 4.6:1) — 더 밝은 색 변경 금지
- 키보드 접근: 카드 `tabIndex={0}`, `role="button"`, `onKeyDown` 유지

## 크로스브라우저 규칙

- `100dvh` 사용 (`100vh` 금지 — iOS Safari 주소창)
- `inset: 0` 금지 → `top:0; right:0; bottom:0; left:0` (Safari <14.1)
- SVG 텍스트: `dy="0.35em"` 사용 (`dominantBaseline` 금지 — Firefox <128)
- iOS Safe Area: 하단 네비 + Toast에 `env(safe-area-inset-bottom)` 필수

---

## 전문가 페이지 규칙

- PC 버전 우선 (maxWidth 1200px+, 2컬럼 그리드)
- 모든 95개 필드 개별 표시 필수
- 스코어링 중간 계산 과정 투명 표시
- catKeys는 `Object.keys(res.cats)` 동적 추출 (하드코딩 금지)

---

## 주요 컴포넌트 구조

### App.jsx (~442줄, 2026-04-19 실측)

Hook + useMemo + 콜백 + 탭 라우팅 + isDesktop prop 스레딩 + trackEvent

### 섹션 컴포넌트 (`sections/`)

| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| HeaderSection | 166 | 데스크톱: 상단 바 60px / 모바일: 그라디언트 + HelpModal |
| SearchFilterBar | 196 | 드롭다운 오케스트레이터 (6개 FilterButton + 패널 + 칩 + undo) |
| AptListSection | 53 | 카드 그리드 (isDesktop 3컬럼/isPC 2컬럼) |
| MapView | 216 | Kakao Map (마커+클러스터+현위치+인프라) |
| BottomNav | 36 | 하단 네비 (isDesktop → null) |

### 상세 컴포넌트 (`detail/`)

| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| DetailModal | 130 | 모달 컨테이너 (isDesktop 760px, ARIA dialog) |
| PriceChart | 43 | 분양가 추이 SVG (usePriceHistory + siblingIds) |
| UnsoldChart | 45 | 미분양 추이 SVG (useUnsoldHistory + siblingIds) |
| PresaleInfo | 130 | 네이버 분양정보 (가격카드/일정/링크/Analytics) |
| DataSections | 175 | 공공데이터 6개 섹션 |

### 프리미티브 (`primitives.jsx`)

| 컴포넌트 | 역할 |
|---------|------|
| Bar | 수평 프로그레스 바 |
| ScoreBadge | 원형 점수 인디케이터 (SVG circle) |
| LineChart | 시계열 SVG 라인 차트 (다중 라인, 터치 툴팁 3초 auto-dismiss) |
| Radar | 6점 레이더 차트 |

### AptCard (143줄)

- `isDesktop`: shadowMd, borderRadius 16, fontSize 16
- `isFav`: 관심매물 하이라이트 (border 색상)
- `moveInDone` (준공 + 미분양 0%): opacity 0.55
- alertRow 배지: 분양중/분양예정 + 입주상태 + 미분양 + 시공사신용 + 혐오시설
