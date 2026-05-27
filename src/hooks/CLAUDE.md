# Hook 규칙

> App.tsx 및 커스텀 훅 수정 시 반드시 이 규칙을 따를 것.

## Hook 호출 순서 (App.tsx)

```
useState (4개: profile, customWeights, hideNoUnsold, tab) + useTransition (1개)
  → useCallback (setProfile, saveCustomWeights, toggleHideNoUnsold, closeDetail)
  → 커스텀 훅 13개 (useResponsive → useToast → ... → useShare)
  → useDataPipeline (useMemo 14개 + visibleCount + reset useEffect)
  → useLoginGate (state 3개 + callback 3개, onLoginRequired 참조 위해 Nav 앞에 배치)
  → useAppNavigation (useCallback 7개 + useRef 2개 + useEffect 2개)
  → useKakaoCallbackEffect (void, [tab] deps eslint-disable 유지)
  → useShareCallbacks (callback 3개 + scoredMapRef 내부 관리)
  → useKeyboardShortcuts (void, 데스크톱 가드)
  → 독립 useEffect 3개 (print CSS, URL 딥링크, 무효 ID 정리)
  → JSX
```

- 각 커스텀 훅 내부: useState → useRef → useCallback → useEffect 순서 보장
- React Rules of Hooks: 조건문 안에서 호출 금지, 순서 변경 금지
- **TDZ 방지**: 훅 매개변수가 해당 훅 호출 이전에 정의되어야 함 (Vite 빌드 const 재배열)
- **useLoginGate 위치**: `useAppNavigation`의 `onLoginRequired` 콜백이 `setLoginTrigger`/`setShowLoginPrompt`를 참조하므로 Nav **앞**에 호출

---

## useDataPipeline 구조

```
useDataPipeline({ apartments, profile, customWeights, ...필터상태, compIds, dataUpdatedAt })
  ├── SORTERS, VISIBLE_PAGE_SIZE (모듈 레벨 상수)
  ├── visibleCount: useState(VISIBLE_PAGE_SIZE)
  ├── useMemo 14개 (guOptions → catsCache → scored → filtered → visible 체인)
  ├── useEffect: filtered 변경 시 visibleCount 리셋
  └── return { guOptions, scored, filtered, visible, scoredMap, compItems, pw, ... }
```

### useMemo 의존성 배열

| useMemo | 의존성 | 절대 누락 금지 |
|---------|--------|--------------|
| guOptions | [filterRegion, apartments] | apartments는 API 데이터 |
| catsCache | [apartments] | apartments 의존 필수 |
| scored | [catsCache, profile, customWeights] | |
| baseFilterArgs | [showFavOnly, favoriteSet, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, minScore, benefitOnly] | 10개 |
| filtered | [scored, baseFilterArgs, filterRegion, filterGu, sortKey, moveInFilter, builderTier, hideNoUnsold] | |
| visible | [filtered, visibleCount] | |
| scoredMap | [scored] | Map (O(1) 조회) |
| compItems | [compIds, scoredMap] | |
| pw | [profile, customWeights] | customWeights 우선, PROFILES 폴백 |
| activeFilterCount | [showFavOnly, filterRegion, budgetMin, ...13개] | |
| regionOptions | [apartments] | |
| filterOptionCounts | [scored, baseFilterArgs, filterRegion, filterGu, moveInFilter, builderTier, hideNoUnsold] | leave-one-out |

---

## useAppNavigation 구조

```
useAppNavigation({ tab, setTab, expert, admin, consult, detail, compIds, ... })
  ├── useRef 2개 (consultRef, budgetRef — stale closure 방지)
  ├── useCallback 7개 (handleExpertLogin/Logout, switchTo*, handleNavClick ...)
  ├── useEffect: admin 동기화 (verify 실패 감지)
  ├── useEffect: 전문가 상담 목록 fetch
  └── return { handleExpertLogin, handleExpertLogout, switchTo*, handleNavClick }
```

---

## 파생 상태 규칙

```js
const showComp = showCompOpen && compIds.length >= 2;
```
별도 useState가 아닌 **파생 값**. useEffect로 동기화하지 말 것.

## 교차 관심사 해결 패턴

| 훅 | 패턴 | 설명 |
|----|------|------|
| useExpertMode.handleExpertLogin() | 반환값 | App에서 `if (success) setTab("expert")` |
| useExpertMode.handleExpertLogout(cb) | 콜백 파라미터 | App에서 탭/비교 초기화 전달 |
| useFilterSort({ onFilterChange }) | 콜백 옵션 | App에서 `() => setDetailAptId(null)` 전달 |

---

## 시계열 데이터 훅

| 훅 | 역할 | 구현 |
|----|------|------|
| useHistoryData(endpoint, aptId, siblingIds?) | 공통 시계열 페칭 | AbortController + retry + idsKey 직렬화 |
| usePriceHistory(aptId, siblingIds?) | 분양가 시계열 | `useHistoryData("/api/supabase/prices", ...)` |
| useUnsoldHistory(aptId, siblingIds?) | 미분양 추이 | `useHistoryData("/api/supabase/unsold-history", ...)` |

- `siblingIds?.length > 1`이면 `apartment_ids` 복수 조회
- **무한 루프 방지**: siblingIds 배열을 `idsKey = siblingIds.join(",")` 원시값으로 직렬화

## useComparison 구조

```
useComparison(showToast)
  ├── MAX_COMPARE = 4 (export 상수)
  ├── compIds: useState(localStorage 복원, slice(0, MAX_COMPARE))
  ├── showCompOpen: useState(false)
  ├── showComp = showCompOpen && compIds.length >= 2 (파생 상태)
  ├── toggleComp(id) — MAX_COMPARE 제한
  └── useEffect × 3 (mount 토스트, localStorage 동기화, 크로스탭 storage)
```

MAX_COMPARE 방어 4경로: 초기화 / toggleComp / URL딥링크(App.tsx) / 크로스탭storage

## useFavorites 구조 (v2 객체 기반)

```
useFavorites(showToast)
  ├── favoritesObj: { [id]: { memo, tags, addedAt } }
  ├── favoriteIds: Object.keys(favoritesObj) (파생 배열)
  ├── favoriteSet: new Set(favoriteIds) (O(1) 조회)
  ├── toggleFavorite(id)
  └── setFavoriteIds(idsOrFn) — 배열/함수 인자 지원
```

v1(배열) → v2(객체) 자동 마이그레이션. memo/tags UI는 제거됨 (내부 저장 구조만 유지).

## useResponsive 구조

```
useResponsive()
  ├── width: useState(window.innerWidth)
  ├── useEffect: resize 리스너 + 150ms 디바운스
  └── return { isPC: width >= 768, isDesktop: width >= 1024 }
```

롤백: `isDesktop: false` 고정 시 즉시 복원.

---

## React 성능 패턴

- useDeferredValue: 필터 5개 원시값 (filterRegion/filterGu/sortKey/moveInFilter/builderTier)
- useTransition: 정렬 변경 시 startSortTransition (useFilterSort.js)
- filterOptionCounts: 단일 패스 leave-one-out (5N→1N 최적화)
- AptListSection: IntersectionObserver 무한 스크롤 + "더 보기" 폴백
- App.tsx closeDetail 의존성: `[detail]` (React Compiler 호환)
