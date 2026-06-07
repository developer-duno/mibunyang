# 프로필별 맞춤 섹션 강조 — 설계

> 작성 2026-06-07 (세션 382). 소비자 DetailModal + 전문가 ExpertDashboard 공통.

## Context (왜)

이 프로젝트의 본질은 "같은 단지여도 5개 프로필(실거주·투자·신혼부부·자녀교육·은퇴)마다 다른 점수"다.
PROFILES 가중치(profiles.ts)를 보면 프로필마다 중시하는 카테고리가 확연히 다르다:

| 프로필 | 상위 2 카테고리 (가중치) |
|---|---|
| 실거주(live) | location 40, product 20 |
| 투자(invest) | price 30, risk 25 |
| 신혼부부(newlywed) | location 30, price 30 |
| 자녀교육(edu) | location 45, product 20 |
| 은퇴(retire) | location 35, product 25 |

그런데 상세/전문가 화면은 **모든 프로필에 동일한 순서·동일한 시각**으로 섹션을 보여준다. 투자자에게도
입지가 시세·안전보다 먼저 보이는 식 — 맞춤이 아니다. 이 작업은 **프로필 상위 2 카테고리에 해당하는
섹션을 "맞춤 강조"**해, 사용자가 자기 관점에서 중요한 정보를 먼저 알아채게 한다.

## 결정 (사장님 위임 → 실증 근거로 확정)

**강조 방식 = 배지 + 색 테두리. 순서는 고정.** (순서 재배열 아님)

근거:
1. **사용자 편의(위치 학습성)**: 목차바/섹션은 빠른 탐색 도구. 칩·섹션 순서가 프로필마다 바뀌면 위치를
   못 외워 오히려 느려진다. 순서 고정 + 강조가 탐색 도구 본질을 지킨다.
2. **데이터 관리(drift 0)**: 강조 대상을 PROFILES 가중치에서 **자동 파생**(상위 2 카테고리) → 미래에
   가중치가 바뀌어도 강조가 자동 반영. 별도 우선순위 테이블 손관리 불필요.
3. **회귀 안전**: 13블록(소비자)/9섹션(전문가) 물리 순서를 안 건드림.

**적용 범위 = 소비자 + 전문가 둘 다.** 단 구조가 달라 강조 단위가 다르다(아래).

## 실측 확정 사실 (워크플로 4차원 + 직접 교차검증 — 할루시네이션 0)

### 카테고리 ↔ 화면 매핑

- **scoring 카테고리 6개**(engine.ts:108-115): price/location/product/benefit/risk/future. key + 한글 label + SHORT_LABEL(theme/index.ts:34) 확정.
- **전문가 FIELD_SECTIONS 9개 중 6개가 카테고리와 1:1**(fieldMeta.ts:187-196): price↔가격, risk↔안전, location↔입지, product↔상품성, benefit↔혜택, future↔미래. (개요/교차검증/분양은 카테고리 무대응.) 섹션 id = `sec-${key}`, SEC_COLOR(ExpertDashboard.tsx:18)에 6개 색 이미 정의.
- **소비자 6섹션은 비대칭**(DetailModal.tsx:23-30): sec-price↔price, sec-location↔location만 직접 대응. **product/benefit/risk/future는 sec-score 섹션 안 CatPanel×6**(L292)에만 존재. → 소비자 강조 단위 = **CatPanel 카드**(카테고리가 거기 있으므로).

### 상위 2 카테고리 추출 (공유 헬퍼)

`getTopCats(w, n=2)` 신규 — PROFILES 가중치 객체에서 상위 N 카테고리 key 반환.
- **0점 제외**: retire의 future=0 같은 0 가중치는 제외.
- **동점 처리**: 카테고리 선언 순서(location>product>price>risk>benefit>future, profiles.ts Category 타입 순서)로 안정 정렬. → 결정론적(테스트 가능).
- 위치: `src/constants/profiles.ts`에 export (PROFILES와 같은 파일, 단일 출처).

### profile 전달 경로

- **전문가 ExpertDashboard**: 이미 profile prop 수신(L26). 추가 전달 0.
- **소비자 DetailModal**: profile **미수신**. 4단계 추가 필요 —
  (1) `DetailModalProps`에 `profile?: ProfileKey` (DetailModal.types.ts:14-23)
  (2) App.tsx L405 호출부에 `profile={profile}` 1줄
  (3) DetailModal에서 CatPanel에 전달
  (4) `CatPanelProps`에 `emphasized?: boolean` (CatPanel.tsx:9-12)

## 아키텍처

### 공유 헬퍼 (drift 0의 핵심)
`src/constants/profiles.ts`:
```ts
export function getTopCats(w: Record<Category, number>, n = 2): Category[] {
  const ORDER: Category[] = ["location", "product", "price", "risk", "benefit", "future"];
  return ORDER
    .filter((c) => w[c] > 0)
    .sort((a, b) => w[b] - w[a])   // 동점이면 ORDER(=filter 전 순서)가 안정적으로 유지됨
    .slice(0, n);
}
```
> 주의: JS sort 안정성 — 동점일 때 입력 순서 유지. ORDER 순서로 먼저 깔고 sort 하면 동점은 ORDER 우선. 단 일부 엔진 안정성 의존 회피 위해 `(a,b) => w[b]-w[a] || ORDER.indexOf(a)-ORDER.indexOf(b)` 명시 권장.

### 소비자 (CatPanel 강조)
- CatPanel에 `emphasized?: boolean` prop. true면 카드 헤더(cat.label 옆)에 "내 관점 중요" 배지 + 카드 테두리 강조색.
- DetailModal: profile 수신 → `const top = getTopCats(PROFILES[profile].w)` → `<CatPanel ... emphasized={top.includes(k)} />`.
- profile 없을 때(기존 호출 호환): emphasized 미전달 = 강조 0 (기존 동작 보존).

### 전문가 (섹션 칩 + 헤더 강조)
- `JumpSection` 타입에 `highlighted?: boolean` 추가(StickyJumpNav.tsx:11). 칩 렌더에 highlighted 스타일 분기(테두리/배경).
- ExpertDashboard: `EXPERT_JUMP_SECTIONS`를 profile 따라 useMemo 재계산 — 상위 2 카테고리의 `sec-${key}`에 highlighted=true.
- ExpertFieldTable 헤더(title 옆)에 강조 배지: 새 optional prop `emphasized?: boolean`.
- 카테고리 key → 전문가 섹션 key 매핑: price→가격, risk→안전, location→입지, product→상품성, benefit→혜택, future→미래 (상수 `CAT_TO_EXPERT_SECTION`).

### 강조 배지 문구
- 짧게: "내 관점 ★" 또는 프로필명 활용 "투자 중점". → **"★ 중점"**(프로필 무관 짧은 라벨, 색으로 구분). 칩엔 테두리만(공간 좁음).

## 컴포넌트별 변경 요약

| 파일 | 변경 |
|---|---|
| `src/constants/profiles.ts` | `getTopCats` 헬퍼 export + Category export |
| `src/components/CatPanel.tsx` | `emphasized?: boolean` prop + 헤더 배지/테두리 |
| `src/components/DetailModal.tsx` | profile 수신 + getTopCats + CatPanel emphasized 전달 |
| `src/types/components/DetailModal.types.ts` | `profile?: ProfileKey` 추가 |
| `src/App.tsx` | L405 `<DetailModal ... profile={profile} />` |
| `src/components/detail/StickyJumpNav.tsx` | `JumpSection.highlighted?` + 칩 강조 스타일 |
| `src/components/expert/ExpertDashboard.tsx` | EXPERT_JUMP_SECTIONS useMemo(profile) + CAT_TO_EXPERT_SECTION + ExpertFieldTable emphasized |
| `src/components/expert/ExpertFieldTable.tsx` | `emphasized?: boolean` + 헤더 배지 |

## 테스트

- **getTopCats 단위**(profiles.test.js): 5 프로필 각 상위 2 (invest→[price,risk], retire→future 제외, 동점 결정론).
- **CatPanel 단위**(CatPanel.test.jsx 보존+추가): emphasized=true 시 배지 렌더, false/미전달 시 없음.
- **DetailModal 단위**: profile 주입 시 상위 2 카테고리 CatPanel만 강조.
- **ExpertDashboard 단위**(보존+추가): profile별 highlighted 칩 + 섹션 헤더 배지. profile 바꾸면 강조 이동.
- **회귀 보존**: 기존 StickyJumpNav 칩 10개, 6섹션/13블록, CatPanel 토글 테스트 무수정.

## 검증 (end-to-end)
- tsc 0 / lint 0 errors / vitest 전체 pass / e2e 영향 없음(강조는 시각 추가, 기존 셀렉터 불변).
- dev 서버: 프로필 전환 시 소비자 CatPanel + 전문가 칩/헤더 강조가 이동하는지 육안 확인.

## 범위 밖
- 섹션/칩 순서 재배열 (위치 학습성 위해 의도적 제외).
- scoring 로직·가중치 변경.
- 개요/교차검증/분양(카테고리 무대응 섹션) 강조.
