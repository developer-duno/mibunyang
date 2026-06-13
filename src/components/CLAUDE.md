# 컴포넌트 규칙

> UI 컴포넌트 수정 시 반드시 이 규칙을 따를 것.

## memo() 컴포넌트 (세션 409 D2b 후 detail +1: CategoryMiniCard 신규 → 14개, 2026-06-13 실측)

| 그룹 | 개수 | 위치 | 컴포넌트 |
|------|------|------|---------|
| 소비자 | 11 | `src/components/` | CatPanel, AptCard, CompareSheet, ShareSheet, ConsultForm, DetailModal, LoginPromptModal, LineChart, RegionChipBar(지역 칩+★관심지역, 세션 406), PresaleResultList(분양결과 — 잔여세대 경쟁률, "1순위" 표기 금지, 세션 406), primitives.tsx 내부(Bar/ScoreBadge/Radar/EmphasisBadge/Skeleton 3종) |
| 홈 | 6 | `home/` | HomePage, WidgetCard, MapEntryWidget(M2: 로그인 시 MapView compact 미니지도 임베드 + 뷰포트 진입 lazy), UpcomingWidget, TopPicksWidget, MarketSummaryWidget (세션 404 M1 신설, 세션 406 표 등재) |
| 섹션 | 9 | `sections/` | HeaderSection, SearchFilterBar, AptListSection(내부 2개), AdminLoginForm, InfoPage, BottomNav, MapView, InfraOverlay, SelectedAptCard |
| 상세 | 14 | `detail/` | PriceTable, PriceChart, UnsoldChart, SchoolInfo, PresaleInfo, LoanAnalysis, LoanRatesSection, **DataSectionBlock**(공공데이터 섹션 1개=자체 접힘+자체 박스+부가블록 3종, 세션 408 D2a — 구 DataSections 해체), **CategoryMiniCard**(종합 탭 카테고리 요약 미니카드 — 점수+등급+결론 1줄[catVerdict]+탭하면 점수 탭 자동 펼침, 세션 409 D2b), HighlightField, InfrastructureSection, AdminScoreBreakdown, AdminUnitSupply, **AdminDataAudit**(138필드 표+관리자 완성도+fullFields 토글 — 세션 408. 세션 409 D2b 로 AdminScoreBreakdown·AdminUnitSupply 와 함께 관리자 탭[sec-admin]으로 이동) (관리자 인사이트 — 세션 405 전문가 대시보드 이식, adminLoggedIn 게이트+lazy) |
| 필터 | 7 | `filters/` | FilterButton, FilterDropdown, RegionPanel, BudgetPanel, AreaPanel, SortPanel, DetailPanel |
| 관리자 | 6 | `admin/` | AdminDashboard, AdminHelpGuide, AdminConsults, WeightEditor, WeightTable, ScoreBreakdownPreview (단, 세션138 이후 `admin/` 폴더에는 memo 아닌 StatsSection/UserCard/UserList 3개 추가 존재) |

> **전문가 그룹(`expert/` 9개)은 세션 405 에 폐지** — 자료는 상세 모달 관리자 인사이트(AdminScoreBreakdown·AdminUnitSupply·AdminDataAudit 138필드 표[세션 408 D2a 로 구 DataSections adminMode 분리])와 AdminConsults/AdminHelpGuide 로 이식. 결정 문서: `docs/superpowers/specs/2026-06-12-expert-role-abolition-decision.md` |
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

## 관리자 인사이트 규칙 (세션 405 — 구 전문가 페이지 규칙 승계)

- 모든 신규 블록은 `adminLoggedIn` 게이트 + lazy import — 소비자 화면/번들 영향 0 (게이트 가드 테스트 의무)
- 모든 138개 필드 개별 표시 필수 (AdminDataAudit, fieldMeta.ts 9섹션 합산: 21+12+18+33+10+10+4+11+19)
- 스코어링 중간 계산 과정 투명 표시 (AdminScoreBreakdown — 적정가 과정·기여도·가중 합계)
- catKeys는 `Object.keys(res.cats)` 동적 추출 (하드코딩 금지)

---

## 주요 컴포넌트 구조

### App.tsx (430줄, 2026-05-26 실측)

Hook + useMemo + 콜백 + 탭 라우팅 + isDesktop prop 스레딩 + trackEvent

### 섹션 컴포넌트 (`sections/`)

| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| HeaderSection | 166 | 데스크톱: 상단 바 60px / 모바일: 그라디언트 + HelpModal |
| SearchFilterBar | 196 | 드롭다운 오케스트레이터 (6개 FilterButton + 패널 + 칩 + undo) |
| AptListSection | 53 | 카드 그리드 (isDesktop 3컬럼/isPC 2컬럼) |
| MapView | ~240 | Kakao Map (마커+클러스터+현위치+인프라). M2 prop 3종: `height`(루트 높이 오버라이드)·`compact`(위젯 모드 — 컨트롤 숨김+휠줌 차단, 마운트 시 고정)·`onSelect`(선택 미러, ref 격리 — 마커 effect deps 추가 금지) |
| BottomNav | 36 | 하단 네비 (isDesktop → null) |

### 상세 컴포넌트 (`detail/`)

| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| DetailModal | ~370 | 모달 컨테이너 (isDesktop 760px, ARIA dialog). 세션 407 D1: 콘텐츠 교체 탭(activeTab+visited keepMounted, 관리자=전 패널 마운트) + CTA sticky bottom 바. 세션 408 D2a: 공공데이터 8섹션 주제별 탭 분산. **세션 409 D2b**: 종합 탭에 CategoryMiniCard 6개(점수+결론, 클릭 시 점수 탭 해당 카테고리 자동 펼침 — jumpSeqs[k] 단조 증가 key 로 1개만 리마운트). 관리자 인사이트 3종(AdminScoreBreakdown·AdminUnitSupply·AdminDataAudit)을 점수·분양 탭에서 **관리자 탭(sec-admin)**으로 분리 — sections useMemo 로 adminLoggedIn 시에만 7번째 탭 추가, 소비자는 6탭. CatPanel 은 점수 탭에서 순수 점수만 |
| PriceChart | 43 | 분양가 추이 SVG (usePriceHistory + siblingIds) |
| UnsoldChart | 45 | 미분양 추이 SVG (useUnsoldHistory + siblingIds) |
| PresaleInfo | 130 | 네이버 분양정보 (가격카드/일정/링크/Analytics) |
| DataSections | 152 | 공공데이터 6개 섹션 (세션143 HighlightField·InfrastructureSection 분리 후). adminMode prop = 관리자 138필드 전수 표 토글 + 관리자 기준 완성도 (세션 405) |
| AdminScoreBreakdown | 150 | 관리자: 적정가 산출 과정·가중치 기여도·최종 가중 합계·도시등급·인쇄 (구 ExpertScoreBreakdown+Summary 이식, 세션 405) |
| AdminUnitSupply | 76 | 관리자: 동/호수 3칸 + 청약홈 평형별 공급 표 (구 ExpertUnitPlaceholder 이식, usePresaleDetail units 유일 소비처) |

### 프리미티브 (`primitives.tsx`)

| 컴포넌트 | 역할 |
|---------|------|
| Bar | 수평 프로그레스 바 |
| ScoreBadge | 원형 점수 인디케이터 (SVG circle) |
| LineChart | 시계열 SVG 라인 차트 (다중 라인, 터치 툴팁 3초 auto-dismiss) |
| Radar | 6점 레이더 차트 |
| EmphasisBadge | 프로필 상위 카테고리 "★ 중점" 배지 (CatPanel·ExpertFieldTable 공용, `background?` 옵셔널) |

### AptCard (143줄)

- `isDesktop`: shadowMd, borderRadius 16, fontSize 16
- `isFav`: 관심매물 하이라이트 (border 색상)
- `moveInDone` (준공 + 미분양 0%): opacity 0.55
- alertRow 배지: 분양중/분양예정 + 입주상태 + 미분양 + 시공사신용 + 혐오시설

---

## 반응형 레이아웃

| 브레이크포인트 | 플래그 | 컨테이너 | 카드 그리드 | 네비게이션 |
|--------------|-------|---------|-----------|----------|
| <768px | 모바일 | 520px | 1컬럼 | 하단 BottomNav |
| 768~1023px | isPC | 960px | 2컬럼 (gap 16px) | 하단 BottomNav |
| 1024px+ | isDesktop | 1200px | 3컬럼 (gap 20px) | 상단 고정 바 60px |

- `useResponsive()` → `{ isPC, isDesktop }` (150ms 디바운스)
- isDesktop prop: App → HeaderSection, BottomNav, SearchFilterBar, AptListSection→AptCard, DetailModal, CompareSheet, MapView
- 롤백: useResponsive에서 `isDesktop: false` 고정 시 즉시 복원

## 데스크톱 키보드/테마

- 키보드 단축키: 1~5 프로필, Ctrl+Z undo, Ctrl+Shift+Z redo, Escape 모달닫기
- 헤더 화이트 테마: C.borderStrong("#D1D5DB"), 모바일 borderBottom 1.5px
