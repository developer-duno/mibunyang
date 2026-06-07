# 전문가 화면 StickyJumpNav (목차바) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전문가 대시보드(ExpertDashboard, 풀페이지)에 sticky 목차바를 추가해 10칩(요약 + FIELD_SECTIONS 9섹션)으로 섹션 점프 + active 전환 + 인쇄 숨김을 구현한다.

**Architecture:** 소비자 DetailModal 의 검증된 StickyJumpNav 컴포넌트를 재사용한다. 전문가 측엔 섹션 id 부착 + IntersectionObserver(active) + handleJump 통합 코드만 추가. 칩 목록은 FIELD_SECTIONS 에서 파생(drift 0). StickyJumpNav 에 인쇄 숨김용 optional prop 1개만 추가(소비자 영향 0).

**Tech Stack:** React 19, TypeScript(.tsx) + JSDoc(.jsx 테스트), Vitest(jsdom), Playwright e2e.

---

## 사전 확정 사실 (실측 완료 — 할루시네이션 방지 기준선)

| 항목 | 실측값 |
|---|---|
| 전문가 스크롤 컨테이너 | `ExpertDashboard.tsx:65` `<div data-print-content style={{ flex:1, overflowY:"auto", padding:... }}>` — **position 없음** → relative 추가 필요 |
| selectedItem 렌더 블록 | `ExpertDashboard.tsx:99-121` (`{selectedItem ? (<>...</>) : (...)}`) |
| 필드표 9섹션 | FIELD_SECTIONS(fieldMeta.ts:187-196): 개요/가격/안전/입지/상품성/혜택/미래/교차검증/분양. `ExpertDashboard.tsx:107` `FIELD_SECTIONS.map`, 2열 그리드(L106). ExpertFieldTable 빈 섹션도 항상 렌더 |
| 재사용 컴포넌트 | `StickyJumpNav.tsx` (JUMP_NAV_HEIGHT=44 L9, JumpSection 타입 L11 export, root div sticky top:0 L40-55) |
| 소비자 observer 패턴 | `DetailModal.tsx:134-156` (root=bodyRef, rootMargin `-44px 0px -55% 0px`, deps `[item?.apt.id, item]`) |
| 소비자 handleJump 패턴 | `DetailModal.tsx:161-168` (scrollTo `{top: Math.max(0, offsetTop-44), behavior:"smooth"}`, scrollTo 타입 가드, setActiveSection) |
| 기존 단위테스트 | `ExpertDashboard.test.jsx` (8 테스트, jsdom, makeScoredItem factory) — **보존 + 추가** |
| 소비자 단위테스트 mock | `DetailModal.test.jsx:150-213` (`HTMLElement.prototype.scrollTo = vi.fn()` + afterEach 복원, aria-current 단언) |
| 기존 e2e | `e2e/expert.spec.ts` (전문가 탭 클릭, 로그인 우회 없음), `e2e/detail-modal.spec.ts` (loginViaToken 헬퍼) |

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/components/detail/StickyJumpNav.tsx` | 목차바 컴포넌트 | Modify: optional `noPrint` prop 추가(root div 에 data-no-print 조건부) |
| `src/components/expert/ExpertDashboard.tsx` | 전문가 대시보드 | Modify: 칩 상수 + ref + observer + handleJump + 섹션 id wrapper + StickyJumpNav 렌더 |
| `src/components/expert/ExpertDashboard.test.jsx` | 단위테스트 | Modify: 점프 칩 테스트 추가(기존 8 보존) |
| `e2e/expert.spec.ts` | e2e | Modify: 전문가 로그인 우회 + 점프 테스트 추가(기존 보존) |

---

## Task 1: StickyJumpNav 에 noPrint optional prop 추가

**Files:**
- Modify: `src/components/detail/StickyJumpNav.tsx:13-19` (props 타입), `:39-55` (root div)
- Test: `src/components/detail/StickyJumpNav.test.tsx` (있으면 추가, 없으면 Task 3 단위테스트로 커버)

이유: 칩바를 `<div data-no-print>` 래퍼로 감싸면 래퍼가 sticky 컨텍스트를 가로채 칩바가 top:0 에 안 붙는다. StickyJumpNav root div 자체에 data-no-print 가 붙어야 sticky·인쇄 둘 다 안전.

- [ ] **Step 1: props 타입에 noPrint 추가**

`StickyJumpNav.tsx:13-19` 의 `StickyJumpNavProps` 타입에 한 줄 추가:

```tsx
type StickyJumpNavProps = {
  sections: JumpSection[];
  activeId: string | null;
  totalScore?: number | null;
  onJump: (_id: string) => void;
  isDesktop?: boolean;
  noPrint?: boolean;
};
```

- [ ] **Step 2: 구조분해에 noPrint 추가 + root div 에 조건부 data-no-print**

`:21-23` 구조분해 + `:40` root div 수정:

```tsx
export const StickyJumpNav = memo(function StickyJumpNav({
  sections, activeId, totalScore, onJump, isDesktop, noPrint,
}: StickyJumpNavProps) {
```

그리고 root `<div` (L40)에 `data-no-print` 속성 추가(noPrint true 일 때만):

```tsx
    <div
      {...(noPrint ? { "data-no-print": true } : {})}
      style={{
        position: "sticky",
        top: 0,
        // ...(기존 style 그대로)
```

- [ ] **Step 3: 타입체크로 회귀 0 확인**

Run: `npx tsc --noEmit 2>&1 | grep -E "StickyJumpNav|error TS"; echo "TSC_DONE"`
Expected: TSC_DONE (에러 0). 소비자 DetailModal 은 noPrint 미전달 → optional 이라 영향 0.

- [ ] **Step 4: 소비자 단위테스트 회귀 0 확인**

Run: `npx vitest run src/components/DetailModal.test.jsx 2>&1 | tail -5`
Expected: 모든 테스트 pass (noPrint 추가가 기존 동작 불변).

- [ ] **Step 5: Commit**

```bash
git add src/components/detail/StickyJumpNav.tsx
git commit -m "feat(detail): StickyJumpNav noPrint optional prop (전문가 인쇄 숨김용)"
```

---

## Task 2: ExpertDashboard 에 칩 상수 + 섹션 id wrapper + 점프 로직

**Files:**
- Modify: `src/components/expert/ExpertDashboard.tsx` — import(L1-16), 모듈 상수(L17 인근), 컴포넌트 본문(L19-44 hook 영역), 렌더(L65 컨테이너, L99-121 selectedItem 블록)

- [ ] **Step 1: import 추가**

`ExpertDashboard.tsx:1-3` 영역에 useRef 확인(이미 L1 에 useState/useMemo/useEffect/useCallback/memo import 중 — useRef 추가) + StickyJumpNav/JumpSection import:

```tsx
import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
// ...기존 import 들...
import { StickyJumpNav, JUMP_NAV_HEIGHT, type JumpSection } from "@/components/detail/StickyJumpNav";
```

- [ ] **Step 2: 칩 상수 추가 (모듈 레벨, FIELD_SECTIONS 파생)**

`ExpertDashboard.tsx:17` 의 `SEC_COLOR` 상수 아래에 추가:

```tsx
// 목차바 칩 = 요약 + FIELD_SECTIONS 9섹션 파생(하드코딩 금지 → 섹션 변경 시 자동 반영).
const EXPERT_JUMP_SECTIONS: JumpSection[] = [
  { id: "sec-summary", label: "요약" },
  ...FIELD_SECTIONS.map((s) => ({ id: `sec-${s.key}`, label: s.label })),
];
```

- [ ] **Step 3: ref + activeSection state 추가**

`ExpertDashboard.tsx:24` (`const { isPC } = useResponsive();`) 인근, hook 호출 영역에 추가:

```tsx
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState<string>(EXPERT_JUMP_SECTIONS[0].id);
```

- [ ] **Step 4: IntersectionObserver useEffect 추가 (소비자 패턴 답습)**

기존 useEffect(L28-33, sidebar Escape) 아래에 추가. deps = `[selectedId]` (단지 바뀌면 섹션 노드 재생성 → 재관찰):

```tsx
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !selectedItem) return;
    const els = EXPERT_JUMP_SECTIONS
      .map((s) => root.querySelector<HTMLElement>(`#${s.id}`))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0].target.id;
        if (id) setActiveSection(id);
      },
      { root, rootMargin: `-${JUMP_NAV_HEIGHT}px 0px -55% 0px`, threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [selectedId]);
```

주의: `selectedItem`/`selectedId` 는 L35-36 에서 정의되므로 이 useEffect 는 그 **아래**에 위치해야 TDZ 없음. (L35-36 보다 뒤에 배치)

- [ ] **Step 5: handleJump 추가 (소비자 패턴 답습)**

`handleSelect`(L39-42) 아래에 추가:

```tsx
  const handleJump = useCallback((id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`#${id}`);
    if (root && el && typeof root.scrollTo === "function") {
      root.scrollTo({ top: Math.max(0, el.offsetTop - JUMP_NAV_HEIGHT), behavior: "smooth" });
      setActiveSection(id);
    }
  }, []);
```

- [ ] **Step 6: 컨테이너에 ref + position:relative**

`ExpertDashboard.tsx:65` 수정:

```tsx
      <div ref={scrollRef} data-print-content style={{ flex: 1, overflowY: "auto", position: "relative", padding: isMobile ? "12px 14px" : "16px 20px" }}>
```

- [ ] **Step 7: StickyJumpNav 렌더 + 섹션 id wrapper 추가**

`ExpertDashboard.tsx:99-121` 의 `selectedItem ? (<>...</>)` 블록을 아래로 교체:

```tsx
        {selectedItem ? (
          <>
            <StickyJumpNav sections={EXPERT_JUMP_SECTIONS} activeId={activeSection}
              totalScore={selectedItem.res.total} onJump={handleJump} isDesktop={!isMobile} noPrint />

            <ExpertAptHeader apt={selectedItem.apt} res={selectedItem.res} />

            <div id="sec-summary">
              <ExpertScoreBreakdown apt={selectedItem.apt} res={selectedItem.res} profile={profile} />
              <ExpertScoreSummary res={selectedItem.res} profile={profile} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
              {FIELD_SECTIONS.map(sec => {
                const excl = sec.key === "가격" ? ["nearbyMedian","jeonseRate","pir","psr","dataReliability"]
                  : sec.key === "입지" ? ["hospital","conv","cafe","culture","bank","pharmacy"]
                  : sec.key === "안전" ? ["unsoldRate","recentTrades6m","supplyRatio","popGrowth"]
                  : undefined;
                return (
                  <div id={`sec-${sec.key}`} key={sec.key}>
                    <ExpertFieldTable apt={selectedItem.apt} fields={sec.fields} title={sec.label}
                      color={SEC_COLOR[sec.key] || C.indigo} exclude={excl} />
                  </div>
                );
              })}
            </div>

            <ExpertUnitPlaceholder apt={selectedItem.apt} />
            <ExpertDataCompleteness apt={selectedItem.apt} />
          </>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: F.base }}>좌측 사이드바에서 단지를 선택해주세요.</div>
        )}
```

주의(그리드 레이아웃 보존): `key={sec.key}` 가 ExpertFieldTable 에서 wrapper div 로 이동. wrapper div 가 그리드 셀이 되고 ExpertFieldTable(marginBottom:12 보유)은 그 자식 → 2열 그리드 정상. wrapper 에 별도 style 불필요(블록 요소 기본).

- [ ] **Step 8: 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep -E "ExpertDashboard|error TS"; echo "TSC_DONE"`
Expected: TSC_DONE (에러 0).

- [ ] **Step 9: Commit**

```bash
git add src/components/expert/ExpertDashboard.tsx
git commit -m "feat(expert): 대시보드 StickyJumpNav 목차바 — 요약+9섹션 점프"
```

---

## Task 3: ExpertDashboard 단위테스트 추가 (기존 8 보존)

**Files:**
- Modify: `src/components/expert/ExpertDashboard.test.jsx` (describe 블록 추가, 기존 8 테스트 보존)

소비자 `DetailModal.test.jsx:150-213` 패턴 답습.

- [ ] **Step 1: 파일 끝(L83 닫는 `});` 위)에 describe 블록 추가**

```jsx
describe("ExpertDashboard StickyJumpNav", () => {
  /** @returns {any} */
  const props = () => ({
    scored: makeScored(),
    profile: "live",
    setProfile: vi.fn(),
    expandedApt: null,
    setExpandedApt: vi.fn(),
    onSwitchToAdmin: null,
  });

  const origScrollTo = HTMLElement.prototype.scrollTo;
  afterEach(() => { HTMLElement.prototype.scrollTo = origScrollTo; });

  // 칩 10개 = 요약 + FIELD_SECTIONS 9섹션
  const CHIP_LABELS = ["요약", "단지 개요", "가격/시장 지표", "안전도/리스크", "입지/교통/교육/환경", "상품성/건축", "혜택/할인", "미래가치", "네이버 교차검증", "네이버 분양정보"];

  it("목차바 칩 10개(요약+9섹션)가 모두 렌더됨", () => {
    render(<ExpertDashboard {...props()} />);
    for (const label of CHIP_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("섹션 컨테이너(#sec-summary, #sec-가격 등)가 렌더됨", () => {
    const { container } = render(<ExpertDashboard {...props()} />);
    for (const id of ["sec-summary", "sec-개요", "sec-가격", "sec-안전", "sec-분양"]) {
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it("칩 클릭 시 컨테이너 scrollTo 호출 + active 전환", () => {
    const scrollToSpy = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToSpy;
    render(<ExpertDashboard {...props()} />);
    const chip = screen.getByRole("button", { name: "안전도/리스크" });
    fireEvent.click(chip);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    const arg = scrollToSpy.mock.calls[0][0];
    expect(typeof arg.top).toBe("number");
    expect(arg.behavior).toBe("smooth");
    expect(chip).toHaveAttribute("aria-current", "true");
  });

  it("scrollTo 미구현 환경에서도 칩 클릭 무에러", () => {
    HTMLElement.prototype.scrollTo = /** @type {any} */ (undefined);
    render(<ExpertDashboard {...props()} />);
    const chip = screen.getByRole("button", { name: "가격/시장 지표" });
    expect(() => fireEvent.click(chip)).not.toThrow();
  });
});
```

- [ ] **Step 2: import 에 afterEach 추가**

`ExpertDashboard.test.jsx:2` 의 vitest import 에 afterEach 추가:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
```

- [ ] **Step 3: 단위테스트 실행 (기존 8 + 신규 4 = 12 pass)**

Run: `npx vitest run src/components/expert/ExpertDashboard.test.jsx 2>&1 | tail -8`
Expected: 12 passed (기존 8 + 신규 4).

확정(실측): IntersectionObserver 전역 폴리필이 `src/__tests__/setup.js:34` 에 이미 존재(`if (!globalThis.IntersectionObserver) globalThis.IntersectionObserver = class {...}`), `vitest.config.ts:13 setupFiles` 로 전 테스트 주입 → useEffect 안 `new IntersectionObserver` throw 없음. 추가 mock 불필요. (소비자 DetailModal 점프 테스트가 통과하는 것과 동일 메커니즘.)

- [ ] **Step 4: Commit**

```bash
git add src/components/expert/ExpertDashboard.test.jsx
git commit -m "test(expert): StickyJumpNav 칩 렌더/점프/active 단위테스트"
```

---

## Task 4: e2e 점프 테스트 추가 (기존 expert.spec.ts 보존)

**Files:**
- Modify: `e2e/expert.spec.ts` (loginViaToken 헬퍼 + 점프 test 추가, 기존 2 test 보존)

`e2e/detail-modal.spec.ts` 의 loginViaToken + instant scrollTo 패치 패턴 답습.

- [ ] **Step 1: 파일 상단에 loginViaToken 헬퍼 추가 (detail-modal.spec.ts 에서 복사)**

`e2e/expert.spec.ts:1` import 를 수정 + 헬퍼 추가:

```ts
import { test, expect, type Page } from "@playwright/test";

async function loginViaToken(page: Page) {
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, email: "e2e@test.com", role: "expert" }, role: "expert" }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("expertToken", "e2e-test-token");
    localStorage.setItem("userRole", "expert");
  });
}
```

- [ ] **Step 2: 기존 describe 끝(L35 `});` 위)에 점프 test 추가**

```ts
  test("전문가 목차바 칩 클릭 시 섹션 노출 + 스크롤 + active", async ({ page }) => {
    await loginViaToken(page);
    await page.goto("/");

    // 전문가 로그인 시 대시보드(tab=expert) 자동 진입. 단지 미선택이면 "사이드바에서 단지를 선택" 안내.
    // scored 데이터(라이브 Supabase)가 있어야 단지 자동 선택 → 칩바 렌더.
    const summaryChip = page.getByRole("button", { name: "요약" });
    const hasChips = await summaryChip.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    if (!hasChips) {
      test.skip(true, "전문가 대시보드 칩 미렌더 — 빈 DB 또는 미진입");
      return;
    }

    const body = page.locator('[data-print-content]');
    await body.evaluate((el) => {
      const orig = el.scrollTo.bind(el);
      el.scrollTo = (opts?: ScrollToOptions | number, y?: number) => {
        if (opts && typeof opts === "object") orig({ top: opts.top, left: opts.left ?? 0 });
        else orig(opts as number, y as number);
      };
    });

    await expect(page.locator("#sec-분양")).not.toBeInViewport();
    const before = await body.evaluate((el) => el.scrollTop);
    const lastChip = page.getByRole("button", { name: "네이버 분양정보" });
    await lastChip.click();

    await expect(page.locator("#sec-분양")).toBeInViewport({ timeout: 4000 });
    await expect.poll(() => body.evaluate((el) => el.scrollTop), { timeout: 4000 }).toBeGreaterThan(before);
    await expect(lastChip).toHaveAttribute("aria-current", "true");
  });
```

주의: 전문가 로그인 시 App.tsx:121 `if (role === "expert") return "expert"` 로 초기 tab=expert. 소비자뷰 전환 불필요(소비자 detail 과 다름). 단지 자동 선택은 `selectedId = expandedApt || scored[0].apt.id`(ExpertDashboard.tsx:35).

- [ ] **Step 3: e2e 타입체크**

Run: `npm run typecheck:e2e 2>&1 | tail -5`
Expected: 에러 0.

- [ ] **Step 4: (선택) 로컬 e2e 실행 — 라이브 데이터 의존**

Run: `npx playwright test e2e/expert.spec.ts 2>&1 | tail -10`
Expected: 기존 2 + 신규 1 pass (또는 빈 DB 시 신규 1 skip). CI 가 최종 검증(VITE_USE_SUPABASE=true).

- [ ] **Step 5: Commit**

```bash
git add e2e/expert.spec.ts
git commit -m "test(expert): 목차바 칩 점프 e2e (로그인 우회 + instant 패치)"
```

---

## Task 5: 전체 회귀 가드 + PR

- [ ] **Step 1: 새 브랜치 생성 (main 직접 작업 금지)**

```bash
git checkout -b session382-expert-jumpnav
```
주의: Task 1~4 커밋이 이미 main 에 있다면 그 커밋들을 새 브랜치로 옮긴다(`git branch session382-expert-jumpnav` 를 Task 1 전에 만들어 두는 게 정석 — **실행 시 Task 1 Step 0 으로 브랜치 먼저 생성**).

- [ ] **Step 2: 전체 회귀 가드**

```bash
npx tsc --noEmit && echo TSC_OK
npm run lint 2>&1 | tail -3
npm run typecheck:e2e && echo E2E_TS_OK
npm test 2>&1 | tail -5
```
Expected: tsc 0 / lint 0 errors / e2e-ts 0 / vitest 전체 pass (기존 + 신규).

- [ ] **Step 3: push + PR (본문 파일 경유, 인라인 금지)**

PR 본문을 Write 로 임시 파일 저장 후 `gh pr create --body-file`. 임시 파일 삭제.

- [ ] **Step 4: CI(ci + e2e) green 확인**

`gh pr checks <PR#> --watch`. 특히 e2e 가 라이브 Supabase 에서 칩 점프 통과하는지 자연 검증.

---

## Self-Review

**1. Spec coverage:**
- 칩 10개(요약+9) → Task 2 Step 2 ✓ / 섹션 id 부착 → Task 2 Step 7 ✓ / position:relative → Task 2 Step 6 ✓ / observer active → Task 2 Step 4 ✓ / handleJump → Task 2 Step 5 ✓ / 인쇄 숨김(noPrint) → Task 1 ✓ / FIELD_SECTIONS 파생 drift 0 → Task 2 Step 2 ✓ / 단위테스트 → Task 3 ✓ / e2e → Task 4 ✓.
- spec 미해결 "그리드 셀 wrapper" → Task 2 Step 7 주의(wrapper 가 셀, ExpertFieldTable 자식, marginBottom 유지)로 확정. `display:contents` 미사용(offsetTop 정확성 위해).
- spec 미해결 "인쇄 래퍼" → Task 1 noPrint prop 으로 확정(래퍼 sticky 가로채기 회피).

**2. Placeholder scan:** 모든 코드 블록 실제 코드. "TBD/TODO/적절히" 없음. ✓

**3. Type consistency:** `EXPERT_JUMP_SECTIONS`(JumpSection[]), `scrollRef`(HTMLDivElement), `activeSection`(string), `handleJump(id: string)`, `noPrint?: boolean` — Task 간 일관. 칩 라벨(CHIP_LABELS Task3)은 FIELD_SECTIONS.label(fieldMeta.ts 실측: "단지 개요"/"가격/시장 지표"/...)과 정확히 일치. ✓

**4. 맹점 체크:**
- jsdom IntersectionObserver mock 유무 → Task 3 Step 3 주의로 사전 확인 의무(소비자 테스트 통과 = mock 존재 추정, 실행 시 grep 확정).
- main 직접 커밋 방지 → Task 5 Step 1(브랜치는 실행 시 Task 1 전에 생성).
- 소비자 회귀(noPrint optional) → Task 1 Step 4 로 검증.
- 그리드 레이아웃 깨짐 → Task 2 Step 7 주의 + Task 5 육안 검증.
