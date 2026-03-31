import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetPanel } from "./BudgetPanel";

/* 테스트용 기본 props 팩토리 */
function makeProps(overrides = {}) {
  return {
    budgetMin: "",
    onBudgetMinChange: vi.fn(),
    budgetMax: "",
    onBudgetMaxChange: vi.fn(),
    onBudgetReset: vi.fn(),
    ...overrides,
  };
}

describe("BudgetPanel", () => {
  // 최소/최대 예산 입력 필드 렌더링
  it("최소/최대 예산 입력 필드 렌더링", () => {
    render(<BudgetPanel {...makeProps()} />);
    expect(screen.getByLabelText("최소 예산(억)")).toBeInTheDocument();
    expect(screen.getByLabelText("최대 예산(억)")).toBeInTheDocument();
  });

  // 4개 프리셋 버튼 렌더링 (3/5/7/10억 이하)
  it("4개 프리셋 버튼 렌더링", () => {
    render(<BudgetPanel {...makeProps()} />);
    ["3억 이하", "5억 이하", "7억 이하", "10억 이하"].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  // 프리셋 클릭 시 budgetMin="" + budgetMax=해당값 설정
  it("프리셋 클릭 시 onBudgetMinChange('') + onBudgetMaxChange(값) 호출", () => {
    const onBudgetMinChange = vi.fn();
    const onBudgetMaxChange = vi.fn();
    render(<BudgetPanel {...makeProps({ onBudgetMinChange, onBudgetMaxChange })} />);
    fireEvent.click(screen.getByText("5억 이하"));
    expect(onBudgetMinChange).toHaveBeenCalledWith("");
    expect(onBudgetMaxChange).toHaveBeenCalledWith("5");
  });

  // 예산 입력 변경 시 콜백 호출
  it("최소 예산 입력 변경 시 onBudgetMinChange 호출", () => {
    const onBudgetMinChange = vi.fn();
    render(<BudgetPanel {...makeProps({ onBudgetMinChange })} />);
    fireEvent.change(screen.getByLabelText("최소 예산(억)"), { target: { value: "2" } });
    expect(onBudgetMinChange).toHaveBeenCalledWith("2");
  });

  // budgetMin/budgetMax 비어있으면 초기화 버튼 미표시
  it("예산 미설정 시 초기화 버튼 미표시", () => {
    render(<BudgetPanel {...makeProps()} />);
    expect(screen.queryByLabelText("예산 초기화")).not.toBeInTheDocument();
  });

  // budgetMax 설정 시 초기화 버튼 표시
  it("예산 설정 시 초기화 버튼 표시", () => {
    render(<BudgetPanel {...makeProps({ budgetMax: "5" })} />);
    expect(screen.getByLabelText("예산 초기화")).toBeInTheDocument();
  });

  // 초기화 버튼 클릭 시 onBudgetReset 호출
  it("초기화 버튼 클릭 시 onBudgetReset 호출", () => {
    const onBudgetReset = vi.fn();
    render(<BudgetPanel {...makeProps({ budgetMax: "5", onBudgetReset })} />);
    fireEvent.click(screen.getByLabelText("예산 초기화"));
    expect(onBudgetReset).toHaveBeenCalledTimes(1);
  });
});
