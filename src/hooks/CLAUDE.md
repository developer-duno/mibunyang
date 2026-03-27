# Hook 규칙

> App.jsx 및 커스텀 훅 수정 시 반드시 이 규칙을 따를 것.

## Hook 호출 순서

App.jsx 내부:
```
useState (4개: profile, customWeights, visibleCount, tab) + useTransition (1개) → useCallback → 커스텀 훅 12개 (useToast, useFavorites(showToast), useDetailModal, useFilterSort, useDebouncedValue, useComparison, useConsult, useExpertMode, useAdminMode, useApartmentData, useShare, useResponsive) → useMemo (13개: baseFilterArgs, activeFilterCount, filterOptionCounts 포함) → useEffect (6개) → useRef → useCallback
**useResponsive 위치**: line 69 (모든 useState 이후, useMemo 이전) → `{ isPC, isDesktop }` 반환 → isDesktop은 line 176+ JSX에서만 사용 (TDZ 안전)
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

## 세션19 추가 훅 (세션24 siblingIds 확장)

| 훅 | 역할 | 패턴 |
|----|------|------|
| usePriceHistory(apartmentId, siblingIds?) | 분양가 시계열 API 페칭 | AbortController + retry + idsKey 직렬화 |
| useUnsoldHistory(apartmentId, siblingIds?) | 미분양 추이 API 페칭 | AbortController + retry + idsKey 직렬화 |

- `siblingIds?.length > 1`이면 `apartment_ids` 복수 조회, 아니면 기존 `apartment_id` 단일 조회
- **무한 루프 방지**: `siblingIds` 배열을 `idsKey = siblingIds.join(",")` 원시값으로 직렬화하여 useCallback 의존성에 사용

## useComparison 구조 (세션20 — MAX_COMPARE 상수)

```
useComparison(showToast)
  ├── MAX_COMPARE = 4                             // export 상수
  ├── compIds: useState(localStorage → Array.isArray + slice(0, MAX_COMPARE))
  ├── showCompOpen: useState(false)
  ├── initCountRef: useRef(compIds.length)         // 복원 토스트용
  ├── showComp = showCompOpen && compIds.length >= 2  // 파생 상태
  ├── toggleComp(id)                               // MAX_COMPARE 제한
  ├── useEffect(mount-only) → "이전 비교 N개 복원됨" 토스트
  ├── useEffect(localStorage 동기화)
  └── useEffect(크로스탭 storage 이벤트 → Array.isArray + slice 방어)
```
MAX_COMPARE 방어 4경로: ①초기화 ②toggleComp ③URL딥링크(App.jsx) ④크로스탭storage

## useFavorites 구조 (v2 — 객체 기반)

```
useFavorites(showToast)
  ├── favoritesObj: { [id]: { memo, tags, addedAt } }  // 내부 상태 (객체, 저장소 호환용)
  ├── favoriteIds: Object.keys(favoritesObj)            // 파생 배열 (하위 호환)
  ├── toggleFavorite(id)
  └── setFavoriteIds(idsOrFn)  // 배열 또는 함수 인자 지원 (React setState 관례)
```
v1(배열) → v2(객체) 자동 마이그레이션 + `mibunyang_fav_backup` 백업.
**세션21**: memo/tags UI 제거됨 — App.jsx에서 `favoritesObj` 미사용 (내부 저장 구조만 유지).

## useResponsive 구조 (세션25 — 데스크톱 UI Phase1)

```
useResponsive()
  ├── width: useState(window.innerWidth)
  ├── useEffect: resize 리스너 + 150ms 디바운스 (setTimeout)
  ├── cleanup: clearTimeout + removeEventListener
  └── return { isPC: width >= 768, isDesktop: width >= 1024 }
```
- **디바운스 150ms**: resize 이벤트 초당 60~120회 → 6~7회로 감소
- **isDesktop prop 전달**: App → HeaderSection, BottomNav, SearchFilterBar, AptListSection → AptCard
- **isPC 하위 호환**: 기존 isPC 로직 100% 유지, isDesktop은 추가 분기
