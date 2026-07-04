# 필터 글래스 리디자인 — 설계서 (세션 481)

## Context (왜)

사장님 관찰: 필터 드롭다운(특히 정렬 17개·상세 4그룹)이 **세로로 길게 나열돼 공간 낭비**가 크고, 필터를 열면 **드롭다운이 단지 카드를 아래로 밀어냄**. 목업 반복 합의 끝에 방향 확정:

1. 드롭다운이 카드를 **밀지 않고 덮으며** 내려옴 (position:absolute 오버레이)
2. 드롭다운 배경 **65% 반투명 + 뒤 흐림(blur)** = 글래스 → 뒤 카드 비침
3. 뒤 카드에 살짝 어두운 막(scrim) + 뒤 클릭 시 닫힘
4. 상세 필터 = **소제목 색 라벨 + 2칸 그리드**(PC 2/모바일 1)
5. 정렬 17개 = 세로 나열 → **칩(flexWrap)**
6. 모양 통일 = 필터 칩·입력·카드 버튼·배지를 **살짝 둥근 사각(radius 토큰)** 으로
7. 컨트롤 높이 = **PC 32px 납작 / 모바일 36px 터치**
8. 글래스는 **"떠 있는 요소만"**(드롭다운) — 바탕 카드/본문은 불투명 유지(가독성·성능)

**범위 = 1단계(필터 개편)만.** 헤더·하단네비·모달 글래스 확대는 2단계(별 세션). 사장님 결정: "떠있는 요소만 글래스 / 필터부터 진짜 반영".

## 확정된 코드 구조 (직독)

| 파일 | 현황 |
|---|---|
| `src/components/filters/FilterDropdown.tsx` | L17-30 `<div>` **position 없음**(문서 흐름) → 카드 밀어냄. radius 10, marginTop 6, shadowMd |
| `src/components/filters/filterStyles.ts` | 필터 공통 스타일 단일 출처. numInput(r5), resetBtn(r5), chipStyle(r10) — **radius 제각각** |
| `src/components/filters/FilterButton.tsx` | 트리거. radius 6, height 36 |
| `src/components/filters/SortPanel.tsx` | `flexDirection:column gap:3` → 17개 세로. SORT_OPTIONS 재사용 가능 |
| `src/components/sections/SearchFilterBar.tsx` | FilterDropdown 들을 바 아래 렌더(L328~431). 바 = 그 위 div |
| `src/components/AptCard.tsx` | radius 제각각(infoTag 3·배지 4·6·버튼 8·카드 14/16) |
| `src/theme/index.ts` | **radius 토큰 없음** → 인라인 하드코딩 |

## 설계 (표현계층 전용 — 동작·데이터·점수·비로그인 무변경)

### A. radius 토큰 도입 (`src/theme/index.ts`)
통일의 열쇠. `C`/`F` 옆에 `R` 추가:
```ts
export const R = { chip: 7, btn: 8, panel: 10, badge: 6, card: 14 } as const;
```
→ filterStyles·FilterButton·SortPanel·DetailPanel·AptCard 가 이 토큰 참조 = 자동 통일.

### B. FilterDropdown 글래스 오버레이 (`FilterDropdown.tsx`)
```
- position: absolute; top/left/right (바 바로 아래); z-index 높게
- background: rgba(255,255,255,0.65) [다크: rgba(27,31,43,0.62)]
- backdropFilter: saturate(180%) blur(16px) (+ WebkitBackdropFilter)
- borderRadius: R.panel; boxShadow: shadowMd
- ⚠️ backdrop-filter 미지원 브라우저 폴백: @supports 없으면 background 불투명으로
```
+ 부모 바(SearchFilterBar 최상위 div)에 `position: relative` 기준점.
+ scrim: 드롭다운 열릴 때 카드 영역 위 `rgba(15,20,35,0.16)` 반투명 막(position absolute, 드롭다운 아래·카드 위 z-index), 클릭 시 closePanel. **SearchFilterBar 가 리스트 영역까지 안 감싸므로**, scrim 은 드롭다운 컨테이너 기준으로 배치하거나 App 리스트 래퍼에 조건부 렌더 — 구현 시 결정(아래 열린질문).

### C. 컨트롤 높이 토큰 (PC 32 / 모바일 36)
filterStyles 의 numInput/resetBtn + FilterButton + DetailPanel 버튼 + SortPanel 칩 height 를 `isDesktop ? 32 : 36` 로. (isDesktop prop 이미 대부분 전달됨)

### D. 정렬 칩화 (`SortPanel.tsx`)
`flexDirection:column gap:3` → `flexWrap:wrap gap:5`. 각 버튼 = 색 dot + 라벨 칩(radius R.chip, height 토큰). SORT_OPTIONS·onSortChange·onClose 무변경.

### E. 상세 소제목 색 (`DetailPanel.tsx` + `filterGroups.ts`)
세션 480 filterGroups.ts 에 그룹 색 필드 추가(traffic=blue·family=pink·money=indigo·safety=green). DetailPanel 소제목을 색 칩 라벨로, 버튼은 회색 통일(선택 시만 강조). 2칸 그리드는 세션 480에서 이미? → **확인 필요**(세션 480은 그룹화만, 2칸은 아닐 수 있음).

### F. 카드 버튼/배지 radius 통일 (`AptCard.tsx`)
버튼 radius→R.btn(8), 배지 radius→R.badge(6). **동작·색·조건 무변경, radius 값만 토큰 치환.**

## ⚠️ 열린 질문 (구현 전 확정)
1. **scrim 범위**: SearchFilterBar 가 카드 목록을 안 감싼다. scrim 을 (a)드롭다운 바로 아래만 (b)App 리스트 탭 전체에 조건부 오버레이. → App.tsx 구조 재확인 후 결정.
2. **backdrop-filter 폴백**: 저사양/미지원 시 불투명 배경. @supports 가드 필수.
3. **정렬 칩 "색"**: 17개 다 색 vs 선택된 것만 색. 목업은 "선택만 색". → 선택만 색으로.
4. **세션 480 상세 2칸 여부**: 이미 2칸이면 D는 소제목색만, 아니면 2칸+소제목색.

## 단계 분리 (한 PR에 다 넣지 않음)
- **PR1 (핵심)**: radius 토큰 + FilterDropdown 글래스 오버레이 + scrim + 높이 토큰. "투명 필터" 체감.
- **PR2**: 정렬 칩화 + 상세 소제목색(+2칸).
- **PR3**: 카드 버튼/배지 radius 통일.
→ 각 PR 독립 배포·롤백 가능. 회귀 위험 분산.

## 검증
- typecheck 0 · lint 0 · format · vitest(필터/카드 테스트) · vite build
- code-reviewer(표현계층 무변경 원칙)
- 라이브: 미분양아파트.com(퓨니코드 xn--hg3bi2ac4o1ig57cnoa.com) 에서 필터 열어 글래스·안밀림 확인 [[feedback-real-domain-not-vercel-app]]
- **모바일 성능**: 저사양 폰에서 스크롤 버벅 없나(글래스는 드롭다운 1개뿐이라 안전 예상)
