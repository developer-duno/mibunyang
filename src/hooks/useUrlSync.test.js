import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUrlSync } from "./useUrlSync";
import { buildIdAlias } from "@/lib/dedup";

const apartments = [
  { id: "ah-1", name: "하양", memberIds: ["ah-1", "ah-2", "ap-9"] },
  { id: "ah-5", name: "다른", memberIds: ["ah-5"] },
];
const idAlias = buildIdAlias(apartments);
const base = () => ({
  tab: "home",
  setTab: vi.fn(),
  setProfile: vi.fn(),
  detailAptId: null,
  openDetail: vi.fn(),
  closeDetail: vi.fn(),
  setCompIds: vi.fn((f) => f),
  setShowCompOpen: vi.fn(),
  apartments,
  dataLoading: false,
  dataError: null,
  setFavoriteIds: vi.fn(),
  showToast: vi.fn(),
  idAlias,
});

describe("useUrlSync — 옛 id 넘김(세션635 다)", () => {
  it("관심매물의 구성원 id 는 지우지 않고 카드 id 로 바꾼다 — 정리 토스트는 모르는 id(ah-999) 1개만 센다", () => {
    const p = base();
    renderHook(() => useUrlSync(p));
    const updater = p.setFavoriteIds.mock.calls.at(-1)[0];
    expect(updater(["ah-2", "ah-5", "ah-999"])).toEqual(["ah-1", "ah-5"]);
    expect(p.showToast).toHaveBeenCalledWith(expect.stringContaining("1개가 정리"));
  });
  it("같은 카드로 모이는 중복은 하나만 남긴다", () => {
    const p = base();
    renderHook(() => useUrlSync(p));
    const updater = p.setFavoriteIds.mock.calls.at(-1)[0];
    expect(updater(["ah-1", "ah-2", "ap-9"])).toEqual(["ah-1"]);
  });
  it("딥링크 /apt/ah-2 는 목록이 들어온 뒤 한 번만 카드 ah-1 을 열고 주소를 /apt/ah-1 로 바꾼다", () => {
    window.history.replaceState(null, "", "/apt/ah-2");
    const p = { ...base(), apartments: [], dataLoading: true, idAlias: new Map() };
    const { rerender } = renderHook((props) => useUrlSync(props), { initialProps: p });
    expect(p.openDetail).not.toHaveBeenCalled(); // 목록 전엔 옛 id 로 열지 않는다
    rerender({ ...p, apartments, dataLoading: false, idAlias });
    expect(p.openDetail).toHaveBeenCalledTimes(1);
    expect(p.openDetail).toHaveBeenCalledWith("ah-1");
    expect(window.location.pathname).toBe("/apt/ah-1");
    rerender({ ...p, apartments, dataLoading: false, idAlias });
    expect(p.openDetail).toHaveBeenCalledTimes(1); // 다시 렌더해도 한 번만
    window.history.replaceState(null, "", "/");
  });
});

describe("useUrlSync — 지역 허브(세션669)", () => {
  const GURO = "/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC";
  it("허브에 머무는 중 상세를 열면 /apt/{id}, 닫으면 / 가 아니라 그 허브 경로로", () => {
    window.history.replaceState(null, "", GURO);
    const p = { ...base(), tab: "list", regionHubPath: GURO };
    const { rerender } = renderHook((props) => useUrlSync(props), { initialProps: p });
    rerender({ ...p, detailAptId: "ah-1" });
    expect(window.location.pathname).toBe("/apt/ah-1");
    rerender({ ...p, detailAptId: null });
    expect(window.location.pathname).toBe(GURO);
    window.history.replaceState(null, "", "/");
  });
  it("허브가 아니면(regionHubPath null) 상세를 닫으면 예전대로 /", () => {
    window.history.replaceState(null, "", "/");
    const p = { ...base(), tab: "list", regionHubPath: null };
    const { rerender } = renderHook((props) => useUrlSync(props), { initialProps: p });
    rerender({ ...p, detailAptId: "ah-1" });
    rerender({ ...p, detailAptId: null });
    expect(window.location.pathname).toBe("/");
  });
  it("17종 밖 시도의 /region 주소는 / 로 바꾸고 쿼리는 남긴다", () => {
    window.history.replaceState(null, "", "/region/%EC%95%88%EC%8B%AC%EB%89%B4%ED%83%80%EC%9A%B4?sort=price");
    renderHook(() => useUrlSync({ ...base(), tab: "list" }));
    expect(window.location.pathname + window.location.search).toBe("/?sort=price");
    window.history.replaceState(null, "", "/");
  });
  it("올바른 허브 주소는 그대로 둔다", () => {
    window.history.replaceState(null, "", GURO);
    renderHook(() => useUrlSync({ ...base(), tab: "list", regionHubPath: GURO }));
    expect(window.location.pathname).toBe(GURO);
    window.history.replaceState(null, "", "/");
  });
});
