# 프로필별 맞춤 섹션 강조 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로필 상위 2 카테고리에 해당하는 섹션을 "★ 중점" 배지 + 색 테두리로 강조한다(소비자 CatPanel + 전문가 칩/헤더). 순서는 고정.

**Architecture:** PROFILES 가중치에서 상위 2 카테고리를 공유 헬퍼 `getTopCats`로 자동 파생(drift 0). 소비자는 CatPanel(카테고리가 sec-score 안에 있음)에, 전문가는 섹션 칩+헤더(카테고리↔섹션 1:1)에 강조. 강조는 시각 추가만 — 순서·기존 동작 불변.

**Tech Stack:** React 19, TypeScript(.tsx) + JSDoc(.jsx 테스트), Vitest(jsdom).

---

## 사전 확정 사실 (워크플로 4차원 + 직접 실측)

| 항목 | 실측값 |
|---|---|
| 카테고리 6개 | engine.ts:108-115 — price/location/product/benefit/risk/future (key + label) |
| 카테고리↔전문가 섹션 1:1 | price↔가격, risk↔안전, location↔입지, product↔상품성, benefit↔혜택, future↔미래 (fieldMeta.ts:189-194). 개요/교차검증/분양 무대응 |
| 카테고리↔소비자 | sec-price↔price, sec-location↔location만. product/benefit/risk/future는 sec-score CatPanel×6(DetailModal.tsx:292)에만 |
| 프로필 타입 | App.tsx 는 `Profile`(types/scoring.ts:194 `"live"|"invest"|...`) 사용. profiles.ts:3 `ProfileKey` 도 동일 union(값 호환). **DetailModalProps 엔 App 과 일관되게 `Profile`(@/types/scoring) 사용.** **Category 는 profiles.ts:1 미export** → export 필요 |
| getTopCats | 신규 — 0점 제외 + 동점은 카테고리 선언 순서 |
| CatPanel | tsx:53 `{ cat, k }`, L61 외부 div border, L70-73 헤더 flex(cat.label+grade 배지). `catCol[k]`=카테고리 색 |
| CatPanelProps | CatPanel.tsx:9-12 |
| DetailModal profile | **미수신**. DetailModalProps(DetailModal.types.ts:14-23) + App.tsx:405 호출부 + DetailModal CatPanel 렌더(L292) |
| ExpertDashboard profile | 이미 수신(L26). EXPERT_JUMP_SECTIONS=모듈 상수(L21-24) → profile 의존 위해 컴포넌트 안 useMemo 이동 필요(L35/55/149 참조) |
| ExpertFieldTable | tsx:6 `{ apt, fields, title, color, exclude }`, L9 헤더 div title. Props=types/expert.ts:93 |
| StickyJumpNav 칩 | tsx:72-96 button. JumpSection 타입 L11 `{ id, label }` |
| 기존 테스트 | CatPanel.test.jsx(makeCat factory), ExpertDashboard.test.jsx(12), DetailModal.test.jsx, profiles.test.js — 전부 보존 |
| IntersectionObserver mock | setup.js:34 (jsdom 안전, 확인됨) |

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/constants/profiles.ts` | 프로필 가중치 + 헬퍼 | Category export + getTopCats 신규 |
| `src/components/CatPanel.tsx` | 소비자 카테고리 카드 | emphasized prop + 배지/테두리 |
| `src/components/DetailModal.tsx` | 소비자 모달 | profile 수신 + getTopCats + CatPanel emphasized 전달 |
| `src/types/components/DetailModal.types.ts` | 타입 | profile?: ProfileKey |
| `src/App.tsx` | 루트 | DetailModal 호출에 profile 전달 |
| `src/components/detail/StickyJumpNav.tsx` | 목차바 | JumpSection.highlighted + 칩 강조 스타일 |
| `src/components/expert/ExpertDashboard.tsx` | 전문가 대시보드 | EXPERT_JUMP_SECTIONS useMemo(profile) + CAT_TO_EXPERT_SECTION + ExpertFieldTable emphasized |
| `src/components/expert/ExpertFieldTable.tsx` | 전문가 필드표 | emphasized prop + 헤더 배지 |
| `src/types/expert.ts` | 타입 | ExpertFieldTableProps.emphasized |

---

## Task 0: 새 브랜치

- [ ] **Step 1: 브랜치 생성** (main 직접 작업 금지)

```bash
git checkout -b session382-profile-emphasis
```

---

## Task 1: getTopCats 공유 헬퍼

**Files:**
- Modify: `src/constants/profiles.ts:1` (Category export), 파일 끝 (헬퍼)
- Test: `src/constants/profiles.test.js` (기존 보존 + 추가)

- [ ] **Step 1: 실패 테스트 작성**

`profiles.test.js` 파일 끝에 추가 (기존 describe 보존):

```js
import { PROFILES, getTopCats } from "./profiles";

describe("getTopCats", () => {
  it("invest 상위 2 = price, risk", () => {
    expect(getTopCats(PROFILES.invest.w)).toEqual(["price", "risk"]);
  });
  it("edu 상위 2 = location, product", () => {
    expect(getTopCats(PROFILES.edu.w)).toEqual(["location", "product"]);
  });
  it("retire 는 future=0 제외 → location, product", () => {
    expect(getTopCats(PROFILES.retire.w)).toEqual(["location", "product"]);
  });
  it("동점(live: product/price=20)은 카테고리 선언 순서로 — location, product", () => {
    expect(getTopCats(PROFILES.live.w)).toEqual(["location", "product"]);
  });
  it("newlywed 동점(location/price=30) → location, price", () => {
    expect(getTopCats(PROFILES.newlywed.w)).toEqual(["location", "price"]);
  });
  it("n=3 도 동작", () => {
    expect(getTopCats(PROFILES.invest.w, 3)).toEqual(["price", "risk", "location"]);
  });
});
```

> 검증 근거(실측): invest w={location:15,product:10,price:30,risk:25,benefit:10,future:10} → price30>risk25>location15>... → [price,risk]. live w={location:40,product:20,price:20,...} → location40, 그다음 product=price=20 동점 → ORDER(location>product>price>...)로 product 먼저 → [location,product]. newlywed w={location:30,product:15,price:30,...} → location/price 동점 30, ORDER 로 location 먼저 → [location,price].

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/constants/profiles.test.js 2>&1 | tail -5`
Expected: FAIL ("getTopCats is not a function" 또는 import 에러).

- [ ] **Step 3: Category export + getTopCats 구현**

`src/constants/profiles.ts:1` 변경:
```ts
export type Category = "location" | "product" | "price" | "risk" | "benefit" | "future";
```

파일 끝에 추가:
```ts
const CAT_ORDER: Category[] = ["location", "product", "price", "risk", "benefit", "future"];

/** PROFILES 가중치에서 상위 N 카테고리 key. 0점 제외 + 동점은 CAT_ORDER(선언 순서). */
export function getTopCats(w: Record<Category, number>, n = 2): Category[] {
  return CAT_ORDER
    .filter((c) => w[c] > 0)
    .sort((a, b) => (w[b] - w[a]) || (CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b)))
    .slice(0, n);
}
```

> 동점 명시 정렬: `|| CAT_ORDER.indexOf...` 로 엔진 안정성 의존 제거(결정론).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/constants/profiles.test.js 2>&1 | tail -5`
Expected: PASS (기존 + 신규 6).

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep -E "profiles|error TS"; echo OK
git add src/constants/profiles.ts src/constants/profiles.test.js
git commit -m "feat(profiles): getTopCats 헬퍼 — 프로필 상위 N 카테고리 파생"
```

---

## Task 2: CatPanel emphasized (소비자 강조 단위)

**Files:**
- Modify: `src/components/CatPanel.tsx:9-12`(props), `:53`(시그니처), `:61`(테두리), `:70-73`(배지)
- Test: `src/components/CatPanel.test.jsx` (보존 + 추가)

- [ ] **Step 1: 실패 테스트 작성**

`CatPanel.test.jsx` 의 describe 끝(마지막 `});` 위)에 추가:

```jsx
  it("emphasized=true 면 '중점' 배지 표시", () => {
    render(<CatPanel cat={makeCat()} k="price" emphasized />);
    expect(screen.getByText(/중점/)).toBeInTheDocument();
  });
  it("emphasized 미전달이면 배지 없음(기존 동작 보존)", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    expect(screen.queryByText(/중점/)).toBeNull();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/CatPanel.test.jsx 2>&1 | tail -5`
Expected: FAIL (배지 텍스트 없음).

- [ ] **Step 3: 구현**

`CatPanel.tsx:9-12` props 타입:
```tsx
type CatPanelProps = {
  cat: Res;
  k: string;
  emphasized?: boolean;
};
```

`:53` 시그니처:
```tsx
export const CatPanel = memo(function CatPanel({ cat, k, emphasized }: CatPanelProps) {
```

`:61` 외부 div border 를 emphasized 분기 (col = `catCol[k]` 은 L55 에 이미 있음):
```tsx
    <div style={{ marginBottom: 12, background: C.bg, borderRadius: 10, padding: "10px 12px", border: emphasized ? `2px solid ${col}` : `1px solid ${C.border}` }}>
```

`:70-73` 헤더 flex 의 grade 배지(L72) 다음에 "★ 중점" 배지 추가:
```tsx
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>{cat.label}</span>
          <span style={{ fontSize: F.sm, fontWeight: 700, color: grade.c, background: grade.bg, padding: "2px 8px", borderRadius: 4 }}>{grade.l}</span>
          {emphasized && <span style={{ fontSize: F.xs, fontWeight: 700, color: col, background: C.bg, border: `1px solid ${col}`, padding: "2px 6px", borderRadius: 4 }}>★ 중점</span>}
        </div>
```

> 주의: `col` 은 L55 `const col = (catCol as Record<string,string>)[k]` 으로 이미 선언됨. emphasized 배지에 재사용.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/CatPanel.test.jsx 2>&1 | tail -5`
Expected: PASS (기존 + 신규 2).

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep -E "CatPanel|error TS"; echo OK
git add src/components/CatPanel.tsx src/components/CatPanel.test.jsx
git commit -m "feat(detail): CatPanel emphasized — ★ 중점 배지 + 색 테두리"
```

---

## Task 3: 소비자 profile 전달 + 강조 연결

**Files:**
- Modify: `src/types/components/DetailModal.types.ts:14-23`, `src/App.tsx:405`, `src/components/DetailModal.tsx`(시그니처 + L292)
- Test: `src/components/DetailModal.test.jsx` (보존 + 추가)

- [ ] **Step 1: 실패 테스트 작성**

`DetailModal.test.jsx` 의 적절한 describe 에 추가 (makeItem 으로 res.cats 주입 — 기존 헬퍼 사용):

```jsx
  it("profile='invest' 면 가격·안전 CatPanel 만 ★ 중점 배지", () => {
    render(<DetailModal item={makeItem()} onClose={() => {}} isComp={false} onComp={() => {}} isFav={false} onFav={() => {}} profile="invest" />);
    // sec-score 안 CatPanel — 가격(price)·안전(risk) 카드에 중점 배지, 나머지 4개엔 없음
    const badges = screen.getAllByText(/★ 중점/);
    expect(badges.length).toBe(2);
  });
```

> makeItem() 이 res.cats 6개를 만드는지 확인 후, 안 만들면 resOverrides 로 6 카테고리 주입. (factories.js makeScoredItem 이 cats 기본 제공 — DetailModal.test.jsx 의 makeItem 래퍼 확인하여 동일 패턴.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/DetailModal.test.jsx 2>&1 | tail -5`
Expected: FAIL (profile prop 없음 → 배지 0).

- [ ] **Step 3: 타입 + App + DetailModal 구현**

`DetailModal.types.ts:14-23` — import + 필드 추가 (App 과 일관되게 `Profile` from @/types/scoring):
```ts
import type { Profile } from "@/types/scoring";
// ... 인터페이스 안에:
  profile?: Profile;
```

`App.tsx:405` DetailModal 호출에 `profile={profile}` 추가:
```tsx
<DetailModal item={item} onClose={detail.handleCloseDetail} ... onConsult={handleConsultFromDetail} profile={profile} />
```
> App.tsx:47 `useState<Profile>` 와 동일 타입 → cast 없이 통과. getTopCats 는 `PROFILES[profile].w` 접근 — Profile=ProfileKey 동일 union 이라 인덱싱 통과(tsc 검증).

`DetailModal.tsx` 시그니처에 profile 추가 + import:
```tsx
import { PROFILES, getTopCats } from "@/constants/profiles";
// 시그니처: function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, onConsult, isPC, isDesktop, profile }) {
```

`DetailModal.tsx:292` CatPanel 렌더에 emphasized 전달 (item 이 있을 때만 실행되는 블록):
```tsx
{(() => {
  const topCats = profile ? getTopCats(PROFILES[profile].w) : [];
  return Object.entries(res.cats).map(([k, c]) => <CatPanel key={k} cat={c} k={k} emphasized={topCats.includes(k)} />);
})()}
```
> 또는 map 직전에 `const topCats = ...` 선언 후 `emphasized={(topCats as string[]).includes(k)}`. topCats 는 Category[] 라 includes(k:string) 타입 — `(topCats as string[]).includes(k)` cast 필요할 수 있음(tsc 로 확인).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/DetailModal.test.jsx 2>&1 | tail -5`
Expected: PASS (기존 + 신규 1).

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep -E "DetailModal|App|error TS"; echo OK
git add src/types/components/DetailModal.types.ts src/App.tsx src/components/DetailModal.tsx src/components/DetailModal.test.jsx
git commit -m "feat(detail): 소비자 상세 프로필 상위 2 카테고리 CatPanel 강조"
```

---

## Task 4: StickyJumpNav highlighted (전문가 칩 강조)

**Files:**
- Modify: `src/components/detail/StickyJumpNav.tsx:11`(타입), `:72-96`(칩 스타일)
- Test: Task 6(전문가)에서 통합 검증. 소비자 칩은 highlighted 미전달 → 영향 0.

- [ ] **Step 1: JumpSection 타입 + 칩 스타일**

`StickyJumpNav.tsx:11`:
```tsx
export type JumpSection = { id: string; label: string; highlighted?: boolean };
```

`:72-96` 칩 button — highlighted 시 테두리(isActive 아닐 때만, active 가 우선):
```tsx
        {sections.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              ref={isActive ? activeChipRef : undefined}
              onClick={() => onJump(s.id)}
              aria-current={isActive ? "true" : undefined}
              style={{
                flexShrink: 0,
                background: isActive ? C.blue : "transparent",
                color: isActive ? C.white : C.muted,
                border: !isActive && s.highlighted ? `1.5px solid ${C.blue}` : "1.5px solid transparent",
                borderRadius: 99,
                padding: "5px 12px",
                fontSize: F.sm,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background .15s, color .15s",
                minHeight: 30,
              }}
            >
              {s.label}
            </button>
```
> border 를 "none" → "1.5px solid transparent" 로 바꿔 highlighted 시 레이아웃 점프 없음(투명 테두리 기본). 소비자는 highlighted 미전달=undefined → transparent 유지(영향 0).

- [ ] **Step 2: 타입체크 + 소비자 회귀**

```bash
npx tsc --noEmit 2>&1 | grep -E "StickyJumpNav|error TS"; echo OK
npx vitest run src/components/DetailModal.test.jsx 2>&1 | tail -4
```
Expected: tsc 0 + DetailModal 테스트 pass (소비자 칩 동작 불변 — border transparent).

- [ ] **Step 3: 커밋**

```bash
git add src/components/detail/StickyJumpNav.tsx
git commit -m "feat(detail): StickyJumpNav highlighted — 칩 강조 테두리(전문가용)"
```

---

## Task 5: ExpertFieldTable emphasized (전문가 헤더 강조)

**Files:**
- Modify: `src/types/expert.ts:93`(props), `src/components/expert/ExpertFieldTable.tsx:6`(시그니처), `:9`(헤더 배지)
- Test: Task 6 통합 검증.

- [ ] **Step 1: Props 타입 + 시그니처 + 헤더 배지**

`src/types/expert.ts:93` ExpertFieldTableProps 에 추가:
```ts
export interface ExpertFieldTableProps {
  apt: Apt;
  fields: readonly string[];
  title: string;
  color?: string;
  exclude?: readonly string[];
  emphasized?: boolean;
}
```

`ExpertFieldTable.tsx:6` 시그니처:
```tsx
export const ExpertFieldTable = memo(function ExpertFieldTable({ apt, fields, title, color, exclude, emphasized }: ExpertFieldTableProps) {
```

`:9` 헤더 div — title 옆 배지(flex 로 감싸기):
```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: F.base, fontWeight: 800, color: color || C.indigo, marginBottom: 10, borderBottom: `2px solid ${color || C.indigo}`, paddingBottom: 6 }}>
        <span>{title}</span>
        {emphasized && <span style={{ fontSize: F.xs, fontWeight: 700, color: color || C.indigo, border: `1px solid ${color || C.indigo}`, padding: "2px 6px", borderRadius: 4 }}>★ 중점</span>}
      </div>
```

- [ ] **Step 2: 타입체크 + 전문가 회귀**

```bash
npx tsc --noEmit 2>&1 | grep -E "ExpertFieldTable|error TS"; echo OK
npx vitest run src/components/expert/ExpertFieldTable.test.jsx 2>&1 | tail -4
```
Expected: tsc 0 + 기존 테스트 pass (emphasized 미전달=배지 0).

- [ ] **Step 3: 커밋**

```bash
git add src/types/expert.ts src/components/expert/ExpertFieldTable.tsx
git commit -m "feat(expert): ExpertFieldTable emphasized — 헤더 ★ 중점 배지"
```

---

## Task 6: ExpertDashboard 강조 연결

**Files:**
- Modify: `src/components/expert/ExpertDashboard.tsx` — 모듈 상수→useMemo, CAT_TO_EXPERT_SECTION, 칩/섹션 emphasized
- Test: `src/components/expert/ExpertDashboard.test.jsx` (보존 + 추가)

- [ ] **Step 1: 실패 테스트 작성**

`ExpertDashboard.test.jsx` 의 StickyJumpNav describe 에 추가:

```jsx
  it("profile='invest' 면 가격·안전 섹션 헤더에 ★ 중점 배지", () => {
    render(<ExpertDashboard {...props()} profile="invest" />);
    const badges = screen.getAllByText(/★ 중점/);
    // 전문가 헤더 배지 = 가격(price) + 안전(risk) 2개 (칩 테두리는 텍스트 없음)
    expect(badges.length).toBe(2);
  });
```

> props() 헬퍼는 기존 테스트의 것 재사용. profile 을 override.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/expert/ExpertDashboard.test.jsx 2>&1 | tail -5`
Expected: FAIL (배지 0).

- [ ] **Step 3: 구현 — 모듈 상수를 정적/동적 분리**

`ExpertDashboard.tsx:21-24` 모듈 상수는 **정적 부분(id/label)** 유지, highlighted 는 컴포넌트 안 useMemo 로:

(a) 모듈 레벨 — CAT_TO_EXPERT_SECTION 추가 (SEC_COLOR 아래, L18 인근):
```tsx
// scoring 카테고리 key → 전문가 FIELD_SECTIONS key (1:1, fieldMeta 실측)
const CAT_TO_SECTION: Record<string, string> = { price: "가격", risk: "안전", location: "입지", product: "상품성", benefit: "혜택", future: "미래" };
```

(b) import 에 PROFILES, getTopCats, useMemo(이미 있음):
```tsx
import { PROFILES, getTopCats } from "@/constants/profiles";
```

(c) 컴포넌트 안 — 강조 섹션 key Set + 칩 목록 useMemo (selectedItem/selectedId 정의 뒤, observer 앞):
```tsx
  const emphasizedSectionKeys = useMemo(() => {
    const top = getTopCats(PROFILES[profile].w); // profile=ProfileKey
    return new Set(top.map((c) => CAT_TO_SECTION[c]).filter(Boolean));
  }, [profile]);

  const jumpSections = useMemo(
    () => EXPERT_JUMP_SECTIONS.map((s) => ({ ...s, highlighted: emphasizedSectionKeys.has(s.id.replace("sec-", "")) })),
    [emphasizedSectionKeys],
  );
```
> EXPERT_JUMP_SECTIONS(모듈 상수)는 id/label 만. jumpSections(useMemo)가 highlighted 부착. observer/active 초기값은 EXPERT_JUMP_SECTIONS[0].id 그대로(highlighted 무관).

(d) `:149` StickyJumpNav sections 를 jumpSections 로 교체:
```tsx
            <StickyJumpNav sections={jumpSections} activeId={activeSection}
              totalScore={selectedItem.res.total} onJump={handleJump} isDesktop={!isMobile} noPrint />
```

(e) `:167` ExpertFieldTable 에 emphasized 전달:
```tsx
                    <ExpertFieldTable apt={selectedItem.apt} fields={sec.fields} title={sec.label}
                      color={SEC_COLOR[sec.key] || C.indigo} exclude={excl} emphasized={emphasizedSectionKeys.has(sec.key)} />
```

> profile 타입: ExpertDashboardProps 의 profile 이 ProfileKey 호환인지 tsc 확인. PROFILES[profile] 접근이 통과해야.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/components/expert/ExpertDashboard.test.jsx 2>&1 | tail -5`
Expected: PASS (기존 12 + 신규 1 = 13).

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep -E "ExpertDashboard|error TS"; echo OK
git add src/components/expert/ExpertDashboard.tsx src/components/expert/ExpertDashboard.test.jsx
git commit -m "feat(expert): 대시보드 프로필 상위 2 카테고리 칩·헤더 강조"
```

---

## Task 7: 전체 회귀 + PR

- [ ] **Step 1: 전체 회귀 가드**

```bash
npx tsc --noEmit && echo TSC_OK
npm run lint 2>&1 | tail -3
npm run typecheck:e2e && echo E2E_TS_OK
npm test 2>&1 | tail -5
```
Expected: tsc 0 / lint 0 errors / e2e-ts 0 / vitest 전체 pass(기존 + 신규).

- [ ] **Step 2: push + PR (본문 파일 경유)**

PR 본문 Write → `gh pr create --body-file`. 임시 파일 삭제.

- [ ] **Step 3: CI green 확인**

`gh pr checks <PR#> --watch`.

---

## Self-Review

**1. Spec coverage:**
- getTopCats(0점 제외/동점) → Task 1 ✓ / 소비자 CatPanel 강조 → Task 2+3 ✓ / 전문가 칩 → Task 4+6 ✓ / 전문가 헤더 → Task 5+6 ✓ / drift 0(PROFILES 파생) → Task 1·6 ✓ / 순서 고정(시각만) → 전 Task ✓ / 기존 보존 → 각 Task 회귀 단계 ✓.

**2. Placeholder scan:** 모든 코드 블록 실제 코드. "TBD/적절히" 없음. tsc cast 필요 지점은 "tsc 로 확인" 명시(Task 3 topCats includes, Task 6 profile 타입). ✓

**3. Type consistency:**
- `getTopCats(w, n=2): Category[]` (Task1) ↔ 호출 Task3/6 일치.
- `emphasized?: boolean` (CatPanel Task2, ExpertFieldTable Task5) 일관.
- `highlighted?: boolean` (JumpSection Task4) ↔ jumpSections useMemo(Task6) 일치.
- `CAT_TO_SECTION` (Task6) key=카테고리, value=섹션 key — 실측 매핑 일치.
- 배지 텍스트 "★ 중점" — CatPanel(Task2)·ExpertFieldTable(Task5)·테스트 단언(Task3/6 `/★ 중점/`) 동일.

**4. 맹점 체크:**
- EXPERT_JUMP_SECTIONS 모듈 상수 → useMemo 분리(Task6): observer/active 초기값은 정적 상수 그대로, highlighted만 동적. observer deps 영향 0(id/label 불변).
- ProfileKey vs Profile 타입(App.tsx): Task3 Step3 에 tsc 검증 명시.
- topCats(Category[]).includes(k:string) 타입: Task3 cast 명시.
- 소비자 칩 border "none"→"transparent" 변경: 레이아웃 점프 0(Task4 주의).
- F.xs 폰트 존재 확인 필요(배지 크기) — theme 에 F.xs 있음(기존 코드 사용 중, ExpertDashboard.tsx 다수).
