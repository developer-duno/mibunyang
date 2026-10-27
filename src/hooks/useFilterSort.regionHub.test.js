import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useFilterSort } from "./useFilterSort";
import { useRegionHubExit } from "./useRegionHubExit";
import { trackEvent } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// 세션669 PR-S2 — 지역 허브 진입·머무는 동안 주소·떠남. (useFilterSort.test.js 는 location 을 가짜 객체로 바꿔
// 경로를 못 다루므로 진짜 jsdom 주소를 쓰는 이 파일에 따로 둔다.)
const GURO = "/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC";
const hub = { region: "서울", gu: "구로구" };
const here = () => window.location.pathname + window.location.search;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("useFilterSort — 지역 허브(세션669)", () => {
  it("허브로 들어오면 지역·구 = 경로 값 (쿼리 region·gu 보다 우선)", () => {
    window.history.replaceState(null, "", `${GURO}?region=%EB%B6%80%EC%82%B0&sort=price`);
    const { result } = renderHook(() => useFilterSort({ regionHub: hub }));
    expect(result.current.filterRegion).toBe("서울");
    expect(result.current.filterGu).toBe("구로구");
    expect(result.current.sortKey).toBe("price"); // 다른 쿼리는 그대로 읽는다
  });

  it("시도 허브(구 없음) → 구 '전체'", () => {
    window.history.replaceState(null, "", "/region/%EC%84%B8%EC%A2%85");
    const { result } = renderHook(() => useFilterSort({ regionHub: { region: "세종", gu: null } }));
    expect(result.current.filterRegion).toBe("세종");
    expect(result.current.filterGu).toBe("전체");
  });

  it("허브 없으면 예전대로 쿼리에서 읽는다", () => {
    window.history.replaceState(null, "", "/?region=%EB%B6%80%EC%82%B0");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.filterRegion).toBe("부산");
  });

  it("허브에 머무는 동안 다른 필터를 바꾸면 경로는 /region/… 유지, 지역·구는 쿼리에 안 쓴다", () => {
    window.history.replaceState(null, "", GURO);
    const { result } = renderHook(() => useFilterSort({ regionHub: hub }));
    act(() => result.current.toggleSubwayOnly());
    act(() => vi.advanceTimersByTime(400));
    expect(here()).toBe(`${GURO}?subway=1`);
  });

  it("상세가 열린 주소(/apt/…)에선 허브여도 경로를 덮지 않는다", () => {
    window.history.replaceState(null, "", "/apt/ah-1");
    const { result } = renderHook(() => useFilterSort({ regionHub: hub }));
    act(() => result.current.toggleSubwayOnly());
    act(() => vi.advanceTimersByTime(400));
    expect(here()).toBe("/apt/ah-1?subway=1");
  });

  it("허브에서 구를 바꾸면(떠남) 주소 /?region=서울&gu=강서구 — 앱 필터는 /region 주소를 안 만든다", () => {
    window.history.replaceState(null, "", GURO);
    const { result, rerender } = renderHook((p) => useFilterSort(p), { initialProps: { regionHub: hub } });
    act(() => result.current.handleGuChange("강서구"));
    rerender({ regionHub: null }); // App 의 useRegionHubExit 가 허브를 지운다
    act(() => vi.advanceTimersByTime(400));
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe(`?region=${encodeURIComponent("서울")}&gu=${encodeURIComponent("강서구")}`);
  });

  it("허브가 지워진 것만으로는 주소를 다시 쓰지 않는다 — /upcoming 으로 옮긴 주소에 ?region= 이 붙지 않게", () => {
    window.history.replaceState(null, "", GURO);
    const { rerender } = renderHook((p) => useFilterSort(p), { initialProps: { regionHub: hub } });
    window.history.pushState(null, "", "/upcoming"); // 탭 effect 가 옮긴 셈
    rerender({ regionHub: null });
    act(() => vi.advanceTimersByTime(400));
    expect(here()).toBe("/upcoming");
  });

  it("허브 아님 + 주소가 /region/… 로 남아 있으면 / 로 (필터를 바꾼 경우)", () => {
    window.history.replaceState(null, "", GURO);
    const { result } = renderHook(() => useFilterSort({ regionHub: null }));
    act(() => result.current.handleRegionChange("부산"));
    act(() => vi.advanceTimersByTime(400));
    expect(here()).toBe(`/?region=${encodeURIComponent("부산")}`);
  });

  it("공유 주소: 허브에 머무는 중이면 허브 경로 + 다른 필터", () => {
    window.history.replaceState(null, "", GURO);
    const { result } = renderHook(() => useFilterSort({ regionHub: hub }));
    act(() => result.current.toggleSubwayOnly());
    expect(result.current.getShareURL()).toBe(`${window.location.origin}${GURO}?subway=1`);
  });

  it("허브 없을 때 공유 주소는 예전과 같다 (경로 + 쿼리)", () => {
    window.history.replaceState(null, "", "/");
    const { result } = renderHook(() => useFilterSort({}));
    act(() => result.current.handleRegionChange("부산"));
    expect(result.current.getShareURL()).toBe(`${window.location.origin}/?region=${encodeURIComponent("부산")}`);
  });
});

// 보완 F5 — App 처럼 허브 상태 + useFilterSort + useRegionHubExit 를 함께 돌린다
describe("허브를 떠날 때 필터 기록(filter_change)", () => {
  /** @param {{ tab: string }} p */
  const useBoth = (p) => {
    const [regionHub, setRegionHub] = useState(/** @type {any} */ (hub));
    const [hide, setHide] = useState(false);
    const fs = useFilterSort({ regionHub });
    useRegionHubExit({
      regionHub,
      setRegionHub,
      setHideNoUnsold: setHide,
      filterRegion: fs.filterRegion,
      filterGu: fs.filterGu,
      tab: p.tab,
    });
    return { fs, regionHub, hide };
  };
  const filterChanges = () =>
    /** @type {import('vitest').Mock} */ (trackEvent).mock.calls.filter((c) => c[0] === "filter_change").length;

  it("구로구 허브 → 강서구: filter_change 1건 · 주소 /?region=서울&gu=강서구 · 숨김 켬", () => {
    /** @type {import('vitest').Mock} */ (trackEvent).mockClear();
    window.history.replaceState(null, "", GURO);
    const { result } = renderHook((p) => useBoth(p), { initialProps: { tab: "list" } });
    act(() => result.current.fs.handleGuChange("강서구"));
    act(() => vi.advanceTimersByTime(400));
    expect(filterChanges()).toBe(1);
    expect(result.current.regionHub).toBeNull();
    expect(result.current.hide).toBe(true);
    expect(here()).toBe(`/?region=${encodeURIComponent("서울")}&gu=${encodeURIComponent("강서구")}`);
  });

  it("탭으로 떠나면 필터는 그대로라 filter_change 0건 · 주소 /?region=서울&gu=구로구", () => {
    /** @type {import('vitest').Mock} */ (trackEvent).mockClear();
    window.history.replaceState(null, "", GURO);
    const { result, rerender } = renderHook((p) => useBoth(p), { initialProps: { tab: "list" } });
    rerender({ tab: "upcoming" });
    act(() => vi.advanceTimersByTime(400));
    expect(filterChanges()).toBe(0);
    expect(result.current.regionHub).toBeNull();
    expect(here()).toBe(`/?region=${encodeURIComponent("서울")}&gu=${encodeURIComponent("구로구")}`);
  });

  it("지도 탭으로 가면 머문다 — 기록 0건 · 주소 허브 그대로 · 숨김 꺼짐", () => {
    /** @type {import('vitest').Mock} */ (trackEvent).mockClear();
    window.history.replaceState(null, "", GURO);
    const { result, rerender } = renderHook((p) => useBoth(p), { initialProps: { tab: "list" } });
    rerender({ tab: "map" });
    act(() => vi.advanceTimersByTime(400));
    expect(filterChanges()).toBe(0);
    expect(result.current.regionHub).not.toBeNull();
    expect(result.current.hide).toBe(false);
    expect(here()).toBe(GURO);
  });
});
