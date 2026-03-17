# 컴포넌트 규칙

> UI 컴포넌트 수정 시 반드시 이 규칙을 따를 것.

## memo() 27개 컴포넌트

소비자 8개: Bar, ScoreBadge, Radar, CatPanel, AptCard, CompareSheet, ConsultForm, DetailModal
섹션 6개 (App.jsx에서 분리): HeaderSection, SearchFilterBar, AptListSection, ExpertLoginForm, InfoPage, BottomNav
상세 4개 (DetailModal에서 분리): PriceTable, SchoolInfo, LoanAnalysis, DataSections
전문가 8개: ExpertFieldTable, ExpertScoreBreakdown, ExpertScoreSummary, ExpertUnitPlaceholder, ExpertDataCompleteness, ExpertSidebar, ExpertAptHeader, ExpertDashboard
관리자 1개: AdminDashboard

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
- 모든 69개 필드 개별 표시 필수
- 스코어링 중간 계산 과정 투명하게 표시
- 동/호수 섹션 포함 (현재 플레이스홀더, 향후 관리자 페이지에서 입력)
- catKeys는 `Object.keys(res.cats)` 동적 추출 (하드코딩 금지)
