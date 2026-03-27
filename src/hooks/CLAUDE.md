# Hook 규칙

> App.jsx 및 커스텀 훅 수정 시 반드시 이 규칙을 따를 것.

## Hook 호출 순서

App.jsx 내부:
```
useState (4개: profile, customWeights, visibleCount, tab) + useTransition (1개) → useCallback → 커스텀 훅 12개 (useToast, useFavorites, useDetailModal, useFilterSort, useDebouncedValue, useComparison, useConsult, useExpertMode, useAdminMode, useApartmentData, useShare, useResponsive) → useMemo (12개: baseFilterArgs, activeFilterCount, filterOptionCounts 포함) → useEffect (6개) → useRef → useCallback
```
각 커스텀 훅 내부: useState → useRef → useCallback → useEffect 순서 보장.
React Rules of Hooks: 조건문 안에서 호출 금지, 순서 변경 금지.
**TDZ 방지**: 커스텀 훅 호출 시 매개변수가 반드시 해당 훅 호출 **이전에** 정의되어야 함. Vite production 빌드에서 const 재배열로 TDZ 에러 발생 (2eaac74).

## useMemo 의존성 배열 (App.jsx)

| useMemo | 의존성 | 절대 누락 금지 |
|---------|--------|--------------|
| guOptions | [filterRegion, apartments] | apartments는 API 데이터 |
| catsCache | [apartments] | apartments 의존 필수 |
| scored | [catsCache, profile, customWeights] | catsCache는 apartments 간접 의존 |
| baseFilterArgs | [showFavOnly, favoriteIds, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, minScore, benefitOnly, debouncedSearchText] | base 필터 상태 묶음 (11개) |
| filtered | [scored, baseFilterArgs, filterRegion, filterGu, sortKey, moveInFilter, builderTier] | SORTERS 모듈 레벨 상수 사용 |
| visible | [filtered, visibleCount] | 페이지네이션용 |
| scoredMap | [scored] | Map 자료구조 (P-3: O(1) 조회) |
| compItems | [compIds, scoredMap] | scoredMap.get() 사용 |
| pw | [profile, customWeights] | customWeights 우선, PROFILES[profile].w 폴백 |
| activeFilterCount | [showFavOnly, filterRegion, budgetMin, ...13개] | 활성 필터 개수 배지 |
| regionOptions | [apartments] | apartments 의존 필수 |
| filterOptionCounts | [scored, baseFilterArgs, filterRegion, filterGu, moveInFilter, builderTier] | leave-one-out 드롭다운 카운트 |

## showComp는 파생 상태

```js
const showComp = showCompOpen && compIds.length >= 2;
```
별도 useState가 아닌 **파생 값**. useEffect로 동기화하지 말 것.

## 교차 관심사 해결 패턴

| 훅 | 패턴 | 설명 |
|----|------|------|
| useExpertMode.handleExpertLogin() | `true`/`false` 반환 | App에서 `if (success) setTab("expert")` |
| useExpertMode.handleExpertLogout(onLogout) | 콜백 파라미터 | App에서 `() => { setTab("list"); setShowCompOpen(false); }` 전달 |
| useFilterSort({ onFilterChange }) | 콜백 옵션 | App에서 `() => setDetailAptId(null)` 전달 |
