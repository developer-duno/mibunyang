import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRegionHubExit } from "./useRegionHubExit";

// 세션669 PR-S2 결정 33·37 — 허브를 떠나면 허브 지움 + 숨김 다시 켬 + 주소 `/` + 쿼리
const GURO = "/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC";
const hub = { region: "서울", gu: "구로구" };
const props = (o = {}) => ({
  regionHub: hub,
  setRegionHub: vi.fn(),
  setHideNoUnsold: vi.fn(),
  filterRegion: "서울",
  filterGu: "구로구",
  tab: "list",
  ...o,
});

afterEach(() => window.history.replaceState(null, "", "/"));

describe("useRegionHubExit", () => {
  it("지역·구·탭이 그대로면 머문다 — 아무것도 안 바꾼다", () => {
    window.history.replaceState(null, "", `${GURO}?sort=price`);
    const p = props();
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p });
    expect(p.setRegionHub).not.toHaveBeenCalled();
    expect(p.setHideNoUnsold).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(`${GURO}?sort=price`);
  });

  // 보완 F5: 지역·구로 떠날 땐 주소를 이 훅이 아니라 useFilterSort 가 쓴다(filter_change 기록 1건 —
  // useFilterSort.regionHub.test.js 「떠날 때 필터 기록」). 이 훅은 허브·숨김만.
  it("필터로 다른 구(강서구) → 떠남: 허브 null · 숨김 켬 · 주소는 건드리지 않음(useFilterSort 몫)", () => {
    window.history.replaceState(null, "", `${GURO}?sort=price`);
    const p = props();
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p, filterGu: "강서구" });
    expect(p.setRegionHub).toHaveBeenCalledWith(null);
    expect(p.setHideNoUnsold).toHaveBeenCalledWith(true);
    expect(window.location.pathname + window.location.search).toBe(`${GURO}?sort=price`);
  });

  it("초기화(전체·전체) → 떠남(숨김 켬) · 주소는 useFilterSort 몫", () => {
    window.history.replaceState(null, "", GURO);
    const p = props();
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p, filterRegion: "전체", filterGu: "전체" });
    expect(p.setRegionHub).toHaveBeenCalledWith(null);
    expect(p.setHideNoUnsold).toHaveBeenCalledWith(true);
  });

  it("탭으로 떠나면 이 훅이 주소를 / + 쿼리로 — region·gu 를 맨 앞에, 다른 쿼리 유지", () => {
    window.history.replaceState(null, "", `${GURO}?sort=price`);
    const p = props();
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p, tab: "upcoming" });
    expect(window.location.pathname).toBe("/");
    const q = new URLSearchParams(window.location.search);
    expect([...q.keys()]).toEqual(["region", "gu", "sort"]);
    expect(q.get("gu")).toBe("구로구");
  });

  describe("결정 39 — 목록↔지도는 머묾", () => {
    it("목록 → 지도 → 목록: 허브·숨김·주소 그대로", () => {
      window.history.replaceState(null, "", GURO);
      const p = props();
      const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
      rerender({ ...p, tab: "map" });
      rerender({ ...p, tab: "list" });
      expect(p.setRegionHub).not.toHaveBeenCalled();
      expect(p.setHideNoUnsold).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(GURO);
    });
    it("지도 → 분양 예정: 떠남", () => {
      window.history.replaceState(null, "", GURO);
      const p = props();
      const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
      rerender({ ...p, tab: "map" });
      rerender({ ...p, tab: "upcoming" });
      expect(p.setRegionHub).toHaveBeenCalledWith(null);
      expect(p.setHideNoUnsold).toHaveBeenCalledWith(true);
    });
    it("지도에서 구를 바꾸면 떠남", () => {
      window.history.replaceState(null, "", GURO);
      const p = props();
      const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
      rerender({ ...p, tab: "map" });
      expect(p.setRegionHub).not.toHaveBeenCalled();
      rerender({ ...p, tab: "map", filterGu: "강서구" });
      expect(p.setRegionHub).toHaveBeenCalledWith(null);
      expect(p.setHideNoUnsold).toHaveBeenCalledWith(true);
    });
  });

  it("탭을 바꾸면 떠남 — 지역·구는 그대로 쿼리로 (/?region=서울&gu=구로구)", () => {
    window.history.replaceState(null, "", GURO);
    const p = props();
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p, tab: "home" });
    expect(p.setRegionHub).toHaveBeenCalledWith(null);
    expect(p.setHideNoUnsold).toHaveBeenCalledWith(true);
    expect(window.location.pathname).toBe("/");
    expect(new URLSearchParams(window.location.search).get("gu")).toBe("구로구");
  });

  it("떠난 뒤(허브 null) 같은 지역·구를 다시 골라도 아무 일 없다 — 허브로 안 돌아감", () => {
    window.history.replaceState(null, "", "/?region=%EC%84%9C%EC%9A%B8");
    const p = props({ regionHub: null, filterGu: "전체" });
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p, filterGu: "구로구" });
    expect(p.setRegionHub).not.toHaveBeenCalled();
    expect(p.setHideNoUnsold).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("상세가 열린 주소(/apt/…)에서 떠나면 주소는 건드리지 않는다(상세 effect 몫) · 숨김은 켬", () => {
    window.history.replaceState(null, "", "/apt/ah-1");
    const p = props();
    const { rerender } = renderHook((x) => useRegionHubExit(x), { initialProps: p });
    rerender({ ...p, filterRegion: "부산", filterGu: "전체" });
    expect(p.setHideNoUnsold).toHaveBeenCalledWith(true);
    expect(window.location.pathname).toBe("/apt/ah-1");
  });
});
