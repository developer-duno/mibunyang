// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapEntryWidget } from "./MapEntryWidget";

// MapView stub — kakao SDK 무관 격리. lazy dynamic import 에도 VitestMocker 적용.
// props 검증은 data-* 속성 노출 방식 (vi.mock factory 호이스팅 대응 — PriceChart.test 선례)
vi.mock("@/components/sections/MapView", () => ({
  MapView: (/** @type {any} */ props) => (
    <div
      data-testid="mapview-stub"
      data-compact={String(props.compact)}
      data-height={props.height}
      data-filtered-count={props.filtered?.length}
      data-has-ondetail={String(typeof props.onDetail === "function")}
    />
  ),
}));

/** IntersectionObserver 즉시 발화 mock — per-test 스코프 (전역 박으면 '진입 전 스켈레톤' 테스트가 깨짐) */
function stubFiringIO() {
  vi.stubGlobal("IntersectionObserver", class {
    /** @param {any} cb */
    constructor(cb) { this.cb = cb; }
    /** @param {any} el */
    observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
    disconnect() {}
    unobserve() {}
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

const baseProps = () => ({
  isLoggedIn: true,
  onExpand: vi.fn(),
  filtered: [/** @type {any} */ ({ apt: { id: "a1" }, res: { total: 80, cats: {} } })],
  onDetail: vi.fn(),
});

describe("MapEntryWidget", () => {
  it("비로그인: 잠금 안내판 렌더 (D5)", () => {
    render(<MapEntryWidget {...baseProps()} isLoggedIn={false} />);
    expect(screen.getByText("로그인하면 지도가 열려요")).toBeInTheDocument();
    expect(screen.queryByTestId("map-widget")).toBeNull();
  });

  it("비로그인: 잠금 클릭 시 onExpand (handleNavClick('map') 게이트 → LoginPromptModal trigger='map')", () => {
    const props = baseProps();
    render(<MapEntryWidget {...props} isLoggedIn={false} />);
    fireEvent.click(screen.getByRole("button", { name: /로그인하고 지도 열기/ }));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });

  it("로그인 + 뷰포트 진입 전: 스켈레톤 렌더 (기본 no-op IO)", () => {
    render(<MapEntryWidget {...baseProps()} />);
    expect(screen.getByLabelText("지도 불러오는 중")).toBeInTheDocument();
    expect(screen.queryByTestId("mapview-stub")).toBeNull();
  });

  it("로그인 + 뷰포트 진입: MapView 마운트 + compact/height/filtered/onDetail 전달", async () => {
    stubFiringIO();
    render(<MapEntryWidget {...baseProps()} />);
    const stub = await screen.findByTestId("mapview-stub"); // lazy 비동기 해소 — findBy 의무
    expect(stub.getAttribute("data-compact")).toBe("true");
    expect(stub.getAttribute("data-height")).toBe("280px");
    expect(stub.getAttribute("data-filtered-count")).toBe("1");
    expect(stub.getAttribute("data-has-ondetail")).toBe("true");
  });

  it("로그인: 헤더 '크게 보기' 클릭 시 onExpand", () => {
    const props = baseProps();
    render(<MapEntryWidget {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /크게 보기/ }));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });
});
