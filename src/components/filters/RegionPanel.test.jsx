import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RegionPanel } from "./RegionPanel";

/* 테스트용 기본 props 팩토리 */
function makeProps(overrides = {}) {
  return {
    filterRegion: "전체",
    onRegionChange: vi.fn(),
    regionOptions: ["전체", "서울", "경기"],
    filterGu: "전체",
    onGuChange: vi.fn(),
    guOptions: ["전체"],
    filterOptionCounts: null,
    ...overrides,
  };
}

describe("RegionPanel", () => {
  // 시/도, 구/군 select 2개 렌더링
  it("시/도, 구/군 select 2개 렌더링", () => {
    render(<RegionPanel {...makeProps()} />);
    expect(screen.getByLabelText("시/도")).toBeInTheDocument();
    expect(screen.getByLabelText("구/군")).toBeInTheDocument();
  });

  // 시/도 select에 regionOptions 표시
  it("시/도 select에 regionOptions가 option으로 표시", () => {
    render(<RegionPanel {...makeProps()} />);
    const select = screen.getByLabelText("시/도");
    const options = select.querySelectorAll("option");
    // "전체"는 텍스트 그대로, 나머지는 "이름 (0)" 형태 (filterOptionCounts=null → 0)
    expect(options).toHaveLength(3);
  });

  // 시/도 변경 시 onRegionChange 콜백
  it("시/도 변경 시 onRegionChange 호출", () => {
    const onRegionChange = vi.fn();
    render(<RegionPanel {...makeProps({ onRegionChange })} />);
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "서울" } });
    expect(onRegionChange).toHaveBeenCalledWith("서울");
  });

  // filterRegion="전체"이면 구/군 disabled
  it('filterRegion="전체"이면 구/군 disabled', () => {
    render(<RegionPanel {...makeProps({ filterRegion: "전체" })} />);
    expect(screen.getByLabelText("구/군")).toBeDisabled();
  });

  // guOptions.length <= 1이면 구/군 disabled
  it("guOptions가 1개 이하면 구/군 disabled", () => {
    render(<RegionPanel {...makeProps({ filterRegion: "서울", guOptions: ["전체"] })} />);
    expect(screen.getByLabelText("구/군")).toBeDisabled();
  });

  // guOptions가 2개 이상이면 구/군 enabled
  it("guOptions가 2개 이상이면 구/군 enabled", () => {
    render(<RegionPanel {...makeProps({ filterRegion: "서울", guOptions: ["전체", "강남구", "서초구"] })} />);
    expect(screen.getByLabelText("구/군")).not.toBeDisabled();
  });

  // 구/군 변경 시 onGuChange 콜백
  it("구/군 변경 시 onGuChange 호출", () => {
    const onGuChange = vi.fn();
    render(<RegionPanel {...makeProps({ filterRegion: "서울", guOptions: ["전체", "강남구"], onGuChange })} />);
    fireEvent.change(screen.getByLabelText("구/군"), { target: { value: "강남구" } });
    expect(onGuChange).toHaveBeenCalledWith("강남구");
  });

  // filterOptionCounts가 null이어도 에러 없이 렌더링 (null 안전성)
  it("filterOptionCounts=null이어도 에러 없이 렌더링", () => {
    expect(() => render(<RegionPanel {...makeProps({ filterOptionCounts: null })} />)).not.toThrow();
  });

  // filterOptionCounts에 카운트가 있으면 표시
  it("filterOptionCounts.regionCounts 카운트가 option에 표시", () => {
    const counts = { regionCounts: { "서울": 5, "경기": 3 }, guCounts: {} };
    render(<RegionPanel {...makeProps({ filterOptionCounts: counts })} />);
    const select = screen.getByLabelText("시/도");
    const options = select.querySelectorAll("option");
    // "서울 (5)", "경기 (3)"
    expect(options[1].textContent).toBe("서울 (5)");
    expect(options[2].textContent).toBe("경기 (3)");
  });
});
