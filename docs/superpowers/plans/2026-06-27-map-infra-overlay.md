# 지도 인프라 아이콘 오버레이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카카오 지도에서 단지 클릭 시 그 단지 주변의 8개 카테고리(지하철·병원·마트·학교·학원·편의점·약국·카페) 시설을 아이콘 마커로 표시한다.

**Architecture:** 카테고리 정의를 순수 상수 모듈(`infraCategories.ts`)로 분리하고, 기존 `InfraOverlay.tsx`를 ① 8개 카테고리 ② `selectedApt` 좌표 기준 검색(없으면 화면 중앙 폴백)으로 개편. 데이터는 카카오 Places `categorySearch` 실시간(우리 DB엔 좌표 미저장 — 실측 확정). KakaoMapView의 마커/강조/클러스터 effect는 손대지 않고 prop 1개만 추가.

**Tech Stack:** React 19 + TypeScript(JSDoc 테스트), Vitest + testing-library, 카카오 Maps JS SDK(`kakao.services.Places`).

## Global Constraints

- 새 점수·DB·collector·마이그레이션 **0** (순수 프론트 기능 추가).
- KakaoMapView 마커 effect·선택 강조 effect·클러스터·mode(choropleth)·GPS effect **무변경**.
- 카테고리 정의 단일 출처 = `infraCategories.ts` (카카오 코드·반경·이모지 drift 0).
- 네이버 지도는 이번 범위 **제외**(v3 POI 검색 API 부재 — 공식 확인, DB 좌표도 없음).
- 테스트 스타일: 기존 파일 답습 — `// @ts-check`, vitest, `@testing-library/react`.
- 컴포넌트 규칙(`src/components/CLAUDE.md`): memo 유지, ARIA(`aria-pressed`) 유지, 터치 타겟 36px+.

---

### Task 1: `infraCategories.ts` 순수 상수 모듈

**Files:**
- Create: `src/components/sections/infraCategories.ts`
- Test: `src/components/sections/infraCategories.test.ts`

**Interfaces:**
- Produces: `interface InfraCategory { key: string; label: string; code: string; emoji: string; radius: number }`,
  `export const INFRA_CATEGORIES: InfraCategory[]` (8개). Task 2(InfraOverlay)가 이 배열을 import.

- [ ] **Step 1: Write the failing test**

`src/components/sections/infraCategories.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { INFRA_CATEGORIES } from "./infraCategories";

describe("INFRA_CATEGORIES", () => {
  it("8개 카테고리", () => {
    expect(INFRA_CATEGORIES).toHaveLength(8);
  });

  it("key 가 유니크", () => {
    const keys = INFRA_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(8);
  });

  it("카카오 카테고리 코드 형식 (영문2+숫자1)", () => {
    for (const c of INFRA_CATEGORIES) {
      expect(c.code).toMatch(/^[A-Z]{2}\d$/);
    }
  });

  it("radius 는 양수", () => {
    for (const c of INFRA_CATEGORIES) {
      expect(c.radius).toBeGreaterThan(0);
    }
  });

  it("기존 4개(지하철·병원·마트·학교) + 신규 4개(학원·편의점·약국·카페) 포함", () => {
    const keys = INFRA_CATEGORIES.map((c) => c.key);
    for (const k of ["subway", "hospital", "mart", "school", "academy", "conv", "pharmacy", "cafe"]) {
      expect(keys).toContain(k);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/sections/infraCategories.test.ts`
Expected: FAIL — "Failed to resolve import ./infraCategories" (모듈 없음)

- [ ] **Step 3: Write the module**

`src/components/sections/infraCategories.ts`:
```ts
// 지도 인프라 오버레이 카테고리 정의 — 순수 상수(SDK·React 무관, 세션 448).
// InfraOverlay 가 카카오 Places categorySearch 로 검색. 단일 출처 — 코드·반경·이모지를 여기서만 관리.
// 카카오 카테고리 그룹 코드: apis.map.kakao.com 공식. 반경은 카테고리 체감별 차등(편의점/카페 좁게, 마트/지하철 넓게).

export interface InfraCategory {
  key: string;
  label: string;
  /** 카카오 카테고리 그룹 코드 (categorySearch 용) */
  code: string;
  emoji: string;
  /** 검색 반경(m) */
  radius: number;
}

export const INFRA_CATEGORIES: InfraCategory[] = [
  { key: "subway", label: "지하철", code: "SW8", emoji: "🚇", radius: 1500 },
  { key: "hospital", label: "병원", code: "HP8", emoji: "🏥", radius: 1000 },
  { key: "mart", label: "마트", code: "MT1", emoji: "🛒", radius: 1500 },
  { key: "school", label: "학교", code: "SC4", emoji: "🏫", radius: 1000 },
  { key: "academy", label: "학원", code: "AC5", emoji: "📚", radius: 1000 },
  { key: "conv", label: "편의점", code: "CS2", emoji: "🏪", radius: 500 },
  { key: "pharmacy", label: "약국", code: "PM9", emoji: "💊", radius: 800 },
  { key: "cafe", label: "카페", code: "CE7", emoji: "☕", radius: 500 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/sections/infraCategories.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/infraCategories.ts src/components/sections/infraCategories.test.ts
git commit -m "feat(map): 인프라 오버레이 카테고리 8종 상수 모듈 (세션 448)"
```

---

### Task 2: `InfraOverlay.tsx` 개편 — 8개 카테고리 + selectedApt 기준점

**Files:**
- Modify: `src/components/sections/InfraOverlay.tsx` (전면 개편 — 내부 하드코딩 카테고리 제거, selectedApt prop, 기준점 로직)
- Modify: `src/components/sections/InfraOverlay.test.jsx` (4개→8개 + selectedApt 기준 검색 + 폴백 테스트)

**Interfaces:**
- Consumes: `INFRA_CATEGORIES` from Task 1 (`infraCategories.ts`).
- Produces: `InfraOverlay` 컴포넌트가 prop `selectedApt?: { lat: number | null; lng: number | null } | null` 추가 수용. Task 3(KakaoMapView)이 이 prop 으로 selected 좌표 전달.

**구현 핵심 (현재 InfraOverlay.tsx 대비 변경점)**:
- 내부 `INFRA_CATEGORIES`(4개 하드코딩) 삭제 → `infraCategories.ts` import.
- `searchAndShow(categoryCode, emoji)` → `searchAndShow(categoryCode, emoji, center)` 로 center 인자화.
- 검색 기준점 헬퍼 `getSearchCenter()`: `selectedApt` 의 lat/lng 가 유효하면 `new kakao.LatLng(lat, lng)`, 아니면 `mapInstance.getCenter()`.
- effect deps 에 `selectedApt?.lat`, `selectedApt?.lng` 추가(선택 단지 바뀌면 재검색).
- 마커 SVG 28px 원형 + 이모지(현행 유지).

- [ ] **Step 1: Write the failing tests (테스트 먼저 갱신)**

`src/components/sections/InfraOverlay.test.jsx` 전체 교체:
```jsx
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InfraOverlay } from "./InfraOverlay";

/* ── Kakao Places SDK mock ── */
function setupKakao() {
  const categorySearch = vi.fn((_code, cb) => {
    // status OK + 빈 결과 (마커 0개라도 호출 인자 검증이 목적)
    cb([], "OK");
  });
  /** @type {any} */ (window).kakao = {
    maps: {
      services: {
        Places: vi.fn(function () { this.categorySearch = categorySearch; }),
        Status: { OK: "OK" },
        SortBy: { DISTANCE: "DISTANCE" },
      },
      Marker: vi.fn(function () { this.setMap = vi.fn(); }),
      MarkerImage: vi.fn(function () {}),
      Size: vi.fn(function () {}),
      Point: vi.fn(function () {}),
      LatLng: vi.fn(function (/** @type {number} */ lat, /** @type {number} */ lng) { this.lat = lat; this.lng = lng; }),
      event: { addListener: vi.fn(() => ({})), removeListener: vi.fn() },
    },
  };
  return { categorySearch };
}

/** mapInstance mock — getCenter 는 화면 중앙(35,128) 반환 */
function makeMapInstance() {
  return { getCenter: vi.fn(() => ({ __center: true, lat: 35, lng: 128 })) };
}

beforeEach(() => {
  delete (/** @type {any} */ (window).kakao);
});

describe("InfraOverlay", () => {
  it("8개 인프라 카테고리 버튼이 렌더링됨", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("버튼 클릭 시 활성화 토글", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    const btns = screen.getAllByRole("button");
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("다른 카테고리 선택 시 이전 비활성화 (단일 선택)", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    const btns = screen.getAllByRole("button");
    fireEvent.click(btns[0]);
    fireEvent.click(btns[1]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
    expect(btns[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("ready=false일 때 크래시 없이 렌더링", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("selectedApt 좌표 있으면 그 좌표로 categorySearch (단지 기준)", () => {
    const { categorySearch } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={{ lat: 37.5, lng: 127.0 }} />);
    // 카테고리 토글 켜기 → 검색 발화
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    expect(categorySearch).toHaveBeenCalled();
    // 검색 옵션의 location 이 selectedApt 좌표(LatLng(37.5,127.0))여야 함 (화면중앙 getCenter 아님)
    const opts = categorySearch.mock.calls.at(-1)[2];
    expect(opts.location.lat).toBe(37.5);
    expect(opts.location.lng).toBe(127.0);
    expect(mapInstance.getCenter).not.toHaveBeenCalled();
  });

  it("selectedApt 없으면 getCenter(화면 중앙) 폴백", () => {
    const { categorySearch } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={null} />);
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    expect(mapInstance.getCenter).toHaveBeenCalled();
    const opts = categorySearch.mock.calls.at(-1)[2];
    expect(opts.location.__center).toBe(true); // getCenter 반환값
  });

  it("selectedApt 좌표가 null(좌표 없는 단지)이면 getCenter 폴백", () => {
    const { categorySearch } = setupKakao();
    const mapInstance = makeMapInstance();
    render(<InfraOverlay mapInstance={mapInstance} ready selectedApt={{ lat: null, lng: null }} />);
    act(() => { fireEvent.click(screen.getAllByRole("button")[0]); });
    expect(mapInstance.getCenter).toHaveBeenCalled();
    void categorySearch;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/sections/InfraOverlay.test.jsx`
Expected: FAIL — "8개" 단언 실패(현재 4개) + selectedApt 테스트 실패(prop 미수용).

- [ ] **Step 3: Rewrite `InfraOverlay.tsx`**

`src/components/sections/InfraOverlay.tsx` 전체 교체:
```tsx
import { memo, useState, useEffect, useRef, useCallback } from "react";
import { C, F } from "@/theme";
import { getKakaoMaps } from "./kakaoMapHelpers";
import { INFRA_CATEGORIES } from "./infraCategories";

const INFRA_MAX_RESULTS = 15;
const INFRA_DEBOUNCE_MS = 500;

type InfraOverlayProps = {
  mapInstance: unknown;
  ready: boolean;
  /** 선택된 단지 좌표 — 있으면 이 단지 기준, 없으면 화면 중앙(getCenter) 기준 (세션 448) */
  selectedApt?: { lat: number | null; lng: number | null } | null;
};

/**
 * InfraOverlay — 지도 위 인프라 마커 토글 (세션 448: 8 카테고리 + 단지 기준 검색)
 * 카카오 Places categorySearch 실시간. 우리 DB엔 주변시설 좌표 미저장이라 실시간만 가능(실측 확정).
 */
export const InfraOverlay = memo(function InfraOverlay({ mapInstance, ready, selectedApt }: InfraOverlayProps) {
  const [active, setActive] = useState<string | null>(null);
  const markersRef = useRef<any[]>([]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 검색 기준점: 선택 단지 좌표 우선, 없으면 화면 중앙(getCenter) 폴백
  const getSearchCenter = useCallback(() => {
    const kakao = getKakaoMaps();
    if (!kakao) return null;
    if (selectedApt && selectedApt.lat != null && selectedApt.lng != null) {
      return new kakao.LatLng(selectedApt.lat, selectedApt.lng);
    }
    if (!mapInstance) return null;
    return (mapInstance as any).getCenter();
  }, [mapInstance, selectedApt]);

  // 카테고리 마커 검색 + 표시
  const searchAndShow = useCallback((categoryCode: string, emoji: string, radius: number) => {
    const kakao = getKakaoMaps();
    if (!mapInstance || !kakao?.services) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const center = getSearchCenter();
    if (!center) return;

    const ps = new kakao.services.Places();
    ps.categorySearch(categoryCode, (data: any[], status: string) => {
      if (status !== kakao.services.Status.OK) return;
      const newMarkers = data.map((place: any) => {
        const svgIcon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="13" fill="#fff" stroke="${C.indigo}" stroke-width="2"/><text x="14" y="15" text-anchor="middle" font-size="14" dy="0.35em">${emoji}</text></svg>`)}`;
        const marker = new kakao.Marker({
          position: new kakao.LatLng(place.y, place.x),
          title: place.place_name,
          image: new kakao.MarkerImage(svgIcon, new kakao.Size(28, 28), { offset: new kakao.Point(14, 14) }),
          zIndex: 5,
        });
        marker.setMap(mapInstance);
        return marker;
      });
      markersRef.current = newMarkers;
    }, { location: center, radius, size: INFRA_MAX_RESULTS, sort: kakao.services.SortBy.DISTANCE });
  }, [mapInstance, getSearchCenter]);

  // 활성 카테고리 또는 선택 단지 변경 시 검색
  useEffect(() => {
    if (!ready || !active) {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      return;
    }
    const cat = INFRA_CATEGORIES.find((c) => c.key === active);
    if (!cat) return;
    searchAndShow(cat.code, cat.emoji, cat.radius);

    if (!mapInstance) return;
    const kakao = getKakaoMaps();
    if (!kakao) return;
    const listener = kakao.event.addListener(mapInstance, "idle", () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => searchAndShow(cat.code, cat.emoji, cat.radius), INFRA_DEBOUNCE_MS);
    });
    return () => {
      kakao.event.removeListener?.(listener);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [ready, active, mapInstance, searchAndShow, selectedApt?.lat, selectedApt?.lng]);

  const toggle = useCallback((key: string) => {
    setActive((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
      {INFRA_CATEGORIES.map((cat) => (
        <button
          key={cat.key}
          type="button"
          onClick={() => toggle(cat.key)}
          aria-pressed={active === cat.key}
          title={cat.label}
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: active === cat.key ? C.indigo : C.white,
            color: active === cat.key ? C.white : C.text,
            border: `1px solid ${active === cat.key ? C.indigo : C.border}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            cursor: "pointer", fontSize: F.lg,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {cat.emoji}
        </button>
      ))}
    </div>
  );
});
```

> 변경 요약: 내부 카테고리 상수 삭제→import / `getSearchCenter` 신규(selectedApt 우선) / `searchAndShow` 가 radius 인자 받음 / effect deps 에 selectedApt 좌표 / 버튼 `type="button"` 추가. INFRA_SEARCH_RADIUS 상수 제거(카테고리별 radius 로 대체).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/sections/InfraOverlay.test.jsx src/components/sections/infraCategories.test.ts`
Expected: PASS (전부)

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/InfraOverlay.tsx src/components/sections/InfraOverlay.test.jsx
git commit -m "feat(map): InfraOverlay 8 카테고리 + 단지 기준 검색 (세션 448)"
```

---

### Task 3: KakaoMapView — selectedApt prop 전달

**Files:**
- Modify: `src/components/sections/KakaoMapView.tsx` (InfraOverlay 렌더 1줄)

**Interfaces:**
- Consumes: `InfraOverlay` 의 `selectedApt` prop (Task 2). `selected` state(`{apt,res} | null`)는 이미 존재(L34).

- [ ] **Step 1: Modify InfraOverlay 렌더 줄**

`src/components/sections/KakaoMapView.tsx` 에서 (현재):
```tsx
      {!compact && <InfraOverlay mapInstance={mapInstance} ready={ready} />}
```
→ 교체:
```tsx
      {!compact && <InfraOverlay mapInstance={mapInstance} ready={ready} selectedApt={selected?.apt ?? null} />}
```

- [ ] **Step 2: 지도 회귀 가드 — 기존 테스트 무수정 green 확인**

Run: `npx vitest run src/components/sections/MapView.test.jsx src/components/sections/NaverMapView.test.jsx src/components/sections/MapViewRouter.test.jsx`
Expected: PASS (전부 — 마커 effect 무관, prop 1개 추가만)

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 0 errors (selectedApt 타입 일치)

- [ ] **Step 4: Commit**

```bash
git add src/components/sections/KakaoMapView.tsx
git commit -m "feat(map): KakaoMapView 가 선택 단지 좌표를 InfraOverlay 에 전달 (세션 448)"
```

---

### Task 4: 전체 검증 + 문서 정합

**Files:**
- Modify: `src/components/CLAUDE.md` (InfraOverlay 설명 갱신 — 8 카테고리·단지 기준)

- [ ] **Step 1: 전체 회귀 가드**

Run: `npm run test`
Expected: 전체 vitest green (기존 + 신규 infraCategories/InfraOverlay).

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: lint 0 err, build 성공.
그 후 prebuild 가 건드린 데이터 원복: `git checkout -- public/data`

- [ ] **Step 3: CLAUDE.md 문서 정합**

`src/components/CLAUDE.md` 의 InfraOverlay 언급을 "8 카테고리(지하철·병원·마트·학교·학원·편의점·약국·카페) + 단지 클릭 시 그 단지 좌표 기준 검색, 카카오 전용, 세션 448" 으로 갱신. 카테고리 단일 출처 `infraCategories.ts` 명시.

- [ ] **Step 4: 라이브 육안 검증 (Playwright MCP)**

dev 서버(`npm run dev`) → 로그인 → 카카오 지도 탭 → 단지 클릭 → 학원📚/편의점🏪 등 토글 → **그 단지 주변**에 아이콘 표시되는지 확인. selectedApt 좌표 기준 동작 육안 확인. (SDK 키 필요 — 없으면 단위 테스트가 대체 검증.)

- [ ] **Step 5: Commit**

```bash
git add src/components/CLAUDE.md
git commit -m "docs(map): InfraOverlay 8 카테고리·단지 기준 검색 문서 정합 (세션 448)"
```

---

## Self-Review

**Spec coverage**: ✅ 8 카테고리(Task 1) / selectedApt 기준점(Task 2) / 화면중앙 폴백(Task 2 테스트) / 카카오만(범위, 네이버 무변경) / 데이터 저장 0(실시간 categorySearch) / 마커 effect 무변경(Task 3 prop만). 모두 태스크 매핑됨.

**Placeholder scan**: 모든 코드 블록 완전(테스트·구현 실코드). TBD/TODO 없음.

**Type consistency**: `selectedApt?: { lat: number | null; lng: number | null } | null` — Task 2 정의 ↔ Task 3 전달(`selected?.apt`, apt 에 lat/lng 존재) 일치. `searchAndShow(code, emoji, radius)` 시그니처 Task 2 내부 일관. `INFRA_CATEGORIES` Task 1 produces ↔ Task 2 consumes 일치.
