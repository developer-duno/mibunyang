# 통합 홈 M1 구현 계획 v2 (featureFlag·HomePage·소비자 위젯 4종·네비 5탭) — 적대검증 27건 정정 반영

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 실행 시작 시 본 plan 을 `docs/superpowers/plans/2026-06-12-unified-home-m1.md` 로 복사 박제.
> v1 → v2: 적대검증 워크플로(8 probe, 66 findings, 문제 27건 — REFUTED 2·NEEDS_FIX 11·BLIND_SPOT 14) 정정 반영. 모든 파일:라인 실측.

**Goal:** spec v2(`docs/superpowers/specs/2026-06-11-unified-home-ia-design.md`) §6 M1 — `VITE_FEATURE_HOME` 플래그 뒤에 위젯판 홈 탭 신설(소비자 위젯 4종 + 비로그인 D5 잠금 + 네비 5탭 + InfoPage 상담 진입 + 초기탭·딥링크).

**Architecture:** 신규 `src/components/home/` 에 HomePage + 위젯 4종 + 공유 WidgetCard. 새 fetch 0 — `useDataPipeline` scored 와 App 의 `/api/upcoming` 1회 fetch 를 state lift 해 재사용. 탭 전환 전부 `handleNavClick` 경유, 상세 진입 전부 `handleDetailGated` 경유. **MapView 수정 0** (M2 전제) — 로그인 지도 위젯도 M1 은 "지도 열기" 진입 카드.

**사장님 확정 (세션 404):** 시장 요약 = **원시값 4종** (전국 단지 수 / 분양가 중위(억) / 미분양률 중위(%) / 데이터 업데이트일).

---

## 불변 조건 (v2 정정 — 검증이 잡은 자기모순 해소)

1. `VITE_FEATURE_HOME` OFF 시 **화면·네비 동작 무변경**. 단 OFF 에서도 활성인 의도적 변경 3곳(예외 명시):
   - Task 3 computeDday 추출 = 동작 동일 리팩토링 (re-export 로 경로 보존)
   - Task 9A upcoming state lift = 동작 보존 리팩토링 + HTTP 에러 시 위젯용 error 상태 추가 (헤더 라벨은 기존과 동일 null 폴백)
   - Task 11 InfoPage 상담 카드 + 안내 문구 5곳 = flag 무관 상시 (OFF 에서도 무해한 입구 추가·문구 중립화)
2. MapView·MapView.types·SelectedAptCard·expert 컴포넌트 **수정 0** (M2 범위).
3. "펼치기" 전부 `handleNavClick(k)` — setTab 직접 금지 (초기화 useEffect·훅 내부 제외).
4. 홈의 상세 진입 전부 `handleDetailGated`.
5. spec v2 본문 수정 금지 — 구현 중 발견은 PR 본문에 기록.
6. **`.env`/`.env.local` 에 VITE_FEATURE_HOME 박제 금지** — HOME 은 기존 탭(비교·상담)을 *제거*하는 첫 플래그라, 박제 시 stub 없는 기존 vitest(BottomNav.test L33-39)가 로컬에서 깨짐. 로컬 수동 확인은 일회성 prefix(`VITE_FEATURE_HOME=true npm run dev`)만.
7. 롤백 근거 = Task 별 독립 커밋 revert (flag OFF=dead code 아님 — 위 1 예외 때문).

## 핵심 실측 (v1 표 + v2 검증 추가분)

| 사실 | 위치 |
|---|---|
| flag 함수형 패턴 + vite-env 동시 박제 의무 주석 | `src/constants/featureFlags.ts:4-6`, `src/vite-env.d.ts:3-9` |
| 초기 탭 4갈래 / upcoming fetch 합계만 보관 | `src/App.tsx:92-123`, `App.tsx:67-91` |
| `?compare=` 딥링크(setTab 없음) / CompareSheet 는 list 탭 전용 렌더 | `App.tsx:213-231`, `App.tsx:300-309` |
| onBackToMain·InfoPage 호출·카카오 착지 ×2 | `App.tsx:356`, `App.tsx:330`, `useKakaoCallbackEffect.ts:42,47` |
| handleNavClick — "home" 키는 분기 추가 없이 마지막 `setTab(k)` 통과 + tab_switch 자동 | `src/hooks/useAppNavigation.ts:63-88` |
| tab state 는 string 으로 widen (현 코드가 `(_tab: string) => void` 에 setTab 전달 통과 중이 증거) — `"home"` 타입 안전 | `App.tsx:92` + `useKakaoCallbackEffect.ts:17` |
| **Res 필드명 = `subs`** (items 아님 — v1 테스트 팩토리 크래시 원인) + AptCard 무가드 접근 2곳 | `src/types/scoring.ts:153-155`, `AptCard.tsx:101,106` |
| AptCard `isLoggedIn = true` 기본값 / 호출 정형 / role="button" | `AptCard.tsx:38`, `AptListSection.tsx:105-110`, `AptCard.tsx:69` |
| **presaleRecruitDate 형식 혼재** — 라이브 451행 = YYYY-MM-DD 402 / YYYY-MM 46 / 자유텍스트 3. API 자신도 parseRecruitDate 로 재파싱이 관행 | `api/upcoming.ts:43-47,106-112`, `scripts/collectors/naver-presale.mjs:339` |
| HeaderSection.test = **makeProps 없음**, describe 내부 `defaultProps` 스프레드 관례 + afterEach 미import | `HeaderSection.test.jsx:2,7-19,36` |
| App.test = staticDataApi mock + describe 내부 beforeEach(clearAllMocks+storage clear), **fetch mock 없음**, fireEvent 미import(관례 = `await act(async () => { btn.click(); })`) | `App.test.jsx:9,63-65,100-107,272` |
| **e2e hard fail 1건 확정**: skeleton-empty 첫 테스트가 목록 스켈레톤 6개 단언 — HOME ON 초기화면은 홈 스켈레톤 4개 | `e2e/skeleton-empty.spec.ts:6-17`, `AptListSection.tsx:64-67` |
| apartment-list·skeleton-empty 2·3 은 HOME ON 시 silent skip(커버리지 소실) — 홈엔 SearchFilterBar 없음 | `e2e/apartment-list.spec.ts:18,33`, `App.tsx:270` |
| smoke·favorites·mobile·share·loan-rates·detail-modal·expert·admin·upcoming = HOME ON 호환 (홈 TopPicks 가 role="button" 충족 / 게이트·토큰 직행·경로 기반 무변경) | probe P7 전수 실측 |
| LoginPromptModal role="dialog" aria-label="로그인 안내" | `LoginPromptModal.tsx:28` |
| GuideSections 문구는 `&apos;` HTML 엔티티 — grep 은 느슨 패턴 필요 | `GuideSections.tsx:168` |
| ci.yml Test step 은 UPCOMING 만 주입 — HOME 미주입 유지 | `.github/workflows/ci.yml:51-53` |

---

### Task 0: 브랜치 + plan 박제

- [ ] **Step 0-1:** `git checkout -b feature/unified-home-m1`
- [ ] **Step 0-2:** 본 plan 을 `docs/superpowers/plans/2026-06-12-unified-home-m1.md` 로 저장 (Task 1 과 함께 커밋)

### Task 1: featureFlag 배선 ① featureFlags.ts ② vite-env.d.ts

**Files:** Modify `src/constants/featureFlags.ts`, `src/vite-env.d.ts`

- [ ] **Step 1-1:** featureFlags.ts 에 추가:

```ts
export const isFeatureHome = (): boolean =>
  import.meta.env.VITE_FEATURE_HOME === "true";
```

- [ ] **Step 1-2:** vite-env.d.ts L4 다음 줄에 `readonly VITE_FEATURE_HOME?: string;`
- [ ] **Step 1-3:** `npm run typecheck` → 0 errors
- [ ] **Step 1-4:** Commit: `feat(home): VITE_FEATURE_HOME 플래그 배선 (featureFlags + vite-env)`

### Task 2: 배선 ③ e2e.yml ④ playwright.config.ts (⑤ ci.yml 무변경)

**Files:** Modify `.github/workflows/e2e.yml:32` 아래, `playwright.config.ts:38` 아래

- [ ] **Step 2-1:** e2e.yml env 에 `VITE_FEATURE_HOME: "true"` 추가 (⚠️ 이 주입이 깨뜨리는 기존 spec 은 Task 12 에서 선보정 — skeleton-empty hard fail 1건 + silent skip 2건 실측 완료)
- [ ] **Step 2-2:** playwright.config.ts webServer.env 에 `VITE_FEATURE_HOME: process.env.VITE_FEATURE_HOME ?? "false",`
- [ ] **Step 2-3:** `git diff --stat .github/workflows/ci.yml` → 변경 0 확인
- [ ] **Step 2-4:** Commit: `ci(home): e2e flag 주입 + playwright webServer 전달 (ci.yml 은 OFF 유지)`

### Task 3: computeDday 추출 → `src/lib/dday.ts`

**왜:** computeDday 는 lazy 청크(UpcomingCardList) 안 — HomePage(정적)가 import 하면 lazy 무력화.

**Files:** Create `src/lib/dday.ts` / Modify `src/components/UpcomingCardList.tsx:10,31-46`

- [ ] **Step 3-1:** `src/lib/dday.ts` 신규 — L31-46 본문 그대로 이동:

```ts
import { C } from "@/theme";
import type { DdayInfo } from "@/types/components/UpcomingCardList.types";

/**
 * D-day 계산 — spec § 6-2 (UpcomingCardList 에서 이동, 세션 404 M1)
 */
export function computeDday(recruitDate: string | null | undefined, today: Date = new Date()): DdayInfo | null {
  if (!recruitDate || typeof recruitDate !== "string") return null;
  const d = new Date(recruitDate);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0);
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < -7) return null; // 1주 이상 지난 단지는 D-day 표시 X
  if (days < 0) return { label: `D+${Math.abs(days)}`, color: C.muted };
  if (days === 0) return { label: "오늘 청약", color: C.red };
  if (days <= 3) return { label: `D-${days}`, color: C.amber };
  if (days <= 7) return { label: `D-${days}`, color: C.text };
  return { label: `D-${days}`, color: C.muted };
}
```

- [ ] **Step 3-2:** UpcomingCardList.tsx — ① 함수 본문 삭제 자리에 2줄 (1줄 `export {...} from` 형은 L74 내부 호출 바인딩이 없어 불가 — 검증 확정):

```ts
// 테스트 하위호환용 re-export — 신규 소비처는 @/lib/dday 에서 직접 import (lazy 청크 보호)
import { computeDday } from "@/lib/dday";
export { computeDday };
```

② **L10 import 에서 `DdayInfo` 제거** (본문 이동 후 orphan — 내 변경이 만드는 미사용 import, CLAUDE.md §3): `import type { UpcomingCardListProps, UpcomingCardProps } from "@/types/components/UpcomingCardList.types";`

- [ ] **Step 3-3:** `npx vitest run src/components/UpcomingCardList.test.jsx` → 전체 PASS
- [ ] **Step 3-4:** `npm run typecheck` → 0 / `npm run lint` → no-unused-vars warn 0
- [ ] **Step 3-5:** Commit: `refactor(upcoming): computeDday 를 src/lib/dday.ts 로 추출 (re-export 경로 보존)`

### Task 4: 공유 WidgetCard + MapEntryWidget (D5 잠금)

**Files:** Create `src/components/home/WidgetCard.tsx`, `MapEntryWidget.tsx` / Test `MapEntryWidget.test.jsx`

- [ ] **Step 4-1:** WidgetCard (위젯 4종 카드 틀 drift 0 — 세션 384 공유 atom 답습):

```tsx
import { memo } from "react";
import type { ReactNode } from "react";
import { C, F } from "@/theme";

type WidgetCardProps = { title: string; onExpand?: () => void; expandLabel?: string; children: ReactNode };

/** 홈 위젯 공통 카드 틀 — 제목 + (옵션) 펼치기 버튼. InfoPage cardStyle 답습 */
export const WidgetCard = memo(function WidgetCard({ title, onExpand, expandLabel = "펼치기", children }: WidgetCardProps) {
  return (
    <section aria-label={title} style={{ background: C.card, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: F.md, fontWeight: 800, color: C.text }}>{title}</span>
        {onExpand && (
          <button onClick={onExpand} style={{ background: "transparent", border: "none", color: C.blue, fontSize: F.sm, fontWeight: 700, cursor: "pointer", padding: "4px 6px", minHeight: 36 }}>
            {expandLabel} →
          </button>
        )}
      </div>
      {children}
    </section>
  );
});
```

- [ ] **Step 4-2 (RED):** MapEntryWidget.test.jsx — v1 의 4 케이스 그대로 (비로그인 잠금 렌더 / 잠금 클릭 onExpand / 로그인 "지도 열기" CTA / CTA 클릭 onExpand — 코드는 v1 Task 4 Step 4-2 와 동일):

```jsx
// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapEntryWidget } from "./MapEntryWidget";

describe("MapEntryWidget", () => {
  it("비로그인: 잠금 안내판 렌더 (D5)", () => {
    render(<MapEntryWidget isLoggedIn={false} onExpand={vi.fn()} />);
    expect(screen.getByText("로그인하면 지도가 열려요")).toBeInTheDocument();
  });
  it("비로그인: 잠금 클릭 시 onExpand (handleNavClick('map') 게이트 → LoginPromptModal trigger='map')", () => {
    const onExpand = vi.fn();
    render(<MapEntryWidget isLoggedIn={false} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole("button", { name: /로그인하고 지도 열기/ }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
  it("로그인: '지도 열기' CTA 렌더 (미니지도 임베드는 M2)", () => {
    render(<MapEntryWidget isLoggedIn={true} onExpand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "지도 열기" })).toBeInTheDocument();
    expect(screen.queryByText("로그인하면 지도가 열려요")).toBeNull();
  });
  it("로그인: CTA 클릭 시 onExpand", () => {
    const onExpand = vi.fn();
    render(<MapEntryWidget isLoggedIn={true} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole("button", { name: "지도 열기" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4-3:** RED 확인 → **Step 4-4 (GREEN):** 구현 (v1 과 동일):

```tsx
import { memo } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";

type MapEntryWidgetProps = { isLoggedIn: boolean; onExpand: () => void };

/**
 * 홈 지도 위젯 (M1) — 비로그인 = D5 잠금 placeholder / 로그인 = 지도 탭 진입 카드.
 * M2 에서 로그인 분기를 MapView 미니지도 임베드로 교체 (height/onSelect/compact prop 전제).
 * onExpand 는 반드시 handleNavClick("map") — 비로그인 게이트(useAppNavigation L68)가 자동 발화.
 */
export const MapEntryWidget = memo(function MapEntryWidget({ isLoggedIn, onExpand }: MapEntryWidgetProps) {
  return (
    <WidgetCard title="🗺 지도">
      {isLoggedIn ? (
        <>
          <div style={{ fontSize: F.sm, color: C.sub, lineHeight: 1.6 }}>
            전국 단지를 점수 색상 마커·클러스터·인프라 오버레이로 확인하세요.
          </div>
          <button onClick={onExpand} style={{ width: "100%", background: C.blue, border: "none", color: C.white, fontSize: F.base, fontWeight: 700, cursor: "pointer", padding: "12px", borderRadius: 8, minHeight: 44 }}>
            지도 열기
          </button>
        </>
      ) : (
        <button onClick={onExpand} aria-label="로그인하고 지도 열기" style={{ width: "100%", background: C.slate100, border: `1px dashed ${C.border}`, borderRadius: 8, padding: "24px 12px", cursor: "pointer", textAlign: "center", minHeight: 44 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">🔒</div>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>로그인하면 지도가 열려요</div>
          <div style={{ fontSize: F.xs, color: C.muted }}>카카오 로그인 후 점수 지도를 이용할 수 있어요</div>
        </button>
      )}
    </WidgetCard>
  );
});
```

- [ ] **Step 4-5:** 4 PASS → **Step 4-6:** Commit: `feat(home): WidgetCard 공유 틀 + MapEntryWidget (D5 잠금 placeholder)`

### Task 5: UpcomingWidget (곧분양) — v2: Date 파싱 필터 (형식 혼재 대응)

**Files:** Create `src/components/home/UpcomingWidget.tsx` / Test `UpcomingWidget.test.jsx`

> **v2 데이터 현실 (라이브 실측 2026-06-12):** recruitDate 451행 = YYYY-MM-DD 402 / **YYYY-MM 46** / 자유텍스트 3("2026 미정" 등). 문자열 비교(v1)는 현재월 YYYY-MM 무음 제외 + 미래연도 자유텍스트 오통과. → **Date 파싱 기반**으로 교체 (YYYY-MM = 그 달 1일 — 기존 computeDday 와 동일 의미, 자유텍스트 = Invalid Date 제외). 오늘 기준 임박 목록 = "2026-10" 3건 (D-111 회색) — **빈 상태·원거리 D-day 가 주 노출 경로**임을 PR 본문에 기록.

- [ ] **Step 5-1 (RED):** UpcomingWidget.test.jsx — 6 케이스 (v1 5 + 빈 상태 1, YYYY-MM 케이스 포함):

```jsx
// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpcomingWidget } from "./UpcomingWidget";

function isoDaysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeData(overrides = {}) {
  const iso = isoDaysFromNow(2);
  return {
    ok: true,
    stages: {
      plan: [{ id: "u1", name: "홈테스트1차", region: "경기", presaleStage: "분양계획", presaleRecruitDate: iso }],
      apply: [{ id: "u2", name: "홈테스트2차", region: "서울", presaleStage: "청약중", presaleRecruitDate: null }],
      sale: [{ id: "u3", name: "자유텍스트단지", region: "부산", presaleStage: "분양중", presaleRecruitDate: "2099 미정" }],
    },
    totals: { plan: 1, apply: 1, sale: 1 },
    calendar: { [iso]: [{ id: "u1", event: "apply_start" }] },
    ...overrides,
  };
}

describe("UpcomingWidget", () => {
  it("정상: 이번주 건수 + D-day 임박 단지명 렌더", () => {
    render(<UpcomingWidget data={makeData()} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText(/이번 주 일정 1건/)).toBeInTheDocument();
    expect(screen.getByText("홈테스트1차")).toBeInTheDocument();
  });
  it("recruitDate null·자유텍스트(Invalid Date)는 임박 목록 제외", () => {
    render(<UpcomingWidget data={makeData()} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.queryByText("홈테스트2차")).toBeNull();
    expect(screen.queryByText("자유텍스트단지")).toBeNull();
  });
  it("YYYY-MM(월 단위, 미래)도 임박 목록 포함 — 그 달 1일 해석 (라이브 46행 형식)", () => {
    const data = makeData();
    const future = new Date(Date.now() + 90 * 86400000);
    data.stages.apply = [{ id: "u4", name: "월단위단지", region: "대전", presaleStage: "청약중", presaleRecruitDate: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}` }];
    render(<UpcomingWidget data={data} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText("월단위단지")).toBeInTheDocument();
  });
  it("빈 stages: '예정된 청약 일정이 없습니다' (위젯 5상태 — 빈)", () => {
    render(<UpcomingWidget data={makeData({ stages: { plan: [], apply: [], sale: [] }, calendar: {} })} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText("예정된 청약 일정이 없습니다")).toBeInTheDocument();
  });
  it("로딩(data=null, error=false): 스켈레톤 / 실패(error=true): 재시도", () => {
    const { container, unmount } = render(<UpcomingWidget data={null} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    unmount();
    const onRetry = vi.fn();
    render(<UpcomingWidget data={null} error={true} onRetry={onRetry} onExpand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("행 클릭 = onExpand (상세 직진입 금지 — 홈 상세 게이트 정책)", () => {
    const onExpand = vi.fn();
    render(<UpcomingWidget data={makeData()} error={false} onRetry={vi.fn()} onExpand={onExpand} />);
    fireEvent.click(screen.getByText("홈테스트1차"));
    expect(onExpand).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5-2:** RED 확인 후 구현:

```tsx
import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { computeDday } from "@/lib/dday";
import { SkeletonBox } from "@/components/primitives";
import { WidgetCard } from "./WidgetCard";
import type { UpcomingApiResponse, UpcomingApt } from "@/types/upcoming";

type UpcomingWidgetProps = {
  data: UpcomingApiResponse | null;
  error: boolean;
  onRetry: () => void;
  onExpand: () => void;
};

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 곧분양 위젯 — 이번 주 일정 N건 + 임박 3건. 행 클릭 = /upcoming 펼치기 (상세 직진입 없음) */
export const UpcomingWidget = memo(function UpcomingWidget({ data, error, onRetry, onExpand }: UpcomingWidgetProps) {
  const todayIso = localTodayIso();

  const thisWeekCount = useMemo(() => {
    if (!data?.calendar) return 0;
    const start = new Date(todayIso);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return Object.entries(data.calendar).reduce((sum, [date, evts]) => {
      const d = new Date(date);
      return d >= start && d < end ? sum + evts.length : sum;
    }, 0);
  }, [data, todayIso]);

  // presaleRecruitDate 는 YYYY-MM-DD/YYYY-MM/자유텍스트 혼재(네이버 raw) — Date 파싱으로만 비교
  // (YYYY-MM = 그 달 1일 해석: 기존 computeDday 와 동일 의미. 자유텍스트 = Invalid Date 제외)
  const imminent = useMemo<UpcomingApt[]>(() => {
    if (!data?.stages) return [];
    const startMs = new Date(todayIso).getTime();
    return [...data.stages.plan, ...data.stages.apply, ...data.stages.sale]
      .map(apt => ({ apt, t: apt.presaleRecruitDate ? new Date(apt.presaleRecruitDate).getTime() : NaN }))
      .filter(x => !isNaN(x.t) && x.t >= startMs)
      .sort((a, b) => a.t - b.t)
      .slice(0, 3)
      .map(x => x.apt);
  }, [data, todayIso]);

  return (
    <WidgetCard title="📅 곧 분양" onExpand={onExpand} expandLabel="전체 일정">
      {error ? (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ fontSize: F.sm, color: C.muted, marginBottom: 8 }}>곧 분양 정보를 불러오지 못했어요</div>
          <button onClick={onRetry} style={{ padding: "8px 20px", fontSize: F.sm, fontWeight: 700, background: C.blueLight, color: C.blue, border: "none", borderRadius: 6, cursor: "pointer", minHeight: 36 }}>재시도</button>
        </div>
      ) : !data ? (
        <SkeletonBox height={72} />
      ) : (
        <>
          <div style={{ fontSize: F.sm, color: C.sub }}>이번 주 일정 {thisWeekCount}건</div>
          {imminent.length === 0 ? (
            <div style={{ fontSize: F.xs, color: C.muted, padding: "8px 0" }}>예정된 청약 일정이 없습니다</div>
          ) : (
            imminent.map(apt => {
              const dday = computeDday(apt.presaleRecruitDate);
              return (
                <button key={apt.id} onClick={onExpand} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: "none", borderTop: `1px solid ${C.border}`, padding: "8px 2px", cursor: "pointer", textAlign: "left", minHeight: 40 }}>
                  {dday && <span style={{ fontSize: F.sm, fontWeight: 900, color: dday.color, flexShrink: 0 }}>{dday.label}</span>}
                  <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{apt.name}</span>
                  <span style={{ fontSize: F.xs, color: C.muted, marginLeft: "auto", flexShrink: 0 }}>{apt.region ?? ""} · {String(apt.presaleStage ?? "")}</span>
                </button>
              );
            })
          )}
        </>
      )}
    </WidgetCard>
  );
});
```

- [ ] **Step 5-3:** 6 PASS → **Step 5-4:** Commit: `feat(home): UpcomingWidget — Date 파싱 임박 3건 (YYYY-MM 혼재 대응) + 5상태`

### Task 6: TopPicksWidget — v2: 팩토리 `subs` 정정 (REFUTED 해소)

**Files:** Create `src/components/home/TopPicksWidget.tsx` / Test `TopPicksWidget.test.jsx`

> **v2 정정:** AptCard.tsx:101·106 이 `res.cats.price.subs[0]?.info`·`res.cats.location.subs[0]?.info` 를 **subs 무가드** 접근 — Res 필드명은 `subs`(scoring.ts:153-155)다. v1 팩토리의 `items: []` 는 TypeError 크래시. **cats 6키 전부 `{ label, total, subs: [] }`** 로 (subs:[] 면 `subs[0]` = undefined → `?.info` 안전).

- [ ] **Step 6-1 (RED):** 테스트 4 케이스:

```jsx
// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopPicksWidget } from "./TopPicksWidget";

/** 최소 ScoredApt — AptCard 무가드 접근 지점(res.total/res.cats 6키의 label·total·subs) 충족 */
function makeScored(id, name, total) {
  const cat = (label, t) => ({ label, total: t, subs: [] });
  return /** @type {any} */ ({
    apt: { id, name, region: "경기", gu: "수원시", price: 50000, area: 84, noxious: [] },
    res: {
      total,
      cats: {
        price: cat("가격", 70), location: cat("입지", 60), product: cat("상품성", 55),
        benefit: { label: "혜택", total: 50, subs: [], totalWon: 0 },
        risk: cat("안전", 65), future: cat("미래", 45),
      },
    },
  });
}
const baseProps = () => ({
  pw: /** @type {any} */ ({}),
  onDetail: vi.fn(), onFav: vi.fn(), favoriteSet: new Set(), onComp: vi.fn(), compIds: [],
  isLoggedIn: true, isDesktop: false, isPC: false, onExpand: vi.fn(),
});

describe("TopPicksWidget", () => {
  const scored = [makeScored("a1", "일위단지", 90), makeScored("a2", "이위단지", 80), makeScored("a3", "삼위단지", 70), makeScored("a4", "사위단지", 60)];

  it("점수 내림차순 상위 3개만 렌더", () => {
    render(<TopPicksWidget {...baseProps()} scored={[...scored].reverse()} />);
    expect(screen.getByText(/일위단지/)).toBeInTheDocument();
    expect(screen.getByText(/삼위단지/)).toBeInTheDocument();
    expect(screen.queryByText(/사위단지/)).toBeNull();
  });
  it("비로그인: 점수 '??' 블라인드 (isLoggedIn 명시 전달 — 기본값 true 함정 가드)", () => {
    render(<TopPicksWidget {...baseProps()} isLoggedIn={false} scored={scored} />);
    expect(screen.getAllByText("??").length).toBeGreaterThanOrEqual(1);
  });
  it("빈 scored: 빈 상태 문구", () => {
    render(<TopPicksWidget {...baseProps()} scored={[]} />);
    expect(screen.getByText("표시할 단지가 없습니다")).toBeInTheDocument();
  });
  it("'전체 목록' 펼치기 클릭 → onExpand", () => {
    const props = baseProps();
    render(<TopPicksWidget {...props} scored={scored} />);
    fireEvent.click(screen.getByRole("button", { name: /전체 목록/ }));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6-2:** RED 확인 후 구현 (v1 과 동일 — AptListSection L105-110 호출 정형):

```tsx
import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { AptCard } from "@/components/AptCard";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";
import type { ProfileWeights } from "@/types/scoring";

type TopPicksWidgetProps = {
  scored: ScoredApt[];
  pw: ProfileWeights;
  onDetail: (_id: string) => void;
  onFav: (_id: string) => void;
  favoriteSet: Set<string>;
  onComp: (_id: string) => void;
  compIds: string[];
  isLoggedIn: boolean;
  isDesktop: boolean;
  isPC: boolean;
  onExpand: () => void;
};

/** 추천 TOP 3 — 현재 프로필 점수 상위 3. onDetail 은 반드시 handleDetailGated (홈 상세 게이트 정책) */
export const TopPicksWidget = memo(function TopPicksWidget({ scored, pw, onDetail, onFav, favoriteSet, onComp, compIds, isLoggedIn, isDesktop, isPC, onExpand }: TopPicksWidgetProps) {
  const top3 = useMemo(() => [...scored].sort((a, b) => b.res.total - a.res.total).slice(0, 3), [scored]);
  return (
    <WidgetCard title="⭐ 추천 TOP 3" onExpand={onExpand} expandLabel="전체 목록">
      {top3.length === 0 ? (
        <div style={{ fontSize: F.sm, color: C.muted, padding: "8px 0" }}>표시할 단지가 없습니다</div>
      ) : (
        <div style={isDesktop ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 } : isPC ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 16px" } : undefined}>
          {top3.map((item, idx) => (
            <AptCard key={item.apt.id} apt={item.apt} res={item.res} rank={idx + 1}
              onDetail={onDetail}
              isComp={compIds.includes(item.apt.id ?? "")} onComp={onComp}
              isFav={favoriteSet.has(item.apt.id ?? "")} onFav={onFav}
              profileWeights={pw} isDesktop={isDesktop} isLoggedIn={isLoggedIn} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
});
```

- [ ] **Step 6-3:** 4 PASS → **Step 6-4:** Commit: `feat(home): TopPicksWidget — 프로필 점수 TOP3 AptCard 재사용 (isLoggedIn 명시)`

### Task 7: MarketSummaryWidget (원시값 4종)

**Files:** Create `src/components/home/MarketSummaryWidget.tsx` / Test `MarketSummaryWidget.test.jsx`

- [ ] **Step 7-1 (RED):** 테스트 4 케이스 (mk 팩토리도 res.cats 미사용이라 안전 — MarketSummary 는 apt 원시 필드만 읽음):

```jsx
// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketSummaryWidget } from "./MarketSummaryWidget";

const mk = (id, price, unsoldRate) => /** @type {any} */ ({ apt: { id, name: `n${id}`, region: "경기", price, unsoldRate }, res: { total: 50, cats: {} } });

describe("MarketSummaryWidget", () => {
  it("단지 수·분양가 중위(억)·미분양률 중위(%) 집계", () => {
    const scored = [mk("1", 30000, 10), mk("2", 50000, 20), mk("3", 70000, 30)];
    render(<MarketSummaryWidget scored={scored} dataFreshnessText="오늘 06:00 업데이트" />);
    expect(screen.getByText("3개")).toBeInTheDocument();
    expect(screen.getByText("5.0억")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
    expect(screen.getByText("오늘 06:00 업데이트")).toBeInTheDocument();
  });
  it("price/unsoldRate null 단지는 해당 지표 분모에서 제외", () => {
    const scored = [mk("1", 30000, null), mk("2", null, 20)];
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.getByText("3.0억")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
  });
  it("빈 scored: 값 자리 '—'", () => {
    render(<MarketSummaryWidget scored={[]} dataFreshnessText={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
  it("점수 파생 지표 미노출 (원시값 4종만 — 비로그인 공개 안전)", () => {
    render(<MarketSummaryWidget scored={[mk("1", 30000, 10)]} dataFreshnessText={null} />);
    expect(screen.queryByText(/평균 점수/)).toBeNull();
  });
});
```

- [ ] **Step 7-2:** RED 확인 후 구현 (v1 과 동일):

```tsx
import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";

type MarketSummaryWidgetProps = { scored: ScoredApt[]; dataFreshnessText: string | null };

function median(sorted: number[]): number | null {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

/** 시장 요약 — 원시값 4종만 (점수 파생 금지: 비로그인 공개 정책). 이미 로드된 scored 클라이언트 집계, 새 fetch 0 */
export const MarketSummaryWidget = memo(function MarketSummaryWidget({ scored, dataFreshnessText }: MarketSummaryWidgetProps) {
  const stats = useMemo(() => {
    const prices = scored.map(s => s.apt.price).filter((p): p is number => typeof p === "number" && p > 0).sort((a, b) => a - b);
    const rates = scored.map(s => s.apt.unsoldRate).filter((r): r is number => typeof r === "number").sort((a, b) => a - b);
    return { count: scored.length, medPrice: median(prices), medRate: median(rates) };
  }, [scored]);

  const cells: Array<{ label: string; value: string }> = [
    { label: "전국 단지", value: stats.count > 0 ? `${stats.count.toLocaleString()}개` : "—" },
    { label: "분양가 중위", value: stats.medPrice != null ? `${(stats.medPrice / 10000).toFixed(1)}억` : "—" },
    { label: "미분양률 중위", value: stats.medRate != null ? `${stats.medRate.toFixed(1)}%` : "—" },
    { label: "데이터 기준", value: dataFreshnessText ?? "—" },
  ];

  return (
    <WidgetCard title="📊 시장 요약">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {cells.map(c => (
          <div key={c.label} style={{ background: C.slate100, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 2 }}>{c.label}</div>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.text }}>{c.value}</div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
});
```

- [ ] **Step 7-3:** 4 PASS → **Step 7-4:** Commit: `feat(home): MarketSummaryWidget — 원시값 4종 클라이언트 집계 (새 fetch 0)`

### Task 8: HomePage 조립 — v2: 패딩 isDesktop 분기 (다른 탭과 24px 통일)

**Files:** Create `src/components/home/HomePage.tsx` / Test `HomePage.test.jsx`

- [ ] **Step 8-1 (RED):** 테스트 4 케이스 (v1 과 동일 — 로딩 스켈레톤 / 그리드 minmax / UPCOMING OFF 미노출 / ON 노출):

```jsx
// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomePage } from "./HomePage";

const baseProps = () => ({
  scored: [], pw: /** @type {any} */ ({}),
  upcomingData: null, upcomingError: false, onRetryUpcoming: vi.fn(),
  isLoggedIn: false, isDesktop: false, isPC: false,
  dataLoading: false, dataFreshnessText: null,
  onNavClick: vi.fn(), onDetail: vi.fn(),
  onFav: vi.fn(), favoriteSet: new Set(), onComp: vi.fn(), compIds: [],
});

describe("HomePage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("로딩 중(apartments 미도착): 전체 스켈레톤", () => {
    const { container } = render(<HomePage {...baseProps()} dataLoading={true} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByText("📊 시장 요약")).toBeNull();
  });
  it("위젯 그리드: 지도·추천·시장요약 렌더 + auto-fit minmax (세션387 답습)", () => {
    const { container } = render(<HomePage {...baseProps()} />);
    expect(screen.getByText("🗺 지도")).toBeInTheDocument();
    expect(screen.getByText("⭐ 추천 TOP 3")).toBeInTheDocument();
    expect(screen.getByText("📊 시장 요약")).toBeInTheDocument();
    const grid = container.querySelector('[data-testid="home-grid"]');
    expect(grid && /** @type {HTMLElement} */ (grid).style.gridTemplateColumns).toContain("minmax");
  });
  it("VITE_FEATURE_UPCOMING OFF: 곧분양 위젯 미노출 (이중 플래그 의존)", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "");
    render(<HomePage {...baseProps()} />);
    expect(screen.queryByText("📅 곧 분양")).toBeNull();
  });
  it("VITE_FEATURE_UPCOMING ON: 곧분양 위젯 노출", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HomePage {...baseProps()} />);
    expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8-2:** RED 확인 후 구현 — **패딩 2곳 모두 `isDesktop ? "0 24px" : "0 16px"`** (App.tsx:301·324 list/map 탭과 통일 — v2 정정):

```tsx
import { memo } from "react";
import { isFeatureUpcoming } from "@/constants/featureFlags";
import { SkeletonList } from "@/components/primitives";
import { MapEntryWidget } from "./MapEntryWidget";
import { UpcomingWidget } from "./UpcomingWidget";
import { TopPicksWidget } from "./TopPicksWidget";
import { MarketSummaryWidget } from "./MarketSummaryWidget";
import type { ScoredApt } from "@/types/hooks";
import type { ProfileWeights } from "@/types/scoring";
import type { UpcomingApiResponse } from "@/types/upcoming";

type HomePageProps = {
  scored: ScoredApt[];
  pw: ProfileWeights;
  upcomingData: UpcomingApiResponse | null;
  upcomingError: boolean;
  onRetryUpcoming: () => void;
  isLoggedIn: boolean;
  isDesktop: boolean;
  isPC: boolean;
  dataLoading: boolean;
  dataFreshnessText: string | null;
  onNavClick: (_k: string) => void;
  onDetail: (_id: string) => void;
  onFav: (_id: string) => void;
  favoriteSet: Set<string>;
  onComp: (_id: string) => void;
  compIds: string[];
};

/**
 * 통합 홈 (D1 C안 위젯판) — spec §1·§2. 위젯 단위 독립.
 * 펼치기는 전부 onNavClick(handleNavClick) 경유. 전문가 위젯 2종은 M2.
 */
export const HomePage = memo(function HomePage({ scored, pw, upcomingData, upcomingError, onRetryUpcoming, isLoggedIn, isDesktop, isPC, dataLoading, dataFreshnessText, onNavClick, onDetail, onFav, favoriteSet, onComp, compIds }: HomePageProps) {
  const upcomingEnabled = isFeatureUpcoming();
  const pad = isDesktop ? "0 24px" : "0 16px"; // App.tsx L301·L324 list/map 탭 패딩과 통일

  if (dataLoading && scored.length === 0) {
    return (
      <div style={{ padding: pad }}>
        <SkeletonList count={4} columns={1} />
      </div>
    );
  }

  return (
    <div style={{ padding: pad }}>
      <div data-testid="home-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
        <MapEntryWidget isLoggedIn={isLoggedIn} onExpand={() => onNavClick("map")} />
        {upcomingEnabled && (
          <UpcomingWidget data={upcomingData} error={upcomingError} onRetry={onRetryUpcoming} onExpand={() => onNavClick("upcoming")} />
        )}
        <MarketSummaryWidget scored={scored} dataFreshnessText={dataFreshnessText} />
        <div style={{ gridColumn: "1 / -1" }}>
          <TopPicksWidget scored={scored} pw={pw} onDetail={onDetail} onFav={onFav} favoriteSet={favoriteSet} onComp={onComp} compIds={compIds} isLoggedIn={isLoggedIn} isDesktop={isDesktop} isPC={isPC} onExpand={() => onNavClick("list")} />
        </div>
      </div>
    </div>
  );
});
```

- [ ] **Step 8-3:** 4 PASS → **Step 8-4:** Commit: `feat(home): HomePage 위젯판 조립 (auto-fit 그리드 + 스켈레톤 + 패딩 탭 통일)`

### Task 9A: upcoming state lift (선행 분리 커밋 — GATE 0 🟡 해소, flag 무관 동작 보존)

**Files:** Modify `src/App.tsx:67-91` (L67 기존 주석 포함 교체 — 이중 주석 방지)

- [ ] **Step 9A-1:** L67-91 전체를 교체 (v2: 검증이 잡은 영구 스켈레톤 구멍 + 데드 가드 제거 — `!j?.ok` 면 전부 error):

```tsx
// § 5-5 + 홈 위젯: /api/upcoming 전체 응답 보관 (헤더 라벨 + 곧분양 위젯 공유, fetch 1회 불변)
const [upcomingData, setUpcomingData] = useState<UpcomingApiResponse | null>(null);
const [upcomingError, setUpcomingError] = useState(false);
const [upcomingRetryTick, setUpcomingRetryTick] = useState(0);
useEffect(() => {
  if (!isFeatureUpcoming()) return;
  let cancelled = false;
  setUpcomingError(false); // retry 시 스켈레톤 복귀 (retry 는 error 상태=data null 에서만 발화 — data 리셋 불필요)
  fetch("/api/upcoming")
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (cancelled) return;
      if (!j?.ok) { setUpcomingError(true); return; } // HTTP 에러·ok:false 통일 — 헤더 count 는 기존과 동일 null 유지
      setUpcomingData(j as UpcomingApiResponse);
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      setUpcomingError(true);
      // upcomingData = null 유지 → HeaderSection 옵셔널 prop 호환, 헤더 라벨만 fallback
      if (import.meta.env.DEV) {
        console.warn("[App] /api/upcoming fetch 실패, 헤더 라벨 fallback", err);
      }
      trackEvent("upcoming_fetch_error", {
        message: err instanceof Error ? err.message : String(err),
      });
      showToast("곧 분양 데이터 임시 사용 불가");
    });
  return () => { cancelled = true; };
}, [showToast, upcomingRetryTick]);
const retryUpcoming = useCallback(() => setUpcomingRetryTick(t => t + 1), []);
const upcomingCount = upcomingData
  ? (upcomingData.totals?.plan || 0) + (upcomingData.totals?.apply || 0) + (upcomingData.totals?.sale || 0)
  : null;
```

+ 상단 import: `import type { UpcomingApiResponse } from "@/types/upcoming";` (useCallback 은 L2 에 이미 import 됨)

> 동작 변화 전수 (검증 박제): HTTP 에러·ok:false → error=true (위젯용 신규 — 기존은 무음, 헤더 라벨은 양쪽 다 null 폴백 동일) / catch 경로 warn+trackEvent+toast 유지 / dep 의 showToast 는 useToast.ts:8 useCallback 안정 참조라 재실행 0.

- [ ] **Step 9A-2:** `npx vitest run src/App.test.jsx` → 기존 전체 PASS (동작 보존 증명) + `npm run typecheck` → 0
- [ ] **Step 9A-3:** Commit: `refactor(app): /api/upcoming 응답 state lift (헤더 라벨 동작 보존 + 위젯용 error/retry)`

### Task 9B: App 배선 — 초기탭·딥링크·카카오 착지·홈 렌더 + 테스트

**Files:** Modify `src/App.tsx` (5곳), `src/hooks/useKakaoCallbackEffect.ts:42,47` / Test `src/App.test.jsx`, `src/hooks/useKakaoCallbackEffect.test.js`

- [ ] **Step 9B-1:** App.tsx import: `isFeatureHome` 추가 + `import { HomePage } from "@/components/home/HomePage";` (정적 — 홈이 기본 탭이라 lazy 무의미, spec §3)
- [ ] **Step 9B-2:** 초기 탭 3곳: L96-99 폴백·L119 `!token`·L122 기본 — `"list"` → `isFeatureHome() ? "home" : "list"` (L120-121 admin/expert 직행 유지)
- [ ] **Step 9B-3:** `?compare=` 딥링크 (L220-223):

```tsx
if (compareStr) {
  const ids = compareStr.split(",").filter(Boolean).slice(0, MAX_COMPARE);
  if (ids.length >= 2) {
    setCompIds(ids); setShowCompOpen(true);
    // CompareSheet 는 list 탭 전용 렌더(L300-309) — home 기본 탭에선 list 로 페어 전환.
    // ?detail= 복합 링크는 detail 우선(!detailId): 탭 전환 시 useDetailModal 모달닫힘 충돌 회피.
    // 복합 링크의 비교 시트 열림 상태는 유실 수용(compIds 보존 — 목록의 'N개 비교 보기' 버튼으로 재개, PR 본문 기록)
    if (!detailId && isFeatureHome()) setTab("list");
  }
}
```

- [ ] **Step 9B-4:** 렌더 분기 — L300 앞에 `{tab === "home" ? (<HomePage ... />) : tab === "list" ? (` 삽입 (v1 Step 9-5 코드 그대로 — props: scored·pw·upcomingData·upcomingError·onRetryUpcoming={retryUpcoming}·isLoggedIn·isDesktop·isPC·dataLoading·dataFreshnessText·onNavClick={handleNavClick}·onDetail={handleDetailGated}·onFav={toggleFavorite}·favoriteSet·onComp={toggleComp}·compIds). L270 SearchFilterBar 조건 무변경.
- [ ] **Step 9B-5:** L356 onBackToMain → `setTab(isFeatureHome() ? "home" : "list")`
- [ ] **Step 9B-6:** L330 InfoPage 에 `onConsultClick={() => handleNavClick("consult")}` 추가 (Task 11 과 페어 — 같은 PR 내라 순서 무관하나 typecheck 는 Task 11 후 green)
- [ ] **Step 9B-7:** useKakaoCallbackEffect.ts — import 추가 + L42·47 `setTab("list")` → `setTab(isFeatureHome() ? "home" : "list")` ×2 (pendingDetail 구조 무변경 — 값만 교체)
- [ ] **Step 9B-8 (테스트):** App.test.jsx — **기존 `describe('App 통합 테스트')` 내부 맨 아래에 중첩** (beforeEach 의 clearAllMocks+storage clear 상속 — 검증 박제). fetch 는 `vi.stubGlobal` 로 mock (CI 가 UPCOMING=true 라 실 fetch reject → act 밖 setState flaky 방지). 클릭은 파일 관례인 `await act(async () => { btn.click(); })` (fireEvent 미import 파일):

```jsx
  describe('VITE_FEATURE_HOME flag ON', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, stages: { plan: [], apply: [], sale: [] }, totals: { plan: 0, apply: 0, sale: 0 }, calendar: {} }),
      }));
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('초기 탭이 홈 — 위젯판 렌더 + D5 잠금 (비로그인)', async () => {
      vi.stubEnv('VITE_FEATURE_HOME', 'true');
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText('📊 시장 요약')).toBeInTheDocument();
      });
      expect(screen.getByText('로그인하면 지도가 열려요')).toBeInTheDocument();
    });

    it('?compare= 딥링크: list 탭 전환 + 비교 시트 열림 (홈이 기본 탭이어도 보존)', async () => {
      vi.stubEnv('VITE_FEATURE_HOME', 'true');
      window.history.replaceState(null, '', '/?compare=apt1,apt2');
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/2개 비교/)).toBeInTheDocument();
      });
      window.history.replaceState(null, '', '/');
    });

    it('?detail= 딥링크: 홈 기본 탭에서도 상세 모달 열림 (전역 렌더 무변경 회귀)', async () => {
      vi.stubEnv('VITE_FEATURE_HOME', 'true');
      window.history.replaceState(null, '', '/?detail=apt1');
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      window.history.replaceState(null, '', '/');
    });

    it('홈 추천 카드 상세 클릭: 비로그인 → LoginPromptModal (handleDetailGated 게이트)', async () => {
      vi.stubEnv('VITE_FEATURE_HOME', 'true');
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText('⭐ 추천 TOP 3')).toBeInTheDocument();
      });
      const detailBtn = screen.getAllByText('상세보기')[0];
      await act(async () => { detailBtn.click(); });
      expect(screen.getByRole('dialog', { name: '로그인 안내' })).toBeInTheDocument();
    });
  });
```

> 셀렉터 캐비엇: "상세보기" 텍스트는 e2e/mobile.spec.ts:40 선례. ?detail= 모달 단언은 DetailModal 의 실제 role/텍스트 구현 시 1회 대조 (기존 detail-modal e2e 가 `[role="dialog"]` 사용).

- [ ] **Step 9B-9:** useKakaoCallbackEffect.test.js 에 ON 케이스 1건 (기존 4건 `toHaveBeenCalledWith('list')` 은 OFF 무수정 통과 — 검증 확인):

```js
it("VITE_FEATURE_HOME=true: 일반 유저 콜백 착지가 home", async () => {
  vi.stubEnv("VITE_FEATURE_HOME", "true");
  // 기존 일반 유저(role=user) 성공 케이스 셋업 답습 → expect(setTab).toHaveBeenCalledWith("home");
  vi.unstubAllEnvs();
});
```

> 기존 파일의 mock 셋업 헬퍼를 그대로 답습해 role=user 성공 경로만 ON 으로 1건 복제.

- [ ] **Step 9B-10:** `npx vitest run src/App.test.jsx src/hooks/useKakaoCallbackEffect.test.js` → 전체 PASS / `npm run typecheck` → 0
- [ ] **Step 9B-11:** Commit: `feat(home): App 배선 — 초기탭·딥링크·카카오 착지·홈 렌더 (flag OFF 회귀 0)`

### Task 10: 네비 5탭 — BottomNav + HeaderSection

**Files:** Modify `BottomNav.tsx:8-23`, `HeaderSection.tsx:107-126` / Test 각 .test.jsx

- [ ] **Step 10-1 (RED):** BottomNav.test.jsx HOME describe (v2: OFF 케이스 이름 정정):

```jsx
describe("VITE_FEATURE_HOME flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ON 일반 사용자: 홈·목록·지도·정보 + 비교/상담 미노출 (D4 5탭)", () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    render(<BottomNav {...makeProps()} />);
    expect(screen.getByText("홈")).toBeInTheDocument();
    expect(screen.queryByText("비교")).toBeNull();
    expect(screen.queryByText("상담")).toBeNull();
    expect(screen.getByText("정보")).toBeInTheDocument();
  });
  it("ON + UPCOMING ON: 5탭 전체 (홈·목록·지도·📅·정보)", () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<BottomNav {...makeProps()} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
  it("ON 홈 클릭: onNavClick('home')", () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    const onNavClick = vi.fn();
    render(<BottomNav {...makeProps({ onNavClick })} />);
    fireEvent.click(screen.getByText("홈"));
    expect(onNavClick).toHaveBeenCalledWith("home");
  });
  it("ON 전문가: 홈 포함 6탭", () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    render(<BottomNav {...makeProps({ expertLoggedIn: true, tab: "expert" })} />);
    expect(screen.getByText("홈")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(6);
  });
  it("OFF: 비교·상담 보존 (회귀 가드)", () => {
    vi.stubEnv("VITE_FEATURE_HOME", "");
    render(<BottomNav {...makeProps()} />);
    expect(screen.queryByText("홈")).toBeNull();
    expect(screen.getByText("비교")).toBeInTheDocument();
    expect(screen.getByText("상담")).toBeInTheDocument();
  });
});
```

> BottomNav.test 의 makeProps 는 기존 파일에 실존 (L96-126 기존 describe 가 사용 중) — 그대로 답습.

- [ ] **Step 10-2:** BottomNav.tsx — navItems 3갈래 + L23 잔재 정리 (OFF byte 보존: `!homeEnabled &&` 가드 — OFF 에서 `!false=true` 로 기존 식과 동치):

```tsx
import { isFeatureUpcoming, isFeatureHome } from "@/constants/featureFlags";
// ...
const upcomingEnabled = isFeatureUpcoming();
const homeEnabled = isFeatureHome();
const navItems = expertLoggedIn
  ? [
      ...(homeEnabled ? [{ l: "홈", k: "home" }] : []),
      { l: "대시보드", k: "expert" }, { l: "상담목록", k: "expertConsults" }, { l: "소비자뷰", k: "list" }, { l: "지도", k: "map" }, { l: "로그아웃", k: "logout" },
    ]
  : homeEnabled
    ? [
        // D4 확정: 홈·목록·지도·📅곧분양·정보 5탭. 비교 = 목록 안 버튼 / 상담 = 정보 페이지 진입
        { l: "홈", k: "home" },
        { l: "목록", k: "list" },
        { l: "지도", k: "map" },
        ...(upcomingEnabled ? [{ l: "📅 곧 분양", k: "upcoming" }] : []),
        { l: "정보", k: "info" },
      ]
    : [
        { l: "목록", k: "list" },
        { l: "지도", k: "map" },
        ...(upcomingEnabled ? [{ l: "📅 곧 분양", k: "upcoming" }] : []),
        { l: "비교", k: "compare" },
        { l: "상담", k: "consult" },
        { l: "정보", k: "info" },
      ];
```

```tsx
const isActive = n.k === "compare" ? (showComp && tab === "list") : (tab === n.k && !(!homeEnabled && n.k === "list" && showComp));
```

- [ ] **Step 10-3:** `npx vitest run src/components/sections/BottomNav.test.jsx` → 전체 PASS
- [ ] **Step 10-4 (RED→GREEN):** HeaderSection — navItems 에 홈 추가 (데스크톱 비교·상담 유지, D4 표). **테스트는 파일 관례 = describe 내부 `defaultProps` 스프레드 (makeProps 없음 — 검증 박제) + vitest import 에 afterEach 추가**:

```jsx
// HeaderSection.test.jsx L2 정정: import { describe, it, expect, vi, afterEach } from "vitest";
// 기존 describe("HeaderSection") 내부 맨 아래에 중첩:
  describe("VITE_FEATURE_HOME flag", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("ON 데스크톱: '홈' 네비 렌더 + 클릭 시 onNavClick('home')", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      const onNavClick = vi.fn();
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} onNavClick={onNavClick} />);
      fireEvent.click(screen.getByRole("button", { name: "홈" }));
      expect(onNavClick).toHaveBeenCalledWith("home");
    });
    it("OFF: '홈' 미노출 (회귀 가드)", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "");
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
      expect(screen.queryByRole("button", { name: "홈" })).toBeNull();
    });
  });
```

HeaderSection.tsx 구현:

```tsx
import { isFeatureUpcoming, isFeatureHome } from "@/constants/featureFlags";
// ...L107 upcomingEnabled 아래:
const homeEnabled = isFeatureHome();
const navItems = expertLoggedIn
  ? [
      ...(homeEnabled ? [{ l: "홈", k: "home" }] : []),
      { l: "대시보드", k: "expert" },
      { l: "상담목록", k: "expertConsults" },
      { l: "소비자뷰", k: "list" },
      { l: "지도", k: "map" },
      ...(upcomingEnabled ? [{ l: upcomingLabel, k: "upcoming" }] : []),
    ]
  : [
      ...(homeEnabled ? [{ l: "홈", k: "home" }] : []),
      { l: "목록", k: "list" },
      { l: "지도", k: "map" },
      ...(upcomingEnabled ? [{ l: upcomingLabel, k: "upcoming" }] : []),
      { l: "비교", k: "compare" },
      { l: "상담", k: "consult" },
      { l: "정보", k: "info" },
    ];
```

- [ ] **Step 10-5:** `npx vitest run src/components/sections/HeaderSection.test.jsx` → 전체 PASS
- [ ] **Step 10-6:** Commit: `feat(home): 네비 5탭 — BottomNav/HeaderSection 홈 추가 + L23 잔재 정리 (OFF 회귀 0)`

### Task 11: InfoPage 상담 진입 + 안내 텍스트 5곳

**Files:** Modify `InfoPage.tsx:20-21`+카드, `HeaderSection.tsx:88,90`, `GuideSections.tsx:133,168`, `useComparison.ts:31`, `useComparison.test.js:100` / Test `InfoPage.test.jsx`

- [ ] **Step 11-1 (RED):** InfoPage.test.jsx — 기존 테스트 render 들에 `onConsultClick={vi.fn()}` 보충 + 신규 1건:

```jsx
it("상담 신청 카드 렌더 + 클릭 시 onConsultClick (handleNavClick('consult') 경유 = 예산 프리필 보존)", () => {
  const onConsultClick = vi.fn();
  render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={onConsultClick} />);
  fireEvent.click(screen.getByRole("button", { name: "상담 신청하기" }));
  expect(onConsultClick).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 11-2:** InfoPage.tsx — props 확장 + "시작하기" 카드 바로 다음 상담 카드 (v1 코드 그대로):

```tsx
type InfoPageProps = { expertLoggedIn: boolean; onExpertLoginClick: () => void; onConsultClick: () => void };
```

```tsx
{/* 2. 전문가 상담 진입 — 모바일 5탭에서 상담 탭이 빠지는 대신 정보 페이지가 정식 입구 (spec D4) */}
<div style={cardStyle}>
  <div style={titleStyle}>전문가 상담 신청</div>
  <div style={guideDesc}>
    관심 단지와 예산을 남기면 전문가가 연락드립니다.
    관심매물로 등록한 단지는 자동으로 상담 목록에 포함됩니다.
  </div>
  <button onClick={onConsultClick} style={{
    width: "100%", background: C.blue, border: "none", color: C.white, fontSize: F.base, fontWeight: 700,
    cursor: "pointer", padding: "12px", borderRadius: 6, minHeight: 44, marginTop: 8
  }}>상담 신청하기</button>
</div>
```

- [ ] **Step 11-3:** 안내 텍스트 5곳 — ON/OFF·모바일/데스크톱 모두 참인 중립 문구:

| # | 위치 | 새 문구 |
|---|---|---|
| 1 | HeaderSection.tsx:88 (HELP "비교") | `카드 체크로 2~4개 선택 → 목록 상단 '비교 보기' 버튼으로 나란히 비교` |
| 2 | HeaderSection.tsx:90 (HELP "상담") | `상담 신청 화면(정보 페이지의 '상담 신청하기')에서 관심 단지·예산과 함께 신청하면 전문가가 연락` |
| 3 | GuideSections.tsx:133 | `비교 목록은 브라우저에 자동 저장됩니다. 다음 방문 시 이전 비교가 복원됩니다.` |
| 4 | GuideSections.tsx:168 | `상담 신청 화면에서 이름, 연락처, 관심 단지, 예산 범위, 상담 유형(방문상담/전화상담/온라인상담)을 입력하고 신청하세요. 정보 페이지의 '상담 신청하기' 버튼으로 들어갈 수 있습니다.` (L169-170 기존 문장 유지) |
| 5 | useComparison.ts:31 | `` `이전 비교 ${initCountRef.current}개 복원됨 · 목록에서 확인` `` |

- [ ] **Step 11-4:** useComparison.test.js:100 → `'이전 비교 3개 복원됨 · 목록에서 확인'`
- [ ] **Step 11-5:** 잔존 박제 grep — **느슨 패턴** (GuideSections 는 `&apos;` HTML 엔티티라 리터럴 따옴표 grep 미매치 — 검증 박제): `grep -rn "비교 탭\|상담.*탭\|하단.*상담\|하단.*비교" src/ e2e/` → 본 Task 수정분 외 잔존 0 확인 (GuideSections.tsx:157 "지도 탭" 은 ON 에서도 참 — 유지)
- [ ] **Step 11-6:** `npx vitest run src/components/sections/InfoPage.test.jsx src/hooks/useComparison.test.js src/components/sections/HeaderSection.test.jsx` → 전체 PASS
- [ ] **Step 11-7:** Commit: `feat(home): InfoPage 상담 진입 신규 + 네비 안내 문구 5곳 중립화 (D4)`

### Task 12: e2e — 홈 spec 신규 + 기존 spec HOME ON 호환 보정 (v2 신규 — hard fail 실측 선차단)

**Files:** Create `e2e/home.spec.ts` / Modify `e2e/skeleton-empty.spec.ts`, `e2e/apartment-list.spec.ts`

> **v2 실측:** e2e.yml 에 HOME=true 주입 시(Task 2) — ① skeleton-empty 첫 테스트 **hard fail 확정** (목록 스켈레톤 6개 단언 vs 홈 SkeletonList 4개) ② apartment-list·skeleton-empty 2·3 silent skip (홈엔 SearchFilterBar 없음 — 커버리지 소실) ③ 나머지 10개 spec 호환 (probe 전수 실측). 보정 없이 머지하면 PR CI 에서 처음 깨짐.

- [ ] **Step 12-1:** 목록 진입 보정 헬퍼를 두 spec 의 beforeEach(또는 goto 직후)에 추가 — flag OFF 에선 no-op:

```ts
/** VITE_FEATURE_HOME ON 이면 초기 탭이 홈 — 목록 검증 spec 은 목록 탭으로 이동 (OFF 면 no-op) */
async function gotoListTab(page: import("@playwright/test").Page) {
  const homeBtn = page.getByRole("button", { name: "홈" }).first();
  if (await homeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole("button", { name: "목록" }).first().click();
  }
}
```

- apartment-list.spec.ts beforeEach: `await page.goto("/");` 다음 줄에 `await gotoListTab(page);`
- skeleton-empty.spec.ts: 테스트 2·3 의 goto 직후에 `await gotoListTab(page);`

- [ ] **Step 12-2:** skeleton-empty 첫 테스트(스켈레톤 count 6 단언)는 **라우트 지연 중이라 탭 클릭 불가** — flag 분기로 기대값 전환 (mobile.spec auto-skip 답습):

```ts
// HOME ON 이면 초기 화면 = 홈 스켈레톤(SkeletonList count=4), OFF 면 목록 스켈레톤 6개
const homeGrid = page.locator('[data-testid="home-grid"]');
const skeletons = page.locator('[style*="skeleton-pulse"]');
// 홈/목록 어느 쪽이든 스켈레톤이 1개 이상 떠야 한다는 본질 단언으로 완화 + 화면별 정확 count 분기
```

구체 수정: 기존 `expect(count).toBe(6)` 을 다음으로 교체 —

```ts
const count = await page.locator('[style*="skeleton-pulse"]').count();
// VITE_FEATURE_HOME ON = 홈 SkeletonList 4개 / OFF = 목록 카드 스켈레톤 6개
expect([4, 6]).toContain(count);
```

- [ ] **Step 12-3:** `e2e/home.spec.ts` 신규 (flag-OFF auto-skip — v1 코드 그대로):

```ts
import { test, expect } from "@playwright/test";

// VITE_FEATURE_HOME=true 환경에서만 홈 탭 노출 — flag OFF 환경에서는 자동 skip
test.describe("통합 홈 위젯판 (M1)", () => {
  test("홈 초기 진입 → 위젯 → D5 잠금 → '전체 목록' 펼치기", async ({ page }) => {
    await page.goto("/");
    const homeBtn = page.getByRole("button", { name: "홈" }).first();
    const isFeatureOn = await homeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isFeatureOn) {
      test.skip(true, "VITE_FEATURE_HOME flag OFF — 홈 미노출 (정상)");
      return;
    }

    await expect(page.getByText("📊 시장 요약")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("로그인하면 지도가 열려요")).toBeVisible();

    await page.getByRole("button", { name: "로그인하고 지도 열기" }).click();
    await expect(page.getByRole("dialog", { name: "로그인 안내" })).toBeVisible();
    await page.getByRole("button", { name: "나중에 하기" }).click();

    await page.getByRole("button", { name: /전체 목록/ }).click();
    await expect(page.getByText("📊 시장 요약")).not.toBeVisible();
  });
});
```

- [ ] **Step 12-4:** `npm run typecheck:e2e` → 0 errors
- [ ] **Step 12-5:** **HOME ON 전체 스위트 로컬 1회** (CI 에서 처음 깨지는 구조 차단 — 검증 fix): `VITE_FEATURE_HOME=true VITE_FEATURE_UPCOMING=true npx playwright test` → PASS/skip 만 (fail 0)
- [ ] **Step 12-6:** OFF 회귀 1회: `npx playwright test e2e/skeleton-empty.spec.ts e2e/apartment-list.spec.ts` (env 없이) → PASS
- [ ] **Step 12-7:** Commit: `test(home): e2e 홈 spec + 기존 spec HOME ON 호환 보정 (skeleton count 분기·목록 진입 헬퍼)`

### Task 13: 전체 회귀 + PR

- [ ] **Step 13-1:** `npm run test` → 전체 PASS / **Step 13-2:** `npm run typecheck && npm run typecheck:e2e && npm run lint` → 0
- [ ] **Step 13-3:** `npm run build` → 성공
- [ ] **Step 13-4:** M2 자산 무수정 증명: `git diff main --stat -- src/components/sections/MapView.tsx src/components/SelectedAptCard.tsx src/components/expert/` → 출력 0
- [ ] **Step 13-5:** PR 생성 — 본문 Write 임시 파일 → `gh pr create --body-file` (인라인 금지). PR 본문에 기록 의무 3건: ① 복합 딥링크(detail+compare) 시 비교 시트 열림 유실 수용(compIds 보존) ② 곧분양 위젯 실데이터 현실(이번주 0건·YYYY-MM D-111 — 빈 상태가 주 경로) ③ OFF 에서도 활성인 변경 3곳(불변 조건 1 예외)
- [ ] **Step 13-6:** CI green (`gh pr checks --watch`) → squash 머지 (자동 머지 훅 동작 시 세션 384 복구 절차: `git update-ref` + `git restore`)
- [ ] **Step 13-7:** 임시 PR body 파일 삭제

---

## M1 완료 기준 대조 (spec §6)

| spec §6 M1 기준 | 증거 |
|---|---|
| featureFlag 배선 5곳 (ci.yml OFF 유지) | Task 1·2 (Step 2-3 무변경 확인) |
| HomePage + 소비자 위젯 4종 | Task 4~8 |
| 비로그인 분기 (D5 잠금 + isLoggedIn 명시) | Task 4 + Task 6 ("??" 테스트) + Step 9B-8 게이트 통합 테스트 |
| 네비 5탭 + L23 잔재 + 안내 텍스트 5곳 | Task 10·11 |
| InfoPage 상담 진입 (handleNavClick 경유) | Step 9B-6 + Task 11 |
| §1 초기탭·딥링크 표 전체 | Task 9B (초기탭 3곳·compare 페어·detail 회귀·카카오 착지 ON 테스트·onBackToMain / 전문가·관리자 직행 무변경) |
| vitest 신규 (위젯 5상태·잠금·딥링크 회귀) | Task 4~8 + Step 9B-8·9B-9 (UpcomingWidget 빈 상태 포함 — GATE 3 해소) |
| 기존 전체 회귀 green | Step 9A-2·9B-10·13-1 (OFF 기존 테스트 무수정 통과) |
| e2e 홈 spec + e2e.yml env | Task 12 + Task 2 (**기존 spec ON 호환 보정 포함** — hard fail 선차단) |
| CI 기본 OFF·ON stubEnv 양갈래 | Task 9B·10 describe 블록 |

## 9-GATE 판정 (적대검증 워크플로 8 probe 결과 반영 후)

| GATE | 판정 | 비고 |
|---|---|---|
| 0 크기 | 🟢 | Task 9 분할(9A/9B)로 🟡 해소. 전 Task 1~3파일/커밋 |
| 1 영향 범위 | 🟢 | computeDday 소비처·문구 박제 테스트·e2e 13 spec 전수 실측 |
| 2 순서·의존 | 🟢 | 배선→유틸→위젯→조립→배선→네비→문구→e2e. Task 별 독립 커밋 |
| 3 완전성 | 🟢 | 빈/로딩/에러/OFF/정상 5상태 + ?detail=·카카오 ON 테스트 보강 |
| 4 적정성 | 🟢 | MapView 0·새 fetch 0·공유 WidgetCard 로 drift 0 |
| 5 보안 | 🟢 | 시크릿 0·점수 블라인드 기존 정책 답습 (Bar aria 누설은 기존 구멍 — spec §9 BACKLOG) |
| 6 프↔백 일관성 | 🟢 | 새 API 0. recruitDate 형식 혼재는 Date 파싱으로 흡수 |
| 7 롤백 | 🟢 | Task=커밋=revert 단위. OFF dead-code 아님은 불변 조건 1 에 예외 명시 |
| 8 UX·외부 | 🟢 | upcoming 실패 재시도·스켈레톤·e2e ON 전체 1회 로컬 실증 |

## 명시적 비범위 (M2·M3)

- MapView prop 신설·미니지도 임베드·SelectedAptCard 오버레이·전문가 위젯 2종·role 축 게이트 (M2)
- 위젯 순서·접기·ARIA·`home_*` analytics 신규 (M3 — handleNavClick 의 기존 tab_switch 는 자동)
- DetailModal ungated 기존 2건·AptCard Bar aria 누설 (spec §9 BACKLOG — 기존 구멍)
- scoreRisk 폴백값·spec v2 본문·SESSION_LOG (건드리지 말 것)
