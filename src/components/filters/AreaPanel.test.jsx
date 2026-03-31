import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AreaPanel } from "./AreaPanel";

/* 테스트용 기본 props 팩토리 */
function makeProps(overrides = {}) {
  return {
    areaMin: "",
    onAreaMinChange: vi.fn(),
    areaMax: "",
    onAreaMaxChange: vi.fn(),
    unitsMin: "",
    onUnitsMinChange: vi.fn(),
    unitsMax: "",
    onUnitsMaxChange: vi.fn(),
    onAreaUnitsReset: vi.fn(),
    moveInFilter: "전체",
    onMoveInChange: vi.fn(),
    filterOptionCounts: null,
    ...overrides,
  };
}

describe("AreaPanel", () => {
  // 면적 최소/최대 입력 필드 렌더링
  it("면적 최소/최대 입력 필드 렌더링", () => {
    render(<AreaPanel {...makeProps()} />);
    expect(screen.getByLabelText("최소 면적(㎡)")).toBeInTheDocument();
    expect(screen.getByLabelText("최대 면적(㎡)")).toBeInTheDocument();
  });

  // 세대수 최소/최대 입력 필드 렌더링
  it("세대수 최소/최대 입력 필드 렌더링", () => {
    render(<AreaPanel {...makeProps()} />);
    expect(screen.getByLabelText("최소 세대수")).toBeInTheDocument();
    expect(screen.getByLabelText("최대 세대수")).toBeInTheDocument();
  });

  // 3개 면적 프리셋 버튼 렌더링
  it("소형/중형/대형 프리셋 버튼 3개 렌더링", () => {
    render(<AreaPanel {...makeProps()} />);
    expect(screen.getByText("소형 ~59㎡")).toBeInTheDocument();
    expect(screen.getByText("중형 60~85㎡")).toBeInTheDocument();
    expect(screen.getByText("대형 85㎡~")).toBeInTheDocument();
  });

  // 소형 프리셋 클릭 시 면적 범위 설정
  it("소형 프리셋 클릭 시 onAreaMinChange('') + onAreaMaxChange('59') 호출", () => {
    const onAreaMinChange = vi.fn();
    const onAreaMaxChange = vi.fn();
    render(<AreaPanel {...makeProps({ onAreaMinChange, onAreaMaxChange })} />);
    fireEvent.click(screen.getByText("소형 ~59㎡"));
    expect(onAreaMinChange).toHaveBeenCalledWith("");
    expect(onAreaMaxChange).toHaveBeenCalledWith("59");
  });

  // 대형 프리셋 클릭 시 면적 범위 설정
  it("대형 프리셋 클릭 시 onAreaMinChange('85') + onAreaMaxChange('') 호출", () => {
    const onAreaMinChange = vi.fn();
    const onAreaMaxChange = vi.fn();
    render(<AreaPanel {...makeProps({ onAreaMinChange, onAreaMaxChange })} />);
    fireEvent.click(screen.getByText("대형 85㎡~"));
    expect(onAreaMinChange).toHaveBeenCalledWith("85");
    expect(onAreaMaxChange).toHaveBeenCalledWith("");
  });

  // 입주상태 select 렌더링 + 4개 옵션
  it("입주 상태 select에 4개 옵션 렌더링", () => {
    render(<AreaPanel {...makeProps()} />);
    const select = screen.getByLabelText("입주 상태");
    expect(select).toBeInTheDocument();
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(4);
  });

  // 입주상태 변경 시 onMoveInChange 콜백
  it("입주 상태 변경 시 onMoveInChange 호출", () => {
    const onMoveInChange = vi.fn();
    render(<AreaPanel {...makeProps({ onMoveInChange })} />);
    fireEvent.change(screen.getByLabelText("입주 상태"), { target: { value: "미입주" } });
    expect(onMoveInChange).toHaveBeenCalledWith("미입주");
  });

  // 필터 미설정 시 초기화 버튼 미표시
  it("모든 필터 기본값이면 초기화 버튼 미표시", () => {
    render(<AreaPanel {...makeProps()} />);
    expect(screen.queryByLabelText("면적/세대/입주 초기화")).not.toBeInTheDocument();
  });

  // 면적 설정 시 초기화 버튼 표시
  it("면적 필터 설정 시 초기화 버튼 표시", () => {
    render(<AreaPanel {...makeProps({ areaMin: "60" })} />);
    expect(screen.getByLabelText("면적/세대/입주 초기화")).toBeInTheDocument();
  });

  // 초기화 버튼 클릭 시 onAreaUnitsReset + onMoveInChange("전체") 호출
  it("초기화 클릭 시 onAreaUnitsReset + onMoveInChange 호출", () => {
    const onAreaUnitsReset = vi.fn();
    const onMoveInChange = vi.fn();
    render(<AreaPanel {...makeProps({ areaMin: "60", onAreaUnitsReset, onMoveInChange })} />);
    fireEvent.click(screen.getByLabelText("면적/세대/입주 초기화"));
    expect(onAreaUnitsReset).toHaveBeenCalledTimes(1);
    expect(onMoveInChange).toHaveBeenCalledWith("전체");
  });

  // filterOptionCounts=null이어도 에러 없이 렌더링 (null 안전성)
  it("filterOptionCounts=null이어도 에러 없이 렌더링", () => {
    expect(() => render(<AreaPanel {...makeProps({ filterOptionCounts: null })} />)).not.toThrow();
  });

  // filterOptionCounts.moveInCounts 카운트 표시
  it("filterOptionCounts.moveInCounts 카운트가 옵션에 표시", () => {
    const counts = { moveInCounts: { "입주예정": 3, "미입주": 2, "입주완료": 1 } };
    render(<AreaPanel {...makeProps({ filterOptionCounts: counts })} />);
    const select = screen.getByLabelText("입주 상태");
    const options = select.querySelectorAll("option");
    expect(options[1].textContent).toBe("입주예정 (3)");
    expect(options[2].textContent).toBe("미입주 (2)");
    expect(options[3].textContent).toBe("입주완료 (1)");
  });
});
