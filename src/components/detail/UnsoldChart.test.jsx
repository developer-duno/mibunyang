// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 훅 모킹
const mockUseUnsoldHistory = vi.fn();
vi.mock("@/hooks/useUnsoldHistory", () => ({
  useUnsoldHistory: (/** @type {any[]} */ ...args) => mockUseUnsoldHistory(...args),
}));

// LineChart 모킹
vi.mock("@/components/primitives", () => ({
  LineChart: (/** @type {any} */ props) => <div data-testid="line-chart" aria-label={props.yLabel} />,
}));

import { UnsoldChart } from "./UnsoldChart";

function makeData(count = 3, withSecondary = false) {
  return Array.from({ length: count }, (_, i) => ({
    base_month: `20250${i + 1}`,
    unsold_count: 100 - i * 10,
    post_completion_unsold: withSecondary ? 20 - i * 5 : null,
  }));
}

describe("UnsoldChart", () => {
  beforeEach(() => {
    mockUseUnsoldHistory.mockReset();
  });

  // apartmentId가 falsy이면 null
  it("apartmentId 없음 → null", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (null)} siblingIds={[]} />);
    expect(container.innerHTML).toBe("");
  });

  // loading 상태
  it("loading → '불러오는 중...' 표시", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: [], loading: true, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(screen.getByText("불러오는 중...")).toBeTruthy();
  });

  // error 상태 + 재시도
  it("error → 에러 메시지 + 재시도 클릭", () => {
    const retry = vi.fn();
    mockUseUnsoldHistory.mockReturnValue({ data: [], loading: false, error: new Error("fail"), retry });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(screen.getByText("차트를 불러올 수 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByText("재시도"));
    expect(retry).toHaveBeenCalledOnce();
  });

  // data < 2 → null
  it("data 1건 → null", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(1), loading: false, error: null, retry: vi.fn() });
    const { container } = render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(container.innerHTML).toBe("");
  });

  // 정상 렌더 + secondaryData 범례
  it("data 3건 + secondaryData → 미분양 추이 + 준공후 범례", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3, true), loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    expect(screen.getByText("미분양 추이")).toBeTruthy();
    expect(screen.getByText("┄ 준공후")).toBeTruthy();
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  // ? 도움말 노출
  it("정상 렌더 시 제목 옆 ? 도움말이 보인다", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3, true), loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    const trigger = screen.getByRole("button", { name: "미분양 추이 풀이 보기" });
    fireEvent.click(trigger);
    expect(screen.getByText(/준공후 미분양/)).toBeTruthy();
  });
});
